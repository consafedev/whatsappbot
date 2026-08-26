import { lockConversationInTransaction } from "./conversation-manager";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import {
  createTenantDataAccess,
  type TenantDataAccessDatabase,
  type TenantTransactionDatabase,
} from "./tenant-data-access";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

export interface InactivityTimeoutOptions {
  inactivityMinutes: number;
  warningThresholdMinutes?: number;
  closeReason?: string;
  releaseTakeoverMinutes?: number;
  actorId?: string;
  requestId?: string;
}

export interface InactivityProcessResult {
  closedCount: number;
  releasedCount: number;
  processedConversationIds: string[];
}

export class InvalidInactivityTimeoutOptionError extends Error {
  override readonly name = "InvalidInactivityTimeoutOptionError";

  constructor(message: string) {
    super(message);
  }
}

export type InactivityManagerDatabase = TenantTransactionDatabase &
  TenantDataAccessDatabase &
  Pick<
    PrismaClient,
    "conversation" | "tenant" | "tenantEntitlement" | "user" | "channelAccount" | "contact"
  >;

export interface InactivityManager {
  processInactivityTimeouts(
    context: TenantContext,
    options: InactivityTimeoutOptions,
  ): Promise<InactivityProcessResult>;
}

function parseJsonMetadata(metadata: Prisma.JsonValue | null): Record<string, unknown> {
  if (metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)) {
    return { ...(metadata as Record<string, unknown>) };
  }
  return {};
}

/**
 * Manages inactivity timeouts for conversations:
 * 1. Auto-Close: closes inactive conversations (`open` or `pending`) exceeding `inactivityMinutes`.
 * 2. Takeover Release: restores `automationMode = "AUTO"` for conversations in `HUMAN` mode exceeding `releaseTakeoverMinutes`.
 *
 * Enforces strict multi-tenant isolation, advisory locking per conversation, audit logging and outbox event emissions.
 */
export function createInactivityManager(database: InactivityManagerDatabase): InactivityManager {
  const processInactivityTimeouts = async (
    context: TenantContext,
    options: InactivityTimeoutOptions,
  ): Promise<InactivityProcessResult> => {
    if (
      !options ||
      typeof options.inactivityMinutes !== "number" ||
      !Number.isInteger(options.inactivityMinutes) ||
      options.inactivityMinutes <= 0
    ) {
      throw new InvalidInactivityTimeoutOptionError(
        "Inactivity minutes must be a positive integer",
      );
    }

    if (
      options.releaseTakeoverMinutes !== undefined &&
      (typeof options.releaseTakeoverMinutes !== "number" ||
        !Number.isInteger(options.releaseTakeoverMinutes) ||
        options.releaseTakeoverMinutes < 0)
    ) {
      throw new InvalidInactivityTimeoutOptionError(
        "Release takeover minutes must be a non-negative integer",
      );
    }

    const tenant = createTenantContext(context.tenantId);
    const tenantId = tenant.tenantId;

    await assertTenantOperational(tenant, database);
    await assertTenantModuleEntitled(tenant, "module.messaging.basic", database);

    const now = new Date();
    const autoCloseCutoff = new Date(now.getTime() - options.inactivityMinutes * 60 * 1000);
    const closeReason = options.closeReason?.trim() || "inactivity_timeout";
    const requestId = options.requestId ?? "process-inactivity-timeouts";

    // 1. Auto-Close: Query eligible active conversations for this tenant
    const eligibleForClose = await database.conversation.findMany({
      orderBy: { lastMessageAt: "asc" },
      select: {
        channelAccountId: true,
        contactId: true,
        id: true,
      },
      where: {
        OR: [
          { lastMessageAt: { lte: autoCloseCutoff } },
          { createdAt: { lte: autoCloseCutoff }, lastMessageAt: null },
        ],
        status: { in: ["open", "pending"] },
        tenantId,
      },
    });

    let closedCount = 0;
    const processedConversationIds: string[] = [];
    const closedConversationIds = new Set<string>();

    for (const item of eligibleForClose) {
      await database.$transaction(async (tx) => {
        await lockConversationInTransaction(
          tx,
          tenantId,
          item.channelAccountId,
          item.contactId,
        );

        const conv = await tx.conversation.findUnique({
          select: {
            createdAt: true,
            id: true,
            lastMessageAt: true,
            metadata: true,
            status: true,
          },
          where: { tenantId_id: { id: item.id, tenantId } },
        });

        if (!conv) return;
        if (conv.status !== "open" && conv.status !== "pending") return;

        const lastActive = conv.lastMessageAt ?? conv.createdAt;
        if (lastActive.getTime() > autoCloseCutoff.getTime()) return;

        const currentMeta = parseJsonMetadata(conv.metadata);
        const newMeta = {
          ...currentMeta,
          closedReason,
        };

        await tx.conversation.update({
          data: {
            closedAt: now,
            metadata: newMeta as Prisma.InputJsonValue,
            status: "closed",
            updatedAt: now,
          },
          where: { tenantId_id: { id: conv.id, tenantId } },
        });

        const access = createTenantDataAccess(tenant, tx);
        await access.audit.append({
          action: "conversation.auto_closed",
          actorId: options.actorId ?? null,
          actorType: options.actorId ? "tenant_user" : "system",
          afterSummary: {
            inactivityMinutes: options.inactivityMinutes,
            reason: closeReason,
            status: "closed",
          },
          beforeSummary: {
            status: conv.status,
          },
          entityId: conv.id,
          entityType: "Conversation",
          requestId,
        });

        await access.outbox.append({
          aggregateId: conv.id,
          aggregateType: "Conversation",
          eventType: "conversation.status_updated",
          payload: {
            actorId: options.actorId ?? "system",
            conversationId: conv.id,
            newStatus: "closed",
            previousStatus: conv.status,
            reason: closeReason,
            tenantId,
            timestamp: now.toISOString(),
          },
        });

        closedCount++;
        processedConversationIds.push(conv.id);
        closedConversationIds.add(conv.id);
      });
    }

    // 2. Takeover Release: Check conversations in HUMAN mode exceeding releaseTakeoverMinutes
    let releasedCount = 0;
    if (options.releaseTakeoverMinutes && options.releaseTakeoverMinutes > 0) {
      const releaseCutoff = new Date(
        now.getTime() - options.releaseTakeoverMinutes * 60 * 1000,
      );

      const eligibleForRelease = await database.conversation.findMany({
        orderBy: { lastMessageAt: "asc" },
        select: {
          channelAccountId: true,
          contactId: true,
          id: true,
        },
        where: {
          automationMode: "HUMAN",
          OR: [
            { lastMessageAt: { lte: releaseCutoff } },
            { createdAt: { lte: releaseCutoff }, lastMessageAt: null },
          ],
          status: { not: "closed" },
          tenantId,
        },
      });

      for (const item of eligibleForRelease) {
        if (closedConversationIds.has(item.id)) continue;

        await database.$transaction(async (tx) => {
          await lockConversationInTransaction(
            tx,
            tenantId,
            item.channelAccountId,
            item.contactId,
          );

          const conv = await tx.conversation.findUnique({
            select: {
              automationMode: true,
              createdAt: true,
              id: true,
              lastMessageAt: true,
              metadata: true,
              status: true,
            },
            where: { tenantId_id: { id: item.id, tenantId } },
          });

          if (!conv) return;
          if (conv.automationMode !== "HUMAN" || conv.status === "closed") return;

          const lastActive = conv.lastMessageAt ?? conv.createdAt;
          if (lastActive.getTime() > releaseCutoff.getTime()) return;

          const currentMeta = parseJsonMetadata(conv.metadata);
          const newMeta = {
            ...currentMeta,
            automationPausedAt: null,
            automationPausedReason: "inactivity_release",
          };

          await tx.conversation.update({
            data: {
              automationMode: "AUTO",
              metadata: newMeta as Prisma.InputJsonValue,
              updatedAt: now,
            },
            where: { tenantId_id: { id: conv.id, tenantId } },
          });

          const access = createTenantDataAccess(tenant, tx);
          await access.audit.append({
            action: "conversation.automation_mode_updated",
            actorId: options.actorId ?? null,
            actorType: options.actorId ? "tenant_user" : "system",
            afterSummary: {
              automationMode: "AUTO",
              reason: "inactivity_release",
            },
            beforeSummary: {
              automationMode: "HUMAN",
            },
            entityId: conv.id,
            entityType: "Conversation",
            requestId,
          });

          await access.outbox.append({
            aggregateId: conv.id,
            aggregateType: "Conversation",
            eventType: "conversation.automation_mode_updated",
            payload: {
              actorId: options.actorId ?? "system",
              conversationId: conv.id,
              newMode: "AUTO",
              previousMode: "HUMAN",
              reason: "inactivity_release",
              tenantId,
              timestamp: now.toISOString(),
            },
          });

          releasedCount++;
          if (!processedConversationIds.includes(conv.id)) {
            processedConversationIds.push(conv.id);
          }
        });
      }
    }

    return {
      closedCount,
      processedConversationIds,
      releasedCount,
    };
  };

  return Object.freeze({ processInactivityTimeouts });
}

export async function processInactivityTimeouts(
  tenantContext: TenantContext,
  options: InactivityTimeoutOptions,
  database?: InactivityManagerDatabase,
): Promise<InactivityProcessResult> {
  if (!database) {
    throw new Error("Database client is required for processInactivityTimeouts");
  }
  const manager = createInactivityManager(database);
  return manager.processInactivityTimeouts(tenantContext, options);
}
