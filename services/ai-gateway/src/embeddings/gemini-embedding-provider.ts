import {
  AiAuthenticationError,
  AiGatewayError,
  AiRateLimitError,
  AiTimeoutError,
} from "../types";
import type { AiEmbeddingProvider, EmbeddingRequest, EmbeddingResponse } from "./types";

interface GeminiBatchEmbeddingApiResponse {
  readonly embeddings: Array<{
    readonly values: number[];
  }>;
}

export class GoogleGeminiEmbeddingProvider implements AiEmbeddingProvider {
  async generateEmbeddings(
    request: EmbeddingRequest,
    credentials: { apiKey: string; baseUrl?: string | undefined },
  ): Promise<EmbeddingResponse> {
    const inputs = Array.isArray(request.input) ? request.input : [request.input];
    const model = request.model ?? "text-embedding-004";
    const baseUrl = credentials.baseUrl?.replace(/\/+$/, "") ?? "https://generativelanguage.googleapis.com/v1beta";
    const endpoint = `${baseUrl}/models/${model}:batchEmbedContents?key=${credentials.apiKey}`;

    const body = {
      requests: inputs.map((text) => ({
        model: `models/${model}`,
        content: {
          parts: [{ text }],
        },
      })),
    };

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new AiTimeoutError("Google Gemini embedding request timed out after 15000ms");
      }
      throw new AiGatewayError(`Google Gemini embedding network failure: ${String(err)}`);
    }

    if (!response.ok) {
      let errorBody: string;
      try {
        errorBody = await response.text();
      } catch {
        errorBody = "Failed to parse error response body";
      }

      if (response.status === 401 || response.status === 403) {
        throw new AiAuthenticationError(`Google Gemini embedding authentication failed: ${errorBody}`);
      }
      if (response.status === 429) {
        throw new AiRateLimitError(`Google Gemini embedding rate limit exceeded: ${errorBody}`);
      }
      throw new AiGatewayError(
        `Google Gemini embedding failed with HTTP ${response.status}: ${errorBody}`,
        { statusCode: response.status },
      );
    }

    let data: GeminiBatchEmbeddingApiResponse;
    try {
      data = (await response.json()) as GeminiBatchEmbeddingApiResponse;
    } catch (err) {
      throw new AiGatewayError(`Google Gemini returned invalid JSON: ${String(err)}`);
    }

    const embeddings = data.embeddings?.map((e) => e.values) ?? [];
    const totalTokens = inputs.reduce((acc, t) => acc + Math.ceil(t.length / 4), 0);

    return {
      embeddings,
      totalTokens,
      modelId: model,
      provider: "google_gemini",
    };
  }
}
