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
  Post,
  Req,
  Res,
  UnauthorizedException,
  UnsupportedMediaTypeException,
  UseGuards,
} from "@nestjs/common";
import {
  generatePlatformSessionToken,
  hashPlatformClientAddress,
  hashPlatformSessionToken,
  normalizePlatformAdminEmail,
  PLATFORM_SESSION_ABSOLUTE_TTL_MS,
  PLATFORM_SESSION_IDLE_TTL_MS,
  PLATFORM_SESSION_TOUCH_INTERVAL_MS,
  type PlatformCookieConfig,
  PlatformPasswordHasher,
  readCookie,
  serializeClearedPlatformSessionCookie,
  serializePlatformSessionCookie,
} from "@whatsapp-platform/auth";
import type {
  PlatformAdminProfile,
  PlatformAuthRepository,
  PlatformSessionIdentity,
} from "@whatsapp-platform/database/platform";

export const PLATFORM_AUTH_REPOSITORY = Symbol("PLATFORM_AUTH_REPOSITORY");
export const PLATFORM_AUTH_OPTIONS = Symbol("PLATFORM_AUTH_OPTIONS");

export type PlatformAuthOptions = Readonly<{
  cookie: PlatformCookieConfig;
  webOrigin: string;
}>;

type ApiRequest = {
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  platformIdentity?: PlatformSessionIdentity;
};

type ApiResponse = {
  setHeader(name: string, value: string): void;
};

function header(request: ApiRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function requestId(request: ApiRequest): string {
  const supplied = header(request, "x-request-id");
  return supplied !== undefined && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
    ? supplied
    : randomUUID();
}

@Injectable()
export class PlatformOriginGuard implements CanActivate {
  constructor(@Inject(PLATFORM_AUTH_OPTIONS) private readonly options: PlatformAuthOptions) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    if (header(request, "origin") !== this.options.webOrigin) {
      throw new ForbiddenException("Invalid request origin");
    }
    return true;
  }
}

@Injectable()
export class PlatformLoginRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  assertAllowed(key: string, now = Date.now()): void {
    const cutoff = now - 60_000;
    const recent = (this.attempts.get(key) ?? []).filter((value) => value > cutoff);
    if (recent.length >= 10) {
      throw new HttpException("Too many login attempts", HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.attempts.set(key, recent);
  }
}

@Injectable()
export class PlatformAdminSessionGuard implements CanActivate {
  constructor(
    @Inject(PLATFORM_AUTH_REPOSITORY) private readonly repository: PlatformAuthRepository,
    @Inject(PLATFORM_AUTH_OPTIONS) private readonly options: PlatformAuthOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const token = readCookie(header(request, "cookie"), this.options.cookie.name);
    if (token === null) throw new UnauthorizedException("Authentication required");

    const identity = await this.repository.findSessionByTokenHash(hashPlatformSessionToken(token));
    const now = new Date();
    if (
      identity === null ||
      identity.revokedAt !== null ||
      identity.adminStatus !== "active" ||
      identity.expiresAt.getTime() <= now.getTime() ||
      now.getTime() - identity.lastSeenAt.getTime() > PLATFORM_SESSION_IDLE_TTL_MS
    ) {
      throw new UnauthorizedException("Authentication required");
    }
    if (now.getTime() - identity.lastSeenAt.getTime() >= PLATFORM_SESSION_TOUCH_INTERVAL_MS) {
      await this.repository.touchSession(identity.sessionId, now);
    }
    request.platformIdentity = identity;
    return true;
  }
}

@Injectable()
export class PlatformAdminLogoutGuard implements CanActivate {
  constructor(
    @Inject(PLATFORM_AUTH_REPOSITORY) private readonly repository: PlatformAuthRepository,
    @Inject(PLATFORM_AUTH_OPTIONS) private readonly options: PlatformAuthOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const token = readCookie(header(request, "cookie"), this.options.cookie.name);
    if (token === null) throw new UnauthorizedException("Authentication required");
    const identity = await this.repository.findSessionByTokenHash(hashPlatformSessionToken(token));
    if (identity === null) throw new UnauthorizedException("Authentication required");
    request.platformIdentity = identity;
    return true;
  }
}

@Injectable()
export class PlatformAuthService {
  private readonly hasher = new PlatformPasswordHasher();
  private readonly dummyHash = this.hasher.hash("invalid account password sentinel");

  constructor(
    @Inject(PLATFORM_AUTH_REPOSITORY) private readonly repository: PlatformAuthRepository,
  ) {}

  async login(
    email: string,
    password: string,
    metadata: { deviceLabel?: string; ip?: string; requestId: string },
  ): Promise<{ profile: PlatformAdminProfile; token: string }> {
    const normalizedEmail = normalizePlatformAdminEmail(email);
    const record = await this.repository.findAdminByNormalizedEmail(normalizedEmail);
    const valid = await this.hasher.verify(
      record?.passwordHash ?? (await this.dummyHash),
      password,
    );
    if (!valid || record?.status !== "active") {
      throw new UnauthorizedException("Invalid email or password");
    }

    const token = generatePlatformSessionToken();
    const profile = await this.repository.createLoginSession({
      ...(metadata.deviceLabel !== undefined ? { deviceLabel: metadata.deviceLabel } : {}),
      expiresAt: new Date(Date.now() + PLATFORM_SESSION_ABSOLUTE_TTL_MS),
      ...(metadata.ip !== undefined ? { ipHash: hashPlatformClientAddress(metadata.ip) } : {}),
      platformAdminId: record.id,
      requestId: metadata.requestId,
      tokenHash: hashPlatformSessionToken(token),
    });
    return { profile, token };
  }
}

export class PlatformAdminLoginDto {
  constructor(
    readonly email: string,
    readonly password: string,
    readonly deviceLabel?: string,
  ) {}
}

function parseLoginBody(body: unknown): PlatformAdminLoginDto {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestException("Invalid login request");
  }
  const value = body as Record<string, unknown>;
  const allowed = new Set(["email", "password", "deviceLabel"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new BadRequestException("Invalid login request");
  }
  if (typeof value.email !== "string" || typeof value.password !== "string") {
    throw new BadRequestException("Invalid login request");
  }
  if (value.deviceLabel !== undefined && typeof value.deviceLabel !== "string") {
    throw new BadRequestException("Invalid login request");
  }
  if (
    value.email.length > 320 ||
    value.password.length > 128 ||
    (typeof value.deviceLabel === "string" && value.deviceLabel.length > 200)
  ) {
    throw new BadRequestException("Invalid login request");
  }
  const email = normalizePlatformAdminEmail(value.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("Invalid login request");
  }
  return new PlatformAdminLoginDto(email, value.password, value.deviceLabel);
}

@Controller("platform/auth")
export class PlatformAuthController {
  constructor(
    private readonly service: PlatformAuthService,
    private readonly limiter: PlatformLoginRateLimiter,
    @Inject(PLATFORM_AUTH_REPOSITORY) private readonly repository: PlatformAuthRepository,
    @Inject(PLATFORM_AUTH_OPTIONS) private readonly options: PlatformAuthOptions,
  ) {}

  @Post("login")
  @HttpCode(200)
  @UseGuards(PlatformOriginGuard)
  async login(
    @Body() rawBody: unknown,
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: ApiResponse,
  ): Promise<{ admin: PlatformAdminProfile }> {
    const contentType = header(request, "content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      throw new UnsupportedMediaTypeException("Content-Type must be application/json");
    }
    const body = parseLoginBody(rawBody);
    this.limiter.assertAllowed(`email:${normalizePlatformAdminEmail(body.email)}`);
    if (request.ip !== undefined) this.limiter.assertAllowed(`ip:${request.ip}`);
    const result = await this.service.login(body.email, body.password, {
      ...(body.deviceLabel !== undefined ? { deviceLabel: body.deviceLabel } : {}),
      ...(request.ip !== undefined ? { ip: request.ip } : {}),
      requestId: requestId(request),
    });
    response.setHeader(
      "Set-Cookie",
      serializePlatformSessionCookie(result.token, this.options.cookie),
    );
    return { admin: result.profile };
  }

  @Get("me")
  @UseGuards(PlatformAdminSessionGuard)
  me(@Req() request: ApiRequest): { admin: PlatformAdminProfile } {
    if (request.platformIdentity === undefined) throw new UnauthorizedException();
    return { admin: request.platformIdentity.admin };
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(PlatformOriginGuard, PlatformAdminLogoutGuard)
  async logout(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: ApiResponse,
  ): Promise<void> {
    const identity = request.platformIdentity;
    if (identity === undefined) throw new UnauthorizedException();
    if (identity.revokedAt === null) {
      await this.repository.revokeSession(
        identity.sessionId,
        identity.admin.id,
        requestId(request),
      );
    }
    response.setHeader("Set-Cookie", serializeClearedPlatformSessionCookie(this.options.cookie));
  }
}
