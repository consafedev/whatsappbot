import { CONVERSATION_STATUSES, type ConversationStatus } from "./conversation-manager";
import type { Prisma } from "./generated/prisma/client";
import { ConversationNotFoundError } from "./outbound-conversation-message-manager";
import { createTenantContext, type TenantContext } from "./tenant-context";
import type { TenantDataAccessDatabase, TenantTransactionDatabase } from "./tenant-data-access";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_STATUSES: readonly ConversationStatus[] = ["new", "open", "pending"];
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DEFAULT_MESSAGE_LIMIT = 30;
const MAX_MESSAGE_LIMIT = 100;
const MAX_SEARCH_LENGTH = 100;

const INBOX_CONVERSATION_SELECT = {
  assignedUnit: {
    select: { active: true, id: true, name: true, type: true },
  },
  assignedUnitId: true,
  assignedUser: {
    select: { displayName: true, id: true, status: true },
  },
  assignedUserId: true,
  automationMode: true,
  channelAccount: {
    select: {
      channelType: true,
      displayName: true,
      id: true,
      providerType: true,
      status: true,
    },
  },
  channelAccountId: true,
  closedAt: true,
  contact: {
    select: { avatarUrl: true, id: true, name: true, phoneNumber: true, status: true },
  },
  contactId: true,
  createdAt: true,
  humanTakeoverUntil: true,
  id: true,
  lastHumanMessageAt: true,
  lastInboundAt: true,
  lastMessageAt: true,
  lastOutboundAt: true,
  priority: true,
  status: true,
  subject: true,
  updatedAt: true,
} satisfies Prisma.ConversationSelect;

type InboxConversationRow = Prisma.ConversationGetPayload<{
  select: typeof INBOX_CONVERSATION_SELECT;
}>;

const INBOX_CONVERSATION_DETAIL_SELECT = {
  assignedUnit: {
    select: { id: true, name: true },
  },
  assignedUnitId: true,
  assignedUser: {
    select: { displayName: true, email: true, id: true },
  },
  assignedUserId: true,
  automationMode: true,
  channelAccount: {
    select: {
      displayName: true,
      id: true,
      phoneNumber: true,
      providerType: true,
      status: true,
    },
  },
  channelAccountId: true,
  closedAt: true,
  contact: {
    select: {
      avatarUrl: true,
      customAttributes: true,
      email: true,
      id: true,
      name: true,
      phoneNumber: true,
      status: true,
      tags: true,
    },
  },
  contactId: true,
  createdAt: true,
  humanTakeoverUntil: true,
  id: true,
  lastHumanMessageAt: true,
  lastInboundAt: true,
  lastMessageAt: true,
  lastOutboundAt: true,
  priority: true,
  status: true,
  subject: true,
  updatedAt: true,
} satisfies Prisma.ConversationSelect;

type InboxConversationDetailRow = Prisma.ConversationGetPayload<{
  select: typeof INBOX_CONVERSATION_DETAIL_SELECT;
}>;

const INBOX_MESSAGE_SELECT = {
  actorId: true,
  actorType: true,
  conversationId: true,
  createdAt: true,
  deliveryStatus: true,
  direction: true,
  id: true,
  origin: true,
  providerTimestamp: true,
  structuredPayload: true,
  textBody: true,
} satisfies Prisma.MessageSelect;

type InboxMessageRow = Prisma.MessageGetPayload<{
  select: typeof INBOX_MESSAGE_SELECT;
}>;

export type InboxQueryOptions = Readonly<{
  status?: string | readonly string[];
  assignedUserId?: string;
  assignedUnitId?: string;
  channelAccountId?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}>;

export type InboxConversationItem = Readonly<{
  id: string;
  channelAccountId: string;
  contactId: string;
  status: ConversationStatus;
  automationMode: string;
  assignedUserId: string | null;
  assignedUnitId: string | null;
  priority: number;
  subject: string | null;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  lastHumanMessageAt: Date | null;
  humanTakeoverUntil: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  unread: boolean;
  contact: Readonly<{
    id: string;
    name: string;
    phoneNumber: string;
    avatarUrl: string | null;
    status: string;
  }>;
  channelAccount: Readonly<{
    id: string;
    displayName: string;
    channelType: string;
    providerType: string;
    status: string;
  }>;
  assignedUser: Readonly<{ id: string; displayName: string; status: string }> | null;
  assignedUnit: Readonly<{ id: string; name: string; type: string; active: boolean }> | null;
}>;

export type InboxConversationDetail = Readonly<{
  id: string;
  channelAccountId: string;
  contactId: string;
  status: ConversationStatus;
  automationMode: string;
  assignedUserId: string | null;
  assignedUnitId: string | null;
  priority: number;
  subject: string | null;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  lastHumanMessageAt: Date | null;
  humanTakeoverUntil: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  unread: boolean;
  contact: Readonly<{
    id: string;
    name: string;
    phoneNumber: string;
    email: string | null;
    avatarUrl: string | null;
    status: string;
    tags: readonly string[];
    customAttributes: Prisma.JsonValue | null;
  }>;
  channelAccount: Readonly<{
    id: string;
    name: string;
    phoneNumber: string | null;
    providerType: string;
    status: string;
  }>;
  assignedUser: Readonly<{ id: string; name: string; email: string }> | null;
  assignedUnit: Readonly<{ id: string; name: string }> | null;
}>;

export type InboxMessageItem = Readonly<{
  id: string;
  conversationId: string;
  direction: string;
  origin: string;
  actorType: string;
  actorId: string | null;
  deliveryStatus: string;
  providerTimestamp: Date | null;
  textBody: string | null;
  structuredPayload: Prisma.JsonValue | null;
  createdAt: Date;
}>;

export type InboxQueryResult = Readonly<{
  items: readonly InboxConversationItem[];
  nextCursor: string | null;
  totalActive: number;
}>;

export type InboxMessageQueryOptions = Readonly<{
  cursor?: string;
  limit?: number;
  direction?: "before" | "after";
}>;

export type InboxMessageQueryResult = Readonly<{
  items: readonly InboxMessageItem[];
  nextCursor: string | null;
  prevCursor: string | null;
}>;

export type InboxQueryManagerDatabase = TenantTransactionDatabase &
  TenantDataAccessDatabase &
  Pick<Prisma.TransactionClient, "conversation" | "message" | "tenant" | "tenantEntitlement">;

export interface InboxQueryManager {
  listInboxConversations(
    tenantContext: TenantContext,
    options?: InboxQueryOptions,
  ): Promise<InboxQueryResult>;
  getInboxConversationDetail(
    tenantContext: TenantContext,
    conversationId: string,
  ): Promise<InboxConversationDetail>;
  listInboxConversationMessages(
    tenantContext: TenantContext,
    conversationId: string,
    options?: InboxMessageQueryOptions,
  ): Promise<InboxMessageQueryResult>;
}

export class InboxQueryValidationError extends Error {
  override readonly name = "InboxQueryValidationError";
}

function validUuidV7(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_V7_PATTERN.test(normalized)) {
    throw new InboxQueryValidationError(`Invalid ${field}`);
  }
  return normalized;
}

function statusFilter(value: InboxQueryOptions["status"]): ConversationStatus[] | undefined {
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? [...value] : [value];
  if (values.length === 0 || values.some((item) => typeof item !== "string")) {
    throw new InboxQueryValidationError("Invalid conversation status");
  }
  const normalized = values.map((item) => item.trim().toLowerCase());
  if (normalized.length === 1 && normalized[0] === "active") return [...ACTIVE_STATUSES];
  if (normalized.some((item) => !CONVERSATION_STATUSES.includes(item as ConversationStatus))) {
    throw new InboxQueryValidationError("Invalid conversation status");
  }
  return [...new Set(normalized as ConversationStatus[])];
}

function searchFilter(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  if (normalized.length > MAX_SEARCH_LENGTH) {
    throw new InboxQueryValidationError("Invalid conversation search");
  }
  return normalized;
}

function limitValue(value: number | undefined): number {
  const limit = value ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new InboxQueryValidationError("Invalid conversation limit");
  }
  return limit;
}

function messageLimitValue(value: number | undefined): number {
  const limit = value ?? DEFAULT_MESSAGE_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MESSAGE_LIMIT) {
    throw new InboxQueryValidationError("Invalid message limit");
  }
  return limit;
}

type Cursor = Readonly<{ id: string; lastMessageAt: Date | null }>;

function encodeCursor(row: Pick<InboxConversationRow, "id" | "lastMessageAt">): string {
  return Buffer.from(
    JSON.stringify({
      id: row.id,
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(value: string | undefined): Cursor | undefined {
  if (value === undefined) return undefined;
  const encoded = value.trim();
  if (encoded.length === 0 || encoded.length > 512) {
    throw new InboxQueryValidationError("Invalid conversation cursor");
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid cursor object");
    }
    const record = parsed as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2 ||
      typeof record.id !== "string" ||
      !(record.lastMessageAt === null || typeof record.lastMessageAt === "string")
    ) {
      throw new Error("invalid cursor fields");
    }
    const id = validUuidV7(record.id, "conversation cursor");
    if (record.lastMessageAt === null) return { id, lastMessageAt: null };
    const lastMessageAt = new Date(record.lastMessageAt);
    if (Number.isNaN(lastMessageAt.getTime())) throw new Error("invalid cursor timestamp");
    return { id, lastMessageAt };
  } catch {
    throw new InboxQueryValidationError("Invalid conversation cursor");
  }
}

function cursorWhere(cursor: Cursor | undefined): Prisma.ConversationWhereInput | undefined {
  if (cursor === undefined) return undefined;
  if (cursor.lastMessageAt === null) {
    return { lastMessageAt: null, id: { lt: cursor.id } };
  }
  return {
    OR: [
      { lastMessageAt: { lt: cursor.lastMessageAt } },
      { lastMessageAt: cursor.lastMessageAt, id: { lt: cursor.id } },
      { lastMessageAt: null },
    ],
  };
}

function inboxWhere(
  tenantId: string,
  options: InboxQueryOptions,
  statuses: ConversationStatus[] | undefined,
): Prisma.ConversationWhereInput {
  const search = searchFilter(options.search);
  return {
    ...(statuses === undefined ? {} : { status: { in: statuses } }),
    ...(options.assignedUserId === undefined
      ? {}
      : options.assignedUserId === "unassigned"
        ? { assignedUserId: null }
        : { assignedUserId: validUuidV7(options.assignedUserId, "assigned user") }),
    ...(options.assignedUnitId === undefined
      ? {}
      : { assignedUnitId: validUuidV7(options.assignedUnitId, "assigned unit") }),
    ...(options.channelAccountId === undefined
      ? {}
      : { channelAccountId: validUuidV7(options.channelAccountId, "channel account") }),
    ...(search === undefined
      ? {}
      : {
          contact: {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { phoneNumber: { contains: search, mode: "insensitive" } },
            ],
          },
        }),
    tenantId,
  };
}

function unread(row: Pick<InboxConversationRow, "lastInboundAt" | "lastHumanMessageAt">): boolean {
  return (
    row.lastInboundAt !== null &&
    (row.lastHumanMessageAt === null ||
      row.lastInboundAt.getTime() > row.lastHumanMessageAt.getTime())
  );
}

function detailUnread(
  row: Pick<InboxConversationDetailRow, "lastInboundAt" | "lastHumanMessageAt">,
): boolean {
  return unread(row);
}

function inboxItem(row: InboxConversationRow): InboxConversationItem {
  if (!CONVERSATION_STATUSES.includes(row.status as ConversationStatus)) {
    throw new InboxQueryValidationError(`Unsupported conversation status: ${row.status}`);
  }
  return {
    assignedUnit: row.assignedUnit,
    assignedUnitId: row.assignedUnitId,
    assignedUser: row.assignedUser,
    assignedUserId: row.assignedUserId,
    automationMode: row.automationMode,
    channelAccount: row.channelAccount,
    channelAccountId: row.channelAccountId,
    closedAt: row.closedAt,
    contact: row.contact,
    contactId: row.contactId,
    createdAt: row.createdAt,
    humanTakeoverUntil: row.humanTakeoverUntil,
    id: row.id,
    lastHumanMessageAt: row.lastHumanMessageAt,
    lastInboundAt: row.lastInboundAt,
    lastMessageAt: row.lastMessageAt,
    lastOutboundAt: row.lastOutboundAt,
    priority: row.priority,
    status: row.status as ConversationStatus,
    subject: row.subject,
    unread: unread(row),
    updatedAt: row.updatedAt,
  };
}

function inboxDetail(row: InboxConversationDetailRow): InboxConversationDetail {
  if (!CONVERSATION_STATUSES.includes(row.status as ConversationStatus)) {
    throw new InboxQueryValidationError(`Unsupported conversation status: ${row.status}`);
  }
  return {
    assignedUnit: row.assignedUnit,
    assignedUnitId: row.assignedUnitId,
    assignedUser:
      row.assignedUser === null
        ? null
        : {
            email: row.assignedUser.email,
            id: row.assignedUser.id,
            name: row.assignedUser.displayName,
          },
    assignedUserId: row.assignedUserId,
    automationMode: row.automationMode,
    channelAccount: {
      id: row.channelAccount.id,
      name: row.channelAccount.displayName,
      phoneNumber: row.channelAccount.phoneNumber,
      providerType: row.channelAccount.providerType,
      status: row.channelAccount.status,
    },
    channelAccountId: row.channelAccountId,
    closedAt: row.closedAt,
    contact: row.contact,
    contactId: row.contactId,
    createdAt: row.createdAt,
    humanTakeoverUntil: row.humanTakeoverUntil,
    id: row.id,
    lastHumanMessageAt: row.lastHumanMessageAt,
    lastInboundAt: row.lastInboundAt,
    lastMessageAt: row.lastMessageAt,
    lastOutboundAt: row.lastOutboundAt,
    priority: row.priority,
    status: row.status as ConversationStatus,
    subject: row.subject,
    unread: detailUnread(row),
    updatedAt: row.updatedAt,
  };
}

function inboxMessage(row: InboxMessageRow): InboxMessageItem {
  return {
    actorId: row.actorId,
    actorType: row.actorType,
    conversationId: row.conversationId,
    createdAt: row.createdAt,
    deliveryStatus: row.deliveryStatus,
    direction: row.direction,
    id: row.id,
    origin: row.origin,
    providerTimestamp: row.providerTimestamp,
    structuredPayload: row.structuredPayload,
    textBody: row.textBody,
  };
}

type MessageCursor = Readonly<{ id: string; createdAt: Date }>;

function encodeMessageCursor(row: Pick<InboxMessageRow, "id" | "createdAt">): string {
  return Buffer.from(
    JSON.stringify({ id: row.id, createdAt: row.createdAt.toISOString() }),
    "utf8",
  ).toString("base64url");
}

function decodeMessageCursor(value: string | undefined): MessageCursor | undefined {
  if (value === undefined) return undefined;
  const encoded = value.trim();
  if (encoded.length === 0 || encoded.length > 512) {
    throw new InboxQueryValidationError("Invalid message cursor");
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid cursor object");
    }
    const record = parsed as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2 ||
      typeof record.id !== "string" ||
      typeof record.createdAt !== "string"
    ) {
      throw new Error("invalid cursor fields");
    }
    const id = validUuidV7(record.id, "message cursor");
    const createdAt = new Date(record.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error("invalid cursor timestamp");
    return { createdAt, id };
  } catch {
    throw new InboxQueryValidationError("Invalid message cursor");
  }
}

function messageDirection(value: InboxMessageQueryOptions["direction"]): "before" | "after" {
  if (value === undefined) return "before";
  if (value !== "before" && value !== "after") {
    throw new InboxQueryValidationError("Invalid message direction");
  }
  return value;
}

function messageCursorWhere(
  cursor: MessageCursor | undefined,
  direction: "before" | "after",
): Prisma.MessageWhereInput | undefined {
  if (cursor === undefined) return undefined;
  const after = direction === "after";
  return {
    OR: [
      { createdAt: after ? { gt: cursor.createdAt } : { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: after ? { gt: cursor.id } : { lt: cursor.id } },
    ],
  };
}

function messageOrder(direction: "before" | "after"): Prisma.MessageOrderByWithRelationInput[] {
  return direction === "before"
    ? [{ createdAt: "desc" }, { id: "desc" }]
    : [{ createdAt: "asc" }, { id: "asc" }];
}

function messageBaseWhere(
  tenantId: string,
  conversationId: string,
  cursor: MessageCursor | undefined,
  direction: "before" | "after",
): Prisma.MessageWhereInput {
  const cursorWhere = messageCursorWhere(cursor, direction);
  return cursorWhere === undefined
    ? { conversationId, tenantId }
    : { AND: [{ conversationId, tenantId }, cursorWhere] };
}

export function createInboxQueryManager(database: InboxQueryManagerDatabase): InboxQueryManager {
  const authorizeInboxRead = async (context: TenantContext): Promise<TenantContext> => {
    const tenant = createTenantContext(context.tenantId);
    await assertTenantOperational(tenant, database);
    await assertTenantModuleEntitled(tenant, "module.messaging.basic", database);
    await assertTenantModuleEntitled(tenant, "module.crm_lite", database);
    return tenant;
  };

  const listInboxConversations = async (
    context: TenantContext,
    options: InboxQueryOptions = {},
  ): Promise<InboxQueryResult> => {
    const tenant = await authorizeInboxRead(context);

    const statuses = statusFilter(options.status);
    const limit = limitValue(options.limit);
    const cursor = decodeCursor(options.cursor);
    const baseWhere = inboxWhere(tenant.tenantId, options, statuses);
    const pageWhere = cursorWhere(cursor);
    const where = pageWhere === undefined ? baseWhere : { AND: [baseWhere, pageWhere] };
    const activeWhere = inboxWhere(tenant.tenantId, options, [...ACTIVE_STATUSES]);

    const [rows, totalActive] = await Promise.all([
      database.conversation.findMany({
        orderBy: [{ lastMessageAt: { nulls: "last", sort: "desc" } }, { id: "desc" }],
        select: INBOX_CONVERSATION_SELECT,
        take: limit + 1,
        where,
      }),
      database.conversation.count({ where: activeWhere }),
    ]);
    const hasNextPage = rows.length > limit;
    const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
    return {
      items: pageRows.map(inboxItem),
      nextCursor: hasNextPage
        ? encodeCursor(
            pageRows[pageRows.length - 1] as Pick<InboxConversationRow, "id" | "lastMessageAt">,
          )
        : null,
      totalActive,
    };
  };

  const getInboxConversationDetail = async (
    context: TenantContext,
    conversationId: string,
  ): Promise<InboxConversationDetail> => {
    const tenant = await authorizeInboxRead(context);
    const id = validUuidV7(conversationId, "conversation id");
    const row = await database.conversation.findFirst({
      select: INBOX_CONVERSATION_DETAIL_SELECT,
      where: { id, tenantId: tenant.tenantId },
    });
    if (row === null) throw new ConversationNotFoundError();
    return inboxDetail(row);
  };

  const listInboxConversationMessages = async (
    context: TenantContext,
    conversationId: string,
    options: InboxMessageQueryOptions = {},
  ): Promise<InboxMessageQueryResult> => {
    const tenant = await authorizeInboxRead(context);
    const id = validUuidV7(conversationId, "conversation id");
    const conversation = await database.conversation.findFirst({
      select: { id: true },
      where: { id, tenantId: tenant.tenantId },
    });
    if (conversation === null) throw new ConversationNotFoundError();

    const direction = messageDirection(options.direction);
    const cursor = decodeMessageCursor(options.cursor);
    const limit = messageLimitValue(options.limit);
    const rows = await database.message.findMany({
      orderBy: messageOrder(direction),
      select: INBOX_MESSAGE_SELECT,
      take: limit + 1,
      where: messageBaseWhere(tenant.tenantId, id, cursor, direction),
    });
    const hasNextPage = rows.length > limit;
    const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
    if (pageRows.length === 0) {
      return { items: [], nextCursor: null, prevCursor: null };
    }

    const first = pageRows[0];
    const last = pageRows[pageRows.length - 1];
    if (first === undefined || last === undefined) {
      throw new InboxQueryValidationError("Inbox message page unexpectedly empty");
    }
    const previousDirection = direction === "before" ? "after" : "before";
    const previous = await database.message.findFirst({
      orderBy: messageOrder(previousDirection),
      select: { id: true },
      where: messageBaseWhere(
        tenant.tenantId,
        id,
        { createdAt: first.createdAt, id: first.id },
        previousDirection,
      ),
    });
    return {
      items: pageRows.map(inboxMessage),
      nextCursor: hasNextPage ? encodeMessageCursor(last) : null,
      prevCursor: previous === null ? null : encodeMessageCursor(first),
    };
  };

  return Object.freeze({
    getInboxConversationDetail,
    listInboxConversationMessages,
    listInboxConversations,
  });
}
