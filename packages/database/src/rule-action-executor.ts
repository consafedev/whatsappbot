import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, Rule } from "./generated/prisma/client";
import type { RuleAction, RuleItem, RuleMutationMetadata } from "./rule-catalog-manager";
import { type RuleEvaluationContext, resolveContextPath } from "./rule-condition-evaluator";
import { createTenantContext, type TenantContext } from "./tenant-context";
import {
  createTenantDataAccess,
  type TenantDataAccessDatabase,
  type TenantTransactionDatabase,
} from "./tenant-data-access";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

export const CONVERSATION_AUTOMATION_MODES = ["AUTO", "HUMAN", "ASSISTED", "MONITOR"] as const;
export type ConversationAutomationMode = (typeof CONVERSATION_AUTOMATION_MODES)[number];

export const RULE_ACTION_TYPES = [
  "SEND_MESSAGE",
  "ASSIGN_USER",
  "ASSIGN_ORGANIZATION_UNIT",
  "CHANGE_CONVERSATION_STATUS",
  "ADD_CONTACT_TAG",
  "REMOVE_CONTACT_TAG",
  "SET_CONTACT_CUSTOM_ATTRIBUTE",
  "SET_AUTOMATION_MODE",
] as const;

export type RuleActionType = (typeof RULE_ACTION_TYPES)[number];

export interface RuleExecutionContext extends RuleEvaluationContext {
  conversationId?: string;
  contactId?: string;
  channelAccountId?: string;
}

export interface RuleExecutionResult {
  ruleId: string;
  success: boolean;
  actionsApplied: string[];
  error?: string;
  timestamp: Date;
}

export class RuleActionExecutionError extends Error {
  override readonly name: string = "RuleActionExecutionError";
}

export class RuleActionConversationNotFoundError extends RuleActionExecutionError {
  override readonly name: string = "RuleActionConversationNotFoundError";
  constructor() {
    super("Target conversation was not found for this tenant");
  }
}

export class RuleActionConversationNotWritableError extends RuleActionExecutionError {
  override readonly name: string = "RuleActionConversationNotWritableError";
  constructor() {
    super("Target conversation is closed or not writable");
  }
}

export class RuleActionChannelInactiveError extends RuleActionExecutionError {
  override readonly name: string = "RuleActionChannelInactiveError";
  constructor() {
    super("Channel account is inactive or not found");
  }
}

export class RuleActionContactNotFoundError extends RuleActionExecutionError {
  override readonly name: string = "RuleActionContactNotFoundError";
  constructor() {
    super("Target contact was not found for this tenant");
  }
}

export class RuleActionUserNotFoundError extends RuleActionExecutionError {
  override readonly name: string = "RuleActionUserNotFoundError";
  constructor() {
    super("Target user was not found or is inactive for this tenant");
  }
}

export class RuleActionOrganizationUnitNotFoundError extends RuleActionExecutionError {
  override readonly name: string = "RuleActionOrganizationUnitNotFoundError";
  constructor() {
    super("Target organization unit was not found for this tenant");
  }
}

export class RuleActionInvalidStateTransitionError extends RuleActionExecutionError {
  override readonly name: string = "RuleActionInvalidStateTransitionError";
  constructor(
    readonly previousStatus: string,
    readonly newStatus: string,
  ) {
    super(`Invalid conversation state transition: ${previousStatus} -> ${newStatus}`);
  }
}

const TEMPLATE_VAR_REGEX = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

/**
 * Safely interpolates `{{variable.path}}` placeholders in template strings using `resolveContextPath`.
 * Returns an empty string for null, undefined or missing variables without throwing.
 */
export function interpolateTemplate(
  template: string | null | undefined,
  context: RuleEvaluationContext,
): string {
  if (!template) return "";
  return template.replace(TEMPLATE_VAR_REGEX, (_match, path) => {
    const value = resolveContextPath(context, path);
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  });
}

const ALLOWED_STATUS_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  closed: ["open"],
  new: ["open", "closed"],
  open: ["pending", "closed"],
  pending: ["open", "closed"],
};

export type RuleActionExecutorDatabase = TenantTransactionDatabase &
  TenantDataAccessDatabase &
  Pick<
    PrismaClient,
    | "rule"
    | "conversation"
    | "contact"
    | "channelAccount"
    | "user"
    | "organizationUnit"
    | "message"
    | "outboundMessage"
    | "tenant"
    | "tenantEntitlement"
    | "auditLog"
    | "domainEventOutbox"
  >;

function normalizeActionType(actionTypeRaw: string): string {
  const upper = actionTypeRaw.trim().toUpperCase();
  // Support aliases from snake_case
  switch (upper) {
    case "SEND_MESSAGE":
      return "SEND_MESSAGE";
    case "ASSIGN_USER":
      return "ASSIGN_USER";
    case "ASSIGN_UNIT":
    case "ASSIGN_ORGANIZATION_UNIT":
      return "ASSIGN_ORGANIZATION_UNIT";
    case "CHANGE_STATUS":
    case "CHANGE_CONVERSATION_STATUS":
      return "CHANGE_CONVERSATION_STATUS";
    case "ADD_TAG":
    case "ADD_CONTACT_TAG":
      return "ADD_CONTACT_TAG";
    case "REMOVE_TAG":
    case "REMOVE_CONTACT_TAG":
      return "REMOVE_CONTACT_TAG";
    case "SET_CONTACT_CUSTOM_ATTRIBUTE":
      return "SET_CONTACT_CUSTOM_ATTRIBUTE";
    case "SET_CONVERSATION_MODE":
    case "SET_AUTOMATION_MODE":
      return "SET_AUTOMATION_MODE";
    default:
      return upper;
  }
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/**
 * Executes a set of rule actions within a single atomic PostgreSQL transaction.
 * Ensures strict tenant isolation, state machine invariant validation, template interpolation,
 * audit logging, and domain event outbox generation.
 */
export async function executeRuleActions(
  tenantContext: TenantContext,
  rule: Rule | RuleItem,
  context: RuleExecutionContext,
  database: RuleActionExecutorDatabase,
  metadata?: RuleMutationMetadata,
): Promise<RuleExecutionResult> {
  const validatedContext = createTenantContext(tenantContext.tenantId);
  const tenantId = validatedContext.tenantId;
  const now = context.now ?? new Date();

  return database.$transaction(async (tx) => {
    await assertTenantOperational(validatedContext, tx);
    await assertTenantModuleEntitled(validatedContext, "module.automation.basic", tx);

    const access = createTenantDataAccess(validatedContext, tx);
    const rawActions = Array.isArray(rule.actions)
      ? (rule.actions as unknown as readonly RuleAction[])
      : [];
    const actions = rawActions;
    const actionsApplied: string[] = [];

    // Target references from execution context
    const targetConversationId = context.conversationId;
    let targetContactId = context.contactId;

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      if (!action) continue;
      const normalizedType = normalizeActionType(action.actionType);
      const params = action.parameters ?? {};

      switch (normalizedType) {
        case "SEND_MESSAGE": {
          if (!targetConversationId) {
            throw new RuleActionExecutionError(
              "Conversation ID is required in context for SEND_MESSAGE action",
            );
          }

          const conversation = await tx.conversation.findFirst({
            select: {
              id: true,
              channelAccountId: true,
              contactId: true,
              status: true,
            },
            where: { id: targetConversationId, tenantId },
          });

          if (!conversation) {
            throw new RuleActionConversationNotFoundError();
          }

          if (conversation.status === "closed") {
            throw new RuleActionConversationNotWritableError();
          }

          const channel = await tx.channelAccount.findFirst({
            select: { id: true, status: true, active: true },
            where: { id: conversation.channelAccountId, tenantId },
          });

          if (!channel || channel.status === "archived" || channel.status === "disabled") {
            throw new RuleActionChannelInactiveError();
          }

          // Resolve contact phone
          let recipientPhone = context.contact?.phoneNumber ?? "";
          if (!recipientPhone && conversation.contactId) {
            const c = await tx.contact.findFirst({
              select: { phoneNumber: true },
              where: { id: conversation.contactId, tenantId },
            });
            if (c) recipientPhone = c.phoneNumber;
          }

          const rawText =
            typeof params.textBody === "string"
              ? params.textBody
              : typeof params.text === "string"
                ? params.text
                : typeof params.caption === "string"
                  ? params.caption
                  : "";

          const text = interpolateTemplate(rawText, context);
          const rawCaption = typeof params.caption === "string" ? params.caption : undefined;
          const caption = rawCaption ? interpolateTemplate(rawCaption, context) : undefined;
          const mediaUrl = typeof params.mediaUrl === "string" ? params.mediaUrl : undefined;
          const messageType = mediaUrl ? "image" : "text";

          const structuredPayload = {
            text: text || undefined,
            caption: caption || undefined,
            mediaUrl: mediaUrl || undefined,
          };

          const outboundMessage = await tx.outboundMessage.create({
            data: {
              channelAccountId: conversation.channelAccountId,
              content: structuredPayload as Prisma.InputJsonValue,
              createdAt: now,
              idempotencyKey: randomUUID(),
              messageType,
              recipientPhone,
              status: "QUEUED",
              tenantId,
              updatedAt: now,
            },
          });

          const message = await tx.message.create({
            data: {
              actorId: null,
              actorType: "system",
              channelAccountId: conversation.channelAccountId,
              contactId: conversation.contactId,
              conversationId: conversation.id,
              createdAt: now,
              deliveryStatus: "queued",
              direction: "outbound",
              messageType,
              origin: "automation",
              outboundMessageId: outboundMessage.id,
              structuredPayload: structuredPayload as Prisma.InputJsonValue,
              tenantId,
              textBody: text || caption || null,
              updatedAt: now,
            },
          });

          await tx.conversation.update({
            data: {
              lastAutomationMessageAt: now,
              lastMessageAt: now,
              lastOutboundAt: now,
            },
            where: { id: conversation.id },
          });

          await access.outbox.append({
            aggregateId: message.id,
            aggregateType: "Message",
            eventType: "message.queued",
            payload: {
              channelAccountId: conversation.channelAccountId,
              conversationId: conversation.id,
              direction: "outbound",
              messageId: message.id,
              messageType,
              origin: "automation",
              outboundMessageId: outboundMessage.id,
              tenantId,
            },
          });

          actionsApplied.push("SEND_MESSAGE");
          break;
        }

        case "ASSIGN_USER": {
          if (!targetConversationId) {
            throw new RuleActionExecutionError(
              "Conversation ID is required in context for ASSIGN_USER action",
            );
          }

          const rawUserId = params.userId !== undefined ? params.userId : null;
          const userId = rawUserId === null ? null : String(rawUserId).trim();

          if (userId !== null) {
            const user = await tx.user.findFirst({
              select: { id: true },
              where: { id: userId, status: "active", tenantId },
            });
            if (!user) {
              throw new RuleActionUserNotFoundError();
            }
          }

          const conv = await tx.conversation.findFirst({
            select: { id: true, assignedUserId: true },
            where: { id: targetConversationId, tenantId },
          });

          if (!conv) {
            throw new RuleActionConversationNotFoundError();
          }

          await tx.conversation.update({
            data: { assignedUserId: userId },
            where: { id: targetConversationId },
          });

          await access.audit.append({
            action: "conversation.assigned",
            actorId: metadata?.actorUserId ?? null,
            actorType: metadata?.actorUserId ? "tenant_user" : "system",
            afterSummary: { assignedUserId: userId },
            beforeSummary: { assignedUserId: conv.assignedUserId },
            entityId: targetConversationId,
            entityType: "Conversation",
            requestId: metadata?.requestId ?? "rule-action-executor",
          });

          await access.outbox.append({
            aggregateId: targetConversationId,
            aggregateType: "Conversation",
            eventType: "conversation.assigned",
            payload: {
              assignedUserId: userId,
              conversationId: targetConversationId,
              tenantId,
            },
          });

          actionsApplied.push("ASSIGN_USER");
          break;
        }

        case "ASSIGN_ORGANIZATION_UNIT": {
          if (!targetConversationId) {
            throw new RuleActionExecutionError(
              "Conversation ID is required in context for ASSIGN_ORGANIZATION_UNIT action",
            );
          }

          const rawUnitId =
            params.unitId !== undefined
              ? params.unitId
              : params.organizationUnitId !== undefined
                ? params.organizationUnitId
                : null;
          const unitId = rawUnitId === null ? null : String(rawUnitId).trim();

          if (unitId !== null) {
            const unit = await tx.organizationUnit.findFirst({
              select: { id: true },
              where: { id: unitId, tenantId },
            });
            if (!unit) {
              throw new RuleActionOrganizationUnitNotFoundError();
            }
          }

          const conv = await tx.conversation.findFirst({
            select: { id: true, assignedUnitId: true },
            where: { id: targetConversationId, tenantId },
          });

          if (!conv) {
            throw new RuleActionConversationNotFoundError();
          }

          await tx.conversation.update({
            data: { assignedUnitId: unitId },
            where: { id: targetConversationId },
          });

          await access.audit.append({
            action: "conversation.assigned",
            actorId: metadata?.actorUserId ?? null,
            actorType: metadata?.actorUserId ? "tenant_user" : "system",
            afterSummary: { assignedUnitId: unitId },
            beforeSummary: { assignedUnitId: conv.assignedUnitId },
            entityId: targetConversationId,
            entityType: "Conversation",
            requestId: metadata?.requestId ?? "rule-action-executor",
          });

          await access.outbox.append({
            aggregateId: targetConversationId,
            aggregateType: "Conversation",
            eventType: "conversation.assigned",
            payload: {
              assignedUnitId: unitId,
              conversationId: targetConversationId,
              tenantId,
            },
          });

          actionsApplied.push("ASSIGN_ORGANIZATION_UNIT");
          break;
        }

        case "CHANGE_CONVERSATION_STATUS": {
          if (!targetConversationId) {
            throw new RuleActionExecutionError(
              "Conversation ID is required in context for CHANGE_CONVERSATION_STATUS action",
            );
          }

          const targetStatus = String(params.status ?? "").toLowerCase();
          const conv = await tx.conversation.findFirst({
            select: { id: true, status: true, closedAt: true },
            where: { id: targetConversationId, tenantId },
          });

          if (!conv) {
            throw new RuleActionConversationNotFoundError();
          }

          const allowed = ALLOWED_STATUS_TRANSITIONS[conv.status] ?? [];
          if (!allowed.includes(targetStatus)) {
            throw new RuleActionInvalidStateTransitionError(conv.status, targetStatus);
          }

          const closedAt =
            targetStatus === "closed" ? now : conv.status === "closed" ? null : conv.closedAt;

          await tx.conversation.update({
            data: {
              closedAt,
              status: targetStatus,
            },
            where: { id: targetConversationId },
          });

          await access.audit.append({
            action: "conversation.status_updated",
            actorId: metadata?.actorUserId ?? null,
            actorType: metadata?.actorUserId ? "tenant_user" : "system",
            afterSummary: jsonValue({
              reason: params.reason ? String(params.reason) : null,
              status: targetStatus,
            }),
            beforeSummary: { status: conv.status },
            entityId: targetConversationId,
            entityType: "Conversation",
            requestId: metadata?.requestId ?? "rule-action-executor",
          });

          await access.outbox.append({
            aggregateId: targetConversationId,
            aggregateType: "Conversation",
            eventType: "conversation.status_updated",
            payload: {
              closedAt: closedAt?.toISOString() ?? null,
              conversationId: targetConversationId,
              previousStatus: conv.status,
              status: targetStatus,
              tenantId,
            },
          });

          actionsApplied.push("CHANGE_CONVERSATION_STATUS");
          break;
        }

        case "ADD_CONTACT_TAG": {
          // Resolve contactId from context or conversation
          if (!targetContactId && targetConversationId) {
            const conv = await tx.conversation.findFirst({
              select: { contactId: true },
              where: { id: targetConversationId, tenantId },
            });
            if (conv?.contactId) targetContactId = conv.contactId;
          }

          if (!targetContactId) {
            throw new RuleActionExecutionError(
              "Contact ID is required in context for ADD_CONTACT_TAG action",
            );
          }

          const tag = String(params.tag ?? "").trim();
          if (!tag) {
            throw new RuleActionExecutionError("Tag value cannot be empty");
          }

          const contact = await tx.contact.findFirst({
            select: { id: true, tags: true },
            where: { id: targetContactId, tenantId },
          });

          if (!contact) {
            throw new RuleActionContactNotFoundError();
          }

          if (!contact.tags.includes(tag)) {
            const updatedTags = [...contact.tags, tag];
            await tx.contact.update({
              data: { tags: updatedTags },
              where: { id: contact.id },
            });

            await access.audit.append({
              action: "contact.updated",
              actorId: metadata?.actorUserId ?? null,
              actorType: metadata?.actorUserId ? "tenant_user" : "system",
              afterSummary: { tags: updatedTags },
              beforeSummary: { tags: contact.tags },
              entityId: contact.id,
              entityType: "Contact",
              requestId: metadata?.requestId ?? "rule-action-executor",
            });

            await access.outbox.append({
              aggregateId: contact.id,
              aggregateType: "Contact",
              eventType: "contact.updated",
              payload: {
                contactId: contact.id,
                tags: updatedTags,
                tenantId,
              },
            });
          }

          actionsApplied.push("ADD_CONTACT_TAG");
          break;
        }

        case "REMOVE_CONTACT_TAG": {
          if (!targetContactId && targetConversationId) {
            const conv = await tx.conversation.findFirst({
              select: { contactId: true },
              where: { id: targetConversationId, tenantId },
            });
            if (conv?.contactId) targetContactId = conv.contactId;
          }

          if (!targetContactId) {
            throw new RuleActionExecutionError(
              "Contact ID is required in context for REMOVE_CONTACT_TAG action",
            );
          }

          const tag = String(params.tag ?? "").trim();
          if (!tag) {
            throw new RuleActionExecutionError("Tag value cannot be empty");
          }

          const contact = await tx.contact.findFirst({
            select: { id: true, tags: true },
            where: { id: targetContactId, tenantId },
          });

          if (!contact) {
            throw new RuleActionContactNotFoundError();
          }

          if (contact.tags.includes(tag)) {
            const updatedTags = contact.tags.filter((t) => t !== tag);
            await tx.contact.update({
              data: { tags: updatedTags },
              where: { id: contact.id },
            });

            await access.audit.append({
              action: "contact.updated",
              actorId: metadata?.actorUserId ?? null,
              actorType: metadata?.actorUserId ? "tenant_user" : "system",
              afterSummary: { tags: updatedTags },
              beforeSummary: { tags: contact.tags },
              entityId: contact.id,
              entityType: "Contact",
              requestId: metadata?.requestId ?? "rule-action-executor",
            });

            await access.outbox.append({
              aggregateId: contact.id,
              aggregateType: "Contact",
              eventType: "contact.updated",
              payload: {
                contactId: contact.id,
                tags: updatedTags,
                tenantId,
              },
            });
          }

          actionsApplied.push("REMOVE_CONTACT_TAG");
          break;
        }

        case "SET_CONTACT_CUSTOM_ATTRIBUTE": {
          if (!targetContactId && targetConversationId) {
            const conv = await tx.conversation.findFirst({
              select: { contactId: true },
              where: { id: targetConversationId, tenantId },
            });
            if (conv?.contactId) targetContactId = conv.contactId;
          }

          if (!targetContactId) {
            throw new RuleActionExecutionError(
              "Contact ID is required in context for SET_CONTACT_CUSTOM_ATTRIBUTE action",
            );
          }

          const key = typeof params.key === "string" ? params.key.trim() : "";
          if (!key) {
            throw new RuleActionExecutionError("Attribute key cannot be empty");
          }

          const contact = await tx.contact.findFirst({
            select: { id: true, customAttributes: true },
            where: { id: targetContactId, tenantId },
          });

          if (!contact) {
            throw new RuleActionContactNotFoundError();
          }

          const currentAttrs =
            contact.customAttributes && typeof contact.customAttributes === "object"
              ? (contact.customAttributes as Record<string, unknown>)
              : {};

          const updatedAttrs = {
            ...currentAttrs,
            [key]: params.value,
          };

          await tx.contact.update({
            data: { customAttributes: updatedAttrs as Prisma.InputJsonValue },
            where: { id: contact.id },
          });

          await access.audit.append({
            action: "contact.updated",
            actorId: metadata?.actorUserId ?? null,
            actorType: metadata?.actorUserId ? "tenant_user" : "system",
            afterSummary: { customAttributes: jsonValue(updatedAttrs) },
            beforeSummary: { customAttributes: jsonValue(currentAttrs) },
            entityId: contact.id,
            entityType: "Contact",
            requestId: metadata?.requestId ?? "rule-action-executor",
          });

          await access.outbox.append({
            aggregateId: contact.id,
            aggregateType: "Contact",
            eventType: "contact.updated",
            payload: {
              contactId: contact.id,
              customAttributes: jsonValue(updatedAttrs),
              tenantId,
            },
          });

          actionsApplied.push("SET_CONTACT_CUSTOM_ATTRIBUTE");
          break;
        }

        case "SET_AUTOMATION_MODE": {
          if (!targetConversationId) {
            throw new RuleActionExecutionError(
              "Conversation ID is required in context for SET_AUTOMATION_MODE action",
            );
          }

          const rawMode = params.mode !== undefined ? params.mode : params.automationMode;
          const mode = String(rawMode ?? "").toUpperCase();
          const validModes: ConversationAutomationMode[] = ["AUTO", "HUMAN", "ASSISTED", "MONITOR"];

          if (!validModes.includes(mode as ConversationAutomationMode)) {
            throw new RuleActionExecutionError(`Invalid automation mode: ${mode}`);
          }

          const conv = await tx.conversation.findFirst({
            select: { id: true, automationMode: true },
            where: { id: targetConversationId, tenantId },
          });

          if (!conv) {
            throw new RuleActionConversationNotFoundError();
          }

          await tx.conversation.update({
            data: { automationMode: mode as ConversationAutomationMode },
            where: { id: targetConversationId },
          });

          await access.audit.append({
            action: "conversation.automation_mode_updated",
            actorId: metadata?.actorUserId ?? null,
            actorType: metadata?.actorUserId ? "tenant_user" : "system",
            afterSummary: { automationMode: mode },
            beforeSummary: { automationMode: conv.automationMode },
            entityId: targetConversationId,
            entityType: "Conversation",
            requestId: metadata?.requestId ?? "rule-action-executor",
          });

          await access.outbox.append({
            aggregateId: targetConversationId,
            aggregateType: "Conversation",
            eventType: "conversation.automation_mode_updated",
            payload: {
              automationMode: mode,
              conversationId: targetConversationId,
              tenantId,
            },
          });

          actionsApplied.push("SET_AUTOMATION_MODE");
          break;
        }

        default:
          throw new RuleActionExecutionError(`Unsupported action type: ${action.actionType}`);
      }
    }

    // Update rule timestamp
    await tx.rule.update({
      data: { updatedAt: now },
      where: { id: rule.id, tenantId },
    });

    // Record rule.executed audit log
    await access.audit.append({
      action: "rule.executed",
      actorId: metadata?.actorUserId ?? null,
      actorType: metadata?.actorUserId ? "tenant_user" : "system",
      afterSummary: {
        actionsExecuted: actionsApplied,
        contactId: targetContactId ?? null,
        conversationId: targetConversationId ?? null,
        ruleId: rule.id,
      },
      entityId: rule.id,
      entityType: "Rule",
      requestId: metadata?.requestId ?? "rule-action-executor",
    });

    // Emit domain event outbox: rule.executed
    await access.outbox.append({
      aggregateId: rule.id,
      aggregateType: "Rule",
      eventType: "rule.executed",
      payload: {
        actionsExecuted: actionsApplied,
        contactId: targetContactId ?? null,
        conversationId: targetConversationId ?? null,
        ruleId: rule.id,
        tenantId,
        timestamp: now.toISOString(),
      },
    });

    return {
      actionsApplied,
      ruleId: rule.id,
      success: true,
      timestamp: now,
    };
  });
}
