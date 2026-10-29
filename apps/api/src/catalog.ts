import { randomUUID } from "node:crypto";
import {
  applyDecorators,
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
  UseGuards,
} from "@nestjs/common";
import {
  archiveCatalogProduct,
  type CatalogMutationMetadata,
  CatalogProductConflictError,
  type CatalogProductInput,
  type CatalogProductListFilters,
  type CatalogProductManagerDatabase,
  CatalogProductNotFoundError,
  type CatalogProductPatch,
  CatalogProductValidationError,
  createCatalogProduct,
  getCatalogProductById,
  listCatalogProducts,
  type TenantContext,
  TenantModuleEntitlementRequiredError,
  TenantNotOperationalError,
  updateCatalogProduct,
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

export const CATALOG_DATABASE = Symbol("CATALOG_DATABASE");
type ApiResponse<T> = Readonly<{ success: true; data: T }>;

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCT_BODY_KEYS = [
  "sku",
  "name",
  "description",
  "category",
  "unit",
  "price",
  "currency",
  "taxCode",
  "taxRate",
  "organizationUnitId",
  "isExceptional",
  "customValues",
] as const;
const PRODUCT_PATCH_KEYS = PRODUCT_BODY_KEYS;
const PRODUCT_QUERY_KEYS = [
  "active",
  "category",
  "cursor",
  "limit",
  "organizationUnitId",
  "search",
] as const;

function catalogAuthorized(...permissions: PermissionKey[]): MethodDecorator & ClassDecorator {
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

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Invalid catalog product request");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) {
    throw new BadRequestException("Invalid catalog product request");
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new BadRequestException(`${field} must be a string`);
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value !== null && typeof value !== "string")
    throw new BadRequestException(`${field} must be a string or null`);
  return value as string | null;
}

function optionalUuid(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || !UUID_V7.test(value)) {
    throw new BadRequestException(`${field} must be a UUIDv7 or null`);
  }
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new BadRequestException(`${field} must be a boolean`);
  return value;
}

function optionalDecimalString(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string")
    throw new BadRequestException(`${field} must be a decimal string or null`);
  return value;
}

function parseProductBody(value: unknown): CatalogProductInput {
  const body = object(value);
  exactKeys(body, PRODUCT_BODY_KEYS);
  return {
    sku: requiredString(body.sku, "sku"),
    name: requiredString(body.name, "name"),
    unit: requiredString(body.unit, "unit"),
    price: requiredString(body.price, "price"),
    currency: requiredString(body.currency, "currency"),
    ...(body.description === undefined
      ? {}
      : { description: nullableString(body.description, "description") }),
    ...(body.category === undefined ? {} : { category: nullableString(body.category, "category") }),
    ...(body.taxCode === undefined ? {} : { taxCode: nullableString(body.taxCode, "taxCode") }),
    ...(body.taxRate === undefined
      ? {}
      : { taxRate: optionalDecimalString(body.taxRate, "taxRate") as string | null }),
    ...(body.organizationUnitId === undefined
      ? {}
      : {
          organizationUnitId: optionalUuid(body.organizationUnitId, "organizationUnitId") as
            | string
            | null,
        }),
    ...(body.isExceptional === undefined
      ? {}
      : { isExceptional: optionalBoolean(body.isExceptional, "isExceptional") as boolean }),
    ...(body.customValues === undefined ? {} : { customValues: body.customValues }),
  };
}

function parseProductPatch(value: unknown): CatalogProductPatch {
  const body = object(value);
  exactKeys(body, PRODUCT_PATCH_KEYS);
  if (Object.keys(body).length === 0)
    throw new BadRequestException("At least one product field must be updated");
  return {
    ...(body.sku === undefined ? {} : { sku: requiredString(body.sku, "sku") }),
    ...(body.name === undefined ? {} : { name: requiredString(body.name, "name") }),
    ...(body.unit === undefined ? {} : { unit: requiredString(body.unit, "unit") }),
    ...(body.price === undefined ? {} : { price: requiredString(body.price, "price") }),
    ...(body.currency === undefined ? {} : { currency: requiredString(body.currency, "currency") }),
    ...(body.description === undefined
      ? {}
      : { description: nullableString(body.description, "description") }),
    ...(body.category === undefined ? {} : { category: nullableString(body.category, "category") }),
    ...(body.taxCode === undefined ? {} : { taxCode: nullableString(body.taxCode, "taxCode") }),
    ...(body.taxRate === undefined
      ? {}
      : { taxRate: optionalDecimalString(body.taxRate, "taxRate") as string | null }),
    ...(body.organizationUnitId === undefined
      ? {}
      : {
          organizationUnitId: optionalUuid(body.organizationUnitId, "organizationUnitId") as
            | string
            | null,
        }),
    ...(body.isExceptional === undefined
      ? {}
      : { isExceptional: optionalBoolean(body.isExceptional, "isExceptional") as boolean }),
    ...(body.customValues === undefined ? {} : { customValues: body.customValues }),
  };
}

function parseQuery(value: unknown): CatalogProductListFilters {
  const query = object(value);
  exactKeys(query, PRODUCT_QUERY_KEYS);
  const stringValue = (field: keyof typeof query): string | undefined => {
    const item = query[field];
    if (item === undefined) return undefined;
    if (typeof item !== "string")
      throw new BadRequestException(`${field} must appear once as a string`);
    return item;
  };
  const activeString = stringValue("active");
  let active: boolean | undefined;
  if (activeString !== undefined) {
    if (activeString !== "true" && activeString !== "false")
      throw new BadRequestException("active must be true or false");
    active = activeString === "true";
  }
  const limitString = stringValue("limit");
  let limit: number | undefined;
  if (limitString !== undefined) {
    if (!/^[1-9]\d{0,2}$/.test(limitString))
      throw new BadRequestException("limit must be an integer from 1 to 100");
    limit = Number.parseInt(limitString, 10);
  }
  const organizationUnitId = stringValue("organizationUnitId");
  if (organizationUnitId !== undefined && !UUID_V7.test(organizationUnitId)) {
    throw new BadRequestException("organizationUnitId must be a UUIDv7");
  }
  const cursor = stringValue("cursor");
  if (cursor !== undefined && !UUID_V7.test(cursor))
    throw new BadRequestException("cursor must be a UUIDv7");
  const category = stringValue("category");
  const search = stringValue("search");
  return {
    ...(active === undefined ? {} : { active }),
    ...(category === undefined ? {} : { category }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit }),
    ...(organizationUnitId === undefined ? {} : { organizationUnitId }),
    ...(search === undefined ? {} : { search }),
  };
}

function parseArchiveBody(body: unknown): void {
  if (body === undefined) return;
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    (Object.getPrototypeOf(body) !== Object.prototype && Object.getPrototypeOf(body) !== null) ||
    Object.keys(body).length > 0
  ) {
    throw new BadRequestException("archive body must be empty");
  }
}

function mapCatalogError(error: unknown): never {
  if (error instanceof CatalogProductValidationError) throw new BadRequestException(error.message);
  if (error instanceof CatalogProductConflictError) throw new ConflictException(error.message);
  if (error instanceof CatalogProductNotFoundError) throw new NotFoundException(error.message);
  if (
    error instanceof TenantModuleEntitlementRequiredError ||
    error instanceof TenantNotOperationalError
  ) {
    throw new ForbiddenException("Tenant is not authorized for this catalog operation");
  }
  throw error;
}

@Injectable()
export class CatalogService {
  constructor(@Inject(CATALOG_DATABASE) private readonly database: CatalogProductManagerDatabase) {}

  async create(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    input: CatalogProductInput,
  ) {
    const metadata: CatalogMutationMetadata = {
      actorUserId: identity.userId,
      requestId: requestId(request),
    };
    try {
      return await createCatalogProduct(context, this.database, input, metadata);
    } catch (error) {
      return mapCatalogError(error);
    }
  }

  async list(context: TenantContext, filters: CatalogProductListFilters) {
    try {
      return await listCatalogProducts(context, this.database, filters);
    } catch (error) {
      return mapCatalogError(error);
    }
  }

  async get(context: TenantContext, id: string) {
    const product = await getCatalogProductById(context, this.database, id);
    if (product === null) throw new NotFoundException("Product was not found");
    return product;
  }

  async update(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    id: string,
    patch: CatalogProductPatch,
  ) {
    try {
      return await updateCatalogProduct(context, this.database, id, patch, {
        actorUserId: identity.userId,
        requestId: requestId(request),
      });
    } catch (error) {
      return mapCatalogError(error);
    }
  }

  async archive(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    id: string,
  ) {
    try {
      return await archiveCatalogProduct(context, this.database, id, {
        actorUserId: identity.userId,
        requestId: requestId(request),
      });
    } catch (error) {
      return mapCatalogError(error);
    }
  }
}

@Controller("api/v1/products")
@RequireEntitlements("module.catalog")
export class CatalogController {
  constructor(private readonly service: CatalogService) {}

  @Post()
  @HttpCode(201)
  @catalogAuthorized("catalog.manage")
  async create(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<ApiResponse<Awaited<ReturnType<CatalogService["create"]>>>> {
    const data = await this.service.create(context, identity, request, parseProductBody(body));
    return { success: true, data };
  }

  @Get()
  @catalogAuthorized("catalog.read")
  async list(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: unknown,
  ): Promise<ApiResponse<Awaited<ReturnType<CatalogService["list"]>>>> {
    const data = await this.service.list(context, parseQuery(query));
    return { success: true, data };
  }

  @Get(":id")
  @catalogAuthorized("catalog.read")
  async get(
    @CurrentTenantContext() context: TenantContext,
    @Param("id") id: string,
  ): Promise<ApiResponse<Awaited<ReturnType<CatalogService["get"]>>>> {
    if (!UUID_V7.test(id)) throw new NotFoundException("Product was not found");
    return { success: true, data: await this.service.get(context, id) };
  }

  @Patch(":id")
  @catalogAuthorized("catalog.manage")
  async update(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ApiResponse<Awaited<ReturnType<CatalogService["update"]>>>> {
    if (!UUID_V7.test(id)) throw new NotFoundException("Product was not found");
    const data = await this.service.update(context, identity, request, id, parseProductPatch(body));
    return { success: true, data };
  }

  @Post(":id/archive")
  @HttpCode(200)
  @catalogAuthorized("catalog.manage")
  async archive(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ApiResponse<Awaited<ReturnType<CatalogService["archive"]>>>> {
    if (!UUID_V7.test(id)) throw new NotFoundException("Product was not found");
    parseArchiveBody(body);
    const data = await this.service.archive(context, identity, request, id);
    return { success: true, data };
  }
}
