import { loadDatabaseConfig } from "@whatsapp-platform/config";
import {
  createOutboundMessageManager,
  createTenantContext,
  type OutboundMessageManager,
} from "@whatsapp-platform/database";
import type { PrismaClient } from "@whatsapp-platform/database/platform";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "@whatsapp-platform/database/platform";
import {
  MESSAGE_STATUS,
  MockMessagingProvider,
  type ProviderSendResult,
  type SendMessageMetadata,
} from "@whatsapp-platform/messaging";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OutboundWorker } from "./outbound-worker";

const prefix = "e05-s03-outbound-worker";
let prisma: PrismaClient;
let manager: OutboundMessageManager;
let tenantId = "";
let channelId = "";

class FlakyMessagingProvider extends MockMessagingProvider {
  calls = 0;

  override async sendText(
    to: string,
    message: string,
    metadata: SendMessageMetadata,
  ): Promise<ProviderSendResult> {
    this.calls += 1;
    if (this.calls === 1) {
      return {
        acceptedAt: new Date(),
        errorCode: "NETWORK_ERROR",
        errorMessage: "network",
        providerMessageId: null,
        status: MESSAGE_STATUS.FAILED,
      };
    }
    return super.sendText(to, message, metadata);
  }
}

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

describe.sequential("E05-S03 outbound worker", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    const result = await createPlatformTenantProvisioningRepository(prisma).provision({
      actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
      defaultCurrency: "MXN",
      defaultLocale: "es-MX",
      defaultTimezone: "America/Mexico_City",
      deploymentId: null,
      displayName: "Outbound Worker",
      enabledModules: ["module.messaging.basic"],
      legalName: "Outbound Worker SA",
      limits: {
        channelAccounts: 2,
        monthlyAiBudget: null,
        organizationUnits: 3,
        storageBytes: 1_073_741_824,
        users: 5,
      },
      owner: {
        displayName: "Worker Owner",
        email: `${prefix}-owner@example.invalid`,
        locale: "es-MX",
        passwordHash: "$argon2id$test-hash-not-reversible",
        timezone: "America/Mexico_City",
      },
      requestId: `${prefix}-provision`,
      slug: `${prefix}-tenant`,
    });
    tenantId = result.tenant.id;
    const channel = await prisma.channelAccount.create({
      data: {
        active: true,
        displayName: "Worker Channel",
        providerType: "mock",
        status: "connected",
        tenantId,
      },
    });
    channelId = channel.id;
    manager = createOutboundMessageManager(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma?.$disconnect();
  });

  it("consumes a queued message, retries a transient failure, and emits outbox events", async () => {
    const provider = new FlakyMessagingProvider();
    const worker = new OutboundWorker(manager, prisma, {
      attemptTimeoutMs: 15_000,
      providerFactory: () => provider,
    });
    const message = await manager.enqueueOutboundMessage(createTenantContext(tenantId), channelId, {
      content: { text: "worker" },
      idempotencyKey: "e05-s03-worker-1",
      maxRetries: 2,
      messageType: "text",
      recipientPhone: "+5215512345678",
    });

    await expect(worker.runOnce()).resolves.toBe(1);
    await expect(
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: message.id } }),
    ).resolves.toMatchObject({
      retryCount: 1,
      status: "RETRYING",
    });
    await prisma.outboundMessage.update({
      data: { scheduledAt: new Date(Date.now() - 1) },
      where: { id: message.id },
    });

    await expect(worker.runOnce()).resolves.toBe(1);
    await expect(
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: message.id } }),
    ).resolves.toMatchObject({
      providerMessageId: expect.stringContaining("mock-"),
      status: "SENT",
    });
    expect(provider.calls).toBe(2);
    await expect(
      prisma.domainEventOutbox.count({
        where: { aggregateId: message.id, eventType: "messaging.outbound.failed" },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.domainEventOutbox.count({
        where: { aggregateId: message.id, eventType: "messaging.outbound.sent" },
      }),
    ).resolves.toBe(1);
    await worker.stop();
  });
});
