import {
  type ConversationManagerDatabase,
  routeExternalHumanEventToConversationInTransaction,
} from "./conversation-manager";
import { type InboundMessageEvent, type Message, Prisma } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess } from "./tenant-data-access";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

type JsonRecord = Readonly<Record<string, unknown>>;

export type ExternalHumanMessageInput = Readonly<{
  channelAccountId: string;
  inboundEventId: string;
  providerMessageId: string;
  providerTimestamp: Date;
  recipientPhone: string | null;
  structuredPayload?: Prisma.InputJsonValue | null;
  textBody?: string | null;
}>;

export type ExternalHumanMessageResult = Readonly<{
  conversationId: string;
  duplicate: boolean;
  message: Message;
}>;

export type ExternalHumanMessageManagerDatabase = ConversationManagerDatabase &
  Pick<Prisma.TransactionClient, "message" | "outboundMessage">;
export type ExternalHumanMessageTransaction = Prisma.TransactionClient;

export class ExternalHumanMessageEventNotFoundError extends Error {
  override readonly name = "ExternalHumanMessageEventNotFoundError";

  constructor() {
    super("External human message event was not found");
  }
}

export class ExternalHumanMessageEventTypeUnsupportedError extends Error {
  override readonly name = "ExternalHumanMessageEventTypeUnsupportedError";

  constructor() {
    super("External human message requires a MESSAGE_RECEIVED event");
  }
}

export class ExternalHumanMessageAlreadyProcessedError extends Error {
  override readonly name = "ExternalHumanMessageAlreadyProcessedError";

  constructor() {
    super("External human message event was already processed without a message");
  }
}

export class ExternalHumanMessageNotDetectedError extends Error {
  override readonly name = "ExternalHumanMessageNotDetectedError";

  constructor() {
    super("Inbound event is not marked as an external human message");
  }
}

export class ExternalHumanMessageRecipientPhoneRequiredError extends Error {
  override readonly name = "ExternalHumanMessageRecipientPhoneRequiredError";

  constructor() {
    super("External human message recipient phone is required");
  }
}

export class ExternalHumanMessageChannelMismatchError extends Error {
  override readonly name = "ExternalHumanMessageChannelMismatchError";

  constructor() {
    super("External human message channel does not match the source event");
  }
}

export class ExternalHumanMessageProviderMessageMismatchError extends Error {
  override readonly name = "ExternalHumanMessageProviderMessageMismatchError";

  constructor() {
    super("External human message provider identity does not match the source event");
  }
}

export class ExternalHumanMessageRecipientMismatchError extends Error {
  override readonly name = "ExternalHumanMessageRecipientMismatchError";

  constructor() {
    super("External human message recipient does not match the source event");
  }
}

export class ExternalHumanMessageProviderIdentityConflictError extends Error {
  override readonly name = "ExternalHumanMessageProviderIdentityConflictError";

  constructor() {
    super("Provider message identity is already used by another canonical message");
  }
}

export class ExternalHumanMessageOutboundEchoRaceError extends Error {
  override readonly name = "ExternalHumanMessageOutboundEchoRaceError";

  constructor() {
    super("Provider message identity became a platform outbound echo during reconciliation");
  }
}

function record(value: Prisma.JsonValue | null): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const result = stringValue(value);
    if (result !== null) return result;
  }
  return null;
}

function validProviderTimestamp(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("External human message provider timestamp must be a valid Date");
  }
  return new Date(value);
}

function validProviderMessageId(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("External human message provider message id is required");
  }
  return value;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function externalHumanSignal(event: InboundMessageEvent): boolean {
  const normalized = record(event.normalizedData);
  const payload = record(event.payload);
  return (
    normalized.fromMe === true ||
    normalized.origin === "human_external_device" ||
    payload.fromMe === true
  );
}

function eventFor(
  event: InboundMessageEvent,
  input: ExternalHumanMessageInput,
  tenantId: string,
): void {
  if (event.tenantId !== tenantId) throw new ExternalHumanMessageEventNotFoundError();
  if (event.channelAccountId !== input.channelAccountId) {
    throw new ExternalHumanMessageChannelMismatchError();
  }
  if (event.providerMessageId !== input.providerMessageId) {
    throw new ExternalHumanMessageProviderMessageMismatchError();
  }
  if (event.recipientPhone !== input.recipientPhone) {
    throw new ExternalHumanMessageRecipientMismatchError();
  }
  if (event.eventType !== "MESSAGE_RECEIVED") {
    throw new ExternalHumanMessageEventTypeUnsupportedError();
  }
}

async function assertProviderIdentityAvailable(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  channelAccountId: string,
  providerMessageId: string,
): Promise<void> {
  const existingMessage = await transaction.message.findFirst({
    where: { channelAccountId, providerMessageId, tenantId },
  });
  if (existingMessage !== null) {
    if (existingMessage.direction === "outbound" && existingMessage.outboundMessageId !== null) {
      throw new ExternalHumanMessageOutboundEchoRaceError();
    }
    throw new ExternalHumanMessageProviderIdentityConflictError();
  }

  const existingOutbound = await transaction.outboundMessage.findFirst({
    where: { channelAccountId, providerMessageId, tenantId },
  });
  if (existingOutbound === null) return;

  const linkedMessage = await transaction.message.findFirst({
    where: { outboundMessageId: existingOutbound.id, tenantId },
  });
  if (linkedMessage?.direction === "outbound") {
    throw new ExternalHumanMessageOutboundEchoRaceError();
  }
  throw new ExternalHumanMessageProviderIdentityConflictError();
}

function latestTimestamp(current: Date | null, candidate: Date): Date {
  return current === null || candidate.getTime() > current.getTime() ? candidate : current;
}

function messageData(
  event: InboundMessageEvent,
  conversationId: string,
  contactId: string,
  input: ExternalHumanMessageInput,
  providerTimestamp: Date,
): Prisma.MessageUncheckedCreateInput {
  const normalized = record(event.normalizedData);
  const payload = record(event.payload);
  const data: Prisma.MessageUncheckedCreateInput = {
    actorId: null,
    actorType: "external_human_unknown",
    channelAccountId: event.channelAccountId,
    contactId,
    conversationId,
    deliveryStatus: "sent",
    direction: "outbound",
    inboundEventId: event.id,
    messageType:
      firstString(event.messageType, normalized.messageType, payload.messageType) ?? "unknown",
    origin: "human_external_device",
    outboundMessageId: null,
    providerMessageId: input.providerMessageId,
    providerTimestamp,
    tenantId: event.tenantId,
    textBody:
      input.textBody !== undefined
        ? input.textBody
        : firstString(
            normalized.textBody,
            payload.textBody,
            payload.text,
            payload.body,
            payload.caption,
          ),
  };
  if (input.structuredPayload === null) data.structuredPayload = Prisma.DbNull;
  else if (input.structuredPayload !== undefined) {
    data.structuredPayload = input.structuredPayload;
  }
  return data;
}

export interface ExternalHumanMessageManager {
  reconcileExternalHumanMessage(
    context: TenantContext,
    input: ExternalHumanMessageInput,
    transaction?: ExternalHumanMessageTransaction,
  ): Promise<ExternalHumanMessageResult>;
}

export function createExternalHumanMessageManager(
  database: ExternalHumanMessageManagerDatabase,
): ExternalHumanMessageManager {
  const runInTransaction = <Result>(
    transaction: ExternalHumanMessageTransaction | undefined,
    callback: (transaction: ExternalHumanMessageTransaction) => Promise<Result>,
  ): Promise<Result> =>
    transaction === undefined ? database.$transaction(callback) : callback(transaction);

  const reconcileExternalHumanMessage = (
    context: TenantContext,
    input: ExternalHumanMessageInput,
    transaction?: ExternalHumanMessageTransaction,
  ): Promise<ExternalHumanMessageResult> => {
    const tenant = createTenantContext(context.tenantId);
    const providerMessageId = validProviderMessageId(input.providerMessageId);
    const providerTimestamp = validProviderTimestamp(input.providerTimestamp);
    if (input.recipientPhone === null || input.recipientPhone.trim().length === 0) {
      throw new ExternalHumanMessageRecipientPhoneRequiredError();
    }
    if (input.recipientPhone.trim() !== input.recipientPhone) {
      throw new ExternalHumanMessageRecipientPhoneRequiredError();
    }
    const recipientPhone = input.recipientPhone;

    const operation = runInTransaction(transaction, async (currentTransaction) => {
      await assertTenantOperational(tenant, currentTransaction);
      await assertTenantModuleEntitled(tenant, "module.messaging.basic", currentTransaction);
      await assertTenantModuleEntitled(tenant, "module.crm_lite", currentTransaction);

      const event = await currentTransaction.inboundMessageEvent.findFirst({
        where: { id: input.inboundEventId, tenantId: tenant.tenantId },
      });
      if (event === null) throw new ExternalHumanMessageEventNotFoundError();
      eventFor(event, { ...input, providerMessageId }, tenant.tenantId);

      const existingByEvent = await currentTransaction.message.findFirst({
        where: { inboundEventId: event.id, tenantId: tenant.tenantId },
      });
      if (existingByEvent !== null) {
        return {
          conversationId: existingByEvent.conversationId,
          duplicate: true,
          message: existingByEvent,
        };
      }
      if (event.processedStatus !== "PENDING") {
        throw new ExternalHumanMessageAlreadyProcessedError();
      }
      if (!externalHumanSignal(event)) throw new ExternalHumanMessageNotDetectedError();

      await assertProviderIdentityAvailable(
        currentTransaction,
        tenant.tenantId,
        input.channelAccountId,
        providerMessageId,
      );

      const normalized = record(event.normalizedData);
      const conversation = await routeExternalHumanEventToConversationInTransaction(
        tenant,
        {
          inboundEventId: event.id,
          recipientPhone,
          providerThreadId: stringValue(normalized.conversationExternalId),
        },
        currentTransaction,
        database,
      );

      const existingAfterRoute = await currentTransaction.message.findFirst({
        where: { inboundEventId: event.id, tenantId: tenant.tenantId },
      });
      if (existingAfterRoute !== null) {
        return {
          conversationId: existingAfterRoute.conversationId,
          duplicate: true,
          message: existingAfterRoute,
        };
      }
      await assertProviderIdentityAvailable(
        currentTransaction,
        tenant.tenantId,
        input.channelAccountId,
        providerMessageId,
      );

      const created = await currentTransaction.message.create({
        data: messageData(
          event,
          conversation.id,
          conversation.contactId,
          { ...input, providerMessageId },
          providerTimestamp,
        ),
      });
      const currentConversation = await currentTransaction.conversation.findFirst({
        select: {
          automationMode: true,
          lastHumanMessageAt: true,
          lastMessageAt: true,
          lastOutboundAt: true,
          metadata: true,
        },
        where: { id: conversation.id, tenantId: tenant.tenantId },
      });
      if (currentConversation === null) throw new ExternalHumanMessageEventNotFoundError();

      const shouldPause = currentConversation.automationMode === "AUTO";
      const currentMeta =
        currentConversation.metadata !== null &&
        typeof currentConversation.metadata === "object" &&
        !Array.isArray(currentConversation.metadata)
          ? { ...(currentConversation.metadata as Record<string, unknown>) }
          : {};
      const newMetadata = shouldPause
        ? {
            ...currentMeta,
            automationPausedAt: providerTimestamp.toISOString(),
            automationPausedReason: "external_human_reply",
          }
        : currentConversation.metadata;

      await currentTransaction.conversation.update({
        data: {
          ...(shouldPause
            ? {
                automationMode: "HUMAN",
                metadata: newMetadata as Prisma.InputJsonValue,
              }
            : {}),
          lastHumanMessageAt: latestTimestamp(
            currentConversation.lastHumanMessageAt,
            providerTimestamp,
          ),
          lastMessageAt: latestTimestamp(currentConversation.lastMessageAt, providerTimestamp),
          lastOutboundAt: latestTimestamp(currentConversation.lastOutboundAt, providerTimestamp),
        },
        where: { tenantId_id: { id: conversation.id, tenantId: tenant.tenantId } },
      });

      const processed = await currentTransaction.inboundMessageEvent.updateMany({
        data: { processedAt: new Date(), processedStatus: "PROCESSED" },
        where: { id: event.id, processedStatus: "PENDING", tenantId: tenant.tenantId },
      });
      if (processed.count !== 1) throw new ExternalHumanMessageAlreadyProcessedError();

      const access = createTenantDataAccess(tenant, currentTransaction);

      if (shouldPause) {
        await access.audit.append({
          action: "conversation.automation_mode_updated",
          actorId: null,
          actorType: "system",
          afterSummary: {
            automationMode: "HUMAN",
            reason: "external_human_reply",
          },
          beforeSummary: {
            automationMode: currentConversation.automationMode,
          },
          entityId: conversation.id,
          entityType: "Conversation",
          requestId: "external-human-message-reconciliation",
        });
        await access.outbox.append({
          aggregateId: conversation.id,
          aggregateType: "Conversation",
          eventType: "conversation.automation_mode_updated",
          payload: {
            actorId: null,
            conversationId: conversation.id,
            newMode: "HUMAN",
            previousMode: currentConversation.automationMode,
            reason: "external_human_reply",
            tenantId: tenant.tenantId,
            timestamp: providerTimestamp.toISOString(),
          },
        });
      }

      await access.outbox.append({
        aggregateId: created.id,
        aggregateType: "Message",
        eventType: "message.external_human_detected",
        payload: {
          channelAccountId: created.channelAccountId,
          contactId: created.contactId,
          conversationId: created.conversationId,
          eventId: event.id,
          messageId: created.id,
          origin: created.origin,
          providerMessageId: created.providerMessageId,
          providerTimestamp: providerTimestamp.toISOString(),
        },
      });

      return { conversationId: created.conversationId, duplicate: false, message: created };
    });

    return operation.catch(async (error) => {
      if (!isUniqueViolation(error)) throw error;
      const existing = await database.message.findFirst({
        where: {
          channelAccountId: input.channelAccountId,
          providerMessageId,
          tenantId: tenant.tenantId,
        },
      });
      if (existing?.direction === "outbound" && existing.outboundMessageId !== null) {
        throw new ExternalHumanMessageOutboundEchoRaceError();
      }
      const existingByEvent = await database.message.findFirst({
        where: { inboundEventId: input.inboundEventId, tenantId: tenant.tenantId },
      });
      if (existingByEvent !== null) {
        return {
          conversationId: existingByEvent.conversationId,
          duplicate: true,
          message: existingByEvent,
        };
      }
      throw new ExternalHumanMessageProviderIdentityConflictError();
    });
  };

  return Object.freeze({ reconcileExternalHumanMessage });
}
