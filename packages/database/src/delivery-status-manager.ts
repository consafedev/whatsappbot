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

export const DELIVERY_STATUS_RANK = Object.freeze({
  failed: -1,
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
} as const);

export type DeliveryStatus = keyof typeof DELIVERY_STATUS_RANK;

export type DeliveryStatusUpdate = Readonly<{
  status: Exclude<DeliveryStatus, "queued">;
  timestamp: Date;
  errorCode?: string;
  errorMessage?: string;
}>;

export type DeliveryStatusReconcileInput = Readonly<{
  inboundEventId: string;
  channelAccountId: string;
  providerMessageId: string;
  statusUpdate: DeliveryStatusUpdate;
}>;

export type DeliveryStatusReconcileResult = Readonly<{
  duplicate: boolean;
  message: Message;
  outboundMessage: OutboundMessage | null;
  deliveryStatus: string;
}>;

export type DeliveryStatusTransaction = Prisma.TransactionClient;

export type DeliveryStatusManagerDatabase = TenantTransactionDatabase &
  Pick<
    PrismaClient,
    | "channelAccount"
    | "inboundMessageEvent"
    | "message"
    | "outboundMessage"
    | "tenant"
    | "tenantEntitlement"
  >;

export class DeliveryStatusEventNotFoundError extends Error {
  override readonly name = "DeliveryStatusEventNotFoundError";

  constructor() {
    super("Delivery status event was not found");
  }
}

export class DeliveryStatusEventTypeUnsupportedError extends Error {
  override readonly name = "DeliveryStatusEventTypeUnsupportedError";

  constructor() {
    super("Delivery status requires a STATUS_UPDATE or DELIVERY_RECEIPT event");
  }
}

export class DeliveryStatusMessageNotFoundError extends Error {
  override readonly name = "DeliveryStatusMessageNotFoundError";

  constructor() {
    super("Delivery status does not match a persisted platform message");
  }
}

export class DeliveryStatusMessageConflictError extends Error {
  override readonly name = "DeliveryStatusMessageConflictError";

  constructor() {
    super("Delivery status provider identity conflicts with the canonical message");
  }
}

export class DeliveryStatusChannelMismatchError extends Error {
  override readonly name = "DeliveryStatusChannelMismatchError";

  constructor() {
    super("Delivery status channel does not match the source event");
  }
}

type DeliveryCorrelation = Readonly<{
  message: Message;
  outboundMessage: OutboundMessage | null;
}>;

function validProviderMessageId(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("providerMessageId must be a non-empty string");
  }
  return value;
}

function validTimestamp(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("Delivery status timestamp must be a valid Date");
  }
  return new Date(value);
}

function validDeliveryStatus(value: unknown): asserts value is Exclude<DeliveryStatus, "queued"> {
  if (typeof value !== "string" || value === "queued" || !(value in DELIVERY_STATUS_RANK)) {
    throw new TypeError("Delivery status must be sent, delivered, read or failed");
  }
}

function sanitizeErrorPart(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const sanitized = value
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return sanitized.length === 0 ? null : sanitized;
}

function sanitizedLastError(update: DeliveryStatusUpdate): string | null {
  return sanitizeErrorPart(update.errorCode) ?? sanitizeErrorPart(update.errorMessage);
}

function currentRank(status: string): number {
  return status in DELIVERY_STATUS_RANK
    ? DELIVERY_STATUS_RANK[status as DeliveryStatus]
    : DELIVERY_STATUS_RANK.failed;
}

function shouldApplyStatus(currentStatus: string, incomingStatus: DeliveryStatus): boolean {
  if (incomingStatus === "failed") {
    return currentStatus === "queued" || currentStatus === "sent";
  }
  return currentRank(incomingStatus) > currentRank(currentStatus);
}

async function findCorrelation(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  channelAccountId: string,
  providerMessageId: string,
): Promise<DeliveryCorrelation | null> {
  const message = await transaction.message.findFirst({
    where: { channelAccountId, providerMessageId, tenantId },
  });
  if (message !== null) {
    if (message.direction !== "outbound") throw new DeliveryStatusMessageConflictError();
    if (message.outboundMessageId === null) return { message, outboundMessage: null };

    const outboundMessage = await transaction.outboundMessage.findFirst({
      where: { id: message.outboundMessageId, tenantId },
    });
    if (outboundMessage === null || outboundMessage.channelAccountId !== channelAccountId) {
      throw new DeliveryStatusMessageConflictError();
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
  if (
    linkedMessage.direction !== "outbound" ||
    linkedMessage.channelAccountId !== channelAccountId
  ) {
    throw new DeliveryStatusMessageConflictError();
  }
  return { message: linkedMessage, outboundMessage };
}

function validateEvent(
  event: InboundMessageEvent,
  input: DeliveryStatusReconcileInput,
  tenantId: string,
): void {
  if (event.tenantId !== tenantId) throw new DeliveryStatusEventNotFoundError();
  if (event.channelAccountId !== input.channelAccountId) {
    throw new DeliveryStatusChannelMismatchError();
  }
  if (event.eventType !== "STATUS_UPDATE" && event.eventType !== "DELIVERY_RECEIPT") {
    throw new DeliveryStatusEventTypeUnsupportedError();
  }
}

async function currentCorrelation(
  transaction: Prisma.TransactionClient,
  correlation: DeliveryCorrelation,
): Promise<DeliveryCorrelation> {
  const message = await transaction.message.findUnique({
    where: { tenantId_id: { id: correlation.message.id, tenantId: correlation.message.tenantId } },
  });
  if (message === null) return correlation;
  const outboundMessage =
    message.outboundMessageId === null
      ? null
      : await transaction.outboundMessage.findFirst({
          where: { id: message.outboundMessageId, tenantId: message.tenantId },
        });
  return { message, outboundMessage };
}

export interface DeliveryStatusManager {
  reconcileDeliveryStatus(
    context: TenantContext,
    input: DeliveryStatusReconcileInput,
    transaction?: DeliveryStatusTransaction,
  ): Promise<DeliveryStatusReconcileResult>;
}

export function createDeliveryStatusManager(
  database: DeliveryStatusManagerDatabase,
): DeliveryStatusManager {
  const reconcileDeliveryStatus = async (
    context: TenantContext,
    input: DeliveryStatusReconcileInput,
    transaction?: DeliveryStatusTransaction,
  ): Promise<DeliveryStatusReconcileResult> => {
    const tenant = createTenantContext(context.tenantId);
    const providerMessageId = validProviderMessageId(input.providerMessageId);
    const timestamp = validTimestamp(input.statusUpdate.timestamp);
    validDeliveryStatus(input.statusUpdate.status);

    const execute = async (
      tx: Prisma.TransactionClient,
    ): Promise<DeliveryStatusReconcileResult> => {
      await assertTenantOperational(tenant, tx);
      await assertTenantModuleEntitled(tenant, "module.messaging.basic", tx);
      await assertTenantModuleEntitled(tenant, "module.crm_lite", tx);

      const event = await tx.inboundMessageEvent.findFirst({
        where: { id: input.inboundEventId, tenantId: tenant.tenantId },
      });
      if (event === null) throw new DeliveryStatusEventNotFoundError();
      validateEvent(event, input, tenant.tenantId);

      const correlation = await findCorrelation(
        tx,
        tenant.tenantId,
        input.channelAccountId,
        providerMessageId,
      );
      if (correlation === null) throw new DeliveryStatusMessageNotFoundError();

      if (event.processedStatus !== "PENDING") {
        return {
          deliveryStatus: correlation.message.deliveryStatus,
          duplicate: true,
          message: correlation.message,
          outboundMessage: correlation.outboundMessage,
        };
      }

      const claimed = await tx.inboundMessageEvent.updateMany({
        data: { processedAt: new Date(), processedStatus: "PROCESSED" },
        where: { id: event.id, processedStatus: "PENDING", tenantId: tenant.tenantId },
      });
      if (claimed.count !== 1) {
        const latest = await currentCorrelation(tx, correlation);
        return {
          deliveryStatus: latest.message.deliveryStatus,
          duplicate: true,
          message: latest.message,
          outboundMessage: latest.outboundMessage,
        };
      }

      const incomingStatus = input.statusUpdate.status;
      const applyStatus = shouldApplyStatus(correlation.message.deliveryStatus, incomingStatus);
      const message =
        correlation.message.providerMessageId === null || applyStatus
          ? await tx.message.update({
              data: {
                ...(correlation.message.providerMessageId === null ? { providerMessageId } : {}),
                ...(applyStatus ? { deliveryStatus: incomingStatus } : {}),
              },
              where: {
                tenantId_id: { id: correlation.message.id, tenantId: tenant.tenantId },
              },
            })
          : correlation.message;

      let outboundMessage = correlation.outboundMessage;
      if (outboundMessage !== null && applyStatus && incomingStatus === "sent") {
        outboundMessage = await tx.outboundMessage.update({
          data: { sentAt: timestamp, status: "SENT" },
          where: { tenantId_id: { id: outboundMessage.id, tenantId: tenant.tenantId } },
        });
      }
      if (outboundMessage !== null && applyStatus && incomingStatus === "failed") {
        outboundMessage = await tx.outboundMessage.update({
          data: {
            failedAt: timestamp,
            lastError: sanitizedLastError(input.statusUpdate),
            status: "FAILED",
          },
          where: { tenantId_id: { id: outboundMessage.id, tenantId: tenant.tenantId } },
        });
      }

      await createTenantDataAccess(tenant, tx).outbox.append({
        aggregateId: message.id,
        aggregateType: "Message",
        eventType: "message.delivery_status_updated",
        payload: {
          conversationId: message.conversationId,
          deliveryStatus: incomingStatus,
          messageId: message.id,
          providerMessageId,
          tenantId: tenant.tenantId,
          timestamp: timestamp.toISOString(),
        },
      });

      return {
        deliveryStatus: message.deliveryStatus,
        duplicate: false,
        message,
        outboundMessage,
      };
    };

    return transaction === undefined ? database.$transaction(execute) : execute(transaction);
  };

  return Object.freeze({ reconcileDeliveryStatus });
}
