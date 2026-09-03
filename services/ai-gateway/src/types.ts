export type AiProviderType = "openai_compatible" | "google_gemini" | "mock";

export type AiKeyStatus = "active" | "rate_limited" | "disabled";

export type AiMessageRole = "system" | "user" | "assistant";

export interface AiMessage {
  readonly role: AiMessageRole;
  readonly content: string;
  readonly name?: string | undefined;
}

export interface AiCompletionRequest {
  readonly model: string;
  readonly messages: readonly AiMessage[];
  readonly temperature?: number | undefined;
  readonly maxTokens?: number | undefined;
  readonly topP?: number | undefined;
  readonly stop?: readonly string[] | undefined;
}

export interface AiTokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface AiCompletionResponse {
  readonly id?: string | undefined;
  readonly model: string;
  readonly content: string;
  readonly finishReason?: string | undefined;
  readonly usage: AiTokenUsage;
  readonly latencyMs: number;
  readonly rawResponse?: unknown;
}

export interface AiProviderCredentials {
  readonly apiKey: string;
  readonly baseUrl?: string | undefined;
}

export interface AiProvider {
  readonly providerType: AiProviderType;
  generateCompletion(
    request: AiCompletionRequest,
    credentials: AiProviderCredentials,
  ): Promise<AiCompletionResponse>;
  fetchAvailableModels(credentials: AiProviderCredentials): Promise<string[]>;
}

export class AiGatewayError extends Error {
  override readonly name: string = "AiGatewayError";
  readonly statusCode?: number | undefined;
  readonly isRetryable: boolean;

  constructor(
    message: string,
    options?: {
      statusCode?: number | undefined;
      isRetryable?: boolean | undefined;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });
    this.statusCode = options?.statusCode;
    this.isRetryable = options?.isRetryable ?? false;
  }
}

export class AiRateLimitError extends AiGatewayError {
  override readonly name: string = "AiRateLimitError";
  readonly retryAfterMs?: number | undefined;

  constructor(message: string, options?: { retryAfterMs?: number | undefined; cause?: unknown }) {
    super(message, { statusCode: 429, isRetryable: true, cause: options?.cause });
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export class AiAuthenticationError extends AiGatewayError {
  override readonly name: string = "AiAuthenticationError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { statusCode: 401, isRetryable: false, cause: options?.cause });
  }
}

export class AiTimeoutError extends AiGatewayError {
  override readonly name: string = "AiTimeoutError";

  constructor(message = "AI provider request timed out", options?: { cause?: unknown }) {
    super(message, { statusCode: 408, isRetryable: true, cause: options?.cause });
  }
}
