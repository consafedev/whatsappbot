import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/prisma/client";
import {
  ChannelAccountNotFoundError,
  type ChannelHealthManager,
  createChannelHealthManager,
} from "./index";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e09-s02-health-db";
let prisma: PrismaClient;
let healthManager: ChannelHealthManager;

let tenantAId = "";
let tenantBId = "";
let channelAId = "";
let channelBId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length === 0) return;
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

async function provision(marker: string): Promise<{ tenantId: string }> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Health ${marker}`,
    enabledModules: ["module.messaging.basic"],
    legalName: `Health ${marker} SA`,
    limits: {
      channelAccounts: 2,
      monthlyAiBudget: null,
      organizationUnits: 3,
      storageBytes: 1_073_741_824,
      users: 5,
    },
    owner: {
      displayName: `Owner ${marker}`,
      email: `${prefix}-owner-${marker}@example.invalid`,
      locale: "es-MX",
      passwordHash: "$argon2id$test-hash-not-reversible",
      timezone: "America/Mexico_City",
    },
    requestId: `${prefix}-${marker}`,
    slug: `${prefix}-${marker}`,
  });
  return { tenantId: result.tenant.id };
}

describe.sequential("E09-S02 channel health manager integration", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);

    healthManager = createChannelHealthManager(prisma);

    const [tenantA, tenantB] = await Promise.all([provision("a"), provision("b")]);
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    const [channelA, channelB] = await Promise.all([
      prisma.channelAccount.create({
        data: {
          active: true,
          credentialsCiphertext: "initial-encrypted-session-state",
          credentialsKeyVersion: 1,
          displayName: "WhatsApp Línea A Health",
          providerType: "baileys",
          status: "CONNECTED",
          tenantId: tenantAId,
        },
      }),
      prisma.channelAccount.create({
        data: {
          active: true,
          credentialsCiphertext: "initial-encrypted-session-state",
          credentialsKeyVersion: 1,
          displayName: "WhatsApp Línea B Health",
          providerType: "baileys",
          status: "CONNECTED",
          tenantId: tenantBId,
        },
      }),
    ]);
    channelAId = channelA.id;
    channelBId = channelB.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("records channel heartbeat and latency metrics", async () => {
    const tenantA = createTenantContext(tenantAId);

    const updated = await healthManager.recordChannelHeartbeat(tenantA, channelAId, {
      latencyMs: 125,
      socketStatus: "open",
    });

    expect(updated.healthStatus).toBe("healthy");
    const settings = updated.settings as Record<string, unknown>;
    expect(settings.lastLatencyMs).toBe(125);
    expect(settings.socketStatus).toBe("open");
    expect(settings.lastHeartbeatAt).toBeDefined();
    expect(settings.isDegraded).toBe(false);

    const reloaded = await prisma.channelAccount.findUniqueOrThrow({ where: { id: channelAId } });
    const reloadedSettings = reloaded.settings as Record<string, unknown>;
    expect(reloadedSettings.lastLatencyMs).toBe(125);
    expect(reloadedSettings.socketStatus).toBe("open");
  });

  it("handles transient connection failure: enters CONNECTING with reconnect attempts and outbox event", async () => {
    const tenantA = createTenantContext(tenantAId);

    const updated = await healthManager.handleChannelConnectionFailure(tenantA, channelAId, {
      attemptCount: 2,
      isFatal: false,
      reason: "connectionLost",
      statusCode: 503,
    });

    expect(updated.status).toBe("CONNECTING");
    expect(updated.healthStatus).toBe("degraded");
    const settings = updated.settings as Record<string, unknown>;
    expect(settings.reconnectAttempts).toBe(2);
    expect(settings.reconnectReason).toBe("connectionLost");
    expect(settings.socketStatus).toBe("connecting");

    // Check Outbox event
    const outbox = await prisma.domainEventOutbox.findFirstOrThrow({
      where: {
        aggregateId: channelAId,
        eventType: "channel.reconnecting",
        tenantId: tenantAId,
      },
      orderBy: { occurredAt: "desc" },
    });
    expect(outbox.payload).toMatchObject({
      attemptCount: 2,
      channelAccountId: channelAId,
      reason: "connectionLost",
      statusCode: 503,
      tenantId: tenantAId,
    });
  });

  it("handles fatal connection failure (401 Logged Out): purges credentials, marks DISCONNECTED and writes audit/outbox", async () => {
    const tenantA = createTenantContext(tenantAId);

    const updated = await healthManager.handleChannelConnectionFailure(tenantA, channelAId, {
      isFatal: true,
      reason: "loggedOut",
      statusCode: 401,
    });

    expect(updated.status).toBe("DISCONNECTED");
    expect(updated.credentialsCiphertext).toBeNull();
    expect(updated.credentialsKeyVersion).toBeNull();
    expect(updated.lastDisconnectedAt).not.toBeNull();
    const settings = updated.settings as Record<string, unknown>;
    expect(settings.disconnectReason).toBe("loggedOut");
    expect(settings.socketStatus).toBe("closed");

    // Check AuditLog
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "channel.disconnected",
        entityId: channelAId,
        tenantId: tenantAId,
      },
      orderBy: { occurredAt: "desc" },
    });
    expect(audit.actorType).toBe("system");
    expect((audit.afterSummary as Record<string, unknown>).status).toBe("DISCONNECTED");

    // Check Outbox event
    const outbox = await prisma.domainEventOutbox.findFirstOrThrow({
      where: {
        aggregateId: channelAId,
        eventType: "channel.disconnected",
        tenantId: tenantAId,
      },
      orderBy: { occurredAt: "desc" },
    });
    expect(outbox.payload).toMatchObject({
      channelAccountId: channelAId,
      reason: "loggedOut",
      statusCode: 401,
      tenantId: tenantAId,
    });
  });

  it("detects stale channels with missing or old heartbeats and marks them degraded", async () => {
    const tenantB = createTenantContext(tenantBId);

    // 1. Channel B is connected but has an old heartbeat timestamp (> 90 seconds ago)
    const oldHeartbeat = new Date(Date.now() - 120_000).toISOString();
    await prisma.channelAccount.update({
      data: {
        settings: {
          lastHeartbeatAt: oldHeartbeat,
          metadata: { lastHeartbeatAt: oldHeartbeat },
        },
        status: "CONNECTED",
      },
      where: { id: channelBId },
    });

    const degraded = await healthManager.checkStaleChannels(tenantB, 90);
    expect(degraded).toContain(channelBId);

    const reloaded = await prisma.channelAccount.findUniqueOrThrow({ where: { id: channelBId } });
    expect(reloaded.healthStatus).toBe("degraded");
    expect((reloaded.settings as Record<string, unknown>).isDegraded).toBe(true);
  });

  it("enforces strict multi-tenant A/B isolation", async () => {
    const tenantA = createTenantContext(tenantAId);

    // Tenant A cannot record heartbeat for Tenant B channel
    await expect(
      healthManager.recordChannelHeartbeat(tenantA, channelBId, {
        socketStatus: "open",
      }),
    ).rejects.toThrow(ChannelAccountNotFoundError);

    // Tenant A cannot handle failure for Tenant B channel
    await expect(
      healthManager.handleChannelConnectionFailure(tenantA, channelBId, {
        isFatal: true,
        reason: "cross_tenant",
      }),
    ).rejects.toThrow(ChannelAccountNotFoundError);
  });
});
