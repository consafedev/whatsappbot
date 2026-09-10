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

const prefix = "e12-s01-analytics-api";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl = "";
let tenantAId = "";
let tenantNoReportsId = "";
let ownerAId = "";
let ownerACookie = "";
let ownerNoReportsCookie = "";
let viewerACookie = "";
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
    await prisma.aiUsageLog.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.message.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.inboundMessageEvent.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.outboundMessage.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { tenantId: { in: ids } } });
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
  modules: readonly ModuleEntitlementKey[] = ["module.messaging.basic", "module.reports"],
): Promise<{ ownerId: string; rootId: string; tenantId: string }> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "USD",
    defaultLocale: "en-US",
    defaultTimezone: "UTC",
    deploymentId: null,
    displayName: `Analytics API Tenant ${marker}`,
    enabledModules: modules,
    legalName: `Analytics API Tenant ${marker} SA`,
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

describe.sequential("Analytics API Integration", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient({
      databaseUrl:
        process.env.DATABASE_URL ??
        "postgresql://whatsapp_platform_dev:replace-with-a-local-development-password@localhost:5432/whatsapp_platform_dev",
    });
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);

    const tenantA = await provision("a", ["module.messaging.basic", "module.reports"]);
    tenantAId = tenantA.tenantId;
    ownerAId = tenantA.ownerId;
    ownerACookie = await session(tenantAId, ownerAId);

    const tenantNoReports = await provision("no-rep", ["module.messaging.basic"]);
    tenantNoReportsId = tenantNoReports.tenantId;
    ownerNoReportsCookie = await session(tenantNoReportsId, tenantNoReports.ownerId);

    // Create a viewer user in Tenant A who does NOT have reports.read permission
    const viewerUser = await prisma.user.create({
      data: {
        displayName: "Viewer Without Reports",
        email: `${prefix}-viewer-${Date.now()}@example.invalid`,
        locale: "es-MX",
        passwordHash: "$argon2id$test-hash-not-reversible",
        tenantId: tenantAId,
        timezone: "UTC",
      },
    });

    // Create a role for viewer without reports.read
    const limitedRole = await prisma.role.create({
      data: {
        description: "Role without reports.read",
        key: "limited_role",
        name: "Limited Role",
        tenantId: tenantAId,
      },
    });
    await prisma.userRole.create({
      data: {
        roleId: limitedRole.id,
        tenantId: tenantAId,
        userId: viewerUser.id,
      },
    });
    viewerACookie = await session(tenantAId, viewerUser.id);

    // Setup a channel and message fixture in Tenant A
    const channelA = await prisma.channelAccount.create({
      data: {
        channelType: "whatsapp",
        displayName: "Channel API A",
        phoneNumber: "+5215500009991",
        providerType: "baileys",
        status: "connected",
        tenantId: tenantAId,
      },
    });
    channelAccountAId = channelA.id;

    const contactA = await prisma.contact.create({
      data: {
        name: "Contact API A",
        phoneNumber: "+5215511119991",
        tenantId: tenantAId,
      },
    });

    const now = new Date();
    await prisma.conversation.create({
      data: {
        channelAccountId: channelAccountAId,
        contactId: contactA.id,
        createdAt: now,
        lastMessageAt: now,
        status: "open",
        tenantId: tenantAId,
        updatedAt: now,
      },
    });

    await prisma.inboundMessageEvent.create({
      data: {
        channelAccountId: channelAccountAId,
        createdAt: now,
        eventType: "MESSAGE_RECEIVED",
        payload: { text: "hello api" },
        tenantId: tenantAId,
      },
    });

    await prisma.outboundMessage.create({
      data: {
        channelAccountId: channelAccountAId,
        content: { text: "out api" },
        createdAt: now,
        idempotencyKey: "idem-api-1",
        recipientPhone: "+5215511119991",
        status: "DELIVERED",
        tenantId: tenantAId,
      },
    });

    await prisma.aiUsageLog.create({
      data: {
        channelAccountId: channelAccountAId,
        completionTokens: 80,
        costEstimatedUsd: 0.0015,
        createdAt: now,
        modelId: "gpt-4o-mini",
        promptTokens: 120,
        providerType: "openai",
        purpose: "auto-response",
        status: "success",
        tenantId: tenantAId,
        totalTokens: 200,
      },
    });

    const config = loadNonSecretConfig();
    app = await createApiApplication(config);
    await app.listen(0);
    const address = app.getHttpServer().address();
    if (typeof address === "object" && address !== null) {
      baseUrl = `http://127.0.0.1:${address.port}`;
    }
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await cleanup();
    await prisma.$disconnect();
  });

  it("GET /api/v1/analytics/overview returns 200 with standard envelope and aggregated metrics", async () => {
    const res = await fetch(`${baseUrl}/api/v1/analytics/overview`, {
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
        from: string;
        to: string;
        inboundMessagesCount: number;
        outboundMessagesCount: number;
        activeConversationsCount: number;
        closedConversationsCount: number;
        aiTokenUsage: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
          estimatedCostUsd: number;
        };
        deliverySuccessRate: number;
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.tenantId).toBe(tenantAId);
    expect(body.data.inboundMessagesCount).toBeGreaterThanOrEqual(1);
    expect(body.data.outboundMessagesCount).toBeGreaterThanOrEqual(1);
    expect(body.data.activeConversationsCount).toBeGreaterThanOrEqual(1);
    expect(body.data.deliverySuccessRate).toBe(100);
    expect(body.data.aiTokenUsage.totalTokens).toBeGreaterThanOrEqual(200);
    expect(body.data.aiTokenUsage.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("GET /api/v1/analytics/time-series returns 200 with temporal buckets for 'day' and 'hour'", async () => {
    const from = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();

    const resDaily = await fetch(
      `${baseUrl}/api/v1/analytics/time-series?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&interval=day`,
      {
        headers: {
          cookie: ownerACookie,
          "x-tenant-id": tenantAId,
        },
      },
    );

    expect(resDaily.status).toBe(200);
    const bodyDaily = (await resDaily.json()) as {
      success: boolean;
      data: Array<{
        timestamp: string;
        inbound: number;
        outbound: number;
        total: number;
      }>;
    };

    expect(bodyDaily.success).toBe(true);
    expect(Array.isArray(bodyDaily.data)).toBe(true);
    expect(bodyDaily.data.length).toBeGreaterThanOrEqual(2);
    expect(typeof bodyDaily.data[0]?.timestamp).toBe("string");
    expect(typeof bodyDaily.data[0]?.inbound).toBe("number");
    expect(typeof bodyDaily.data[0]?.outbound).toBe("number");
    expect(typeof bodyDaily.data[0]?.total).toBe("number");

    // Test hour interval
    const hourFrom = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const resHourly = await fetch(
      `${baseUrl}/api/v1/analytics/time-series?from=${encodeURIComponent(hourFrom)}&to=${encodeURIComponent(to)}&interval=hour`,
      {
        headers: {
          cookie: ownerACookie,
          "x-tenant-id": tenantAId,
        },
      },
    );

    expect(resHourly.status).toBe(200);
    const bodyHourly = (await resHourly.json()) as {
      success: boolean;
      data: Array<{
        timestamp: string;
        inbound: number;
        outbound: number;
        total: number;
      }>;
    };
    expect(bodyHourly.success).toBe(true);
    expect(bodyHourly.data.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects with 403 Forbidden when tenant lacks module.reports entitlement", async () => {
    const res = await fetch(`${baseUrl}/api/v1/analytics/overview`, {
      headers: {
        cookie: ownerNoReportsCookie,
        "x-tenant-id": tenantNoReportsId,
      },
    });

    expect(res.status).toBe(403);
  });

  it("rejects with 403 Forbidden when user lacks reports.read permission", async () => {
    const res = await fetch(`${baseUrl}/api/v1/analytics/overview`, {
      headers: {
        cookie: viewerACookie,
        "x-tenant-id": tenantAId,
      },
    });

    expect(res.status).toBe(403);
  });

  it("rejects with 400 Bad Request when from > to or dates are invalid", async () => {
    const from = new Date("2026-09-10T00:00:00.000Z").toISOString();
    const to = new Date("2026-09-01T00:00:00.000Z").toISOString();

    const resInverted = await fetch(
      `${baseUrl}/api/v1/analytics/overview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      {
        headers: {
          cookie: ownerACookie,
          "x-tenant-id": tenantAId,
        },
      },
    );

    expect(resInverted.status).toBe(400);

    const resInvalidDate = await fetch(`${baseUrl}/api/v1/analytics/overview?from=not-a-date`, {
      headers: {
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
    });

    expect(resInvalidDate.status).toBe(400);

    const resInvalidInterval = await fetch(
      `${baseUrl}/api/v1/analytics/time-series?interval=century`,
      {
        headers: {
          cookie: ownerACookie,
          "x-tenant-id": tenantAId,
        },
      },
    );

    expect(resInvalidInterval.status).toBe(400);
  });
});
