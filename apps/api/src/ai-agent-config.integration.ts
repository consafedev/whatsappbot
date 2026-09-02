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

const prefix = "e10-s05-agent-cfg-api";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl = "";
let tenantAId = "";
let tenantBId = "";
let tenantNoEntitlementId = "";
let ownerAId = "";
let ownerBId = "";
let ownerNoEntitlementId = "";
let ownerACookie = "";
let ownerBCookie = "";
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
    await prisma.tenantAiAgentConfig.deleteMany({
      where: { tenantId: { in: ids } },
    });
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
  modules: readonly ModuleEntitlementKey[] = [
    "module.messaging.basic",
    "module.crm_lite",
    "module.ai",
  ],
): Promise<{ ownerId: string; rootId: string; tenantId: string }> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "USD",
    defaultLocale: "en-US",
    defaultTimezone: "UTC",
    deploymentId: null,
    displayName: `AI Agent Cfg ${marker}`,
    enabledModules: modules,
    legalName: `AI Agent Cfg ${marker} SA`,
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

describe.sequential("AI Agent Config API Integration", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient({
      databaseUrl:
        process.env.DATABASE_URL ??
        "postgresql://whatsapp_platform_dev:replace-with-a-local-development-password@localhost:5432/whatsapp_platform_dev",
    });
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);

    const [tA, tB, tNo] = await Promise.all([
      provision("a"),
      provision("b"),
      provision("no-ent", ["module.messaging.basic"]),
    ]);

    tenantAId = tA.tenantId;
    ownerAId = tA.ownerId;
    tenantBId = tB.tenantId;
    ownerBId = tB.ownerId;
    tenantNoEntitlementId = tNo.tenantId;
    ownerNoEntitlementId = tNo.ownerId;

    ownerACookie = await session(tenantAId, ownerAId);
    ownerBCookie = await session(tenantBId, ownerBId);
    ownerNoEntitlementCookie = await session(tenantNoEntitlementId, ownerNoEntitlementId);

    const config = loadNonSecretConfig({ NODE_ENV: "test" });
    app = await createApiApplication(config);
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

  it("GET /api/v1/ai/agent/config returns default agent configuration for tenant A", async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/agent/config`, {
      headers: {
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        tenantId: string;
        automationMode: string;
        isEnabled: boolean;
        minConfidenceScore: number;
        virtualAliasKey: string;
        humanHandoffKeywords: string[];
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.tenantId).toBe(tenantAId);
    expect(body.data.automationMode).toBe("HYBRID_RULES_AI");
    expect(body.data.isEnabled).toBe(false);
    expect(body.data.minConfidenceScore).toBe(0.7);
    expect(body.data.virtualAliasKey).toBe("platform-smart");
    expect(body.data.humanHandoffKeywords).toContain("humano");
  });

  it("PUT /api/v1/ai/agent/config updates tenant A configuration", async () => {
    const updatePayload = {
      isEnabled: true,
      automationMode: "FULL_AI",
      systemDirectives: "Directivas personalizadas para el agente de soporte.",
      virtualAliasKey: "platform-smart",
      minConfidenceScore: 0.85,
      humanHandoffKeywords: ["humano", "asesor", "persona", "ayuda", "urgente"],
      outOfHoursReply: "Estamos fuera de horario laboral.",
    };

    const res = await fetch(`${baseUrl}/api/v1/ai/agent/config`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
      body: JSON.stringify(updatePayload),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        isEnabled: boolean;
        automationMode: string;
        systemDirectives: string | null;
        minConfidenceScore: number;
        humanHandoffKeywords: string[];
        outOfHoursReply: string | null;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.isEnabled).toBe(true);
    expect(body.data.automationMode).toBe("FULL_AI");
    expect(body.data.systemDirectives).toBe("Directivas personalizadas para el agente de soporte.");
    expect(body.data.minConfidenceScore).toBe(0.85);
    expect(body.data.humanHandoffKeywords).toContain("urgente");
    expect(body.data.outOfHoursReply).toBe("Estamos fuera de horario laboral.");
  });

  it("strictly isolates configuration between tenants (Tenant B sees its own config)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/agent/config`, {
      headers: {
        cookie: ownerBCookie,
        "x-tenant-id": tenantBId,
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        tenantId: string;
        automationMode: string;
        isEnabled: boolean;
        systemDirectives: string | null;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.tenantId).toBe(tenantBId);
    // Tenant B must still have default config (not Tenant A's updated FULL_AI)
    expect(body.data.automationMode).toBe("HYBRID_RULES_AI");
    expect(body.data.isEnabled).toBe(false);
    expect(body.data.systemDirectives).toBeNull();
  });

  it("rejects request with 403 when tenant lacks module.ai entitlement", async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/agent/config`, {
      headers: {
        cookie: ownerNoEntitlementCookie,
        "x-tenant-id": tenantNoEntitlementId,
      },
    });

    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated request with 401 Unauthorized", async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/agent/config`, {
      headers: {
        "x-tenant-id": tenantAId,
      },
    });

    expect(res.status).toBe(401);
  });
});
