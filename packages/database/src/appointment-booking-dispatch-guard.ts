import {
  type AppointmentBookingRuleDefinition,
  hashAppointmentBookingRuleDefinition,
  normalizeAppointmentBookingPolicy,
} from "./appointment-booking-policy";
import { lockConversationInTransaction } from "./conversation-manager";
import type { PrismaClient } from "./generated/prisma/client";
import { createTenantContext } from "./tenant-context";
import {
  assertTenantModuleEntitled,
  TenantModuleEntitlementRequiredError,
} from "./tenant-entitlements";
import { assertTenantOperational, TenantNotOperationalError } from "./tenant-operational";

export type AppointmentBookingDispatchMessage = Readonly<{
  channelAccountId: string;
  id: string;
  recipientPhone: string;
  tenantId: string;
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function paused(value: unknown): boolean {
  const metadata = record(value);
  return (
    (metadata?.automationPausedAt !== null && metadata?.automationPausedAt !== undefined) ||
    (typeof metadata?.automationPausedReason === "string" &&
      metadata.automationPausedReason.trim() !== "")
  );
}

function suppress(reason: string): never {
  throw new Error(`BOOKING_DISPATCH_SUPPRESSED:${reason}`);
}

/** Revalidates queued booking replies at the worker's final pre-provider hook. */
export async function authorizeAppointmentBookingDispatch(
  database: PrismaClient,
  message: AppointmentBookingDispatchMessage,
  nowOrClock: Date | (() => Date) = () => new Date(),
): Promise<void> {
  const clock = typeof nowOrClock === "function" ? nowOrClock : () => nowOrClock;
  const tenant = createTenantContext(message.tenantId);
  try {
    const result = await database.$transaction(async (transaction) => {
      const initialTurn = await transaction.appointmentBookingTurn.findFirst({
        select: { conversationId: true, contactId: true, channelAccountId: true },
        where: { tenantId: tenant.tenantId, outboundMessageId: message.id },
      });
      if (initialTurn === null) return null;
      await lockConversationInTransaction(
        transaction,
        tenant.tenantId,
        initialTurn.channelAccountId,
        initialTurn.contactId,
      );
      const lockedConversation = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "conversation"
        WHERE tenant_id = ${tenant.tenantId}::uuid
          AND id = ${initialTurn.conversationId}::uuid
        FOR UPDATE`;
      if (lockedConversation.length !== 1) return "TARGET_UNAVAILABLE";
      const outbound = await transaction.outboundMessage.findFirst({
        where: { id: message.id, tenantId: tenant.tenantId },
      });
      const turn = await transaction.appointmentBookingTurn.findFirst({
        where: { tenantId: tenant.tenantId, outboundMessageId: message.id },
      });
      const conversation = await transaction.conversation.findFirst({
        include: { channelAccount: true, contact: true },
        where: { id: initialTurn.conversationId, tenantId: tenant.tenantId },
      });
      if (
        outbound === null ||
        turn === null ||
        conversation === null ||
        turn.conversationId !== conversation.id ||
        turn.contactId !== conversation.contactId ||
        turn.channelAccountId !== conversation.channelAccountId ||
        outbound.channelAccountId !== message.channelAccountId ||
        conversation.channelAccountId !== message.channelAccountId ||
        outbound.recipientPhone !== message.recipientPhone ||
        conversation.contact.phoneNumber !== message.recipientPhone ||
        outbound.status !== "SENDING"
      )
        return "TARGET_UNAVAILABLE";

      if (
        !["new", "open", "pending"].includes(conversation.status) ||
        conversation.contact.status !== "ACTIVE" ||
        !conversation.channelAccount.active ||
        conversation.channelAccount.status !== "connected"
      )
        return "TARGET_UNAVAILABLE";

      const now = clock();
      if (turn.route !== "BOOKING" || turn.flowId === null) return "BOOKING_RECEIPT_UNAVAILABLE";
      const flow = await transaction.appointmentBookingFlow.findFirst({
        where: { id: turn.flowId, tenantId: tenant.tenantId },
      });
      if (
        flow === null ||
        flow.conversationId !== conversation.id ||
        flow.contactId !== conversation.contactId ||
        flow.channelAccountId !== conversation.channelAccountId ||
        flow.contactId !== turn.contactId ||
        flow.channelAccountId !== turn.channelAccountId
      )
        return "BOOKING_FLOW_UNAVAILABLE";
      if (
        turn.outboundPurpose === null ||
        turn.outboundFlowPhase !== flow.phase ||
        turn.outboundFlowVersion !== flow.proposalVersion
      )
        return "BOOKING_OFFER_SUPERSEDED";
      let requiresScheduling = false;
      try {
        requiresScheduling =
          normalizeAppointmentBookingPolicy(flow.policySnapshot).reminderOffsetsMinutes !==
          undefined;
      } catch {
        return "BOOKING_POLICY_UNAVAILABLE";
      }
      const linkedAppointment =
        turn.appointmentId === null
          ? null
          : await transaction.appointment.findFirst({
              where: {
                id: turn.appointmentId,
                tenantId: tenant.tenantId,
                contactId: turn.contactId,
              },
              select: { id: true, bookingFlowId: true, rescheduledFromId: true, status: true },
            });
      const completedAppointmentMatches =
        linkedAppointment !== null &&
        (flow.intent === "CANCEL"
          ? linkedAppointment.id === flow.selectedAppointmentId &&
            linkedAppointment.status === "CANCELLED"
          : linkedAppointment.bookingFlowId === flow.id &&
            (flow.intent !== "REBOOK" ||
              linkedAppointment.rescheduledFromId === flow.selectedAppointmentId));
      const completedAcknowledgement =
        turn.outboundPurpose === "ACK" &&
        flow.phase === "COMPLETED" &&
        flow.terminalReason === "confirmed" &&
        completedAppointmentMatches &&
        flow.closedAt !== null;
      const exitAcknowledgement =
        turn.outboundPurpose === "ACK" &&
        flow.phase === "CANCELLED" &&
        flow.terminalReason === "customer_exit" &&
        turn.appointmentId === null &&
        flow.closedAt !== null;
      const terminalAcknowledgement = completedAcknowledgement || exitAcknowledgement;
      if (turn.outboundPurpose === "ACK" && !terminalAcknowledgement)
        return "BOOKING_ACK_UNAVAILABLE";
      if (turn.outboundPurpose === "PROMPT" && flow.phase !== turn.outboundFlowPhase)
        return "BOOKING_OFFER_SUPERSEDED";
      if (turn.outboundPurpose !== "ACK" && turn.outboundPurpose !== "PROMPT")
        return "BOOKING_OUTBOUND_PURPOSE_UNAVAILABLE";
      if (!terminalAcknowledgement) {
        if (flow.closedAt !== null || flow.expiresAt <= now || flow.liveRuleId === null)
          return "BOOKING_FLOW_INACTIVE";
        const rule = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "rule"
          WHERE tenant_id = ${tenant.tenantId}::uuid AND id = ${flow.liveRuleId}::uuid
          FOR SHARE`;
        if (rule.length !== 1) return "BOOKING_RULE_UNAVAILABLE";
        const live = await transaction.rule.findFirst({
          where: { id: flow.liveRuleId, tenantId: tenant.tenantId },
        });
        const actions = Array.isArray(live?.actions) ? live.actions : [];
        const action = record(actions[0]);
        let policyMatches = false;
        try {
          policyMatches =
            JSON.stringify(normalizeAppointmentBookingPolicy(action?.parameters)) ===
            JSON.stringify(normalizeAppointmentBookingPolicy(flow.policySnapshot));
        } catch {
          /* invalid current policy fails closed below */
        }
        if (
          live === null ||
          live.status !== "active" ||
          live.triggerType !== "ON_MESSAGE_RECEIVED" ||
          live.executionMode !== "first_match_stop" ||
          actions.length !== 1 ||
          action?.actionType !== "start_appointment_booking" ||
          hashAppointmentBookingRuleDefinition(
            live as unknown as AppointmentBookingRuleDefinition,
          ) !== flow.policyHash ||
          !policyMatches ||
          (live.organizationUnitId !== null &&
            live.organizationUnitId !== conversation.assignedUnitId) ||
          (live.channelAccountId !== null &&
            live.channelAccountId !== conversation.channelAccountId)
        )
          return "BOOKING_RULE_CHANGED";
      }
      if (
        conversation.automationMode !== "AUTO" ||
        paused(conversation.metadata) ||
        (conversation.humanTakeoverUntil !== null && conversation.humanTakeoverUntil > now)
      )
        return "AUTOMATION_UNAVAILABLE";
      try {
        await assertTenantOperational(tenant, transaction);
        const entitlements = [
          "module.messaging.basic",
          "module.automation.basic",
          "module.appointments",
          "module.crm_lite",
          ...(requiresScheduling ? (["module.scheduling"] as const) : []),
        ] as const;
        for (const entitlement of entitlements)
          await assertTenantModuleEntitled(tenant, entitlement, transaction);
      } catch (error) {
        if (
          error instanceof TenantModuleEntitlementRequiredError ||
          error instanceof TenantNotOperationalError
        )
          return "TENANT_OR_MODULE_DISABLED";
        throw error;
      }
      const finalNow = clock();
      const finalFlow = await transaction.appointmentBookingFlow.findFirst({
        where: { id: flow.id, tenantId: tenant.tenantId },
      });
      const finalConversation = await transaction.conversation.findFirst({
        where: { id: conversation.id, tenantId: tenant.tenantId },
      });
      if (
        finalFlow === null ||
        finalConversation === null ||
        finalFlow.conversationId !== conversation.id ||
        finalFlow.contactId !== conversation.contactId ||
        finalFlow.channelAccountId !== conversation.channelAccountId ||
        finalFlow.proposalVersion !== turn.outboundFlowVersion ||
        finalFlow.phase !== turn.outboundFlowPhase
      )
        return "BOOKING_OFFER_SUPERSEDED";
      if (
        finalConversation.automationMode !== "AUTO" ||
        paused(finalConversation.metadata) ||
        (finalConversation.humanTakeoverUntil !== null &&
          finalConversation.humanTakeoverUntil > finalNow)
      )
        return "AUTOMATION_UNAVAILABLE";
      if (
        turn.outboundPurpose === "PROMPT" &&
        (finalFlow.closedAt !== null || finalFlow.expiresAt <= finalNow || terminalAcknowledgement)
      )
        return "BOOKING_FLOW_INACTIVE";
      if (
        turn.outboundPurpose === "ACK" &&
        ((completedAcknowledgement &&
          (finalFlow.phase !== "COMPLETED" ||
            finalFlow.terminalReason !== "confirmed" ||
            finalFlow.closedAt === null)) ||
          (exitAcknowledgement &&
            (finalFlow.phase !== "CANCELLED" ||
              finalFlow.terminalReason !== "customer_exit" ||
              finalFlow.closedAt === null)))
      )
        return "BOOKING_ACK_UNAVAILABLE";
      return null;
    });
    if (result !== null) suppress(result);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("BOOKING_DISPATCH_SUPPRESSED:"))
      throw error;
    throw new Error("BOOKING_DISPATCH_GUARD_UNAVAILABLE");
  }
}
