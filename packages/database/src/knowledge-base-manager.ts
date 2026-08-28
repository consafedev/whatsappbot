import {
  type AiEmbeddingProvider,
  type ChunkTextOptions,
  MockEmbeddingProvider,
  chunkText,
  sanitizeText,
} from "@whatsapp-platform/ai-gateway";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { createTenantContext } from "./tenant-context";
import { assertTenantOperational } from "./tenant-operational";

export type KnowledgeBaseDatabase = Pick<
  PrismaClient,
  "knowledgeDocument" | "knowledgeChunk" | "tenant" | "$transaction"
>;

export class KnowledgeDocumentNotFoundError extends Error {
  constructor(documentId: string, tenantId: string) {
    super(`Knowledge document '${documentId}' not found for tenant '${tenantId}'`);
    this.name = "KnowledgeDocumentNotFoundError";
  }
}

export interface CreateKnowledgeDocumentInput {
  readonly tenantId: string;
  readonly title: string;
  readonly sourceType: "text" | "markdown" | "faq" | "pdf_text" | string;
  readonly sourceUrl?: string | null | undefined;
  readonly rawContent: string;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface IndexKnowledgeDocumentInput {
  readonly tenantId: string;
  readonly documentId: string;
  readonly embeddingProvider?: AiEmbeddingProvider | undefined;
  readonly credentials?: { apiKey: string; baseUrl?: string | undefined } | undefined;
  readonly chunkOptions?: ChunkTextOptions | undefined;
}

export interface GetKnowledgeDocumentDetailInput {
  readonly tenantId: string;
  readonly documentId: string;
  readonly includeChunks?: boolean | undefined;
}

export interface ListKnowledgeDocumentsInput {
  readonly tenantId: string;
  readonly status?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface DeleteKnowledgeDocumentInput {
  readonly tenantId: string;
  readonly documentId: string;
}

export interface KnowledgeDocumentSummary {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly sourceType: string;
  readonly sourceUrl: string | null;
  readonly status: string;
  readonly charCount: number;
  readonly tokenCount: number;
  readonly errorMessage: string | null;
  readonly metadata: unknown;
  readonly chunksCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface KnowledgeDocumentDetail extends KnowledgeDocumentSummary {
  readonly rawContent: string;
  readonly chunks?: Array<{
    readonly id: string;
    readonly chunkIndex: number;
    readonly content: string;
    readonly tokenCount: number;
    readonly modelId: string;
    readonly createdAt: Date;
  }> | undefined;
}

/**
 * Creates a knowledge document in PENDING status.
 */
export async function createKnowledgeDocument(
  db: KnowledgeBaseDatabase,
  input: CreateKnowledgeDocumentInput,
): Promise<{ id: string; status: string; charCount: number }> {
  const sanitized = sanitizeText(input.rawContent);
  if (!sanitized.trim()) {
    throw new Error("Document content cannot be empty");
  }

  await assertTenantOperational(createTenantContext(input.tenantId), db);

  const created = await db.knowledgeDocument.create({
    data: {
      tenantId: input.tenantId,
      title: input.title.trim(),
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl ?? null,
      status: "PENDING",
      rawContent: sanitized,
      charCount: sanitized.length,
      tokenCount: 0,
      metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : {},
    },
    select: {
      id: true,
      status: true,
      charCount: true,
    },
  });

  return created;
}

/**
 * Splits document into semantic chunks, generates embeddings, and persists chunks in an atomic transaction.
 */
export async function indexKnowledgeDocument(
  db: KnowledgeBaseDatabase,
  input: IndexKnowledgeDocumentInput,
): Promise<{ documentId: string; status: string; chunksIndexed: number; totalTokens: number }> {
  const document = await db.knowledgeDocument.findFirst({
    where: {
      id: input.documentId,
      tenantId: input.tenantId,
    },
  });

  if (!document) {
    throw new KnowledgeDocumentNotFoundError(input.documentId, input.tenantId);
  }

  await assertTenantOperational(createTenantContext(input.tenantId), db);

  await db.knowledgeDocument.update({
    where: { id: document.id, tenantId: input.tenantId },
    data: { status: "PROCESSING", errorMessage: null },
  });

  const provider = input.embeddingProvider ?? new MockEmbeddingProvider();
  const credentials = input.credentials ?? { apiKey: "mock-key" };

  try {
    const chunks = chunkText(document.rawContent, input.chunkOptions);

    if (chunks.length === 0) {
      await db.knowledgeDocument.update({
        where: { id: document.id, tenantId: input.tenantId },
        data: {
          status: "INDEXED",
          tokenCount: 0,
          errorMessage: null,
          updatedAt: new Date(),
        },
      });
      return {
        documentId: document.id,
        status: "INDEXED",
        chunksIndexed: 0,
        totalTokens: 0,
      };
    }

    const embeddingResponse = await provider.generateEmbeddings(
      {
        input: chunks.map((c) => c.content),
      },
      credentials,
    );

    await db.$transaction(async (tx: Prisma.TransactionClient) => {
      // Remove any prior chunks
      await tx.knowledgeChunk.deleteMany({
        where: {
          documentId: document.id,
          tenantId: input.tenantId,
        },
      });

      // Insert new chunks
      await tx.knowledgeChunk.createMany({
        data: chunks.map((c, idx) => ({
          tenantId: input.tenantId,
          documentId: document.id,
          chunkIndex: c.index,
          content: c.content,
          tokenCount: Math.max(1, Math.ceil(c.content.length / 4)),
          embedding: (embeddingResponse.embeddings[idx] ?? null) as unknown as Prisma.InputJsonValue,
          modelId: embeddingResponse.modelId,
          metadata: {},
        })),
      });

      // Mark document as INDEXED
      await tx.knowledgeDocument.update({
        where: { id: document.id, tenantId: input.tenantId },
        data: {
          status: "INDEXED",
          tokenCount: embeddingResponse.totalTokens,
          errorMessage: null,
          updatedAt: new Date(),
        },
      });
    });

    return {
      documentId: document.id,
      status: "INDEXED",
      chunksIndexed: chunks.length,
      totalTokens: embeddingResponse.totalTokens,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.knowledgeDocument.update({
      where: { id: document.id, tenantId: input.tenantId },
      data: {
        status: "FAILED",
        errorMessage,
        updatedAt: new Date(),
      },
    });
    throw err;
  }
}

/**
 * Returns detail of a knowledge document, optionally including its chunks.
 */
export async function getKnowledgeDocumentDetail(
  db: KnowledgeBaseDatabase,
  input: GetKnowledgeDocumentDetailInput,
): Promise<KnowledgeDocumentDetail | null> {
  const doc = await db.knowledgeDocument.findFirst({
    where: {
      id: input.documentId,
      tenantId: input.tenantId,
    },
    include: {
      _count: { select: { chunks: true } },
      ...(input.includeChunks
        ? {
            chunks: {
              orderBy: { chunkIndex: "asc" as const },
              select: {
                id: true,
                chunkIndex: true,
                content: true,
                tokenCount: true,
                modelId: true,
                createdAt: true,
              },
            },
          }
        : {}),
    },
  });

  if (!doc) {
    return null;
  }

  return {
    id: doc.id,
    tenantId: doc.tenantId,
    title: doc.title,
    sourceType: doc.sourceType,
    sourceUrl: doc.sourceUrl,
    status: doc.status,
    rawContent: doc.rawContent,
    charCount: doc.charCount,
    tokenCount: doc.tokenCount,
    errorMessage: doc.errorMessage,
    metadata: doc.metadata,
    chunksCount: doc._count.chunks,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    chunks: input.includeChunks ? (doc as typeof doc & { chunks: NonNullable<KnowledgeDocumentDetail["chunks"]> }).chunks : undefined,
  };
}

/**
 * Lists knowledge documents for a tenant with pagination and count.
 */
export async function listKnowledgeDocuments(
  db: KnowledgeBaseDatabase,
  input: ListKnowledgeDocumentsInput,
): Promise<{ documents: KnowledgeDocumentSummary[]; total: number }> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);

  const where = {
    tenantId: input.tenantId,
    ...(input.status ? { status: input.status } : {}),
  };

  const [docs, total] = await Promise.all([
    db.knowledgeDocument.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        _count: { select: { chunks: true } },
      },
    }),
    db.knowledgeDocument.count({ where }),
  ]);

  const documents: KnowledgeDocumentSummary[] = docs.map((d: typeof docs[number]) => ({
    id: d.id,
    tenantId: d.tenantId,
    title: d.title,
    sourceType: d.sourceType,
    sourceUrl: d.sourceUrl,
    status: d.status,
    charCount: d.charCount,
    tokenCount: d.tokenCount,
    errorMessage: d.errorMessage,
    metadata: d.metadata,
    chunksCount: d._count.chunks,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));

  return { documents, total };
}

/**
 * Deletes a knowledge document and cascades to its chunks.
 */
export async function deleteKnowledgeDocument(
  db: KnowledgeBaseDatabase,
  input: DeleteKnowledgeDocumentInput,
): Promise<{ deleted: true; documentId: string }> {
  const existing = await db.knowledgeDocument.findFirst({
    where: {
      id: input.documentId,
      tenantId: input.tenantId,
    },
    select: { id: true },
  });

  if (!existing) {
    throw new KnowledgeDocumentNotFoundError(input.documentId, input.tenantId);
  }

  await db.knowledgeDocument.delete({
    where: { id: existing.id },
  });

  return { deleted: true, documentId: existing.id };
}
