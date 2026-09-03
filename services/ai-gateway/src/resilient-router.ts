import { createAiProvider } from "./index";
import { type KeyPoolEntry, selectNextKey } from "./key-pool";
import {
  type AiCompletionResponse,
  type AiMessage,
  type AiProviderType,
  AiRateLimitError,
  AiTimeoutError,
  type AiTokenUsage,
} from "./types";

export interface AiResolvedRoute {
  readonly routeId: string;
  readonly targetModelId: string;
  readonly priority: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly providerType: AiProviderType;
  readonly baseUrl?: string | null | undefined;
  readonly keys: readonly KeyPoolEntry[];
  readonly providerConfigId: string;
}

export interface AiRoutingAttempt {
  readonly routeId: string;
  readonly providerType: AiProviderType;
  readonly modelId: string;
  readonly keyId?: string | undefined;
  readonly attemptNumber: number;
  readonly priority: number;
  readonly status: "success" | "rate_limited" | "error" | "timeout";
  readonly latencyMs: number;
  readonly errorMessage?: string | undefined;
}

export interface AiRoutedCompletionRequest {
  readonly aliasKey?: string | undefined;
  readonly targetModelId?: string | undefined;
  readonly messages: readonly AiMessage[];
  readonly temperature?: number | undefined;
  readonly maxTokens?: number | undefined;
  readonly purpose?: string | undefined;
  readonly routes: readonly AiResolvedRoute[];
}

export interface AiRoutedCompletionResponse {
  readonly content: string;
  readonly modelUsed: string;
  readonly providerUsed: AiProviderType;
  readonly attemptsCount: number;
  readonly totalTokens: number;
  readonly latencyMs: number;
  readonly usage: AiTokenUsage;
  readonly finishReason?: string | undefined;
  readonly routingAttempts: readonly AiRoutingAttempt[];
}

export class AiAllProvidersFailedError extends Error {
  override readonly name = "AiAllProvidersFailedError";
  readonly attempts: readonly AiRoutingAttempt[];

  constructor(message: string, attempts: readonly AiRoutingAttempt[]) {
    super(message);
    this.attempts = attempts;
  }
}

export type OnKeyRateLimitedCallback = (keyId: string, cooldownUntil: Date) => Promise<void> | void;

export class AiResilientRouter {
  constructor(
    private readonly options: {
      readonly rateLimitCooldownMs?: number | undefined;
      readonly onKeyRateLimited?: OnKeyRateLimitedCallback | undefined;
    } = {},
  ) {}

  async routeCompletion(request: AiRoutedCompletionRequest): Promise<AiRoutedCompletionResponse> {
    if (!request.routes || request.routes.length === 0) {
      throw new AiAllProvidersFailedError("No active routes available for alias", []);
    }

    const sortedRoutes = [...request.routes].sort((a, b) => a.priority - b.priority);
    const attempts: AiRoutingAttempt[] = [];
    const cooldownMs = this.options.rateLimitCooldownMs ?? 60_000;
    const startTime = Date.now();

    for (const route of sortedRoutes) {
      const activeKeys: KeyPoolEntry[] = route.keys.map((k) => ({ ...k }));
      let routeAttempts = 0;
      const maxRetries = Math.max(0, route.maxRetries);

      while (routeAttempts <= maxRetries) {
        const selectedKey = selectNextKey(activeKeys, new Date());
        if (!selectedKey) {
          // No more active keys available in this route, jump to next route in cascade
          break;
        }

        routeAttempts += 1;
        const attemptStartTime = Date.now();
        const modelId = request.targetModelId ?? route.targetModelId;
        const provider = createAiProvider(route.providerType);

        try {
          const response: AiCompletionResponse = await provider.generateCompletion(
            {
              model: modelId,
              messages: request.messages,
              temperature: request.temperature,
              maxTokens: request.maxTokens,
            },
            {
              apiKey: selectedKey.rawApiKey ?? "mock-key",
              baseUrl: route.baseUrl ?? undefined,
            },
          );

          const attemptLatency = Date.now() - attemptStartTime;
          attempts.push({
            routeId: route.routeId,
            providerType: route.providerType,
            modelId: response.model,
            keyId: selectedKey.id,
            attemptNumber: attempts.length + 1,
            priority: route.priority,
            status: "success",
            latencyMs: attemptLatency,
          });

          return {
            content: response.content,
            modelUsed: response.model,
            providerUsed: route.providerType,
            attemptsCount: attempts.length,
            totalTokens: response.usage.totalTokens,
            latencyMs: Date.now() - startTime,
            usage: response.usage,
            finishReason: response.finishReason,
            routingAttempts: attempts,
          };
        } catch (err: unknown) {
          const attemptLatency = Date.now() - attemptStartTime;
          const errorMessage = err instanceof Error ? err.message : String(err);

          if (err instanceof AiRateLimitError) {
            const cooldownUntil = new Date(Date.now() + cooldownMs);
            // Put current key into cooldown
            const keyIndex = activeKeys.findIndex((k) => k.id === selectedKey.id);
            if (keyIndex >= 0 && activeKeys[keyIndex]) {
              activeKeys[keyIndex] = {
                ...activeKeys[keyIndex],
                status: "rate_limited",
                rateLimitedUntil: cooldownUntil,
              };
            }

            if (this.options.onKeyRateLimited) {
              try {
                await this.options.onKeyRateLimited(selectedKey.id, cooldownUntil);
              } catch {
                // Ignore failure in notification callback
              }
            }

            attempts.push({
              routeId: route.routeId,
              providerType: route.providerType,
              modelId,
              keyId: selectedKey.id,
              attemptNumber: attempts.length + 1,
              priority: route.priority,
              status: "rate_limited",
              latencyMs: attemptLatency,
              errorMessage,
            });

            // Continue while loop to try next key in this route
            continue;
          }

          const status = err instanceof AiTimeoutError ? "timeout" : "error";
          attempts.push({
            routeId: route.routeId,
            providerType: route.providerType,
            modelId,
            keyId: selectedKey.id,
            attemptNumber: attempts.length + 1,
            priority: route.priority,
            status,
            latencyMs: attemptLatency,
            errorMessage,
          });

          // For fatal/network/timeout errors, jump to next route in failover cascade
          break;
        }
      }
    }

    throw new AiAllProvidersFailedError(
      `All ${attempts.length} AI provider routing attempts failed`,
      attempts,
    );
  }
}
