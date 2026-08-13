import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Body,
  type CanActivate,
  Controller,
  type ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UnsupportedMediaTypeException,
  UseGuards,
} from "@nestjs/common";
import {
  generateOpaqueToken,
  hashOpaqueToken,
  hashPlatformClientAddress,
  normalizeTenantSlug,
  normalizeTenantUserEmail,
  PASSWORD_RESET_TTL_MS,
  PlatformPasswordHasher,
  readCookie,
  serializeClearedTenantSessionCookie,
  serializeTenantSessionCookie,
  TENANT_SESSION_ABSOLUTE_TTL_MS,
  TENANT_SESSION_IDLE_TTL_MS,
  TENANT_SESSION_TOUCH_INTERVAL_MS,
  type TenantCookieConfig,
} from "@whatsapp-platform/auth";
import type {
  TenantAuthRepository,
  TenantAuthTenant,
  TenantSessionIdentity,
  TenantUserProfile,
} from "@whatsapp-platform/database/platform";

export const TENANT_AUTH_REPOSITORY = Symbol("TENANT_AUTH_REPOSITORY");
export const TENANT_AUTH_OPTIONS = Symbol("TENANT_AUTH_OPTIONS");
export const PASSWORD_RESET_DELIVERY = Symbol("PASSWORD_RESET_DELIVERY");

export type TenantAuthOptions = Readonly<{
  cookie: TenantCookieConfig;
  webOrigin: string;
}>;

export type PasswordResetDeliveryMessage = Readonly<{
  email: string;
  displayName: string;
  tenantDisplayName: string;
  resetUrl: string;
  expiresAt: Date;
}>;

export interface PasswordResetDelivery {
  deliver(message: PasswordResetDeliveryMessage): Promise<void>;
}

@Injectable()
export class UnavailablePasswordResetDelivery implements PasswordResetDelivery {
  async deliver(_message: PasswordResetDeliveryMessage): Promise<void> {
    throw new Error("Password reset delivery is not configured");
  }
}

type TenantRequest = {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  tenantIdentity?: TenantSessionIdentity;
};

type ApiResponse = { setHeader(name: string, value: string): void };

function header(request: TenantRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function requestId(request: TenantRequest): string {
  const value = header(request, "x-request-id");
  return value !== undefined && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : randomUUID();
}

function requireJson(request: TenantRequest): void {
  if (!(header(request, "content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new UnsupportedMediaTypeException("Content-Type must be application/json");
  }
}

function plainObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Invalid request");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): void {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key)))
    throw new BadRequestException("Invalid request");
}

function parseEmail(value: unknown): string {
  if (typeof value !== "string" || value.length > 320)
    throw new BadRequestException("Invalid request");
  const email = normalizeTenantUserEmail(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException("Invalid request");
  return email;
}

function parseLogin(body: unknown): { email: string; password: string; deviceLabel?: string } {
  const value = plainObject(body);
  exactKeys(value, ["email", "password", "deviceLabel"]);
  if (typeof value.password !== "string" || value.password.length > 128) {
    throw new BadRequestException("Invalid request");
  }
  if (
    value.deviceLabel !== undefined &&
    (typeof value.deviceLabel !== "string" || value.deviceLabel.length > 200)
  ) {
    throw new BadRequestException("Invalid request");
  }
  return {
    ...(typeof value.deviceLabel === "string" ? { deviceLabel: value.deviceLabel } : {}),
    email: parseEmail(value.email),
    password: value.password,
  };
}

@Injectable()
export class TenantOriginGuard implements CanActivate {
  constructor(@Inject(TENANT_AUTH_OPTIONS) private readonly options: TenantAuthOptions) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    if (header(request, "origin") !== this.options.webOrigin) {
      throw new ForbiddenException("Invalid request origin");
    }
    return true;
  }
}

@Injectable()
export class TenantAuthRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  assertAllowed(
    bucket: "login" | "reset-confirm" | "reset-request",
    key: string,
    limit: number,
    now = Date.now(),
  ): void {
    const id = `${bucket}:${key}`;
    const recent = (this.buckets.get(id) ?? []).filter((time) => time > now - 60_000);
    if (recent.length >= limit)
      throw new HttpException("Too many attempts", HttpStatus.TOO_MANY_REQUESTS);
    recent.push(now);
    this.buckets.set(id, recent);
  }
}

@Injectable()
export class TenantUserSessionGuard implements CanActivate {
  constructor(
    @Inject(TENANT_AUTH_REPOSITORY) private readonly repository: TenantAuthRepository,
    @Inject(TENANT_AUTH_OPTIONS) private readonly options: TenantAuthOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const token = readCookie(header(request, "cookie"), this.options.cookie.name);
    if (token === null) throw new UnauthorizedException("Authentication required");
    const identity = await this.repository.findSessionByTokenHash(hashOpaqueToken(token));
    const now = new Date();
    if (
      identity === null ||
      identity.revokedAt !== null ||
      identity.userStatus !== "active" ||
      identity.tenantStatus !== "active" ||
      identity.expiresAt.getTime() <= now.getTime() ||
      now.getTime() - identity.lastSeenAt.getTime() > TENANT_SESSION_IDLE_TTL_MS
    ) {
      throw new UnauthorizedException("Authentication required");
    }
    if (now.getTime() - identity.lastSeenAt.getTime() >= TENANT_SESSION_TOUCH_INTERVAL_MS) {
      await this.repository.touchSession(identity.sessionId, now);
    }
    request.tenantIdentity = identity;
    return true;
  }
}

@Injectable()
export class TenantLogoutGuard implements CanActivate {
  constructor(
    @Inject(TENANT_AUTH_REPOSITORY) private readonly repository: TenantAuthRepository,
    @Inject(TENANT_AUTH_OPTIONS) private readonly options: TenantAuthOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const token = readCookie(header(request, "cookie"), this.options.cookie.name);
    if (token === null) throw new UnauthorizedException("Authentication required");
    const identity = await this.repository.findSessionByTokenHash(hashOpaqueToken(token));
    if (identity === null) throw new UnauthorizedException("Authentication required");
    request.tenantIdentity = identity;
    return true;
  }
}

@Injectable()
export class TenantAuthService {
  private readonly hasher = new PlatformPasswordHasher();
  private readonly dummyHash = this.hasher.hash("invalid tenant account password sentinel");

  constructor(
    @Inject(TENANT_AUTH_REPOSITORY) private readonly repository: TenantAuthRepository,
    @Inject(TENANT_AUTH_OPTIONS) private readonly options: TenantAuthOptions,
    @Inject(PASSWORD_RESET_DELIVERY) private readonly delivery: PasswordResetDelivery,
  ) {}

  async createTenantUserIdentity(input: {
    tenantId: string;
    email: string;
    password: string;
    displayName: string;
    locale?: string;
    timezone?: string;
  }): Promise<TenantUserProfile> {
    return this.repository.createUser({
      displayName: input.displayName,
      email: normalizeTenantUserEmail(input.email),
      locale: input.locale ?? "es-MX",
      passwordHash: await this.hasher.hash(input.password),
      tenantId: input.tenantId,
      timezone: input.timezone ?? "America/Mexico_City",
    });
  }

  async login(
    slug: string,
    email: string,
    password: string,
    metadata: { deviceLabel?: string; ip?: string; requestId: string },
  ): Promise<{ tenant: TenantAuthTenant; user: TenantUserProfile; token: string }> {
    const record = await this.repository.findLoginRecord(slug, email);
    const valid = await this.hasher.verify(
      record?.user?.passwordHash ?? (await this.dummyHash),
      password,
    );
    if (!valid || record?.tenantStatus !== "active" || record.user?.status !== "active") {
      throw new UnauthorizedException("Invalid credentials");
    }
    const token = generateOpaqueToken();
    const identity = await this.repository.createLoginSession({
      ...(metadata.deviceLabel === undefined ? {} : { deviceLabel: metadata.deviceLabel }),
      expiresAt: new Date(Date.now() + TENANT_SESSION_ABSOLUTE_TTL_MS),
      ...(metadata.ip === undefined ? {} : { ipHash: hashPlatformClientAddress(metadata.ip) }),
      requestId: metadata.requestId,
      tenantId: record.tenant.id,
      tokenHash: hashOpaqueToken(token),
      userId: record.user.id,
    });
    return { ...identity, token };
  }

  async requestPasswordReset(slug: string, email: string, id: string): Promise<void> {
    const record = await this.repository.findLoginRecord(slug, email);
    if (record?.tenantStatus !== "active" || record.user?.status !== "active") return;
    const token = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    await this.repository.createPasswordReset({
      expiresAt,
      requestId: id,
      tenantId: record.tenant.id,
      tokenHash: hashOpaqueToken(token),
      userId: record.user.id,
    });
    const url = new URL("/reset-password", this.options.webOrigin);
    url.searchParams.set("tenant", record.tenant.slug);
    url.searchParams.set("token", token);
    try {
      await this.delivery.deliver({
        displayName: record.user.displayName,
        email: record.user.email,
        expiresAt,
        resetUrl: url.toString(),
        tenantDisplayName: record.tenant.displayName,
      });
    } catch {
      console.error(JSON.stringify({ event: "password_reset.delivery_failed", requestId: id }));
    }
  }

  async confirmPasswordReset(
    slug: string,
    token: string,
    newPassword: string,
    id: string,
  ): Promise<void> {
    const reset = await this.repository.findPasswordReset(slug, hashOpaqueToken(token));
    const now = Date.now();
    if (
      reset === null ||
      reset.consumedAt !== null ||
      reset.revokedAt !== null ||
      reset.expiresAt.getTime() <= now ||
      reset.tenantStatus !== "active" ||
      reset.userStatus !== "active"
    ) {
      throw new BadRequestException("Invalid or expired reset token");
    }
    const completed = await this.repository.completePasswordReset(
      reset,
      await this.hasher.hash(newPassword),
      id,
    );
    if (!completed) throw new BadRequestException("Invalid or expired reset token");
  }
}

@Controller("auth")
export class TenantAuthController {
  constructor(
    private readonly service: TenantAuthService,
    private readonly limiter: TenantAuthRateLimiter,
    @Inject(TENANT_AUTH_REPOSITORY) private readonly repository: TenantAuthRepository,
    @Inject(TENANT_AUTH_OPTIONS) private readonly options: TenantAuthOptions,
  ) {}

  @Post("tenants/:tenantSlug/login")
  @HttpCode(200)
  @UseGuards(TenantOriginGuard)
  async login(
    @Param("tenantSlug") rawSlug: string,
    @Body() rawBody: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) response: ApiResponse,
  ): Promise<{ tenant: TenantAuthTenant; user: TenantUserProfile }> {
    requireJson(request);
    const slug = normalizeTenantSlug(rawSlug);
    const body = parseLogin(rawBody);
    this.limiter.assertAllowed("login", `${slug}:${body.email}:${request.ip ?? "unknown"}`, 20);
    const result = await this.service.login(slug, body.email, body.password, {
      ...(body.deviceLabel === undefined ? {} : { deviceLabel: body.deviceLabel }),
      ...(request.ip === undefined ? {} : { ip: request.ip }),
      requestId: requestId(request),
    });
    response.setHeader(
      "Set-Cookie",
      serializeTenantSessionCookie(result.token, this.options.cookie),
    );
    return { tenant: result.tenant, user: result.user };
  }

  @Get("me")
  @UseGuards(TenantUserSessionGuard)
  me(@Req() request: TenantRequest): { tenant: TenantAuthTenant; user: TenantUserProfile } {
    const identity = request.tenantIdentity;
    if (identity === undefined) throw new UnauthorizedException();
    return { tenant: identity.tenant, user: identity.user };
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(TenantOriginGuard, TenantLogoutGuard)
  async logout(
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) response: ApiResponse,
  ): Promise<void> {
    const identity = request.tenantIdentity;
    if (identity === undefined) throw new UnauthorizedException();
    if (identity.revokedAt === null)
      await this.repository.revokeSession(identity, requestId(request));
    response.setHeader("Set-Cookie", serializeClearedTenantSessionCookie(this.options.cookie));
  }

  @Post("sessions/revoke-all")
  @HttpCode(204)
  @UseGuards(TenantOriginGuard, TenantUserSessionGuard)
  async revokeAll(
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) response: ApiResponse,
  ): Promise<void> {
    const identity = request.tenantIdentity;
    if (identity === undefined) throw new UnauthorizedException();
    await this.repository.revokeAllSessions(identity, requestId(request));
    response.setHeader("Set-Cookie", serializeClearedTenantSessionCookie(this.options.cookie));
  }

  @Post("tenants/:tenantSlug/password-reset/request")
  @HttpCode(202)
  @UseGuards(TenantOriginGuard)
  async requestReset(
    @Param("tenantSlug") rawSlug: string,
    @Body() rawBody: unknown,
    @Req() request: TenantRequest,
  ): Promise<{ message: string }> {
    requireJson(request);
    const value = plainObject(rawBody);
    exactKeys(value, ["email"]);
    const slug = normalizeTenantSlug(rawSlug);
    const email = parseEmail(value.email);
    this.limiter.assertAllowed("reset-request", `${slug}:${email}:${request.ip ?? "unknown"}`, 5);
    await this.service.requestPasswordReset(slug, email, requestId(request));
    return { message: "If the account is eligible, reset instructions will be sent." };
  }

  @Post("tenants/:tenantSlug/password-reset/confirm")
  @HttpCode(204)
  @UseGuards(TenantOriginGuard)
  async confirmReset(
    @Param("tenantSlug") rawSlug: string,
    @Body() rawBody: unknown,
    @Req() request: TenantRequest,
  ): Promise<void> {
    requireJson(request);
    const value = plainObject(rawBody);
    exactKeys(value, ["token", "newPassword"]);
    if (
      typeof value.token !== "string" ||
      value.token.length > 256 ||
      typeof value.newPassword !== "string"
    ) {
      throw new BadRequestException("Invalid request");
    }
    const slug = normalizeTenantSlug(rawSlug);
    this.limiter.assertAllowed(
      "reset-confirm",
      `${slug}:${hashOpaqueToken(value.token).toString("hex")}:${request.ip ?? "unknown"}`,
      10,
    );
    await this.service.confirmPasswordReset(
      slug,
      value.token,
      value.newPassword,
      requestId(request),
    );
  }
}
