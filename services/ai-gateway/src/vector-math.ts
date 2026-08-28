export interface RankChunksOptions {
  readonly topK?: number | undefined;
  readonly minScore?: number | undefined;
}

export interface ChunkWithEmbedding {
  readonly id: string;
  readonly embedding: readonly number[] | null;
}

/**
 * Calculates the cosine similarity between two vectors.
 * Returns a value between -1.0 and 1.0 (or 0.0 if vectors are empty or have zero norm).
 */
export function cosineSimilarity(
  vecA: readonly number[],
  vecB: readonly number[],
): number {
  if (vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) {
    return 0.0;
  }

  let dotProduct = 0.0;
  let normASq = 0.0;
  let normBSq = 0.0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i] ?? 0;
    const b = vecB[i] ?? 0;
    dotProduct += a * b;
    normASq += a * a;
    normBSq += b * b;
  }

  const denominator = Math.sqrt(normASq) * Math.sqrt(normBSq);
  if (denominator === 0.0) {
    return 0.0;
  }

  const similarity = dotProduct / denominator;
  // Clamp to [-1.0, 1.0] to guard against floating-point precision issues
  return Math.max(-1.0, Math.min(1.0, similarity));
}

/**
 * Ranks chunks by cosine similarity to a query embedding, filtering by minimum score threshold and limiting to topK.
 */
export function rankChunksBySimilarity<T extends ChunkWithEmbedding>(
  queryEmbedding: readonly number[],
  chunks: readonly T[],
  options?: RankChunksOptions,
): Array<T & { readonly score: number }> {
  const minScore = options?.minScore ?? 0.7;
  const topK = options?.topK ?? 3;

  if (queryEmbedding.length === 0 || chunks.length === 0 || topK <= 0) {
    return [];
  }

  const scored: Array<T & { readonly score: number }> = [];

  for (const chunk of chunks) {
    if (!chunk.embedding || chunk.embedding.length !== queryEmbedding.length) {
      continue;
    }

    const score = cosineSimilarity(queryEmbedding, chunk.embedding);
    if (score >= minScore) {
      scored.push({
        ...chunk,
        score: Number(score.toFixed(4)),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK);
}
