import { MockEmbeddingProvider } from "@whatsapp-platform/ai-gateway";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createKnowledgeDocument,
  indexKnowledgeDocument,
  type ModuleEntitlementKey,
  searchKnowledgeChunks,
} from "./index";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  type PrismaClient,
  syncPermissionCatalog,
} from "./platform";

const prefix = "e10-s04-kb-search";
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";
const embeddingProvider = new MockEmbeddingProvider();

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
      where: {
        virtualAlias: {
          tenantId: { in: ids },
        },
      },
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
    displayName: `KB Search Tenant ${marker}`,
    enabledModules: modules,
    legalName: `KB Search Tenant ${marker} SA`,
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

describe.sequential("Knowledge Search Manager Database Integration", () => {
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

    // Ingest and index document in Tenant A
    const docA = await createKnowledgeDocument(prisma, {
      tenantId: tenantAId,
      title: "Política de Devoluciones y Garantías",
      sourceType: "markdown",
      rawContent:
        "Toda devolución tiene un plazo de 30 días hábiles.\n\n" +
        "Los productos con garantía extendida cubren hasta 24 meses de defectos de fábrica.",
    });

    await indexKnowledgeDocument(prisma, {
      tenantId: tenantAId,
      documentId: docA.id,
      embeddingProvider,
      chunkOptions: { maxChunkSize: 100, chunkOverlap: 20 },
    });

    // Ingest and index document in Tenant B
    const docB = await createKnowledgeDocument(prisma, {
      tenantId: tenantBId,
      title: "Catálogo de Precios Tenant B",
      sourceType: "markdown",
      rawContent:
        "El precio por unidad es de $50 USD. Descuentos por volumen superiores a 100 unidades.",
    });

    await indexKnowledgeDocument(prisma, {
      tenantId: tenantBId,
      documentId: docB.id,
      embeddingProvider,
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("retrieves and ranks relevant chunks for Tenant A query", async () => {
    const queryText = "Toda devolución tiene un plazo de 30 días hábiles.";
    const queryEmbedRes = await embeddingProvider.generateEmbeddings(
      { input: queryText },
      { apiKey: "mock-key" },
    );
    const queryEmbedding = queryEmbedRes.embeddings[0] ?? [];

    const citations = await searchKnowledgeChunks(prisma, {
      tenantId: tenantAId,
      queryEmbedding,
      topK: 2,
      minScore: 0.5,
    });

    expect(citations.length).toBeGreaterThan(0);
    expect(citations[0]?.documentTitle).toBe("Política de Devoluciones y Garantías");
    expect(citations[0]?.score).toBeGreaterThan(0.7);
    expect(citations[0]?.content).toContain("devolución");
  });

  it("strictly isolates knowledge base search between tenants (A/B isolation)", async () => {
    // Tenant B executes query looking for Tenant A's return policies
    const queryText = "Toda devolución tiene un plazo de 30 días hábiles.";
    const queryEmbedRes = await embeddingProvider.generateEmbeddings(
      { input: queryText },
      { apiKey: "mock-key" },
    );
    const queryEmbedding = queryEmbedRes.embeddings[0] ?? [];

    const citationsForB = await searchKnowledgeChunks(prisma, {
      tenantId: tenantBId,
      queryEmbedding,
      topK: 5,
      minScore: 0.1, // Even with a very low threshold, Tenant B has no return policy docs
    });

    // None of Tenant A's documents should be returned
    expect(citationsForB.some((c) => c.documentTitle.includes("Devoluciones"))).toBe(false);
  });
});
