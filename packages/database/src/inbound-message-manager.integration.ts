import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/prisma/client";
import { createInboundEventManager, type InboundEventManager } from "./inbound-event-manager";
import {
  createInboundMessageManager,
  InboundMessageEventNotFoundError,
  InboundMessageEventTypeUnsupportedError,
  type InboundMessageManager,
} from "./inbound-message-manager";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  type PlatformTenantModuleKey,
  syncPermissionCatalog,
} from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e06-s03-inbound-message";
let prisma: PrismaClient;
let inboundEvents: InboundEventManager;
let messages: InboundMessageManager;
let tenantAId = "";
let tenantBId = "";
let tenantWithoutCrmId = "";
let channelAId = "";
let channelWithoutCrmId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.message.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.contact.deleteMany({ where: { tenantId: { in: ids } } });
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
    displayName: `Inbound message ${marker}`,
    enabledModules,
    legalName: `Inbound message ${marker} SA`,
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

async function recordEvent(
  tenantId: string,
  channelAccountId: string,
  providerMessageId: string,
  payload: { body: string } = { body: "hola" },
) {
  const result = await inboundEvents.recordInboundEvent(createTenantContext(tenantId), {
    channelAccountId,
    eventType: "MESSAGE_RECEIVED",
    messageType: "text",
    normalizedData: {
      conversationExternalId: `thread-${providerMessageId}`,
      metadata: { source: "test" },
      messageType: "text",
      origin: "customer",
      providerTimestamp: "2026-08-20T12:00:00.000Z",
      textBody: payload.body,
    },
    payload,
    providerMessageId,
    senderPhone: "+5215512345678",
  });
  return result.event.id;
}

describe.sequential("E06-S03 inbound message persistence", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    [tenantAId, tenantBId, tenantWithoutCrmId] = await Promise.all([
      provision("a", ["module.messaging.basic", "module.crm_lite"]),
      provision("b", ["module.messaging.basic", "module.crm_lite"]),
      provision("without-crm", ["module.messaging.basic"]),
    ]);
    const [channelA, channelWithoutCrm] = await Promise.all([
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "Inbound message A",
          providerType: "mock",
          status: "connected",
          tenantId: tenantAId,
        },
      }),
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "Inbound message without CRM",
          providerType: "mock",
          status: "connected",
          tenantId: tenantWithoutCrmId,
        },
      }),
    ]);
    channelAId = channelA.id;
    channelWithoutCrmId = channelWithoutCrm.id;
    inboundEvents = createInboundEventManager(prisma);
    messages = createInboundMessageManager(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma?.$disconnect();
  });

  it("persists the inbound message, updates conversation timestamps and completes the event", async () => {
    const eventId = await recordEvent(tenantAId, channelAId, "message-1", { body: "hola" });
    const result = await messages.persistInboundMessage(createTenantContext(tenantAId), {
      inboundEventId: eventId,
      senderName: "Persona A",
    });

    expect(result).toMatchObject({ duplicate: false });
    expect(result.message).toMatchObject({
      actorType: "contact",
      direction: "inbound",
      messageType: "text",
      origin: "customer",
      providerMessageId: "message-1",
      textBody: "hola",
      tenantId: tenantAId,
    });
    await expect(
      prisma.inboundMessageEvent.findUniqueOrThrow({ where: { id: eventId } }),
    ).resolves.toMatchObject({ processedStatus: "PROCESSED" });
    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: result.conversationId } }),
    ).resolves.toMatchObject({
      lastInboundAt: new Date("2026-08-20T12:00:00.000Z"),
      lastMessageAt: new Date("2026-08-20T12:00:00.000Z"),
      tenantId: tenantAId,
    });
    await expect(
      prisma.domainEventOutbox.findFirstOrThrow({
        where: { aggregateId: result.message.id, eventType: "message.received" },
      }),
    ).resolves.toMatchObject({ aggregateType: "Message", tenantId: tenantAId });
  });

  it("is idempotent under duplicate delivery and concurrent persistence", async () => {
    const eventId = await recordEvent(tenantAId, channelAId, "message-2");
    const results = await Promise.all([
      messages.persistInboundMessage(createTenantContext(tenantAId), { inboundEventId: eventId }),
      messages.persistInboundMessage(createTenantContext(tenantAId), { inboundEventId: eventId }),
    ]);

    expect(results.filter(({ duplicate }) => !duplicate)).toHaveLength(1);
    expect(results.filter(({ duplicate }) => duplicate)).toHaveLength(1);
    await expect(
      prisma.message.count({ where: { inboundEventId: eventId, tenantId: tenantAId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.domainEventOutbox.count({
        where: { aggregateType: "Message", eventType: "message.received", tenantId: tenantAId },
      }),
    ).resolves.toBe(2);
  });

  it("fails closed across tenants and preserves the source event", async () => {
    const eventId = await recordEvent(tenantAId, channelAId, "message-cross-tenant");
    await expect(
      messages.persistInboundMessage(createTenantContext(tenantBId), { inboundEventId: eventId }),
    ).rejects.toBeInstanceOf(InboundMessageEventNotFoundError);
    await expect(
      prisma.inboundMessageEvent.findUniqueOrThrow({ where: { id: eventId } }),
    ).resolves.toMatchObject({ processedStatus: "PENDING", tenantId: tenantAId });
    await expect(prisma.message.count({ where: { inboundEventId: eventId } })).resolves.toBe(0);
  });

  it("requires CRM entitlement and does not partially persist", async () => {
    const eventId = await recordEvent(
      tenantWithoutCrmId,
      channelWithoutCrmId,
      "message-without-crm",
    );
    await expect(
      messages.persistInboundMessage(createTenantContext(tenantWithoutCrmId), {
        inboundEventId: eventId,
      }),
    ).rejects.toMatchObject({ name: "ConversationModuleEntitlementRequiredError" });
    await expect(
      prisma.inboundMessageEvent.findUniqueOrThrow({ where: { id: eventId } }),
    ).resolves.toMatchObject({ processedStatus: "PENDING" });
    await expect(prisma.message.count({ where: { inboundEventId: eventId } })).resolves.toBe(0);
  });

  it("does not turn non-message events into timeline messages", async () => {
    const result = await inboundEvents.recordInboundEvent(createTenantContext(tenantAId), {
      channelAccountId: channelAId,
      eventType: "DELIVERY_RECEIPT",
      payload: { status: "delivered" },
      providerMessageId: "receipt-1",
      recipientPhone: "+5215512345678",
    });
    await expect(
      messages.persistInboundMessage(createTenantContext(tenantAId), {
        inboundEventId: result.event.id,
      }),
    ).rejects.toBeInstanceOf(InboundMessageEventTypeUnsupportedError);
    await expect(
      prisma.message.count({ where: { inboundEventId: result.event.id } }),
    ).resolves.toBe(0);
  });
});
