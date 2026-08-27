import {
  AiAuthenticationError,
  AiGatewayError,
  type AiCompletionRequest,
  type AiCompletionResponse,
  type AiProvider,
  type AiProviderCredentials,
  type AiProviderType,
  AiRateLimitError,
  AiTimeoutError,
} from "../types";

export class OpenAiCompatibleProvider implements AiProvider {
  readonly providerType: AiProviderType = "openai_compatible";
  private readonly defaultBaseUrl = "https://api.openai.com/v1";
  private readonly timeoutMs: number;

  constructor(options?: { timeoutMs?: number }) {
    this.timeoutMs = options?.timeoutMs ?? 15000;
  }

  private resolveBaseUrl(baseUrl?: string): string {
    const trimmed = baseUrl?.trim();
    if (!trimmed) {
      return this.defaultBaseUrl;
    }
    return trimmed.replace(/\/+$/, "");
  }

  async generateCompletion(
    request: AiCompletionRequest,
    credentials: AiProviderCredentials,
  ): Promise<AiCompletionResponse> {
    const startTime = Date.now();
    const baseUrl = this.resolveBaseUrl(credentials.baseUrl);
    const url = `${baseUrl}/chat/completions`;

    const payload: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
      })),
    };

    if (request.temperature !== undefined) payload.temperature = request.temperature;
    if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens;
    if (request.topP !== undefined) payload.top_p = request.topP;
    if (request.stop !== undefined) payload.stop = request.stop;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credentials.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new AiTimeoutError(`OpenAI-compatible request timed out after ${this.timeoutMs}ms`, { cause: error });
      }
      throw new AiGatewayError("Network error calling OpenAI-compatible provider", { cause: error });
    }

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let errorMessage = `Provider returned HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(errorBody) as { error?: { message?: string } };
        if (parsed.error?.message) {
          errorMessage = parsed.error.message;
        }
      } catch {
        if (errorBody) errorMessage = `${errorMessage}: ${errorBody}`;
      }

      if (response.status === 401 || response.status === 403) {
        throw new AiAuthenticationError(errorMessage);
      }
      if (response.status === 429) {
        throw new AiRateLimitError(errorMessage);
      }
      throw new AiGatewayError(errorMessage, { statusCode: response.status });
    }

    const data = (await response.json()) as {
      id?: string;
      model?: string;
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? "";
    const finishReason = choice?.finish_reason;
    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;
    const totalTokens = data.usage?.total_tokens ?? (promptTokens + completionTokens);

    return {
      id: data.id,
      model: data.model ?? request.model,
      content,
      finishReason,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
      latencyMs,
      rawResponse: data,
    };
  }

  async fetchAvailableModels(credentials: AiProviderCredentials): Promise<string[]> {
    const baseUrl = this.resolveBaseUrl(credentials.baseUrl);
    const url = `${baseUrl}/models`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new AiTimeoutError(`Model discovery timed out after ${this.timeoutMs}ms`, { cause: error });
      }
      throw new AiGatewayError("Network error fetching models from provider", { cause: error });
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let errorMessage = `Provider returned HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(errorBody) as { error?: { message?: string } };
        if (parsed.error?.message) {
          errorMessage = parsed.error.message;
        }
      } catch {
        if (errorBody) errorMessage = `${errorMessage}: ${errorBody}`;
      }

      if (response.status === 401 || response.status === 403) {
        throw new AiAuthenticationError(errorMessage);
      }
      if (response.status === 429) {
        throw new AiRateLimitError(errorMessage);
      }
      throw new AiGatewayError(errorMessage, { statusCode: response.status });
    }

    const data = (await response.json()) as {
      data?: Array<{ id?: string }>;
      models?: Array<{ name?: string; id?: string; model?: string }>;
    };

    if (Array.isArray(data.data)) {
      return data.data.map((m) => m.id).filter((id): id is string => typeof id === "string" && id.length > 0);
    }
    if (Array.isArray(data.models)) {
      return data.models
        .map((m) => m.id ?? m.name ?? m.model)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
    }

    return [];
  }
}
