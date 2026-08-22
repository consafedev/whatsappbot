import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDeliveryStatusManager,
  type DeliveryStatusManager,
  DeliveryStatusMessageNotFoundError,
} from "./delivery-status-manager";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
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

const prefix = "e06-s07-delivery-status";
let prisma: PrismaClient;
let inboundEvents: InboundEventManager;
let deliveryStatuses: DeliveryStatusManager;
let outboundMessages: OutboundConversationMessageManager;
let tenantAId = "";
let tenantBId = "";
let ownerAId = "";
let channelAId = "";
let channelBId = "";
let conversationAId = "";

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
    displayName: `Delivery status ${marker}`,
    enabledModules: ["module.messaging.basic", "module.crm_lite"],
    legalName: `Delivery status ${marker} SA`,
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

async function recordReceipt(
  tenantId: string,
  channelAccountId: string,
  eventProviderId: string,
  providerMessageId: string,
  status: "sent" | "delivered" | "read" | "failed",
  timestamp: Date,
  errors: Readonly<{ errorCode?: string; errorMessage?: string }> = {},
): Promise<string> {
  const statusUpdate: Prisma.InputJsonObject = {
    ...(errors.errorCode === undefined ? {} : { errorCode: errors.errorCode }),
    ...(errors.errorMessage === undefined ? {} : { errorMessage: errors.errorMessage }),
    providerMessageId,
    status,
    timestamp: timestamp.toISOString(),
  };
  const result = await inboundEvents.recordInboundEvent(createTenantContext(tenantId), {
    channelAccountId,
    eventType: "DELIVERY_RECEIPT",
    normalizedData: { providerMessageId, statusUpdate },
    payload: { providerMessageId, status, timestamp: timestamp.toISOString() },
    providerMessageId: eventProviderId,
  });
  return result.event.id;
}

async function queueMessage(providerMessageId: string, key: string) {
  const queued = await outboundMessages.sendConversationMessage(
    createTenantContext(tenantAId),
    conversationAId,
    {
      actorUserId: ownerAId,
      content: { text: `mensaje ${key}` },
      idempotencyKey: key,
      messageType: "text",
    },
  );
  await prisma.outboundMessage.update({
    data: { providerMessageId },
    where: { id: queued.outboundMessage.id },
  });
  return queued;
}

describe.sequential("E06-S07 delivery status reconciliation", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    const [tenantA, tenantB] = await Promise.all([provision("a"), provision("b")]);
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;
    ownerAId = tenantA.ownerId;
    const [channelA, channelB] = await Promise.all([
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "Delivery status A",
          providerType: "mock",
          status: "connected",
          tenantId: tenantAId,
        },
      }),
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "Delivery status B",
          providerType: "mock",
          status: "connected",
          tenantId: tenantBId,
        },
      }),
    ]);
    channelAId = channelA.id;
    channelBId = channelB.id;
    const contact = await prisma.contact.create({
      data: {
        name: "Contacto delivery status",
        phoneNumber: "+5215512345678",
        tenantId: tenantAId,
      },
    });
    const conversation = await prisma.conversation.create({
      data: {
        channelAccountId: channelAId,
        contactId: contact.id,
        status: "open",
        tenantId: tenantAId,
      },
    });
    conversationAId = conversation.id;
    inboundEvents = createInboundEventManager(prisma);
    deliveryStatuses = createDeliveryStatusManager(prisma);
    outboundMessages = createOutboundConversationMessageManager(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma?.$disconnect();
  });

  it("applies queued -> sent -> delivered -> read monotonically", async () => {
    const queued = await queueMessage("provider-delivery-flow-1", "e06-s07-flow-1");
    const sentAt = new Date("2026-08-21T12:00:01.000Z");
    const deliveredAt = new Date("2026-08-21T12:00:02.000Z");
    const readAt = new Date("2026-08-21T12:00:03.000Z");
    for (const [eventKey, status, timestamp] of [
      ["delivery-flow-sent", "sent", sentAt],
      ["delivery-flow-delivered", "delivered", deliveredAt],
      ["delivery-flow-read", "read", readAt],
    ] as const) {
      await deliveryStatuses.reconcileDeliveryStatus(createTenantContext(tenantAId), {
        channelAccountId: channelAId,
        inboundEventId: await recordReceipt(
          tenantAId,
          channelAId,
          eventKey,
          "provider-delivery-flow-1",
          status,
          timestamp,
        ),
        providerMessageId: "provider-delivery-flow-1",
        statusUpdate: { status, timestamp },
      });
    }

    await expect(
      prisma.message.findUniqueOrThrow({ where: { id: queued.message.id } }),
    ).resolves.toMatchObject({ deliveryStatus: "read", tenantId: tenantAId });
    await expect(
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: queued.outboundMessage.id } }),
    ).resolves.toMatchObject({ sentAt, status: "SENT", tenantId: tenantAId });
  });

  it("processes an out-of-order delivered receipt after read without regressing the Message", async () => {
    const queued = await queueMessage("provider-delivery-order-1", "e06-s07-order-1");
    const readEventId = await recordReceipt(
      tenantAId,
      channelAId,
      "delivery-order-read",
      "provider-delivery-order-1",
      "read",
      new Date("2026-08-21T12:01:03.000Z"),
    );
    await deliveryStatuses.reconcileDeliveryStatus(createTenantContext(tenantAId), {
      channelAccountId: channelAId,
      inboundEventId: readEventId,
      providerMessageId: "provider-delivery-order-1",
      statusUpdate: { status: "read", timestamp: new Date("2026-08-21T12:01:03.000Z") },
    });
    const deliveredEventId = await recordReceipt(
      tenantAId,
      channelAId,
      "delivery-order-delivered",
      "provider-delivery-order-1",
      "delivered",
      new Date("2026-08-21T12:01:02.000Z"),
    );
    const result = await deliveryStatuses.reconcileDeliveryStatus(createTenantContext(tenantAId), {
      channelAccountId: channelAId,
      inboundEventId: deliveredEventId,
      providerMessageId: "provider-delivery-order-1",
      statusUpdate: { status: "delivered", timestamp: new Date("2026-08-21T12:01:02.000Z") },
    });

    expect(result).toMatchObject({ duplicate: false, deliveryStatus: "read" });
    await expect(
      prisma.message.findUniqueOrThrow({ where: { id: queued.message.id } }),
    ).resolves.toMatchObject({ deliveryStatus: "read" });
    await expect(
      prisma.inboundMessageEvent.findUniqueOrThrow({ where: { id: deliveredEventId } }),
    ).resolves.toMatchObject({ processedStatus: "PROCESSED" });
  });

  it("records provider failure details and transitions the linked queue row", async () => {
    const queued = await queueMessage("provider-delivery-failed-1", "e06-s07-failed-1");
    const timestamp = new Date("2026-08-21T12:02:01.000Z");
    const eventId = await recordReceipt(
      tenantAId,
      channelAId,
      "delivery-failed-1",
      "provider-delivery-failed-1",
      "failed",
      timestamp,
      { errorCode: "  PROVIDER_42\n" },
    );
    await deliveryStatuses.reconcileDeliveryStatus(createTenantContext(tenantAId), {
      channelAccountId: channelAId,
      inboundEventId: eventId,
      providerMessageId: "provider-delivery-failed-1",
      statusUpdate: { errorCode: "  PROVIDER_42\n", status: "failed", timestamp },
    });

    await expect(
      prisma.message.findUniqueOrThrow({ where: { id: queued.message.id } }),
    ).resolves.toMatchObject({ deliveryStatus: "failed" });
    await expect(
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: queued.outboundMessage.id } }),
    ).resolves.toMatchObject({ failedAt: timestamp, lastError: "PROVIDER_42", status: "FAILED" });
  });

  it("ignores a late failed receipt after delivered and read", async () => {
    for (const [providerMessageId, key, priorStatus] of [
      ["provider-delivery-late-delivered", "e06-s07-late-delivered", "delivered"],
      ["provider-delivery-late-read", "e06-s07-late-read", "read"],
    ] as const) {
      const queued = await queueMessage(providerMessageId, key);
      const priorAt = new Date("2026-08-21T12:03:01.000Z");
      const priorEventId = await recordReceipt(
        tenantAId,
        channelAId,
        `${key}-prior`,
        providerMessageId,
        priorStatus,
        priorAt,
      );
      await deliveryStatuses.reconcileDeliveryStatus(createTenantContext(tenantAId), {
        channelAccountId: channelAId,
        inboundEventId: priorEventId,
        providerMessageId,
        statusUpdate: { status: priorStatus, timestamp: priorAt },
      });
      const failedEventId = await recordReceipt(
        tenantAId,
        channelAId,
        `${key}-failed`,
        providerMessageId,
        "failed",
        new Date("2026-08-21T12:03:02.000Z"),
        { errorMessage: "late failure" },
      );
      await deliveryStatuses.reconcileDeliveryStatus(createTenantContext(tenantAId), {
        channelAccountId: channelAId,
        inboundEventId: failedEventId,
        providerMessageId,
        statusUpdate: { status: "failed", timestamp: new Date("2026-08-21T12:03:02.000Z") },
      });
      await expect(
        prisma.message.findUniqueOrThrow({ where: { id: queued.message.id } }),
      ).resolves.toMatchObject({ deliveryStatus: priorStatus });
    }
  });

  it("fails closed across tenants and leaves an uncorrelated receipt pending", async () => {
    const queued = await queueMessage("provider-delivery-isolation-1", "e06-s07-isolation-1");
    const eventId = await recordReceipt(
      tenantBId,
      channelBId,
      "delivery-isolation-1",
      "provider-delivery-isolation-1",
      "delivered",
      new Date("2026-08-21T12:04:01.000Z"),
    );
    await expect(
      deliveryStatuses.reconcileDeliveryStatus(createTenantContext(tenantBId), {
        channelAccountId: channelBId,
        inboundEventId: eventId,
        providerMessageId: "provider-delivery-isolation-1",
        statusUpdate: { status: "delivered", timestamp: new Date("2026-08-21T12:04:01.000Z") },
      }),
    ).rejects.toBeInstanceOf(DeliveryStatusMessageNotFoundError);
    await expect(
      prisma.inboundMessageEvent.findUniqueOrThrow({ where: { id: eventId } }),
    ).resolves.toMatchObject({ processedStatus: "PENDING", tenantId: tenantBId });
    await expect(
      prisma.message.findUniqueOrThrow({ where: { id: queued.message.id } }),
    ).resolves.toMatchObject({ deliveryStatus: "queued", tenantId: tenantAId });
  });

  it("is idempotent and emits one delivery-status Outbox event per receipt", async () => {
    const queued = await queueMessage("provider-delivery-duplicate-1", "e06-s07-duplicate-1");
    const eventId = await recordReceipt(
      tenantAId,
      channelAId,
      "delivery-duplicate-1",
      "provider-delivery-duplicate-1",
      "sent",
      new Date("2026-08-21T12:05:01.000Z"),
    );
    const input = {
      channelAccountId: channelAId,
      inboundEventId: eventId,
      providerMessageId: "provider-delivery-duplicate-1",
      statusUpdate: { status: "sent" as const, timestamp: new Date("2026-08-21T12:05:01.000Z") },
    };
    await deliveryStatuses.reconcileDeliveryStatus(createTenantContext(tenantAId), input);
    await expect(
      deliveryStatuses.reconcileDeliveryStatus(createTenantContext(tenantAId), input),
    ).resolves.toMatchObject({ duplicate: true, message: { id: queued.message.id } });
    await expect(
      prisma.domainEventOutbox.count({
        where: {
          aggregateId: queued.message.id,
          eventType: "message.delivery_status_updated",
          tenantId: tenantAId,
        },
      }),
    ).resolves.toBe(1);
  });
});
