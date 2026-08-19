import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/prisma/client";
import {
  createOutboundMessageManager,
  OutboundMessageChannelNotFoundError,
  type OutboundMessageManager,
} from "./outbound-message-manager";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e05-s03-outbound-db";
let prisma: PrismaClient;
let manager: OutboundMessageManager;
let tenantAId = "";
let tenantBId = "";
let ownerAId = "";
let channelAId = "";
let channelBId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length === 0) return;
  await prisma.outboundMessage.deleteMany({ where: { tenantId: { in: ids } } });
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
    displayName: `Outbound ${marker}`,
    enabledModules: ["module.messaging.basic"],
    legalName: `Outbound ${marker} SA`,
    limits: {
      channelAccounts: 3,
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

describe.sequential("E05-S03 outbound message manager", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    const [a, b] = await Promise.all([provision("a"), provision("b")]);
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
    ownerAId = a.ownerId;
    const [channelA, channelB] = await Promise.all([
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "Outbound A",
          providerType: "mock",
          status: "connected",
          tenantId: tenantAId,
        },
      }),
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "Outbound B",
          providerType: "mock",
          status: "connected",
          tenantId: tenantBId,
        },
      }),
    ]);
    channelAId = channelA.id;
    channelBId = channelB.id;
    manager = createOutboundMessageManager(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma?.$disconnect();
  });

  it("creates a transactional pending message and is idempotent", async () => {
    const context = createTenantContext(tenantAId);
    const first = await manager.enqueueOutboundMessage(context, channelAId, {
      actorUserId: ownerAId,
      content: { text: "hola" },
      idempotencyKey: "e05-s03-idempotent-1",
      messageType: "text",
      recipientPhone: "+5215512345678",
    });
    const duplicate = await manager.enqueueOutboundMessage(context, channelAId, {
      actorUserId: ownerAId,
      content: { text: "reintento" },
      idempotencyKey: "e05-s03-idempotent-1",
      messageType: "text",
      recipientPhone: "+5215512345678",
    });

    expect(first).toMatchObject({ status: "PENDING", tenantId: tenantAId });
    expect(duplicate.id).toBe(first.id);
    await expect(
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: first.id } }),
    ).resolves.toMatchObject({ status: "PENDING", tenantId: tenantAId });
    await manager.markAsSending(context, first.id);
    await manager.markAsSent(context, first.id, "mock-idempotent-1");
  });

  it("moves pending to sending and sent atomically with one outbox event", async () => {
    const context = createTenantContext(tenantAId);
    const message = await manager.enqueueOutboundMessage(context, channelAId, {
      actorUserId: ownerAId,
      content: { text: "estado" },
      idempotencyKey: "e05-s03-state-1",
      messageType: "text",
      recipientPhone: "+5215512345678",
    });
    const [claimed] = await manager.claimNextPendingMessages(1, 30_000);
    expect(claimed?.id).toBe(message.id);
    const sent = await manager.markAsSent(context, message.id, "mock-provider-1");

    expect(sent).toMatchObject({ providerMessageId: "mock-provider-1", status: "SENT" });
    await expect(
      prisma.domainEventOutbox.findMany({
        where: { aggregateId: message.id, eventType: "messaging.outbound.sent" },
      }),
    ).resolves.toHaveLength(1);
  });

  it("retries a transient failure and moves to DLQ after max retries", async () => {
    const context = createTenantContext(tenantAId);
    const message = await manager.enqueueOutboundMessage(context, channelAId, {
      content: { text: "reintento" },
      idempotencyKey: "e05-s03-dlq-1",
      maxRetries: 1,
      messageType: "text",
      recipientPhone: "+5215512345678",
    });
    await manager.claimNextPendingMessages(1, 30_000);
    const retrying = await manager.markAsFailedOrRetry(
      context,
      message.id,
      "NETWORK_ERROR",
      true,
      new Date(Date.now() - 1),
    );
    expect(retrying).toMatchObject({ retryCount: 1, status: "RETRYING" });
    await manager.markAsSending(context, message.id);
    const deadLetter = await manager.markAsFailedOrRetry(
      context,
      message.id,
      "NETWORK_ERROR",
      true,
      new Date(),
    );

    expect(deadLetter).toMatchObject({ status: "DLQ" });
    await expect(
      prisma.domainEventOutbox.findMany({
        where: { aggregateId: message.id, eventType: "messaging.outbound.dlq" },
      }),
    ).resolves.toHaveLength(1);
  });

  it("fails closed for cross-tenant enqueue, read, and mutation", async () => {
    const message = await manager.enqueueOutboundMessage(
      createTenantContext(tenantAId),
      channelAId,
      {
        content: { text: "aislamiento" },
        idempotencyKey: "e05-s03-isolation-1",
        messageType: "text",
        recipientPhone: "+5215512345678",
      },
    );
    const contextB = createTenantContext(tenantBId);
    await expect(manager.findById(contextB, message.id)).resolves.toBeNull();
    await expect(
      manager.enqueueOutboundMessage(contextB, channelAId, {
        content: { text: "no" },
        idempotencyKey: "e05-s03-isolation-2",
        messageType: "text",
        recipientPhone: "+5215512345678",
      }),
    ).rejects.toBeInstanceOf(OutboundMessageChannelNotFoundError);
    await expect(manager.markAsSending(contextB, message.id)).rejects.toThrow(
      "Outbound message was not found",
    );
    expect(channelBId).not.toBe(channelAId);
  });
});
