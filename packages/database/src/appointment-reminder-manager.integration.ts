import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AppointmentConflictError,
  AppointmentValidationError,
  cancelAppointment,
  createAppointment,
  rebookAppointment,
} from "./appointment-manager";
import {
  AppointmentReminderNotFoundError,
  AppointmentReminderTaskMismatchError,
  authorizeAppointmentReminderDispatch,
  executeAppointmentReminder,
} from "./appointment-reminder-manager";
import { lockConversationInTransaction } from "./conversation-manager";
import { createPlatformDatabaseClient, type PrismaClient } from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e14-s08-reminders";
let database: PrismaClient;
let tenantId = "";
let actorId = "";
let contactId = "";
let serviceId = "";
let resourceId = "";
let conversationId = "";
let channelId = "";
let startsAt: Date;

async function cleanup(): Promise<void> {
  const tenants = await database.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length === 0) return;
  await database.appointmentReminder.deleteMany({ where: { tenantId: { in: ids } } });
  await database.appointment.deleteMany({ where: { tenantId: { in: ids } } });
  await database.appointmentAvailabilityRule.deleteMany({ where: { tenantId: { in: ids } } });
  await database.appointmentResource.deleteMany({ where: { tenantId: { in: ids } } });
  await database.appointmentService.deleteMany({ where: { tenantId: { in: ids } } });
  await database.message.deleteMany({ where: { tenantId: { in: ids } } });
  await database.outboundMessage.deleteMany({ where: { tenantId: { in: ids } } });
  await database.conversation.deleteMany({ where: { tenantId: { in: ids } } });
  await database.channelAccount.deleteMany({ where: { tenantId: { in: ids } } });
  await database.contact.deleteMany({ where: { tenantId: { in: ids } } });
  await database.scheduledTask.deleteMany({ where: { tenantId: { in: ids } } });
  await database.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await database.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await database.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await database.user.deleteMany({ where: { tenantId: { in: ids } } });
  await database.tenant.deleteMany({ where: { id: { in: ids } } });
}

async function claimReminderForTest(appointmentId: string) {
  const reminder = await database.appointmentReminder.findFirstOrThrow({
    where: { tenantId, appointmentId },
  });
  const dueAt = new Date(Date.now() - 1_000);
  await database.$transaction(async (transaction) => {
    await transaction.appointmentReminder.update({
      data: { dueAt },
      where: { tenantId_id: { id: reminder.id, tenantId } },
    });
    await transaction.scheduledTask.update({
      data: { scheduledFor: dueAt, status: "PROCESSING" },
      where: { tenantId_id: { id: reminder.id, tenantId } },
    });
  });
  return {
    reminder,
    task: await database.scheduledTask.findUniqueOrThrow({
      where: { tenantId_id: { id: reminder.id, tenantId } },
    }),
  };
}

async function waitForConversationLockWaiter(): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const rows = await database.$queryRaw<Array<{ waiters: string }>>`
      WITH target AS (
        SELECT hashtextextended(
          ${tenantId}::text || ':conversation:'::text || ${channelId}::text || ':'::text || ${contactId}::text,
          0::bigint
        ) AS key
      )
      SELECT COUNT(*)::text AS waiters
      FROM pg_locks AS lock, target
      WHERE lock.locktype = 'advisory'
        AND lock.granted = false
        AND lock.objsubid = 1
        AND lock.classid::bigint = ((target.key >> 32) & 4294967295)
        AND lock.objid::bigint = (target.key & 4294967295)`;
    if (Number(rows[0]?.waiters ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Conversation advisory waiter was not observed");
}

describe.sequential("E14-S08 persistent appointment reminders", () => {
  beforeAll(async () => {
    database = createPlatformDatabaseClient(loadDatabaseConfig());
    await database.$connect();
    await cleanup();
    const tenant = await database.tenant.create({
      data: {
        displayName: prefix,
        legalName: prefix,
        slug: `${prefix}-${crypto.randomUUID()}`,
        status: "active",
        defaultTimezone: "UTC",
        defaultLocale: "es-MX",
        defaultCurrency: "MXN",
      },
    });
    tenantId = tenant.id;
    await database.tenantEntitlement.createMany({
      data: [
        "module.appointments",
        "module.scheduling",
        "module.messaging.basic",
        "module.crm_lite",
      ].map((entitlementKey) => ({
        entitlementKey,
        enabled: true,
        source: "contract",
        tenantId,
      })),
    });
    const [actor, contact, service, resource, channel] = await Promise.all([
      database.user.create({
        data: {
          tenantId,
          email: `${prefix}-${crypto.randomUUID()}@example.invalid`,
          passwordHash: "test-hash",
          displayName: "Reminder Actor",
          status: "active",
          locale: "es-MX",
          timezone: "UTC",
        },
      }),
      database.contact.create({
        data: { tenantId, name: "Reminder Contact", phoneNumber: `+5255${Date.now()}` },
      }),
      database.appointmentService.create({
        data: { tenantId, name: "Reminder Service", durationMinutes: 30 },
      }),
      database.appointmentResource.create({
        data: { tenantId, name: "Reminder Resource", capacity: 100 },
      }),
      database.channelAccount.create({
        data: {
          active: true,
          displayName: "Reminder Channel",
          providerType: "mock",
          status: "connected",
          tenantId,
        },
      }),
    ]);
    actorId = actor.id;
    contactId = contact.id;
    serviceId = service.id;
    resourceId = resource.id;
    channelId = channel.id;
    const conversation = await database.conversation.create({
      data: {
        channelAccountId: channel.id,
        contactId,
        status: "open",
        automationMode: "AUTO",
        tenantId,
      },
    });
    conversationId = conversation.id;
    startsAt = new Date();
    startsAt.setUTCDate(startsAt.getUTCDate() + 14);
    startsAt.setUTCHours(9, 0, 0, 0);
    await database.appointmentAvailabilityRule.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        tenantId,
        resourceId,
        dayOfWeek,
        startTime: "00:00",
        endTime: "23:59",
        timezone: "UTC",
        capacity: 100,
      })),
    });
  }, 60_000);

  afterAll(async () => {
    if (database) {
      await cleanup();
      await database.$disconnect();
    }
  }, 60_000);

  it("stores normalized opt-in policy and schedules each future offset with the booking", async () => {
    const policy = { conversationId: conversationId.toUpperCase(), offsetMinutes: [60, 30] };
    const booking = await createAppointment(
      createTenantContext(tenantId),
      database,
      {
        serviceId,
        resourceId,
        contactId,
        startsAt: startsAt.toISOString(),
        idempotencyKey: "s08-policy-booking",
        reminderPolicy: policy,
      },
      { actorUserId: actorId, requestId: `${prefix}-request` },
    );

    expect(booking.reminderPolicy).toEqual({
      conversationId: conversationId.toLowerCase(),
      offsetMinutes: [30, 60],
    });
    const reminders = await database.appointmentReminder.findMany({
      include: { task: true },
      orderBy: { offsetMinutes: "asc" },
      where: { appointmentId: booking.id, tenantId },
    });
    expect(reminders).toHaveLength(2);
    expect(reminders).toMatchObject([
      { offsetMinutes: 30, status: "PENDING", task: { taskType: "APPOINTMENT_REMINDER" } },
      { offsetMinutes: 60, status: "PENDING", task: { taskType: "APPOINTMENT_REMINDER" } },
    ]);
    expect(reminders.map(({ taskId }) => taskId)).toEqual(reminders.map(({ id }) => id));
    expect(reminders.map(({ dueAt }) => dueAt.getTime())).toEqual([
      startsAt.getTime() - 30 * 60_000,
      startsAt.getTime() - 60 * 60_000,
    ]);
  });

  it("queues one canonical automated outbound for a due reminder and survives task replay", async () => {
    const booking = await createAppointment(
      createTenantContext(tenantId),
      database,
      {
        serviceId,
        resourceId,
        contactId,
        startsAt: startsAt.toISOString(),
        idempotencyKey: "s08-due-outbound",
        notes: "internal medical note that must not be sent",
        reminderPolicy: { conversationId, offsetMinutes: [30] },
      },
      { actorUserId: actorId, requestId: `${prefix}-due-outbound` },
    );
    const reminder = await database.appointmentReminder.findFirstOrThrow({
      where: { appointmentId: booking.id, tenantId },
    });
    const dueAt = new Date(Date.now() - 1_000);
    await database.$transaction(async (transaction) => {
      await transaction.scheduledTask.update({
        data: { scheduledFor: dueAt, status: "PROCESSING" },
        where: { tenantId_id: { id: reminder.id, tenantId } },
      });
      await transaction.appointmentReminder.update({
        data: { dueAt },
        where: { tenantId_id: { id: reminder.id, tenantId } },
      });
    });
    const task = await database.scheduledTask.findUniqueOrThrow({
      where: { tenantId_id: { id: reminder.id, tenantId } },
    });
    const result = await executeAppointmentReminder(database, task, new Date());
    expect(result.kind).toBe("queued");
    const queued = await database.appointmentReminder.findUniqueOrThrow({
      where: { tenantId_id: { id: reminder.id, tenantId } },
      include: { outbound: true },
    });
    expect(queued).toMatchObject({
      status: "QUEUED",
      outbound: { status: "PENDING", actorUserId: null },
    });
    const message = await database.message.findFirstOrThrow({
      where: { tenantId, outboundMessageId: queued.outboundMessageId },
    });
    expect(message).toMatchObject({
      actorType: "system",
      direction: "outbound",
      origin: "automation",
      deliveryStatus: "queued",
    });
    expect(message.textBody).toContain("Reminder Service");
    expect(message.textBody).not.toContain("internal medical note");
    expect(
      await database.message.count({
        where: { tenantId, idempotencyKey: `appointment-reminder:${booking.id}:30` },
      }),
    ).toBe(1);
    const recoveredScheduledFor = new Date(Date.now() + 60_000);
    await database.scheduledTask.update({
      data: { scheduledFor: recoveredScheduledFor, status: "PROCESSING" },
      where: { tenantId_id: { id: task.id, tenantId } },
    });
    const recoveredTask = await database.scheduledTask.findUniqueOrThrow({
      where: { tenantId_id: { id: task.id, tenantId } },
    });
    expect((await executeAppointmentReminder(database, recoveredTask, new Date())).kind).toBe(
      "already-handled",
    );
  });

  it("executes a recovered pending reminder using its business dueAt, not the retry schedule", async () => {
    const booking = await createAppointment(
      createTenantContext(tenantId),
      database,
      {
        serviceId,
        resourceId,
        contactId,
        startsAt: startsAt.toISOString(),
        idempotencyKey: "s08-recovered-pending",
        reminderPolicy: { conversationId, offsetMinutes: [30] },
      },
      { actorUserId: actorId, requestId: `${prefix}-recovered-pending` },
    );
    const reminder = await database.appointmentReminder.findFirstOrThrow({
      where: { appointmentId: booking.id, tenantId },
    });
    const dueAt = new Date(Date.now() - 1_000);
    const recoveredScheduledFor = new Date(Date.now() + 60_000);
    await database.$transaction(async (transaction) => {
      await transaction.appointmentReminder.update({
        data: { dueAt },
        where: { tenantId_id: { id: reminder.id, tenantId } },
      });
      await transaction.scheduledTask.update({
        data: { scheduledFor: recoveredScheduledFor, status: "PROCESSING" },
        where: { tenantId_id: { id: reminder.id, tenantId } },
      });
    });
    const recoveredTask = await database.scheduledTask.findUniqueOrThrow({
      where: { tenantId_id: { id: reminder.id, tenantId } },
    });

    const result = await executeAppointmentReminder(database, recoveredTask, new Date());
    expect(result.kind).toBe("queued");
    await expect(
      database.appointmentReminder.findUniqueOrThrow({
        where: { tenantId_id: { id: reminder.id, tenantId } },
      }),
    ).resolves.toMatchObject({ status: "QUEUED" });
  });

  it("derives reminder identity from the persisted task ID and ignores copied payload IDs", async () => {
    const booking = await createAppointment(
      createTenantContext(tenantId),
      database,
      {
        serviceId,
        resourceId,
        contactId,
        startsAt: startsAt.toISOString(),
        idempotencyKey: "s08-forged-task-payload",
        reminderPolicy: { conversationId, offsetMinutes: [30] },
      },
      { actorUserId: actorId, requestId: `${prefix}-forged-payload` },
    );
    const reminder = await database.appointmentReminder.findFirstOrThrow({
      where: { tenantId, appointmentId: booking.id },
    });
    const dueAt = new Date(Date.now() - 1_000);
    await database.$transaction(async (transaction) => {
      await transaction.appointmentReminder.update({
        data: { dueAt },
        where: { tenantId_id: { id: reminder.id, tenantId } },
      });
      await transaction.scheduledTask.update({
        data: {
          payload: { reminderId: "019c0000-0000-7000-8000-000000000999" },
          scheduledFor: dueAt,
          status: "PROCESSING",
        },
        where: { tenantId_id: { id: reminder.id, tenantId } },
      });
    });
    const persistedTask = await database.scheduledTask.findUniqueOrThrow({
      where: { tenantId_id: { id: reminder.id, tenantId } },
    });
    await expect(
      executeAppointmentReminder(database, persistedTask, new Date()),
    ).resolves.toMatchObject({
      kind: "queued",
    });
    const forgedId = (await database.$queryRaw<Array<{ id: string }>>`SELECT uuidv7() AS id`)[0]
      ?.id;
    if (forgedId === undefined) throw new Error("Could not allocate forged task ID");
    const forgedTask = await database.scheduledTask.create({
      data: {
        id: forgedId,
        tenantId,
        name: "Forged reminder task",
        taskType: "APPOINTMENT_REMINDER",
        payload: { reminderId: reminder.id },
        scheduledFor: dueAt,
        workflowRunAt: dueAt,
        status: "PROCESSING",
      },
    });
    await expect(
      executeAppointmentReminder(database, forgedTask, new Date()),
    ).rejects.toBeInstanceOf(AppointmentReminderTaskMismatchError);
    await expect(
      database.outboundMessage.count({
        where: { tenantId, idempotencyKey: `appointment-reminder:${booking.id}:30` },
      }),
    ).resolves.toBe(1);
  });

  it("commits dispatch authorization and suppresses a changed recipient before provider IO", async () => {
    const booking = await createAppointment(
      createTenantContext(tenantId),
      database,
      {
        serviceId,
        resourceId,
        contactId,
        startsAt: startsAt.toISOString(),
        idempotencyKey: "s08-final-dispatch-guard",
        reminderPolicy: { conversationId, offsetMinutes: [30] },
      },
      { actorUserId: actorId, requestId: `${prefix}-dispatch-guard` },
    );
    const reminder = await database.appointmentReminder.findFirstOrThrow({
      where: { appointmentId: booking.id, tenantId },
    });
    const dueAt = new Date(Date.now() - 1_000);
    await database.$transaction(async (transaction) => {
      await transaction.appointmentReminder.update({
        data: { dueAt },
        where: { tenantId_id: { id: reminder.id, tenantId } },
      });
      await transaction.scheduledTask.update({
        data: { scheduledFor: dueAt, status: "PROCESSING" },
        where: { tenantId_id: { id: reminder.id, tenantId } },
      });
    });
    const task = await database.scheduledTask.findUniqueOrThrow({
      where: { tenantId_id: { id: reminder.id, tenantId } },
    });
    expect((await executeAppointmentReminder(database, task, new Date())).kind).toBe("queued");
    const queued = await database.appointmentReminder.findUniqueOrThrow({
      where: { tenantId_id: { id: reminder.id, tenantId } },
      include: { outbound: true },
    });
    if (!queued.outbound) throw new Error("Expected reminder outbound");
    await database.outboundMessage.update({
      data: { status: "SENDING" },
      where: { id: queued.outbound.id, tenantId },
    });
    const dispatchMessage = {
      channelAccountId: queued.outbound.channelAccountId,
      id: queued.outbound.id,
      recipientPhone: queued.outbound.recipientPhone,
      tenantId,
    };

    await expect(
      authorizeAppointmentReminderDispatch(database, dispatchMessage, new Date()),
    ).resolves.toBeUndefined();
    await expect(
      database.appointmentReminder.findUniqueOrThrow({
        where: { tenantId_id: { id: reminder.id, tenantId } },
      }),
    ).resolves.toMatchObject({ status: "QUEUED", dispatchAuthorizedAt: expect.any(Date) });

    await database.contact.update({
      data: { phoneNumber: `+5299${Date.now()}` },
      where: { id: contactId, tenantId },
    });
    await expect(
      authorizeAppointmentReminderDispatch(database, dispatchMessage, new Date()),
    ).rejects.toThrow("REMINDER_DISPATCH_SUPPRESSED:RECIPIENT_CHANGED");
    await expect(
      database.appointmentReminder.findUniqueOrThrow({
        where: { tenantId_id: { id: reminder.id, tenantId } },
      }),
    ).resolves.toMatchObject({ status: "SUPPRESSED", reason: "RECIPIENT_CHANGED" });
    await database.contact.update({
      data: { phoneNumber: `+5255${Date.now()}` },
      where: { id: contactId, tenantId },
    });
  });

  it("uses current time after the conversation lock before queueing a due reminder", async () => {
    const booking = await createAppointment(
      createTenantContext(tenantId),
      database,
      {
        serviceId,
        resourceId,
        contactId,
        startsAt: startsAt.toISOString(),
        idempotencyKey: "s08-lock-crosses-appointment-start-due",
        reminderPolicy: { conversationId, offsetMinutes: [30] },
      },
      { actorUserId: actorId, requestId: `${prefix}-lock-crosses-due` },
    );
    const { reminder } = await claimReminderForTest(booking.id);
    let lockAcquired!: () => void;
    let releaseLock!: () => void;
    const acquired = new Promise<void>((resolve) => {
      lockAcquired = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const holder = database.$transaction(async (transaction) => {
      await lockConversationInTransaction(transaction, tenantId, channelId, contactId);
      lockAcquired();
      await released;
    });
    await acquired;
    const crossesStartAt = new Date(Date.now() + 5 * 60_000);
    const beforeStart = new Date(crossesStartAt.getTime() - 1);
    const afterStart = new Date(crossesStartAt.getTime() + 1);
    await database.appointment.update({
      data: {
        startsAt: crossesStartAt,
        endsAt: new Date(crossesStartAt.getTime() + 30 * 60_000),
        occupiedStartsAt: crossesStartAt,
        occupiedEndsAt: new Date(crossesStartAt.getTime() + 30 * 60_000),
      },
      where: { tenantId_id: { id: booking.id, tenantId } },
    });
    const task = await database.scheduledTask.findUniqueOrThrow({
      where: { tenantId_id: { id: reminder.id, tenantId } },
    });
    let clockValue = beforeStart;
    let clockCalls = 0;
    const execution = executeAppointmentReminder(database, task, () => {
      clockCalls += 1;
      return clockValue;
    });
    let waiterObserved = false;
    try {
      await waitForConversationLockWaiter();
      waiterObserved = true;
      clockValue = afterStart;
    } finally {
      releaseLock();
      await holder;
    }

    await expect(execution).resolves.toMatchObject({
      kind: "suppressed",
      reason: "APPOINTMENT_INACTIVE",
    });
    expect(waiterObserved).toBe(true);
    expect(clockCalls).toBe(1);
    await expect(
      database.appointmentReminder.findUniqueOrThrow({
        where: { tenantId_id: { id: reminder.id, tenantId } },
      }),
    ).resolves.toMatchObject({ status: "SUPPRESSED", reason: "APPOINTMENT_INACTIVE" });
  });

  it("uses current time after the conversation lock before final dispatch authorization", async () => {
    const booking = await createAppointment(
      createTenantContext(tenantId),
      database,
      {
        serviceId,
        resourceId,
        contactId,
        startsAt: startsAt.toISOString(),
        idempotencyKey: "s08-lock-crosses-appointment-start-dispatch",
        reminderPolicy: { conversationId, offsetMinutes: [30] },
      },
      { actorUserId: actorId, requestId: `${prefix}-lock-crosses-dispatch` },
    );
    const { reminder, task: claimedTask } = await claimReminderForTest(booking.id);
    expect((await executeAppointmentReminder(database, claimedTask, () => new Date())).kind).toBe(
      "queued",
    );
    const queued = await database.appointmentReminder.findUniqueOrThrow({
      where: { tenantId_id: { id: reminder.id, tenantId } },
      include: { outbound: true },
    });
    if (queued.outbound === null) throw new Error("Expected queued reminder outbound");
    await database.outboundMessage.update({
      data: { status: "SENDING" },
      where: { id: queued.outbound.id, tenantId },
    });
    let lockAcquired!: () => void;
    let releaseLock!: () => void;
    const acquired = new Promise<void>((resolve) => {
      lockAcquired = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const holder = database.$transaction(async (transaction) => {
      await lockConversationInTransaction(transaction, tenantId, channelId, contactId);
      lockAcquired();
      await released;
    });
    await acquired;
    const crossesStartAt = new Date(Date.now() + 5 * 60_000);
    const beforeStart = new Date(crossesStartAt.getTime() - 1);
    const afterStart = new Date(crossesStartAt.getTime() + 1);
    await database.appointment.update({
      data: {
        startsAt: crossesStartAt,
        endsAt: new Date(crossesStartAt.getTime() + 30 * 60_000),
        occupiedStartsAt: crossesStartAt,
        occupiedEndsAt: new Date(crossesStartAt.getTime() + 30 * 60_000),
      },
      where: { tenantId_id: { id: booking.id, tenantId } },
    });
    let clockValue = beforeStart;
    let clockCalls = 0;
    const authorization = authorizeAppointmentReminderDispatch(
      database,
      {
        channelAccountId: queued.outbound.channelAccountId,
        id: queued.outbound.id,
        recipientPhone: queued.outbound.recipientPhone,
        tenantId,
      },
      () => {
        clockCalls += 1;
        return clockValue;
      },
    );
    let waiterObserved = false;
    try {
      await waitForConversationLockWaiter();
      waiterObserved = true;
      clockValue = afterStart;
    } finally {
      releaseLock();
      await holder;
    }

    await expect(authorization).rejects.toThrow(
      "REMINDER_DISPATCH_SUPPRESSED:APPOINTMENT_INACTIVE",
    );
    expect(waiterObserved).toBe(true);
    expect(clockCalls).toBe(1);
    await expect(
      database.appointmentReminder.findUniqueOrThrow({
        where: { tenantId_id: { id: reminder.id, tenantId } },
      }),
    ).resolves.toMatchObject({ status: "SUPPRESSED", reason: "APPOINTMENT_INACTIVE" });
  });

  it("does not reject a claimed task after its reminder was cancelled", async () => {
    const booking = await createAppointment(
      createTenantContext(tenantId),
      database,
      {
        serviceId,
        resourceId,
        contactId,
        startsAt: startsAt.toISOString(),
        idempotencyKey: "s08-cancelled-claimed-task",
        reminderPolicy: { conversationId, offsetMinutes: [30] },
      },
      { actorUserId: actorId, requestId: `${prefix}-cancelled-claimed` },
    );
    const reminder = await database.appointmentReminder.findFirstOrThrow({
      where: { appointmentId: booking.id, tenantId },
    });
    const claimedTask = await database.scheduledTask.findUniqueOrThrow({
      where: { tenantId_id: { id: reminder.id, tenantId } },
    });
    await cancelAppointment(createTenantContext(tenantId), database, booking.id, {
      actorUserId: actorId,
      requestId: `${prefix}-cancel-race`,
    });

    await expect(
      executeAppointmentReminder(database, { ...claimedTask, status: "PROCESSING" }, new Date()),
    ).resolves.toEqual({
      kind: "already-handled",
    });
  });

  it("treats normalized policy replay as equivalent and rejects a changed policy", async () => {
    const command = {
      serviceId,
      resourceId,
      contactId,
      startsAt: startsAt.toISOString(),
      idempotencyKey: "s08-policy-replay",
      reminderPolicy: { conversationId, offsetMinutes: [30, 60] },
    };
    const first = await createAppointment(createTenantContext(tenantId), database, command, {
      actorUserId: actorId,
      requestId: `${prefix}-replay`,
    });
    const duplicate = await createAppointment(
      createTenantContext(tenantId),
      database,
      {
        ...command,
        reminderPolicy: {
          conversationId: conversationId.toUpperCase(),
          offsetMinutes: [60, 30],
        },
      },
      { actorUserId: actorId, requestId: `${prefix}-replay` },
    );
    expect(duplicate.id).toBe(first.id);
    await expect(
      createAppointment(
        createTenantContext(tenantId),
        database,
        { ...command, reminderPolicy: { conversationId, offsetMinutes: [30] } },
        { actorUserId: actorId, requestId: `${prefix}-replay` },
      ),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
  });

  it("rejects duplicate, out-of-range, and unknown reminder policy fields", async () => {
    const command = {
      serviceId,
      resourceId,
      contactId,
      startsAt: startsAt.toISOString(),
      idempotencyKey: "s08-invalid-policy",
    };
    for (const reminderPolicy of [
      { conversationId, offsetMinutes: [30, 30] },
      { conversationId, offsetMinutes: [0] },
      { conversationId, offsetMinutes: [10081] },
      { conversationId, offsetMinutes: [30], text: "free text" },
    ]) {
      await expect(
        createAppointment(
          createTenantContext(tenantId),
          database,
          { ...command, reminderPolicy },
          { actorUserId: actorId, requestId: `${prefix}-invalid` },
        ),
      ).rejects.toBeInstanceOf(AppointmentValidationError);
    }
    await expect(
      database.appointment.count({ where: { tenantId, idempotencyKey: command.idempotencyKey } }),
    ).resolves.toBe(0);
  });

  it("records an offset that is already due as past-due suppression without a task", async () => {
    const soon = new Date(Date.now() + 30 * 60_000);
    soon.setUTCSeconds(0, 0);
    const booking = await createAppointment(
      createTenantContext(tenantId),
      database,
      {
        serviceId,
        resourceId,
        contactId,
        startsAt: soon.toISOString(),
        idempotencyKey: "s08-past-due-offset",
        reminderPolicy: { conversationId, offsetMinutes: [60] },
      },
      { actorUserId: actorId, requestId: `${prefix}-past-due` },
    );
    const reminder = await database.appointmentReminder.findFirstOrThrow({
      where: { appointmentId: booking.id, tenantId },
    });
    expect(reminder).toMatchObject({
      offsetMinutes: 60,
      status: "SUPPRESSED",
      reason: "PAST_DUE",
      taskId: null,
    });
    expect(await database.scheduledTask.count({ where: { tenantId, id: reminder.id } })).toBe(0);
  });

  it.each([
    ["ASSISTED", "APPROVAL_REQUIRED"],
    ["HUMAN", "AUTOMATION_PAUSED"],
    ["MONITOR", "AUTOMATION_PAUSED"],
  ] as const)("suppresses due automatic reminders in %s mode", async (automationMode, reason) => {
    const booking = await createAppointment(
      createTenantContext(tenantId),
      database,
      {
        serviceId,
        resourceId,
        contactId,
        startsAt: startsAt.toISOString(),
        idempotencyKey: `s08-mode-${automationMode.toLowerCase()}`,
        reminderPolicy: { conversationId, offsetMinutes: [30] },
      },
      { actorUserId: actorId, requestId: `${prefix}-mode` },
    );
    const { reminder, task } = await claimReminderForTest(booking.id);
    await database.conversation.update({
      data: { automationMode },
      where: { tenantId_id: { id: conversationId, tenantId } },
    });
    try {
      await expect(executeAppointmentReminder(database, task, new Date())).resolves.toMatchObject({
        kind: "suppressed",
        reason,
      });
      await expect(
        database.appointmentReminder.findUniqueOrThrow({
          where: { tenantId_id: { id: reminder.id, tenantId } },
        }),
      ).resolves.toMatchObject({ status: "SUPPRESSED", reason, outboundMessageId: null });
    } finally {
      await database.conversation.update({
        data: { automationMode: "AUTO" },
        where: { tenantId_id: { id: conversationId, tenantId } },
      });
    }
  });

  it("suppresses due reminders for takeover, disabled modules, and disconnected channels", async () => {
    const cases = [
      {
        key: "takeover",
        reason: "HUMAN_TAKEOVER",
        before: () =>
          database.conversation.update({
            data: { humanTakeoverUntil: new Date(Date.now() + 60_000) },
            where: { tenantId_id: { id: conversationId, tenantId } },
          }),
        after: () =>
          database.conversation.update({
            data: { humanTakeoverUntil: null },
            where: { tenantId_id: { id: conversationId, tenantId } },
          }),
      },
      {
        key: "module-disabled",
        reason: "MODULE_DISABLED",
        before: () =>
          database.tenantEntitlement.update({
            data: { enabled: false },
            where: { tenantId_entitlementKey: { tenantId, entitlementKey: "module.scheduling" } },
          }),
        after: () =>
          database.tenantEntitlement.update({
            data: { enabled: true },
            where: { tenantId_entitlementKey: { tenantId, entitlementKey: "module.scheduling" } },
          }),
      },
      {
        key: "contact-inactive",
        reason: "TARGET_UNAVAILABLE",
        before: () =>
          database.contact.update({
            data: { status: "INACTIVE" },
            where: { id: contactId, tenantId },
          }),
        after: () =>
          database.contact.update({
            data: { status: "ACTIVE" },
            where: { id: contactId, tenantId },
          }),
      },
      {
        key: "channel-disconnected",
        reason: "CHANNEL_UNAVAILABLE",
        before: () =>
          database.channelAccount.update({
            data: { status: "disconnected" },
            where: { id: channelId, tenantId },
          }),
        after: () =>
          database.channelAccount.update({
            data: { status: "connected" },
            where: { id: channelId, tenantId },
          }),
      },
    ];
    for (const item of cases) {
      const booking = await createAppointment(
        createTenantContext(tenantId),
        database,
        {
          serviceId,
          resourceId,
          contactId,
          startsAt: startsAt.toISOString(),
          idempotencyKey: `s08-${item.key}`,
          reminderPolicy: { conversationId, offsetMinutes: [30] },
        },
        { actorUserId: actorId, requestId: `${prefix}-${item.key}` },
      );
      const { reminder, task } = await claimReminderForTest(booking.id);
      await item.before();
      try {
        await expect(executeAppointmentReminder(database, task, new Date())).resolves.toMatchObject(
          {
            kind: "suppressed",
            reason: item.reason,
          },
        );
        await expect(
          database.appointmentReminder.findUniqueOrThrow({
            where: { tenantId_id: { id: reminder.id, tenantId } },
          }),
        ).resolves.toMatchObject({ status: "SUPPRESSED", reason: item.reason });
      } finally {
        await item.after();
      }
    }
  });

  it("rejects a reminder conversation attached to another contact without creating the booking", async () => {
    const otherContact = await database.contact.create({
      data: { tenantId, name: "Other Reminder Contact", phoneNumber: `+5288${Date.now()}` },
    });
    const otherConversation = await database.conversation.create({
      data: { tenantId, channelAccountId: channelId, contactId: otherContact.id, status: "open" },
    });
    const idempotencyKey = "s08-wrong-contact-policy";
    await expect(
      createAppointment(
        createTenantContext(tenantId),
        database,
        {
          serviceId,
          resourceId,
          contactId,
          startsAt: startsAt.toISOString(),
          idempotencyKey,
          reminderPolicy: { conversationId: otherConversation.id, offsetMinutes: [30] },
        },
        { actorUserId: actorId, requestId: `${prefix}-wrong-contact` },
      ),
    ).rejects.toBeInstanceOf(AppointmentReminderNotFoundError);
    await expect(database.appointment.count({ where: { tenantId, idempotencyKey } })).resolves.toBe(
      0,
    );
  });

  it("rejects a reminder conversation from another tenant", async () => {
    const otherTenant = await database.tenant.create({
      data: {
        displayName: "Foreign Reminder Tenant",
        legalName: "Foreign Reminder Tenant",
        slug: `${prefix}-foreign-${crypto.randomUUID()}`,
        status: "active",
        defaultTimezone: "UTC",
        defaultLocale: "es-MX",
        defaultCurrency: "MXN",
      },
    });
    const [otherContact, otherChannel] = await Promise.all([
      database.contact.create({
        data: {
          tenantId: otherTenant.id,
          name: "Foreign Reminder Contact",
          phoneNumber: `+5277${Date.now()}`,
        },
      }),
      database.channelAccount.create({
        data: {
          tenantId: otherTenant.id,
          active: true,
          displayName: "Foreign Reminder Channel",
          providerType: "mock",
          status: "connected",
        },
      }),
    ]);
    const otherConversation = await database.conversation.create({
      data: {
        tenantId: otherTenant.id,
        channelAccountId: otherChannel.id,
        contactId: otherContact.id,
        status: "open",
      },
    });
    const idempotencyKey = "s08-foreign-tenant-policy";
    await expect(
      createAppointment(
        createTenantContext(tenantId),
        database,
        {
          serviceId,
          resourceId,
          contactId,
          startsAt: startsAt.toISOString(),
          idempotencyKey,
          reminderPolicy: { conversationId: otherConversation.id, offsetMinutes: [30] },
        },
        { actorUserId: actorId, requestId: `${prefix}-foreign-tenant` },
      ),
    ).rejects.toBeInstanceOf(AppointmentReminderNotFoundError);
    await expect(database.appointment.count({ where: { tenantId, idempotencyKey } })).resolves.toBe(
      0,
    );
    const localBooking = await createAppointment(
      createTenantContext(tenantId),
      database,
      {
        serviceId,
        resourceId,
        contactId,
        startsAt: startsAt.toISOString(),
        idempotencyKey: "s08-cross-tenant-fk-booking",
      },
      { actorUserId: actorId, requestId: `${prefix}-cross-tenant-fk` },
    );
    await expect(
      database.appointmentReminder.create({
        data: {
          tenantId: otherTenant.id,
          appointmentId: localBooking.id,
          conversationId: otherConversation.id,
          offsetMinutes: 30,
          dueAt: new Date(),
          status: "SUPPRESSED",
          reason: "TEST_ONLY",
        },
      }),
    ).rejects.toThrow();
  });

  it("rolls back booking, reminder children, and durable task when reminder outbox append fails", async () => {
    const idempotencyKey = "s08-reminder-outbox-rollback";
    const taskCountBefore = await database.scheduledTask.count({
      where: { tenantId, taskType: "APPOINTMENT_REMINDER" },
    });
    const auditCountBefore = await database.auditLog.count({
      where: { tenantId, action: "appointment.reminders_configured" },
    });
    await database.$executeRawUnsafe(`CREATE FUNCTION e14_s08_reject_reminder_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'appointment.reminders_configured' THEN
          RAISE EXCEPTION 'intentional E14-S08 reminder outbox failure';
        END IF;
        RETURN NEW;
      END $$`);
    await database.$executeRawUnsafe(
      "CREATE TRIGGER e14_s08_reject_reminder_outbox BEFORE INSERT ON domain_event_outbox FOR EACH ROW EXECUTE FUNCTION e14_s08_reject_reminder_outbox()",
    );
    try {
      await expect(
        createAppointment(
          createTenantContext(tenantId),
          database,
          {
            serviceId,
            resourceId,
            contactId,
            startsAt: startsAt.toISOString(),
            idempotencyKey,
            reminderPolicy: { conversationId, offsetMinutes: [30] },
          },
          { actorUserId: actorId, requestId: `${prefix}-outbox-rollback` },
        ),
      ).rejects.toThrow("intentional E14-S08 reminder outbox failure");
      await expect(
        database.appointment.count({ where: { tenantId, idempotencyKey } }),
      ).resolves.toBe(0);
      await expect(
        database.scheduledTask.count({ where: { tenantId, taskType: "APPOINTMENT_REMINDER" } }),
      ).resolves.toBe(taskCountBefore);
      await expect(
        database.auditLog.count({
          where: { tenantId, action: "appointment.reminders_configured" },
        }),
      ).resolves.toBe(auditCountBefore);
    } finally {
      await database.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS e14_s08_reject_reminder_outbox ON domain_event_outbox",
      );
      await database.$executeRawUnsafe("DROP FUNCTION IF EXISTS e14_s08_reject_reminder_outbox()");
    }
  });

  it("does not create reminder rows when policy is omitted", async () => {
    const booking = await createAppointment(
      createTenantContext(tenantId),
      database,
      {
        serviceId,
        resourceId,
        contactId,
        startsAt: startsAt.toISOString(),
        idempotencyKey: "s08-no-reminders",
      },
      { actorUserId: actorId, requestId: `${prefix}-no-policy` },
    );
    expect(booking.reminderPolicy).toBeNull();
    expect(
      await database.appointmentReminder.count({ where: { appointmentId: booking.id, tenantId } }),
    ).toBe(0);
  });

  it("cancels old reminders and creates replacement tasks in the rebook transaction", async () => {
    const booking = await createAppointment(
      createTenantContext(tenantId),
      database,
      {
        serviceId,
        resourceId,
        contactId,
        startsAt: startsAt.toISOString(),
        idempotencyKey: "s08-rebook-source",
        reminderPolicy: { conversationId, offsetMinutes: [30] },
      },
      { actorUserId: actorId, requestId: `${prefix}-rebook-source` },
    );
    const original = await database.appointmentReminder.findFirstOrThrow({
      where: { appointmentId: booking.id, tenantId },
    });
    const replacement = await rebookAppointment(
      createTenantContext(tenantId),
      database,
      booking.id,
      {
        startsAt: new Date(startsAt.getTime() + 24 * 60 * 60_000).toISOString(),
        idempotencyKey: "s08-rebook-replacement",
      },
      { actorUserId: actorId, requestId: `${prefix}-rebook` },
    );
    const oldReminder = await database.appointmentReminder.findUniqueOrThrow({
      where: { tenantId_id: { id: original.id, tenantId } },
      include: { task: true },
    });
    const replacementReminder = await database.appointmentReminder.findFirstOrThrow({
      where: { appointmentId: replacement.id, tenantId },
      include: { task: true },
    });
    expect(oldReminder).toMatchObject({ status: "CANCELLED", task: { status: "CANCELLED" } });
    expect(replacement.reminderPolicy).toEqual(booking.reminderPolicy);
    expect(replacementReminder).toMatchObject({
      status: "PENDING",
      task: { status: "PENDING", taskType: "APPOINTMENT_REMINDER" },
    });
    expect(replacementReminder.id).not.toBe(original.id);
  });

  it("keeps inherited policy but suppresses rebook reminders when scheduling is disabled", async () => {
    const booking = await createAppointment(
      createTenantContext(tenantId),
      database,
      {
        serviceId,
        resourceId,
        contactId,
        startsAt: new Date(startsAt.getTime() + 48 * 60 * 60_000).toISOString(),
        idempotencyKey: "s08-rebook-disabled-source",
        reminderPolicy: { conversationId, offsetMinutes: [30] },
      },
      { actorUserId: actorId, requestId: `${prefix}-rebook-disabled-source` },
    );
    await database.tenantEntitlement.update({
      data: { enabled: false },
      where: { tenantId_entitlementKey: { tenantId, entitlementKey: "module.scheduling" } },
    });
    try {
      const replacement = await rebookAppointment(
        createTenantContext(tenantId),
        database,
        booking.id,
        {
          startsAt: new Date(startsAt.getTime() + 72 * 60 * 60_000).toISOString(),
          idempotencyKey: "s08-rebook-disabled-replacement",
        },
        { actorUserId: actorId, requestId: `${prefix}-rebook-disabled` },
      );
      const reminder = await database.appointmentReminder.findFirstOrThrow({
        where: { appointmentId: replacement.id, tenantId },
      });
      expect(replacement.reminderPolicy).toEqual(booking.reminderPolicy);
      expect(reminder).toMatchObject({
        status: "SUPPRESSED",
        reason: "MODULE_DISABLED",
        taskId: null,
      });
    } finally {
      await database.tenantEntitlement.update({
        data: { enabled: true },
        where: { tenantId_entitlementKey: { tenantId, entitlementKey: "module.scheduling" } },
      });
    }
  });

  it("cancels pending reminders even when scheduling is disabled", async () => {
    const booking = await createAppointment(
      createTenantContext(tenantId),
      database,
      {
        serviceId,
        resourceId,
        contactId,
        startsAt: new Date(startsAt.getTime() + 96 * 60 * 60_000).toISOString(),
        idempotencyKey: "s08-cancel-source",
        reminderPolicy: { conversationId, offsetMinutes: [30] },
      },
      { actorUserId: actorId, requestId: `${prefix}-cancel-source` },
    );
    const reminder = await database.appointmentReminder.findFirstOrThrow({
      where: { appointmentId: booking.id, tenantId },
    });
    await database.tenantEntitlement.update({
      data: { enabled: false },
      where: { tenantId_entitlementKey: { tenantId, entitlementKey: "module.scheduling" } },
    });
    try {
      await cancelAppointment(createTenantContext(tenantId), database, booking.id, {
        actorUserId: actorId,
        requestId: `${prefix}-cancel`,
      });
      await expect(
        database.appointmentReminder.findUniqueOrThrow({
          where: { tenantId_id: { id: reminder.id, tenantId } },
          include: { task: true },
        }),
      ).resolves.toMatchObject({ status: "CANCELLED", task: { status: "CANCELLED" } });
    } finally {
      await database.tenantEntitlement.update({
        data: { enabled: true },
        where: { tenantId_entitlementKey: { tenantId, entitlementKey: "module.scheduling" } },
      });
    }
  });
});
