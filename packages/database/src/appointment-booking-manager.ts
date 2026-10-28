import { createHash, randomBytes } from "node:crypto";
import {
  type AppointmentBookingPolicy,
  type AppointmentBookingRuleDefinition,
  hashAppointmentBookingRuleDefinition,
  normalizeAppointmentBookingPolicy,
} from "./appointment-booking-policy";
import {
  cancelAppointmentInTransaction,
  createAppointmentInTransaction,
  normalizeCreateAppointmentInput,
  rebookAppointmentInTransaction,
} from "./appointment-manager";
import {
  AppointmentAvailabilityTargetNotFoundError,
  findAppointmentAvailability,
} from "./appointment-slot-query";
import { lockConversationInTransaction } from "./conversation-manager";
import type { Prisma } from "./generated/prisma/client";
import {
  createOutboundConversationMessageManager,
  type OutboundConversationMessageManagerDatabase,
} from "./outbound-conversation-message-manager";
import { createTenantContext, type TenantContext } from "./tenant-context";
import {
  assertTenantModuleEntitled,
  TenantModuleEntitlementRequiredError,
} from "./tenant-entitlements";
import { assertTenantOperational, TenantNotOperationalError } from "./tenant-operational";

export type AppointmentBookingRouteDecision =
  | Readonly<{ kind: "LEGACY" }>
  | Readonly<{
      kind: "BOOKING";
      ruleId: string;
      trigger: "ON_MESSAGE_RECEIVED";
      policy: AppointmentBookingPolicy;
      policyHash: string;
    }>;

export type AppointmentBookingRouteSelector = (
  transaction: Prisma.TransactionClient,
  message: Readonly<{
    id: string;
    conversationId: string;
    contactId: string;
    channelAccountId: string;
    createdNewConversation: boolean;
    textBody: string | null;
  }>,
) => Promise<AppointmentBookingRouteDecision>;

export type AppointmentBookingTurnResult = Readonly<{
  route: "LEGACY" | "BOOKING";
  legacyShouldRun: boolean;
  duplicate: boolean;
  handled: boolean;
  outboundMessageId?: string;
  appointmentId?: string;
}>;

export type AppointmentBookingDatabase = OutboundConversationMessageManagerDatabase &
  Pick<
    Prisma.TransactionClient,
    | "appointmentBookingFlow"
    | "appointmentBookingTurn"
    | "appointment"
    | "rule"
    | "conversation"
    | "message"
    | "tenant"
    | "tenantEntitlement"
    | "channelAccount"
    | "contact"
    | "appointmentService"
    | "appointmentResource"
    | "appointmentAvailabilityRule"
    | "appointmentAvailabilityException"
    | "appointmentReminder"
    | "scheduledTask"
    | "user"
  >;

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FLOW_TTL_MS = 15 * 60_000;

function uuid(value: string): boolean {
  return UUID_V7.test(value);
}
function jsonObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function confirmation(
  flowId: string,
  intent: string,
  version: number,
  proposal: string,
): { token: string; hash: string } {
  const secret = randomBytes(18).toString("base64url");
  const token = `CONFIRM-${secret}`;
  return { token, hash: tokenHash(`${flowId}:${intent}:${version}:${proposal}:${token}`) };
}
function persistedPolicy(value: unknown): AppointmentBookingPolicy {
  return normalizeAppointmentBookingPolicy(value);
}
async function currentConversation(
  tenant: TenantContext,
  transaction: Prisma.TransactionClient,
  conversationId: string,
) {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "conversation" WHERE tenant_id = ${tenant.tenantId}::uuid AND id = ${conversationId}::uuid FOR UPDATE`;
  if (rows.length !== 1) return null;
  return transaction.conversation.findFirst({
    where: { id: conversationId, tenantId: tenant.tenantId },
  });
}

async function authorizeTurn(
  tenant: TenantContext,
  transaction: Prisma.TransactionClient,
  conversationId: string,
) {
  try {
    await assertTenantOperational(tenant, transaction);
    await assertTenantModuleEntitled(tenant, "module.automation.basic", transaction);
    await assertTenantModuleEntitled(tenant, "module.appointments", transaction);
    await assertTenantModuleEntitled(tenant, "module.messaging.basic", transaction);
    await assertTenantModuleEntitled(tenant, "module.crm_lite", transaction);
  } catch (error) {
    if (
      error instanceof TenantModuleEntitlementRequiredError ||
      error instanceof TenantNotOperationalError
    )
      return null;
    throw error;
  }
  const conversation = await currentConversation(tenant, transaction, conversationId);
  const metadata = jsonObject(conversation?.metadata);
  if (
    conversation === null ||
    !["new", "open", "pending"].includes(conversation.status) ||
    conversation.automationMode !== "AUTO" ||
    (conversation.humanTakeoverUntil !== null && conversation.humanTakeoverUntil > new Date()) ||
    metadata?.automationPausedAt != null ||
    (typeof metadata?.automationPausedReason === "string" &&
      metadata.automationPausedReason.trim() !== "")
  )
    return null;
  const channel = await transaction.channelAccount.findFirst({
    where: { id: conversation.channelAccountId, tenantId: tenant.tenantId, active: true },
    select: { id: true, status: true },
  });
  if (channel === null || ["archived", "disabled", "disconnected"].includes(channel.status))
    return null;
  const contact = await transaction.contact.findFirst({
    where: { id: conversation.contactId, tenantId: tenant.tenantId, status: "ACTIVE" },
    select: { id: true },
  });
  return contact === null ? null : conversation;
}

export async function createAppointmentBookingTurnPlaceholderInTransaction(
  tenantContext: TenantContext,
  transaction: Prisma.TransactionClient,
  inboundMessageId: string,
  createdNewConversation: boolean,
): Promise<void> {
  const tenant = createTenantContext(tenantContext.tenantId);
  if (!uuid(inboundMessageId)) throw new TypeError("inboundMessageId must be UUIDv7");
  const message = await transaction.message.findFirst({
    where: { id: inboundMessageId, tenantId: tenant.tenantId, direction: "inbound" },
    select: { id: true, conversationId: true, contactId: true, channelAccountId: true },
  });
  if (
    message === null ||
    message.conversationId === null ||
    message.contactId === null ||
    message.channelAccountId === null
  )
    throw new Error("Persisted customer message context is incomplete");
  await transaction.appointmentBookingTurn.createMany({
    data: [
      {
        tenantId: tenant.tenantId,
        inboundMessageId: message.id,
        conversationId: message.conversationId,
        contactId: message.contactId,
        channelAccountId: message.channelAccountId,
        createdNewConversation,
        route: "UNDECIDED",
      },
    ],
    skipDuplicates: true,
  });
}

async function lockAndReadRule(
  tenant: TenantContext,
  transaction: Prisma.TransactionClient,
  ruleId: string,
) {
  if (!uuid(ruleId)) return null;
  const locked = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "rule" WHERE tenant_id = ${tenant.tenantId}::uuid AND id = ${ruleId}::uuid FOR SHARE`;
  if (locked.length !== 1) return null;
  return transaction.rule.findFirst({ where: { id: ruleId, tenantId: tenant.tenantId } });
}

function verifiedBookingRule(
  rule: NonNullable<Awaited<ReturnType<typeof lockAndReadRule>>>,
  decision: Extract<AppointmentBookingRouteDecision, { kind: "BOOKING" }>,
  tenantId: string,
): boolean {
  const actions = Array.isArray(rule.actions) ? rule.actions : [];
  if (
    rule.status !== "active" ||
    rule.triggerType !== "ON_MESSAGE_RECEIVED" ||
    rule.executionMode !== "first_match_stop" ||
    actions.length !== 1 ||
    jsonObject(actions[0])?.actionType !== "start_appointment_booking" ||
    rule.id !== decision.ruleId.toLowerCase() ||
    hashAppointmentBookingRuleDefinition(rule as unknown as AppointmentBookingRuleDefinition) !==
      decision.policyHash
  )
    return false;
  const action = jsonObject(actions[0]);
  try {
    const fromRule = normalizeAppointmentBookingPolicy(action?.parameters);
    const fromDecision = normalizeAppointmentBookingPolicy(decision.policy);
    return (
      JSON.stringify(fromRule) === JSON.stringify(fromDecision) &&
      fromRule.serviceIds.every((id) => uuid(id)) &&
      fromRule.resourceIds.every((id) => uuid(id)) &&
      tenantId.length > 0
    );
  } catch {
    return false;
  }
}

function ruleScopeMatchesConversation(
  rule: NonNullable<Awaited<ReturnType<typeof lockAndReadRule>>>,
  conversation: { assignedUnitId: string | null; channelAccountId: string },
): boolean {
  return (
    (rule.organizationUnitId === null || rule.organizationUnitId === conversation.assignedUnitId) &&
    (rule.channelAccountId === null || rule.channelAccountId === conversation.channelAccountId)
  );
}

async function sendText(
  tenant: TenantContext,
  database: AppointmentBookingDatabase,
  transaction: Prisma.TransactionClient,
  conversationId: string,
  messageId: string,
  text: string,
  purpose: "PROMPT" | "ACK" = "PROMPT",
) {
  const result = await createOutboundConversationMessageManager(database).sendConversationMessage(
    tenant,
    conversationId,
    {
      actorUserId: null,
      content: { text },
      idempotencyKey: `booking:${messageId}`,
      messageType: "text",
      requestId: `booking:${messageId}`,
    },
    transaction,
  );
  const turn = await transaction.appointmentBookingTurn.findUnique({
    where: {
      tenantId_inboundMessageId: { tenantId: tenant.tenantId, inboundMessageId: messageId },
    },
    select: { flowId: true },
  });
  const flow =
    turn?.flowId === null || turn?.flowId === undefined
      ? null
      : await transaction.appointmentBookingFlow.findFirst({
          where: { tenantId: tenant.tenantId, id: turn.flowId },
          select: { phase: true, proposalVersion: true },
        });
  if (flow === null) throw new Error("Booking outbound requires a persisted flow lineage");
  await transaction.appointmentBookingTurn.update({
    where: {
      tenantId_inboundMessageId: { tenantId: tenant.tenantId, inboundMessageId: messageId },
    },
    data: {
      outboundMessageId: result.outboundMessage.id,
      outboundPurpose: purpose,
      outboundFlowPhase: flow.phase,
      outboundFlowVersion: flow.proposalVersion,
    },
  });
  return result.outboundMessage.id;
}

async function ensureSelectedTargets(
  tenantId: string,
  transaction: Prisma.TransactionClient,
  policy: AppointmentBookingPolicy,
): Promise<{ serviceIds: string[]; resourceIds: string[] }> {
  const services = await transaction.appointmentService.findMany({
    where: { tenantId, id: { in: [...policy.serviceIds] }, active: true },
    select: { id: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const resources = await transaction.appointmentResource.findMany({
    where: { tenantId, id: { in: [...policy.resourceIds] }, active: true },
    select: { id: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return {
    serviceIds: services.map((item) => item.id),
    resourceIds: resources.map((item) => item.id),
  };
}

type BookingMenuChoice = Readonly<{ id: string; label: string; startsAt?: string }>;
type BookingMenuOffer = Readonly<{
  phase: string;
  version: number;
  choices: readonly BookingMenuChoice[];
}>;

function readMenuOffer(value: unknown, phase: string, version: number): BookingMenuOffer | null {
  const offer = jsonObject(value);
  if (
    offer === null ||
    offer.phase !== phase ||
    offer.version !== version ||
    !Array.isArray(offer.choices)
  )
    return null;
  const choices: BookingMenuChoice[] = [];
  for (const candidate of offer.choices) {
    const item = jsonObject(candidate);
    if (
      item === null ||
      typeof item.id !== "string" ||
      typeof item.label !== "string" ||
      (item.startsAt !== undefined && typeof item.startsAt !== "string")
    )
      return null;
    choices.push({
      id: item.id,
      label: item.label,
      ...(typeof item.startsAt === "string" ? { startsAt: item.startsAt } : {}),
    });
  }
  return { phase, version, choices };
}

function menuJson(phase: string, version: number, choices: readonly BookingMenuChoice[]) {
  return { phase, version, choices } as unknown as Prisma.InputJsonValue;
}

function menuText(intro: string, choices: readonly BookingMenuChoice[]): string {
  return `${intro}\n${choices.map((choice, index) => `${index + 1}. ${choice.label}`).join("\n")}`;
}

function numberedChoice(offer: BookingMenuOffer | null, text: string): BookingMenuChoice | null {
  if (offer === null || !/^\d+$/.test(text.trim())) return null;
  const index = Number(text.trim()) - 1;
  return Number.isSafeInteger(index) ? (offer.choices[index] ?? null) : null;
}

async function availableResourceChoices(
  tenant: TenantContext,
  transaction: Prisma.TransactionClient,
  resourceIds: readonly string[],
  serviceId: string,
): Promise<BookingMenuChoice[]> {
  const resources = await transaction.appointmentResource.findMany({
    where: { tenantId: tenant.tenantId, id: { in: [...resourceIds] }, active: true },
    select: { id: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const from = new Date();
  const to = new Date(from.getTime() + 7 * 86_400_000);
  const available: BookingMenuChoice[] = [];
  for (const resource of resources) {
    try {
      const result = await findAppointmentAvailability(tenant, transaction, {
        serviceId,
        resourceId: resource.id,
        from: from.toISOString(),
        to: to.toISOString(),
        limit: 1,
      });
      if (result.slots.length > 0) available.push({ id: resource.id, label: resource.name });
    } catch (error) {
      if (!(error instanceof AppointmentAvailabilityTargetNotFoundError)) throw error;
    }
  }
  return available;
}

async function availableServiceChoices(
  tenant: TenantContext,
  transaction: Prisma.TransactionClient,
  policy: AppointmentBookingPolicy,
  resourceIds: readonly string[],
): Promise<BookingMenuChoice[]> {
  const services = await transaction.appointmentService.findMany({
    where: { tenantId: tenant.tenantId, id: { in: [...policy.serviceIds] }, active: true },
    select: { id: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const available: BookingMenuChoice[] = [];
  for (const service of services) {
    if ((await availableResourceChoices(tenant, transaction, resourceIds, service.id)).length > 0)
      available.push({ id: service.id, label: service.name });
  }
  return available;
}

async function availableSlotChoices(
  tenant: TenantContext,
  transaction: Prisma.TransactionClient,
  serviceId: string,
  resourceId: string,
): Promise<BookingMenuChoice[]> {
  const from = new Date();
  const to = new Date(from.getTime() + 7 * 86_400_000);
  let availability: Awaited<ReturnType<typeof findAppointmentAvailability>>;
  try {
    availability = await findAppointmentAvailability(tenant, transaction, {
      serviceId,
      resourceId,
      from: from.toISOString(),
      to: to.toISOString(),
      limit: 12,
    });
  } catch (error) {
    if (error instanceof AppointmentAvailabilityTargetNotFoundError) return [];
    throw error;
  }
  return availability.slots.slice(0, 8).map((slot) => ({
    id: new Date(slot.startsAt).toISOString(),
    label: new Date(slot.startsAt).toLocaleString("es-MX", { timeZone: availability.timezone }),
    startsAt: new Date(slot.startsAt).toISOString(),
  }));
}

async function advanceBooking(
  tenant: TenantContext,
  database: AppointmentBookingDatabase,
  transaction: Prisma.TransactionClient,
  turn: NonNullable<Awaited<ReturnType<typeof transaction.appointmentBookingTurn.findUnique>>>,
  text: string,
): Promise<AppointmentBookingTurnResult> {
  if (turn.liveRuleId === null || turn.flowId === null)
    return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
  const rule = await lockAndReadRule(tenant, transaction, turn.liveRuleId);
  if (rule === null || rule.status !== "active") {
    await transaction.appointmentBookingFlow.updateMany({
      where: { id: turn.flowId, tenantId: tenant.tenantId, closedAt: null },
      data: {
        liveRuleId: null,
        phase: "CANCELLED",
        closedAt: new Date(),
        terminalReason: "rule_unavailable",
        confirmationTokenHash: null,
        proposalVersion: { increment: 1 },
      },
    });
    return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
  }
  const flow = await transaction.appointmentBookingFlow.findFirst({
    where: { id: turn.flowId, tenantId: tenant.tenantId },
  });
  if (
    flow === null ||
    flow.closedAt !== null ||
    flow.liveRuleId !== rule.id ||
    !verifiedBookingRule(
      rule,
      {
        kind: "BOOKING",
        ruleId: rule.id,
        trigger: "ON_MESSAGE_RECEIVED",
        policy: persistedPolicy(flow.policySnapshot),
        policyHash: flow.policyHash,
      },
      tenant.tenantId,
    )
  ) {
    await transaction.appointmentBookingFlow.updateMany({
      where: { id: turn.flowId, tenantId: tenant.tenantId, closedAt: null },
      data: {
        liveRuleId: null,
        phase: "CANCELLED",
        closedAt: new Date(),
        terminalReason: "rule_policy_changed",
        confirmationTokenHash: null,
        proposalVersion: { increment: 1 },
      },
    });
    return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
  }
  const conversation = await authorizeTurn(tenant, transaction, flow.conversationId);
  if (conversation === null) {
    await transaction.appointmentBookingFlow.update({
      where: { tenantId_id: { tenantId: tenant.tenantId, id: flow.id } },
      data: {
        phase: "CANCELLED",
        closedAt: new Date(),
        terminalReason: "automation_unavailable",
        confirmationTokenHash: null,
        proposalVersion: { increment: 1 },
      },
    });
    return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
  }
  if (!ruleScopeMatchesConversation(rule, conversation)) {
    await transaction.appointmentBookingFlow.update({
      where: { tenantId_id: { tenantId: tenant.tenantId, id: flow.id } },
      data: {
        liveRuleId: null,
        phase: "CANCELLED",
        closedAt: new Date(),
        terminalReason: "rule_scope_changed",
        confirmationTokenHash: null,
        proposalVersion: { increment: 1 },
      },
    });
    return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
  }
  const policy = persistedPolicy(flow.policySnapshot);
  if (policy.reminderOffsetsMinutes !== undefined) {
    try {
      await assertTenantModuleEntitled(tenant, "module.scheduling", transaction);
    } catch (error) {
      if (!(error instanceof TenantModuleEntitlementRequiredError)) throw error;
      await transaction.appointmentBookingFlow.update({
        where: { tenantId_id: { tenantId: tenant.tenantId, id: flow.id } },
        data: {
          liveRuleId: null,
          phase: "CANCELLED",
          closedAt: new Date(),
          terminalReason: "scheduling_module_unavailable",
          confirmationTokenHash: null,
          proposalVersion: { increment: 1 },
        },
      });
      return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
    }
  }
  if (flow.expiresAt <= new Date()) {
    await transaction.appointmentBookingFlow.update({
      where: { tenantId_id: { tenantId: tenant.tenantId, id: flow.id } },
      data: {
        phase: "EXPIRED",
        closedAt: new Date(),
        terminalReason: "expired",
        confirmationTokenHash: null,
        proposalVersion: { increment: 1 },
      },
    });
    return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
  }
  const normalized = text.trim();
  if (normalized.toLocaleUpperCase("es-MX") === "SALIR") {
    const nextVersion = flow.proposalVersion + 1;
    await transaction.appointmentBookingFlow.update({
      where: { tenantId_id: { tenantId: tenant.tenantId, id: flow.id } },
      data: {
        phase: "CANCELLED",
        closedAt: new Date(),
        terminalReason: "customer_exit",
        confirmationTokenHash: null,
        proposalVersion: nextVersion,
      },
    });
    const outboundMessageId = await sendText(
      tenant,
      database,
      transaction,
      flow.conversationId,
      turn.inboundMessageId,
      "Solicitud cerrada. Si necesitas otra cita, escribe de nuevo.",
      "ACK",
    );
    await transaction.appointmentBookingTurn.update({
      where: {
        tenantId_inboundMessageId: {
          tenantId: tenant.tenantId,
          inboundMessageId: turn.inboundMessageId,
        },
      },
      data: { flowId: flow.id, appointmentId: null, outboundMessageId },
    });
    return {
      route: "BOOKING",
      legacyShouldRun: false,
      duplicate: false,
      handled: true,
      outboundMessageId,
    };
  }
  const selectionPhase = [
    "SELECT_SERVICE",
    "SELECT_RESOURCE",
    "SELECT_SLOT",
    "SELECT_APPOINTMENT",
  ].includes(flow.phase);
  const offer = selectionPhase
    ? readMenuOffer(flow.offeredChoices, flow.phase, flow.proposalVersion)
    : null;
  if (selectionPhase && offer === null) {
    await transaction.appointmentBookingFlow.update({
      where: { tenantId_id: { tenantId: tenant.tenantId, id: flow.id } },
      data: {
        liveRuleId: null,
        phase: "CANCELLED",
        closedAt: new Date(),
        terminalReason: "menu_offer_unavailable",
        confirmationTokenHash: null,
        proposalVersion: { increment: 1 },
      },
    });
    return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
  }
  const number = Number(normalized);
  if (flow.phase === "SELECT_APPOINTMENT" && Number.isInteger(number)) {
    const choice = numberedChoice(offer, normalized);
    if (choice === null)
      return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
    const selected = await transaction.appointment.findFirst({
      where: {
        id: choice.id,
        tenantId: tenant.tenantId,
        contactId: flow.contactId,
        status: { in: ["REQUESTED", "CONFIRMED"] },
        startsAt: { gt: new Date() },
        serviceId: { in: [...policy.serviceIds] },
        resourceId: { in: [...policy.resourceIds] },
      },
      select: { id: true, serviceId: true, resourceId: true, startsAt: true },
    });
    if (selected === null || selected.startsAt.toISOString() !== choice.startsAt) {
      const appointments = await transaction.appointment.findMany({
        where: {
          tenantId: tenant.tenantId,
          contactId: flow.contactId,
          status: { in: ["REQUESTED", "CONFIRMED"] },
          startsAt: { gt: new Date() },
          serviceId: { in: [...policy.serviceIds] },
          resourceId: { in: [...policy.resourceIds] },
        },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        take: 10,
        select: { id: true, startsAt: true },
      });
      const choices = appointments.map((item) => ({
        id: item.id,
        label: item.startsAt.toISOString(),
        startsAt: item.startsAt.toISOString(),
      }));
      const nextVersion = flow.proposalVersion + 1;
      await transaction.appointmentBookingFlow.update({
        where: { tenantId_id: { tenantId: tenant.tenantId, id: flow.id } },
        data: {
          offeredChoices: menuJson(flow.phase, nextVersion, choices),
          proposalVersion: nextVersion,
        },
      });
      const outboundMessageId = await sendText(
        tenant,
        database,
        transaction,
        flow.conversationId,
        turn.inboundMessageId,
        menuText("La lista cambió. Elige una cita actual enviando su número:", choices),
      );
      await transaction.appointmentBookingTurn.update({
        where: {
          tenantId_inboundMessageId: {
            tenantId: tenant.tenantId,
            inboundMessageId: turn.inboundMessageId,
          },
        },
        data: { outboundMessageId },
      });
      return {
        route: "BOOKING",
        legacyShouldRun: false,
        duplicate: false,
        handled: true,
        outboundMessageId,
      };
    }
    if (
      !policy.serviceIds.includes(selected.serviceId) ||
      selected.resourceId === null ||
      !policy.resourceIds.includes(selected.resourceId)
    )
      return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
    if (flow.intent === "CANCEL") {
      const nextVersion = flow.proposalVersion + 1;
      const proposal = selected.startsAt.toISOString();
      const confirm = confirmation(flow.id, flow.intent, nextVersion, proposal);
      await transaction.appointmentBookingFlow.update({
        where: { tenantId_id: { tenantId: tenant.tenantId, id: flow.id } },
        data: {
          selectedAppointmentId: selected.id,
          proposedStartsAt: selected.startsAt,
          phase: "CONFIRM_CANCELLATION",
          proposalVersion: nextVersion,
          confirmationTokenHash: confirm.hash,
          expiresAt: new Date(Date.now() + FLOW_TTL_MS),
        },
      });
      const outboundMessageId = await sendText(
        tenant,
        database,
        transaction,
        flow.conversationId,
        turn.inboundMessageId,
        `Confirma cancelar la cita del ${selected.startsAt.toISOString()} respondiendo exactamente:\n${confirm.token}`,
      );
      await transaction.appointmentBookingTurn.update({
        where: {
          tenantId_inboundMessageId: {
            tenantId: tenant.tenantId,
            inboundMessageId: turn.inboundMessageId,
          },
        },
        data: { flowId: flow.id, appointmentId: selected.id, outboundMessageId },
      });
      return {
        route: "BOOKING",
        legacyShouldRun: false,
        duplicate: false,
        handled: true,
        appointmentId: selected.id,
        outboundMessageId,
      };
    }
    const resources = await availableResourceChoices(
      tenant,
      transaction,
      policy.resourceIds,
      selected.serviceId,
    );
    if (resources.length === 0)
      return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
    const nextVersion = flow.proposalVersion + 1;
    const updated = await transaction.appointmentBookingFlow.update({
      where: { tenantId_id: { tenantId: tenant.tenantId, id: flow.id } },
      data: {
        selectedAppointmentId: selected.id,
        selectedServiceId: selected.serviceId,
        selectedResourceId: null,
        phase: "SELECT_RESOURCE",
        offeredChoices: menuJson("SELECT_RESOURCE", nextVersion, resources),
        proposalVersion: nextVersion,
        expiresAt: new Date(Date.now() + FLOW_TTL_MS),
      },
    });
    const outboundMessageId = await sendText(
      tenant,
      database,
      transaction,
      flow.conversationId,
      turn.inboundMessageId,
      menuText("Elige el recurso para reagendar enviando su número:", resources),
    );
    await transaction.appointmentBookingTurn.update({
      where: {
        tenantId_inboundMessageId: {
          tenantId: tenant.tenantId,
          inboundMessageId: turn.inboundMessageId,
        },
      },
      data: { flowId: updated.id, appointmentId: selected.id, outboundMessageId },
    });
    return {
      route: "BOOKING",
      legacyShouldRun: false,
      duplicate: false,
      handled: true,
      appointmentId: selected.id,
      outboundMessageId,
    };
  }
  if (
    flow.phase === "SELECT_SERVICE" ||
    flow.phase === "SELECT_RESOURCE" ||
    flow.phase === "SELECT_SLOT"
  ) {
    if (flow.phase === "SELECT_SERVICE" && Number.isInteger(number)) {
      const choice = numberedChoice(offer, normalized);
      if (choice === null)
        return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
      const selectedService = await transaction.appointmentService.findFirst({
        where: { id: choice.id, tenantId: tenant.tenantId, active: true },
        select: { id: true },
      });
      if (selectedService === null || !policy.serviceIds.includes(selectedService.id)) {
        const { resourceIds } = await ensureSelectedTargets(tenant.tenantId, transaction, policy);
        const choices = await availableServiceChoices(tenant, transaction, policy, resourceIds);
        const nextVersion = flow.proposalVersion + 1;
        await transaction.appointmentBookingFlow.update({
          where: { tenantId_id: { tenantId: tenant.tenantId, id: flow.id } },
          data: {
            offeredChoices: menuJson(flow.phase, nextVersion, choices),
            proposalVersion: nextVersion,
          },
        });
        const outboundMessageId = await sendText(
          tenant,
          database,
          transaction,
          flow.conversationId,
          turn.inboundMessageId,
          menuText("La lista cambió. Elige un servicio disponible:", choices),
        );
        await transaction.appointmentBookingTurn.update({
          where: {
            tenantId_inboundMessageId: {
              tenantId: tenant.tenantId,
              inboundMessageId: turn.inboundMessageId,
            },
          },
          data: { outboundMessageId },
        });
        return {
          route: "BOOKING",
          legacyShouldRun: false,
          duplicate: false,
          handled: true,
          outboundMessageId,
        };
      }
      const selectedServiceId = selectedService.id;
      const resources = await availableResourceChoices(
        tenant,
        transaction,
        policy.resourceIds,
        selectedServiceId,
      );
      if (resources.length === 0) {
        const { resourceIds } = await ensureSelectedTargets(tenant.tenantId, transaction, policy);
        const choices = await availableServiceChoices(tenant, transaction, policy, resourceIds);
        const nextVersion = flow.proposalVersion + 1;
        await transaction.appointmentBookingFlow.update({
          where: { tenantId_id: { tenantId: tenant.tenantId, id: flow.id } },
          data: {
            offeredChoices: menuJson(flow.phase, nextVersion, choices),
            proposalVersion: nextVersion,
          },
        });
        const outboundMessageId = await sendText(
          tenant,
          database,
          transaction,
          flow.conversationId,
          turn.inboundMessageId,
          menuText("Ese servicio ya no tiene recursos disponibles. Elige otro:", choices),
        );
        await transaction.appointmentBookingTurn.update({
          where: {
            tenantId_inboundMessageId: {
              tenantId: tenant.tenantId,
              inboundMessageId: turn.inboundMessageId,
            },
          },
          data: { outboundMessageId },
        });
        return {
          route: "BOOKING",
          legacyShouldRun: false,
          duplicate: false,
          handled: true,
          outboundMessageId,
        };
      }
      const nextVersion = flow.proposalVersion + 1;
      const next = await transaction.appointmentBookingFlow.update({
        where: { tenantId_id: { tenantId: tenant.tenantId, id: flow.id } },
        data: {
          selectedServiceId,
          phase: "SELECT_RESOURCE",
          offeredChoices: menuJson("SELECT_RESOURCE", nextVersion, resources),
          proposalVersion: nextVersion,
          expiresAt: new Date(Date.now() + FLOW_TTL_MS),
        },
      });
      const outboundMessageId = await sendText(
        tenant,
        database,
        transaction,
        flow.conversationId,
        turn.inboundMessageId,
        menuText("Elige el recurso enviando su número:", resources),
      );
      await transaction.appointmentBookingTurn.update({
        where: {
          tenantId_inboundMessageId: {
            tenantId: tenant.tenantId,
            inboundMessageId: turn.inboundMessageId,
          },
        },
        data: { flowId: next.id, outboundMessageId },
      });
      return {
        route: "BOOKING",
        legacyShouldRun: false,
        duplicate: false,
        handled: true,
        outboundMessageId,
      };
    }
    if (flow.phase === "SELECT_RESOURCE" && Number.isInteger(number)) {
      const choice = numberedChoice(offer, normalized);
      const selectedResourceId = choice?.id;
      const selectedServiceId = flow.selectedServiceId;
      if (selectedResourceId === undefined || selectedServiceId === null)
        return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
      const slots = await availableSlotChoices(
        tenant,
        transaction,
        selectedServiceId,
        selectedResourceId,
      );
      if (slots.length === 0) {
        const resources = await availableResourceChoices(
          tenant,
          transaction,
          policy.resourceIds,
          selectedServiceId,
        );
        const nextVersion = flow.proposalVersion + 1;
        await transaction.appointmentBookingFlow.update({
          where: { tenantId_id: { tenantId: tenant.tenantId, id: flow.id } },
          data: {
            offeredChoices: menuJson(flow.phase, nextVersion, resources),
            proposalVersion: nextVersion,
          },
        });
        const outboundMessageId = await sendText(
          tenant,
          database,
          transaction,
          flow.conversationId,
          turn.inboundMessageId,
          menuText("Ese recurso ya no tiene horarios. Elige otro:", resources),
        );
        await transaction.appointmentBookingFlow.update({
          where: { tenantId_id: { tenantId: tenant.tenantId, id: flow.id } },
          data: {
            selectedResourceId: null,
            phase: "SELECT_RESOURCE",
            proposalVersion: nextVersion,
            offeredChoices: menuJson(flow.phase, nextVersion, resources),
          },
        });
        await transaction.appointmentBookingTurn.update({
          where: {
            tenantId_inboundMessageId: {
              tenantId: tenant.tenantId,
              inboundMessageId: turn.inboundMessageId,
            },
          },
          data: { outboundMessageId },
        });
        return {
          route: "BOOKING",
          legacyShouldRun: false,
          duplicate: false,
          handled: true,
          outboundMessageId,
        };
      }
      const nextVersion = flow.proposalVersion + 1;
      await transaction.appointmentBookingFlow.update({
        where: { tenantId_id: { tenantId: tenant.tenantId, id: flow.id } },
        data: {
          selectedResourceId,
          phase: "SELECT_SLOT",
          proposalVersion: nextVersion,
          offeredChoices: menuJson("SELECT_SLOT", nextVersion, slots),
        },
      });
      const outboundMessageId = await sendText(
        tenant,
        database,
        transaction,
        flow.conversationId,
        turn.inboundMessageId,
        menuText("Elige un horario enviando su número:", slots),
      );
      await transaction.appointmentBookingTurn.update({
        where: {
          tenantId_inboundMessageId: {
            tenantId: tenant.tenantId,
            inboundMessageId: turn.inboundMessageId,
          },
        },
        data: { outboundMessageId },
      });
      return {
        route: "BOOKING",
        legacyShouldRun: false,
        duplicate: false,
        handled: true,
        outboundMessageId,
      };
    }
    if (flow.phase === "SELECT_SLOT" && Number.isInteger(number)) {
      if (flow.selectedServiceId === null || flow.selectedResourceId === null)
        return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
      const choice = numberedChoice(offer, normalized);
      if (choice === null || choice.startsAt === undefined)
        return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
      const currentSlots = await availableSlotChoices(
        tenant,
        transaction,
        flow.selectedServiceId,
        flow.selectedResourceId,
      );
      const selectedSlot = currentSlots.find((slot) => slot.startsAt === choice.startsAt);
      if (selectedSlot === undefined) {
        const nextVersion = flow.proposalVersion + 1;
        await transaction.appointmentBookingFlow.update({
          where: { tenantId_id: { tenantId: tenant.tenantId, id: flow.id } },
          data: {
            offeredChoices: menuJson(flow.phase, nextVersion, currentSlots),
            proposalVersion: nextVersion,
          },
        });
        const outboundMessageId = await sendText(
          tenant,
          database,
          transaction,
          flow.conversationId,
          turn.inboundMessageId,
          currentSlots.length > 0
            ? menuText("Los horarios cambiaron. Elige un horario disponible:", currentSlots)
            : "Ese horario dejó de estar disponible y no hay opciones en este momento. Escribe de nuevo más tarde o responde SALIR.",
        );
        await transaction.appointmentBookingTurn.update({
          where: {
            tenantId_inboundMessageId: {
              tenantId: tenant.tenantId,
              inboundMessageId: turn.inboundMessageId,
            },
          },
          data: { outboundMessageId },
        });
        return {
          route: "BOOKING",
          legacyShouldRun: false,
          duplicate: false,
          handled: true,
          outboundMessageId,
        };
      }
      const proposedStartsAt = new Date(selectedSlot.startsAt ?? choice.startsAt);
      if (!Number.isFinite(proposedStartsAt.getTime()) || proposedStartsAt <= new Date())
        return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
      const nextVersion = flow.proposalVersion + 1;
      const proposal = proposedStartsAt.toISOString();
      const confirm = confirmation(flow.id, flow.intent, nextVersion, proposal);
      await transaction.appointmentBookingFlow.update({
        where: { tenantId_id: { tenantId: tenant.tenantId, id: flow.id } },
        data: {
          phase:
            flow.intent === "CREATE"
              ? "CONFIRM_BOOKING"
              : flow.intent === "CANCEL"
                ? "CONFIRM_CANCELLATION"
                : "CONFIRM_REBOOKING",
          proposedStartsAt,
          proposalVersion: nextVersion,
          confirmationTokenHash: confirm.hash,
          expiresAt: new Date(Date.now() + FLOW_TTL_MS),
        },
      });
      const outboundMessageId = await sendText(
        tenant,
        database,
        transaction,
        flow.conversationId,
        turn.inboundMessageId,
        `Confirma esta cita para ${proposedStartsAt.toISOString()} respondiendo exactamente:\n${confirm.token}`,
      );
      await transaction.appointmentBookingTurn.update({
        where: {
          tenantId_inboundMessageId: {
            tenantId: tenant.tenantId,
            inboundMessageId: turn.inboundMessageId,
          },
        },
        data: { outboundMessageId },
      });
      return {
        route: "BOOKING",
        legacyShouldRun: false,
        duplicate: false,
        handled: true,
        outboundMessageId,
      };
    }
  }

  const intentPhase =
    flow.intent === "CREATE"
      ? "CONFIRM_BOOKING"
      : flow.intent === "CANCEL"
        ? "CONFIRM_CANCELLATION"
        : "CONFIRM_REBOOKING";
  if (
    flow.phase === intentPhase &&
    flow.confirmationTokenHash !== null &&
    flow.proposedStartsAt !== null &&
    normalized.startsWith("CONFIRM-")
  ) {
    const supplied = tokenHash(
      `${flow.id}:${flow.intent}:${flow.proposalVersion}:${flow.proposedStartsAt.toISOString()}:${normalized}`,
    );
    if (supplied !== flow.confirmationTokenHash)
      return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
    const actor = {
      kind: "whatsapp_rule" as const,
      ruleId: rule.id,
      bookingFlowId: flow.id,
      requestId: `booking:${turn.inboundMessageId}`,
    };
    const beforeMutation = async (tx: Prisma.TransactionClient) => {
      const current = await authorizeTurn(tenant, tx, flow.conversationId);
      const live = await tx.appointmentBookingFlow.findFirst({
        where: { id: flow.id, tenantId: tenant.tenantId },
      });
      const targetAppointment =
        flow.intent === "CREATE" || flow.selectedAppointmentId === null
          ? null
          : await tx.appointment.findFirst({
              where: {
                id: flow.selectedAppointmentId,
                tenantId: tenant.tenantId,
                contactId: flow.contactId,
              },
              select: { serviceId: true, resourceId: true },
            });
      const now = new Date();
      if (policy.reminderOffsetsMinutes !== undefined)
        await assertTenantModuleEntitled(tenant, "module.scheduling", tx, now);
      if (
        current === null ||
        !ruleScopeMatchesConversation(rule, current) ||
        live === null ||
        live.closedAt !== null ||
        live.expiresAt <= now ||
        live.proposalVersion !== flow.proposalVersion ||
        live.confirmationTokenHash !== flow.confirmationTokenHash ||
        (flow.intent !== "CREATE" &&
          (targetAppointment === null ||
            !policy.serviceIds.includes(targetAppointment.serviceId) ||
            targetAppointment.resourceId === null ||
            !policy.resourceIds.includes(targetAppointment.resourceId)))
      )
        throw new Error("Booking confirmation expired or is no longer authorized");
    };
    let appointmentId: string;
    if (flow.intent === "CREATE") {
      if (flow.selectedServiceId === null || flow.selectedResourceId === null)
        return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
      const reminderPolicy =
        policy.reminderOffsetsMinutes === undefined
          ? null
          : {
              conversationId: flow.conversationId,
              offsetMinutes: [...policy.reminderOffsetsMinutes],
            };
      const command = {
        serviceId: flow.selectedServiceId,
        resourceId: flow.selectedResourceId,
        contactId: flow.contactId,
        startsAt: flow.proposedStartsAt.toISOString(),
        idempotencyKey: `booking:${flow.id}:${flow.proposalVersion}`,
        reminderPolicy,
      };
      const appointment = await createAppointmentInTransaction(
        tenant,
        transaction,
        command,
        normalizeCreateAppointmentInput(command),
        actor,
        null,
        beforeMutation,
      );
      appointmentId = appointment.id;
    } else if (flow.intent === "CANCEL") {
      if (flow.selectedAppointmentId === null)
        return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
      const appointment = await cancelAppointmentInTransaction(
        tenant,
        transaction,
        flow.selectedAppointmentId,
        actor,
        beforeMutation,
      );
      appointmentId = appointment.id;
    } else {
      if (flow.selectedAppointmentId === null || flow.selectedResourceId === null)
        return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
      const appointment = await rebookAppointmentInTransaction(
        tenant,
        transaction,
        flow.selectedAppointmentId,
        {
          startsAt: flow.proposedStartsAt.toISOString(),
          resourceId: flow.selectedResourceId,
          idempotencyKey: `booking:${flow.id}:${flow.proposalVersion}`,
        },
        actor,
        beforeMutation,
      );
      appointmentId = appointment.id;
    }
    await transaction.appointmentBookingFlow.update({
      where: { tenantId_id: { tenantId: tenant.tenantId, id: flow.id } },
      data: {
        phase: "COMPLETED",
        closedAt: new Date(),
        terminalReason: "confirmed",
        confirmationTokenHash: null,
      },
    });
    await transaction.appointmentBookingTurn.update({
      where: {
        tenantId_inboundMessageId: {
          tenantId: tenant.tenantId,
          inboundMessageId: turn.inboundMessageId,
        },
      },
      data: { appointmentId },
    });
    const outboundMessageId = await sendText(
      tenant,
      database,
      transaction,
      flow.conversationId,
      turn.inboundMessageId,
      `Listo. ${flow.intent === "CANCEL" ? "Cancelé" : flow.intent === "REBOOK" ? "Reagendé" : "Reservé"} tu cita.`,
      "ACK",
    );
    await transaction.appointmentBookingTurn.update({
      where: {
        tenantId_inboundMessageId: {
          tenantId: tenant.tenantId,
          inboundMessageId: turn.inboundMessageId,
        },
      },
      data: { appointmentId, outboundMessageId },
    });
    return {
      route: "BOOKING",
      legacyShouldRun: false,
      duplicate: false,
      handled: true,
      appointmentId,
      outboundMessageId,
    };
  }
  return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
}

export async function processPersistedBookingTurnInTransaction(
  tenantContext: TenantContext,
  database: AppointmentBookingDatabase,
  transaction: Prisma.TransactionClient,
  inboundMessageId: string,
  selectRoute: AppointmentBookingRouteSelector,
): Promise<AppointmentBookingTurnResult> {
  const tenant = createTenantContext(tenantContext.tenantId);
  if (!uuid(inboundMessageId)) throw new TypeError("inboundMessageId must be UUIDv7");
  const message = await transaction.message.findFirst({
    where: { id: inboundMessageId, tenantId: tenant.tenantId, direction: "inbound" },
    select: {
      id: true,
      conversationId: true,
      contactId: true,
      channelAccountId: true,
      textBody: true,
    },
  });
  if (
    message?.conversationId === null ||
    message?.contactId === null ||
    message?.channelAccountId === null ||
    message === null
  )
    throw new Error("Persisted inbound message context is missing");
  await lockConversationInTransaction(
    transaction,
    tenant.tenantId,
    message.channelAccountId,
    message.contactId,
  );
  const persistedConversation = await currentConversation(
    tenant,
    transaction,
    message.conversationId,
  );
  const conversation = await authorizeTurn(tenant, transaction, message.conversationId);
  const turn = await transaction.appointmentBookingTurn.findFirst({
    where: { tenantId: tenant.tenantId, inboundMessageId },
  });
  if (turn === null)
    return { route: "LEGACY", legacyShouldRun: false, duplicate: true, handled: false };
  if (
    turn.conversationId !== message.conversationId ||
    turn.contactId !== message.contactId ||
    turn.channelAccountId !== message.channelAccountId
  ) {
    if (turn.route === "UNDECIDED") {
      await transaction.appointmentBookingTurn.update({
        where: { tenantId_inboundMessageId: { tenantId: tenant.tenantId, inboundMessageId } },
        data: { route: "LEGACY" },
      });
    }
    return {
      route: turn.route === "BOOKING" ? "BOOKING" : "LEGACY",
      legacyShouldRun: false,
      duplicate: true,
      handled: turn.route !== "LEGACY",
    };
  }
  if (
    persistedConversation === null ||
    persistedConversation.id !== message.conversationId ||
    persistedConversation.contactId !== message.contactId ||
    persistedConversation.channelAccountId !== message.channelAccountId
  ) {
    if (turn.route === "UNDECIDED") {
      await transaction.appointmentBookingTurn.update({
        where: { tenantId_inboundMessageId: { tenantId: tenant.tenantId, inboundMessageId } },
        data: { route: "LEGACY" },
      });
    }
    return { route: "LEGACY", legacyShouldRun: false, duplicate: true, handled: false };
  }
  if (turn.route === "LEGACY")
    return { route: "LEGACY", legacyShouldRun: false, duplicate: true, handled: false };
  if (turn.route === "BOOKING") {
    const linkedFlow =
      turn.flowId === null
        ? null
        : await transaction.appointmentBookingFlow.findFirst({
            where: { tenantId: tenant.tenantId, id: turn.flowId },
          });
    if (
      linkedFlow === null ||
      linkedFlow.conversationId !== message.conversationId ||
      linkedFlow.contactId !== message.contactId ||
      linkedFlow.channelAccountId !== message.channelAccountId
    )
      return { route: "BOOKING", legacyShouldRun: false, duplicate: true, handled: true };
    return {
      route: "BOOKING",
      legacyShouldRun: false,
      duplicate: true,
      handled: true,
      ...(turn.outboundMessageId ? { outboundMessageId: turn.outboundMessageId } : {}),
      ...(turn.appointmentId ? { appointmentId: turn.appointmentId } : {}),
    };
  }
  if (conversation === null) {
    const activeFlow = await transaction.appointmentBookingFlow.findFirst({
      where: { tenantId: tenant.tenantId, conversationId: turn.conversationId, closedAt: null },
    });
    if (activeFlow !== null) {
      if (activeFlow.liveRuleId !== null)
        await lockAndReadRule(tenant, transaction, activeFlow.liveRuleId);
      await transaction.appointmentBookingFlow.update({
        where: { tenantId_id: { tenantId: tenant.tenantId, id: activeFlow.id } },
        data: {
          liveRuleId: null,
          phase: "CANCELLED",
          closedAt: new Date(),
          terminalReason: "automation_unavailable",
          confirmationTokenHash: null,
          proposalVersion: { increment: 1 },
        },
      });
      await transaction.appointmentBookingTurn.update({
        where: { tenantId_inboundMessageId: { tenantId: tenant.tenantId, inboundMessageId } },
        data: { route: "LEGACY" },
      });
      return { route: "LEGACY", legacyShouldRun: false, duplicate: false, handled: true };
    }
    await transaction.appointmentBookingTurn.update({
      where: { tenantId_inboundMessageId: { tenantId: tenant.tenantId, inboundMessageId } },
      data: { route: "LEGACY" },
    });
    return { route: "LEGACY", legacyShouldRun: true, duplicate: false, handled: false };
  }

  const existingFlow = await transaction.appointmentBookingFlow.findFirst({
    where: { tenantId: tenant.tenantId, conversationId: conversation.id, closedAt: null },
  });
  if (existingFlow !== null) {
    if (
      existingFlow.conversationId !== persistedConversation.id ||
      existingFlow.contactId !== persistedConversation.contactId ||
      existingFlow.channelAccountId !== persistedConversation.channelAccountId
    ) {
      await transaction.appointmentBookingTurn.update({
        where: { tenantId_inboundMessageId: { tenantId: tenant.tenantId, inboundMessageId } },
        data: { route: "LEGACY" },
      });
      return { route: "LEGACY", legacyShouldRun: false, duplicate: false, handled: false };
    }
    const liveRule =
      existingFlow.liveRuleId === null
        ? null
        : await lockAndReadRule(tenant, transaction, existingFlow.liveRuleId);
    if (liveRule === null || liveRule.status !== "active") {
      await transaction.appointmentBookingFlow.update({
        where: { tenantId_id: { tenantId: tenant.tenantId, id: existingFlow.id } },
        data: {
          liveRuleId: null,
          phase: "CANCELLED",
          closedAt: new Date(),
          terminalReason: "rule_unavailable",
          confirmationTokenHash: null,
          proposalVersion: { increment: 1 },
        },
      });
      await transaction.appointmentBookingTurn.update({
        where: { tenantId_inboundMessageId: { tenantId: tenant.tenantId, inboundMessageId } },
        data: {
          route: "BOOKING",
          originatingRuleId: existingFlow.originatingRuleId,
          liveRuleId: null,
          policyHash: existingFlow.policyHash,
          policySnapshot: existingFlow.policySnapshot as unknown as Prisma.InputJsonValue,
          flowId: existingFlow.id,
          appointmentId: existingFlow.selectedAppointmentId,
        },
      });
      return { route: "BOOKING", legacyShouldRun: false, duplicate: false, handled: true };
    }
    await transaction.appointmentBookingTurn.update({
      where: { tenantId_inboundMessageId: { tenantId: tenant.tenantId, inboundMessageId } },
      data: {
        route: "BOOKING",
        originatingRuleId: existingFlow.originatingRuleId,
        liveRuleId: existingFlow.liveRuleId,
        policyHash: existingFlow.policyHash,
        policySnapshot: existingFlow.policySnapshot as unknown as Prisma.InputJsonValue,
        flowId: existingFlow.id,
      },
    });
    const refreshed = await transaction.appointmentBookingTurn.findFirst({
      where: { tenantId: tenant.tenantId, inboundMessageId },
    });
    return advanceBooking(
      tenant,
      database,
      transaction,
      refreshed as never,
      message.textBody ?? "",
    );
  }

  if ((message.textBody ?? "").trim().startsWith("CONFIRM-")) {
    await transaction.appointmentBookingTurn.update({
      where: { tenantId_inboundMessageId: { tenantId: tenant.tenantId, inboundMessageId } },
      data: { route: "LEGACY" },
    });
    return { route: "LEGACY", legacyShouldRun: false, duplicate: false, handled: true };
  }

  const decision = await selectRoute(transaction, {
    id: message.id,
    conversationId: message.conversationId,
    contactId: message.contactId,
    channelAccountId: message.channelAccountId,
    createdNewConversation: turn.createdNewConversation,
    textBody: message.textBody,
  });
  if (decision.kind === "LEGACY") {
    await transaction.appointmentBookingTurn.update({
      where: { tenantId_inboundMessageId: { tenantId: tenant.tenantId, inboundMessageId } },
      data: { route: "LEGACY" },
    });
    return { route: "LEGACY", legacyShouldRun: true, duplicate: false, handled: false };
  }
  const rule = await lockAndReadRule(tenant, transaction, decision.ruleId);
  if (
    rule === null ||
    !verifiedBookingRule(rule, decision, tenant.tenantId) ||
    !ruleScopeMatchesConversation(rule, conversation)
  ) {
    await transaction.appointmentBookingTurn.update({
      where: { tenantId_inboundMessageId: { tenantId: tenant.tenantId, inboundMessageId } },
      data: { route: "LEGACY" },
    });
    return { route: "LEGACY", legacyShouldRun: true, duplicate: false, handled: false };
  }
  const policy = persistedPolicy(decision.policy);
  if (policy.reminderOffsetsMinutes !== undefined) {
    try {
      await assertTenantModuleEntitled(tenant, "module.scheduling", transaction);
    } catch (error) {
      if (!(error instanceof TenantModuleEntitlementRequiredError)) throw error;
      await transaction.appointmentBookingTurn.update({
        where: { tenantId_inboundMessageId: { tenantId: tenant.tenantId, inboundMessageId } },
        data: { route: "LEGACY" },
      });
      return { route: "LEGACY", legacyShouldRun: true, duplicate: false, handled: false };
    }
  }
  const { serviceIds, resourceIds } = await ensureSelectedTargets(
    tenant.tenantId,
    transaction,
    policy,
  );
  if (serviceIds.length === 0 || resourceIds.length === 0) {
    await transaction.appointmentBookingTurn.update({
      where: { tenantId_inboundMessageId: { tenantId: tenant.tenantId, inboundMessageId } },
      data: { route: "LEGACY" },
    });
    return { route: "LEGACY", legacyShouldRun: true, duplicate: false, handled: false };
  }
  const now = new Date();
  const intent = /\b(?:cancelar|cancela)\b/i.test(message.textBody ?? "")
    ? "CANCEL"
    : /\b(?:reagendar|cambiar|mover)\b/i.test(message.textBody ?? "")
      ? "REBOOK"
      : "CREATE";
  const appointments =
    intent === "CREATE"
      ? []
      : await transaction.appointment.findMany({
          where: {
            tenantId: tenant.tenantId,
            contactId: message.contactId,
            status: { in: ["REQUESTED", "CONFIRMED"] },
            startsAt: { gt: now },
            serviceId: { in: [...policy.serviceIds] },
            resourceId: { in: [...policy.resourceIds] },
          },
          orderBy: [{ startsAt: "asc" }, { id: "asc" }],
          take: 10,
          select: { id: true, startsAt: true },
        });
  if (intent !== "CREATE" && appointments.length === 0) {
    await transaction.appointmentBookingTurn.update({
      where: { tenantId_inboundMessageId: { tenantId: tenant.tenantId, inboundMessageId } },
      data: { route: "LEGACY" },
    });
    return { route: "LEGACY", legacyShouldRun: true, duplicate: false, handled: false };
  }
  const initialPhase = intent === "CREATE" ? "SELECT_SERVICE" : "SELECT_APPOINTMENT";
  const initialChoices =
    intent === "CREATE"
      ? await availableServiceChoices(tenant, transaction, policy, resourceIds)
      : appointments.map((item) => ({
          id: item.id,
          label: item.startsAt.toISOString(),
          startsAt: item.startsAt.toISOString(),
        }));
  if (initialChoices.length === 0) {
    await transaction.appointmentBookingTurn.update({
      where: { tenantId_inboundMessageId: { tenantId: tenant.tenantId, inboundMessageId } },
      data: { route: "LEGACY" },
    });
    return { route: "LEGACY", legacyShouldRun: true, duplicate: false, handled: false };
  }
  const flow = await transaction.appointmentBookingFlow.create({
    data: {
      tenantId: tenant.tenantId,
      conversationId: conversation.id,
      contactId: message.contactId,
      channelAccountId: message.channelAccountId,
      originatingRuleId: rule.id,
      liveRuleId: rule.id,
      policyHash: decision.policyHash,
      policySnapshot: policy as unknown as Prisma.InputJsonValue,
      intent,
      phase: initialPhase,
      offeredChoices: menuJson(initialPhase, 1, initialChoices),
      selectedAppointmentId: null,
      expiresAt: new Date(now.getTime() + FLOW_TTL_MS),
    },
  });
  const receipt = await transaction.appointmentBookingTurn.update({
    where: { tenantId_inboundMessageId: { tenantId: tenant.tenantId, inboundMessageId } },
    data: {
      route: "BOOKING",
      originatingRuleId: rule.id,
      liveRuleId: rule.id,
      policyHash: decision.policyHash,
      policySnapshot: policy as unknown as Prisma.InputJsonValue,
      flowId: flow.id,
      appointmentId: null,
    },
  });
  const prompt =
    intent === "CREATE"
      ? menuText("Para reservar, elige un servicio enviando su número:", initialChoices)
      : menuText("Elige la cita enviando su número:", initialChoices);
  const outboundMessageId = await sendText(
    tenant,
    database,
    transaction,
    conversation.id,
    message.id,
    prompt,
  );
  await transaction.appointmentBookingTurn.update({
    where: { tenantId_inboundMessageId: { tenantId: tenant.tenantId, inboundMessageId } },
    data: { outboundMessageId },
  });
  return {
    route: "BOOKING",
    legacyShouldRun: false,
    duplicate: false,
    handled: true,
    outboundMessageId,
    ...(receipt.appointmentId ? { appointmentId: receipt.appointmentId } : {}),
  };
}

export function processPersistedBookingTurn(
  tenant: TenantContext,
  database: AppointmentBookingDatabase,
  inboundMessageId: string,
  selectRoute: AppointmentBookingRouteSelector,
): Promise<AppointmentBookingTurnResult> {
  return database.$transaction((transaction) =>
    processPersistedBookingTurnInTransaction(
      tenant,
      database,
      transaction,
      inboundMessageId,
      selectRoute,
    ),
  );
}

export async function terminateAppointmentBookingFlowsForDeletedRuleInTransaction(
  tenantContext: TenantContext,
  transaction: Prisma.TransactionClient,
  ruleId: string,
): Promise<void> {
  const tenant = createTenantContext(tenantContext.tenantId);
  if (!uuid(ruleId)) throw new TypeError("ruleId must be UUIDv7");
  await transaction.appointmentBookingFlow.updateMany({
    where: { tenantId: tenant.tenantId, liveRuleId: ruleId, closedAt: null },
    data: {
      liveRuleId: null,
      phase: "CANCELLED",
      closedAt: new Date(),
      terminalReason: "rule_deleted",
      confirmationTokenHash: null,
      proposalVersion: { increment: 1 },
    },
  });
  await transaction.appointmentBookingFlow.updateMany({
    where: { tenantId: tenant.tenantId, liveRuleId: ruleId },
    data: { liveRuleId: null },
  });
  await transaction.appointmentBookingTurn.updateMany({
    where: { tenantId: tenant.tenantId, liveRuleId: ruleId },
    data: { liveRuleId: null },
  });
}
