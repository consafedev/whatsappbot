import type { ConversationManagerDatabase } from "./conversation-manager";
import type { InboundMessageEvent, PrismaClient } from "./generated/prisma/client";
import {
  createInboundMessageManager,
  type InboundMessageManager,
  type InboundMessagePersistResult,
} from "./inbound-message-manager";
import {
  createOutboundEchoManager,
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

function dateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value);
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fromMe(event: InboundMessageEvent): boolean {
  const normalized = record(event.normalizedData);
  return normalized.fromMe === true || normalized.origin === "human_external_device";
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
      return {
        kind: "echo",
        result: await outboundEchoes.reconcileOutboundEcho(tenant, {
          channelAccountId: event.channelAccountId,
          inboundEventId: event.id,
          providerMessageId: event.providerMessageId,
          providerTimestamp: providerTimestamp(event),
        }),
      };
    }

    throw new InboundEventDispatchDeferredError(event.eventType);
  };

  return Object.freeze({ dispatch });
}
