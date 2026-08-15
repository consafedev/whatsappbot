import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import type {
  OrganizationUnitCreateInput,
  OrganizationUnitItem,
  OrganizationUnitManager,
  OrganizationUnitTreePage,
  OrganizationUnitType,
  OrganizationUnitUpdateInput,
  TenantContext,
} from "@whatsapp-platform/database";
import {
  OrganizationUnitCompanyTypeReservedError,
  OrganizationUnitCycleError,
  OrganizationUnitDepthError,
  OrganizationUnitLimitReachedError,
  OrganizationUnitNotFoundError,
  OrganizationUnitParentNotFoundError,
  OrganizationUnitRootInvariantError,
} from "@whatsapp-platform/database";
import {
  CurrentTenantContext,
  CurrentTenantIdentity,
  type TenantAuthenticationRequest,
  type TenantSessionIdentity,
} from "./tenant-context";
import { TenantAuthorized } from "./tenant-rbac";

export const ORGANIZATION_UNIT_MANAGER = Symbol("ORGANIZATION_UNIT_MANAGER");

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORGANIZATION_UNIT_TYPES = new Set<string>([
  "company",
  "branch",
  "department",
  "team",
  "other",
]);

function requestId(request: TenantAuthenticationRequest): string {
  const value = request.headers["x-request-id"];
  const header = Array.isArray(value) ? value[0] : value;
  return header !== undefined && /^[A-Za-z0-9._:-]{1,128}$/.test(header) ? header : randomUUID();
}

function plainObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Invalid organization unit request");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) {
    throw new BadRequestException("Invalid organization unit request");
  }
}

function organizationUnitType(value: unknown): OrganizationUnitType {
  if (typeof value !== "string" || !ORGANIZATION_UNIT_TYPES.has(value)) {
    throw new BadRequestException("Invalid organization unit type");
  }
  return value as OrganizationUnitType;
}

function organizationUnitName(value: unknown): string {
  if (typeof value !== "string") {
    throw new BadRequestException("Invalid organization unit name");
  }
  const result = value.trim();
  if (result.length === 0 || result.length > 120) {
    throw new BadRequestException("Invalid organization unit name");
  }
  return result;
}

function organizationUnitCode(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException("Invalid organization unit code");
  }
  const result = value.trim();
  if (result.length > 40) {
    throw new BadRequestException("Invalid organization unit code");
  }
  return result.length === 0 ? null : result;
}

function organizationUnitTimezone(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException("Invalid organization unit timezone");
  }
  const result = value.trim();
  if (result.length === 0 || result.length > 100) {
    throw new BadRequestException("Invalid organization unit timezone");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: result }).format(new Date(0));
  } catch {
    throw new BadRequestException("Invalid organization unit timezone");
  }
  return result;
}

function organizationUnitParentId(value: unknown): string {
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) {
    throw new BadRequestException("Invalid organization unit parent");
  }
  return value.toLowerCase();
}

function organizationUnitActive(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new BadRequestException("Invalid organization unit active flag");
  }
  return value;
}

function parseCreate(body: unknown): OrganizationUnitCreateInput {
  const value = plainObject(body);
  exactKeys(value, ["parentId", "type", "name", "code", "timezone", "active"]);
  const input: OrganizationUnitCreateInput = {
    name: organizationUnitName(value.name),
    parentId: organizationUnitParentId(value.parentId),
    type: organizationUnitType(value.type),
    ...(value.code !== undefined ? { code: organizationUnitCode(value.code) } : {}),
    ...(value.timezone !== undefined ? { timezone: organizationUnitTimezone(value.timezone) } : {}),
    ...(value.active !== undefined ? { active: organizationUnitActive(value.active) } : {}),
  };
  return input;
}

function parseUpdate(body: unknown): OrganizationUnitUpdateInput {
  const value = plainObject(body);
  exactKeys(value, ["parentId", "type", "name", "code", "timezone", "active"]);
  if (Object.keys(value).length === 0) {
    throw new BadRequestException("Invalid organization unit update");
  }
  const input: OrganizationUnitUpdateInput = {
    ...(value.parentId !== undefined
      ? { parentId: value.parentId === null ? null : organizationUnitParentId(value.parentId) }
      : {}),
    ...(value.type !== undefined ? { type: organizationUnitType(value.type) } : {}),
    ...(value.name !== undefined ? { name: organizationUnitName(value.name) } : {}),
    ...(value.code !== undefined ? { code: organizationUnitCode(value.code) } : {}),
    ...(value.timezone !== undefined ? { timezone: organizationUnitTimezone(value.timezone) } : {}),
    ...(value.active !== undefined ? { active: organizationUnitActive(value.active) } : {}),
  };
  return input;
}

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({
    code,
    error: "Conflict",
    message,
    statusCode: 409,
  });
}

function mapError(error: unknown): never {
  if (error instanceof OrganizationUnitNotFoundError) {
    throw new NotFoundException("Organization unit not found");
  }
  if (error instanceof OrganizationUnitParentNotFoundError) {
    throw new NotFoundException("Organization unit parent not found");
  }
  if (error instanceof OrganizationUnitRootInvariantError) {
    throw conflict(
      "ORGANIZATION_UNIT_ROOT_INVARIANT",
      "The structural root unit cannot be moved, deactivated or retyped",
    );
  }
  if (error instanceof OrganizationUnitCycleError) {
    throw conflict("ORGANIZATION_UNIT_CYCLE", "The hierarchy cannot contain cycles");
  }
  if (error instanceof OrganizationUnitDepthError) {
    throw conflict("ORGANIZATION_UNIT_DEPTH_EXCEEDED", "The hierarchy exceeds the maximum depth");
  }
  if (error instanceof OrganizationUnitLimitReachedError) {
    throw conflict(
      "ORGANIZATION_UNIT_LIMIT_REACHED",
      "The organization unit limit for the workspace has been reached",
    );
  }
  if (error instanceof OrganizationUnitCompanyTypeReservedError) {
    throw new BadRequestException("The company type is reserved for the structural root");
  }
  throw error;
}

@Injectable()
export class TenantOrganizationUnitsService {
  constructor(
    @Inject(ORGANIZATION_UNIT_MANAGER) private readonly manager: OrganizationUnitManager,
  ) {}

  list(context: TenantContext): Promise<OrganizationUnitTreePage> {
    return this.manager.list(context);
  }

  async create(
    context: TenantContext,
    identity: TenantSessionIdentity,
    requestIdValue: string,
    body: unknown,
  ): Promise<OrganizationUnitItem> {
    try {
      return await this.manager.create(context, parseCreate(body), {
        actorUserId: identity.userId,
        requestId: requestIdValue,
      });
    } catch (error) {
      return mapError(error);
    }
  }

  async update(
    context: TenantContext,
    identity: TenantSessionIdentity,
    requestIdValue: string,
    unitId: string,
    body: unknown,
  ): Promise<OrganizationUnitItem> {
    if (!UUID_V7_PATTERN.test(unitId)) {
      throw new BadRequestException("Invalid organization unit id");
    }
    try {
      return await this.manager.update(context, unitId, parseUpdate(body), {
        actorUserId: identity.userId,
        requestId: requestIdValue,
      });
    } catch (error) {
      return mapError(error);
    }
  }
}

@Controller("app")
export class TenantOrganizationUnitsController {
  constructor(private readonly service: TenantOrganizationUnitsService) {}

  @Get("organization-units")
  @TenantAuthorized("tenant.settings.manage")
  list(@CurrentTenantContext() context: TenantContext): Promise<OrganizationUnitTreePage> {
    return this.service.list(context);
  }

  @Post("organization-units")
  @HttpCode(201)
  @TenantAuthorized("tenant.settings.manage")
  create(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<OrganizationUnitItem> {
    return this.service.create(context, identity, requestId(request), body);
  }

  @Patch("organization-units/:unitId")
  @TenantAuthorized("tenant.settings.manage")
  update(
    @Param("unitId") unitId: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<OrganizationUnitItem> {
    return this.service.update(context, identity, requestId(request), unitId, body);
  }
}
