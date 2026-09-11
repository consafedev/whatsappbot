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
import type { SystemHealthData } from "./system-observability.service";

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
let readerOnlyCookie = "";
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
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      "postgresql://whatsapp_platform_dev:replace-with-a-local-development-password@localhost:5432/whatsapp_platform_dev";
    prisma = createPlatformDatabaseClient({
      databaseUrl: process.env.DATABASE_URL,
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

    // Create a role with reports.read only (lacks reports.export)
    const readOnlyRole = await prisma.role.create({
      data: {
        description: "Role with reports.read only",
        key: `reports_reader_${Date.now()}`,
        name: "Reports Reader",
        tenantId: tenantAId,
      },
    });
    const reportsReadPerm = await prisma.permission.findUniqueOrThrow({
      where: { key: "reports.read" },
    });
    await prisma.rolePermission.create({
      data: {
        permissionId: reportsReadPerm.id,
        roleId: readOnlyRole.id,
      },
    });
    const readerUser = await prisma.user.create({
      data: {
        displayName: "Reader Without Export",
        email: `${prefix}-reader-${Date.now()}@example.invalid`,
        locale: "es-MX",
        passwordHash: "$argon2id$test-hash-not-reversible",
        tenantId: tenantAId,
        timezone: "UTC",
      },
    });
    await prisma.userRole.create({
      data: {
        roleId: readOnlyRole.id,
        tenantId: tenantAId,
        userId: readerUser.id,
      },
    });
    readerOnlyCookie = await session(tenantAId, readerUser.id);

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

  it("exports operational overview CSV with 200 OK and text/csv headers", async () => {
    const res = await fetch(`${baseUrl}/api/v1/analytics/export/csv`, {
      headers: {
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("reporte-overview-");

    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
    const text = buf.toString("utf-8");
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text).toContain("Reporte Operativo de Mensajería");
    expect(text).toContain("Mensajes Entrantes");
    expect(text).toContain("Costo Estimado IA (USD)");
  });

  it("exports time series CSV with 200 OK and time series headers", async () => {
    const res = await fetch(`${baseUrl}/api/v1/analytics/export/csv?type=time-series`, {
      headers: {
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("reporte-time-series-");

    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
    const text = buf.toString("utf-8");
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text).toContain("Fecha/Hora,Mensajes Entrantes,Mensajes Salientes,Volumen Total");
  });

  it("rejects export with 403 Forbidden when user has reports.read but lacks reports.export", async () => {
    // Sanity check: user CAN read overview
    const readRes = await fetch(`${baseUrl}/api/v1/analytics/overview`, {
      headers: {
        cookie: readerOnlyCookie,
        "x-tenant-id": tenantAId,
      },
    });
    expect(readRes.status).toBe(200);

    // But CANNOT export
    const exportRes = await fetch(`${baseUrl}/api/v1/analytics/export/csv`, {
      headers: {
        cookie: readerOnlyCookie,
        "x-tenant-id": tenantAId,
      },
    });
    expect(exportRes.status).toBe(403);
  });

  it("rejects export with 400 Bad Request when date range is inverted", async () => {
    const from = new Date("2026-09-10T00:00:00.000Z").toISOString();
    const to = new Date("2026-09-01T00:00:00.000Z").toISOString();

    const res = await fetch(
      `${baseUrl}/api/v1/analytics/export/csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      {
        headers: {
          cookie: ownerACookie,
          "x-tenant-id": tenantAId,
        },
      },
    );

    expect(res.status).toBe(400);
  });

  describe("GET /api/v1/analytics/system-health", () => {
    it("returns 200 OK with system telemetry and outbox metrics", async () => {
      // Seed a pending outbound message for tenantA
      await prisma.outboundMessage.create({
        data: {
          channelAccountId: channelAccountAId,
          content: { text: "Health pending test" },
          idempotencyKey: `health-pending-${Date.now()}`,
          messageType: "text",
          recipientPhone: "+5215555550099",
          status: "PENDING",
          tenantId: tenantAId,
        },
      });

      const res = await fetch(`${baseUrl}/api/v1/analytics/system-health`, {
        headers: {
          cookie: ownerACookie,
          "x-tenant-id": tenantAId,
        },
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { success: boolean; data: SystemHealthData };
      expect(json.success).toBe(true);
      expect(json.data).toHaveProperty("status");
      expect(["healthy", "degraded", "unhealthy"]).toContain(json.data.status);
      expect(json.data).toHaveProperty("timestamp");
      expect(typeof json.data.databaseLatencyMs).toBe("number");
      expect(json.data.databaseLatencyMs).toBeGreaterThanOrEqual(1);
      expect(typeof json.data.redisLatencyMs).toBe("number");
      expect(json.data.outboxMetrics).toBeDefined();
      expect(json.data.outboxMetrics.pendingCount).toBeGreaterThanOrEqual(1);
      expect(typeof json.data.outboxMetrics.failedCount).toBe("number");
      expect(typeof json.data.outboxMetrics.averageTransitSeconds).toBe("number");
      expect(json.data.workerStatus).toBeDefined();
      expect(json.data.workerStatus.whatsappWorker).toBeDefined();
      expect(json.data.workerStatus.jobsWorker).toBeDefined();
    });

    it("rejects without authentication cookie with 401", async () => {
      const res = await fetch(`${baseUrl}/api/v1/analytics/system-health`, {
        headers: {
          "x-tenant-id": tenantAId,
        },
      });
      expect(res.status).toBe(401);
    });

    it("rejects with 403 when tenant lacks module.reports", async () => {
      const res = await fetch(`${baseUrl}/api/v1/analytics/system-health`, {
        headers: {
          cookie: ownerNoReportsCookie,
          "x-tenant-id": tenantNoReportsId,
        },
      });
      expect(res.status).toBe(403);
    });

    it("rejects with 403 when user lacks reports.read", async () => {
      const res = await fetch(`${baseUrl}/api/v1/analytics/system-health`, {
        headers: {
          cookie: viewerACookie,
          "x-tenant-id": tenantAId,
        },
      });
      expect(res.status).toBe(403);
    });
  });
});
