import type {
  InboundMessageEvent,
  Message,
  OutboundMessage,
  Prisma,
  PrismaClient,
} from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess, type TenantTransactionDatabase } from "./tenant-data-access";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

export type OutboundEchoReconcileInput = Readonly<{
  channelAccountId: string;
  inboundEventId: string;
  providerMessageId: string;
  providerTimestamp: Date;
}>;

export type OutboundEchoReconcileResult = Readonly<{
  duplicate: boolean;
  message: Message;
  outboundMessage: OutboundMessage;
}>;

export type OutboundEchoManagerDatabase = TenantTransactionDatabase &
  Pick<
    PrismaClient,
    | "channelAccount"
    | "inboundMessageEvent"
    | "message"
    | "outboundMessage"
    | "tenant"
    | "tenantEntitlement"
  >;

export class OutboundEchoEventNotFoundError extends Error {
  override readonly name = "OutboundEchoEventNotFoundError";

  constructor() {
    super("Outbound echo event was not found");
  }
}

export class OutboundEchoEventTypeUnsupportedError extends Error {
  override readonly name = "OutboundEchoEventTypeUnsupportedError";

  constructor() {
    super("Outbound echo requires a MESSAGE_RECEIVED event");
  }
}

export class OutboundEchoAlreadyProcessedError extends Error {
  override readonly name = "OutboundEchoAlreadyProcessedError";

  constructor() {
    super("Outbound echo event was already processed without a platform message");
  }
}

export class OutboundEchoNotMatchedError extends Error {
  override readonly name = "OutboundEchoNotMatchedError";

  constructor() {
    super("Outbound echo does not match a persisted platform message");
  }
}

export class OutboundEchoConflictError extends Error {
  override readonly name = "OutboundEchoConflictError";

  constructor() {
    super("Provider message identity conflicts with the canonical message direction");
  }
}

export class OutboundEchoChannelMismatchError extends Error {
  override readonly name = "OutboundEchoChannelMismatchError";

  constructor() {
    super("Outbound echo channel does not match the source event");
  }
}

export class OutboundEchoProviderMessageMismatchError extends Error {
  override readonly name = "OutboundEchoProviderMessageMismatchError";

  constructor() {
    super("Outbound echo provider message identity does not match the source event");
  }
}

function validProviderTimestamp(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("Outbound echo provider timestamp must be a valid Date");
  }
  return new Date(value);
}

type Correlation = Readonly<{
  message: Message;
  outboundMessage: OutboundMessage;
}>;

async function findCorrelation(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  channelAccountId: string,
  providerMessageId: string,
): Promise<Correlation | null> {
  const message = await transaction.message.findFirst({
    where: { channelAccountId, providerMessageId, tenantId },
  });
  if (message !== null) {
    if (message.direction !== "outbound" || message.outboundMessageId === null) {
      throw new OutboundEchoConflictError();
    }
    const outboundMessage = await transaction.outboundMessage.findFirst({
      where: { id: message.outboundMessageId, tenantId },
    });
    if (outboundMessage === null || outboundMessage.channelAccountId !== channelAccountId) {
      throw new OutboundEchoConflictError();
    }
    return { message, outboundMessage };
  }

  const outboundMessage = await transaction.outboundMessage.findFirst({
    where: { channelAccountId, providerMessageId, tenantId },
  });
  if (outboundMessage === null) return null;

  const linkedMessage = await transaction.message.findFirst({
    where: { outboundMessageId: outboundMessage.id, tenantId },
  });
  if (linkedMessage === null) return null;
  if (linkedMessage.direction !== "outbound") throw new OutboundEchoConflictError();
  return { message: linkedMessage, outboundMessage };
}

function eventFor(
  event: InboundMessageEvent,
  input: OutboundEchoReconcileInput,
  tenantId: string,
): void {
  if (event.tenantId !== tenantId) throw new OutboundEchoEventNotFoundError();
  if (event.channelAccountId !== input.channelAccountId) {
    throw new OutboundEchoChannelMismatchError();
  }
  if (event.providerMessageId !== input.providerMessageId) {
    throw new OutboundEchoProviderMessageMismatchError();
  }
  if (event.eventType !== "MESSAGE_RECEIVED") {
    throw new OutboundEchoEventTypeUnsupportedError();
  }
}

export interface OutboundEchoManager {
  reconcileOutboundEcho(
    context: TenantContext,
    input: OutboundEchoReconcileInput,
  ): Promise<OutboundEchoReconcileResult>;
}

export function createOutboundEchoManager(
  database: OutboundEchoManagerDatabase,
): OutboundEchoManager {
  const reconcileOutboundEcho = async (
    context: TenantContext,
    input: OutboundEchoReconcileInput,
  ): Promise<OutboundEchoReconcileResult> => {
    const tenant = createTenantContext(context.tenantId);
    const providerTimestamp = validProviderTimestamp(input.providerTimestamp);

    return database.$transaction(async (transaction) => {
      await assertTenantOperational(tenant, transaction);
      await assertTenantModuleEntitled(tenant, "module.messaging.basic", transaction);
      await assertTenantModuleEntitled(tenant, "module.crm_lite", transaction);

      const event = await transaction.inboundMessageEvent.findFirst({
        where: { id: input.inboundEventId, tenantId: tenant.tenantId },
      });
      if (event === null) throw new OutboundEchoEventNotFoundError();
      eventFor(event, input, tenant.tenantId);

      const correlation = await findCorrelation(
        transaction,
        tenant.tenantId,
        input.channelAccountId,
        input.providerMessageId,
      );
      if (correlation === null) {
        if (event.processedStatus !== "PENDING") throw new OutboundEchoAlreadyProcessedError();
        throw new OutboundEchoNotMatchedError();
      }

      if (event.processedStatus !== "PENDING") {
        return { ...correlation, duplicate: true };
      }

      const message = await transaction.message.update({
        data: {
          providerMessageId: correlation.message.providerMessageId ?? input.providerMessageId,
          providerTimestamp: correlation.message.providerTimestamp ?? providerTimestamp,
        },
        where: { tenantId_id: { id: correlation.message.id, tenantId: tenant.tenantId } },
      });
      const processedAt = new Date();
      const processed = await transaction.inboundMessageEvent.updateMany({
        data: { processedAt, processedStatus: "PROCESSED" },
        where: { id: event.id, processedStatus: "PENDING", tenantId: tenant.tenantId },
      });
      if (processed.count !== 1) throw new OutboundEchoAlreadyProcessedError();

      await createTenantDataAccess(tenant, transaction).outbox.append({
        aggregateId: message.id,
        aggregateType: "Message",
        eventType: "message.echo_reconciled",
        payload: {
          channelAccountId: message.channelAccountId,
          eventId: event.id,
          messageId: message.id,
          outboundMessageId: correlation.outboundMessage.id,
          providerMessageId: input.providerMessageId,
          providerTimestamp: providerTimestamp.toISOString(),
        },
      });

      return { duplicate: false, message, outboundMessage: correlation.outboundMessage };
    });
  };

  return Object.freeze({ reconcileOutboundEcho });
}
