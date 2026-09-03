import { randomUUID } from "node:crypto";
import type { MessageEvent } from "@nestjs/common";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  Sse,
  UseGuards,
} from "@nestjs/common";
import type {
  AssignmentPolicy,
  AssignmentPolicyEngine,
  AssignmentPolicyResult,
  ConversationAutomationMode,
  InactivityManager,
  InactivityProcessResult,
  InboxConversationDetail,
  InboxConversationItem,
  InboxMessageItem,
  InboxMessageQueryOptions,
  InboxMessageQueryResult,
  InboxMutationManager,
  InboxQueryManager,
  InboxQueryOptions,
  InboxQueryResult,
  OutboundConversationMessageManager,
  OutboundMessageContent,
  TakeoverManager,
  TenantContext,
} from "@whatsapp-platform/database";
import {
  ActiveTenantUserNotFoundError,
  ConversationMutationActorNotFoundError,
  ConversationNotFoundError,
  ConversationNotWritableError,
  InboxQueryValidationError,
  InvalidAssignmentPolicyError,
  InvalidConversationAssignmentError,
  InvalidConversationAutomationModeError,
  InvalidConversationStateTransitionError,
  InvalidInactivityTimeoutOptionError,
  OrganizationUnitNotFoundError,
  OutboundConversationMessageActorNotFoundError,
  OutboundConversationMessageIdempotencyConflictError,
  TenantModuleEntitlementRequiredError,
  TenantNotOperationalError,
} from "@whatsapp-platform/database";
import type { Observable } from "rxjs";
import {
  INBOX_REALTIME_BROADCASTER,
  type InboxRealtimeBroadcaster,
} from "./inbox-realtime.service";
import { TenantUserSessionGuard } from "./tenant-auth";
import {
  CurrentTenantContext,
  CurrentTenantIdentity,
  type TenantAuthenticationRequest,
  TenantContextGuard,
  type TenantSessionIdentity,
} from "./tenant-context";
import { RequireEntitlements, TenantEntitlementGuard } from "./tenant-entitlements";
import { RequirePermissions, TenantPermissionGuard } from "./tenant-rbac";

export const INBOX_QUERY_MANAGER = Symbol("INBOX_QUERY_MANAGER");
export const OUTBOUND_CONVERSATION_MESSAGE_MANAGER = Symbol(
  "OUTBOUND_CONVERSATION_MESSAGE_MANAGER",
);
export const INBOX_MUTATION_MANAGER = Symbol("INBOX_MUTATION_MANAGER");
export const TAKEOVER_MANAGER = Symbol("TAKEOVER_MANAGER");
export const ASSIGNMENT_POLICY_ENGINE = Symbol("ASSIGNMENT_POLICY_ENGINE");
export const INACTIVITY_MANAGER = Symbol("INACTIVITY_MANAGER");

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TEXT_LENGTH = 4_096;
const MAX_CAPTION_LENGTH = 1_024;
const MAX_MEDIA_URL_LENGTH = 2_048;
const MAX_REASON_LENGTH = 512;

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

type InboxSendMessageResponse = Readonly<{
  message: Readonly<{
    id: string;
    conversationId: string;
    direction: string;
    origin: string;
    actorType: string;
    actorId: string | null;
    deliveryStatus: string;
    textBody: string | null;
    structuredPayload: InboxMessageItem["structuredPayload"];
    createdAt: string;
  }>;
  outboundMessageId: string;
}>;

type ParsedInboxSendMessage = Readonly<{
  content: OutboundMessageContent;
  idempotencyKey?: string;
  messageType: "text" | "media";
}>;

type ParsedConversationStatusMutation = Readonly<{
  reason?: string;
  status: "open" | "pending" | "closed";
}>;

type ParsedConversationAssignmentMutation = Readonly<{
  assignedUnitId?: string | null;
  assignedUserId?: string | null;
}>;

type ApiResponse = { setHeader(name: string, value: string): void };

function requestId(request: TenantAuthenticationRequest): string {
  const value = request.headers["x-request-id"];
  const header = Array.isArray(value) ? value[0] : value;
  return header !== undefined && /^[A-Za-z0-9._:-]{1,128}$/.test(header) ? header : randomUUID();
}

function plainObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Invalid inbox message request");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>): void {
  const allowed = new Set(["textBody", "mediaUrl", "caption", "idempotencyKey"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new BadRequestException("Invalid inbox message request");
  }
}

function hasDisallowedControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x08 ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      codePoint === 0x7f
    ) {
      return true;
    }
  }
  return false;
}

function cleanMessageString(value: unknown, maxLength: number, label: string): string {
  if (typeof value !== "string") throw new BadRequestException(`Invalid ${label}`);
  const normalized = value.normalize("NFC").trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    hasDisallowedControlCharacters(normalized)
  ) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return normalized;
}

function publicHttpsMediaUrl(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException("Invalid media URL");
  const input = value.trim();
  if (input.length === 0 || input.length > MAX_MEDIA_URL_LENGTH) {
    throw new BadRequestException("Invalid media URL");
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new BadRequestException("Invalid media URL");
  }

  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  const privateIpv4 =
    /^(0|10|127|169\.254|192\.168)(\.|$)/.test(hostname) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
  const privateIpv6 =
    hostname === "::" ||
    hostname === "::1" ||
    /^fc[0-9a-f]{2}:/i.test(hostname) ||
    /^fd[0-9a-f]{2}:/i.test(hostname) ||
    /^fe[89ab][0-9a-f]:/i.test(hostname);
  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    hostname.length === 0 ||
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    privateIpv4 ||
    privateIpv6
  ) {
    throw new BadRequestException("Invalid media URL");
  }
  return parsed.toString();
}

function idempotencyKey(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new BadRequestException("Invalid idempotency key");
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(normalized)) {
    throw new BadRequestException("Invalid idempotency key");
  }
  return normalized;
}

function parseSendMessage(body: unknown): ParsedInboxSendMessage {
  const value = plainObject(body);
  exactKeys(value);
  const textBody =
    value.textBody === undefined
      ? undefined
      : cleanMessageString(value.textBody, MAX_TEXT_LENGTH, "text body");
  const mediaUrl = value.mediaUrl === undefined ? undefined : publicHttpsMediaUrl(value.mediaUrl);
  const caption =
    value.caption === undefined
      ? undefined
      : cleanMessageString(value.caption, MAX_CAPTION_LENGTH, "caption");
  if (textBody === undefined && mediaUrl === undefined) {
    throw new BadRequestException("Text body or media URL is required");
  }
  const content: OutboundMessageContent = {
    ...(textBody === undefined ? {} : { text: textBody }),
    ...(mediaUrl === undefined ? {} : { mediaUrl }),
    ...(caption === undefined ? {} : { caption }),
  };
  const key = idempotencyKey(value.idempotencyKey);
  return {
    content,
    ...(key === undefined ? {} : { idempotencyKey: key }),
    messageType: mediaUrl === undefined ? "text" : "media",
  };
}

function mutationObject(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(message);
  }
  return value as Record<string, unknown>;
}

function parseConversationStatusMutation(body: unknown): ParsedConversationStatusMutation {
  const value = mutationObject(body, "Invalid conversation status request");
  if (Object.keys(value).some((key) => !new Set(["status", "reason"]).has(key))) {
    throw new BadRequestException("Invalid conversation status request");
  }
  if (value.status !== "open" && value.status !== "pending" && value.status !== "closed") {
    throw new BadRequestException("Invalid conversation status");
  }
  const reason =
    value.reason === undefined
      ? undefined
      : cleanMessageString(value.reason, MAX_REASON_LENGTH, "conversation status reason");
  return { status: value.status, ...(reason === undefined ? {} : { reason }) };
}

function mutationAssignmentId(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value.trim())) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return value.trim().toLowerCase();
}

function parseConversationAssignmentMutation(body: unknown): ParsedConversationAssignmentMutation {
  const value = mutationObject(body, "Invalid conversation assignment request");
  if (
    Object.keys(value).some((key) => key !== "assignedUserId" && key !== "assignedUnitId") ||
    (value.assignedUserId === undefined && value.assignedUnitId === undefined)
  ) {
    throw new BadRequestException("At least one conversation assignment field is required");
  }
  const assignedUserId =
    value.assignedUserId === undefined
      ? undefined
      : mutationAssignmentId(value.assignedUserId, "assigned user");
  const assignedUnitId =
    value.assignedUnitId === undefined
      ? undefined
      : mutationAssignmentId(value.assignedUnitId, "assigned unit");
  return {
    ...(assignedUserId === undefined ? {} : { assignedUserId }),
    ...(assignedUnitId === undefined ? {} : { assignedUnitId }),
  };
}

type ParsedAutomationModeMutation = Readonly<{
  mode: ConversationAutomationMode;
  reason?: string;
}>;

type ParsedAutoAssignMutation = Readonly<{
  policy: AssignmentPolicy;
  unitId?: string;
}>;

function parseAutomationModeMutation(body: unknown): ParsedAutomationModeMutation {
  const value = mutationObject(body, "Invalid automation mode request");
  if (Object.keys(value).some((key) => !new Set(["mode", "reason"]).has(key))) {
    throw new BadRequestException("Invalid automation mode request");
  }
  if (
    value.mode !== "AUTO" &&
    value.mode !== "HUMAN" &&
    value.mode !== "ASSISTED" &&
    value.mode !== "MONITOR"
  ) {
    throw new BadRequestException("Invalid automation mode");
  }
  const reason =
    value.reason === undefined
      ? undefined
      : cleanMessageString(value.reason, MAX_REASON_LENGTH, "automation mode reason");
  return {
    mode: value.mode as ConversationAutomationMode,
    ...(reason === undefined ? {} : { reason }),
  };
}

function parseAutoAssignMutation(body: unknown): ParsedAutoAssignMutation {
  const value = mutationObject(body, "Invalid auto-assign request");
  if (Object.keys(value).some((key) => !new Set(["policy", "unitId"]).has(key))) {
    throw new BadRequestException("Invalid auto-assign request");
  }
  if (
    value.policy !== "ROUND_ROBIN" &&
    value.policy !== "LEAST_BUSY" &&
    value.policy !== "STICKY_AGENT"
  ) {
    throw new BadRequestException("Invalid assignment policy");
  }
  const unitId =
    value.unitId === undefined ? undefined : mutationAssignmentId(value.unitId, "assigned unit");
  return {
    policy: value.policy as AssignmentPolicy,
    ...(unitId === undefined || unitId === null ? {} : { unitId }),
  };
}

type ParsedInactivityTimeoutMutation = Readonly<{
  inactivityMinutes: number;
  releaseTakeoverMinutes?: number;
  closeReason?: string;
}>;

function parseInactivityTimeoutMutation(body: unknown): ParsedInactivityTimeoutMutation {
  const value = mutationObject(body, "Invalid inactivity timeout request");
  if (
    Object.keys(value).some(
      (key) => !new Set(["inactivityMinutes", "releaseTakeoverMinutes", "closeReason"]).has(key),
    )
  ) {
    throw new BadRequestException("Invalid inactivity timeout request");
  }
  if (
    typeof value.inactivityMinutes !== "number" ||
    !Number.isInteger(value.inactivityMinutes) ||
    value.inactivityMinutes <= 0 ||
    value.inactivityMinutes > 43_200
  ) {
    throw new BadRequestException("Inactivity minutes must be an integer between 1 and 43200");
  }

  let releaseTakeoverMinutes: number | undefined;
  if (value.releaseTakeoverMinutes !== undefined) {
    if (
      typeof value.releaseTakeoverMinutes !== "number" ||
      !Number.isInteger(value.releaseTakeoverMinutes) ||
      value.releaseTakeoverMinutes <= 0 ||
      value.releaseTakeoverMinutes > 43_200
    ) {
      throw new BadRequestException(
        "Release takeover minutes must be an integer between 1 and 43200",
      );
    }
    releaseTakeoverMinutes = value.releaseTakeoverMinutes;
  }

  const closeReason =
    value.closeReason === undefined
      ? undefined
      : cleanMessageString(value.closeReason, MAX_REASON_LENGTH, "close reason");

  return {
    inactivityMinutes: value.inactivityMinutes,
    ...(releaseTakeoverMinutes === undefined ? {} : { releaseTakeoverMinutes }),
    ...(closeReason === undefined ? {} : { closeReason }),
  };
}

function conversationId(value: string): string {
  if (!UUID_V7_PATTERN.test(value)) throw new NotFoundException("Conversation not found");
  return value.toLowerCase();
}

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

function publicSentMessage(
  result: Awaited<ReturnType<OutboundConversationMessageManager["sendConversationMessage"]>>,
): InboxSendMessageResponse {
  return {
    message: {
      actorId: result.message.actorId,
      actorType: result.message.actorType,
      conversationId: result.message.conversationId,
      createdAt: result.message.createdAt.toISOString(),
      deliveryStatus: result.message.deliveryStatus,
      direction: result.message.direction,
      id: result.message.id,
      origin: result.message.origin,
      structuredPayload: result.message.structuredPayload,
      textBody: result.message.textBody,
    },
    outboundMessageId: result.outboundMessage.id,
  };
}

function mapError(error: unknown): never {
  if (error instanceof ConversationNotFoundError) {
    throw new NotFoundException("Conversation not found");
  }
  if (error instanceof ConversationNotWritableError) {
    throw new BadRequestException("Conversation or channel is not writable");
  }
  if (error instanceof InvalidConversationStateTransitionError) {
    throw new BadRequestException("Invalid conversation state transition");
  }
  if (error instanceof ActiveTenantUserNotFoundError) {
    throw new BadRequestException("Assigned user was not found or is inactive");
  }
  if (error instanceof OrganizationUnitNotFoundError) {
    throw new BadRequestException("Assigned unit was not found");
  }
  if (error instanceof InvalidConversationAssignmentError) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof ConversationMutationActorNotFoundError) {
    throw new ForbiddenException("Forbidden");
  }
  if (error instanceof OutboundConversationMessageIdempotencyConflictError) {
    throw new ConflictException({
      code: "IDEMPOTENCY_KEY_CONFLICT",
      error: "Conflict",
      message: "Idempotency key conflicts with an existing message",
      statusCode: 409,
    });
  }
  if (error instanceof OutboundConversationMessageActorNotFoundError) {
    throw new ForbiddenException("Forbidden");
  }
  if (error instanceof InvalidConversationAutomationModeError) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof InvalidAssignmentPolicyError) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof InvalidInactivityTimeoutOptionError) {
    throw new BadRequestException(error.message);
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
  constructor(
    @Inject(INBOX_QUERY_MANAGER) private readonly manager: InboxQueryManager,
    @Inject(OUTBOUND_CONVERSATION_MESSAGE_MANAGER)
    private readonly replyManager: OutboundConversationMessageManager,
    @Inject(INBOX_MUTATION_MANAGER)
    private readonly mutationManager: InboxMutationManager,
    @Inject(TAKEOVER_MANAGER)
    private readonly takeoverManager: TakeoverManager,
    @Inject(ASSIGNMENT_POLICY_ENGINE)
    private readonly assignmentPolicyEngine: AssignmentPolicyEngine,
    @Inject(INACTIVITY_MANAGER)
    private readonly inactivityManager: InactivityManager,
    @Inject(INBOX_REALTIME_BROADCASTER)
    private readonly realtimeBroadcaster: InboxRealtimeBroadcaster,
  ) {}

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

  async send(
    context: TenantContext,
    identity: TenantSessionIdentity,
    requestIdValue: string,
    conversationIdValue: string,
    body: unknown,
  ): Promise<InboxSendMessageResponse> {
    const parsed = parseSendMessage(body);
    try {
      return publicSentMessage(
        await this.replyManager.sendConversationMessage(
          context,
          conversationId(conversationIdValue),
          {
            actorUserId: identity.userId,
            content: parsed.content,
            messageType: parsed.messageType,
            requestId: requestIdValue,
            ...(parsed.idempotencyKey === undefined
              ? {}
              : { idempotencyKey: parsed.idempotencyKey }),
          },
        ),
      );
    } catch (error) {
      return mapError(error);
    }
  }

  async updateStatus(
    context: TenantContext,
    identity: TenantSessionIdentity,
    requestIdValue: string,
    conversationIdValue: string,
    body: unknown,
  ): Promise<InboxConversationDetailResponse> {
    const parsed = parseConversationStatusMutation(body);
    try {
      await this.mutationManager.updateConversationStatus(
        context,
        conversationId(conversationIdValue),
        identity.userId,
        parsed.status,
        parsed.reason,
        requestIdValue,
      );
      return publicDetail(
        await this.manager.getInboxConversationDetail(context, conversationId(conversationIdValue)),
      );
    } catch (error) {
      return mapError(error);
    }
  }

  async updateAutomationMode(
    context: TenantContext,
    identity: TenantSessionIdentity,
    requestIdValue: string,
    conversationIdValue: string,
    body: unknown,
  ): Promise<InboxConversationDetailResponse> {
    const parsed = parseAutomationModeMutation(body);
    try {
      await this.takeoverManager.setConversationAutomationMode(
        context,
        conversationId(conversationIdValue),
        identity.userId,
        parsed.mode,
        parsed.reason,
        requestIdValue,
      );
      return publicDetail(
        await this.manager.getInboxConversationDetail(context, conversationId(conversationIdValue)),
      );
    } catch (error) {
      return mapError(error);
    }
  }

  async autoAssign(
    context: TenantContext,
    identity: TenantSessionIdentity,
    requestIdValue: string,
    conversationIdValue: string,
    body: unknown,
  ): Promise<AssignmentPolicyResult> {
    const parsed = parseAutoAssignMutation(body);
    try {
      return await this.assignmentPolicyEngine.resolveAssignmentByPolicy(
        context,
        conversationId(conversationIdValue),
        parsed.policy,
        {
          actorId: identity.userId,
          requestId: requestIdValue,
          ...(parsed.unitId === undefined ? {} : { unitId: parsed.unitId }),
        },
      );
    } catch (error) {
      return mapError(error);
    }
  }

  async assign(
    context: TenantContext,
    identity: TenantSessionIdentity,
    requestIdValue: string,
    conversationIdValue: string,
    body: unknown,
  ): Promise<InboxConversationDetailResponse> {
    const parsed = parseConversationAssignmentMutation(body);
    try {
      await this.mutationManager.assignConversation(
        context,
        conversationId(conversationIdValue),
        identity.userId,
        parsed,
        requestIdValue,
      );
      return publicDetail(
        await this.manager.getInboxConversationDetail(context, conversationId(conversationIdValue)),
      );
    } catch (error) {
      return mapError(error);
    }
  }

  async processInactivity(
    context: TenantContext,
    identity: TenantSessionIdentity,
    requestIdValue: string,
    body: unknown,
  ): Promise<InactivityProcessResult> {
    const parsed = parseInactivityTimeoutMutation(body);
    try {
      return await this.inactivityManager.processInactivityTimeouts(context, {
        actorId: identity.userId,
        inactivityMinutes: parsed.inactivityMinutes,
        requestId: requestIdValue,
        ...(parsed.closeReason === undefined ? {} : { closeReason: parsed.closeReason }),
        ...(parsed.releaseTakeoverMinutes === undefined
          ? {}
          : { releaseTakeoverMinutes: parsed.releaseTakeoverMinutes }),
      });
    } catch (error) {
      return mapError(error);
    }
  }

  events(context: TenantContext): Observable<MessageEvent> {
    return this.realtimeBroadcaster.subscribeTenantInboxEvents(context.tenantId);
  }
}

@Controller("api/v1/inbox")
@RequireEntitlements("module.messaging.basic", "module.crm_lite")
export class InboxController {
  constructor(private readonly service: InboxService) {}

  @Sse("events")
  @RequirePermissions("conversations.read")
  @UseGuards(
    TenantUserSessionGuard,
    TenantContextGuard,
    TenantPermissionGuard,
    TenantEntitlementGuard,
  )
  events(
    @CurrentTenantContext() context: TenantContext,
    @Res({ passthrough: true }) response: ApiResponse,
  ): Observable<MessageEvent> {
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    return this.service.events(context);
  }

  @Post("conversations/:conversationId/messages")
  @HttpCode(201)
  @RequirePermissions("conversations.reply")
  @UseGuards(
    TenantUserSessionGuard,
    TenantContextGuard,
    TenantPermissionGuard,
    TenantEntitlementGuard,
  )
  send(
    @Param("conversationId") conversationIdValue: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<InboxSendMessageResponse> {
    return this.service.send(context, identity, requestId(request), conversationIdValue, body);
  }

  @Patch("conversations/:conversationId/status")
  @RequirePermissions("conversations.assign")
  @UseGuards(
    TenantUserSessionGuard,
    TenantContextGuard,
    TenantPermissionGuard,
    TenantEntitlementGuard,
  )
  updateStatus(
    @Param("conversationId") conversationIdValue: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<InboxConversationDetailResponse> {
    return this.service.updateStatus(
      context,
      identity,
      requestId(request),
      conversationIdValue,
      body,
    );
  }

  @Patch("conversations/:conversationId/automation-mode")
  @RequirePermissions("conversations.assign")
  @UseGuards(
    TenantUserSessionGuard,
    TenantContextGuard,
    TenantPermissionGuard,
    TenantEntitlementGuard,
  )
  updateAutomationMode(
    @Param("conversationId") conversationIdValue: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<InboxConversationDetailResponse> {
    return this.service.updateAutomationMode(
      context,
      identity,
      requestId(request),
      conversationIdValue,
      body,
    );
  }

  @Post("conversations/:conversationId/auto-assign")
  @HttpCode(200)
  @RequirePermissions("conversations.assign")
  @UseGuards(
    TenantUserSessionGuard,
    TenantContextGuard,
    TenantPermissionGuard,
    TenantEntitlementGuard,
  )
  autoAssign(
    @Param("conversationId") conversationIdValue: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<AssignmentPolicyResult> {
    return this.service.autoAssign(
      context,
      identity,
      requestId(request),
      conversationIdValue,
      body,
    );
  }

  @Post("conversations/process-inactivity")
  @HttpCode(200)
  @RequirePermissions("conversations.assign")
  @UseGuards(
    TenantUserSessionGuard,
    TenantContextGuard,
    TenantPermissionGuard,
    TenantEntitlementGuard,
  )
  processInactivity(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<InactivityProcessResult> {
    return this.service.processInactivity(context, identity, requestId(request), body);
  }

  @Patch("conversations/:conversationId/assignment")
  @RequirePermissions("conversations.assign")
  @UseGuards(
    TenantUserSessionGuard,
    TenantContextGuard,
    TenantPermissionGuard,
    TenantEntitlementGuard,
  )
  assign(
    @Param("conversationId") conversationIdValue: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<InboxConversationDetailResponse> {
    return this.service.assign(context, identity, requestId(request), conversationIdValue, body);
  }

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
