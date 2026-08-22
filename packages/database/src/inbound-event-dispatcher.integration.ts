import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DeliveryStatusMessageNotFoundError } from "./delivery-status-manager";
import type { PrismaClient } from "./generated/prisma/client";
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

const prefix = "e06-s07-dispatcher";
let prisma: PrismaClient;
let inboundEvents: InboundEventManager;
let dispatcher: InboundEventDispatcher;
let outboundMessages: OutboundConversationMessageManager;
let tenantId = "";
let ownerId = "";
let channelId = "";
let conversationId = "";

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

async function provision(): Promise<void> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: "Delivery dispatcher",
    enabledModules: ["module.messaging.basic", "module.crm_lite"],
    legalName: "Delivery dispatcher SA",
    limits: {
      channelAccounts: 2,
      monthlyAiBudget: null,
      organizationUnits: 3,
      storageBytes: 1_073_741_824,
      users: 5,
    },
    owner: {
      displayName: "Owner dispatcher",
      email: `${prefix}-owner@example.invalid`,
      locale: "es-MX",
      passwordHash: "$argon2id$test-hash-not-reversible",
      timezone: "America/Mexico_City",
    },
    requestId: prefix,
    slug: prefix,
  });
  tenantId = result.tenant.id;
  ownerId = result.owner.id;
}

async function receipt(
  eventProviderId: string,
  providerMessageId: string,
  status: "sent" | "delivered" | "read" | "failed",
): Promise<string> {
  const timestamp = new Date("2026-08-21T13:00:00.000Z");
  const result = await inboundEvents.recordInboundEvent(createTenantContext(tenantId), {
    channelAccountId: channelId,
    eventType: "STATUS_UPDATE",
    normalizedData: {
      providerMessageId,
      statusUpdate: { status, timestamp: timestamp.toISOString() },
    },
    payload: { status, timestamp: timestamp.toISOString() },
    providerMessageId: eventProviderId,
  });
  return result.event.id;
}

describe.sequential("E06-S07 inbound event dispatcher", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    await provision();
    const channel = await prisma.channelAccount.create({
      data: {
        active: true,
        displayName: "Dispatcher channel",
        providerType: "mock",
        status: "connected",
        tenantId,
      },
    });
    channelId = channel.id;
    const contact = await prisma.contact.create({
      data: { name: "Dispatcher contact", phoneNumber: "+5215512345678", tenantId },
    });
    const conversation = await prisma.conversation.create({
      data: { channelAccountId: channelId, contactId: contact.id, status: "open", tenantId },
    });
    conversationId = conversation.id;
    inboundEvents = createInboundEventManager(prisma);
    dispatcher = createInboundEventDispatcher(prisma);
    outboundMessages = createOutboundConversationMessageManager(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma?.$disconnect();
  });

  it("routes STATUS_UPDATE through delivery-status reconciliation", async () => {
    const queued = await outboundMessages.sendConversationMessage(
      createTenantContext(tenantId),
      conversationId,
      {
        actorUserId: ownerId,
        content: { text: "dispatcher receipt" },
        idempotencyKey: "e06-s07-dispatcher-route-1",
        messageType: "text",
      },
    );
    await prisma.outboundMessage.update({
      data: { providerMessageId: "provider-dispatcher-route-1" },
      where: { id: queued.outboundMessage.id },
    });
    const eventId = await receipt(
      "receipt-dispatcher-route-1",
      "provider-dispatcher-route-1",
      "sent",
    );

    await expect(
      dispatcher.dispatch(createTenantContext(tenantId), { inboundEventId: eventId }),
    ).resolves.toMatchObject({
      kind: "delivery_status",
      result: { duplicate: false, deliveryStatus: "sent", message: { id: queued.message.id } },
    });
    await expect(
      prisma.inboundMessageEvent.findUniqueOrThrow({ where: { id: eventId } }),
    ).resolves.toMatchObject({ processedStatus: "PROCESSED" });
  });

  it("keeps a receipt pending when its canonical Message is not persisted yet", async () => {
    const eventId = await receipt(
      "receipt-dispatcher-missing-1",
      "provider-dispatcher-missing-1",
      "delivered",
    );
    await expect(
      dispatcher.dispatch(createTenantContext(tenantId), { inboundEventId: eventId }),
    ).rejects.toBeInstanceOf(DeliveryStatusMessageNotFoundError);
    await expect(
      prisma.inboundMessageEvent.findUniqueOrThrow({ where: { id: eventId } }),
    ).resolves.toMatchObject({ processedStatus: "PENDING" });
  });
});
