import type { OutboundMessage, Prisma, PrismaClient } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess, type TenantTransactionDatabase } from "./tenant-data-access";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

export const OUTBOUND_MESSAGE_STATUSES = [
  "PENDING",
  "QUEUED",
  "SENDING",
  "SENT",
  "FAILED",
  "RETRYING",
  "DLQ",
] as const;

export type OutboundMessageStatus = (typeof OUTBOUND_MESSAGE_STATUSES)[number];
export type OutboundMessageType = "text" | "media" | "template";

export type OutboundMessageContent = Readonly<{
  text?: string;
  mediaUrl?: string;
  mediaType?: string;
  caption?: string;
  templateName?: string;
  variables?: Readonly<Record<string, string>>;
}>;

export type OutboundMessageCreateInput = Readonly<{
  actorUserId?: string | null;
  content: OutboundMessageContent;
  idempotencyKey: string;
  maxRetries?: number;
  messageType: OutboundMessageType;
  recipientPhone: string;
  scheduledAt?: Date | null;
}>;

export type OutboundMessageRecord = OutboundMessage;

export type OutboundMessageManagerDatabase = TenantTransactionDatabase &
  Pick<PrismaClient, "channelAccount" | "outboundMessage" | "tenant" | "tenantEntitlement">;

export type OutboundMessageTransaction = Prisma.TransactionClient;

export class OutboundMessageChannelNotFoundError extends Error {
  override readonly name = "OutboundMessageChannelNotFoundError";

  constructor() {
    super("Channel account was not found");
  }
}

export class OutboundMessageChannelInactiveError extends Error {
  override readonly name = "OutboundMessageChannelInactiveError";

  constructor() {
    super("Channel account is inactive");
  }
}

export class OutboundMessageStateError extends Error {
  override readonly name = "OutboundMessageStateError";

  constructor(message = "Outbound message is not in an actionable state") {
    super(message);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function safeError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 500) || "Outbound message failed";
}

function jsonContent(content: OutboundMessageContent): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(content)) as Prisma.InputJsonValue;
}

function contextFor(tenantId: string): TenantContext {
  return createTenantContext(tenantId);
}

async function appendOutboundEvent(
  transaction: Prisma.TransactionClient,
  message: OutboundMessage,
  eventType: string,
  payload: Prisma.InputJsonValue,
): Promise<void> {
  await createTenantDataAccess(contextFor(message.tenantId), transaction).outbox.append({
    aggregateId: message.id,
    aggregateType: "OutboundMessage",
    eventType,
    payload,
  });
}

async function loadOwnedMessage(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  messageId: string,
): Promise<OutboundMessage> {
  const message = await transaction.outboundMessage.findUnique({
    where: { id: messageId, tenantId: context.tenantId },
  });
  if (message === null) throw new OutboundMessageStateError("Outbound message was not found");
  return message;
}

export interface OutboundMessageManager {
  enqueueOutboundMessage(
    context: TenantContext,
    channelAccountId: string,
    data: OutboundMessageCreateInput,
    transaction?: OutboundMessageTransaction,
  ): Promise<OutboundMessage>;
  findById(context: TenantContext, messageId: string): Promise<OutboundMessage | null>;
  claimNextPendingMessages(limit: number, lockDurationMs: number): Promise<OutboundMessage[]>;
  markAsSending(context: TenantContext, messageId: string): Promise<OutboundMessage>;
  markAsSent(
    context: TenantContext,
    messageId: string,
    providerMessageId: string,
  ): Promise<OutboundMessage>;
  markAsFailedOrRetry(
    context: TenantContext,
    messageId: string,
    error: unknown,
    shouldRetry: boolean,
    nextRetryAt: Date | null,
  ): Promise<OutboundMessage>;
  markAsDeadLetter(
    context: TenantContext,
    messageId: string,
    finalError: unknown,
  ): Promise<OutboundMessage>;
}

export function createOutboundMessageManager(
  database: OutboundMessageManagerDatabase,
): OutboundMessageManager {
  const enqueueOutboundMessage = async (
    context: TenantContext,
    channelAccountId: string,
    data: OutboundMessageCreateInput,
    transaction?: OutboundMessageTransaction,
  ): Promise<OutboundMessage> => {
    const tenant = createTenantContext(context.tenantId);

    const execute = async (tx: Prisma.TransactionClient): Promise<OutboundMessage> => {
      const existing = await tx.outboundMessage.findUnique({
        where: {
          tenantId_idempotencyKey: {
            idempotencyKey: data.idempotencyKey,
            tenantId: tenant.tenantId,
          },
        },
      });
      if (existing !== null) return existing;

      await assertTenantOperational(tenant, tx);
      await assertTenantModuleEntitled(tenant, "module.messaging.basic", tx);
      const channel = await tx.channelAccount.findUnique({
        where: { id: channelAccountId, tenantId: tenant.tenantId },
      });
      if (channel === null) throw new OutboundMessageChannelNotFoundError();
      if (!channel.active || channel.status === "archived" || channel.status === "disabled") {
        throw new OutboundMessageChannelInactiveError();
      }
      if (data.actorUserId !== undefined && data.actorUserId !== null) {
        const actor = await tx.user.findUnique({
          select: { id: true },
          where: { id: data.actorUserId, tenantId: tenant.tenantId, status: "active" },
        });
        if (actor === null) throw new OutboundMessageStateError("Actor user was not found");
      }

      return tx.outboundMessage.create({
        data: {
          actorUserId: data.actorUserId ?? null,
          channelAccountId,
          content: jsonContent(data.content),
          idempotencyKey: data.idempotencyKey,
          maxRetries: data.maxRetries ?? 3,
          messageType: data.messageType,
          recipientPhone: data.recipientPhone,
          scheduledAt: data.scheduledAt ?? null,
          status: "PENDING",
          tenantId: tenant.tenantId,
        },
      });
    };

    if (transaction !== undefined) return execute(transaction);
    try {
      return await database.$transaction(execute);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await database.outboundMessage.findUnique({
        where: {
          tenantId_idempotencyKey: {
            idempotencyKey: data.idempotencyKey,
            tenantId: tenant.tenantId,
          },
        },
      });
      if (existing === null) throw error;
      return existing;
    }
  };

  const findById = (context: TenantContext, messageId: string) =>
    database.outboundMessage.findUnique({
      where: { id: messageId, tenantId: createTenantContext(context.tenantId).tenantId },
    });

  const claimNextPendingMessages = async (limit: number, lockDurationMs: number) => {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be positive");
    if (!Number.isInteger(lockDurationMs) || lockDurationMs < 1) {
      throw new RangeError("lockDurationMs must be positive");
    }

    return database.$transaction(async (transaction) => {
      const now = new Date();
      const staleAt = new Date(now.getTime() - lockDurationMs);
      await transaction.outboundMessage.updateMany({
        data: { lastError: "Worker lease expired", status: "PENDING" },
        where: { status: "SENDING", updatedAt: { lt: staleAt } },
      });

      const candidates = await transaction.outboundMessage.findMany({
        orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: limit,
        where: {
          OR: [
            { status: "PENDING", OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] },
            { status: "RETRYING", scheduledAt: { lte: now } },
          ],
        },
      });
      const claimed: OutboundMessage[] = [];
      for (const candidate of candidates) {
        const result = await transaction.outboundMessage.updateMany({
          data: { status: "SENDING" },
          where: {
            id: candidate.id,
            status: candidate.status,
            tenantId: candidate.tenantId,
          },
        });
        if (result.count === 1) {
          claimed.push(
            await transaction.outboundMessage.findUniqueOrThrow({ where: { id: candidate.id } }),
          );
        }
      }
      return claimed;
    });
  };

  const markAsSending = async (context: TenantContext, messageId: string) =>
    database.$transaction(async (transaction) => {
      const tenant = createTenantContext(context.tenantId);
      const current = await loadOwnedMessage(transaction, tenant, messageId);
      if (current.status === "SENDING") return current;
      if (current.status !== "PENDING" && current.status !== "RETRYING") {
        throw new OutboundMessageStateError();
      }
      return transaction.outboundMessage.update({
        data: { status: "SENDING" },
        where: { id: messageId, tenantId: tenant.tenantId },
      });
    });

  const markAsSent = async (context: TenantContext, messageId: string, providerMessageId: string) =>
    database.$transaction(async (transaction) => {
      const tenant = createTenantContext(context.tenantId);
      const current = await loadOwnedMessage(transaction, tenant, messageId);
      if (current.status === "SENT" && current.providerMessageId === providerMessageId) {
        return current;
      }
      if (current.status !== "SENDING") throw new OutboundMessageStateError();
      const updated = await transaction.outboundMessage.update({
        data: {
          failedAt: null,
          lastError: null,
          providerMessageId,
          scheduledAt: null,
          sentAt: new Date(),
          status: "SENT",
        },
        where: { id: messageId, tenantId: tenant.tenantId },
      });
      await appendOutboundEvent(transaction, updated, "messaging.outbound.sent", {
        messageId: updated.id,
        providerMessageId,
        status: updated.status,
      });
      return updated;
    });

  const markAsFailedOrRetry = async (
    context: TenantContext,
    messageId: string,
    error: unknown,
    shouldRetry: boolean,
    nextRetryAt: Date | null,
  ) =>
    database.$transaction(async (transaction) => {
      const tenant = createTenantContext(context.tenantId);
      const current = await loadOwnedMessage(transaction, tenant, messageId);
      if (current.status !== "SENDING") {
        if (current.status === "FAILED" || current.status === "DLQ") return current;
        throw new OutboundMessageStateError();
      }
      const lastError = safeError(error);
      const retry = shouldRetry && current.retryCount < current.maxRetries;
      const deadLetter = shouldRetry && !retry;
      const updated = await transaction.outboundMessage.update({
        data: retry
          ? {
              lastError,
              retryCount: { increment: 1 },
              scheduledAt: nextRetryAt ?? new Date(),
              status: "RETRYING",
            }
          : {
              failedAt: new Date(),
              lastError,
              scheduledAt: null,
              status: deadLetter ? "DLQ" : "FAILED",
            },
        where: { id: messageId, tenantId: tenant.tenantId },
      });
      await appendOutboundEvent(
        transaction,
        updated,
        deadLetter ? "messaging.outbound.dlq" : "messaging.outbound.failed",
        {
          messageId: updated.id,
          retryCount: updated.retryCount,
          status: updated.status,
        },
      );
      return updated;
    });

  const markAsDeadLetter = async (context: TenantContext, messageId: string, finalError: unknown) =>
    database.$transaction(async (transaction) => {
      const tenant = createTenantContext(context.tenantId);
      const current = await loadOwnedMessage(transaction, tenant, messageId);
      if (current.status === "DLQ") return current;
      if (current.status !== "SENDING" && current.status !== "RETRYING") {
        throw new OutboundMessageStateError();
      }
      const updated = await transaction.outboundMessage.update({
        data: { failedAt: new Date(), lastError: safeError(finalError), status: "DLQ" },
        where: { id: messageId, tenantId: tenant.tenantId },
      });
      await appendOutboundEvent(transaction, updated, "messaging.outbound.dlq", {
        messageId: updated.id,
        retryCount: updated.retryCount,
        status: updated.status,
      });
      return updated;
    });

  return Object.freeze({
    claimNextPendingMessages,
    enqueueOutboundMessage,
    findById,
    markAsDeadLetter,
    markAsFailedOrRetry,
    markAsSending,
    markAsSent,
  });
}
