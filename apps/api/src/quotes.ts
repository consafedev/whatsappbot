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
  assertTenantModuleEntitled,
  createQuoteDraft,
  getQuoteById,
  listQuotes,
  QuoteAuthorizationError,
  QuoteCommandConflictError,
  type QuoteDraftInput,
  type QuoteDraftPatch,
  type QuoteListFilters,
  type QuoteManagerDatabase,
  QuoteNotFoundError,
  QuoteRevisionConflictError,
  QuoteValidationError,
  type TenantContext,
  TenantModuleEntitlementRequiredError,
  TenantNotOperationalError,
  updateQuoteDraft,
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

export const QUOTES_DATABASE = Symbol("QUOTES_DATABASE");
type ApiResponse<T> = Readonly<{ success: true; data: T }>;

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function quoteAuthorized(...permissions: PermissionKey[]): MethodDecorator & ClassDecorator {
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

function object(value: unknown, field = "request"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new BadRequestException(`Invalid ${field}`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new BadRequestException(`Invalid ${field}`);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new BadRequestException(`${field} contains an unknown field`);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new BadRequestException(`${field} must be a string`);
  return value;
}

function optionalString(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") throw new BadRequestException(`${field} must be a string or null`);
  return value;
}

function uuid(value: unknown, field: string): string {
  const result = requiredString(value, field);
  if (!UUID_V7.test(result)) throw new BadRequestException(`${field} must be a UUIDv7`);
  return result.toLowerCase();
}

function discount(value: unknown): Readonly<{ kind: "fixed" | "percent"; value: string }> {
  const item = object(value, "discount");
  exactKeys(item, ["kind", "value"], "discount");
  if (item.kind !== "fixed" && item.kind !== "percent")
    throw new BadRequestException("discount.kind must be fixed or percent");
  return { kind: item.kind, value: requiredString(item.value, "discount.value") };
}

function parseLine(value: unknown): QuoteDraftInput["lines"][number] {
  const line = object(value, "quote line");
  if (line.productId === null) {
    exactKeys(
      line,
      [
        "productId",
        "sku",
        "description",
        "unit",
        "quantity",
        "unitPrice",
        "currency",
        "taxCode",
        "taxRate",
        "discount",
        "metadata",
      ],
      "manual line",
    );
    return {
      productId: null,
      description: requiredString(line.description, "description"),
      unit: requiredString(line.unit, "unit"),
      quantity: requiredString(line.quantity, "quantity"),
      unitPrice: requiredString(line.unitPrice, "unitPrice"),
      currency: requiredString(line.currency, "currency"),
      ...(line.sku === undefined ? {} : { sku: optionalString(line.sku, "sku") as string | null }),
      ...(line.taxCode === undefined
        ? {}
        : { taxCode: optionalString(line.taxCode, "taxCode") as string | null }),
      ...(line.taxRate === undefined
        ? {}
        : { taxRate: optionalString(line.taxRate, "taxRate") as string | null }),
      ...(line.discount === undefined ? {} : { discount: discount(line.discount) }),
      ...(line.metadata === undefined ? {} : { metadata: line.metadata }),
    };
  }
  exactKeys(line, ["productId", "quantity", "discount"], "catalog line");
  return {
    productId: uuid(line.productId, "productId"),
    quantity: requiredString(line.quantity, "quantity"),
    ...(line.discount === undefined ? {} : { discount: discount(line.discount) }),
  };
}

function parseCreate(value: unknown): QuoteDraftInput {
  const body = object(value);
  exactKeys(
    body,
    [
      "idempotencyKey",
      "organizationUnitId",
      "contactId",
      "currency",
      "lines",
      "validUntil",
      "terms",
      "notes",
      "shippingTotal",
    ],
    "quote request",
  );
  if (!Array.isArray(body.lines)) throw new BadRequestException("lines must be an array");
  return {
    idempotencyKey: requiredString(body.idempotencyKey, "idempotencyKey"),
    organizationUnitId: uuid(body.organizationUnitId, "organizationUnitId"),
    contactId: uuid(body.contactId, "contactId"),
    currency: requiredString(body.currency, "currency"),
    lines: body.lines.map(parseLine),
    ...(body.validUntil === undefined
      ? {}
      : { validUntil: optionalString(body.validUntil, "validUntil") as string | null }),
    ...(body.terms === undefined
      ? {}
      : { terms: optionalString(body.terms, "terms") as string | null }),
    ...(body.notes === undefined
      ? {}
      : { notes: optionalString(body.notes, "notes") as string | null }),
    ...(body.shippingTotal === undefined
      ? {}
      : { shippingTotal: requiredString(body.shippingTotal, "shippingTotal") }),
  };
}

function parsePatch(
  value: unknown,
): Readonly<{ expectedRevision: number; patch: QuoteDraftPatch }> {
  const body = object(value);
  exactKeys(
    body,
    ["expectedRevision", "idempotencyKey", "metadata", "replaceLines", "convertToManual"],
    "quote patch",
  );
  if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1)
    throw new BadRequestException("expectedRevision must be a positive integer");
  const patch: Record<string, unknown> = {
    idempotencyKey: requiredString(body.idempotencyKey, "idempotencyKey"),
  };
  if (body.metadata !== undefined) {
    const metadata = object(body.metadata, "quote metadata");
    exactKeys(
      metadata,
      [
        "organizationUnitId",
        "contactId",
        "currency",
        "validUntil",
        "terms",
        "notes",
        "shippingTotal",
      ],
      "quote metadata",
    );
    patch.metadata = {
      ...(metadata.organizationUnitId === undefined
        ? {}
        : { organizationUnitId: uuid(metadata.organizationUnitId, "organizationUnitId") }),
      ...(metadata.contactId === undefined
        ? {}
        : { contactId: uuid(metadata.contactId, "contactId") }),
      ...(metadata.currency === undefined
        ? {}
        : { currency: requiredString(metadata.currency, "currency") }),
      ...(metadata.validUntil === undefined
        ? {}
        : { validUntil: optionalString(metadata.validUntil, "validUntil") as string | null }),
      ...(metadata.terms === undefined
        ? {}
        : { terms: optionalString(metadata.terms, "terms") as string | null }),
      ...(metadata.notes === undefined
        ? {}
        : { notes: optionalString(metadata.notes, "notes") as string | null }),
      ...(metadata.shippingTotal === undefined
        ? {}
        : { shippingTotal: requiredString(metadata.shippingTotal, "shippingTotal") }),
    };
  }
  if (body.replaceLines !== undefined) {
    if (!Array.isArray(body.replaceLines))
      throw new BadRequestException("replaceLines must be an array");
    patch.replaceLines = body.replaceLines.map(parseLine);
  }
  if (body.convertToManual !== undefined) {
    if (!Array.isArray(body.convertToManual))
      throw new BadRequestException("convertToManual must be an array");
    patch.convertToManual = body.convertToManual.map((value) => {
      const conversion = object(value, "manual conversion");
      exactKeys(conversion, ["position", "snapshot"], "manual conversion");
      if (!Number.isInteger(conversion.position) || Number(conversion.position) < 0)
        throw new BadRequestException("position must be a non-negative integer");
      const snapshot = object(conversion.snapshot, "manual snapshot");
      exactKeys(
        snapshot,
        ["sku", "description", "unit", "unitPrice", "currency", "taxCode", "taxRate", "metadata"],
        "manual snapshot",
      );
      return {
        position: Number(conversion.position),
        snapshot: {
          description: requiredString(snapshot.description, "description"),
          unit: requiredString(snapshot.unit, "unit"),
          unitPrice: requiredString(snapshot.unitPrice, "unitPrice"),
          currency: requiredString(snapshot.currency, "currency"),
          ...(snapshot.sku === undefined
            ? {}
            : { sku: optionalString(snapshot.sku, "sku") as string | null }),
          ...(snapshot.taxCode === undefined
            ? {}
            : { taxCode: optionalString(snapshot.taxCode, "taxCode") as string | null }),
          ...(snapshot.taxRate === undefined
            ? {}
            : { taxRate: optionalString(snapshot.taxRate, "taxRate") as string | null }),
          ...(snapshot.metadata === undefined ? {} : { metadata: snapshot.metadata }),
        },
      };
    });
  }
  return { expectedRevision: Number(body.expectedRevision), patch: patch as QuoteDraftPatch };
}

function parseListQuery(value: unknown): QuoteListFilters {
  const query = object(value, "quotes query");
  exactKeys(query, ["status", "contactId", "cursor", "limit"], "quotes query");
  const string = (key: string): string | undefined => {
    const value = query[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string")
      throw new BadRequestException(`${key} must appear once as a string`);
    return value;
  };
  const limitText = string("limit");
  if (limitText !== undefined && !/^[1-9]\d{0,2}$/.test(limitText))
    throw new BadRequestException("limit must be an integer from 1 to 100");
  const status = string("status");
  const contactId = string("contactId");
  const cursor = string("cursor");
  return {
    ...(status === undefined ? {} : { status }),
    ...(contactId === undefined ? {} : { contactId: uuid(contactId, "contactId") }),
    ...(cursor === undefined ? {} : { cursor: uuid(cursor, "cursor") }),
    ...(limitText === undefined ? {} : { limit: Number.parseInt(limitText, 10) }),
  };
}

function mapQuoteError(error: unknown): never {
  if (error instanceof QuoteAuthorizationError) throw new ForbiddenException("Forbidden");
  if (error instanceof QuoteValidationError) throw new BadRequestException(error.message);
  if (error instanceof QuoteCommandConflictError || error instanceof QuoteRevisionConflictError)
    throw new ConflictException(error.message);
  if (error instanceof QuoteNotFoundError) throw new NotFoundException(error.message);
  if (
    error instanceof TenantModuleEntitlementRequiredError ||
    error instanceof TenantNotOperationalError
  )
    throw new ForbiddenException("Tenant is not authorized for this quote operation");
  throw error;
}

@Injectable()
export class QuotesService {
  constructor(@Inject(QUOTES_DATABASE) private readonly database: QuoteManagerDatabase) {}

  async create(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    input: QuoteDraftInput,
  ) {
    try {
      await assertTenantModuleEntitled(context, "module.crm_lite", this.database);
      if (input.lines.some((line) => line.productId !== null))
        await assertTenantModuleEntitled(context, "module.catalog", this.database);
      return await createQuoteDraft(context, this.database, input, {
        actorUserId: identity.userId,
        requestId: requestId(request),
      });
    } catch (error) {
      return mapQuoteError(error);
    }
  }

  async list(context: TenantContext, filters: QuoteListFilters) {
    try {
      return await listQuotes(context, this.database, filters);
    } catch (error) {
      return mapQuoteError(error);
    }
  }

  async get(context: TenantContext, id: string) {
    try {
      return await getQuoteById(context, this.database, id);
    } catch (error) {
      return mapQuoteError(error);
    }
  }

  async update(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    id: string,
    expectedRevision: number,
    patch: QuoteDraftPatch,
  ) {
    try {
      if (patch.metadata?.contactId !== undefined)
        await assertTenantModuleEntitled(context, "module.crm_lite", this.database);
      if (patch.replaceLines?.some((line) => line.productId !== null))
        await assertTenantModuleEntitled(context, "module.catalog", this.database);
      return await updateQuoteDraft(context, this.database, id, expectedRevision, patch, {
        actorUserId: identity.userId,
        requestId: requestId(request),
      });
    } catch (error) {
      return mapQuoteError(error);
    }
  }
}

@Controller("api/v1/quotes")
@RequireEntitlements("module.quotes")
export class QuotesController {
  constructor(private readonly service: QuotesService) {}

  @Get()
  @quoteAuthorized("quotes.read")
  async list(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: unknown,
  ): Promise<ApiResponse<Awaited<ReturnType<QuotesService["list"]>>>> {
    return { success: true, data: await this.service.list(context, parseListQuery(query)) };
  }

  @Post()
  @HttpCode(201)
  @quoteAuthorized("quotes.create")
  async create(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<ApiResponse<Awaited<ReturnType<QuotesService["create"]>>>> {
    return {
      success: true,
      data: await this.service.create(context, identity, request, parseCreate(body)),
    };
  }

  @Get(":id")
  @quoteAuthorized("quotes.read")
  async get(
    @CurrentTenantContext() context: TenantContext,
    @Param("id") id: string,
  ): Promise<ApiResponse<Awaited<ReturnType<QuotesService["get"]>>>> {
    if (!UUID_V7.test(id)) throw new NotFoundException("Quote was not found");
    return { success: true, data: await this.service.get(context, id.toLowerCase()) };
  }

  @Patch(":id")
  @quoteAuthorized("quotes.create")
  async update(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ApiResponse<Awaited<ReturnType<QuotesService["update"]>>>> {
    if (!UUID_V7.test(id)) throw new NotFoundException("Quote was not found");
    const parsed = parsePatch(body);
    return {
      success: true,
      data: await this.service.update(
        context,
        identity,
        request,
        id.toLowerCase(),
        parsed.expectedRevision,
        parsed.patch,
      ),
    };
  }
}
