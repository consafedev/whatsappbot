import {
  type ConversationManagerDatabase,
  routeInboundEventToConversationInTransaction,
} from "./conversation-manager";
import type { InboundMessageEvent, Message, Prisma } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess } from "./tenant-data-access";

type JsonRecord = Readonly<Record<string, unknown>>;

export type InboundMessagePersistInput = Readonly<{
  inboundEventId: string;
  senderName?: string | null;
  providerThreadId?: string | null;
}>;

export type InboundMessagePersistResult = Readonly<{
  duplicate: boolean;
  message: Message;
  conversationId: string;
}>;

export type InboundMessageManagerDatabase = ConversationManagerDatabase &
  Pick<Prisma.TransactionClient, "message">;

export interface InboundMessageManager {
  persistInboundMessage(
    context: TenantContext,
    input: InboundMessagePersistInput,
  ): Promise<InboundMessagePersistResult>;
}

export class InboundMessageEventNotFoundError extends Error {
  override readonly name = "InboundMessageEventNotFoundError";

  constructor() {
    super("Inbound event was not found");
  }
}

export class InboundMessageEventTypeUnsupportedError extends Error {
  override readonly name = "InboundMessageEventTypeUnsupportedError";

  constructor() {
    super("Inbound event is not a message event");
  }
}

export class InboundMessageEventAlreadyProcessedError extends Error {
  override readonly name = "InboundMessageEventAlreadyProcessedError";

  constructor() {
    super("Inbound event was already processed without a persisted message");
  }
}

function record(value: Prisma.JsonValue | null): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const result = stringValue(value);
    if (result !== null) return result;
  }
  return null;
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value);
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function jsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function messageStructuredPayload(
  normalized: JsonRecord,
  payload: JsonRecord,
): Prisma.InputJsonValue | undefined {
  const data: Record<string, Prisma.InputJsonValue> = {};
  const media = jsonValue(normalized.media ?? payload.media);
  const metadata = jsonValue(normalized.metadata);
  const conversationExternalId = jsonValue(normalized.conversationExternalId);
  if (media !== undefined) data.media = media;
  if (metadata !== undefined) data.metadata = metadata;
  if (conversationExternalId !== undefined) data.conversationExternalId = conversationExternalId;
  return Object.keys(data).length === 0 ? undefined : data;
}

function messageData(
  event: InboundMessageEvent,
  conversationId: string,
  contactId: string,
): Prisma.MessageUncheckedCreateInput {
  const normalized = record(event.normalizedData);
  const payload = record(event.payload);
  const providerTimestamp =
    dateValue(normalized.providerTimestamp) ?? dateValue(normalized.timestamp) ?? event.createdAt;
  const textBody = firstString(
    normalized.textBody,
    payload.textBody,
    payload.text,
    payload.body,
    payload.caption,
  );
  const structuredPayload = messageStructuredPayload(normalized, payload);
  const origin =
    normalized.origin === "human_external_device" ? "human_external_device" : "customer";
  const data: Prisma.MessageUncheckedCreateInput = {
    actorId: contactId,
    actorType: "contact",
    channelAccountId: event.channelAccountId,
    contactId,
    conversationId,
    deliveryStatus: "received",
    direction: "inbound",
    inboundEventId: event.id,
    messageType:
      firstString(event.messageType, normalized.messageType, payload.messageType) ?? "unknown",
    origin,
    providerMessageId: event.providerMessageId,
    providerTimestamp,
    tenantId: event.tenantId,
    textBody,
  };
  if (structuredPayload !== undefined) data.structuredPayload = structuredPayload;
  return data;
}

function latestTimestamp(current: Date | null, candidate: Date): Date {
  return current === null || candidate.getTime() > current.getTime() ? candidate : current;
}

function existingMessageWhere(
  tenantId: string,
  inboundEventId: string,
  providerMessageId: string | null,
): Prisma.MessageWhereInput {
  return {
    tenantId,
    OR: [{ inboundEventId }, ...(providerMessageId === null ? [] : [{ providerMessageId }])],
  };
}

export function createInboundMessageManager(
  database: InboundMessageManagerDatabase,
): InboundMessageManager {
  const persistInboundMessage = async (
    context: TenantContext,
    input: InboundMessagePersistInput,
  ): Promise<InboundMessagePersistResult> => {
    const tenant = createTenantContext(context.tenantId);
    return database.$transaction(async (transaction) => {
      const existingByEvent = await transaction.message.findFirst({
        where: { inboundEventId: input.inboundEventId, tenantId: tenant.tenantId },
      });
      if (existingByEvent !== null) {
        return {
          conversationId: existingByEvent.conversationId,
          duplicate: true,
          message: existingByEvent,
        };
      }

      const inboundEvent = await transaction.inboundMessageEvent.findFirst({
        where: { id: input.inboundEventId, tenantId: tenant.tenantId },
      });
      if (inboundEvent === null) throw new InboundMessageEventNotFoundError();
      if (inboundEvent.eventType !== "MESSAGE_RECEIVED") {
        throw new InboundMessageEventTypeUnsupportedError();
      }
      if (inboundEvent.processedStatus !== "PENDING") {
        throw new InboundMessageEventAlreadyProcessedError();
      }

      const normalized = record(inboundEvent.normalizedData);
      const conversation = await routeInboundEventToConversationInTransaction(
        tenant,
        {
          inboundEventId: inboundEvent.id,
          providerThreadId:
            input.providerThreadId ?? stringValue(normalized.conversationExternalId),
          ...(input.senderName === undefined ? {} : { senderName: input.senderName }),
        },
        transaction,
        database,
      );

      const existing = await transaction.message.findFirst({
        where: existingMessageWhere(
          tenant.tenantId,
          inboundEvent.id,
          inboundEvent.providerMessageId,
        ),
      });
      if (existing !== null) {
        return {
          conversationId: existing.conversationId,
          duplicate: true,
          message: existing,
        };
      }

      const created = await transaction.message.create({
        data: messageData(inboundEvent, conversation.id, conversation.contactId),
      });
      const currentConversation = await transaction.conversation.findFirst({
        select: { lastInboundAt: true, lastMessageAt: true },
        where: { id: conversation.id, tenantId: tenant.tenantId },
      });
      if (currentConversation === null) throw new InboundMessageEventNotFoundError();
      const lastMessageAt = latestTimestamp(
        currentConversation.lastMessageAt,
        created.providerTimestamp,
      );
      const lastInboundAt = latestTimestamp(
        currentConversation.lastInboundAt,
        created.providerTimestamp,
      );
      await transaction.conversation.updateMany({
        data: { lastInboundAt, lastMessageAt },
        where: { id: conversation.id, tenantId: tenant.tenantId },
      });

      const processedAt = new Date();
      const processed = await transaction.inboundMessageEvent.updateMany({
        data: { processedAt, processedStatus: "PROCESSED" },
        where: { id: inboundEvent.id, processedStatus: "PENDING", tenantId: tenant.tenantId },
      });
      if (processed.count !== 1) throw new InboundMessageEventAlreadyProcessedError();

      const access = createTenantDataAccess(tenant, transaction);
      await access.outbox.append({
        aggregateId: created.id,
        aggregateType: "Message",
        eventType: "message.received",
        payload: {
          conversationId: created.conversationId,
          direction: created.direction,
          eventId: inboundEvent.id,
          messageId: created.id,
          origin: created.origin,
          providerMessageId: created.providerMessageId,
        },
      });

      return {
        conversationId: created.conversationId,
        duplicate: false,
        message: created,
      };
    });
  };

  return Object.freeze({ persistInboundMessage });
}
