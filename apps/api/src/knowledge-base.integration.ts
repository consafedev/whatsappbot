import { generateOpaqueToken, hashOpaqueToken } from "@whatsapp-platform/auth";
import { loadNonSecretConfig } from "@whatsapp-platform/config";
import type { ModuleEntitlementKey } from "@whatsapp-platform/database";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  type PrismaClient,
  syncPermissionCatalog,
} from "@whatsapp-platform/database/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "./app";

const prefix = "e10-s03-kb-api";
const secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl = "";
let tenantAId = "";
let tenantNoEntitlementId = "";
let ownerAId = "";
let ownerNoEntitlementId = "";
let ownerACookie = "";
let ownerNoEntitlementCookie = "";

function binary(value: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

async function session(tenantId: string, userId: string): Promise<string> {
  const token = generateOpaqueToken();
  await prisma.userSession.create({
    data: {
      expiresAt: new Date(Date.now() + 3_600_000),
      tenantId,
      tokenHash: binary(hashOpaqueToken(token)),
      userId,
    },
  });
  return `tenant_session=${token}`;
}

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
    await prisma.aiUsageLog.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.aiKeyPool.deleteMany({
      where: { providerConfig: { tenantId: { in: ids } } },
    });
    await prisma.aiProviderConfig.deleteMany({ where: { tenantId: { in: ids } } });
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
    displayName: `KB API Tenant ${marker}`,
    enabledModules: modules,
    legalName: `KB API Tenant ${marker} SA`,
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

describe.sequential("Knowledge Base API Integration", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient({
      databaseUrl:
        process.env.DATABASE_URL ??
        "postgresql://whatsapp_platform_dev:replace-with-a-local-development-password@localhost:5432/whatsapp_platform_dev",
    });
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);

    const [tenantA, tenantNoEnt] = await Promise.all([
      provision("a", ["module.messaging.basic", "module.ai"]),
      provision("no-ent", ["module.messaging.basic"]),
    ]);

    tenantAId = tenantA.tenantId;
    ownerAId = tenantA.ownerId;
    tenantNoEntitlementId = tenantNoEnt.tenantId;
    ownerNoEntitlementId = tenantNoEnt.ownerId;

    ownerACookie = await session(tenantAId, ownerAId);
    ownerNoEntitlementCookie = await session(tenantNoEntitlementId, ownerNoEntitlementId);

    app = await createApiApplication(loadNonSecretConfig({ NODE_ENV: "test" }), {
      messagingCredentialsKey: secret,
    });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  let createdDocId = "";

  it("POST /api/v1/ai/knowledge/documents creates and indexes a document", async () => {
    const response = await fetch(`${baseUrl}/api/v1/ai/knowledge/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: ownerACookie,
      },
      body: JSON.stringify({
        title: "Guía de Bienvenida",
        sourceType: "markdown",
        rawContent:
          "# Bienvenidos a Nuestra Plataforma\n\nOfrecemos soluciones integrales de automatización de WhatsApp.\n\n" +
          "## Características Principales\n- Enrutamiento inteligente con IA\n- Base de conocimiento para soporte al cliente\n- Reglas deterministas de negocio.",
        chunkOptions: { maxChunkSize: 100, chunkOverlap: 20 },
      }),
    });

    expect(response.status).toBe(201);
    const data = (await response.json()) as {
      id: string;
      title: string;
      status: string;
      charCount: number;
      chunksCount: number;
      totalTokens: number;
    };

    expect(data.id).toBeDefined();
    expect(data.title).toBe("Guía de Bienvenida");
    expect(data.status).toBe("INDEXED");
    expect(data.chunksCount).toBeGreaterThan(1);
    expect(data.totalTokens).toBeGreaterThan(0);

    createdDocId = data.id;
  });

  it("GET /api/v1/ai/knowledge/documents lists documents for active tenant", async () => {
    const response = await fetch(`${baseUrl}/api/v1/ai/knowledge/documents`, {
      method: "GET",
      headers: {
        Cookie: ownerACookie,
      },
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      documents: Array<{ id: string; title: string; chunksCount: number }>;
      total: number;
    };

    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(data.documents.some((d) => d.id === createdDocId)).toBe(true);
  });

  it("GET /api/v1/ai/knowledge/documents/:documentId returns detail and chunk preview", async () => {
    const response = await fetch(`${baseUrl}/api/v1/ai/knowledge/documents/${createdDocId}`, {
      method: "GET",
      headers: {
        Cookie: ownerACookie,
      },
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      id: string;
      title: string;
      status: string;
      chunks: Array<{ chunkIndex: number; content: string; modelId: string }>;
    };

    expect(data.id).toBe(createdDocId);
    expect(data.status).toBe("INDEXED");
    expect(data.chunks.length).toBeGreaterThan(1);
    expect(data.chunks[0]?.modelId).toBe("mock-embed");
  });

  it("POST /api/v1/ai/knowledge/documents/query searches chunks semantically", async () => {
    const response = await fetch(`${baseUrl}/api/v1/ai/knowledge/documents/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: ownerACookie,
      },
      body: JSON.stringify({
        queryText:
          "# Bienvenidos a Nuestra Plataforma\n\nOfrecemos soluciones integrales de automatización de WhatsApp.",
        topK: 3,
        minScore: 0.5,
      }),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      query: string;
      results: Array<{
        documentTitle: string;
        chunkIndex: number;
        content: string;
        score: number;
      }>;
    };

    expect(data.query).toContain("Bienvenidos a Nuestra Plataforma");
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0]?.documentTitle).toBe("Guía de Bienvenida");
    expect(data.results[0]?.score).toBeGreaterThan(0.7);
  });

  it("DELETE /api/v1/ai/knowledge/documents/:documentId deletes document and chunks", async () => {
    const response = await fetch(`${baseUrl}/api/v1/ai/knowledge/documents/${createdDocId}`, {
      method: "DELETE",
      headers: {
        Cookie: ownerACookie,
      },
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as { deleted: boolean; documentId: string };
    expect(data.deleted).toBe(true);
    expect(data.documentId).toBe(createdDocId);

    // Verify 404 on subsequent get
    const getAgain = await fetch(`${baseUrl}/api/v1/ai/knowledge/documents/${createdDocId}`, {
      method: "GET",
      headers: {
        Cookie: ownerACookie,
      },
    });
    expect(getAgain.status).toBe(404);
  });

  it("enforces module.ai entitlement guard (403 when entitlement is missing)", async () => {
    const response = await fetch(`${baseUrl}/api/v1/ai/knowledge/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: ownerNoEntitlementCookie,
      },
      body: JSON.stringify({
        title: "Test Forbidden",
        rawContent: "Debe fallar",
      }),
    });

    expect(response.status).toBe(403);
  });

  it("enforces session authentication guard (401 when unauthenticated)", async () => {
    const response = await fetch(`${baseUrl}/api/v1/ai/knowledge/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Test Unauthenticated",
        rawContent: "Debe fallar",
      }),
    });

    expect(response.status).toBe(401);
  });
});
