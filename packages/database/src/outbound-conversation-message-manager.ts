import { randomUUID } from "node:crypto";
import { lockConversationInTransaction } from "./conversation-manager";
import type {
  Conversation,
  Message,
  OutboundMessage,
  Prisma,
  PrismaClient,
} from "./generated/prisma/client";
import {
  createOutboundMessageManager,
  type OutboundMessageContent,
  type OutboundMessageManager,
  type OutboundMessageManagerDatabase,
  type OutboundMessageType,
} from "./outbound-message-manager";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess } from "./tenant-data-access";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

const ACTIVE_CONVERSATION_STATUSES = new Set(["new", "open", "pending"]);

export type OutboundConversationMessageInput = Readonly<{
  actorUserId?: string | null;
  content: OutboundMessageContent;
  idempotencyKey?: string | null;
  messageType: OutboundMessageType;
  requestId?: string;
}>;

export type OutboundConversationMessageResult = Readonly<{
  conversationId: string;
  duplicate: boolean;
  message: Message;
  outboundMessage: OutboundMessage;
}>;

export type OutboundConversationMessageManagerDatabase = OutboundMessageManagerDatabase &
  Pick<PrismaClient, "conversation" | "message">;

export class ConversationNotFoundError extends Error {
  override readonly name = "ConversationNotFoundError";

  constructor() {
    super("Conversation was not found");
  }
}

export class ConversationNotWritableError extends Error {
  override readonly name = "ConversationNotWritableError";

  constructor() {
    super("Conversation is not writable");
  }
}

export class OutboundConversationMessageIdempotencyConflictError extends Error {
  override readonly name = "OutboundConversationMessageIdempotencyConflictError";

  constructor() {
    super("Outbound message idempotency key conflicts with an existing message");
  }
}

export class OutboundConversationMessageActorNotFoundError extends Error {
  override readonly name = "OutboundConversationMessageActorNotFoundError";

  constructor() {
    super("Outbound message actor was not found");
  }
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${sortedJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameContent(left: Prisma.JsonValue, right: OutboundMessageContent): boolean {
  return sortedJson(left) === sortedJson(right);
}

function idempotencyKey(value: string | null | undefined): string {
  if (value === undefined || value === null) return randomUUID();
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(normalized)) {
    throw new TypeError("Invalid outbound message idempotency key");
  }
  return normalized;
}

function activeChannel(status: string, active: boolean): boolean {
  return active && status !== "archived" && status !== "disabled" && status !== "disconnected";
}

function textBody(content: OutboundMessageContent): string | null {
  return content.text ?? content.caption ?? null;
}

function actorFields(
  actorUserId: string | null,
): Pick<Prisma.MessageUncheckedCreateInput, "actorId" | "actorType" | "origin"> {
  if (actorUserId === null) {
    return { actorId: null, actorType: "system", origin: "automation" };
  }
  return { actorId: actorUserId, actorType: "tenant_user", origin: "human_app" };
}

type ConversationProjection = Pick<
  Conversation,
  | "automationMode"
  | "channelAccountId"
  | "contactId"
  | "id"
  | "lastAutomationMessageAt"
  | "lastHumanMessageAt"
  | "lastInboundAt"
  | "lastMessageAt"
  | "lastOutboundAt"
  | "metadata"
  | "status"
  | "tenantId"
> & {
  contact: { phoneNumber: string };
};

async function findConversation(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  conversationId: string,
): Promise<ConversationProjection | null> {
  return transaction.conversation.findUnique({
    select: {
      automationMode: true,
      channelAccountId: true,
      contact: { select: { phoneNumber: true } },
      contactId: true,
      id: true,
      lastAutomationMessageAt: true,
      lastHumanMessageAt: true,
      lastInboundAt: true,
      lastMessageAt: true,
      lastOutboundAt: true,
      metadata: true,
      status: true,
      tenantId: true,
    },
    where: { tenantId_id: { id: conversationId, tenantId } },
  });
}

function latest(current: Date | null, candidate: Date): Date {
  return current === null || candidate.getTime() > current.getTime() ? candidate : current;
}

function assertExistingQueueMatches(
  message: OutboundMessage,
  conversation: ConversationProjection,
  input: OutboundConversationMessageInput,
  key: string,
): void {
  if (
    message.tenantId !== conversation.tenantId ||
    message.channelAccountId !== conversation.channelAccountId ||
    message.recipientPhone !== conversation.contact.phoneNumber ||
    message.actorUserId !== (input.actorUserId ?? null) ||
    message.messageType !== input.messageType ||
    message.idempotencyKey !== key ||
    !sameContent(message.content, input.content)
  ) {
    throw new OutboundConversationMessageIdempotencyConflictError();
  }
}

function result(
  conversationId: string,
  duplicate: boolean,
  message: Message,
  outboundMessage: OutboundMessage,
): OutboundConversationMessageResult {
  return { conversationId, duplicate, message, outboundMessage };
}

async function existingResult(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  conversationId: string,
  input: OutboundConversationMessageInput,
  key: string,
  message: Message,
): Promise<OutboundConversationMessageResult> {
  if (message.direction !== "outbound" || message.outboundMessageId === null) {
    throw new OutboundConversationMessageIdempotencyConflictError();
  }
  const conversation = await findConversation(transaction, tenantId, conversationId);
  if (conversation === null || message.conversationId !== conversation.id) {
    throw new OutboundConversationMessageIdempotencyConflictError();
  }
  const queued = await transaction.outboundMessage.findFirst({
    where: { id: message.outboundMessageId, tenantId },
  });
  if (queued === null) throw new OutboundConversationMessageIdempotencyConflictError();
  assertExistingQueueMatches(queued, conversation, input, key);
  return result(conversation.id, true, message, queued);
}

export interface OutboundConversationMessageManager {
  sendConversationMessage(
    context: TenantContext,
    conversationId: string,
    input: OutboundConversationMessageInput,
  ): Promise<OutboundConversationMessageResult>;
}

export function createOutboundConversationMessageManager(
  database: OutboundConversationMessageManagerDatabase,
): OutboundConversationMessageManager {
  const outboundManager: OutboundMessageManager = createOutboundMessageManager(database);

  const sendConversationMessage = async (
    context: TenantContext,
    conversationId: string,
    input: OutboundConversationMessageInput,
  ): Promise<OutboundConversationMessageResult> => {
    const tenant = createTenantContext(context.tenantId);
    const key = idempotencyKey(input.idempotencyKey);
    const actorUserId = input.actorUserId ?? null;
    const mutationRequestId = input.requestId ?? "outbound-conversation-message";

    return database.$transaction(async (transaction) => {
      await assertTenantOperational(tenant, transaction);
      await assertTenantModuleEntitled(tenant, "module.messaging.basic", transaction);
      await assertTenantModuleEntitled(tenant, "module.crm_lite", transaction);

      const existing = await transaction.message.findUnique({
        where: { tenantId_idempotencyKey: { idempotencyKey: key, tenantId: tenant.tenantId } },
      });
      if (existing !== null) {
        return existingResult(transaction, tenant.tenantId, conversationId, input, key, existing);
      }

      const conversation = await findConversation(transaction, tenant.tenantId, conversationId);
      if (conversation === null) throw new ConversationNotFoundError();
      if (!ACTIVE_CONVERSATION_STATUSES.has(conversation.status)) {
        throw new ConversationNotWritableError();
      }

      const channel = await transaction.channelAccount.findFirst({
        select: { active: true, id: true, status: true },
        where: { id: conversation.channelAccountId, tenantId: tenant.tenantId },
      });
      if (channel === null) throw new ConversationNotFoundError();
      if (!activeChannel(channel.status, channel.active)) {
        throw new ConversationNotWritableError();
      }

      await lockConversationInTransaction(
        transaction,
        tenant.tenantId,
        conversation.channelAccountId,
        conversation.contactId,
      );

      const existingAfterLock = await transaction.message.findUnique({
        where: { tenantId_idempotencyKey: { idempotencyKey: key, tenantId: tenant.tenantId } },
      });
      if (existingAfterLock !== null) {
        return existingResult(
          transaction,
          tenant.tenantId,
          conversationId,
          input,
          key,
          existingAfterLock,
        );
      }

      if (actorUserId !== null) {
        const actor = await transaction.user.findFirst({
          select: { id: true },
          where: { id: actorUserId, status: "active", tenantId: tenant.tenantId },
        });
        if (actor === null) throw new OutboundConversationMessageActorNotFoundError();
      }

      const queued = await outboundManager.enqueueOutboundMessage(
        tenant,
        conversation.channelAccountId,
        {
          actorUserId,
          content: input.content,
          idempotencyKey: key,
          messageType: input.messageType,
          recipientPhone: conversation.contact.phoneNumber,
        },
        transaction,
      );
      assertExistingQueueMatches(queued, conversation, input, key);

      const linkedMessage = await transaction.message.findFirst({
        where: { outboundMessageId: queued.id, tenantId: tenant.tenantId },
      });
      if (linkedMessage !== null) {
        throw new OutboundConversationMessageIdempotencyConflictError();
      }

      const fields = actorFields(actorUserId);
      const created = await transaction.message.create({
        data: {
          ...fields,
          channelAccountId: conversation.channelAccountId,
          contactId: conversation.contactId,
          conversationId: conversation.id,
          deliveryStatus: "queued",
          direction: "outbound",
          idempotencyKey: key,
          messageType: input.messageType,
          outboundMessageId: queued.id,
          providerTimestamp: null,
          structuredPayload: jsonValue(input.content),
          tenantId: tenant.tenantId,
          textBody: textBody(input.content),
        },
      });

      const now = created.createdAt;
      const current = await findConversation(transaction, tenant.tenantId, conversation.id);
      if (current === null) throw new ConversationNotFoundError();
      const human =
        actorUserId !== null ? latest(current.lastHumanMessageAt, now) : current.lastHumanMessageAt;
      const automation =
        actorUserId === null
          ? latest(current.lastAutomationMessageAt, now)
          : current.lastAutomationMessageAt;
      const shouldPauseAutomation = actorUserId !== null && current.automationMode === "AUTO";
      const currentMeta =
        current.metadata !== null &&
        typeof current.metadata === "object" &&
        !Array.isArray(current.metadata)
          ? { ...(current.metadata as Record<string, unknown>) }
          : {};
      const newMetadata = shouldPauseAutomation
        ? {
            ...currentMeta,
            automationPausedAt: now.toISOString(),
            automationPausedReason: "agent_reply",
          }
        : current.metadata;

      await transaction.conversation.update({
        data: {
          ...(shouldPauseAutomation
            ? {
                automationMode: "HUMAN",
                metadata: newMetadata as Prisma.InputJsonValue,
              }
            : {}),
          lastAutomationMessageAt: automation,
          lastHumanMessageAt: human,
          lastMessageAt: latest(current.lastMessageAt, now),
          lastOutboundAt: latest(current.lastOutboundAt, now),
        },
        where: { tenantId_id: { id: conversation.id, tenantId: tenant.tenantId } },
      });

      const access = createTenantDataAccess(tenant, transaction);

      if (shouldPauseAutomation) {
        await access.audit.append({
          action: "conversation.automation_mode_updated",
          actorId: actorUserId,
          actorType: "tenant_user",
          afterSummary: {
            automationMode: "HUMAN",
            reason: "agent_reply",
          },
          beforeSummary: {
            automationMode: current.automationMode,
          },
          entityId: conversation.id,
          entityType: "Conversation",
          requestId: mutationRequestId,
        });
        await access.outbox.append({
          aggregateId: conversation.id,
          aggregateType: "Conversation",
          eventType: "conversation.automation_mode_updated",
          payload: {
            actorId: actorUserId,
            conversationId: conversation.id,
            newMode: "HUMAN",
            previousMode: current.automationMode,
            reason: "agent_reply",
            tenantId: tenant.tenantId,
            timestamp: now.toISOString(),
          },
        });
      }

      await access.audit.append({
        action: "conversation.message_sent",
        actorId: actorUserId,
        actorType: actorUserId === null ? "system" : "tenant_user",
        afterSummary: {
          actorType: created.actorType,
          deliveryStatus: created.deliveryStatus,
          direction: created.direction,
          messageId: created.id,
          messageType: created.messageType,
          outboundMessageId: queued.id,
        },
        entityId: conversation.id,
        entityType: "Conversation",
        requestId: mutationRequestId,
      });
      await access.outbox.append({
        aggregateId: created.id,
        aggregateType: "Message",
        eventType: "message.queued",
        payload: {
          conversationId: created.conversationId,
          direction: created.direction,
          messageId: created.id,
          origin: created.origin,
          outboundMessageId: queued.id,
          recipientPhone: queued.recipientPhone,
        },
      });

      return result(conversation.id, false, created, queued);
    });
  };

  return Object.freeze({ sendConversationMessage });
}
