import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import {
  createInboundEventDispatcher,
  type InboundEventDispatcher,
} from "./inbound-event-dispatcher";
import { createInboundEventManager, type InboundEventManager } from "./inbound-event-manager";
import {
  createOutboundConversationMessageManager,
  type OutboundConversationMessageManager,
} from "./outbound-conversation-message-manager";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e06-s05-outbound-echo";
let prisma: PrismaClient;
let inboundEvents: InboundEventManager;
let dispatcher: InboundEventDispatcher;
let outboundMessages: OutboundConversationMessageManager;
let tenantAId = "";
let tenantBId = "";
let ownerAId = "";
let channelAId = "";
let conversationAId = "";
let contactAId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length === 0) return;
  await prisma.message.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.outboundMessage.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.inboundMessageEvent.deleteMany({ where: { tenantId: { in: ids } } });
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

async function provision(marker: string): Promise<{ ownerId: string; tenantId: string }> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Outbound echo ${marker}`,
    enabledModules: ["module.messaging.basic", "module.crm_lite"],
    legalName: `Outbound echo ${marker} SA`,
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
  return { ownerId: result.owner.id, tenantId: result.tenant.id };
}

async function recordMessageEvent(
  tenantId: string,
  providerMessageId: string,
  normalizedData: Prisma.InputJsonObject,
  senderPhone = "+5215587654321",
  recipientPhone = "+5215512345678",
): Promise<string> {
  const result = await inboundEvents.recordInboundEvent(createTenantContext(tenantId), {
    channelAccountId: channelAId,
    eventType: "MESSAGE_RECEIVED",
    messageType: "text",
    normalizedData,
    payload: { body: String(normalizedData.textBody ?? "echo") },
    providerMessageId,
    recipientPhone,
    senderPhone,
  });
  return result.event.id;
}

describe.sequential("E06-S05 outbound echo reconciliation", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    const [tenantA, tenantB] = await Promise.all([provision("a"), provision("b")]);
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;
    ownerAId = tenantA.ownerId;

    const channel = await prisma.channelAccount.create({
      data: {
        active: true,
        displayName: "Outbound echo A",
        providerType: "mock",
        status: "connected",
        tenantId: tenantAId,
      },
    });
    channelAId = channel.id;
    const contact = await prisma.contact.create({
      data: { name: "Contacto echo A", phoneNumber: "+5215512345678", tenantId: tenantAId },
    });
    contactAId = contact.id;
    const conversation = await prisma.conversation.create({
      data: {
        channelAccountId: channelAId,
        contactId: contactAId,
        status: "open",
        tenantId: tenantAId,
      },
    });
    conversationAId = conversation.id;
    inboundEvents = createInboundEventManager(prisma);
    dispatcher = createInboundEventDispatcher(prisma);
    outboundMessages = createOutboundConversationMessageManager(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma?.$disconnect();
  });

  it("correlates a provider echo to the queued canonical message without changing delivery state", async () => {
    const queued = await outboundMessages.sendConversationMessage(
      createTenantContext(tenantAId),
      conversationAId,
      {
        actorUserId: ownerAId,
        content: { text: "mensaje que regresó como echo" },
        idempotencyKey: "e06-s05-known-echo",
        messageType: "text",
      },
    );
    await prisma.outboundMessage.update({
      data: { providerMessageId: "provider-echo-1" },
      where: { id: queued.outboundMessage.id },
    });
    const eventId = await recordMessageEvent(tenantAId, "provider-echo-1", {
      fromMe: true,
      origin: "human_external_device",
      providerTimestamp: "2026-08-20T12:30:00.000Z",
      textBody: "mensaje que regresó como echo",
    });

    const result = await dispatcher.dispatch(createTenantContext(tenantAId), {
      inboundEventId: eventId,
    });

    expect(result).toMatchObject({
      kind: "echo",
      result: {
        duplicate: false,
        message: {
          deliveryStatus: "queued",
          direction: "outbound",
          id: queued.message.id,
          providerMessageId: "provider-echo-1",
          providerTimestamp: new Date("2026-08-20T12:30:00.000Z"),
          tenantId: tenantAId,
        },
      },
    });
    await expect(
      prisma.message.count({
        where: { channelAccountId: channelAId, providerMessageId: "provider-echo-1" },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.inboundMessageEvent.findUniqueOrThrow({ where: { id: eventId } }),
    ).resolves.toMatchObject({ processedStatus: "PROCESSED", tenantId: tenantAId });
    await expect(
      prisma.domainEventOutbox.count({
        where: { aggregateId: queued.message.id, eventType: "message.echo_reconciled" },
      }),
    ).resolves.toBe(1);
  });

  it("is idempotent when the already processed echo is retried", async () => {
    const event = await prisma.inboundMessageEvent.findFirstOrThrow({
      where: { providerMessageId: "provider-echo-1", tenantId: tenantAId },
    });
    const result = await dispatcher.dispatch(createTenantContext(tenantAId), {
      inboundEventId: event.id,
    });

    expect(result).toMatchObject({ kind: "echo", result: { duplicate: true } });
    await expect(
      prisma.domainEventOutbox.count({
        where: { eventType: "message.echo_reconciled", tenantId: tenantAId },
      }),
    ).resolves.toBe(1);
  });

  it("persists an unmatched fromMe echo as an external human message", async () => {
    const eventId = await recordMessageEvent(tenantAId, "provider-unknown-1", {
      fromMe: true,
      origin: "human_external_device",
      providerTimestamp: "2026-08-20T12:31:00.000Z",
      textBody: "escrito directamente en el teléfono",
    });

    const result = await dispatcher.dispatch(createTenantContext(tenantAId), {
      inboundEventId: eventId,
    });
    expect(result).toMatchObject({
      kind: "external_human",
      result: {
        duplicate: false,
        message: {
          actorId: null,
          actorType: "external_human_unknown",
          deliveryStatus: "sent",
          direction: "outbound",
          origin: "human_external_device",
          providerMessageId: "provider-unknown-1",
          tenantId: tenantAId,
        },
      },
    });
    await expect(
      prisma.inboundMessageEvent.findUniqueOrThrow({ where: { id: eventId } }),
    ).resolves.toMatchObject({ processedStatus: "PROCESSED" });
    await expect(
      prisma.message.count({
        where: { providerMessageId: "provider-unknown-1", tenantId: tenantAId },
      }),
    ).resolves.toBe(1);
    await expect(
      dispatcher.dispatch(createTenantContext(tenantAId), { inboundEventId: eventId }),
    ).resolves.toMatchObject({ kind: "external_human", result: { duplicate: true } });
    await expect(
      prisma.domainEventOutbox.count({
        where: { eventType: "message.external_human_detected", tenantId: tenantAId },
      }),
    ).resolves.toBe(1);
  });

  it("fails closed for cross-tenant dispatch without mutating the source event", async () => {
    const eventId = await recordMessageEvent(tenantAId, "provider-cross-tenant-1", {
      fromMe: true,
      origin: "human_external_device",
      providerTimestamp: "2026-08-20T12:32:00.000Z",
      textBody: "no debe cruzar tenant",
    });

    await expect(
      dispatcher.dispatch(createTenantContext(tenantBId), { inboundEventId: eventId }),
    ).rejects.toThrow("Inbound event was not found");
    await expect(
      prisma.inboundMessageEvent.findUniqueOrThrow({ where: { id: eventId } }),
    ).resolves.toMatchObject({ processedStatus: "PENDING", tenantId: tenantAId });
  });

  it("keeps regular inbound persistence and routes delivery receipts to E06-S07", async () => {
    const inboundEventId = await recordMessageEvent(
      tenantAId,
      "provider-inbound-1",
      {
        origin: "customer",
        providerTimestamp: "2026-08-20T12:33:00.000Z",
        textBody: "mensaje inbound",
      },
      "+5215599999999",
    );
    const inbound = await dispatcher.dispatch(createTenantContext(tenantAId), {
      inboundEventId,
    });
    expect(inbound).toMatchObject({ kind: "inbound", result: { duplicate: false } });

    const receipt = await inboundEvents.recordInboundEvent(createTenantContext(tenantAId), {
      channelAccountId: channelAId,
      eventType: "DELIVERY_RECEIPT",
      normalizedData: {
        providerMessageId: "provider-echo-1",
        statusUpdate: {
          providerMessageId: "provider-echo-1",
          status: "delivered",
          timestamp: "2026-08-20T12:33:01.000Z",
        },
      },
      payload: { status: "delivered" },
      providerMessageId: "provider-echo-1-receipt",
      recipientPhone: "+5215512345678",
    });
    await expect(
      dispatcher.dispatch(createTenantContext(tenantAId), { inboundEventId: receipt.event.id }),
    ).resolves.toMatchObject({
      kind: "delivery_status",
      result: { deliveryStatus: "delivered", duplicate: false },
    });
    await expect(
      prisma.inboundMessageEvent.findUniqueOrThrow({ where: { id: receipt.event.id } }),
    ).resolves.toMatchObject({ processedStatus: "PROCESSED" });
  });
});
