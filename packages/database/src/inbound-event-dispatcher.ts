import type { ConversationManagerDatabase } from "./conversation-manager";
import {
  createExternalHumanMessageManager,
  type ExternalHumanMessageManager,
  ExternalHumanMessageOutboundEchoRaceError,
  type ExternalHumanMessageResult,
} from "./external-human-message-manager";
import type { InboundMessageEvent, Prisma, PrismaClient } from "./generated/prisma/client";
import {
  createInboundMessageManager,
  type InboundMessageManager,
  type InboundMessagePersistResult,
} from "./inbound-message-manager";
import {
  createOutboundEchoManager,
  OutboundEchoAlreadyProcessedError,
  type OutboundEchoManager,
  OutboundEchoNotMatchedError,
  type OutboundEchoReconcileResult,
} from "./outbound-echo-manager";
import { createTenantContext, type TenantContext } from "./tenant-context";

export type InboundEventDispatcherDatabase = ConversationManagerDatabase &
  Pick<PrismaClient, "message" | "outboundMessage">;

export type InboundEventDispatchInput = Readonly<{ inboundEventId: string }>;

export type InboundEventDispatchResult = Readonly<
  | { kind: "inbound"; result: InboundMessagePersistResult }
  | { kind: "echo"; result: OutboundEchoReconcileResult }
  | { kind: "external_human"; result: ExternalHumanMessageResult }
>;

export class InboundEventDispatchEventNotFoundError extends Error {
  override readonly name = "InboundEventDispatchEventNotFoundError";

  constructor() {
    super("Inbound event was not found");
  }
}

export class InboundEventDispatchDeferredError extends Error {
  override readonly name = "InboundEventDispatchDeferredError";

  constructor(eventType: string) {
    super(`Inbound event type ${eventType} is deferred to a later story`);
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function jsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function externalStructuredPayload(event: InboundMessageEvent): Prisma.InputJsonValue | undefined {
  const normalized = record(event.normalizedData);
  const payload = record(event.payload);
  const explicit = jsonValue(normalized.structuredPayload ?? payload.structuredPayload);
  if (explicit !== undefined) return explicit;
  const data: Record<string, Prisma.InputJsonValue> = {};
  const media = jsonValue(normalized.media ?? payload.media);
  const metadata = jsonValue(normalized.metadata);
  const conversationExternalId = jsonValue(normalized.conversationExternalId);
  if (media !== undefined) data.media = media;
  if (metadata !== undefined) data.metadata = metadata;
  if (conversationExternalId !== undefined) data.conversationExternalId = conversationExternalId;
  return Object.keys(data).length === 0 ? undefined : data;
}

function externalTextBody(event: InboundMessageEvent): string | null {
  const normalized = record(event.normalizedData);
  const payload = record(event.payload);
  return (
    stringValue(normalized.textBody) ??
    stringValue(payload.textBody) ??
    stringValue(payload.text) ??
    stringValue(payload.body) ??
    stringValue(payload.caption)
  );
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value);
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fromMe(event: InboundMessageEvent): boolean {
  const normalized = record(event.normalizedData);
  const payload = record(event.payload);
  return (
    normalized.fromMe === true ||
    normalized.origin === "human_external_device" ||
    payload.fromMe === true
  );
}

function providerTimestamp(event: InboundMessageEvent): Date {
  const normalized = record(event.normalizedData);
  return (
    dateValue(normalized.providerTimestamp) ??
    dateValue(normalized.timestamp) ??
    new Date(event.createdAt)
  );
}

export interface InboundEventDispatcher {
  dispatch(
    context: TenantContext,
    input: InboundEventDispatchInput,
  ): Promise<InboundEventDispatchResult>;
}

export function createInboundEventDispatcher(
  database: InboundEventDispatcherDatabase,
): InboundEventDispatcher {
  const inboundMessages: InboundMessageManager = createInboundMessageManager(database);
  const outboundEchoes: OutboundEchoManager = createOutboundEchoManager(database);
  const externalHumanMessages: ExternalHumanMessageManager =
    createExternalHumanMessageManager(database);

  const dispatch = async (
    context: TenantContext,
    input: InboundEventDispatchInput,
  ): Promise<InboundEventDispatchResult> => {
    const tenant = createTenantContext(context.tenantId);
    const event = await database.inboundMessageEvent.findFirst({
      where: { id: input.inboundEventId, tenantId: tenant.tenantId },
    });
    if (event === null) throw new InboundEventDispatchEventNotFoundError();

    if (event.eventType === "MESSAGE_RECEIVED") {
      if (!fromMe(event)) {
        return {
          kind: "inbound",
          result: await inboundMessages.persistInboundMessage(tenant, input),
        };
      }
      if (event.providerMessageId === null) throw new OutboundEchoNotMatchedError();
      const echoInput = {
        channelAccountId: event.channelAccountId,
        inboundEventId: event.id,
        providerMessageId: event.providerMessageId,
        providerTimestamp: providerTimestamp(event),
      };
      try {
        return {
          kind: "echo",
          result: await outboundEchoes.reconcileOutboundEcho(tenant, echoInput),
        };
      } catch (error) {
        if (
          !(error instanceof OutboundEchoNotMatchedError) &&
          !(error instanceof OutboundEchoAlreadyProcessedError)
        ) {
          throw error;
        }
      }

      try {
        return {
          kind: "external_human",
          result: await externalHumanMessages.reconcileExternalHumanMessage(tenant, {
            ...echoInput,
            recipientPhone: event.recipientPhone,
            structuredPayload: externalStructuredPayload(event),
            textBody: externalTextBody(event),
          }),
        };
      } catch (error) {
        if (!(error instanceof ExternalHumanMessageOutboundEchoRaceError)) throw error;
        return {
          kind: "echo",
          result: await outboundEchoes.reconcileOutboundEcho(tenant, echoInput),
        };
      }
    }

    throw new InboundEventDispatchDeferredError(event.eventType);
  };

  return Object.freeze({ dispatch });
}
