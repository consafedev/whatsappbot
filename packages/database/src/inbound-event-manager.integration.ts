import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/prisma/client";
import {
  createInboundEventManager,
  InboundChannelInactiveError,
  InboundChannelNotFoundError,
  type InboundEventManager,
  InboundTenantNotOperationalError,
} from "./inbound-event-manager";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  type PlatformTenantModuleKey,
  syncPermissionCatalog,
} from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e05-s02-inbound-db";
const tenantAContext = () => createTenantContext(tenantAId);
let prisma: PrismaClient;
let manager: InboundEventManager;
let tenantAId = "";
let tenantBId = "";
let tenantWithoutMessagingId = "";
let channelAId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.inboundMessageEvent.deleteMany({ where: { tenantId: { in: ids } } });
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

async function provision(
  marker: string,
  enabledModules: readonly PlatformTenantModuleKey[],
): Promise<string> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Inbound ${marker}`,
    enabledModules,
    legalName: `Inbound ${marker} SA`,
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
  return result.tenant.id;
}

describe.sequential("E05-S02 inbound event manager", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    [tenantAId, tenantBId, tenantWithoutMessagingId] = await Promise.all([
      provision("a", ["module.messaging.basic"]),
      provision("b", ["module.messaging.basic"]),
      provision("disabled", []),
    ]);
    const channel = await prisma.channelAccount.create({
      data: {
        active: true,
        displayName: "Inbound A",
        providerType: "mock",
        status: "connected",
        tenantId: tenantAId,
      },
    });
    channelAId = channel.id;
    manager = createInboundEventManager(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma?.$disconnect();
  });

  it("persists one event and its outbox notification atomically", async () => {
    const result = await manager.recordInboundEvent(tenantAContext(), {
      channelAccountId: channelAId,
      eventType: "MESSAGE_RECEIVED",
      messageType: "text",
      normalizedData: { messageType: "text", textBody: "hola" },
      payload: { from: "+5215512345678", id: "mock-1", text: "hola" },
      providerMessageId: "mock-1",
      senderPhone: "+5215512345678",
    });

    expect(result).toMatchObject({ duplicate: false, status: "PENDING" });
    expect(result.event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/i);
    await expect(
      prisma.inboundMessageEvent.findUniqueOrThrow({ where: { id: result.event.id } }),
    ).resolves.toMatchObject({
      channelAccountId: channelAId,
      eventType: "MESSAGE_RECEIVED",
      processedStatus: "PENDING",
      providerMessageId: "mock-1",
      tenantId: tenantAId,
    });
    await expect(
      prisma.domainEventOutbox.findMany({
        where: { aggregateId: result.event.id, eventType: "messaging.inbound.event_received" },
      }),
    ).resolves.toHaveLength(1);
  });

  it("deduplicates the same provider message without a second row or outbox event", async () => {
    const duplicate = await manager.recordInboundEvent(tenantAContext(), {
      channelAccountId: channelAId,
      eventType: "MESSAGE_RECEIVED",
      messageType: "text",
      normalizedData: { messageType: "text", textBody: "reintento" },
      payload: { id: "mock-1", text: "reintento" },
      providerMessageId: "mock-1",
    });

    expect(duplicate).toMatchObject({ duplicate: true, status: "DUPLICATE" });
    await expect(
      prisma.inboundMessageEvent.count({
        where: { channelAccountId: channelAId, providerMessageId: "mock-1" },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.domainEventOutbox.count({
        where: {
          eventType: "messaging.inbound.event_received",
          aggregateType: "InboundMessageEvent",
        },
      }),
    ).resolves.toBe(1);

    const raceInput = {
      channelAccountId: channelAId,
      eventType: "MESSAGE_RECEIVED",
      payload: { id: "race-1", text: "concurrencia" },
      providerMessageId: "race-1",
    } as const;
    const [raceA, raceB] = await Promise.all([
      manager.recordInboundEvent(tenantAContext(), raceInput),
      manager.recordInboundEvent(tenantAContext(), raceInput),
    ]);
    expect([raceA.status, raceB.status].sort()).toEqual(["DUPLICATE", "PENDING"]);
    await expect(
      prisma.inboundMessageEvent.count({
        where: { channelAccountId: channelAId, providerMessageId: "race-1" },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.domainEventOutbox.count({
        where: {
          eventType: "messaging.inbound.event_received",
          aggregateType: "InboundMessageEvent",
        },
      }),
    ).resolves.toBe(2);
  });

  it("fails closed for cross-tenant channels, inactive channels, and missing entitlements", async () => {
    expect(
      await manager.findById(
        createTenantContext(tenantBId),
        "019c0000-0000-7000-8000-000000000099",
      ),
    ).toBeNull();
    await expect(
      manager.recordInboundEvent(createTenantContext(tenantBId), {
        channelAccountId: channelAId,
        eventType: "MESSAGE_RECEIVED",
        payload: { id: "cross-tenant" },
      }),
    ).rejects.toBeInstanceOf(InboundChannelNotFoundError);

    await prisma.channelAccount.update({ where: { id: channelAId }, data: { active: false } });
    await expect(
      manager.recordInboundEvent(tenantAContext(), {
        channelAccountId: channelAId,
        eventType: "MESSAGE_RECEIVED",
        payload: { id: "inactive" },
      }),
    ).rejects.toBeInstanceOf(InboundChannelInactiveError);
    await prisma.channelAccount.update({ where: { id: channelAId }, data: { active: true } });

    const disabledChannel = await prisma.channelAccount.create({
      data: {
        active: true,
        displayName: "Inbound disabled",
        providerType: "mock",
        status: "connected",
        tenantId: tenantWithoutMessagingId,
      },
    });
    await expect(
      manager.recordInboundEvent(createTenantContext(tenantWithoutMessagingId), {
        channelAccountId: disabledChannel.id,
        eventType: "MESSAGE_RECEIVED",
        payload: { id: "not-entitled" },
      }),
    ).rejects.toThrow("Messaging module entitlement is required");

    await prisma.tenant.update({ where: { id: tenantAId }, data: { status: "suspended" } });
    await expect(
      manager.recordInboundEvent(tenantAContext(), {
        channelAccountId: channelAId,
        eventType: "MESSAGE_RECEIVED",
        payload: { id: "suspended" },
      }),
    ).rejects.toBeInstanceOf(InboundTenantNotOperationalError);
    await prisma.tenant.update({ where: { id: tenantAId }, data: { status: "active" } });
  });
});
