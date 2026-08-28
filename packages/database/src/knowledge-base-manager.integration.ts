import {
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  getKnowledgeDocumentDetail,
  indexKnowledgeDocument,
  listKnowledgeDocuments,
  KnowledgeDocumentNotFoundError,
  type ModuleEntitlementKey,
} from "./index";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  type PrismaClient,
  syncPermissionCatalog,
} from "./platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const prefix = "e10-s03-kb-test";
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length > 0) {
    await prisma.knowledgeChunk.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.knowledgeDocument.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.aiModelRoute.deleteMany({
      where: { virtualAlias: { tenantId: { in: ids } } },
    });
    await prisma.aiVirtualAlias.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.aiKeyPool.deleteMany({
      where: { providerConfig: { tenantId: { in: ids } } },
    });
    await prisma.aiProviderConfig.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.userSession.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.userPasswordResetToken.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.userRole.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: ids } } } });
    await prisma.role.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  }
}

async function provision(
  marker: string,
  modules: readonly ModuleEntitlementKey[] = ["module.messaging.basic", "module.ai"],
): Promise<{ ownerId: string; rootId: string; tenantId: string }> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "USD",
    defaultLocale: "en-US",
    defaultTimezone: "UTC",
    deploymentId: null,
    displayName: `KB Tenant ${marker}`,
    enabledModules: modules,
    legalName: `KB Tenant ${marker} SA`,
    limits: {
      channelAccounts: 5,
      monthlyAiBudget: null,
      organizationUnits: 5,
      storageBytes: 1_073_741_824,
      users: 5,
    },
    owner: {
      displayName: `Owner ${marker}`,
      email: `${prefix}-owner-${marker}@example.invalid`,
      locale: "en-US",
      passwordHash: "$argon2id$test-hash-not-reversible",
      timezone: "UTC",
    },
    requestId: `${prefix}-${marker}`,
    slug: `${prefix}-${marker}`,
  });
  return {
    ownerId: result.owner.id,
    rootId: result.organizationRoot.id,
    tenantId: result.tenant.id,
  };
}

describe.sequential("Knowledge Base Manager Database Integration", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient({
      databaseUrl:
        process.env.DATABASE_URL ??
        "postgresql://whatsapp_platform_dev:replace-with-a-local-development-password@localhost:5432/whatsapp_platform_dev",
    });
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);

    const [tA, tB] = await Promise.all([provision("a"), provision("b")]);
    tenantAId = tA.tenantId;
    tenantBId = tB.tenantId;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("creates a knowledge document in PENDING status", async () => {
    const rawContent = "Preguntas Frecuentes sobre envíos.\nLos envíos tardan 24 a 48 horas en llegar a domicilio.";
    const created = await createKnowledgeDocument(prisma, {
      tenantId: tenantAId,
      title: "FAQ Envíos",
      sourceType: "faq",
      rawContent,
    });

    expect(created.id).toBeDefined();
    expect(created.status).toBe("PENDING");
    expect(created.charCount).toBe(rawContent.length);

    const detail = await getKnowledgeDocumentDetail(prisma, {
      tenantId: tenantAId,
      documentId: created.id,
    });

    expect(detail).not.toBeNull();
    expect(detail?.title).toBe("FAQ Envíos");
    expect(detail?.status).toBe("PENDING");
    expect(detail?.chunksCount).toBe(0);
  });

  it("indexes a document by splitting chunks and generating embeddings", async () => {
    const doc1 = await createKnowledgeDocument(prisma, {
      tenantId: tenantAId,
      title: "Manual de Políticas",
      sourceType: "text",
      rawContent:
        "Sección 1: Devoluciones.\nSe aceptan devoluciones dentro de los 30 días posteriores a la compra con ticket.\n\n" +
        "Sección 2: Garantía extendida.\nCubre defectos de fábrica por 12 meses en todos los componentes electrónicos.\n\n" +
        "Sección 3: Horarios de atención.\nLunes a viernes de 9am a 6pm mediante nuestro canal de WhatsApp.",
    });

    const indexResult = await indexKnowledgeDocument(prisma, {
      tenantId: tenantAId,
      documentId: doc1.id,
      chunkOptions: { maxChunkSize: 100, chunkOverlap: 20 },
    });

    expect(indexResult.status).toBe("INDEXED");
    expect(indexResult.chunksIndexed).toBeGreaterThan(1);
    expect(indexResult.totalTokens).toBeGreaterThan(0);

    const detail = await getKnowledgeDocumentDetail(prisma, {
      tenantId: tenantAId,
      documentId: doc1.id,
      includeChunks: true,
    });

    expect(detail?.status).toBe("INDEXED");
    expect(detail?.chunksCount).toBe(indexResult.chunksIndexed);
    expect(detail?.chunks).toHaveLength(indexResult.chunksIndexed);
    expect(detail?.chunks?.[0]?.content).toBeDefined();
    expect(detail?.chunks?.[0]?.modelId).toBe("mock-embed");
  });

  it("lists documents with pagination and chunk counters", async () => {
    const list = await listKnowledgeDocuments(prisma, {
      tenantId: tenantAId,
      limit: 10,
    });

    expect(list.total).toBeGreaterThanOrEqual(2);
    expect(list.documents.length).toBeGreaterThanOrEqual(2);
    expect(list.documents[0]?.chunksCount).toBeDefined();
  });

  it("deletes document and cascades deletion of associated chunks", async () => {
    const doc = await createKnowledgeDocument(prisma, {
      tenantId: tenantAId,
      title: "Documento Temporal",
      sourceType: "text",
      rawContent: "Contenido para borrar y verificar cascada de fragmentos vectoriales.",
    });

    await indexKnowledgeDocument(prisma, {
      tenantId: tenantAId,
      documentId: doc.id,
    });

    // Check chunks exist in DB
    const chunksBefore = await prisma.knowledgeChunk.count({
      where: { tenantId: tenantAId, documentId: doc.id },
    });
    expect(chunksBefore).toBeGreaterThan(0);

    const deleteRes = await deleteKnowledgeDocument(prisma, {
      tenantId: tenantAId,
      documentId: doc.id,
    });
    expect(deleteRes.deleted).toBe(true);

    const detailAfter = await getKnowledgeDocumentDetail(prisma, {
      tenantId: tenantAId,
      documentId: doc.id,
    });
    expect(detailAfter).toBeNull();

    const chunksAfter = await prisma.knowledgeChunk.count({
      where: { tenantId: tenantAId, documentId: doc.id },
    });
    expect(chunksAfter).toBe(0);
  });

  it("strictly isolates knowledge documents between Tenant A and Tenant B", async () => {
    const docA = await createKnowledgeDocument(prisma, {
      tenantId: tenantAId,
      title: "Documento Confidencial Tenant A",
      sourceType: "markdown",
      rawContent: "# Datos Privados Tenant A",
    });

    // Tenant B cannot retrieve Tenant A document
    const detailFromB = await getKnowledgeDocumentDetail(prisma, {
      tenantId: tenantBId,
      documentId: docA.id,
    });
    expect(detailFromB).toBeNull();

    // Tenant B cannot index Tenant A document
    await expect(
      indexKnowledgeDocument(prisma, {
        tenantId: tenantBId,
        documentId: docA.id,
      }),
    ).rejects.toThrow(KnowledgeDocumentNotFoundError);

    // Tenant B cannot delete Tenant A document
    await expect(
      deleteKnowledgeDocument(prisma, {
        tenantId: tenantBId,
        documentId: docA.id,
      }),
    ).rejects.toThrow(KnowledgeDocumentNotFoundError);

    // Tenant B listing does not contain Tenant A docs
    const listB = await listKnowledgeDocuments(prisma, {
      tenantId: tenantBId,
    });
    expect(listB.documents.some((d) => d.id === docA.id)).toBe(false);
  });
});
