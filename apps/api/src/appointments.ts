import { randomUUID } from "node:crypto";
import {
  applyDecorators,
  BadRequestException,
  Body,
  Controller,
  Delete,
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
  UseGuards,
} from "@nestjs/common";
import {
  type AppointmentAvailabilityRuleInput,
  type AppointmentAvailabilityRuleListFilters,
  type AppointmentAvailabilityRuleManagerDatabase,
  AppointmentAvailabilityRuleNotFoundError,
  type AppointmentAvailabilityRulePatch,
  AppointmentAvailabilityRuleValidationError,
  type AppointmentResourceInput,
  type AppointmentResourceListFilters,
  type AppointmentResourceManagerDatabase,
  type AppointmentResourceMutationMetadata,
  AppointmentResourceNotFoundError,
  type AppointmentResourcePatch,
  AppointmentResourceType,
  AppointmentResourceValidationError,
  type AppointmentServiceInput,
  type AppointmentServiceListFilters,
  type AppointmentServiceManagerDatabase,
  type AppointmentServiceMutationMetadata,
  AppointmentServiceNotFoundError,
  type AppointmentServicePatch,
  AppointmentServiceValidationError,
  archiveAppointmentResource,
  archiveAppointmentService,
  createAppointmentResource,
  createAppointmentService,
  createAvailabilityRule,
  deleteAvailabilityRule,
  getAppointmentResourceById,
  getAppointmentServiceById,
  getAvailabilityRuleById,
  listAppointmentResources,
  listAppointmentServices,
  listAvailabilityRules,
  type TenantContext,
  TenantNotOperationalError,
  updateAppointmentResource,
  updateAppointmentService,
  updateAvailabilityRule,
} from "@whatsapp-platform/database";
import type { PermissionKey } from "@whatsapp-platform/rbac";
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

export const APPOINTMENTS_DATABASE = Symbol("APPOINTMENTS_DATABASE");

type ApiResponse<T> = Readonly<{ success: true; data: T }>;

export interface AppointmentServicesQuery {
  readonly active?: string | undefined;
  readonly organizationUnitId?: string | undefined;
  readonly search?: string | undefined;
  readonly limit?: string | undefined;
  readonly offset?: string | undefined;
}

export interface AppointmentResourcesQuery extends AppointmentServicesQuery {
  readonly type?: string | undefined;
  readonly userId?: string | undefined;
}

export interface AppointmentAvailabilityRulesQuery {
  readonly resourceId?: unknown;
  readonly dayOfWeek?: unknown;
  readonly active?: unknown;
  readonly limit?: unknown;
  readonly offset?: unknown;
}

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPOINTMENT_RESOURCE_TYPES = new Set<string>(Object.values(AppointmentResourceType));

function appointmentsAuthorized(...permissions: PermissionKey[]): MethodDecorator & ClassDecorator {
  return applyDecorators(
    RequirePermissions(...permissions),
    UseGuards(
      TenantUserSessionGuard,
      TenantContextGuard,
      TenantPermissionGuard,
      TenantEntitlementGuard,
    ),
  );
}

function requestId(request: TenantAuthenticationRequest): string {
  const header = request.headers["x-request-id"];
  const value = Array.isArray(header) ? header[0] : header;
  return value !== undefined && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : randomUUID();
}

function plainObject(
  value: unknown,
  message = "Invalid appointment service request",
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(message);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  message = "Invalid appointment service request",
): void {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) {
    throw new BadRequestException(message);
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new BadRequestException(`${field} must be a string`);
  return value;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new BadRequestException(`${field} must be an integer`);
  }
  return value;
}

function optionalInteger(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : integer(value, field);
}

function optionalPrice(value: unknown): AppointmentServiceInput["price"] {
  if (value === undefined || value === null) return value;
  if (typeof value === "number" || typeof value === "string") return value;
  throw new BadRequestException("price must be a number, string, or null");
}

function optionalOrganizationUnitId(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) {
    throw new BadRequestException("organizationUnitId must be a UUIDv7 or null");
  }
  return value;
}

function settingsObject(value: unknown): Record<string, unknown> {
  return plainObject(value);
}

function resourceMetadata(value: unknown): Record<string, unknown> {
  return plainObject(value, "Invalid appointment resource request");
}

function optionalResourceForeignKey(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) {
    throw new BadRequestException(`${field} must be a UUIDv7 or null`);
  }
  return value;
}

function resourceType(value: unknown): AppointmentResourceType {
  if (typeof value !== "string" || !APPOINTMENT_RESOURCE_TYPES.has(value)) {
    throw new BadRequestException("type must be a supported appointment resource type");
  }
  return value as AppointmentResourceType;
}

function parseCreateResourceBody(value: unknown): AppointmentResourceInput {
  const body = plainObject(value, "Invalid appointment resource request");
  exactKeys(
    body,
    ["name", "type", "description", "capacity", "organizationUnitId", "userId", "metadata"],
    "Invalid appointment resource request",
  );
  if (
    body.description !== undefined &&
    body.description !== null &&
    typeof body.description !== "string"
  ) {
    throw new BadRequestException("description must be a string or null");
  }
  return {
    name: requiredString(body.name, "name"),
    ...(body.type === undefined ? {} : { type: resourceType(body.type) }),
    ...(body.description === undefined ? {} : { description: body.description as string | null }),
    ...(body.capacity === undefined ? {} : { capacity: integer(body.capacity, "capacity") }),
    ...(body.organizationUnitId === undefined
      ? {}
      : {
          organizationUnitId: optionalResourceForeignKey(
            body.organizationUnitId,
            "organizationUnitId",
          ) as string | null,
        }),
    ...(body.userId === undefined
      ? {}
      : { userId: optionalResourceForeignKey(body.userId, "userId") as string | null }),
    ...(body.metadata === undefined ? {} : { metadata: resourceMetadata(body.metadata) }),
  };
}

function parseResourcePatchBody(value: unknown): AppointmentResourcePatch {
  const body = plainObject(value, "Invalid appointment resource request");
  exactKeys(
    body,
    [
      "name",
      "type",
      "description",
      "capacity",
      "organizationUnitId",
      "userId",
      "active",
      "metadata",
    ],
    "Invalid appointment resource request",
  );
  if (
    body.description !== undefined &&
    body.description !== null &&
    typeof body.description !== "string"
  ) {
    throw new BadRequestException("description must be a string or null");
  }
  if (body.active !== undefined && typeof body.active !== "boolean") {
    throw new BadRequestException("active must be a boolean");
  }
  return {
    ...(body.name === undefined ? {} : { name: requiredString(body.name, "name") }),
    ...(body.type === undefined ? {} : { type: resourceType(body.type) }),
    ...(body.description === undefined ? {} : { description: body.description as string | null }),
    ...(body.capacity === undefined ? {} : { capacity: integer(body.capacity, "capacity") }),
    ...(body.organizationUnitId === undefined
      ? {}
      : {
          organizationUnitId: optionalResourceForeignKey(
            body.organizationUnitId,
            "organizationUnitId",
          ) as string | null,
        }),
    ...(body.userId === undefined
      ? {}
      : { userId: optionalResourceForeignKey(body.userId, "userId") as string | null }),
    ...(body.active === undefined ? {} : { active: body.active as boolean }),
    ...(body.metadata === undefined ? {} : { metadata: resourceMetadata(body.metadata) }),
  };
}

function availabilityRuleResourceId(value: unknown): string {
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) {
    throw new BadRequestException("resourceId must be a UUIDv7");
  }
  return value;
}

function optionalAvailabilityDate(
  value: unknown,
  field: "effectiveFrom" | "effectiveTo",
): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${field} must use YYYY-MM-DD or null`);
  }
  return value;
}

function optionalAvailabilityTimezone(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  return requiredString(value, "timezone");
}

function optionalAvailabilityBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new BadRequestException(`${field} must be a boolean`);
  return value;
}

function parseCreateAvailabilityRuleBody(value: unknown): AppointmentAvailabilityRuleInput {
  const body = plainObject(value, "Invalid appointment availability rule request");
  exactKeys(
    body,
    [
      "resourceId",
      "dayOfWeek",
      "startTime",
      "endTime",
      "timezone",
      "effectiveFrom",
      "effectiveTo",
      "capacity",
      "active",
    ],
    "Invalid appointment availability rule request",
  );
  return {
    resourceId: availabilityRuleResourceId(body.resourceId),
    dayOfWeek: integer(body.dayOfWeek, "dayOfWeek"),
    startTime: requiredString(body.startTime, "startTime"),
    endTime: requiredString(body.endTime, "endTime"),
    ...(body.timezone === undefined
      ? {}
      : { timezone: optionalAvailabilityTimezone(body.timezone) as string | null }),
    ...(body.effectiveFrom === undefined
      ? {}
      : {
          effectiveFrom: optionalAvailabilityDate(body.effectiveFrom, "effectiveFrom") as
            | string
            | null,
        }),
    ...(body.effectiveTo === undefined
      ? {}
      : {
          effectiveTo: optionalAvailabilityDate(body.effectiveTo, "effectiveTo") as string | null,
        }),
    ...(body.capacity === undefined ? {} : { capacity: integer(body.capacity, "capacity") }),
    ...(body.active === undefined
      ? {}
      : { active: optionalAvailabilityBoolean(body.active, "active") as boolean }),
  };
}

function parseAvailabilityRulePatchBody(value: unknown): AppointmentAvailabilityRulePatch {
  const body = plainObject(value, "Invalid appointment availability rule request");
  exactKeys(
    body,
    [
      "dayOfWeek",
      "startTime",
      "endTime",
      "timezone",
      "effectiveFrom",
      "effectiveTo",
      "capacity",
      "active",
    ],
    "Invalid appointment availability rule request",
  );
  return {
    ...(body.dayOfWeek === undefined ? {} : { dayOfWeek: integer(body.dayOfWeek, "dayOfWeek") }),
    ...(body.startTime === undefined
      ? {}
      : { startTime: requiredString(body.startTime, "startTime") }),
    ...(body.endTime === undefined ? {} : { endTime: requiredString(body.endTime, "endTime") }),
    ...(body.timezone === undefined
      ? {}
      : { timezone: optionalAvailabilityTimezone(body.timezone) as string | null }),
    ...(body.effectiveFrom === undefined
      ? {}
      : {
          effectiveFrom: optionalAvailabilityDate(body.effectiveFrom, "effectiveFrom") as
            | string
            | null,
        }),
    ...(body.effectiveTo === undefined
      ? {}
      : {
          effectiveTo: optionalAvailabilityDate(body.effectiveTo, "effectiveTo") as string | null,
        }),
    ...(body.capacity === undefined ? {} : { capacity: integer(body.capacity, "capacity") }),
    ...(body.active === undefined
      ? {}
      : { active: optionalAvailabilityBoolean(body.active, "active") as boolean }),
  };
}

function parseCreateBody(value: unknown): AppointmentServiceInput {
  const body = plainObject(value);
  exactKeys(body, [
    "name",
    "description",
    "durationMinutes",
    "bufferBeforeMinutes",
    "bufferAfterMinutes",
    "price",
    "currency",
    "organizationUnitId",
    "settings",
  ]);
  if (
    body.description !== undefined &&
    body.description !== null &&
    typeof body.description !== "string"
  ) {
    throw new BadRequestException("description must be a string or null");
  }
  if (body.currency !== undefined && typeof body.currency !== "string") {
    throw new BadRequestException("currency must be a string");
  }
  return {
    ...(body.bufferAfterMinutes === undefined
      ? {}
      : {
          bufferAfterMinutes: optionalInteger(
            body.bufferAfterMinutes,
            "bufferAfterMinutes",
          ) as number,
        }),
    ...(body.bufferBeforeMinutes === undefined
      ? {}
      : {
          bufferBeforeMinutes: optionalInteger(
            body.bufferBeforeMinutes,
            "bufferBeforeMinutes",
          ) as number,
        }),
    ...(body.currency === undefined ? {} : { currency: body.currency as string }),
    ...(body.description === undefined ? {} : { description: body.description as string | null }),
    durationMinutes: integer(body.durationMinutes, "durationMinutes"),
    name: requiredString(body.name, "name"),
    ...(body.organizationUnitId === undefined
      ? {}
      : {
          organizationUnitId: optionalOrganizationUnitId(body.organizationUnitId) as string | null,
        }),
    ...(body.price === undefined
      ? {}
      : { price: optionalPrice(body.price) as number | string | null }),
    ...(body.settings === undefined ? {} : { settings: settingsObject(body.settings) }),
  };
}

function parsePatchBody(value: unknown): AppointmentServicePatch {
  const body = plainObject(value);
  exactKeys(body, [
    "name",
    "description",
    "durationMinutes",
    "bufferBeforeMinutes",
    "bufferAfterMinutes",
    "price",
    "currency",
    "organizationUnitId",
    "active",
    "settings",
  ]);
  if (
    body.description !== undefined &&
    body.description !== null &&
    typeof body.description !== "string"
  ) {
    throw new BadRequestException("description must be a string or null");
  }
  if (body.currency !== undefined && typeof body.currency !== "string") {
    throw new BadRequestException("currency must be a string");
  }
  if (body.active !== undefined && typeof body.active !== "boolean") {
    throw new BadRequestException("active must be a boolean");
  }
  return {
    ...(body.active === undefined ? {} : { active: body.active as boolean }),
    ...(body.bufferAfterMinutes === undefined
      ? {}
      : {
          bufferAfterMinutes: optionalInteger(
            body.bufferAfterMinutes,
            "bufferAfterMinutes",
          ) as number,
        }),
    ...(body.bufferBeforeMinutes === undefined
      ? {}
      : {
          bufferBeforeMinutes: optionalInteger(
            body.bufferBeforeMinutes,
            "bufferBeforeMinutes",
          ) as number,
        }),
    ...(body.currency === undefined ? {} : { currency: body.currency as string }),
    ...(body.description === undefined ? {} : { description: body.description as string | null }),
    ...(body.durationMinutes === undefined
      ? {}
      : { durationMinutes: optionalInteger(body.durationMinutes, "durationMinutes") as number }),
    ...(body.name === undefined ? {} : { name: requiredString(body.name, "name") }),
    ...(body.organizationUnitId === undefined
      ? {}
      : {
          organizationUnitId: optionalOrganizationUnitId(body.organizationUnitId) as string | null,
        }),
    ...(body.price === undefined
      ? {}
      : { price: optionalPrice(body.price) as number | string | null }),
    ...(body.settings === undefined ? {} : { settings: settingsObject(body.settings) }),
  };
}

function parseActive(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new BadRequestException("active must be true or false");
}

function parseQueryInteger(value: string | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new BadRequestException(`${field} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new BadRequestException(`${field} is out of range`);
  return parsed;
}

function parseSearch(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new BadRequestException("search must be a string");
  return value;
}

function parseListFilters(query: AppointmentServicesQuery): AppointmentServiceListFilters {
  if (query.organizationUnitId !== undefined && !UUID_V7_PATTERN.test(query.organizationUnitId)) {
    throw new BadRequestException("organizationUnitId must be a UUIDv7");
  }
  const search = parseSearch(query.search);
  return {
    ...(query.active === undefined ? {} : { active: parseActive(query.active) as boolean }),
    ...(query.limit === undefined
      ? {}
      : { limit: parseQueryInteger(query.limit, "limit") as number }),
    ...(query.offset === undefined
      ? {}
      : { offset: parseQueryInteger(query.offset, "offset") as number }),
    ...(query.organizationUnitId === undefined
      ? {}
      : { organizationUnitId: query.organizationUnitId }),
    ...(search === undefined ? {} : { search }),
  };
}

function parseResourceListFilters(
  query: AppointmentResourcesQuery,
): AppointmentResourceListFilters {
  if (query.organizationUnitId !== undefined && !UUID_V7_PATTERN.test(query.organizationUnitId)) {
    throw new BadRequestException("organizationUnitId must be a UUIDv7");
  }
  if (query.userId !== undefined && !UUID_V7_PATTERN.test(query.userId)) {
    throw new BadRequestException("userId must be a UUIDv7");
  }
  const search = parseSearch(query.search);
  return {
    ...(query.active === undefined ? {} : { active: parseActive(query.active) as boolean }),
    ...(query.limit === undefined
      ? {}
      : { limit: parseQueryInteger(query.limit, "limit") as number }),
    ...(query.offset === undefined
      ? {}
      : { offset: parseQueryInteger(query.offset, "offset") as number }),
    ...(query.organizationUnitId === undefined
      ? {}
      : { organizationUnitId: query.organizationUnitId }),
    ...(query.userId === undefined ? {} : { userId: query.userId }),
    ...(search === undefined ? {} : { search }),
    ...(query.type === undefined ? {} : { type: resourceType(query.type) }),
  };
}

function parseAvailabilityQueryInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new BadRequestException(`${field} must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new BadRequestException(`${field} is out of range`);
  return parsed;
}

function parseAvailabilityRuleListFilters(
  query: AppointmentAvailabilityRulesQuery,
): AppointmentAvailabilityRuleListFilters {
  const raw = plainObject(query, "Invalid appointment availability rule query");
  exactKeys(
    raw,
    ["resourceId", "dayOfWeek", "active", "limit", "offset"],
    "Invalid appointment availability rule query",
  );
  const resourceId =
    query.resourceId === undefined ? undefined : availabilityRuleResourceId(query.resourceId);
  const dayOfWeek = parseAvailabilityQueryInteger(query.dayOfWeek, "dayOfWeek");
  const limit = parseAvailabilityQueryInteger(query.limit, "limit");
  const offset = parseAvailabilityQueryInteger(query.offset, "offset");
  let active: boolean | undefined;
  if (query.active !== undefined) {
    if (query.active !== "true" && query.active !== "false") {
      throw new BadRequestException("active must be true or false");
    }
    active = query.active === "true";
  }
  return {
    ...(resourceId === undefined ? {} : { resourceId }),
    ...(dayOfWeek === undefined ? {} : { dayOfWeek }),
    ...(active === undefined ? {} : { active }),
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
  };
}

function mapAppointmentError(error: unknown): never {
  if (error instanceof AppointmentAvailabilityRuleNotFoundError) {
    throw new NotFoundException({
      code: "APPOINTMENT_AVAILABILITY_RULE_NOT_FOUND",
      error: "Not Found",
      message: "Appointment availability rule was not found",
      statusCode: 404,
    });
  }
  if (error instanceof AppointmentAvailabilityRuleValidationError) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof AppointmentResourceNotFoundError) {
    throw new NotFoundException({
      code: "APPOINTMENT_RESOURCE_NOT_FOUND",
      error: "Not Found",
      message: "Appointment resource was not found",
      statusCode: 404,
    });
  }
  if (error instanceof AppointmentResourceValidationError) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof AppointmentServiceNotFoundError) {
    throw new NotFoundException({
      code: "APPOINTMENT_SERVICE_NOT_FOUND",
      error: "Not Found",
      message: "Appointment service was not found",
      statusCode: 404,
    });
  }
  if (error instanceof AppointmentServiceValidationError) {
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
  throw error;
}

@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(APPOINTMENTS_DATABASE)
    private readonly database: AppointmentServiceManagerDatabase &
      AppointmentResourceManagerDatabase &
      AppointmentAvailabilityRuleManagerDatabase,
  ) {}

  async create(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    input: AppointmentServiceInput,
  ) {
    try {
      const metadata: AppointmentServiceMutationMetadata = {
        actorUserId: identity.userId,
        requestId: requestId(request),
      };
      return await createAppointmentService(context, this.database, input, metadata);
    } catch (error) {
      return mapAppointmentError(error);
    }
  }

  async list(context: TenantContext, filters: AppointmentServiceListFilters) {
    try {
      return await listAppointmentServices(context, this.database, filters);
    } catch (error) {
      return mapAppointmentError(error);
    }
  }

  async get(context: TenantContext, id: string) {
    try {
      return await getAppointmentServiceById(context, this.database, id);
    } catch (error) {
      return mapAppointmentError(error);
    }
  }

  async update(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    id: string,
    patch: AppointmentServicePatch,
  ) {
    try {
      return await updateAppointmentService(context, this.database, id, patch, {
        actorUserId: identity.userId,
        requestId: requestId(request),
      });
    } catch (error) {
      return mapAppointmentError(error);
    }
  }

  async archive(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    id: string,
  ) {
    try {
      return await archiveAppointmentService(context, this.database, id, {
        actorUserId: identity.userId,
        requestId: requestId(request),
      });
    } catch (error) {
      return mapAppointmentError(error);
    }
  }

  async createResource(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    input: AppointmentResourceInput,
  ) {
    try {
      const mutationMetadata: AppointmentResourceMutationMetadata = {
        actorUserId: identity.userId,
        requestId: requestId(request),
      };
      return await createAppointmentResource(context, this.database, input, mutationMetadata);
    } catch (error) {
      return mapAppointmentError(error);
    }
  }

  async listResources(context: TenantContext, filters: AppointmentResourceListFilters) {
    try {
      return await listAppointmentResources(context, this.database, filters);
    } catch (error) {
      return mapAppointmentError(error);
    }
  }

  async getResource(context: TenantContext, id: string) {
    try {
      return await getAppointmentResourceById(context, this.database, id);
    } catch (error) {
      return mapAppointmentError(error);
    }
  }

  async updateResource(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    id: string,
    patch: AppointmentResourcePatch,
  ) {
    try {
      return await updateAppointmentResource(context, this.database, id, patch, {
        actorUserId: identity.userId,
        requestId: requestId(request),
      });
    } catch (error) {
      return mapAppointmentError(error);
    }
  }

  async archiveResource(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    id: string,
  ) {
    try {
      return await archiveAppointmentResource(context, this.database, id, {
        actorUserId: identity.userId,
        requestId: requestId(request),
      });
    } catch (error) {
      return mapAppointmentError(error);
    }
  }

  async createAvailabilityRule(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    input: AppointmentAvailabilityRuleInput,
  ) {
    try {
      return await createAvailabilityRule(context, this.database, input, {
        actorUserId: identity.userId,
        requestId: requestId(request),
      });
    } catch (error) {
      return mapAppointmentError(error);
    }
  }

  async listAvailabilityRules(
    context: TenantContext,
    filters: AppointmentAvailabilityRuleListFilters,
  ) {
    try {
      return await listAvailabilityRules(context, this.database, filters);
    } catch (error) {
      return mapAppointmentError(error);
    }
  }

  async getAvailabilityRule(context: TenantContext, id: string) {
    try {
      return await getAvailabilityRuleById(context, this.database, id);
    } catch (error) {
      return mapAppointmentError(error);
    }
  }

  async updateAvailabilityRule(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    id: string,
    patch: AppointmentAvailabilityRulePatch,
  ) {
    try {
      return await updateAvailabilityRule(context, this.database, id, patch, {
        actorUserId: identity.userId,
        requestId: requestId(request),
      });
    } catch (error) {
      return mapAppointmentError(error);
    }
  }

  async deleteAvailabilityRule(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    id: string,
  ) {
    try {
      return await deleteAvailabilityRule(context, this.database, id, {
        actorUserId: identity.userId,
        requestId: requestId(request),
      });
    } catch (error) {
      return mapAppointmentError(error);
    }
  }
}

function appointmentServiceId(value: string): string {
  if (!UUID_V7_PATTERN.test(value)) throw new BadRequestException("Invalid appointment service id");
  return value;
}

function appointmentResourceId(value: string): string {
  if (!UUID_V7_PATTERN.test(value))
    throw new BadRequestException("Invalid appointment resource id");
  return value;
}

function appointmentAvailabilityRuleId(value: string): string {
  if (!UUID_V7_PATTERN.test(value)) {
    throw new BadRequestException("Invalid appointment availability rule id");
  }
  return value;
}

@Controller("api/v1/appointments")
@RequireEntitlements("module.appointments")
export class AppointmentsController {
  constructor(private readonly service: AppointmentsService) {}

  @Post("services")
  @HttpCode(201)
  @appointmentsAuthorized("appointments.manage")
  async create(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<ApiResponse<Awaited<ReturnType<AppointmentsService["create"]>>>> {
    const data = await this.service.create(context, identity, request, parseCreateBody(body));
    return { success: true, data };
  }

  @Get("services")
  @appointmentsAuthorized("appointments.read")
  async list(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: AppointmentServicesQuery,
  ): Promise<ApiResponse<Awaited<ReturnType<AppointmentsService["list"]>>>> {
    const data = await this.service.list(context, parseListFilters(query));
    return { success: true, data };
  }

  @Get("services/:id")
  @appointmentsAuthorized("appointments.read")
  async get(
    @CurrentTenantContext() context: TenantContext,
    @Param("id") rawId: string,
  ): Promise<ApiResponse<Awaited<ReturnType<AppointmentsService["get"]>>>> {
    const data = await this.service.get(context, appointmentServiceId(rawId));
    return { success: true, data };
  }

  @Patch("services/:id")
  @appointmentsAuthorized("appointments.manage")
  async update(
    @Param("id") rawId: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<ApiResponse<Awaited<ReturnType<AppointmentsService["update"]>>>> {
    const data = await this.service.update(
      context,
      identity,
      request,
      appointmentServiceId(rawId),
      parsePatchBody(body),
    );
    return { success: true, data };
  }

  @Delete("services/:id")
  @appointmentsAuthorized("appointments.manage")
  async archive(
    @Param("id") rawId: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
  ): Promise<ApiResponse<Awaited<ReturnType<AppointmentsService["archive"]>>>> {
    const data = await this.service.archive(
      context,
      identity,
      request,
      appointmentServiceId(rawId),
    );
    return { success: true, data };
  }

  @Post("resources")
  @HttpCode(201)
  @appointmentsAuthorized("appointments.manage")
  async createResource(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<ApiResponse<Awaited<ReturnType<AppointmentsService["createResource"]>>>> {
    const data = await this.service.createResource(
      context,
      identity,
      request,
      parseCreateResourceBody(body),
    );
    return { success: true, data };
  }

  @Get("resources")
  @appointmentsAuthorized("appointments.read")
  async listResources(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: AppointmentResourcesQuery,
  ): Promise<ApiResponse<Awaited<ReturnType<AppointmentsService["listResources"]>>>> {
    const data = await this.service.listResources(context, parseResourceListFilters(query));
    return { success: true, data };
  }

  @Get("resources/:id")
  @appointmentsAuthorized("appointments.read")
  async getResource(
    @CurrentTenantContext() context: TenantContext,
    @Param("id") rawId: string,
  ): Promise<ApiResponse<Awaited<ReturnType<AppointmentsService["getResource"]>>>> {
    const data = await this.service.getResource(context, appointmentResourceId(rawId));
    return { success: true, data };
  }

  @Patch("resources/:id")
  @appointmentsAuthorized("appointments.manage")
  async updateResource(
    @Param("id") rawId: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<ApiResponse<Awaited<ReturnType<AppointmentsService["updateResource"]>>>> {
    const data = await this.service.updateResource(
      context,
      identity,
      request,
      appointmentResourceId(rawId),
      parseResourcePatchBody(body),
    );
    return { success: true, data };
  }

  @Delete("resources/:id")
  @appointmentsAuthorized("appointments.manage")
  async archiveResource(
    @Param("id") rawId: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
  ): Promise<ApiResponse<Awaited<ReturnType<AppointmentsService["archiveResource"]>>>> {
    const data = await this.service.archiveResource(
      context,
      identity,
      request,
      appointmentResourceId(rawId),
    );
    return { success: true, data };
  }

  @Post("availability-rules")
  @HttpCode(201)
  @appointmentsAuthorized("appointments.manage")
  async createAvailabilityRule(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<ApiResponse<Awaited<ReturnType<AppointmentsService["createAvailabilityRule"]>>>> {
    const data = await this.service.createAvailabilityRule(
      context,
      identity,
      request,
      parseCreateAvailabilityRuleBody(body),
    );
    return { success: true, data };
  }

  @Get("availability-rules")
  @appointmentsAuthorized("appointments.read")
  async listAvailabilityRules(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: AppointmentAvailabilityRulesQuery,
  ): Promise<ApiResponse<Awaited<ReturnType<AppointmentsService["listAvailabilityRules"]>>>> {
    const data = await this.service.listAvailabilityRules(
      context,
      parseAvailabilityRuleListFilters(query),
    );
    return { success: true, data };
  }

  @Get("availability-rules/:id")
  @appointmentsAuthorized("appointments.read")
  async getAvailabilityRule(
    @CurrentTenantContext() context: TenantContext,
    @Param("id") rawId: string,
  ): Promise<ApiResponse<Awaited<ReturnType<AppointmentsService["getAvailabilityRule"]>>>> {
    const data = await this.service.getAvailabilityRule(
      context,
      appointmentAvailabilityRuleId(rawId),
    );
    return { success: true, data };
  }

  @Patch("availability-rules/:id")
  @appointmentsAuthorized("appointments.manage")
  async updateAvailabilityRule(
    @Param("id") rawId: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<ApiResponse<Awaited<ReturnType<AppointmentsService["updateAvailabilityRule"]>>>> {
    const data = await this.service.updateAvailabilityRule(
      context,
      identity,
      request,
      appointmentAvailabilityRuleId(rawId),
      parseAvailabilityRulePatchBody(body),
    );
    return { success: true, data };
  }

  @Delete("availability-rules/:id")
  @appointmentsAuthorized("appointments.manage")
  async deleteAvailabilityRule(
    @Param("id") rawId: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
  ): Promise<ApiResponse<Awaited<ReturnType<AppointmentsService["deleteAvailabilityRule"]>>>> {
    const data = await this.service.deleteAvailabilityRule(
      context,
      identity,
      request,
      appointmentAvailabilityRuleId(rawId),
    );
    return { success: true, data };
  }
}
