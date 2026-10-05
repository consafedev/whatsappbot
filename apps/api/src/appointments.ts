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
  type AppointmentServiceInput,
  type AppointmentServiceListFilters,
  type AppointmentServiceManagerDatabase,
  type AppointmentServiceMutationMetadata,
  AppointmentServiceNotFoundError,
  type AppointmentServicePatch,
  AppointmentServiceValidationError,
  archiveAppointmentService,
  createAppointmentService,
  getAppointmentServiceById,
  listAppointmentServices,
  type TenantContext,
  TenantNotOperationalError,
  updateAppointmentService,
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

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function plainObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Invalid appointment service request");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) {
    throw new BadRequestException("Invalid appointment service request");
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

function parseListFilters(query: AppointmentServicesQuery): AppointmentServiceListFilters {
  if (query.organizationUnitId !== undefined && !UUID_V7_PATTERN.test(query.organizationUnitId)) {
    throw new BadRequestException("organizationUnitId must be a UUIDv7");
  }
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
    ...(query.search === undefined ? {} : { search: query.search }),
  };
}

function mapAppointmentServiceError(error: unknown): never {
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
    private readonly database: AppointmentServiceManagerDatabase,
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
      return mapAppointmentServiceError(error);
    }
  }

  async list(context: TenantContext, filters: AppointmentServiceListFilters) {
    try {
      return await listAppointmentServices(context, this.database, filters);
    } catch (error) {
      return mapAppointmentServiceError(error);
    }
  }

  async get(context: TenantContext, id: string) {
    try {
      return await getAppointmentServiceById(context, this.database, id);
    } catch (error) {
      return mapAppointmentServiceError(error);
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
      return mapAppointmentServiceError(error);
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
      return mapAppointmentServiceError(error);
    }
  }
}

function appointmentServiceId(value: string): string {
  if (!UUID_V7_PATTERN.test(value)) throw new BadRequestException("Invalid appointment service id");
  return value;
}

@Controller("api/v1/appointments/services")
@RequireEntitlements("module.appointments")
export class AppointmentsController {
  constructor(private readonly service: AppointmentsService) {}

  @Post()
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

  @Get()
  @appointmentsAuthorized("appointments.read")
  async list(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: AppointmentServicesQuery,
  ): Promise<ApiResponse<Awaited<ReturnType<AppointmentsService["list"]>>>> {
    const data = await this.service.list(context, parseListFilters(query));
    return { success: true, data };
  }

  @Get(":id")
  @appointmentsAuthorized("appointments.read")
  async get(
    @CurrentTenantContext() context: TenantContext,
    @Param("id") rawId: string,
  ): Promise<ApiResponse<Awaited<ReturnType<AppointmentsService["get"]>>>> {
    const data = await this.service.get(context, appointmentServiceId(rawId));
    return { success: true, data };
  }

  @Patch(":id")
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

  @Delete(":id")
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
}
