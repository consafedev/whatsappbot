import {
  applyDecorators,
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  AiAllProvidersFailedError,
  AiAuthenticationError,
  type AiCompletionResponse,
  type AiMessage,
  type AiProviderType,
  AiRateLimitError,
  AiResilientRouter,
  type AiRoutedCompletionResponse,
  buildRagContextPrompt,
  createAiProvider,
  createEmbeddingProvider,
  injectRagContextIntoMessages,
  type RagCitation,
} from "@whatsapp-platform/ai-gateway";
import {
  type AiGatewayDatabase,
  getTenantAiUsageSummary,
  listTenantAliases,
  recordAiUsage,
  resolveProviderAndKey,
  resolveRoutesForAlias,
  searchKnowledgeChunks,
  type TenantAiUsageSummary,
  type TenantContext,
  updateKeyStatus,
  type VirtualAliasListItem,
} from "@whatsapp-platform/database";
import type { PermissionKey } from "@whatsapp-platform/rbac";
import { TenantUserSessionGuard } from "./tenant-auth";
import {
  CurrentTenantContext,
  CurrentTenantIdentity,
  TenantContextGuard,
  type TenantSessionIdentity,
} from "./tenant-context";
import { RequireEntitlements, TenantEntitlementGuard } from "./tenant-entitlements";
import { RequirePermissions, TenantPermissionGuard } from "./tenant-rbac";

export const AI_GATEWAY_DATABASE = Symbol("AI_GATEWAY_DATABASE");
export const AI_GATEWAY_SECRET = Symbol("AI_GATEWAY_SECRET");

function aiAuthorized(...permissions: PermissionKey[]): MethodDecorator & ClassDecorator {
  return applyDecorators(
    RequirePermissions(...permissions),
    UseGuards(
      TenantUserSessionGuard,
      TenantContextGuard,
      TenantPermissionGuard,
      TenantEntitlementGuard,
    ),
  );
}

export interface DiscoverModelsQuery {
  readonly providerType?: string | undefined;
  readonly providerConfigId?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly apiKey?: string | undefined;
}

export interface TestCompletionPayload {
  readonly prompt?: string | undefined;
  readonly messages?: Array<{ role: "system" | "user" | "assistant"; content: string }> | undefined;
  readonly model?: string | undefined;
  readonly providerType?: string | undefined;
  readonly providerConfigId?: string | undefined;
  readonly temperature?: number | undefined;
  readonly maxTokens?: number | undefined;
}

export interface RouteCompletionPayload {
  readonly aliasKey?: string | undefined;
  readonly targetModelId?: string | undefined;
  readonly prompt?: string | undefined;
  readonly messages?: Array<{ role: "system" | "user" | "assistant"; content: string }> | undefined;
  readonly temperature?: number | undefined;
  readonly maxTokens?: number | undefined;
  readonly purpose?: string | undefined;
}

export interface RagCompletionPayload {
  readonly aliasKey?: string | undefined;
  readonly targetModelId?: string | undefined;
  readonly prompt?: string | undefined;
  readonly queryText?: string | undefined;
  readonly messages?: Array<{ role: "system" | "user" | "assistant"; content: string }> | undefined;
  readonly minScore?: number | undefined;
  readonly topK?: number | undefined;
  readonly documentIds?: string[] | undefined;
  readonly temperature?: number | undefined;
  readonly maxTokens?: number | undefined;
  readonly purpose?: string | undefined;
  readonly embeddingProviderType?: string | undefined;
  readonly embeddingApiKey?: string | undefined;
  readonly embeddingBaseUrl?: string | undefined;
}

@Injectable()
export class AiGatewayService {
  constructor(
    @Inject(AI_GATEWAY_DATABASE) private readonly database: AiGatewayDatabase,
    @Inject(AI_GATEWAY_SECRET) private readonly secret: string | Uint8Array,
  ) {}

  async discoverModels(
    context: TenantContext,
    query: DiscoverModelsQuery,
  ): Promise<{ models: string[] }> {
    if (query.apiKey) {
      const providerType = (query.providerType ?? "openai_compatible") as AiProviderType;
      const provider = createAiProvider(providerType);
      const models = await provider.fetchAvailableModels({
        apiKey: query.apiKey,
        baseUrl: query.baseUrl,
      });
      return { models };
    }

    const resolved = await resolveProviderAndKey(this.database, {
      tenantId: context.tenantId,
      providerConfigId: query.providerConfigId,
      providerType: query.providerType,
      encryptionSecret: this.secret,
    });

    if (!resolved) {
      throw new NotFoundException("No enabled AI provider configuration found");
    }

    const providerType = resolved.config.providerType as AiProviderType;
    const provider = createAiProvider(providerType);
    const credentials = {
      apiKey: resolved.decryptedApiKey ?? "mock-key",
      baseUrl: resolved.config.baseUrl ?? query.baseUrl,
    };

    const models = await provider.fetchAvailableModels(credentials);
    return { models };
  }

  async testCompletion(
    context: TenantContext,
    payload: TestCompletionPayload,
    _identity: TenantSessionIdentity,
  ): Promise<Record<string, unknown>> {
    const messages: readonly AiMessage[] =
      payload.messages && payload.messages.length > 0
        ? payload.messages
        : [{ role: "user", content: payload.prompt || "Hola, prueba de completado AI" }];

    let providerType: AiProviderType = (payload.providerType ?? "mock") as AiProviderType;
    let apiKey = "mock-key";
    let baseUrl: string | undefined;
    let keyId: string | undefined;
    let model = payload.model ?? "mock-gpt-4o";

    if (payload.providerType !== "mock" || payload.providerConfigId) {
      const resolved = await resolveProviderAndKey(this.database, {
        tenantId: context.tenantId,
        providerConfigId: payload.providerConfigId,
        providerType: payload.providerType,
        encryptionSecret: this.secret,
      });

      if (resolved) {
        providerType = resolved.config.providerType as AiProviderType;
        baseUrl = resolved.config.baseUrl ?? undefined;
        apiKey = resolved.decryptedApiKey ?? "mock-key";
        keyId = resolved.selectedKey?.id;
        if (!payload.model) {
          model = providerType === "google_gemini" ? "gemini-1.5-flash" : "gpt-4o";
        }
      }
    }

    const provider = createAiProvider(providerType);
    let response: AiCompletionResponse;

    try {
      response = await provider.generateCompletion(
        {
          model,
          messages,
          temperature: payload.temperature,
          maxTokens: payload.maxTokens,
        },
        { apiKey, baseUrl },
      );
    } catch (err: unknown) {
      const status = err instanceof AiRateLimitError ? "rate_limited" : "error";
      const errorMessage = err instanceof Error ? err.message : String(err);

      await recordAiUsage(this.database, {
        tenantId: context.tenantId,
        providerType,
        modelId: model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costEstimatedUsd: 0,
        latencyMs: 0,
        purpose: "test",
        status,
        errorMessage,
        keyId,
      });

      if (err instanceof AiRateLimitError) {
        throw new HttpException("AI Provider rate limit exceeded", HttpStatus.TOO_MANY_REQUESTS);
      }
      if (err instanceof AiAuthenticationError) {
        throw new UnauthorizedException(errorMessage);
      }
      throw new BadRequestException(errorMessage);
    }

    await recordAiUsage(this.database, {
      tenantId: context.tenantId,
      providerType,
      modelId: response.model,
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      totalTokens: response.usage.totalTokens,
      costEstimatedUsd: 0.00001 * response.usage.totalTokens,
      latencyMs: response.latencyMs,
      purpose: "test",
      status: "success",
      keyId,
    });

    return {
      model: response.model,
      content: response.content,
      finishReason: response.finishReason,
      usage: response.usage,
      latencyMs: response.latencyMs,
      providerType,
    };
  }

  async listAliases(context: TenantContext): Promise<VirtualAliasListItem[]> {
    return listTenantAliases(this.database, context.tenantId);
  }

  async routeCompletion(
    context: TenantContext,
    payload: RouteCompletionPayload,
    _identity: TenantSessionIdentity,
  ): Promise<Record<string, unknown>> {
    const aliasKey = payload.aliasKey ?? "platform-fast";
    const resolvedAlias = await resolveRoutesForAlias(this.database, {
      tenantId: context.tenantId,
      aliasKey,
      encryptionSecret: this.secret,
    });

    if (!resolvedAlias || resolvedAlias.routes.length === 0) {
      throw new NotFoundException(`No active routes found for AI virtual alias '${aliasKey}'`);
    }

    const messages: readonly AiMessage[] =
      payload.messages && payload.messages.length > 0
        ? payload.messages
        : [
            {
              role: "user",
              content: payload.prompt || "Hola, prueba de completado con enrutamiento",
            },
          ];

    const router = new AiResilientRouter({
      onKeyRateLimited: async (keyId, cooldownUntil) => {
        await updateKeyStatus(this.database, {
          keyId,
          status: "rate_limited",
          rateLimitedUntil: cooldownUntil,
        });
      },
    });

    let response: AiRoutedCompletionResponse;
    try {
      response = await router.routeCompletion({
        aliasKey,
        targetModelId: payload.targetModelId,
        messages,
        temperature: payload.temperature,
        maxTokens: payload.maxTokens,
        purpose: payload.purpose ?? "triage",
        routes: resolvedAlias.routes,
      });
    } catch (err: unknown) {
      if (err instanceof AiAllProvidersFailedError) {
        for (const attempt of err.attempts) {
          await recordAiUsage(this.database, {
            tenantId: context.tenantId,
            providerType: attempt.providerType,
            modelId: attempt.modelId,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            costEstimatedUsd: 0,
            latencyMs: attempt.latencyMs,
            purpose: payload.purpose ?? "triage",
            status: attempt.status,
            errorMessage: attempt.errorMessage ?? null,
            keyId: attempt.keyId,
          });
        }
        throw new HttpException(
          `All AI provider routes failed: ${err.message}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }

    const successfulAttempt = response.routingAttempts.find((a) => a.status === "success");
    await recordAiUsage(this.database, {
      tenantId: context.tenantId,
      providerType: response.providerUsed,
      modelId: response.modelUsed,
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      totalTokens: response.usage.totalTokens,
      costEstimatedUsd: 0.00001 * response.usage.totalTokens,
      latencyMs: response.latencyMs,
      purpose: payload.purpose ?? "triage",
      status: "success",
      keyId: successfulAttempt?.keyId,
    });

    for (const attempt of response.routingAttempts) {
      if (attempt.status !== "success") {
        await recordAiUsage(this.database, {
          tenantId: context.tenantId,
          providerType: attempt.providerType,
          modelId: attempt.modelId,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costEstimatedUsd: 0,
          latencyMs: attempt.latencyMs,
          purpose: payload.purpose ?? "triage",
          status: attempt.status,
          errorMessage: attempt.errorMessage ?? null,
          keyId: attempt.keyId,
        });
      }
    }

    return {
      content: response.content,
      modelUsed: response.modelUsed,
      providerUsed: response.providerUsed,
      attemptsCount: response.attemptsCount,
      totalTokens: response.totalTokens,
      latencyMs: response.latencyMs,
      usage: response.usage,
      finishReason: response.finishReason,
      routingAttempts: response.routingAttempts,
    };
  }

  async ragCompletion(
    context: TenantContext,
    payload: RagCompletionPayload,
    identity: TenantSessionIdentity,
  ): Promise<Record<string, unknown>> {
    const lastUserMessage = payload.messages
      ?.filter((m) => m.role === "user")
      .slice(-1)[0]?.content;
    const searchText = (
      payload.queryText ||
      payload.prompt ||
      lastUserMessage ||
      "consulta"
    ).trim();

    const embeddingProvider = createEmbeddingProvider(payload.embeddingProviderType ?? "mock");
    const embeddingRes = await embeddingProvider.generateEmbeddings(
      { input: searchText },
      {
        apiKey: payload.embeddingApiKey ?? "mock-key",
        baseUrl: payload.embeddingBaseUrl,
      },
    );

    const queryEmbedding = embeddingRes.embeddings[0] ?? [];
    const embeddingTokens = embeddingRes.totalTokens;

    let citations: RagCitation[] = [];
    if (queryEmbedding.length > 0) {
      citations = await searchKnowledgeChunks(this.database, {
        tenantId: context.tenantId,
        queryEmbedding,
        topK: payload.topK ?? 3,
        minScore: payload.minScore ?? 0.7,
        documentIds: payload.documentIds,
      });
    }

    const ragContext = buildRagContextPrompt(citations);

    const baseMessages: readonly AiMessage[] =
      payload.messages && payload.messages.length > 0
        ? payload.messages
        : [{ role: "user", content: payload.prompt || searchText }];

    const enrichedMessages = injectRagContextIntoMessages(baseMessages, ragContext);

    const aliasKey = payload.aliasKey ?? "platform-smart";
    const routeResult = await this.routeCompletion(
      context,
      {
        aliasKey,
        targetModelId: payload.targetModelId,
        messages: [...enrichedMessages],
        temperature: payload.temperature,
        maxTokens: payload.maxTokens,
        purpose: payload.purpose ?? "smart_reply",
      },
      identity,
    );

    const totalTokens = embeddingTokens + Number(routeResult.totalTokens ?? 0);

    return {
      content: routeResult.content,
      citations,
      modelUsed: routeResult.modelUsed,
      providerUsed: routeResult.providerUsed,
      attemptsCount: routeResult.attemptsCount,
      totalTokens,
      latencyMs: routeResult.latencyMs,
      usage: {
        ...(routeResult.usage as Record<string, unknown>),
        embeddingTokens,
        totalTokens,
      },
      finishReason: routeResult.finishReason,
      routingAttempts: routeResult.routingAttempts,
    };
  }

  async getUsageSummary(
    context: TenantContext,
    since?: Date | undefined,
  ): Promise<TenantAiUsageSummary> {
    return getTenantAiUsageSummary(this.database, {
      tenantId: context.tenantId,
      since,
    });
  }
}

@Controller("api/v1/ai")
@RequireEntitlements("module.ai")
export class AiGatewayController {
  constructor(private readonly service: AiGatewayService) {}

  @Get("aliases")
  @aiAuthorized("ai.settings.manage")
  async listAliases(
    @CurrentTenantContext() context: TenantContext,
  ): Promise<VirtualAliasListItem[]> {
    return this.service.listAliases(context);
  }

  @Get("models/discover")
  @aiAuthorized("ai.settings.manage")
  async discoverModels(
    @CurrentTenantContext() context: TenantContext,
    @Query("providerType") providerType?: string,
    @Query("providerConfigId") providerConfigId?: string,
    @Query("baseUrl") baseUrl?: string,
    @Headers("x-provider-api-key") apiKey?: string,
  ): Promise<{ models: string[] }> {
    return this.service.discoverModels(context, {
      providerType,
      providerConfigId,
      baseUrl,
      apiKey,
    });
  }

  @Post("completions/test")
  @HttpCode(200)
  @aiAuthorized("ai.settings.manage")
  async testCompletion(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Body() payload: TestCompletionPayload,
  ): Promise<Record<string, unknown>> {
    return this.service.testCompletion(context, payload, identity);
  }

  @Post("completions/route")
  @HttpCode(200)
  @aiAuthorized("ai.settings.manage")
  async routeCompletion(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Body() payload: RouteCompletionPayload,
  ): Promise<Record<string, unknown>> {
    return this.service.routeCompletion(context, payload, identity);
  }

  @Post("completions/rag")
  @HttpCode(200)
  @aiAuthorized("ai.settings.manage")
  async ragCompletion(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Body() payload: RagCompletionPayload,
  ): Promise<Record<string, unknown>> {
    return this.service.ragCompletion(context, payload, identity);
  }

  @Get("usage/summary")
  @aiAuthorized("ai.settings.manage")
  async getUsageSummary(
    @CurrentTenantContext() context: TenantContext,
    @Query("since") sinceStr?: string,
  ): Promise<TenantAiUsageSummary> {
    const since = sinceStr ? new Date(sinceStr) : undefined;
    return this.service.getUsageSummary(context, since);
  }
}
