import { randomUUID } from "node:crypto";
import {
  applyDecorators,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  type MessageEvent,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  Sse,
  UseGuards,
} from "@nestjs/common";
import type {
  ChannelAccountItem,
  ChannelAccountListOptions,
  ChannelAccountManager,
  ChannelAccountPage,
  ChannelAccountStatus,
  ChannelPairingManager,
  TenantContext,
} from "@whatsapp-platform/database";
import {
  CHANNEL_ACCOUNT_STATUSES,
  ChannelAccountLimitReachedError,
  ChannelAccountModuleEntitlementRequiredError,
  ChannelAccountNotFoundError,
  ChannelAccountOrganizationUnitNotFoundError,
  ChannelAccountPhoneConflictError,
  ChannelAlreadyConnectedError,
} from "@whatsapp-platform/database";
import {
  getMessagingProvider,
  type MessagingCredentialCipher,
  MessagingCredentialCipherError,
  MessagingProviderError,
} from "@whatsapp-platform/messaging";
import { type Observable, of } from "rxjs";
import { CHANNEL_REALTIME_SERVICE, type ChannelRealtimeService } from "./channel-realtime.service";
import {
  CurrentTenantContext,
  CurrentTenantIdentity,
  type TenantAuthenticationRequest,
  type TenantSessionIdentity,
} from "./tenant-context";
import { RequireEntitlements, TenantEntitlementGuard } from "./tenant-entitlements";
import { TenantAuthorized } from "./tenant-rbac";

export const CHANNEL_ACCOUNT_MANAGER = Symbol("CHANNEL_ACCOUNT_MANAGER");
export const CHANNEL_PAIRING_MANAGER = Symbol("CHANNEL_PAIRING_MANAGER");
export const MESSAGING_CREDENTIAL_CIPHER = Symbol("MESSAGING_CREDENTIAL_CIPHER");

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_TYPES = new Map<string, string>([
  ["mock", "mock"],
  ["MOCK", "mock"],
  ["baileys", "baileys"],
  ["BAILEYS", "baileys"],
  ["wppconnect", "wppconnect"],
  ["WPPCONNECT", "wppconnect"],
  ["meta", "meta"],
  ["META", "meta"],
  ["meta_cloud_api", "meta"],
  ["META_CLOUD_API", "meta"],
]);
const STATUS_ALIASES = new Map<string, ChannelAccountStatus>([
  ...CHANNEL_ACCOUNT_STATUSES.map((value) => [value, value] as const),
  ["ACTIVE", "connected"],
  ["DISCONNECTED", "disconnected"],
  ["CONNECTING", "pairing"],
  ["FAILED", "error"],
  ["ARCHIVED", "archived"],
]);
const MAX_SETTINGS_BYTES = 16 * 1024;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };
type ApiResponse = { setHeader(name: string, value: string): void };

export type ChannelResponse = ChannelAccountItem & Readonly<{ name: string }>;

export type ChannelPairingInitiateResponse = Readonly<{
  channelAccountId: string;
  status: string;
  displayName: string;
  phoneNumber: string | null;
  updatedAt: string;
}>;

export type ChannelPairingQrResponse = Readonly<{
  status: string;
  qrRaw: string | null;
  qrGeneratedAt: string | null;
  isExpired: boolean;
}>;

export type ChannelDisconnectResponse = Readonly<{
  channelAccountId: string;
  status: string;
  displayName: string;
  phoneNumber: string | null;
  updatedAt: string;
}>;

export type ChannelHealthResponse = Readonly<{
  status: string;
  isHealthy: boolean;
  lastHeartbeatAt: string | null;
  lastLatencyMs: number | null;
  socketStatus: "open" | "connecting" | "closed";
  isDegraded: boolean;
  reconnectAttempts: number;
}>;

export type ChannelTestConnectionResponse = Readonly<{
  status: "OK" | "ERROR";
  latencyMs: number;
  message: string;
  timestamp: string;
}>;

type ChannelCreatePayload = {
  displayName: string;
  phoneNumber: string | null;
  providerType: string;
  externalAccountId?: string | null;
  organizationUnitId?: string | null;
  active?: boolean;
};

type ChannelUpdatePayload = {
  displayName?: string;
  status?: ChannelAccountStatus;
  externalAccountId?: string | null;
  organizationUnitId?: string | null;
  isActive?: boolean;
};

function requestId(request: TenantAuthenticationRequest): string {
  const value = request.headers["x-request-id"];
  const header = Array.isArray(value) ? value[0] : value;
  return header !== undefined && /^[A-Za-z0-9._:-]{1,128}$/.test(header) ? header : randomUUID();
}

function plainObject(value: unknown, message = "Invalid channel request"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(message);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) {
    throw new BadRequestException("Invalid channel request");
  }
}

function stringValue(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new BadRequestException(`Invalid ${label}`);
  const result = value.trim();
  if (result.length === 0 || result.length > maxLength) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return result;
}

function phoneNumber(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new BadRequestException("Invalid phone number");
  const normalized = value.replace(/[\s().-]/g, "").trim();
  if (!/^\+?[0-9]{7,15}$/.test(normalized)) {
    throw new BadRequestException("Invalid phone number");
  }
  return normalized;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return value.toLowerCase();
}

function providerType(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException("Invalid provider type");
  const normalized = PROVIDER_TYPES.get(value.trim());
  if (normalized === undefined) throw new BadRequestException("Invalid provider type");
  return normalized;
}

function status(value: unknown): ChannelAccountStatus {
  if (typeof value !== "string") throw new BadRequestException("Invalid channel status");
  const normalized = STATUS_ALIASES.get(value.trim());
  if (normalized === undefined) throw new BadRequestException("Invalid channel status");
  return normalized;
}

function objectJson(value: unknown, message: string): JsonObject {
  const result = plainObject(value, message);
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_SETTINGS_BYTES) {
    throw new BadRequestException("Channel object is too large");
  }
  return result as JsonObject;
}

function settings(value: unknown): JsonObject {
  return value === undefined ? {} : objectJson(value, "Invalid channel settings");
}

function credentials(value: unknown): JsonObject {
  return value === undefined ? {} : objectJson(value, "Invalid channel credentials");
}

function response(item: ChannelAccountItem): ChannelResponse {
  return { ...item, name: item.displayName };
}

function parseCreate(body: unknown): {
  input: ChannelCreatePayload;
  credentials: JsonObject;
  settings: JsonObject;
} {
  const value = plainObject(body);
  exactKeys(value, [
    "displayName",
    "name",
    "phoneNumber",
    "providerType",
    "credentials",
    "settings",
    "externalAccountId",
    "organizationUnitId",
    "active",
  ]);
  if (value.displayName !== undefined && value.name !== undefined) {
    throw new BadRequestException("Use only one channel name field");
  }
  if (value.active !== undefined && typeof value.active !== "boolean") {
    throw new BadRequestException("Invalid active flag");
  }
  const input: ChannelCreatePayload = {
    displayName: stringValue(value.displayName ?? value.name, "channel name", 100),
    phoneNumber: phoneNumber(value.phoneNumber),
    providerType: providerType(value.providerType ?? "mock"),
  };
  if (value.active !== undefined) input.active = value.active as boolean;
  if (value.externalAccountId !== undefined) {
    input.externalAccountId =
      value.externalAccountId === null
        ? null
        : stringValue(value.externalAccountId, "external account id", 255);
  }
  if (value.organizationUnitId !== undefined) {
    input.organizationUnitId =
      value.organizationUnitId === null
        ? null
        : uuid(value.organizationUnitId, "organization unit id");
  }
  return { credentials: credentials(value.credentials), input, settings: settings(value.settings) };
}

function parseUpdate(body: unknown): {
  input: ChannelUpdatePayload;
  credentials: JsonObject | undefined;
  settings: JsonObject | undefined;
} {
  const value = plainObject(body);
  exactKeys(value, [
    "displayName",
    "name",
    "status",
    "credentials",
    "settings",
    "externalAccountId",
    "organizationUnitId",
    "isActive",
  ]);
  if (Object.keys(value).length === 0) throw new BadRequestException("Invalid channel update");
  if (value.displayName !== undefined && value.name !== undefined) {
    throw new BadRequestException("Use only one channel name field");
  }
  if (value.isActive !== undefined && typeof value.isActive !== "boolean") {
    throw new BadRequestException("Invalid active flag");
  }
  const input: ChannelUpdatePayload = {};
  if (value.displayName !== undefined || value.name !== undefined) {
    input.displayName = stringValue(value.displayName ?? value.name, "channel name", 100);
  }
  if (value.externalAccountId !== undefined) {
    input.externalAccountId =
      value.externalAccountId === null
        ? null
        : stringValue(value.externalAccountId, "external account id", 255);
  }
  if (value.isActive !== undefined) input.isActive = value.isActive as boolean;
  if (value.organizationUnitId !== undefined) {
    input.organizationUnitId =
      value.organizationUnitId === null
        ? null
        : uuid(value.organizationUnitId, "organization unit id");
  }
  if (value.status !== undefined) input.status = status(value.status);
  return {
    credentials: value.credentials === undefined ? undefined : credentials(value.credentials),
    input,
    settings: value.settings === undefined ? undefined : settings(value.settings),
  };
}

function pageValue(value: unknown, label: string, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return parsed;
}

function mapError(error: unknown): never {
  if (error instanceof ChannelAccountNotFoundError)
    throw new NotFoundException("Channel not found");
  if (error instanceof ChannelAccountOrganizationUnitNotFoundError) {
    throw new NotFoundException("Organization unit not found");
  }
  if (error instanceof ChannelAlreadyConnectedError) {
    throw new ConflictException({
      code: "CHANNEL_ALREADY_CONNECTED",
      error: "Conflict",
      message: "Channel account is already connected",
      statusCode: 409,
    });
  }
  if (error instanceof ChannelAccountPhoneConflictError) {
    throw new ConflictException({
      code: "CHANNEL_PHONE_CONFLICT",
      error: "Conflict",
      message: "An active channel already uses this phone number",
      statusCode: 409,
    });
  }
  if (error instanceof ChannelAccountLimitReachedError) {
    throw new ConflictException({
      code: "CHANNEL_LIMIT_REACHED",
      error: "Conflict",
      message: "The channel account limit for the workspace has been reached",
      statusCode: 409,
    });
  }
  if (error instanceof ChannelAccountModuleEntitlementRequiredError) {
    throw new ForbiddenException({
      code: "ENTITLEMENT_REQUIRED",
      error: "Forbidden",
      message: "The messaging module is not enabled",
      moduleKey: "module.messaging.basic",
      statusCode: 403,
    });
  }
  if (error instanceof MessagingCredentialCipherError) {
    throw new ServiceUnavailableException("Messaging credential encryption is not configured");
  }
  throw error;
}

function messagingAuthorized(
  ...permissions: ["channels.read"] | ["channels.manage"]
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    TenantAuthorized(...permissions),
    RequireEntitlements("module.messaging.basic"),
    UseGuards(TenantEntitlementGuard),
  );
}

@Injectable()
export class TenantChannelsService {
  constructor(
    @Inject(CHANNEL_ACCOUNT_MANAGER) private readonly manager: ChannelAccountManager,
    @Inject(MESSAGING_CREDENTIAL_CIPHER)
    private readonly credentialCipher: MessagingCredentialCipher | null,
    @Inject(CHANNEL_PAIRING_MANAGER)
    private readonly pairingManager?: ChannelPairingManager,
    @Inject(CHANNEL_REALTIME_SERVICE)
    private readonly realtimeService?: ChannelRealtimeService,
  ) {}

  events(context: TenantContext): Observable<MessageEvent> {
    if (this.realtimeService) {
      return this.realtimeService.subscribeTenantChannelEvents(context.tenantId);
    }
    return of({ data: "{}", type: "ping" });
  }

  list(
    context: TenantContext,
    query: Record<string, string | undefined>,
  ): Promise<ChannelAccountPage> {
    const options: ChannelAccountListOptions = {
      page: pageValue(query.page, "page", 10_000, 1),
      pageSize: pageValue(query.pageSize, "page size", 100, 25),
      ...(query.status === undefined ? {} : { status: status(query.status) }),
    };
    return this.manager.list(context, options);
  }

  async create(
    context: TenantContext,
    identity: TenantSessionIdentity,
    requestIdValue: string,
    body: unknown,
  ): Promise<ChannelResponse> {
    const parsed = parseCreate(body);
    try {
      const ciphertext = this.encryptCredentials(parsed.credentials);
      const item = await this.manager.create(
        context,
        { ...parsed.input, credentialsCiphertext: ciphertext, settings: parsed.settings },
        { actorUserId: identity.userId, requestId: requestIdValue },
      );
      return response(item);
    } catch (error) {
      return mapError(error);
    }
  }

  async get(context: TenantContext, channelId: string): Promise<ChannelResponse> {
    const item = await this.manager.findById(context, this.channelId(channelId));
    if (item === null) throw new NotFoundException("Channel not found");
    return response(item);
  }

  async update(
    context: TenantContext,
    identity: TenantSessionIdentity,
    requestIdValue: string,
    channelId: string,
    body: unknown,
  ): Promise<ChannelResponse> {
    const parsed = parseUpdate(body);
    try {
      const ciphertext =
        parsed.credentials === undefined ? undefined : this.encryptCredentials(parsed.credentials);
      const item = await this.manager.update(
        context,
        this.channelId(channelId),
        {
          ...parsed.input,
          ...(ciphertext === undefined ? {} : { credentialsCiphertext: ciphertext }),
          ...(parsed.settings === undefined ? {} : { settings: parsed.settings }),
        },
        { actorUserId: identity.userId, requestId: requestIdValue },
      );
      return response(item);
    } catch (error) {
      return mapError(error);
    }
  }

  async archive(
    context: TenantContext,
    identity: TenantSessionIdentity,
    requestIdValue: string,
    channelId: string,
  ): Promise<ChannelResponse> {
    try {
      const item = await this.manager.archive(context, this.channelId(channelId), {
        actorUserId: identity.userId,
        requestId: requestIdValue,
      });
      return response(item);
    } catch (error) {
      return mapError(error);
    }
  }

  async initiatePairing(
    context: TenantContext,
    identity: TenantSessionIdentity,
    requestIdValue: string,
    channelId: string,
  ): Promise<ChannelPairingInitiateResponse> {
    const id = this.channelId(channelId);
    try {
      if (!this.pairingManager) {
        throw new ServiceUnavailableException("Channel pairing manager is not configured");
      }
      const result = await this.pairingManager.initiateChannelPairing(
        context,
        id,
        identity.userId,
        requestIdValue,
      );
      return {
        channelAccountId: result.id,
        displayName: result.displayName,
        phoneNumber: result.phoneNumber,
        status: result.status,
        updatedAt: result.updatedAt.toISOString(),
      };
    } catch (error) {
      return mapError(error);
    }
  }

  async getPairingQr(context: TenantContext, channelId: string): Promise<ChannelPairingQrResponse> {
    const id = this.channelId(channelId);
    const item = await this.manager.findById(context, id);
    if (item === null) throw new NotFoundException("Channel not found");

    const settings =
      item.settings !== null && typeof item.settings === "object" && !Array.isArray(item.settings)
        ? (item.settings as Record<string, unknown>)
        : {};
    const metadata =
      settings.metadata !== null &&
      typeof settings.metadata === "object" &&
      !Array.isArray(settings.metadata)
        ? (settings.metadata as Record<string, unknown>)
        : {};

    const rawQr =
      (metadata.latestQrRaw as string | undefined) ??
      (settings.latestQrRaw as string | undefined) ??
      null;
    const generatedAt =
      (metadata.qrGeneratedAt as string | undefined) ??
      (settings.qrGeneratedAt as string | undefined) ??
      null;

    let isExpired = true;
    if (rawQr !== null && generatedAt !== null) {
      const timestamp = new Date(generatedAt).getTime();
      const elapsed = Date.now() - timestamp;
      if (!Number.isNaN(timestamp) && elapsed >= 0 && elapsed <= 30_000) {
        isExpired = false;
      }
    }

    return {
      isExpired,
      qrGeneratedAt: generatedAt,
      qrRaw: isExpired ? null : rawQr,
      status: item.status,
    };
  }

  async disconnect(
    context: TenantContext,
    identity: TenantSessionIdentity,
    requestIdValue: string,
    channelId: string,
    body?: unknown,
  ): Promise<ChannelDisconnectResponse> {
    const id = this.channelId(channelId);
    let reason: string | undefined;
    if (body !== undefined && body !== null && typeof body === "object" && !Array.isArray(body)) {
      const parsedBody = body as Record<string, unknown>;
      if (typeof parsedBody.reason === "string" && parsedBody.reason.trim().length > 0) {
        reason = parsedBody.reason.trim();
      }
    }
    try {
      if (!this.pairingManager) {
        throw new ServiceUnavailableException("Channel pairing manager is not configured");
      }
      const result = await this.pairingManager.disconnectChannel(
        context,
        id,
        identity.userId,
        reason,
        requestIdValue,
      );
      return {
        channelAccountId: result.id,
        displayName: result.displayName,
        phoneNumber: result.phoneNumber,
        status: result.status,
        updatedAt: result.updatedAt.toISOString(),
      };
    } catch (error) {
      return mapError(error);
    }
  }

  async getHealth(context: TenantContext, channelId: string): Promise<ChannelHealthResponse> {
    const id = this.channelId(channelId);
    const item = await this.manager.findById(context, id);
    if (item === null) {
      throw new NotFoundException("Channel not found");
    }

    const settings =
      item.settings !== null && typeof item.settings === "object" && !Array.isArray(item.settings)
        ? (item.settings as Record<string, unknown>)
        : {};
    const metadata =
      settings.metadata !== null &&
      typeof settings.metadata === "object" &&
      !Array.isArray(settings.metadata)
        ? (settings.metadata as Record<string, unknown>)
        : {};

    const lastHeartbeatAt =
      (metadata.lastHeartbeatAt as string | undefined) ??
      (settings.lastHeartbeatAt as string | undefined) ??
      null;

    const lastLatencyMs =
      typeof metadata.lastLatencyMs === "number"
        ? metadata.lastLatencyMs
        : typeof settings.lastLatencyMs === "number"
          ? settings.lastLatencyMs
          : null;

    const rawSocketStatus =
      (metadata.socketStatus as string | undefined) ??
      (settings.socketStatus as string | undefined);
    const socketStatus: "open" | "connecting" | "closed" =
      rawSocketStatus === "open" || rawSocketStatus === "connecting" || rawSocketStatus === "closed"
        ? rawSocketStatus
        : item.status.toLowerCase() === "connected"
          ? "open"
          : item.status.toLowerCase() === "connecting" ||
              item.status.toLowerCase() === "pairing" ||
              item.status.toLowerCase() === "qr_ready"
            ? "connecting"
            : "closed";

    const isDegraded = metadata.isDegraded === true || settings.isDegraded === true;

    const reconnectAttempts =
      typeof metadata.reconnectAttempts === "number"
        ? metadata.reconnectAttempts
        : typeof settings.reconnectAttempts === "number"
          ? settings.reconnectAttempts
          : 0;

    const isConnected = item.status.toLowerCase() === "connected" || item.status === "CONNECTED";

    const isHealthy = isConnected && !isDegraded && socketStatus === "open";

    return {
      isDegraded,
      isHealthy,
      lastHeartbeatAt,
      lastLatencyMs,
      reconnectAttempts,
      socketStatus,
      status: item.status,
    };
  }

  async testConnection(
    context: TenantContext,
    channelId: string,
  ): Promise<ChannelTestConnectionResponse> {
    const item = await this.manager.findById(context, this.channelId(channelId));
    if (item === null) throw new NotFoundException("Channel not found");
    const started = performance.now();
    try {
      const health = await getMessagingProvider({
        providerType: item.providerType,
      }).getHealthStatus();
      return {
        latencyMs: Math.max(0, Math.round(performance.now() - started)),
        message: health.message ?? health.status,
        status: health.status === "healthy" ? "OK" : "ERROR",
        timestamp: health.checkedAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof MessagingProviderError) {
        throw new ConflictException({
          code: error.code,
          error: "Conflict",
          message: error.message,
        });
      }
      throw error;
    }
  }

  private encryptCredentials(value: Record<string, unknown>): string | null {
    if (Object.keys(value).length === 0) return null;
    if (this.credentialCipher === null) {
      throw new MessagingCredentialCipherError("Messaging credential encryption is not configured");
    }
    return this.credentialCipher.encrypt(value);
  }

  private channelId(value: string): string {
    if (!UUID_V7_PATTERN.test(value)) throw new BadRequestException("Invalid channel id");
    return value.toLowerCase();
  }
}

@Controller(["app/channels", "api/v1/channels"])
export class TenantChannelsController {
  constructor(private readonly service: TenantChannelsService) {}

  @Get()
  @messagingAuthorized("channels.read")
  list(
    @Query() query: Record<string, string | undefined>,
    @CurrentTenantContext() context: TenantContext,
  ): Promise<ChannelAccountPage> {
    return this.service.list(context, query);
  }

  @Sse("events/stream")
  @messagingAuthorized("channels.read")
  events(
    @CurrentTenantContext() context: TenantContext,
    @Res({ passthrough: true }) response: ApiResponse,
  ): Observable<MessageEvent> {
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    return this.service.events(context);
  }

  @Post()
  @HttpCode(201)
  @messagingAuthorized("channels.manage")
  create(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<ChannelResponse> {
    return this.service.create(context, identity, requestId(request), body);
  }

  @Get(":channelId")
  @messagingAuthorized("channels.read")
  get(
    @Param("channelId") channelId: string,
    @CurrentTenantContext() context: TenantContext,
  ): Promise<ChannelResponse> {
    return this.service.get(context, channelId);
  }

  @Patch(":channelId")
  @messagingAuthorized("channels.manage")
  update(
    @Param("channelId") channelId: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<ChannelResponse> {
    return this.service.update(context, identity, requestId(request), channelId, body);
  }

  @Delete(":channelId")
  @messagingAuthorized("channels.manage")
  archive(
    @Param("channelId") channelId: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
  ): Promise<ChannelResponse> {
    return this.service.archive(context, identity, requestId(request), channelId);
  }

  @Post(":channelId/pair/initiate")
  @HttpCode(200)
  @messagingAuthorized("channels.manage")
  initiatePairing(
    @Param("channelId") channelId: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
  ): Promise<ChannelPairingInitiateResponse> {
    return this.service.initiatePairing(context, identity, requestId(request), channelId);
  }

  @Get(":channelId/pair/qr")
  @messagingAuthorized("channels.read")
  getPairingQr(
    @Param("channelId") channelId: string,
    @CurrentTenantContext() context: TenantContext,
  ): Promise<ChannelPairingQrResponse> {
    return this.service.getPairingQr(context, channelId);
  }

  @Post(":channelId/disconnect")
  @HttpCode(200)
  @messagingAuthorized("channels.manage")
  disconnect(
    @Param("channelId") channelId: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body?: unknown,
  ): Promise<ChannelDisconnectResponse> {
    return this.service.disconnect(context, identity, requestId(request), channelId, body);
  }

  @Get(":channelId/health")
  @messagingAuthorized("channels.read")
  getHealth(
    @Param("channelId") channelId: string,
    @CurrentTenantContext() context: TenantContext,
  ): Promise<ChannelHealthResponse> {
    return this.service.getHealth(context, channelId);
  }

  @Post(":channelId/test-connection")
  @messagingAuthorized("channels.manage")
  testConnection(
    @Param("channelId") channelId: string,
    @CurrentTenantContext() context: TenantContext,
  ): Promise<ChannelTestConnectionResponse> {
    return this.service.testConnection(context, channelId);
  }
}
