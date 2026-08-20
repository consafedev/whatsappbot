import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/prisma/client";
import {
  ConversationNotFoundError,
  createOutboundConversationMessageManager,
  type OutboundConversationMessageManager,
} from "./outbound-conversation-message-manager";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e06-s04-outbound-conversation-db";
let prisma: PrismaClient;
let manager: OutboundConversationMessageManager;
let tenantAId = "";
let tenantBId = "";
let ownerAId = "";
let channelAId = "";
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
    displayName: `Outbound conversation ${marker}`,
    enabledModules: ["module.messaging.basic", "module.crm_lite"],
    legalName: `Outbound conversation ${marker} SA`,
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

describe.sequential("E06-S04 outbound conversation message persistence", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    const [a, b] = await Promise.all([provision("a"), provision("b")]);
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
    ownerAId = a.ownerId;
    const channelA = await prisma.channelAccount.create({
      data: {
        active: true,
        displayName: "Outbound conversation A",
        providerType: "mock",
        status: "connected",
        tenantId: tenantAId,
      },
    });
    channelAId = channelA.id;
    const contact = await prisma.contact.create({
      data: { name: "Contacto A", phoneNumber: "+5215512345678", tenantId: tenantAId },
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
    manager = createOutboundConversationMessageManager(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma?.$disconnect();
  });

  it("creates the canonical outbound Message before the queued send", async () => {
    const result = await manager.sendConversationMessage(
      createTenantContext(tenantAId),
      conversationAId,
      {
        actorUserId: ownerAId,
        content: { text: "respuesta desde dashboard" },
        idempotencyKey: "e06-s04-create-before-send-1",
        messageType: "text",
      },
    );

    expect(result).toMatchObject({
      conversationId: conversationAId,
      duplicate: false,
      message: {
        actorId: ownerAId,
        actorType: "tenant_user",
        deliveryStatus: "queued",
        direction: "outbound",
        origin: "human_app",
        providerTimestamp: null,
        tenantId: tenantAId,
      },
      outboundMessage: {
        actorUserId: ownerAId,
        channelAccountId: channelAId,
        recipientPhone: "+5215512345678",
        status: "PENDING",
        tenantId: tenantAId,
      },
    });
    expect(result.message.outboundMessageId).toBe(result.outboundMessage.id);
    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: conversationAId } }),
    ).resolves.toMatchObject({
      lastHumanMessageAt: expect.any(Date),
      lastMessageAt: expect.any(Date),
      lastOutboundAt: expect.any(Date),
    });
    await expect(
      prisma.domainEventOutbox.findFirstOrThrow({
        where: { aggregateId: result.message.id, eventType: "message.queued" },
      }),
    ).resolves.toMatchObject({ aggregateType: "Message", tenantId: tenantAId });
  });

  it("is idempotent and does not duplicate the canonical message or queue row", async () => {
    const input = {
      actorUserId: ownerAId,
      content: { text: "mensaje idempotente" },
      idempotencyKey: "e06-s04-idempotent-1",
      messageType: "text" as const,
    };
    const first = await manager.sendConversationMessage(
      createTenantContext(tenantAId),
      conversationAId,
      input,
    );
    const duplicate = await manager.sendConversationMessage(
      createTenantContext(tenantAId),
      conversationAId,
      input,
    );

    expect(duplicate).toMatchObject({
      conversationId: conversationAId,
      duplicate: true,
      message: { id: first.message.id },
      outboundMessage: { id: first.outboundMessage.id },
    });
    await expect(
      prisma.message.count({
        where: { idempotencyKey: input.idempotencyKey, tenantId: tenantAId },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.outboundMessage.count({
        where: { idempotencyKey: input.idempotencyKey, tenantId: tenantAId },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.domainEventOutbox.count({
        where: { aggregateId: first.message.id, eventType: "message.queued", tenantId: tenantAId },
      }),
    ).resolves.toBe(1);
  });

  it("serializes concurrent sends with the same idempotency key", async () => {
    const input = {
      actorUserId: ownerAId,
      content: { text: "mensaje concurrente" },
      idempotencyKey: "e06-s04-concurrent-1",
      messageType: "text" as const,
    };
    const [first, second] = await Promise.all([
      manager.sendConversationMessage(createTenantContext(tenantAId), conversationAId, input),
      manager.sendConversationMessage(createTenantContext(tenantAId), conversationAId, input),
    ]);

    expect(first.message.id).toBe(second.message.id);
    expect(first.outboundMessage.id).toBe(second.outboundMessage.id);
    expect([first.duplicate, second.duplicate].sort()).toEqual([false, true]);
    await expect(
      prisma.message.count({
        where: { idempotencyKey: input.idempotencyKey, tenantId: tenantAId },
      }),
    ).resolves.toBe(1);
  });

  it("fails closed when another tenant supplies the conversation id", async () => {
    await expect(
      manager.sendConversationMessage(createTenantContext(tenantBId), conversationAId, {
        content: { text: "no debe salir" },
        idempotencyKey: "e06-s04-cross-tenant-1",
        messageType: "text",
      }),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);

    await expect(
      prisma.message.findFirst({
        where: { idempotencyKey: "e06-s04-cross-tenant-1", tenantId: tenantBId },
      }),
    ).resolves.toBeNull();
  });
});
