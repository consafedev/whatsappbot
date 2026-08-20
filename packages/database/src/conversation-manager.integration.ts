import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ConversationChannelInactiveError,
  ConversationInboundEventNotFoundError,
  type ConversationManager,
  ConversationModuleEntitlementRequiredError,
  ConversationSenderPhoneRequiredError,
  ConversationTenantNotOperationalError,
  createConversationManager,
} from "./conversation-manager";
import type { PrismaClient } from "./generated/prisma/client";
import { createInboundEventManager, type InboundEventManager } from "./inbound-event-manager";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  type PlatformTenantModuleKey,
  syncPermissionCatalog,
} from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e06-s02-conversation-db";
let prisma: PrismaClient;
let manager: ConversationManager;
let inboundManager: InboundEventManager;
let tenantAId = "";
let tenantBId = "";
let tenantWithoutCrmId = "";
let channelAId = "";
let channelWithoutCrmId = "";
let inboundEventAId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
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

async function provision(marker: string, enabledModules: readonly PlatformTenantModuleKey[]) {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Conversations ${marker}`,
    enabledModules,
    legalName: `Conversations ${marker} SA`,
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

describe.sequential("E06-S02 conversation resolver", () => {
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
          automationDefaultMode: "ASSISTED",
          displayName: "Conversations A",
          providerType: "mock",
          status: "connected",
          tenantId: tenantAId,
        },
      }),
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "Conversations without CRM",
          providerType: "mock",
          status: "connected",
          tenantId: tenantWithoutCrmId,
        },
      }),
    ]);
    channelAId = channelA.id;
    channelWithoutCrmId = channelWithoutCrm.id;
    manager = createConversationManager(prisma);
    inboundManager = createInboundEventManager(prisma);
    const event = await inboundManager.recordInboundEvent(createTenantContext(tenantAId), {
      channelAccountId: channelAId,
      eventType: "MESSAGE_RECEIVED",
      messageType: "text",
      payload: { id: "conversation-1", text: "hola" },
      providerMessageId: "conversation-1",
      senderPhone: "+5215512345678",
    });
    inboundEventAId = event.event.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma?.$disconnect();
  });

  it("creates one tenant-scoped conversation and preserves inbound processing for E06-S03", async () => {
    const conversation = await manager.routeInboundEventToConversation(
      createTenantContext(tenantAId),
      { inboundEventId: inboundEventAId, senderName: "Persona A" },
    );

    expect(conversation).toMatchObject({
      automationMode: "ASSISTED",
      channelAccountId: channelAId,
      status: "open",
      tenantId: tenantAId,
    });
    expect(conversation.contactId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/i);
    await expect(
      prisma.inboundMessageEvent.findUniqueOrThrow({ where: { id: inboundEventAId } }),
    ).resolves.toMatchObject({ processedStatus: "PENDING" });
    await expect(
      prisma.domainEventOutbox.findFirstOrThrow({
        where: { aggregateId: conversation.id, eventType: "conversation.created" },
      }),
    ).resolves.toMatchObject({ tenantId: tenantAId });
    await expect(
      prisma.auditLog.findFirstOrThrow({
        where: { action: "conversation.created", entityId: conversation.id },
      }),
    ).resolves.toMatchObject({ entityType: "Conversation", tenantId: tenantAId });
  });

  it("reuses the active conversation under concurrent delivery", async () => {
    const [first, second] = await Promise.all([
      manager.routeInboundEventToConversation(createTenantContext(tenantAId), {
        inboundEventId: inboundEventAId,
      }),
      manager.routeInboundEventToConversation(createTenantContext(tenantAId), {
        inboundEventId: inboundEventAId,
      }),
    ]);

    expect(first.id).toBe(second.id);
    await expect(
      prisma.conversation.count({
        where: { channelAccountId: channelAId, contactId: first.contactId, tenantId: tenantAId },
      }),
    ).resolves.toBe(1);
  });

  it("reopens pending conversations and creates a new thread after close", async () => {
    const current = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: tenantAId, channelAccountId: channelAId },
    });
    await prisma.conversation.update({
      data: { status: "pending" },
      where: { id: current.id },
    });
    const reopened = await manager.routeInboundEventToConversation(createTenantContext(tenantAId), {
      inboundEventId: inboundEventAId,
    });
    expect(reopened).toMatchObject({ id: current.id, status: "open" });

    await prisma.conversation.update({
      data: { closedAt: new Date(), status: "closed" },
      where: { id: current.id },
    });
    const next = await manager.routeInboundEventToConversation(createTenantContext(tenantAId), {
      inboundEventId: inboundEventAId,
    });
    expect(next.id).not.toBe(current.id);
    expect(next.status).toBe("open");
    await expect(
      prisma.domainEventOutbox.findFirstOrThrow({
        where: { aggregateId: current.id, eventType: "conversation.state_changed" },
      }),
    ).resolves.toMatchObject({ tenantId: tenantAId });
  });

  it("fails closed for tenant isolation, missing CRM entitlement, inactive channel and suspension", async () => {
    await expect(
      manager.routeInboundEventToConversation(createTenantContext(tenantBId), {
        inboundEventId: inboundEventAId,
      }),
    ).rejects.toBeInstanceOf(ConversationInboundEventNotFoundError);

    const eventWithoutCrm = await inboundManager.recordInboundEvent(
      createTenantContext(tenantWithoutCrmId),
      {
        channelAccountId: channelWithoutCrmId,
        eventType: "MESSAGE_RECEIVED",
        payload: { id: "conversation-without-crm" },
        providerMessageId: "conversation-without-crm",
        senderPhone: "+5215512345680",
      },
    );
    await expect(
      manager.routeInboundEventToConversation(createTenantContext(tenantWithoutCrmId), {
        inboundEventId: eventWithoutCrm.event.id,
      }),
    ).rejects.toBeInstanceOf(ConversationModuleEntitlementRequiredError);

    await prisma.channelAccount.update({
      data: { active: false },
      where: { id: channelAId },
    });
    await expect(
      manager.routeInboundEventToConversation(createTenantContext(tenantAId), {
        inboundEventId: inboundEventAId,
      }),
    ).rejects.toBeInstanceOf(ConversationChannelInactiveError);
    await prisma.channelAccount.update({ data: { active: true }, where: { id: channelAId } });

    await prisma.tenant.update({ data: { status: "suspended" }, where: { id: tenantAId } });
    await expect(
      manager.routeInboundEventToConversation(createTenantContext(tenantAId), {
        inboundEventId: inboundEventAId,
      }),
    ).rejects.toBeInstanceOf(ConversationTenantNotOperationalError);
    await prisma.tenant.update({ data: { status: "active" }, where: { id: tenantAId } });
  });

  it("rejects an inbound event without a sender phone", async () => {
    const event = await inboundManager.recordInboundEvent(createTenantContext(tenantAId), {
      channelAccountId: channelAId,
      eventType: "MESSAGE_RECEIVED",
      payload: { id: "conversation-without-sender" },
      providerMessageId: "conversation-without-sender",
    });
    await expect(
      manager.routeInboundEventToConversation(createTenantContext(tenantAId), {
        inboundEventId: event.event.id,
      }),
    ).rejects.toBeInstanceOf(ConversationSenderPhoneRequiredError);
  });
});
