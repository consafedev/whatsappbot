import { type RagCitation, rankChunksBySimilarity } from "@whatsapp-platform/ai-gateway";
import type { KnowledgeBaseDatabase } from "./knowledge-base-manager";

export interface SearchKnowledgeChunksInput {
  readonly tenantId: string;
  readonly queryEmbedding: readonly number[];
  readonly topK?: number | undefined;
  readonly minScore?: number | undefined;
  readonly documentIds?: readonly string[] | undefined;
}

/**
 * Searches and ranks knowledge base chunks for an active tenant by cosine similarity against a query embedding.
 * Only retrieves chunks belonging to INDEXED documents for the specific tenantId.
 */
export async function searchKnowledgeChunks(
  db: KnowledgeBaseDatabase,
  input: SearchKnowledgeChunksInput,
): Promise<RagCitation[]> {
  if (!input.queryEmbedding || input.queryEmbedding.length === 0) {
    return [];
  }

  const where = {
    tenantId: input.tenantId,
    document: {
      status: "INDEXED",
      ...(input.documentIds && input.documentIds.length > 0
        ? { id: { in: [...input.documentIds] } }
        : {}),
    },
  };

  const chunks = await db.knowledgeChunk.findMany({
    where,
    select: {
      id: true,
      documentId: true,
      chunkIndex: true,
      content: true,
      embedding: true,
      document: {
        select: {
          title: true,
        },
      },
    },
  });

  if (chunks.length === 0) {
    return [];
  }

  const chunksWithParsedEmbedding = chunks.map((c: (typeof chunks)[number]) => ({
    id: c.id,
    documentId: c.documentId,
    documentTitle: c.document.title,
    chunkIndex: c.chunkIndex,
    content: c.content,
    embedding: Array.isArray(c.embedding) ? (c.embedding as number[]) : null,
  }));

  const ranked = rankChunksBySimilarity(input.queryEmbedding, chunksWithParsedEmbedding, {
    topK: input.topK ?? 3,
    minScore: input.minScore ?? 0.7,
  });

  return ranked.map((r: (typeof ranked)[number]) => ({
    documentId: r.documentId,
    documentTitle: r.documentTitle,
    chunkIndex: r.chunkIndex,
    content: r.content,
    score: r.score,
  }));
}
