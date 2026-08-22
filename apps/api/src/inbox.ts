import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Query,
  UseGuards,
} from "@nestjs/common";
import type {
  InboxConversationItem,
  InboxQueryManager,
  InboxQueryOptions,
  InboxQueryResult,
  TenantContext,
} from "@whatsapp-platform/database";
import {
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

function mapError(error: unknown): never {
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
}

@Controller("api/v1/inbox")
@RequireEntitlements("module.messaging.basic", "module.crm_lite")
export class InboxController {
  constructor(private readonly service: InboxService) {}

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
