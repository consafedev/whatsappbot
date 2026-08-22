import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import type {
  InboxConversationDetail,
  InboxConversationItem,
  InboxMessageItem,
  InboxMessageQueryOptions,
  InboxMessageQueryResult,
  InboxQueryManager,
  InboxQueryOptions,
  InboxQueryResult,
  TenantContext,
} from "@whatsapp-platform/database";
import {
  ConversationNotFoundError,
  InboxQueryValidationError,
  TenantModuleEntitlementRequiredError,
  TenantNotOperationalError,
} from "@whatsapp-platform/database";
import { TenantUserSessionGuard } from "./tenant-auth";
import { CurrentTenantContext, TenantContextGuard } from "./tenant-context";
import { RequireEntitlements, TenantEntitlementGuard } from "./tenant-entitlements";
import { RequirePermissions, TenantPermissionGuard } from "./tenant-rbac";

export const INBOX_QUERY_MANAGER = Symbol("INBOX_QUERY_MANAGER");

type QueryValue = string | readonly string[] | undefined;

const QUERY_KEYS = new Set([
  "assignedUnitId",
  "assignedUserId",
  "channelAccountId",
  "cursor",
  "limit",
  "search",
  "status",
]);
const MESSAGE_QUERY_KEYS = new Set(["cursor", "direction", "limit"]);

type InboxConversationResponse = Readonly<{
  id: string;
  channelAccountId: string;
  contactId: string;
  status: string;
  automationMode: string;
  assignedUserId: string | null;
  assignedUnitId: string | null;
  priority: number;
  subject: string | null;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastHumanMessageAt: string | null;
  humanTakeoverUntil: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  unread: boolean;
  contact: InboxConversationItem["contact"];
  channelAccount: InboxConversationItem["channelAccount"];
  assignedUser: InboxConversationItem["assignedUser"];
  assignedUnit: InboxConversationItem["assignedUnit"];
}>;

type InboxListResponse = Readonly<{
  items: readonly InboxConversationResponse[];
  nextCursor: string | null;
  totalActive: number;
}>;

type InboxConversationDetailResponse = Readonly<{
  id: string;
  channelAccountId: string;
  contactId: string;
  status: string;
  automationMode: string;
  assignedUserId: string | null;
  assignedUnitId: string | null;
  priority: number;
  subject: string | null;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastHumanMessageAt: string | null;
  humanTakeoverUntil: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  unread: boolean;
  contact: InboxConversationDetail["contact"];
  channelAccount: InboxConversationDetail["channelAccount"];
  assignedUser: InboxConversationDetail["assignedUser"];
  assignedUnit: InboxConversationDetail["assignedUnit"];
}>;

type InboxMessageResponse = Readonly<
  Omit<InboxMessageItem, "createdAt" | "providerTimestamp"> & {
    createdAt: string;
    providerTimestamp: string | null;
  }
>;

type InboxMessagesResponse = Readonly<{
  items: readonly InboxMessageResponse[];
  nextCursor: string | null;
  prevCursor: string | null;
}>;

function queryValue(query: Record<string, unknown>, key: string): QueryValue {
  const value = query[key];
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value as readonly string[];
  }
  throw new BadRequestException(`Invalid inbox query parameter: ${key}`);
}

function optionalQueryString(
  value: QueryValue,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return value.trim();
}

function parseStatus(value: QueryValue): string | readonly string[] | undefined {
  if (value === undefined) return undefined;
  const values = typeof value === "string" ? value.split(",") : [...value];
  if (values.length === 0 || values.some((entry) => entry.trim().length === 0)) {
    throw new BadRequestException("Invalid conversation status");
  }
  const normalized = values.map((entry) => entry.trim().toLowerCase());
  return normalized.length === 1 ? normalized[0] : normalized;
}

function parseLimit(value: QueryValue): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new BadRequestException("Invalid conversation limit");
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new BadRequestException("Invalid conversation limit");
  }
  return limit;
}

function parseMessageLimit(value: QueryValue): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new BadRequestException("Invalid message limit");
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new BadRequestException("Invalid message limit");
  }
  return limit;
}

function parseMessageDirection(value: QueryValue): "before" | "after" | undefined {
  const direction = optionalQueryString(value, "message direction", 10);
  if (direction === undefined) return undefined;
  if (direction !== "before" && direction !== "after") {
    throw new BadRequestException("Invalid message direction");
  }
  return direction;
}

function parseOptions(query: Record<string, unknown>): InboxQueryOptions {
  if (Object.keys(query).some((key) => !QUERY_KEYS.has(key))) {
    throw new BadRequestException("Invalid inbox query parameter");
  }
  const assignedUserId = optionalQueryString(
    queryValue(query, "assignedUserId"),
    "assigned user",
    80,
  );
  const assignedUnitId = optionalQueryString(
    queryValue(query, "assignedUnitId"),
    "assigned unit",
    80,
  );
  const channelAccountId = optionalQueryString(
    queryValue(query, "channelAccountId"),
    "channel account",
    80,
  );
  const cursor = optionalQueryString(queryValue(query, "cursor"), "conversation cursor", 512);
  const search = optionalQueryString(queryValue(query, "search"), "conversation search", 100);
  const limit = parseLimit(queryValue(query, "limit"));
  const status = parseStatus(queryValue(query, "status"));
  return {
    ...(assignedUnitId === undefined ? {} : { assignedUnitId }),
    ...(assignedUserId === undefined ? {} : { assignedUserId }),
    ...(channelAccountId === undefined ? {} : { channelAccountId }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit }),
    ...(search === undefined ? {} : { search }),
    ...(status === undefined ? {} : { status }),
  };
}

function parseMessageOptions(query: Record<string, unknown>): InboxMessageQueryOptions {
  if (Object.keys(query).some((key) => !MESSAGE_QUERY_KEYS.has(key))) {
    throw new BadRequestException("Invalid message query parameter");
  }
  const cursor = optionalQueryString(queryValue(query, "cursor"), "message cursor", 512);
  const limit = parseMessageLimit(queryValue(query, "limit"));
  const direction = parseMessageDirection(queryValue(query, "direction"));
  return {
    ...(cursor === undefined ? {} : { cursor }),
    ...(direction === undefined ? {} : { direction }),
    ...(limit === undefined ? {} : { limit }),
  };
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function publicItem(item: InboxConversationItem): InboxConversationResponse {
  return {
    assignedUnit: item.assignedUnit,
    assignedUnitId: item.assignedUnitId,
    assignedUser: item.assignedUser,
    assignedUserId: item.assignedUserId,
    automationMode: item.automationMode,
    channelAccount: item.channelAccount,
    channelAccountId: item.channelAccountId,
    closedAt: iso(item.closedAt),
    contact: item.contact,
    contactId: item.contactId,
    createdAt: item.createdAt.toISOString(),
    humanTakeoverUntil: iso(item.humanTakeoverUntil),
    id: item.id,
    lastHumanMessageAt: iso(item.lastHumanMessageAt),
    lastInboundAt: iso(item.lastInboundAt),
    lastMessageAt: iso(item.lastMessageAt),
    lastOutboundAt: iso(item.lastOutboundAt),
    priority: item.priority,
    status: item.status,
    subject: item.subject,
    unread: item.unread,
    updatedAt: item.updatedAt.toISOString(),
  };
}

function publicResult(result: InboxQueryResult): InboxListResponse {
  return {
    items: result.items.map(publicItem),
    nextCursor: result.nextCursor,
    totalActive: result.totalActive,
  };
}

function publicDetail(detail: InboxConversationDetail): InboxConversationDetailResponse {
  return {
    assignedUnit: detail.assignedUnit,
    assignedUnitId: detail.assignedUnitId,
    assignedUser: detail.assignedUser,
    assignedUserId: detail.assignedUserId,
    automationMode: detail.automationMode,
    channelAccount: detail.channelAccount,
    channelAccountId: detail.channelAccountId,
    closedAt: iso(detail.closedAt),
    contact: detail.contact,
    contactId: detail.contactId,
    createdAt: detail.createdAt.toISOString(),
    humanTakeoverUntil: iso(detail.humanTakeoverUntil),
    id: detail.id,
    lastHumanMessageAt: iso(detail.lastHumanMessageAt),
    lastInboundAt: iso(detail.lastInboundAt),
    lastMessageAt: iso(detail.lastMessageAt),
    lastOutboundAt: iso(detail.lastOutboundAt),
    priority: detail.priority,
    status: detail.status,
    subject: detail.subject,
    unread: detail.unread,
    updatedAt: detail.updatedAt.toISOString(),
  };
}

function publicMessages(result: InboxMessageQueryResult): InboxMessagesResponse {
  return {
    items: result.items.map((item) => ({
      actorId: item.actorId,
      actorType: item.actorType,
      conversationId: item.conversationId,
      createdAt: item.createdAt.toISOString(),
      deliveryStatus: item.deliveryStatus,
      direction: item.direction,
      id: item.id,
      origin: item.origin,
      providerTimestamp: iso(item.providerTimestamp),
      structuredPayload: item.structuredPayload,
      textBody: item.textBody,
    })),
    nextCursor: result.nextCursor,
    prevCursor: result.prevCursor,
  };
}

function mapError(error: unknown): never {
  if (error instanceof ConversationNotFoundError) {
    throw new NotFoundException("Conversation not found");
  }
  if (error instanceof InboxQueryValidationError) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof TenantNotOperationalError) {
    throw new ForbiddenException({
      code: "TENANT_NOT_OPERATIONAL",
      error: "Forbidden",
      message: "Tenant is not operational",
      statusCode: 403,
    });
  }
  if (error instanceof TenantModuleEntitlementRequiredError) {
    throw new ForbiddenException({
      code: "ENTITLEMENT_REQUIRED",
      error: "Forbidden",
      message: "Module entitlement required",
      moduleKey: error.moduleKey,
      statusCode: 403,
    });
  }
  throw error;
}

@Injectable()
export class InboxService {
  constructor(@Inject(INBOX_QUERY_MANAGER) private readonly manager: InboxQueryManager) {}

  async list(context: TenantContext, query: Record<string, unknown>): Promise<InboxListResponse> {
    try {
      return publicResult(await this.manager.listInboxConversations(context, parseOptions(query)));
    } catch (error) {
      return mapError(error);
    }
  }

  async detail(
    context: TenantContext,
    conversationId: string,
  ): Promise<InboxConversationDetailResponse> {
    try {
      return publicDetail(await this.manager.getInboxConversationDetail(context, conversationId));
    } catch (error) {
      return mapError(error);
    }
  }

  async messages(
    context: TenantContext,
    conversationId: string,
    query: Record<string, unknown>,
  ): Promise<InboxMessagesResponse> {
    try {
      return publicMessages(
        await this.manager.listInboxConversationMessages(
          context,
          conversationId,
          parseMessageOptions(query),
        ),
      );
    } catch (error) {
      return mapError(error);
    }
  }
}

@Controller("api/v1/inbox")
@RequireEntitlements("module.messaging.basic", "module.crm_lite")
export class InboxController {
  constructor(private readonly service: InboxService) {}

  @Get("conversations/:conversationId/messages")
  @RequirePermissions("conversations.read")
  @UseGuards(
    TenantUserSessionGuard,
    TenantContextGuard,
    TenantPermissionGuard,
    TenantEntitlementGuard,
  )
  messages(
    @Param("conversationId") conversationId: string,
    @CurrentTenantContext() context: TenantContext,
    @Query() query: Record<string, unknown>,
  ): Promise<InboxMessagesResponse> {
    return this.service.messages(context, conversationId, query);
  }

  @Get("conversations/:conversationId")
  @RequirePermissions("conversations.read")
  @UseGuards(
    TenantUserSessionGuard,
    TenantContextGuard,
    TenantPermissionGuard,
    TenantEntitlementGuard,
  )
  detail(
    @Param("conversationId") conversationId: string,
    @CurrentTenantContext() context: TenantContext,
  ): Promise<InboxConversationDetailResponse> {
    return this.service.detail(context, conversationId);
  }

  @Get("conversations")
  @RequirePermissions("conversations.read")
  @UseGuards(
    TenantUserSessionGuard,
    TenantContextGuard,
    TenantPermissionGuard,
    TenantEntitlementGuard,
  )
  list(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: Record<string, unknown>,
  ): Promise<InboxListResponse> {
    return this.service.list(context, query);
  }
}
