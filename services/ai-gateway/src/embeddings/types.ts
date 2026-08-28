export interface EmbeddingRequest {
  readonly input: string | string[];
  readonly model?: string | undefined;
  readonly dimensions?: number | undefined;
}

export interface EmbeddingResponse {
  readonly embeddings: number[][];
  readonly totalTokens: number;
  readonly modelId: string;
  readonly provider: string;
}

export interface AiEmbeddingProvider {
  generateEmbeddings(
    request: EmbeddingRequest,
    credentials: { apiKey: string; baseUrl?: string | undefined },
  ): Promise<EmbeddingResponse>;
}
