import { lockConversationInTransaction } from "./conversation-manager";
import type { Conversation, Prisma, PrismaClient } from "./generated/prisma/client";
import { OrganizationUnitNotFoundError } from "./organization-unit-manager";
import { ConversationNotFoundError } from "./outbound-conversation-message-manager";
import { createTenantContext, type TenantContext } from "./tenant-context";
import {
  createTenantDataAccess,
  type TenantDataAccessDatabase,
  type TenantTransactionDatabase,
} from "./tenant-data-access";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

export type ConversationMutationStatus = "open" | "pending" | "closed";

export type ConversationAssignmentInput = Readonly<{
  assignedUserId?: string | null;
  assignedUnitId?: string | null;
}>;

export type InboxMutationManagerDatabase = TenantTransactionDatabase &
  TenantDataAccessDatabase &
  Pick<PrismaClient, "conversation" | "organizationUnit" | "tenant" | "tenantEntitlement" | "user">;

export interface InboxMutationManager {
  updateConversationStatus(
    context: TenantContext,
    conversationId: string,
    actorId: string,
    status: ConversationMutationStatus,
    reason?: string,
    requestId?: string,
  ): Promise<Conversation>;
  assignConversation(
    context: TenantContext,
    conversationId: string,
    actorId: string,
    input: ConversationAssignmentInput,
    requestId?: string,
  ): Promise<Conversation>;
}

export class InvalidConversationStateTransitionError extends Error {
  override readonly name = "InvalidConversationStateTransitionError";

  constructor(
    readonly previousStatus: string,
    readonly newStatus: string,
  ) {
    super(`Invalid conversation state transition: ${previousStatus} -> ${newStatus}`);
  }
}

export class ActiveTenantUserNotFoundError extends Error {
  override readonly name = "ActiveTenantUserNotFoundError";

  constructor() {
    super("An active tenant user was not found");
  }
}

export class ConversationMutationActorNotFoundError extends Error {
  override readonly name = "ConversationMutationActorNotFoundError";

  constructor() {
    super("The conversation mutation actor was not found");
  }
}

export class InvalidConversationAssignmentError extends Error {
  override readonly name = "InvalidConversationAssignmentError";

  constructor() {
    super("At least one conversation assignment field is required");
  }
}

const ALLOWED_TRANSITIONS: Readonly<Record<string, readonly ConversationMutationStatus[]>> = {
  closed: ["open"],
  new: ["open", "closed"],
  open: ["pending", "closed"],
  pending: ["open", "closed"],
};

type ConversationMutationRow = Pick<
  Conversation,
  | "assignedUnitId"
  | "assignedUserId"
  | "channelAccountId"
  | "closedAt"
  | "contactId"
  | "id"
  | "status"
  | "tenantId"
>;

function conversationWhere(
  tenantId: string,
  conversationId: string,
): Prisma.ConversationWhereUniqueInput {
  return { tenantId_id: { id: conversationId, tenantId } };
}

async function findConversation(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  conversationId: string,
): Promise<ConversationMutationRow | null> {
  return transaction.conversation.findUnique({
    select: {
      assignedUnitId: true,
      assignedUserId: true,
      channelAccountId: true,
      closedAt: true,
      contactId: true,
      id: true,
      status: true,
      tenantId: true,
    },
    where: conversationWhere(tenantId, conversationId),
  });
}

async function authorizeMutation(
  context: TenantContext,
  transaction: Prisma.TransactionClient,
): Promise<TenantContext> {
  const tenant = createTenantContext(context.tenantId);
  await assertTenantOperational(tenant, transaction);
  await assertTenantModuleEntitled(tenant, "module.messaging.basic", transaction);
  await assertTenantModuleEntitled(tenant, "module.crm_lite", transaction);
  return tenant;
}

async function assertActiveActor(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  actorId: string,
): Promise<void> {
  const actor = await transaction.user.findFirst({
    select: { id: true },
    where: { id: actorId, status: "active", tenantId },
  });
  if (actor === null) throw new ConversationMutationActorNotFoundError();
}

function assertStatusTransition(
  previousStatus: string,
  newStatus: ConversationMutationStatus,
): void {
  if (!ALLOWED_TRANSITIONS[previousStatus]?.includes(newStatus)) {
    throw new InvalidConversationStateTransitionError(previousStatus, newStatus);
  }
}

function summary(value: Record<string, string | null>): Prisma.InputJsonValue {
  return value;
}

async function appendStatusMutation(
  context: TenantContext,
  transaction: Prisma.TransactionClient,
  conversationId: string,
  actorId: string,
  previousStatus: string,
  newStatus: ConversationMutationStatus,
  reason: string | null,
  timestamp: Date,
  requestId: string,
): Promise<void> {
  const access = createTenantDataAccess(context, transaction);
  await access.audit.append({
    action: "conversation.status_updated",
    actorId,
    actorType: "tenant_user",
    afterSummary: summary({ actorId, newStatus, reason }),
    beforeSummary: summary({ previousStatus }),
    entityId: conversationId,
    entityType: "Conversation",
    requestId,
  });
  await access.outbox.append({
    aggregateId: conversationId,
    aggregateType: "Conversation",
    eventType: "conversation.status_updated",
    payload: {
      actorId,
      conversationId,
      newStatus,
      previousStatus,
      tenantId: context.tenantId,
      timestamp: timestamp.toISOString(),
    },
  });
}

async function appendAssignmentMutation(
  context: TenantContext,
  transaction: Prisma.TransactionClient,
  conversationId: string,
  actorId: string,
  previousAssignedUserId: string | null,
  previousAssignedUnitId: string | null,
  assignedUserId: string | null,
  assignedUnitId: string | null,
  timestamp: Date,
  requestId: string,
): Promise<void> {
  const access = createTenantDataAccess(context, transaction);
  await access.audit.append({
    action: "conversation.assigned",
    actorId,
    actorType: "tenant_user",
    afterSummary: summary({ actorId, assignedUnitId, assignedUserId }),
    beforeSummary: summary({
      assignedUnitId: previousAssignedUnitId,
      assignedUserId: previousAssignedUserId,
    }),
    entityId: conversationId,
    entityType: "Conversation",
    requestId,
  });
  await access.outbox.append({
    aggregateId: conversationId,
    aggregateType: "Conversation",
    eventType: "conversation.assigned",
    payload: {
      actorId,
      assignedUnitId,
      assignedUserId,
      conversationId,
      tenantId: context.tenantId,
      timestamp: timestamp.toISOString(),
    },
  });
}

export function createInboxMutationManager(
  database: InboxMutationManagerDatabase,
): InboxMutationManager {
  const updateConversationStatus = async (
    context: TenantContext,
    conversationId: string,
    actorId: string,
    status: ConversationMutationStatus,
    reason?: string,
    requestId = "inbox-conversation-status",
  ): Promise<Conversation> => {
    const tenant = createTenantContext(context.tenantId);
    return database.$transaction(async (transaction) => {
      await authorizeMutation(tenant, transaction);
      await assertActiveActor(transaction, tenant.tenantId, actorId);

      const current = await findConversation(transaction, tenant.tenantId, conversationId);
      if (current === null) throw new ConversationNotFoundError();
      await lockConversationInTransaction(
        transaction,
        tenant.tenantId,
        current.channelAccountId,
        current.contactId,
      );
      const locked = await findConversation(transaction, tenant.tenantId, conversationId);
      if (locked === null) throw new ConversationNotFoundError();
      assertStatusTransition(locked.status, status);

      const timestamp = new Date();
      const updated = await transaction.conversation.update({
        data: {
          closedAt: status === "closed" ? timestamp : null,
          status,
          updatedAt: timestamp,
        },
        where: conversationWhere(tenant.tenantId, conversationId),
      });
      await appendStatusMutation(
        tenant,
        transaction,
        updated.id,
        actorId,
        locked.status,
        status,
        reason ?? null,
        timestamp,
        requestId,
      );
      return updated;
    });
  };

  const assignConversation = async (
    context: TenantContext,
    conversationId: string,
    actorId: string,
    input: ConversationAssignmentInput,
    requestId = "inbox-conversation-assignment",
  ): Promise<Conversation> => {
    if (input.assignedUserId === undefined && input.assignedUnitId === undefined) {
      throw new InvalidConversationAssignmentError();
    }

    const tenant = createTenantContext(context.tenantId);
    return database.$transaction(async (transaction) => {
      await authorizeMutation(tenant, transaction);
      await assertActiveActor(transaction, tenant.tenantId, actorId);

      const current = await findConversation(transaction, tenant.tenantId, conversationId);
      if (current === null) throw new ConversationNotFoundError();
      await lockConversationInTransaction(
        transaction,
        tenant.tenantId,
        current.channelAccountId,
        current.contactId,
      );
      const locked = await findConversation(transaction, tenant.tenantId, conversationId);
      if (locked === null) throw new ConversationNotFoundError();

      if (typeof input.assignedUserId === "string") {
        const assignedUser = await transaction.user.findFirst({
          select: { id: true },
          where: { id: input.assignedUserId, status: "active", tenantId: tenant.tenantId },
        });
        if (assignedUser === null) throw new ActiveTenantUserNotFoundError();
      }
      if (typeof input.assignedUnitId === "string") {
        const assignedUnit = await transaction.organizationUnit.findFirst({
          select: { id: true },
          where: { active: true, id: input.assignedUnitId, tenantId: tenant.tenantId },
        });
        if (assignedUnit === null) throw new OrganizationUnitNotFoundError();
      }

      const assignedUserId =
        input.assignedUserId === undefined ? locked.assignedUserId : input.assignedUserId;
      const assignedUnitId =
        input.assignedUnitId === undefined ? locked.assignedUnitId : input.assignedUnitId;
      const timestamp = new Date();
      const updated = await transaction.conversation.update({
        data: {
          ...(input.assignedUserId === undefined ? {} : { assignedUserId }),
          ...(input.assignedUnitId === undefined ? {} : { assignedUnitId }),
          updatedAt: timestamp,
        },
        where: conversationWhere(tenant.tenantId, conversationId),
      });
      await appendAssignmentMutation(
        tenant,
        transaction,
        updated.id,
        actorId,
        locked.assignedUserId,
        locked.assignedUnitId,
        updated.assignedUserId,
        updated.assignedUnitId,
        timestamp,
        requestId,
      );
      return updated;
    });
  };

  return Object.freeze({ assignConversation, updateConversationStatus });
}
