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

export class GoogleGeminiProvider implements AiProvider {
  readonly providerType: AiProviderType = "google_gemini";
  private readonly defaultBaseUrl = "https://generativelanguage.googleapis.com/v1beta";
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

  private normalizeModel(model: string): string {
    return model.replace(/^models\//, "");
  }

  async generateCompletion(
    request: AiCompletionRequest,
    credentials: AiProviderCredentials,
  ): Promise<AiCompletionResponse> {
    const startTime = Date.now();
    const baseUrl = this.resolveBaseUrl(credentials.baseUrl);
    const model = this.normalizeModel(request.model || "gemini-1.5-flash");
    const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(credentials.apiKey)}`;

    const contents = request.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const generationConfig: Record<string, unknown> = {};
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.maxTokens !== undefined) generationConfig.maxOutputTokens = request.maxTokens;
    if (request.topP !== undefined) generationConfig.topP = request.topP;
    if (request.stop !== undefined) generationConfig.stopSequences = request.stop;

    const payload: Record<string, unknown> = { contents };
    if (Object.keys(generationConfig).length > 0) {
      payload.generationConfig = generationConfig;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new AiTimeoutError(`Google Gemini request timed out after ${this.timeoutMs}ms`, { cause: error });
      }
      throw new AiGatewayError("Network error calling Google Gemini provider", { cause: error });
    }

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let errorMessage = `Gemini returned HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(errorBody) as { error?: { message?: string; status?: string } };
        if (parsed.error?.message) {
          errorMessage = parsed.error.message;
        }
      } catch {
        if (errorBody) errorMessage = `${errorMessage}: ${errorBody}`;
      }

      if (response.status === 401 || response.status === 403) {
        throw new AiAuthenticationError(errorMessage);
      }
      if (response.status === 429 || errorMessage.includes("RESOURCE_EXHAUSTED")) {
        throw new AiRateLimitError(errorMessage);
      }
      throw new AiGatewayError(errorMessage, { statusCode: response.status });
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
        finishReason?: string;
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    const candidate = data.candidates?.[0];
    const content = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const finishReason = candidate?.finishReason;
    const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
    const totalTokens = data.usageMetadata?.totalTokenCount ?? (promptTokens + completionTokens);

    return {
      model,
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
    const url = `${baseUrl}/models?key=${encodeURIComponent(credentials.apiKey)}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new AiTimeoutError(`Gemini model discovery timed out after ${this.timeoutMs}ms`, { cause: error });
      }
      throw new AiGatewayError("Network error fetching Gemini models", { cause: error });
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let errorMessage = `Gemini returned HTTP ${response.status}`;
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
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    };

    if (Array.isArray(data.models)) {
      return data.models
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent") ?? true)
        .map((m) => m.name?.replace(/^models\//, ""))
        .filter((name): name is string => typeof name === "string" && name.length > 0);
    }

    return [];
  }
}
