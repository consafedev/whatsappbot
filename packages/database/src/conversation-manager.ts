import { createContactManager } from "./contact-manager";
import type { ModuleEntitlementKey } from "./entitlement-catalog";
import type { Conversation, Prisma } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import {
  createTenantDataAccess,
  type TenantDataAccessDatabase,
  type TenantTransactionDatabase,
} from "./tenant-data-access";
import {
  assertTenantModuleEntitled,
  TenantModuleEntitlementRequiredError,
} from "./tenant-entitlements";
import { assertTenantOperational, TenantNotOperationalError } from "./tenant-operational";

export const CONVERSATION_STATUSES = ["new", "open", "pending", "closed"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const CONVERSATION_AUTOMATION_MODES = ["AUTO", "ASSISTED", "HUMAN", "MONITOR"] as const;
export type ConversationAutomationMode = (typeof CONVERSATION_AUTOMATION_MODES)[number];

const ACTIVE_CONVERSATION_STATUSES: readonly ConversationStatus[] = ["new", "open", "pending"];

export type ConversationItem = Readonly<{
  id: string;
  tenantId: string;
  channelAccountId: string;
  contactId: string;
  status: ConversationStatus;
  automationMode: ConversationAutomationMode;
  assignedUserId: string | null;
  assignedUnitId: string | null;
  priority: number;
  subject: string | null;
  providerThreadId: string | null;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  lastHumanMessageAt: Date | null;
  lastAutomationMessageAt: Date | null;
  humanTakeoverUntil: Date | null;
  closedAt: Date | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  isNew?: boolean;
}>;

export type ConversationRouteInput = Readonly<{
  inboundEventId: string;
  senderPhone?: string | null;
  senderName?: string | null;
  providerThreadId?: string | null;
}>;

export type ExternalHumanConversationRouteInput = Readonly<{
  inboundEventId: string;
  recipientPhone: string;
  providerThreadId?: string | null;
}>;

export type ConversationManagerDatabase = TenantTransactionDatabase &
  TenantDataAccessDatabase &
  Pick<
    Prisma.TransactionClient,
    | "channelAccount"
    | "contact"
    | "conversation"
    | "inboundMessageEvent"
    | "tenant"
    | "tenantEntitlement"
  >;
export type ConversationTransaction = Prisma.TransactionClient;

export interface ConversationManager {
  routeInboundEventToConversation(
    context: TenantContext,
    input: ConversationRouteInput,
  ): Promise<ConversationItem>;
}

export class ConversationChannelNotFoundError extends Error {
  override readonly name = "ConversationChannelNotFoundError";

  constructor() {
    super("Channel was not found");
  }
}

export class ConversationChannelInactiveError extends Error {
  override readonly name = "ConversationChannelInactiveError";

  constructor() {
    super("Channel is not active");
  }
}

export class ConversationInboundEventNotFoundError extends Error {
  override readonly name = "ConversationInboundEventNotFoundError";

  constructor() {
    super("Inbound event was not found");
  }
}

export class ConversationSenderPhoneRequiredError extends Error {
  override readonly name = "ConversationSenderPhoneRequiredError";

  constructor() {
    super("Inbound event sender phone is required to resolve a conversation");
  }
}

export class ConversationTenantNotOperationalError extends Error {
  override readonly name = "ConversationTenantNotOperationalError";

  constructor() {
    super("Tenant is not operational");
  }
}

export class ConversationModuleEntitlementRequiredError extends Error {
  override readonly name = "ConversationModuleEntitlementRequiredError";

  constructor(readonly moduleKey: ModuleEntitlementKey) {
    super(`Conversation module entitlement is required: ${moduleKey}`);
  }
}

function isConversationStatus(value: string): value is ConversationStatus {
  return CONVERSATION_STATUSES.includes(value as ConversationStatus);
}

function isAutomationMode(value: string | null): value is ConversationAutomationMode {
  return (
    value !== null && CONVERSATION_AUTOMATION_MODES.includes(value as ConversationAutomationMode)
  );
}

function conversationItem(conversation: Conversation): ConversationItem {
  if (!isConversationStatus(conversation.status)) {
    throw new Error(`Unsupported conversation status: ${conversation.status}`);
  }
  if (!isAutomationMode(conversation.automationMode)) {
    throw new Error(`Unsupported conversation automation mode: ${conversation.automationMode}`);
  }
  return {
    assignedUnitId: conversation.assignedUnitId,
    assignedUserId: conversation.assignedUserId,
    automationMode: conversation.automationMode,
    channelAccountId: conversation.channelAccountId,
    closedAt: conversation.closedAt,
    contactId: conversation.contactId,
    createdAt: conversation.createdAt,
    humanTakeoverUntil: conversation.humanTakeoverUntil,
    id: conversation.id,
    lastAutomationMessageAt: conversation.lastAutomationMessageAt,
    lastHumanMessageAt: conversation.lastHumanMessageAt,
    lastInboundAt: conversation.lastInboundAt,
    lastMessageAt: conversation.lastMessageAt,
    lastOutboundAt: conversation.lastOutboundAt,
    metadata: conversation.metadata,
    priority: conversation.priority,
    providerThreadId: conversation.providerThreadId,
    status: conversation.status,
    subject: conversation.subject,
    tenantId: conversation.tenantId,
    updatedAt: conversation.updatedAt,
  };
}

function summary(conversation: ConversationItem): Prisma.InputJsonValue {
  return {
    automationMode: conversation.automationMode,
    channelAccountId: conversation.channelAccountId,
    contactId: conversation.contactId,
    id: conversation.id,
    status: conversation.status,
  };
}

function activeChannelStatus(status: string): boolean {
  return status !== "archived" && status !== "disabled" && status !== "disconnected";
}

function defaultAutomationMode(mode: string | null): ConversationAutomationMode {
  return isAutomationMode(mode) ? mode : "AUTO";
}

export function lockConversationInTransaction(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  channelAccountId: string,
  contactId: string,
): Promise<unknown> {
  return transaction.$queryRaw`
    SELECT 1 FROM pg_advisory_xact_lock(
      hashtextextended(
        ${tenantId}::text || ':conversation:'::text || ${channelAccountId}::text || ':'::text || ${contactId}::text,
        0::bigint
      )
    )`;
}

async function assertConversationEntitlements(
  context: TenantContext,
  transaction: Prisma.TransactionClient,
): Promise<void> {
  try {
    await assertTenantModuleEntitled(context, "module.messaging.basic", transaction);
    await assertTenantModuleEntitled(context, "module.crm_lite", transaction);
  } catch (error) {
    if (error instanceof TenantModuleEntitlementRequiredError) {
      if (error.moduleKey === "module.messaging.basic" || error.moduleKey === "module.crm_lite") {
        throw new ConversationModuleEntitlementRequiredError(error.moduleKey);
      }
    }
    throw error;
  }
}

async function appendCreatedMutation(
  context: TenantContext,
  transaction: Prisma.TransactionClient,
  conversation: ConversationItem,
): Promise<void> {
  const access = createTenantDataAccess(context, transaction);
  await access.audit.append({
    action: "conversation.created",
    actorId: null,
    actorType: "system",
    afterSummary: summary(conversation),
    entityId: conversation.id,
    entityType: "Conversation",
    requestId: "conversation-resolver",
  });
  await access.outbox.append({
    aggregateId: conversation.id,
    aggregateType: "Conversation",
    eventType: "conversation.created",
    payload: {
      channelAccountId: conversation.channelAccountId,
      contactId: conversation.contactId,
      conversationId: conversation.id,
      status: conversation.status,
    },
  });
}

async function appendStateChange(
  context: TenantContext,
  transaction: Prisma.TransactionClient,
  before: ConversationItem,
  after: ConversationItem,
): Promise<void> {
  const access = createTenantDataAccess(context, transaction);
  await access.audit.append({
    action: "conversation.state_changed",
    actorId: null,
    actorType: "system",
    afterSummary: summary(after),
    beforeSummary: summary(before),
    entityId: after.id,
    entityType: "Conversation",
    requestId: "conversation-resolver",
  });
  await access.outbox.append({
    aggregateId: after.id,
    aggregateType: "Conversation",
    eventType: "conversation.state_changed",
    payload: {
      conversationId: after.id,
      fromStatus: before.status,
      toStatus: after.status,
    },
  });
}

type ConversationChannel = Readonly<{
  active: boolean;
  automationDefaultMode: string | null;
  id: string;
  status: string;
}>;

async function resolveConversationForContactInTransaction(
  context: TenantContext,
  channel: ConversationChannel,
  contactId: string,
  providerThreadId: string | null | undefined,
  transaction: Prisma.TransactionClient,
): Promise<ConversationItem> {
  const tenant = createTenantContext(context.tenantId);
  await lockConversationInTransaction(transaction, tenant.tenantId, channel.id, contactId);

  const current = await transaction.conversation.findFirst({
    orderBy: [{ lastMessageAt: "desc" }, { id: "asc" }],
    where: {
      channelAccountId: channel.id,
      contactId,
      status: { in: [...ACTIVE_CONVERSATION_STATUSES] },
      tenantId: tenant.tenantId,
    },
  });
  if (current !== null) {
    const currentItem = conversationItem(current);
    if (currentItem.status === "open") return { ...currentItem, isNew: false };
    const reopened = await transaction.conversation.update({
      data: { closedAt: null, status: "open" },
      where: { tenantId_id: { id: current.id, tenantId: tenant.tenantId } },
    });
    const reopenedItem = conversationItem(reopened);
    await appendStateChange(tenant, transaction, currentItem, reopenedItem);
    return { ...reopenedItem, isNew: false };
  }

  const created = await transaction.conversation.create({
    data: {
      automationMode: defaultAutomationMode(channel.automationDefaultMode),
      channelAccountId: channel.id,
      contactId,
      ...(providerThreadId === undefined ? {} : { providerThreadId }),
      status: "open",
      tenantId: tenant.tenantId,
    },
  });
  const item = conversationItem(created);
  await appendCreatedMutation(tenant, transaction, item);
  return { ...item, isNew: true };
}

export async function routeInboundEventToConversationInTransaction(
  context: TenantContext,
  input: ConversationRouteInput,
  transaction: Prisma.TransactionClient,
  database: ConversationManagerDatabase,
): Promise<ConversationItem> {
  const tenant = createTenantContext(context.tenantId);
  try {
    await assertTenantOperational(tenant, transaction);
  } catch (error) {
    if (error instanceof TenantNotOperationalError) {
      throw new ConversationTenantNotOperationalError();
    }
    throw error;
  }
  await assertConversationEntitlements(tenant, transaction);

  const inboundEvent = await transaction.inboundMessageEvent.findFirst({
    select: { channelAccountId: true, id: true, senderPhone: true, tenantId: true },
    where: { id: input.inboundEventId, tenantId: tenant.tenantId },
  });
  if (inboundEvent === null) {
    throw new ConversationInboundEventNotFoundError();
  }
  const channel = await transaction.channelAccount.findFirst({
    select: { active: true, automationDefaultMode: true, id: true, status: true },
    where: { id: inboundEvent.channelAccountId, tenantId: tenant.tenantId },
  });
  if (channel === null) throw new ConversationChannelNotFoundError();
  if (!channel.active || !activeChannelStatus(channel.status)) {
    throw new ConversationChannelInactiveError();
  }

  const senderPhone = inboundEvent.senderPhone ?? input.senderPhone ?? null;
  if (senderPhone === null) throw new ConversationSenderPhoneRequiredError();
  const contact = await createContactManager(database).findOrCreateContactByPhone(
    tenant,
    senderPhone,
    input.senderName ?? "Sin Nombre",
    transaction,
  );
  return resolveConversationForContactInTransaction(
    tenant,
    channel,
    contact.id,
    input.providerThreadId,
    transaction,
  );
}

export async function routeExternalHumanEventToConversationInTransaction(
  context: TenantContext,
  input: ExternalHumanConversationRouteInput,
  transaction: Prisma.TransactionClient,
  database: ConversationManagerDatabase,
): Promise<ConversationItem> {
  const tenant = createTenantContext(context.tenantId);
  try {
    await assertTenantOperational(tenant, transaction);
  } catch (error) {
    if (error instanceof TenantNotOperationalError) {
      throw new ConversationTenantNotOperationalError();
    }
    throw error;
  }
  await assertConversationEntitlements(tenant, transaction);

  const inboundEvent = await transaction.inboundMessageEvent.findFirst({
    select: { channelAccountId: true, id: true },
    where: { id: input.inboundEventId, tenantId: tenant.tenantId },
  });
  if (inboundEvent === null) {
    throw new ConversationInboundEventNotFoundError();
  }
  const channel = await transaction.channelAccount.findFirst({
    select: { active: true, automationDefaultMode: true, id: true, status: true },
    where: { id: inboundEvent.channelAccountId, tenantId: tenant.tenantId },
  });
  if (channel === null) throw new ConversationChannelNotFoundError();
  if (!channel.active || !activeChannelStatus(channel.status)) {
    throw new ConversationChannelInactiveError();
  }

  const contact = await createContactManager(database).findOrCreateContactByPhone(
    tenant,
    input.recipientPhone,
    "Sin Nombre",
    transaction,
  );
  return resolveConversationForContactInTransaction(
    tenant,
    channel,
    contact.id,
    input.providerThreadId,
    transaction,
  );
}

export function createConversationManager(
  database: ConversationManagerDatabase,
): ConversationManager {
  const routeInboundEventToConversation = (
    context: TenantContext,
    input: ConversationRouteInput,
  ): Promise<ConversationItem> => {
    const tenant = createTenantContext(context.tenantId);
    return database.$transaction((transaction) =>
      routeInboundEventToConversationInTransaction(tenant, input, transaction, database),
    );
  };

  return Object.freeze({ routeInboundEventToConversation });
}
