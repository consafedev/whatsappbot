import { loadDatabaseConfig } from "@whatsapp-platform/config";
import {
  cancelAppointment,
  createAppointment,
  createOutboundMessageManager,
  createTenantContext,
  executeAppointmentReminder,
  hashAppointmentBookingRuleDefinition,
  normalizeAppointmentBookingPolicy,
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
import { processPersistedBookingTurn } from "../../../packages/database/dist/appointment-booking-manager";
import { createTenantContext as createSourceTenantContext } from "../../../packages/database/dist/tenant-context";
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
  await prisma.appointmentBookingTurn.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentBookingFlow.updateMany({
    where: { tenantId: { in: ids }, selectedAppointmentId: { not: null } },
    data: { selectedAppointmentId: null },
  });
  await prisma.appointmentReminder.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointment.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentBookingFlow.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.rule.deleteMany({ where: { tenantId: { in: ids } } });
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
        "module.automation.basic",
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

  it("suppresses queued booking prompts after HUMAN takeover before provider IO", async () => {
    const contact = await prisma.contact.create({
      data: { tenantId, name: "Booking worker contact", phoneNumber: `+5255${Date.now()}` },
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
      data: { tenantId, name: `Booking worker service ${Date.now()}`, durationMinutes: 30 },
    });
    const resource = await prisma.appointmentResource.create({
      data: { tenantId, name: `Booking worker resource ${Date.now()}`, capacity: 1 },
    });
    const policy = normalizeAppointmentBookingPolicy({
      serviceIds: [service.id],
      resourceIds: [resource.id],
    });
    const rule = await prisma.rule.create({
      data: {
        tenantId,
        channelAccountId: channelId,
        name: `Booking worker rule ${Date.now()}`,
        triggerType: "ON_MESSAGE_RECEIVED",
        status: "active",
        executionMode: "first_match_stop",
        conditions: [],
        actions: [{ actionType: "start_appointment_booking", parameters: policy }],
      },
    });
    const inbound = await prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        channelAccountId: channelId,
        contactId: contact.id,
        direction: "inbound",
        origin: "provider",
        actorType: "customer",
        messageType: "text",
        textBody: "Quiero reservar",
      },
    });
    const flow = await prisma.appointmentBookingFlow.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        contactId: contact.id,
        channelAccountId: channelId,
        originatingRuleId: rule.id,
        liveRuleId: rule.id,
        policyHash: hashAppointmentBookingRuleDefinition(rule),
        policySnapshot: policy,
        intent: "CREATE",
        phase: "SELECT_SERVICE",
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    const outbound = await manager.enqueueOutboundMessage(
      createTenantContext(tenantId),
      channelId,
      {
        content: { text: "Elige un servicio" },
        idempotencyKey: `s10-booking-worker-${crypto.randomUUID()}`,
        maxRetries: 0,
        messageType: "text",
        recipientPhone: contact.phoneNumber,
      },
    );
    await prisma.appointmentBookingTurn.create({
      data: {
        tenantId,
        inboundMessageId: inbound.id,
        conversationId: conversation.id,
        contactId: contact.id,
        channelAccountId: channelId,
        route: "BOOKING",
        originatingRuleId: rule.id,
        liveRuleId: rule.id,
        policyHash: flow.policyHash,
        policySnapshot: policy,
        flowId: flow.id,
        outboundMessageId: outbound.id,
        outboundPurpose: "PROMPT",
        outboundFlowPhase: flow.phase,
        outboundFlowVersion: flow.proposalVersion,
      },
    });
    const firstTurnKey = {
      tenantId_inboundMessageId: { tenantId, inboundMessageId: inbound.id },
    };
    await expect(
      prisma.appointmentBookingTurn.update({
        where: firstTurnKey,
        data: { outboundFlowVersion: null },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.appointmentBookingTurn.update({
        where: firstTurnKey,
        data: { outboundFlowPhase: "COMPLETED" },
      }),
    ).rejects.toThrow();
    await prisma.conversation.update({
      data: { automationMode: "HUMAN" },
      where: { tenantId_id: { id: conversation.id, tenantId } },
    });

    const provider = new MockMessagingProvider();
    const worker = new OutboundWorker(manager, prisma, { providerFactory: () => provider });
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(provider.sentMessages).toHaveLength(0);
    await expect(
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: outbound.id } }),
    ).resolves.toMatchObject({
      status: "FAILED",
      lastError: expect.stringContaining("BOOKING_DISPATCH_SUPPRESSED"),
    });
    await worker.stop();
    await prisma.appointmentBookingFlow.update({
      data: { phase: "CANCELLED", closedAt: new Date(), terminalReason: "test_cleanup" },
      where: { tenantId_id: { id: flow.id, tenantId } },
    });
    await prisma.conversation.update({
      data: { automationMode: "AUTO" },
      where: { tenantId_id: { id: conversation.id, tenantId } },
    });

    const moduleInbound = await prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        channelAccountId: channelId,
        contactId: contact.id,
        direction: "inbound",
        origin: "provider",
        actorType: "customer",
        messageType: "text",
        textBody: "Quiero otra cita",
      },
    });
    const moduleFlow = await prisma.appointmentBookingFlow.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        contactId: contact.id,
        channelAccountId: channelId,
        originatingRuleId: rule.id,
        liveRuleId: rule.id,
        policyHash: flow.policyHash,
        policySnapshot: policy,
        intent: "CREATE",
        phase: "SELECT_SERVICE",
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    const moduleOutbound = await manager.enqueueOutboundMessage(
      createTenantContext(tenantId),
      channelId,
      {
        content: { text: "Elige un servicio" },
        idempotencyKey: `s10-booking-worker-module-${crypto.randomUUID()}`,
        maxRetries: 0,
        messageType: "text",
        recipientPhone: contact.phoneNumber,
      },
    );
    await prisma.appointmentBookingTurn.create({
      data: {
        tenantId,
        inboundMessageId: moduleInbound.id,
        conversationId: conversation.id,
        contactId: contact.id,
        channelAccountId: channelId,
        route: "BOOKING",
        originatingRuleId: rule.id,
        liveRuleId: rule.id,
        policyHash: moduleFlow.policyHash,
        policySnapshot: policy,
        flowId: moduleFlow.id,
        outboundMessageId: moduleOutbound.id,
        outboundPurpose: "PROMPT",
        outboundFlowPhase: moduleFlow.phase,
        outboundFlowVersion: moduleFlow.proposalVersion,
      },
    });
    await prisma.tenantEntitlement.update({
      data: { enabled: false },
      where: { tenantId_entitlementKey: { tenantId, entitlementKey: "module.appointments" } },
    });
    const moduleProvider = new MockMessagingProvider();
    const moduleWorker = new OutboundWorker(manager, prisma, {
      providerFactory: () => moduleProvider,
    });
    await expect(moduleWorker.runOnce()).resolves.toBe(1);
    expect(moduleProvider.sentMessages).toHaveLength(0);
    await expect(
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: moduleOutbound.id } }),
    ).resolves.toMatchObject({
      status: "FAILED",
      lastError: expect.stringContaining("BOOKING_DISPATCH_SUPPRESSED"),
    });
    await moduleWorker.stop();
    await prisma.tenantEntitlement.update({
      data: { enabled: true },
      where: { tenantId_entitlementKey: { tenantId, entitlementKey: "module.appointments" } },
    });
    await prisma.appointmentBookingFlow.update({
      data: { phase: "CANCELLED", closedAt: new Date(), terminalReason: "test_cleanup" },
      where: { tenantId_id: { id: moduleFlow.id, tenantId } },
    });

    const reminderPolicy = normalizeAppointmentBookingPolicy({
      serviceIds: [service.id],
      resourceIds: [resource.id],
      reminderOffsetsMinutes: [60],
    });
    const reminderRule = await prisma.rule.create({
      data: {
        tenantId,
        channelAccountId: channelId,
        name: `Booking reminder worker rule ${Date.now()}`,
        triggerType: "ON_MESSAGE_RECEIVED",
        status: "active",
        executionMode: "first_match_stop",
        conditions: [],
        actions: [{ actionType: "start_appointment_booking", parameters: reminderPolicy }],
      },
    });
    const schedulingInbound = await prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        channelAccountId: channelId,
        contactId: contact.id,
        direction: "inbound",
        origin: "provider",
        actorType: "customer",
        messageType: "text",
        textBody: "Quiero cita con recordatorio",
      },
    });
    const schedulingFlow = await prisma.appointmentBookingFlow.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        contactId: contact.id,
        channelAccountId: channelId,
        originatingRuleId: reminderRule.id,
        liveRuleId: reminderRule.id,
        policyHash: hashAppointmentBookingRuleDefinition(reminderRule),
        policySnapshot: reminderPolicy,
        intent: "CREATE",
        phase: "SELECT_SERVICE",
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    const schedulingOutbound = await manager.enqueueOutboundMessage(
      createTenantContext(tenantId),
      channelId,
      {
        content: { text: "Elige un servicio con recordatorio" },
        idempotencyKey: `s10-booking-worker-scheduling-${crypto.randomUUID()}`,
        maxRetries: 0,
        messageType: "text",
        recipientPhone: contact.phoneNumber,
      },
    );
    await prisma.appointmentBookingTurn.create({
      data: {
        tenantId,
        inboundMessageId: schedulingInbound.id,
        conversationId: conversation.id,
        contactId: contact.id,
        channelAccountId: channelId,
        route: "BOOKING",
        originatingRuleId: reminderRule.id,
        liveRuleId: reminderRule.id,
        policyHash: schedulingFlow.policyHash,
        policySnapshot: reminderPolicy,
        flowId: schedulingFlow.id,
        outboundMessageId: schedulingOutbound.id,
        outboundPurpose: "PROMPT",
        outboundFlowPhase: schedulingFlow.phase,
        outboundFlowVersion: schedulingFlow.proposalVersion,
      },
    });
    await prisma.tenantEntitlement.update({
      data: { enabled: false },
      where: { tenantId_entitlementKey: { tenantId, entitlementKey: "module.scheduling" } },
    });
    const schedulingProvider = new MockMessagingProvider();
    const schedulingWorker = new OutboundWorker(manager, prisma, {
      providerFactory: () => schedulingProvider,
    });
    await expect(schedulingWorker.runOnce()).resolves.toBe(1);
    expect(schedulingProvider.sentMessages).toHaveLength(0);
    await expect(
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: schedulingOutbound.id } }),
    ).resolves.toMatchObject({
      status: "FAILED",
      lastError: expect.stringContaining("BOOKING_DISPATCH_SUPPRESSED"),
    });
    await schedulingWorker.stop();
    await prisma.tenantEntitlement.update({
      data: { enabled: true },
      where: { tenantId_entitlementKey: { tenantId, entitlementKey: "module.scheduling" } },
    });
    await prisma.appointmentBookingFlow.update({
      data: { phase: "CANCELLED", closedAt: new Date(), terminalReason: "test_cleanup" },
      where: { tenantId_id: { id: schedulingFlow.id, tenantId } },
    });

    const takeoverInbound = await prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        channelAccountId: channelId,
        contactId: contact.id,
        direction: "inbound",
        origin: "provider",
        actorType: "customer",
        messageType: "text",
        textBody: "Otra cita",
      },
    });
    const takeoverFlow = await prisma.appointmentBookingFlow.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        contactId: contact.id,
        channelAccountId: channelId,
        originatingRuleId: rule.id,
        liveRuleId: rule.id,
        policyHash: flow.policyHash,
        policySnapshot: policy,
        intent: "CREATE",
        phase: "SELECT_SERVICE",
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    const takeoverOutbound = await manager.enqueueOutboundMessage(
      createTenantContext(tenantId),
      channelId,
      {
        content: { text: "Elige un servicio" },
        idempotencyKey: `s10-booking-worker-takeover-${crypto.randomUUID()}`,
        maxRetries: 0,
        messageType: "text",
        recipientPhone: contact.phoneNumber,
      },
    );
    await prisma.appointmentBookingTurn.create({
      data: {
        tenantId,
        inboundMessageId: takeoverInbound.id,
        conversationId: conversation.id,
        contactId: contact.id,
        channelAccountId: channelId,
        route: "BOOKING",
        originatingRuleId: rule.id,
        liveRuleId: rule.id,
        policyHash: takeoverFlow.policyHash,
        policySnapshot: policy,
        flowId: takeoverFlow.id,
        outboundMessageId: takeoverOutbound.id,
        outboundPurpose: "PROMPT",
        outboundFlowPhase: takeoverFlow.phase,
        outboundFlowVersion: takeoverFlow.proposalVersion,
      },
    });
    await prisma.conversation.update({
      data: { humanTakeoverUntil: new Date(Date.now() + 5 * 60_000) },
      where: { tenantId_id: { id: conversation.id, tenantId } },
    });
    const takeoverProvider = new MockMessagingProvider();
    const takeoverWorker = new OutboundWorker(manager, prisma, {
      providerFactory: () => takeoverProvider,
    });
    await expect(takeoverWorker.runOnce()).resolves.toBe(1);
    expect(takeoverProvider.sentMessages).toHaveLength(0);
    await expect(
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: takeoverOutbound.id } }),
    ).resolves.toMatchObject({
      status: "FAILED",
      lastError: expect.stringContaining("BOOKING_DISPATCH_SUPPRESSED"),
    });
    await takeoverWorker.stop();
    await prisma.conversation.update({
      data: { humanTakeoverUntil: null },
      where: { tenantId_id: { id: conversation.id, tenantId } },
    });
    await prisma.appointmentBookingFlow.update({
      data: { phase: "CANCELLED", closedAt: new Date(), terminalReason: "test_cleanup" },
      where: { tenantId_id: { id: takeoverFlow.id, tenantId } },
    });

    const availabilityStart = new Date();
    availabilityStart.setUTCDate(availabilityStart.getUTCDate() + 14);
    availabilityStart.setUTCHours(9, 0, 0, 0);
    await prisma.appointmentAvailabilityRule.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        tenantId,
        resourceId: resource.id,
        dayOfWeek,
        startTime: "08:00",
        endTime: "12:00",
        timezone: "UTC",
        capacity: 1,
      })),
    });
    const promptContact = await prisma.contact.create({
      data: {
        tenantId,
        name: `Booking prompt contact ${Date.now()}`,
        phoneNumber: `+5255${String(Date.now()).slice(-8)}`,
      },
    });
    const promptConversation = await prisma.conversation.create({
      data: {
        tenantId,
        channelAccountId: channelId,
        contactId: promptContact.id,
        status: "open",
        automationMode: "AUTO",
      },
    });
    const persistPromptInbound = async (textBody: string) => {
      const inbound = await prisma.message.create({
        data: {
          tenantId,
          conversationId: promptConversation.id,
          channelAccountId: channelId,
          contactId: promptContact.id,
          direction: "inbound",
          origin: "provider",
          actorType: "customer",
          messageType: "text",
          textBody,
        },
      });
      await prisma.appointmentBookingTurn.create({
        data: {
          tenantId,
          inboundMessageId: inbound.id,
          conversationId: promptConversation.id,
          contactId: promptContact.id,
          channelAccountId: channelId,
          route: "UNDECIDED",
        },
      });
      return inbound;
    };
    const selectPromptRoute = async () => ({
      kind: "BOOKING" as const,
      ruleId: rule.id,
      trigger: "ON_MESSAGE_RECEIVED" as const,
      policy,
      policyHash: hashAppointmentBookingRuleDefinition(rule),
    });
    const promptProvider = new MockMessagingProvider();
    const promptWorker = new OutboundWorker(manager, prisma, {
      providerFactory: () => promptProvider,
    });
    const createPromptInbound = await persistPromptInbound("Quiero reservar");
    const createPrompt = await processPersistedBookingTurn(
      createSourceTenantContext(tenantId),
      prisma as never,
      createPromptInbound.id,
      selectPromptRoute,
    );
    if (!createPrompt.outboundMessageId) throw new Error("service prompt was not queued");
    await expect(promptWorker.runOnce()).resolves.toBe(1);
    expect(promptProvider.sentMessages).toHaveLength(1);

    const resourcePromptInbound = await persistPromptInbound("1");
    const resourcePrompt = await processPersistedBookingTurn(
      createSourceTenantContext(tenantId),
      prisma as never,
      resourcePromptInbound.id,
      selectPromptRoute,
    );
    if (!resourcePrompt.outboundMessageId) throw new Error("resource prompt was not queued");
    await expect(promptWorker.runOnce()).resolves.toBe(1);
    expect(promptProvider.sentMessages).toHaveLength(2);

    const slotPromptInbound = await persistPromptInbound("1");
    const slotPrompt = await processPersistedBookingTurn(
      createSourceTenantContext(tenantId),
      prisma as never,
      slotPromptInbound.id,
      selectPromptRoute,
    );
    if (!slotPrompt.outboundMessageId) throw new Error("slot prompt was not queued");
    const slotPromptTurn = await prisma.appointmentBookingTurn.findUniqueOrThrow({
      where: {
        tenantId_inboundMessageId: {
          tenantId,
          inboundMessageId: slotPromptInbound.id,
        },
      },
    });
    expect(slotPromptTurn).toMatchObject({
      outboundPurpose: "PROMPT",
      outboundFlowPhase: "SELECT_SLOT",
      outboundFlowVersion: 3,
    });
    await expect(promptWorker.runOnce()).resolves.toBe(1);
    expect(promptProvider.sentMessages).toHaveLength(3);

    const slotFlowId = slotPromptTurn.flowId;
    if (slotFlowId === null) throw new Error("slot prompt lost its flow lineage");
    await prisma.appointmentBookingFlow.update({
      where: { tenantId_id: { id: slotFlowId, tenantId } },
      data: {
        phase: "CANCELLED",
        closedAt: new Date(),
        terminalReason: "test_cleanup",
        confirmationTokenHash: null,
        proposalVersion: { increment: 1 },
      },
    });
    const expiringInbound = await persistPromptInbound("Quiero reservar");
    const expiringPrompt = await processPersistedBookingTurn(
      createSourceTenantContext(tenantId),
      prisma as never,
      expiringInbound.id,
      selectPromptRoute,
    );
    if (!expiringPrompt.outboundMessageId) throw new Error("expiring prompt was not queued");
    const expiringTurn = await prisma.appointmentBookingTurn.findUniqueOrThrow({
      where: {
        tenantId_inboundMessageId: {
          tenantId,
          inboundMessageId: expiringInbound.id,
        },
      },
    });
    if (expiringTurn.flowId === null) throw new Error("expiring prompt lost its flow lineage");
    let releaseRule!: () => void;
    let announceRuleLock!: () => void;
    const ruleHeld = new Promise<void>((resolve) => {
      announceRuleLock = resolve;
    });
    const releaseSignal = new Promise<void>((resolve) => {
      releaseRule = resolve;
    });
    const ruleBlocker = prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM "rule" WHERE tenant_id = ${tenantId}::uuid AND id = ${rule.id}::uuid FOR UPDATE`;
        announceRuleLock();
        await releaseSignal;
      },
      { timeout: 15_000 },
    );
    await ruleHeld;
    const expiringAttempt = promptWorker.runOnce();
    let waitingOnRule = false;
    const waitDeadline = Date.now() + 5_000;
    while (!waitingOnRule && Date.now() < waitDeadline) {
      const rows = await prisma.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%FOR SHARE%'`;
      waitingOnRule = (rows[0]?.count ?? 0) > 0;
      if (!waitingOnRule) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!waitingOnRule) {
      releaseRule();
      await ruleBlocker;
      await expiringAttempt;
      throw new Error("booking dispatch did not wait on the held rule row");
    }
    await prisma.appointmentBookingFlow.update({
      where: { tenantId_id: { id: expiringTurn.flowId, tenantId } },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    releaseRule();
    await ruleBlocker;
    await expect(expiringAttempt).resolves.toBe(1);
    expect(promptProvider.sentMessages).toHaveLength(3);
    await expect(
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: expiringPrompt.outboundMessageId } }),
    ).resolves.toMatchObject({
      status: "FAILED",
      lastError: expect.stringContaining("BOOKING_DISPATCH_SUPPRESSED"),
    });
    await promptWorker.stop();

    const appointment = await createAppointment(
      createTenantContext(tenantId),
      prisma,
      {
        serviceId: service.id,
        resourceId: resource.id,
        contactId: contact.id,
        startsAt: availabilityStart.toISOString(),
        idempotencyKey: `s10-booking-worker-completed-${crypto.randomUUID()}`,
      },
      { actorUserId: ownerId, requestId: `${prefix}-completed-ack` },
    );
    const completedInbound = await prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        channelAccountId: channelId,
        contactId: contact.id,
        direction: "inbound",
        origin: "provider",
        actorType: "customer",
        messageType: "text",
        textBody: "Confirmado",
      },
    });
    const completedFlow = await prisma.appointmentBookingFlow.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        contactId: contact.id,
        channelAccountId: channelId,
        originatingRuleId: rule.id,
        liveRuleId: null,
        policyHash: flow.policyHash,
        policySnapshot: policy,
        intent: "CREATE",
        phase: "COMPLETED",
        selectedAppointmentId: appointment.id,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        closedAt: new Date(),
        terminalReason: "confirmed",
      },
    });
    await prisma.appointment.update({
      where: { tenantId_id: { id: appointment.id, tenantId } },
      data: { bookingFlowId: completedFlow.id },
    });
    const stalePromptInbound = await prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        channelAccountId: channelId,
        contactId: contact.id,
        direction: "inbound",
        origin: "provider",
        actorType: "customer",
        messageType: "text",
        textBody: "Quiero reservar",
      },
    });
    const staleCompletedPrompt = await manager.enqueueOutboundMessage(
      createTenantContext(tenantId),
      channelId,
      {
        content: { text: "Elige un servicio" },
        idempotencyKey: `s10-booking-worker-stale-completed-prompt-${crypto.randomUUID()}`,
        maxRetries: 0,
        messageType: "text",
        recipientPhone: contact.phoneNumber,
      },
    );
    await prisma.appointmentBookingTurn.create({
      data: {
        tenantId,
        inboundMessageId: stalePromptInbound.id,
        conversationId: conversation.id,
        contactId: contact.id,
        channelAccountId: channelId,
        route: "BOOKING",
        originatingRuleId: rule.id,
        liveRuleId: null,
        policyHash: completedFlow.policyHash,
        policySnapshot: policy,
        flowId: completedFlow.id,
        outboundMessageId: staleCompletedPrompt.id,
        outboundPurpose: "PROMPT",
        outboundFlowPhase: "SELECT_SERVICE",
        outboundFlowVersion: completedFlow.proposalVersion,
        appointmentId: appointment.id,
      },
    });
    const completedOutbound = await manager.enqueueOutboundMessage(
      createTenantContext(tenantId),
      channelId,
      {
        content: { text: "Listo. Reservé tu cita." },
        idempotencyKey: `s10-booking-worker-completed-ack-${crypto.randomUUID()}`,
        maxRetries: 0,
        messageType: "text",
        recipientPhone: contact.phoneNumber,
      },
    );
    await prisma.appointmentBookingTurn.create({
      data: {
        tenantId,
        inboundMessageId: completedInbound.id,
        conversationId: conversation.id,
        contactId: contact.id,
        channelAccountId: channelId,
        route: "BOOKING",
        originatingRuleId: rule.id,
        liveRuleId: null,
        policyHash: completedFlow.policyHash,
        policySnapshot: policy,
        flowId: completedFlow.id,
        outboundMessageId: completedOutbound.id,
        outboundPurpose: "ACK",
        outboundFlowPhase: completedFlow.phase,
        outboundFlowVersion: completedFlow.proposalVersion,
        appointmentId: appointment.id,
      },
    });
    const exitInbound = await prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        channelAccountId: channelId,
        contactId: contact.id,
        direction: "inbound",
        origin: "provider",
        actorType: "customer",
        messageType: "text",
        textBody: "SALIR",
      },
    });
    const exitFlow = await prisma.appointmentBookingFlow.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        contactId: contact.id,
        channelAccountId: channelId,
        originatingRuleId: rule.id,
        liveRuleId: null,
        policyHash: flow.policyHash,
        policySnapshot: policy,
        intent: "CREATE",
        phase: "CANCELLED",
        proposalVersion: 2,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        closedAt: new Date(),
        terminalReason: "customer_exit",
      },
    });
    const exitOutbound = await manager.enqueueOutboundMessage(
      createTenantContext(tenantId),
      channelId,
      {
        content: { text: "Solicitud cerrada." },
        idempotencyKey: `s10-booking-worker-exit-ack-${crypto.randomUUID()}`,
        maxRetries: 0,
        messageType: "text",
        recipientPhone: contact.phoneNumber,
      },
    );
    await prisma.appointmentBookingTurn.create({
      data: {
        tenantId,
        inboundMessageId: exitInbound.id,
        conversationId: conversation.id,
        contactId: contact.id,
        channelAccountId: channelId,
        route: "BOOKING",
        originatingRuleId: rule.id,
        liveRuleId: null,
        policyHash: exitFlow.policyHash,
        policySnapshot: policy,
        flowId: exitFlow.id,
        outboundMessageId: exitOutbound.id,
        outboundPurpose: "ACK",
        outboundFlowPhase: "CANCELLED",
        outboundFlowVersion: exitFlow.proposalVersion,
      },
    });
    await prisma.appointmentBookingFlow.updateMany({
      data: { liveRuleId: null },
      where: { tenantId, liveRuleId: { not: null } },
    });
    await prisma.appointmentBookingTurn.updateMany({
      data: { liveRuleId: null },
      where: { tenantId, liveRuleId: { not: null } },
    });
    await prisma.rule.deleteMany({ where: { tenantId } });
    const completedProvider = new MockMessagingProvider();
    const completedWorker = new OutboundWorker(manager, prisma, {
      providerFactory: () => completedProvider,
    });
    await expect(completedWorker.runOnce()).resolves.toBe(3);
    expect(completedProvider.sentMessages).toHaveLength(2);
    await expect(
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: staleCompletedPrompt.id } }),
    ).resolves.toMatchObject({
      status: "FAILED",
      lastError: expect.stringContaining("BOOKING_DISPATCH_SUPPRESSED"),
    });
    await expect(
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: completedOutbound.id } }),
    ).resolves.toMatchObject({ status: "SENT" });
    await expect(
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: exitOutbound.id } }),
    ).resolves.toMatchObject({ status: "SENT" });
    await completedWorker.stop();
  });
});
