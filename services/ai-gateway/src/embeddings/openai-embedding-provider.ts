import { AiAuthenticationError, AiGatewayError, AiRateLimitError, AiTimeoutError } from "../types";
import type { AiEmbeddingProvider, EmbeddingRequest, EmbeddingResponse } from "./types";

interface OpenAiEmbeddingApiResponse {
  readonly object: string;
  readonly data: Array<{
    readonly object: string;
    readonly index: number;
    readonly embedding: number[];
  }>;
  readonly model: string;
  readonly usage: {
    readonly prompt_tokens: number;
    readonly total_tokens: number;
  };
}

export class OpenAiCompatibleEmbeddingProvider implements AiEmbeddingProvider {
  async generateEmbeddings(
    request: EmbeddingRequest,
    credentials: { apiKey: string; baseUrl?: string | undefined },
  ): Promise<EmbeddingResponse> {
    const inputs = Array.isArray(request.input) ? request.input : [request.input];
    const model = request.model ?? "text-embedding-3-small";
    const baseUrl = credentials.baseUrl?.replace(/\/+$/, "") ?? "https://api.openai.com/v1";
    const endpoint = `${baseUrl}/embeddings`;

    const body: Record<string, unknown> = {
      model,
      input: inputs,
    };

    if (request.dimensions !== undefined) {
      body.dimensions = request.dimensions;
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credentials.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new AiTimeoutError("OpenAI Compatible embedding request timed out after 15000ms");
      }
      throw new AiGatewayError(`OpenAI Compatible embedding network failure: ${String(err)}`);
    }

    if (!response.ok) {
      let errorBody: string;
      try {
        errorBody = await response.text();
      } catch {
        errorBody = "Failed to parse error response body";
      }

      if (response.status === 401 || response.status === 403) {
        throw new AiAuthenticationError(
          `OpenAI Compatible embedding authentication failed: ${errorBody}`,
        );
      }
      if (response.status === 429) {
        throw new AiRateLimitError(`OpenAI Compatible embedding rate limit exceeded: ${errorBody}`);
      }
      throw new AiGatewayError(
        `OpenAI Compatible embedding failed with HTTP ${response.status}: ${errorBody}`,
        { statusCode: response.status },
      );
    }

    let data: OpenAiEmbeddingApiResponse;
    try {
      data = (await response.json()) as OpenAiEmbeddingApiResponse;
    } catch (err) {
      throw new AiGatewayError(`OpenAI Compatible returned invalid JSON: ${String(err)}`);
    }

    const sortedData = [...data.data].sort((a, b) => a.index - b.index);
    const embeddings = sortedData.map((d) => d.embedding);
    const totalTokens =
      data.usage?.total_tokens ?? inputs.reduce((acc, t) => acc + Math.ceil(t.length / 4), 0);

    return {
      embeddings,
      totalTokens,
      modelId: data.model ?? model,
      provider: "openai_compatible",
    };
  }
}
