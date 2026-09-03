import type { AiEmbeddingProvider, EmbeddingRequest, EmbeddingResponse } from "./types";

/**
 * Deterministic Mock Embedding Provider for offline tests and CI.
 * Generates unit-normalized vectors derived deterministically from the input string hash.
 */
export class MockEmbeddingProvider implements AiEmbeddingProvider {
  async generateEmbeddings(
    request: EmbeddingRequest,
    _credentials: { apiKey: string; baseUrl?: string | undefined },
  ): Promise<EmbeddingResponse> {
    const inputs = Array.isArray(request.input) ? request.input : [request.input];
    const dimensions = request.dimensions ?? 128;
    const modelId = request.model ?? "mock-embed";

    const embeddings = inputs.map((text) => this.generateVector(text, dimensions));
    const totalTokens = inputs.reduce(
      (acc, text) => acc + Math.max(1, Math.ceil(text.length / 4)),
      0,
    );

    return {
      embeddings,
      totalTokens,
      modelId,
      provider: "mock",
    };
  }

  private generateVector(text: string, dimensions: number): number[] {
    const rawVector: number[] = new Array(dimensions);
    let hash = 0x811c9dc5;

    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }

    let sumSq = 0;
    for (let d = 0; d < dimensions; d++) {
      // Deterministic pseudo-random value in [-1, 1]
      const val = Math.sin(hash + d * 31);
      rawVector[d] = val;
      sumSq += val * val;
    }

    // Normalize to unit length (L2 norm)
    const norm = Math.sqrt(sumSq) || 1.0;
    return rawVector.map((v) => Number((v / norm).toFixed(6)));
  }
}
