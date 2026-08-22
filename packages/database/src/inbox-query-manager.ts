import { CONVERSATION_STATUSES, type ConversationStatus } from "./conversation-manager";
import type { Prisma } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import type { TenantDataAccessDatabase, TenantTransactionDatabase } from "./tenant-data-access";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_STATUSES: readonly ConversationStatus[] = ["new", "open", "pending"];
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
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

export type InboxQueryResult = Readonly<{
  items: readonly InboxConversationItem[];
  nextCursor: string | null;
  totalActive: number;
}>;

export type InboxQueryManagerDatabase = TenantTransactionDatabase &
  TenantDataAccessDatabase &
  Pick<Prisma.TransactionClient, "conversation" | "tenant" | "tenantEntitlement">;

export interface InboxQueryManager {
  listInboxConversations(
    tenantContext: TenantContext,
    options?: InboxQueryOptions,
  ): Promise<InboxQueryResult>;
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

export function createInboxQueryManager(database: InboxQueryManagerDatabase): InboxQueryManager {
  const listInboxConversations = async (
    context: TenantContext,
    options: InboxQueryOptions = {},
  ): Promise<InboxQueryResult> => {
    const tenant = createTenantContext(context.tenantId);
    await assertTenantOperational(tenant, database);
    await assertTenantModuleEntitled(tenant, "module.messaging.basic", database);
    await assertTenantModuleEntitled(tenant, "module.crm_lite", database);

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

  return Object.freeze({ listInboxConversations });
}
