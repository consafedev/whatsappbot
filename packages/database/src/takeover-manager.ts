import { lockConversationInTransaction } from "./conversation-manager";
import type { Conversation, Prisma, PrismaClient } from "./generated/prisma/client";
import { ConversationNotFoundError } from "./outbound-conversation-message-manager";
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

export class InvalidConversationAutomationModeError extends Error {
  override readonly name = "InvalidConversationAutomationModeError";

  constructor(readonly invalidMode: string) {
    super(`Invalid conversation automation mode: ${invalidMode}`);
  }
}

export type TakeoverManagerDatabase = TenantTransactionDatabase &
  TenantDataAccessDatabase &
  Pick<PrismaClient, "conversation" | "tenant" | "tenantEntitlement" | "user">;

export interface TakeoverManager {
  setConversationAutomationMode(
    context: TenantContext,
    conversationId: string,
    actorId: string,
    mode: ConversationAutomationMode,
    reason?: string,
    requestId?: string,
  ): Promise<Conversation>;
}

function parseJsonMetadata(metadata: Prisma.JsonValue | null): Record<string, unknown> {
  if (metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)) {
    return { ...(metadata as Record<string, unknown>) };
  }
  return {};
}

export function createTakeoverManager(database: TakeoverManagerDatabase): TakeoverManager {
  const setConversationAutomationMode = async (
    context: TenantContext,
    conversationId: string,
    actorId: string,
    mode: ConversationAutomationMode,
    reason?: string,
    requestId = "takeover-mode-toggle",
  ): Promise<Conversation> => {
    if (!CONVERSATION_AUTOMATION_MODES.includes(mode)) {
      throw new InvalidConversationAutomationModeError(String(mode));
    }

    const tenant = createTenantContext(context.tenantId);

    return database.$transaction(async (transaction) => {
      await assertTenantOperational(tenant, transaction);
      await assertTenantModuleEntitled(tenant, "module.messaging.basic", transaction);

      const current = await transaction.conversation.findUnique({
        select: {
          automationMode: true,
          channelAccountId: true,
          contactId: true,
          id: true,
          metadata: true,
          status: true,
          tenantId: true,
        },
        where: { tenantId_id: { id: conversationId, tenantId: tenant.tenantId } },
      });

      if (current === null) {
        throw new ConversationNotFoundError();
      }

      await lockConversationInTransaction(
        transaction,
        tenant.tenantId,
        current.channelAccountId,
        current.contactId,
      );

      const locked = await transaction.conversation.findUnique({
        select: {
          automationMode: true,
          channelAccountId: true,
          contactId: true,
          id: true,
          metadata: true,
          status: true,
          tenantId: true,
        },
        where: { tenantId_id: { id: conversationId, tenantId: tenant.tenantId } },
      });

      if (locked === null) {
        throw new ConversationNotFoundError();
      }

      const now = new Date();
      const currentMeta = parseJsonMetadata(locked.metadata);
      const currentPausedAt = currentMeta.automationPausedAt as string | null | undefined;

      const pausedAt = mode === "AUTO" ? null : (currentPausedAt ?? now.toISOString());
      const pausedReason = mode === "AUTO" ? null : (reason ?? "manual_toggle");

      const newMetadata = {
        ...currentMeta,
        automationPausedAt: pausedAt,
        automationPausedReason: pausedReason,
      };

      const updated = await transaction.conversation.update({
        data: {
          automationMode: mode,
          metadata: newMetadata as Prisma.InputJsonValue,
          updatedAt: now,
        },
        where: { tenantId_id: { id: conversationId, tenantId: tenant.tenantId } },
      });

      const access = createTenantDataAccess(tenant, transaction);
      await access.audit.append({
        action: "conversation.automation_mode_updated",
        actorId,
        actorType: actorId === "system" ? "system" : "tenant_user",
        afterSummary: {
          automationMode: mode,
          reason: pausedReason,
        },
        beforeSummary: {
          automationMode: locked.automationMode,
        },
        entityId: conversationId,
        entityType: "Conversation",
        requestId,
      });

      await access.outbox.append({
        aggregateId: conversationId,
        aggregateType: "Conversation",
        eventType: "conversation.automation_mode_updated",
        payload: {
          actorId,
          conversationId,
          newMode: mode,
          previousMode: locked.automationMode,
          reason: pausedReason,
          tenantId: tenant.tenantId,
          timestamp: now.toISOString(),
        },
      });

      return updated;
    });
  };

  return Object.freeze({ setConversationAutomationMode });
}

export async function setConversationAutomationMode(
  tenantContext: TenantContext,
  conversationId: string,
  actorId: string,
  mode: ConversationAutomationMode,
  reason?: string,
  database?: TakeoverManagerDatabase,
  requestId?: string,
): Promise<Conversation> {
  if (!database) {
    throw new Error("Database client is required for setConversationAutomationMode");
  }
  const manager = createTakeoverManager(database);
  return manager.setConversationAutomationMode(
    tenantContext,
    conversationId,
    actorId,
    mode,
    reason,
    requestId,
  );
}
