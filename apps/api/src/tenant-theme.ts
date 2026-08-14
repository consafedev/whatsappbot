import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Patch,
  Req,
} from "@nestjs/common";
import type {
  TenantContext,
  TenantTheme,
  TenantThemeRepository,
} from "@whatsapp-platform/database";
import { TenantThemeNotFoundError } from "@whatsapp-platform/database";
import {
  defaultTenantBranding,
  type TenantBranding,
  tenantBrandingSchema,
} from "@whatsapp-platform/themes";
import {
  CurrentTenantContext,
  CurrentTenantIdentity,
  type TenantAuthenticationRequest,
  TenantDataAccessFactory,
  type TenantSessionIdentity,
} from "./tenant-context";
import { TenantAuthorized } from "./tenant-rbac";

export const TENANT_THEME_REPOSITORY = Symbol("TENANT_THEME_REPOSITORY");

@Injectable()
export class TenantThemeService {
  constructor(
    @Inject(TENANT_THEME_REPOSITORY)
    private readonly repository: TenantThemeRepository,
    @Inject(TenantDataAccessFactory)
    private readonly dataAccessFactory: TenantDataAccessFactory,
  ) {}

  private async result<T>(operation: Promise<T>): Promise<T> {
    try {
      return await operation;
    } catch (error) {
      if (error instanceof TenantThemeNotFoundError) {
        throw new NotFoundException("Tenant not found");
      }
      throw error;
    }
  }

  get(context: TenantContext): Promise<TenantTheme> {
    return this.result(this.repository.get(context));
  }

  async update(
    context: TenantContext,
    identity: TenantSessionIdentity,
    requestId: string,
    body: unknown,
  ): Promise<TenantTheme> {
    const branding = normalizeThemePatch(body);
    if (branding.logo !== undefined) {
      const resolver = this.dataAccessFactory.create(context).entitlements;
      if (!(await resolver.isModuleEnabled("module.white_label"))) {
        throw new ForbiddenException({
          code: "ENTITLEMENT_REQUIRED",
          error: "Forbidden",
          message: "Module entitlement required",
          moduleKey: "module.white_label",
          statusCode: 403,
        });
      }
    }
    return this.result(
      this.repository.update(context, branding, {
        actorUserId: identity.userId,
        requestId,
      }),
    );
  }
}

function normalizeThemePatch(body: unknown): TenantBranding {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestException("Invalid request");
  }
  if (Object.keys(body).length === 0) {
    return defaultTenantBranding();
  }
  const parsed = tenantBrandingSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException("Invalid theme configuration");
  }
  return parsed.data;
}

@Controller("app")
export class TenantThemeController {
  constructor(private readonly service: TenantThemeService) {}

  @Get("theme")
  @TenantAuthorized("tenant.settings.manage")
  get(@CurrentTenantContext() context: TenantContext): Promise<TenantTheme> {
    return this.service.get(context);
  }

  @Patch("theme")
  @TenantAuthorized("tenant.settings.manage")
  update(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<TenantTheme> {
    return this.service.update(context, identity, requestId(request), body);
  }
}

function requestId(request: TenantAuthenticationRequest): string {
  const value = request.headers["x-request-id"];
  const header = Array.isArray(value) ? value[0] : value;
  return header !== undefined && /^[A-Za-z0-9._:-]{1,128}$/.test(header) ? header : randomUUID();
}
