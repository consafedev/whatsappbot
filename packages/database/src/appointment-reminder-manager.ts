import { lockConversationInTransaction } from "./conversation-manager";
import type { Appointment, Prisma, PrismaClient, ScheduledTask } from "./generated/prisma/client";
import { createOutboundConversationMessageManager } from "./outbound-conversation-message-manager";
import { createPostgresWorkflowOrchestrator } from "./postgres-workflow-orchestrator";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess } from "./tenant-data-access";
import { assertTenantModuleEntitled, createTenantEntitlementResolver } from "./tenant-entitlements";
import { assertTenantOperational, TenantNotOperationalError } from "./tenant-operational";

export const APPOINTMENT_REMINDER_TASK_TYPE = "APPOINTMENT_REMINDER";
export const APPOINTMENT_REMINDER_POLICY_KEYS = ["conversationId", "offsetMinutes"] as const;

export type AppointmentReminderPolicy = Readonly<{
  conversationId: string;
  offsetMinutes: readonly number[];
}>;

export type AppointmentReminderRecord = Readonly<{
  id: string;
  tenantId: string;
  appointmentId: string;
  conversationId: string;
  offsetMinutes: number;
  dueAt: Date;
  status: string;
  reason: string | null;
  taskId: string | null;
  taskStatus: string | null;
  outboundMessageId: string | null;
  outboundStatus: string | null;
}>;

export class AppointmentReminderNotFoundError extends Error {
  override readonly name = "AppointmentReminderNotFoundError";

  constructor() {
    super("Appointment reminder was not found");
  }
}

export class AppointmentReminderTaskMismatchError extends Error {
  override readonly name = "AppointmentReminderTaskMismatchError";

  constructor() {
    super("Scheduled task does not match a persisted appointment reminder");
  }
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeAppointmentReminderPolicy(
  value: unknown,
): AppointmentReminderPolicy | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("reminderPolicy must be an object or null");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== APPOINTMENT_REMINDER_POLICY_KEYS.length ||
    Object.keys(record).some((key) => !APPOINTMENT_REMINDER_POLICY_KEYS.includes(key as never))
  ) {
    throw new TypeError("reminderPolicy contains unknown fields");
  }
  if (typeof record.conversationId !== "string" || !UUID_V7.test(record.conversationId)) {
    throw new TypeError("reminderPolicy.conversationId must be a UUIDv7");
  }
  if (
    !Array.isArray(record.offsetMinutes) ||
    record.offsetMinutes.length < 1 ||
    record.offsetMinutes.length > 3
  ) {
    throw new TypeError("reminderPolicy.offsetMinutes must contain one to three offsets");
  }
  const offsets = record.offsetMinutes as unknown[];
  if (
    offsets.some(
      (offset) => !Number.isInteger(offset) || Number(offset) < 1 || Number(offset) > 10080,
    )
  ) {
    throw new TypeError("reminderPolicy offsets must be integers from 1 to 10080 minutes");
  }
  const sorted = (offsets as number[]).slice().sort((left, right) => left - right);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError("reminderPolicy offsets must be distinct");
  }
  return { conversationId: record.conversationId.toLowerCase(), offsetMinutes: sorted };
}

function jsonPolicy(value: Prisma.JsonValue | null): AppointmentReminderPolicy | null {
  return normalizeAppointmentReminderPolicy(value);
}

function activeConversation(status: string): boolean {
  return status === "new" || status === "open" || status === "pending";
}

async function reminderTargetReason(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  contactId: string,
  conversationId: string,
): Promise<string | null> {
  const conversation = await transaction.conversation.findUnique({
    select: {
      channelAccount: { select: { active: true, status: true } },
      contact: { select: { id: true, status: true } },
      contactId: true,
      status: true,
    },
    where: { tenantId_id: { tenantId, id: conversationId } },
  });
  if (
    conversation === null ||
    conversation.contactId !== contactId ||
    conversation.contact.status !== "ACTIVE" ||
    !activeConversation(conversation.status) ||
    !conversation.channelAccount.active ||
    conversation.channelAccount.status !== "connected"
  ) {
    return "TARGET_UNAVAILABLE";
  }
  return null;
}

async function hasReminderModules(
  tenant: TenantContext,
  transaction: Prisma.TransactionClient,
  now: Date,
): Promise<boolean> {
  const entitlements = createTenantEntitlementResolver(tenant, transaction);
  const keys = [
    "module.appointments",
    "module.scheduling",
    "module.messaging.basic",
    "module.crm_lite",
  ] as const;
  for (const key of keys) {
    if (!(await entitlements.isModuleEnabled(key, now))) return false;
  }
  return true;
}

export async function scheduleAppointmentRemindersInTransaction(
  tenant: TenantContext,
  transaction: Prisma.TransactionClient,
  appointment: Pick<Appointment, "contactId" | "id" | "startsAt" | "tenantId">,
  policy: AppointmentReminderPolicy | null,
  options: Readonly<{ inherited: boolean; now?: Date }>,
): Promise<void> {
  if (policy === null) return;
  const now = options.now ?? new Date();
  const normalized = normalizeAppointmentReminderPolicy(policy);
  if (normalized === null) return;
  const tenantContext = createTenantContext(tenant.tenantId);
  const targetReason = await reminderTargetReason(
    transaction,
    tenantContext.tenantId,
    appointment.contactId,
    normalized.conversationId,
  );
  if (!options.inherited) {
    await assertTenantOperational(tenantContext, transaction);
    await assertTenantModuleEntitled(tenantContext, "module.appointments", transaction, now);
    await assertTenantModuleEntitled(tenantContext, "module.scheduling", transaction, now);
    await assertTenantModuleEntitled(tenantContext, "module.messaging.basic", transaction, now);
    await assertTenantModuleEntitled(tenantContext, "module.crm_lite", transaction, now);
    if (targetReason !== null) throw new AppointmentReminderNotFoundError();
  }
  const modulesEnabled = await hasReminderModules(tenantContext, transaction, now);
  const workflow = createPostgresWorkflowOrchestrator(transaction);
  const records: Array<{
    dueAt: Date;
    id: string;
    offsetMinutes: number;
    reason: string | null;
    status: "PENDING" | "SUPPRESSED";
    taskId: string | null;
  }> = [];

  for (const offsetMinutes of normalized.offsetMinutes) {
    const dueAt = new Date(appointment.startsAt.getTime() - offsetMinutes * 60_000);
    let reason: string | null = null;
    if (dueAt <= now) reason = "PAST_DUE";
    else if (!modulesEnabled) reason = "MODULE_DISABLED";
    else if (targetReason !== null) reason = targetReason;

    const uuidRow = (await transaction.$queryRaw<Array<{ id: string }>>`SELECT uuidv7() AS id`)[0];
    if (uuidRow === undefined) throw new Error("Could not allocate a reminder ID");
    const { id } = uuidRow;
    let taskId: string | null = null;
    if (reason === null) {
      const ref = await workflow.schedule({
        id,
        tenantId: tenantContext.tenantId,
        taskType: APPOINTMENT_REMINDER_TASK_TYPE,
        name: "Recordatorio de cita",
        runAt: dueAt,
        payload: { reminderId: id },
      });
      taskId = ref.id;
    }
    await transaction.appointmentReminder.create({
      data: {
        id,
        tenantId: tenantContext.tenantId,
        appointmentId: appointment.id,
        conversationId: normalized.conversationId,
        offsetMinutes,
        dueAt,
        status: reason === null ? "PENDING" : "SUPPRESSED",
        reason,
        taskId,
      },
    });
    records.push({
      dueAt,
      id,
      offsetMinutes,
      reason,
      status: reason === null ? "PENDING" : "SUPPRESSED",
      taskId,
    });
  }

  const access = createTenantDataAccess(tenantContext, transaction);
  await access.audit.append({
    action: "appointment.reminders_configured",
    actorId: "system",
    actorType: "system",
    afterSummary: {
      appointmentId: appointment.id,
      conversationId: normalized.conversationId,
      offsets: records.map(({ offsetMinutes, status, reason }) => ({
        offsetMinutes,
        status,
        reason,
      })),
    },
    entityId: appointment.id,
    entityType: "Appointment",
    requestId: "appointment-reminder-schedule",
  });
  await access.outbox.append({
    aggregateId: appointment.id,
    aggregateType: "Appointment",
    eventType: "appointment.reminders_configured",
    payload: {
      tenantId: tenantContext.tenantId,
      appointmentId: appointment.id,
      conversationId: normalized.conversationId,
      reminders: records.map(({ id, dueAt, offsetMinutes, status, reason }) => ({
        id,
        dueAt: dueAt.toISOString(),
        offsetMinutes,
        status,
        reason,
      })),
    },
  });
}

export async function cancelAppointmentRemindersInTransaction(
  tenant: TenantContext,
  transaction: Prisma.TransactionClient,
  appointmentId: string,
): Promise<void> {
  const tenantContext = createTenantContext(tenant.tenantId);
  const reminders = await transaction.appointmentReminder.findMany({
    select: { id: true, status: true, taskId: true },
    where: {
      tenantId: tenantContext.tenantId,
      appointmentId,
      status: { in: ["PENDING", "QUEUED"] },
    },
    orderBy: { id: "asc" },
  });
  const workflow = createPostgresWorkflowOrchestrator(transaction);
  for (const reminder of reminders) {
    if (reminder.taskId !== null) {
      await workflow.cancel({ id: reminder.taskId, tenantId: tenantContext.tenantId });
    }
    await transaction.appointmentReminder.updateMany({
      data: { status: "CANCELLED", reason: null },
      where: {
        id: reminder.id,
        tenantId: tenantContext.tenantId,
        status: { in: ["PENDING", "QUEUED"] },
      },
    });
  }
}

export type AppointmentReminderExecutionDatabase = Pick<
  PrismaClient,
  | "$transaction"
  | "appointmentReminder"
  | "appointment"
  | "scheduledTask"
  | "conversation"
  | "channelAccount"
  | "contact"
  | "tenant"
  | "tenantEntitlement"
  | "outboundMessage"
  | "message"
>;

export type AppointmentReminderExecutionResult = Readonly<
  | { kind: "queued"; outboundMessageId: string }
  | { kind: "suppressed"; reason: string }
  | { kind: "already-handled" }
>;

function jsonMetadata(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function reminderText(appointment: Appointment & { service: { name: string } }): string {
  const start = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: appointment.timezoneSnapshot,
  }).format(appointment.startsAt);
  return `Te recordamos tu cita de ${appointment.service.name} el ${start} (${appointment.timezoneSnapshot}).`;
}

async function suppressReminderInTransaction(
  tenant: TenantContext,
  transaction: Prisma.TransactionClient,
  reminder: { id: string; appointmentId: string; offsetMinutes: number },
  reason: string,
  occurredAt = new Date(),
): Promise<AppointmentReminderExecutionResult> {
  await transaction.appointmentReminder.update({
    data: { status: "SUPPRESSED", reason },
    where: { tenantId_id: { id: reminder.id, tenantId: tenant.tenantId } },
  });
  const access = createTenantDataAccess(tenant, transaction);
  await access.audit.append({
    action: "appointment.reminder_suppressed",
    actorId: "system",
    actorType: "system",
    afterSummary: {
      appointmentId: reminder.appointmentId,
      offsetMinutes: reminder.offsetMinutes,
      reason,
    },
    entityId: reminder.id,
    entityType: "AppointmentReminder",
    requestId: "appointment-reminder-worker",
  });
  await access.outbox.append({
    aggregateId: reminder.id,
    aggregateType: "AppointmentReminder",
    eventType: "appointment.reminder_suppressed",
    payload: {
      tenantId: tenant.tenantId,
      appointmentId: reminder.appointmentId,
      reminderId: reminder.id,
      offsetMinutes: reminder.offsetMinutes,
      reason,
      occurredAt: occurredAt.toISOString(),
    },
  });
  return { kind: "suppressed", reason };
}

export async function executeAppointmentReminder(
  database: AppointmentReminderExecutionDatabase,
  task: Pick<ScheduledTask, "id" | "tenantId" | "taskType" | "scheduledFor" | "status">,
  nowOrClock: Date | (() => Date) = () => new Date(),
): Promise<AppointmentReminderExecutionResult> {
  if (task.taskType !== APPOINTMENT_REMINDER_TASK_TYPE || task.status !== "PROCESSING") {
    throw new AppointmentReminderTaskMismatchError();
  }
  const clock = typeof nowOrClock === "function" ? nowOrClock : () => nowOrClock;
  const tenant = createTenantContext(task.tenantId);
  return database.$transaction(async (transaction) => {
    const initial = await transaction.appointmentReminder.findFirst({
      select: { appointmentId: true, conversationId: true, id: true },
      where: { taskId: task.id, tenantId: tenant.tenantId },
    });
    if (initial === null || initial.id !== task.id)
      throw new AppointmentReminderTaskMismatchError();
    const initialConversation = await transaction.conversation.findUnique({
      select: { channelAccountId: true, contactId: true },
      where: { tenantId_id: { id: initial.conversationId, tenantId: tenant.tenantId } },
    });
    if (initialConversation === null) throw new AppointmentReminderTaskMismatchError();
    await lockConversationInTransaction(
      transaction,
      tenant.tenantId,
      initialConversation.channelAccountId,
      initialConversation.contactId,
    );

    await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM appointments
      WHERE tenant_id = ${tenant.tenantId}::uuid AND id = ${initial.appointmentId}::uuid
      FOR UPDATE`;
    await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM appointment_reminders
      WHERE tenant_id = ${tenant.tenantId}::uuid AND id = ${initial.id}::uuid
      FOR UPDATE`;
    const reminder = await transaction.appointmentReminder.findUnique({
      where: { tenantId_id: { id: initial.id, tenantId: tenant.tenantId } },
    });
    const appointment = await transaction.appointment.findUnique({
      include: { service: { select: { name: true } } },
      where: { tenantId_id: { id: initial.appointmentId, tenantId: tenant.tenantId } },
    });
    const persistedTask = await transaction.scheduledTask.findUnique({
      where: { tenantId_id: { id: task.id, tenantId: tenant.tenantId } },
    });
    const conversation = await transaction.conversation.findUnique({
      include: { channelAccount: true, contact: true },
      where: { tenantId_id: { id: initial.conversationId, tenantId: tenant.tenantId } },
    });
    if (
      reminder === null ||
      appointment === null ||
      persistedTask === null ||
      conversation === null ||
      reminder.id !== task.id ||
      reminder.taskId !== task.id ||
      reminder.appointmentId !== appointment.id ||
      reminder.conversationId !== conversation.id ||
      persistedTask.taskType !== APPOINTMENT_REMINDER_TASK_TYPE
    ) {
      throw new AppointmentReminderTaskMismatchError();
    }
    if (
      reminder.status === "CANCELLED" ||
      reminder.status === "SUPPRESSED" ||
      persistedTask.status === "CANCELLED" ||
      persistedTask.status === "COMPLETED"
    ) {
      return { kind: "already-handled" };
    }
    if (
      persistedTask.status !== "PROCESSING" ||
      persistedTask.scheduledFor.getTime() !== task.scheduledFor.getTime()
    ) {
      throw new AppointmentReminderTaskMismatchError();
    }
    if (reminder.status === "QUEUED" && reminder.outboundMessageId !== null) {
      return { kind: "already-handled" };
    }
    const now = clock();

    let tenantOperational = true;
    try {
      await assertTenantOperational(tenant, transaction);
    } catch (error) {
      if (error instanceof TenantNotOperationalError) tenantOperational = false;
      else throw error;
    }
    if (!tenantOperational)
      return suppressReminderInTransaction(tenant, transaction, reminder, "TENANT_DISABLED");
    if (!(await hasReminderModules(tenant, transaction, now))) {
      return suppressReminderInTransaction(tenant, transaction, reminder, "MODULE_DISABLED");
    }
    if (appointment.status !== "REQUESTED" && appointment.status !== "CONFIRMED") {
      return suppressReminderInTransaction(tenant, transaction, reminder, "APPOINTMENT_INACTIVE");
    }
    if (appointment.confirmationStatus !== "CONFIRMED") {
      return suppressReminderInTransaction(
        tenant,
        transaction,
        reminder,
        "APPOINTMENT_UNCONFIRMED",
      );
    }
    if (appointment.startsAt <= now) {
      return suppressReminderInTransaction(
        tenant,
        transaction,
        reminder,
        "APPOINTMENT_INACTIVE",
        now,
      );
    }
    if (reminder.dueAt > now) {
      return suppressReminderInTransaction(tenant, transaction, reminder, "NOT_DUE", now);
    }
    if (
      appointment.contactId !== conversation.contactId ||
      conversation.contact.status !== "ACTIVE" ||
      !activeConversation(conversation.status)
    ) {
      return suppressReminderInTransaction(tenant, transaction, reminder, "TARGET_UNAVAILABLE");
    }
    if (!conversation.channelAccount.active || conversation.channelAccount.status !== "connected") {
      return suppressReminderInTransaction(tenant, transaction, reminder, "CHANNEL_UNAVAILABLE");
    }
    if (conversation.automationMode !== "AUTO") {
      return suppressReminderInTransaction(
        tenant,
        transaction,
        reminder,
        conversation.automationMode === "ASSISTED" ? "APPROVAL_REQUIRED" : "AUTOMATION_PAUSED",
      );
    }
    const metadata = jsonMetadata(conversation.metadata);
    if (metadata.automationPausedAt !== null && metadata.automationPausedAt !== undefined) {
      return suppressReminderInTransaction(tenant, transaction, reminder, "AUTOMATION_PAUSED");
    }
    if (conversation.humanTakeoverUntil !== null && conversation.humanTakeoverUntil > now) {
      return suppressReminderInTransaction(tenant, transaction, reminder, "HUMAN_TAKEOVER");
    }

    const outbound = createOutboundConversationMessageManager(database);
    const sent = await outbound.sendConversationMessage(
      tenant,
      conversation.id,
      {
        actorUserId: null,
        content: { text: reminderText(appointment) },
        idempotencyKey: `appointment-reminder:${appointment.id}:${reminder.offsetMinutes}`,
        messageType: "text",
        requestId: "appointment-reminder-worker",
      },
      transaction,
    );
    await transaction.appointmentReminder.update({
      data: { outboundMessageId: sent.outboundMessage.id, status: "QUEUED" },
      where: { tenantId_id: { id: reminder.id, tenantId: tenant.tenantId } },
    });
    return { kind: "queued", outboundMessageId: sent.outboundMessage.id };
  });
}

export type AppointmentReminderDispatchMessage = Readonly<{
  channelAccountId: string;
  id: string;
  recipientPhone: string;
  tenantId: string;
}>;

/**
 * Revalidates reminder authority after queueing and rate limiting. The returned
 * suppression is committed before it is raised to the dispatcher, so the
 * dispatcher can permanently fail the outbound row without rolling this state
 * change back. Ordinary outbound rows have no reminder link and pass through.
 */
export async function authorizeAppointmentReminderDispatch(
  database: PrismaClient,
  message: AppointmentReminderDispatchMessage,
  nowOrClock: Date | (() => Date) = () => new Date(),
): Promise<void> {
  const clock = typeof nowOrClock === "function" ? nowOrClock : () => nowOrClock;
  const tenant = createTenantContext(message.tenantId);
  let suppressedReason: string | null;
  try {
    suppressedReason = await database.$transaction(async (transaction) => {
      const initial = await transaction.appointmentReminder.findFirst({
        select: { appointmentId: true, conversationId: true, id: true },
        where: { outboundMessageId: message.id, tenantId: tenant.tenantId },
      });
      if (initial === null) return null;
      const initialConversation = await transaction.conversation.findUnique({
        select: { channelAccountId: true, contactId: true },
        where: { tenantId_id: { id: initial.conversationId, tenantId: tenant.tenantId } },
      });
      if (initialConversation === null) return "TARGET_UNAVAILABLE";
      await lockConversationInTransaction(
        transaction,
        tenant.tenantId,
        initialConversation.channelAccountId,
        initialConversation.contactId,
      );
      await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM appointments
      WHERE tenant_id = ${tenant.tenantId}::uuid AND id = ${initial.appointmentId}::uuid
      FOR UPDATE`;
      await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM appointment_reminders
      WHERE tenant_id = ${tenant.tenantId}::uuid AND id = ${initial.id}::uuid
      FOR UPDATE`;
      const reminder = await transaction.appointmentReminder.findUnique({
        where: { tenantId_id: { id: initial.id, tenantId: tenant.tenantId } },
      });
      const appointment = await transaction.appointment.findUnique({
        where: { tenantId_id: { id: initial.appointmentId, tenantId: tenant.tenantId } },
      });
      const conversation = await transaction.conversation.findUnique({
        include: { channelAccount: true, contact: true },
        where: { tenantId_id: { id: initial.conversationId, tenantId: tenant.tenantId } },
      });
      const outbound = await transaction.outboundMessage.findUnique({
        where: { id: message.id, tenantId: tenant.tenantId },
      });
      if (
        reminder === null ||
        appointment === null ||
        conversation === null ||
        outbound === null ||
        reminder.appointmentId !== appointment.id ||
        reminder.conversationId !== conversation.id ||
        reminder.outboundMessageId !== outbound.id ||
        outbound.channelAccountId !== message.channelAccountId ||
        conversation.channelAccountId !== message.channelAccountId
      ) {
        return "TARGET_UNAVAILABLE";
      }
      const now = clock();
      if (reminder.status !== "QUEUED") return reminder.reason ?? "REMINDER_INACTIVE";
      if (outbound.status !== "SENDING") return "OUTBOUND_INACTIVE";
      let operational = true;
      try {
        await assertTenantOperational(tenant, transaction);
      } catch (error) {
        if (error instanceof TenantNotOperationalError) operational = false;
        else throw error;
      }
      if (!operational) {
        await suppressReminderInTransaction(tenant, transaction, reminder, "TENANT_DISABLED", now);
        return "TENANT_DISABLED";
      }
      if (!(await hasReminderModules(tenant, transaction, now))) {
        await suppressReminderInTransaction(tenant, transaction, reminder, "MODULE_DISABLED", now);
        return "MODULE_DISABLED";
      }
      if (
        (appointment.status !== "REQUESTED" && appointment.status !== "CONFIRMED") ||
        appointment.confirmationStatus !== "CONFIRMED" ||
        appointment.startsAt <= now
      ) {
        await suppressReminderInTransaction(
          tenant,
          transaction,
          reminder,
          "APPOINTMENT_INACTIVE",
          now,
        );
        return "APPOINTMENT_INACTIVE";
      }
      if (
        appointment.contactId !== conversation.contactId ||
        conversation.contact.status !== "ACTIVE" ||
        !activeConversation(conversation.status)
      ) {
        await suppressReminderInTransaction(
          tenant,
          transaction,
          reminder,
          "TARGET_UNAVAILABLE",
          now,
        );
        return "TARGET_UNAVAILABLE";
      }
      if (
        !conversation.channelAccount.active ||
        conversation.channelAccount.status !== "connected"
      ) {
        await suppressReminderInTransaction(
          tenant,
          transaction,
          reminder,
          "CHANNEL_UNAVAILABLE",
          now,
        );
        return "CHANNEL_UNAVAILABLE";
      }
      if (
        conversation.contact.phoneNumber !== message.recipientPhone ||
        outbound.recipientPhone !== message.recipientPhone
      ) {
        await suppressReminderInTransaction(
          tenant,
          transaction,
          reminder,
          "RECIPIENT_CHANGED",
          now,
        );
        return "RECIPIENT_CHANGED";
      }
      if (conversation.automationMode !== "AUTO") {
        const reason =
          conversation.automationMode === "ASSISTED" ? "APPROVAL_REQUIRED" : "AUTOMATION_PAUSED";
        await suppressReminderInTransaction(tenant, transaction, reminder, reason, now);
        return reason;
      }
      const metadata = jsonMetadata(conversation.metadata);
      if (metadata.automationPausedAt !== null && metadata.automationPausedAt !== undefined) {
        await suppressReminderInTransaction(
          tenant,
          transaction,
          reminder,
          "AUTOMATION_PAUSED",
          now,
        );
        return "AUTOMATION_PAUSED";
      }
      if (conversation.humanTakeoverUntil !== null && conversation.humanTakeoverUntil > now) {
        await suppressReminderInTransaction(tenant, transaction, reminder, "HUMAN_TAKEOVER", now);
        return "HUMAN_TAKEOVER";
      }
      await transaction.appointmentReminder.update({
        data: { dispatchAuthorizedAt: now },
        where: { tenantId_id: { id: reminder.id, tenantId: tenant.tenantId } },
      });
      return null;
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("REMINDER_DISPATCH_SUPPRESSED:")) {
      throw error;
    }
    throw new Error("REMINDER_DISPATCH_GUARD_UNAVAILABLE");
  }
  if (suppressedReason !== null) {
    throw new Error(`REMINDER_DISPATCH_SUPPRESSED:${suppressedReason}`);
  }
}

export async function listAppointmentReminders(
  tenant: TenantContext,
  database: Pick<
    Prisma.TransactionClient,
    "appointment" | "appointmentReminder" | "tenant" | "tenantEntitlement"
  >,
  appointmentId: string,
): Promise<AppointmentReminderRecord[]> {
  const context = createTenantContext(tenant.tenantId);
  await assertTenantOperational(context, database);
  await assertTenantModuleEntitled(context, "module.appointments", database);
  const appointment = await database.appointment.findFirst({
    select: { id: true },
    where: { id: appointmentId, tenantId: context.tenantId },
  });
  if (appointment === null) throw new AppointmentReminderNotFoundError();
  const reminders = await database.appointmentReminder.findMany({
    include: {
      outbound: { select: { status: true } },
      task: { select: { status: true } },
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    where: { appointmentId, tenantId: context.tenantId },
  });
  return reminders.map((reminder) => ({
    id: reminder.id,
    tenantId: reminder.tenantId,
    appointmentId: reminder.appointmentId,
    conversationId: reminder.conversationId,
    offsetMinutes: reminder.offsetMinutes,
    dueAt: reminder.dueAt,
    status: reminder.status,
    reason: reminder.reason,
    taskId: reminder.taskId,
    taskStatus: reminder.task?.status ?? null,
    outboundMessageId: reminder.outboundMessageId,
    outboundStatus: reminder.outbound?.status ?? null,
  }));
}

export function appointmentReminderPolicyFromJson(
  value: Prisma.JsonValue | null,
): AppointmentReminderPolicy | null {
  return jsonPolicy(value);
}
