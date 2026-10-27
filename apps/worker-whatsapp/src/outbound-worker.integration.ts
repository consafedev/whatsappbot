import { loadDatabaseConfig } from "@whatsapp-platform/config";
import {
  cancelAppointment,
  createAppointment,
  createOutboundMessageManager,
  createTenantContext,
  executeAppointmentReminder,
  type OutboundMessageManager,
  rebookAppointment,
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
let ownerId = "";
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
  await prisma.appointmentReminder.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointment.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentAvailabilityRule.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentResource.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentService.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.message.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.outboundMessage.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.contact.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.channelAccount.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.scheduledTask.deleteMany({ where: { tenantId: { in: ids } } });
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
      enabledModules: [
        "module.appointments",
        "module.scheduling",
        "module.messaging.basic",
        "module.crm_lite",
      ],
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
    ownerId = result.owner.id;
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

  it("rechecks queued reminder authority before provider IO and sends an authorized reminder", async () => {
    const contact = await prisma.contact.create({
      data: { tenantId, name: "Reminder Worker Contact", phoneNumber: `+5255${Date.now()}` },
    });
    const conversation = await prisma.conversation.create({
      data: {
        tenantId,
        channelAccountId: channelId,
        contactId: contact.id,
        status: "open",
        automationMode: "AUTO",
      },
    });
    const service = await prisma.appointmentService.create({
      data: { tenantId, name: "Worker Service", durationMinutes: 30 },
    });
    const resource = await prisma.appointmentResource.create({
      data: { tenantId, name: "Worker Resource", capacity: 10 },
    });
    const baseStart = new Date();
    baseStart.setUTCDate(baseStart.getUTCDate() + 14);
    baseStart.setUTCHours(9, 0, 0, 0);
    await prisma.appointmentAvailabilityRule.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        tenantId,
        resourceId: resource.id,
        dayOfWeek,
        startTime: "00:00",
        endTime: "24:00",
        timezone: "UTC",
        capacity: 10,
      })),
    });

    const enqueueReminder = async (idempotencyKey: string, startsAt: Date) => {
      const appointment = await createAppointment(
        createTenantContext(tenantId),
        prisma,
        {
          contactId: contact.id,
          serviceId: service.id,
          resourceId: resource.id,
          startsAt: startsAt.toISOString(),
          idempotencyKey,
          reminderPolicy: { conversationId: conversation.id, offsetMinutes: [30] },
        },
        { actorUserId: ownerId, requestId: `${prefix}-${idempotencyKey}` },
      );
      const reminder = await prisma.appointmentReminder.findFirstOrThrow({
        where: { tenantId, appointmentId: appointment.id },
      });
      const dueAt = new Date(Date.now() - 1_000);
      await prisma.$transaction(async (transaction) => {
        await transaction.appointmentReminder.update({
          data: { dueAt },
          where: { tenantId_id: { id: reminder.id, tenantId } },
        });
        await transaction.scheduledTask.update({
          data: { scheduledFor: dueAt, status: "PROCESSING" },
          where: { tenantId_id: { id: reminder.id, tenantId } },
        });
      });
      const task = await prisma.scheduledTask.findUniqueOrThrow({
        where: { tenantId_id: { id: reminder.id, tenantId } },
      });
      expect((await executeAppointmentReminder(prisma, task, new Date())).kind).toBe("queued");
      return prisma.appointmentReminder.findUniqueOrThrow({
        where: { tenantId_id: { id: reminder.id, tenantId } },
        include: { outbound: true },
      });
    };

    const stale = await enqueueReminder("s08-worker-stale-phone", baseStart);
    if (stale.outbound === null) throw new Error("Expected queued reminder outbound");
    await prisma.contact.update({
      data: { phoneNumber: `+5299${Date.now()}` },
      where: { id: contact.id, tenantId },
    });
    const blockedProvider = new MockMessagingProvider();
    const blockedWorker = new OutboundWorker(manager, prisma, {
      providerFactory: () => blockedProvider,
    });
    await expect(blockedWorker.runOnce()).resolves.toBe(1);
    expect(blockedProvider.sentMessages).toHaveLength(0);
    await expect(
      prisma.appointmentReminder.findUniqueOrThrow({
        where: { tenantId_id: { id: stale.id, tenantId } },
      }),
    ).resolves.toMatchObject({ status: "SUPPRESSED", reason: "RECIPIENT_CHANGED" });
    await expect(
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: stale.outbound.id, tenantId } }),
    ).resolves.toMatchObject({ status: "FAILED" });
    await blockedWorker.stop();

    await prisma.contact.update({
      data: { phoneNumber: `+5255${Date.now()}` },
      where: { id: contact.id, tenantId },
    });
    const cancelled = await enqueueReminder(
      "s08-worker-cancelled-reminder",
      new Date(baseStart.getTime() + 24 * 60 * 60_000),
    );
    await cancelAppointment(createTenantContext(tenantId), prisma, cancelled.appointmentId, {
      actorUserId: ownerId,
      requestId: `${prefix}-cancel-before-dispatch`,
    });
    const cancelledProvider = new MockMessagingProvider();
    const cancelledWorker = new OutboundWorker(manager, prisma, {
      providerFactory: () => cancelledProvider,
    });
    await expect(cancelledWorker.runOnce()).resolves.toBe(1);
    expect(cancelledProvider.sentMessages).toHaveLength(0);
    await expect(
      prisma.appointmentReminder.findUniqueOrThrow({
        where: { tenantId_id: { id: cancelled.id, tenantId } },
      }),
    ).resolves.toMatchObject({ status: "CANCELLED" });
    await cancelledWorker.stop();

    const rebooked = await enqueueReminder(
      "s08-worker-rebooked-reminder",
      new Date(baseStart.getTime() + 48 * 60 * 60_000),
    );
    await rebookAppointment(
      createTenantContext(tenantId),
      prisma,
      rebooked.appointmentId,
      {
        startsAt: new Date(baseStart.getTime() + 72 * 60 * 60_000).toISOString(),
        idempotencyKey: "s08-worker-rebooked-replacement",
      },
      { actorUserId: ownerId, requestId: `${prefix}-rebook-before-dispatch` },
    );
    const rebookProvider = new MockMessagingProvider();
    const rebookWorker = new OutboundWorker(manager, prisma, {
      providerFactory: () => rebookProvider,
    });
    await expect(rebookWorker.runOnce()).resolves.toBe(1);
    expect(rebookProvider.sentMessages).toHaveLength(0);
    await expect(
      prisma.appointmentReminder.findUniqueOrThrow({
        where: { tenantId_id: { id: rebooked.id, tenantId } },
      }),
    ).resolves.toMatchObject({ status: "CANCELLED" });
    await rebookWorker.stop();

    const modeChanged = await enqueueReminder(
      "s08-worker-mode-changed-reminder",
      new Date(baseStart.getTime() + 96 * 60 * 60_000),
    );
    await prisma.conversation.update({
      data: { automationMode: "HUMAN" },
      where: { tenantId_id: { id: conversation.id, tenantId } },
    });
    const modeProvider = new MockMessagingProvider();
    const modeWorker = new OutboundWorker(manager, prisma, { providerFactory: () => modeProvider });
    await expect(modeWorker.runOnce()).resolves.toBe(1);
    expect(modeProvider.sentMessages).toHaveLength(0);
    await expect(
      prisma.appointmentReminder.findUniqueOrThrow({
        where: { tenantId_id: { id: modeChanged.id, tenantId } },
      }),
    ).resolves.toMatchObject({ status: "SUPPRESSED", reason: "AUTOMATION_PAUSED" });
    await modeWorker.stop();
    await prisma.conversation.update({
      data: { automationMode: "AUTO" },
      where: { tenantId_id: { id: conversation.id, tenantId } },
    });

    const moduleChanged = await enqueueReminder(
      "s08-worker-module-changed-reminder",
      new Date(baseStart.getTime() + 120 * 60 * 60_000),
    );
    await prisma.tenantEntitlement.update({
      data: { enabled: false },
      where: { tenantId_entitlementKey: { tenantId, entitlementKey: "module.scheduling" } },
    });
    const moduleProvider = new MockMessagingProvider();
    const moduleWorker = new OutboundWorker(manager, prisma, {
      providerFactory: () => moduleProvider,
    });
    await expect(moduleWorker.runOnce()).resolves.toBe(1);
    expect(moduleProvider.sentMessages).toHaveLength(0);
    await expect(
      prisma.appointmentReminder.findUniqueOrThrow({
        where: { tenantId_id: { id: moduleChanged.id, tenantId } },
      }),
    ).resolves.toMatchObject({ status: "SUPPRESSED", reason: "MODULE_DISABLED" });
    await moduleWorker.stop();
    await prisma.tenantEntitlement.update({
      data: { enabled: true },
      where: { tenantId_entitlementKey: { tenantId, entitlementKey: "module.scheduling" } },
    });

    const valid = await enqueueReminder(
      "s08-worker-valid-reminder",
      new Date(baseStart.getTime() + 24 * 60 * 60_000),
    );
    if (valid.outbound === null) throw new Error("Expected queued reminder outbound");
    const provider = new MockMessagingProvider();
    const worker = new OutboundWorker(manager, prisma, { providerFactory: () => provider });
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(provider.sentMessages).toHaveLength(1);
    await expect(
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: valid.outbound.id, tenantId } }),
    ).resolves.toMatchObject({
      status: "SENT",
      providerMessageId: expect.stringContaining("mock-"),
    });
    await expect(
      prisma.appointmentReminder.findUniqueOrThrow({
        where: { tenantId_id: { id: valid.id, tenantId } },
      }),
    ).resolves.toMatchObject({ status: "QUEUED", dispatchAuthorizedAt: expect.any(Date) });
    await worker.stop();
  });
});
