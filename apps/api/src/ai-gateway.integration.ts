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

const prefix = "e10-s01-ai-api";
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
  if (ids.length === 0) return;
  await prisma.aiUsageLog.deleteMany({ where: { tenantId: { in: ids } } });
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
    displayName: `AI API Tenant ${marker}`,
    enabledModules: modules,
    legalName: `AI API Tenant ${marker} SA`,
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

describe.sequential("AI Gateway API Integration", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient({
      databaseUrl: process.env.DATABASE_URL ?? "postgresql://whatsapp_platform_dev:replace-with-a-local-development-password@localhost:5432/whatsapp_platform_dev",
    });
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);

    const [tenantA, tenantNoEnt] = await Promise.all([
      provision("a", ["module.messaging.basic", "module.ai"]),
      provision("no-ent", ["module.messaging.basic"]), // missing module.ai
    ]);

    tenantAId = tenantA.tenantId;
    ownerAId = tenantA.ownerId;
    tenantNoEntitlementId = tenantNoEnt.tenantId;
    ownerNoEntitlementId = tenantNoEnt.ownerId;

    ownerACookie = await session(tenantAId, ownerAId);
    ownerNoEntitlementCookie = await session(tenantNoEntitlementId, ownerNoEntitlementId);

    app = await createApiApplication(loadNonSecretConfig({ NODE_ENV: "test" }));
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

  it("POST /api/v1/ai/completions/test returns 200 with test completion response", async () => {
    const response = await fetch(`${baseUrl}/api/v1/ai/completions/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: ownerACookie,
      },
      body: JSON.stringify({
        prompt: "Hola desde test de API",
        providerType: "mock",
      }),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      content: string;
      providerType: string;
      usage: { totalTokens: number };
    };
    expect(data.content).toContain("Hola desde test de API");
    expect(data.providerType).toBe("mock");
    expect(data.usage.totalTokens).toBeGreaterThan(0);
  });

  it("GET /api/v1/ai/models/discover returns available models for mock provider", async () => {
    const response = await fetch(`${baseUrl}/api/v1/ai/models/discover?providerType=mock&apiKey=mock-key`, {
      method: "GET",
      headers: {
        Cookie: ownerACookie,
      },
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as { models: string[] };
    expect(Array.isArray(data.models)).toBe(true);
    expect(data.models).toContain("mock-gpt-4o");
  });

  it("GET /api/v1/ai/usage/summary returns tenant token usage ledger", async () => {
    const response = await fetch(`${baseUrl}/api/v1/ai/usage/summary`, {
      method: "GET",
      headers: {
        Cookie: ownerACookie,
      },
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      tenantId: string;
      totalRequests: number;
      totalTokens: number;
    };
    expect(data.tenantId).toBe(tenantAId);
    expect(data.totalRequests).toBeGreaterThanOrEqual(1);
    expect(data.totalTokens).toBeGreaterThanOrEqual(1);
  });

  it("enforces module.ai entitlement guard (403 when entitlement is missing)", async () => {
    const response = await fetch(`${baseUrl}/api/v1/ai/completions/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: ownerNoEntitlementCookie,
      },
      body: JSON.stringify({
        prompt: "Debe fallar por falta de entitlement",
      }),
    });

    expect(response.status).toBe(403);
  });

  it("enforces session authentication guard (401 when unauthenticated)", async () => {
    const response = await fetch(`${baseUrl}/api/v1/ai/completions/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Debe fallar por falta de sesion",
      }),
    });

    expect(response.status).toBe(401);
  });
});
