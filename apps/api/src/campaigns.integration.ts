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

const prefix = "e11-s01-camp-api";
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
let channelAccountAId = "";

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
    await prisma.outboundMessage.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.campaignAudienceMember.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.campaign.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.messageTemplate.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.contact.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.channelAccount.deleteMany({ where: { tenantId: { in: ids } } });
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
  modules: readonly ModuleEntitlementKey[] = ["module.messaging.basic", "module.campaigns"],
): Promise<{ ownerId: string; rootId: string; tenantId: string }> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "USD",
    defaultLocale: "en-US",
    defaultTimezone: "UTC",
    deploymentId: null,
    displayName: `Campaign Tenant ${marker}`,
    enabledModules: modules,
    legalName: `Campaign Tenant ${marker} SA`,
    limits: {
      channelAccounts: 5,
      monthlyAiBudget: null,
      organizationUnits: 5,
      storageBytes: 1_073_741_824,
      users: 5,
    },
    owner: {
      displayName: `Owner ${marker}`,
      email: `${prefix}-owner-${marker}-${Date.now()}@example.invalid`,
      locale: "en-US",
      passwordHash: "$argon2id$test-hash-not-reversible",
      timezone: "UTC",
    },
    requestId: `${prefix}-${marker}-${Date.now()}`,
    slug: `${prefix}-${marker}-${Date.now()}`,
  });
  return {
    ownerId: result.owner.id,
    rootId: result.organizationRoot.id,
    tenantId: result.tenant.id,
  };
}

describe.sequential("Campaigns API Integration", () => {
  let createdTemplateId = "";
  let createdCampaignId = "";

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

    // Create channel account for Tenant A
    const channelA = await prisma.channelAccount.create({
      data: {
        tenantId: tenantAId,
        displayName: "WhatsApp Ventas",
        providerType: "mock",
        channelType: "whatsapp",
        status: "connected",
        phoneNumber: "+5215599990001",
        phoneNumberUniqueKey: `+5215599990001:${tenantAId}`,
      },
    });
    channelAccountAId = channelA.id;

    // Create contacts for Tenant A
    await prisma.contact.create({
      data: {
        tenantId: tenantAId,
        name: "Valeria VIP",
        phoneNumber: "+5215588880001",
        tags: ["promos", "vip"],
      },
    });
    await prisma.contact.create({
      data: {
        tenantId: tenantAId,
        name: "Oscar Regular",
        phoneNumber: "+5215588880002",
        tags: ["general"],
      },
    });

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

  it("POST /api/v1/campaigns/templates creates a message template with extracted variables", async () => {
    const res = await fetch(`${baseUrl}/api/v1/campaigns/templates`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
      body: JSON.stringify({
        name: "Plantilla Bienvenida",
        category: "MARKETING",
        content: "Hola {{nombre}}, bienvenido a nuestro club {{club}}.",
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string; variables: string[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
    expect(body.data.variables).toEqual(["nombre", "club"]);
    createdTemplateId = body.data.id;
  });

  it("GET /api/v1/campaigns/templates lists message templates for tenant", async () => {
    const res = await fetch(`${baseUrl}/api/v1/campaigns/templates`, {
      headers: {
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: Array<{ id: string; name: string }>;
    };
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data.some((t) => t.id === createdTemplateId)).toBe(true);
  });

  it("POST /api/v1/campaigns creates a new campaign", async () => {
    const res = await fetch(`${baseUrl}/api/v1/campaigns`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
      body: JSON.stringify({
        channelAccountId: channelAccountAId,
        templateId: createdTemplateId,
        name: "Lanzamiento Club",
        rateLimitPerMinute: 45,
        audienceFilter: { tags: ["vip"] },
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string; name: string; status: string; rateLimitPerMinute: number };
    };
    expect(body.success).toBe(true);
    expect(body.data.name).toBe("Lanzamiento Club");
    expect(body.data.status).toBe("DRAFT");
    expect(body.data.rateLimitPerMinute).toBe(45);
    createdCampaignId = body.data.id;
  });

  it("POST /api/v1/campaigns/:id/audience/populate populates audience by tags", async () => {
    const res = await fetch(`${baseUrl}/api/v1/campaigns/${createdCampaignId}/audience/populate`, {
      method: "POST",
      headers: {
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { totalAdded: number; totalRecipients: number };
    };
    expect(body.success).toBe(true);
    expect(body.data.totalAdded).toBe(1);
    expect(body.data.totalRecipients).toBe(1);
  });

  it("GET /api/v1/campaigns lists campaigns with pagination", async () => {
    const res = await fetch(`${baseUrl}/api/v1/campaigns`, {
      headers: {
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { campaigns: Array<{ id: string }>; total: number };
    };
    expect(body.success).toBe(true);
    expect(body.data.total).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/v1/campaigns/:id returns full campaign detail", async () => {
    const res = await fetch(`${baseUrl}/api/v1/campaigns/${createdCampaignId}`, {
      headers: {
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        id: string;
        name: string;
        totalRecipients: number;
        _count: { audienceMembers: number };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(createdCampaignId);
    expect(body.data.totalRecipients).toBe(1);
    expect(body.data._count.audienceMembers).toBe(1);
  });

  it("POST /api/v1/campaigns/:id/start starts the campaign", async () => {
    const res = await fetch(`${baseUrl}/api/v1/campaigns/${createdCampaignId}/start`, {
      method: "POST",
      headers: {
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string; status: string; startedAt: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("RUNNING");
    expect(body.data.startedAt).toBeDefined();
  });

  it("POST /api/v1/campaigns/:id/pause pauses a running campaign", async () => {
    const res = await fetch(`${baseUrl}/api/v1/campaigns/${createdCampaignId}/pause`, {
      method: "POST",
      headers: {
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { id: string; status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("PAUSED");
  });

  it("POST /api/v1/campaigns/:id/start resumes a paused campaign", async () => {
    const res = await fetch(`${baseUrl}/api/v1/campaigns/${createdCampaignId}/start`, {
      method: "POST",
      headers: {
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { id: string; status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("RUNNING");
  });

  it("POST /api/v1/campaigns/:id/dispatch-batch dispatches pending members to outbox", async () => {
    const res = await fetch(`${baseUrl}/api/v1/campaigns/${createdCampaignId}/dispatch-batch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
      body: JSON.stringify({ batchSize: 5 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { processedCount: number; remainingPending: number; isCompleted: boolean };
    };
    expect(body.success).toBe(true);
    expect(body.data.processedCount).toBe(1);
    expect(body.data.remainingPending).toBe(0);
    expect(body.data.isCompleted).toBe(true);

    // Verify campaign is completed
    const detailRes = await fetch(`${baseUrl}/api/v1/campaigns/${createdCampaignId}`, {
      headers: {
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
    });
    const detail = (await detailRes.json()) as {
      success: boolean;
      data: { status: string; sentCount: number };
    };
    expect(detail.data.status).toBe("COMPLETED");
    expect(detail.data.sentCount).toBe(1);
  });

  it("POST /api/v1/campaigns/:id/cancel cancels an existing draft campaign", async () => {
    // Create a new draft campaign to cancel
    const newCampRes = await fetch(`${baseUrl}/api/v1/campaigns`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
      body: JSON.stringify({
        channelAccountId: channelAccountAId,
        templateId: createdTemplateId,
        name: "Campaña a Cancelar",
      }),
    });
    const newCamp = (await newCampRes.json()) as { success: boolean; data: { id: string } };

    const cancelRes = await fetch(`${baseUrl}/api/v1/campaigns/${newCamp.data.id}/cancel`, {
      method: "POST",
      headers: {
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
    });

    expect(cancelRes.status).toBe(200);
    const cancelBody = (await cancelRes.json()) as { success: boolean; data: { status: string } };
    expect(cancelBody.data.status).toBe("CANCELLED");
  });

  it("enforces entitlement guard: tenant without module.campaigns is rejected with 403", async () => {
    const res = await fetch(`${baseUrl}/api/v1/campaigns`, {
      headers: {
        cookie: ownerNoEntitlementCookie,
        "x-tenant-id": tenantNoEntitlementId,
      },
    });

    expect(res.status).toBe(403);
  });

  it("enforces tenant isolation: Tenant B cannot access or operate on Tenant A's campaign", async () => {
    // GET -> 404
    const resGet = await fetch(`${baseUrl}/api/v1/campaigns/${createdCampaignId}`, {
      headers: {
        cookie: ownerBCookie,
        "x-tenant-id": tenantBId,
      },
    });
    expect(resGet.status).toBe(404);

    // POST start -> 404
    const resStart = await fetch(`${baseUrl}/api/v1/campaigns/${createdCampaignId}/start`, {
      method: "POST",
      headers: {
        cookie: ownerBCookie,
        "x-tenant-id": tenantBId,
      },
    });
    expect(resStart.status).toBe(404);

    // POST dispatch-batch -> 404
    const resDispatch = await fetch(
      `${baseUrl}/api/v1/campaigns/${createdCampaignId}/dispatch-batch`,
      {
        method: "POST",
        headers: {
          cookie: ownerBCookie,
          "x-tenant-id": tenantBId,
        },
      },
    );
    expect(resDispatch.status).toBe(404);
  });
});
