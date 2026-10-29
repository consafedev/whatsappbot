import { Prisma, type Product } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess, type TenantTransactionDatabase } from "./tenant-data-access";
import { assertTenantOperational } from "./tenant-operational";

export const CATALOG_PRODUCT_LIMITS = Object.freeze({
  category: 120,
  customValuesBytes: 16 * 1024,
  customValuesDepth: 8,
  defaultPageSize: 50,
  description: 2000,
  maxPageSize: 100,
  name: 150,
  price: "999999999.9999",
  sku: 64,
  taxCode: 64,
  taxRate: "100",
  unit: 32,
});

export type CatalogMutationMetadata = Readonly<{ actorUserId: string; requestId: string }>;

export type CatalogProductInput = Readonly<{
  sku: string;
  name: string;
  description?: string | null;
  category?: string | null;
  unit: string;
  price: string;
  currency: string;
  taxCode?: string | null;
  taxRate?: string | null;
  organizationUnitId?: string | null;
  isExceptional?: boolean;
  customValues?: unknown;
}>;

export type CatalogProductPatch = Partial<CatalogProductInput>;

export type CatalogProductListFilters = Readonly<{
  active?: boolean;
  category?: string;
  cursor?: string;
  limit?: number;
  organizationUnitId?: string;
  search?: string;
}>;

export type CatalogProductView = Readonly<{
  id: string;
  tenantId: string;
  organizationUnitId: string | null;
  sku: string;
  normalizedSku: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  price: string;
  currency: string;
  taxCode: string | null;
  taxRate: string | null;
  active: boolean;
  isExceptional: boolean;
  customValues: Prisma.JsonValue | null;
  createdAt: string;
  updatedAt: string;
}>;

export type CatalogProductManagerDatabase = TenantTransactionDatabase &
  Pick<Prisma.TransactionClient, "product" | "organizationUnit" | "tenant">;

export type CatalogProductListPage = Readonly<{
  items: readonly CatalogProductView[];
  nextCursor: string | null;
}>;

export class CatalogProductNotFoundError extends Error {
  override readonly name = "CatalogProductNotFoundError";
  constructor(readonly productId: string) {
    super("Product was not found");
  }
}

export class CatalogProductValidationError extends Error {
  override readonly name = "CatalogProductValidationError";
}

export class CatalogProductConflictError extends Error {
  override readonly name = "CatalogProductConflictError";
}

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL_CHARACTERS = /\p{Cc}/u;
const UNSAFE_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const PRICE_PATTERN = /^\d{1,9}(?:\.\d{1,4})?$/;
const RATE_PATTERN = /^\d{1,3}(?:\.\d{1,4})?$/;

function requireMetadata(metadata: CatalogMutationMetadata): void {
  if (!CANONICAL_UUID.test(metadata.actorUserId) || metadata.requestId.trim().length === 0) {
    throw new CatalogProductValidationError("actorUserId and requestId are required");
  }
}

function requireId(id: string): string {
  if (typeof id !== "string" || !CANONICAL_UUID.test(id)) {
    throw new CatalogProductValidationError("id must be a canonical UUID");
  }
  return id;
}

function normalizeText(
  value: unknown,
  field: string,
  max: number,
  required: boolean,
): string | null {
  if (value === null && !required) return null;
  if (typeof value !== "string") {
    throw new CatalogProductValidationError(
      `${field} must be a string${required ? "" : " or null"}`,
    );
  }
  const normalized = value.trim();
  if ((required && normalized.length === 0) || normalized.length > max) {
    throw new CatalogProductValidationError(
      `${field} must contain ${required ? "1" : "0"} to ${max} characters`,
    );
  }
  return normalized;
}

function normalizeSku(value: unknown): Readonly<{ sku: string; normalizedSku: string }> {
  if (typeof value !== "string") throw new CatalogProductValidationError("sku must be a string");
  const sku = value.trim();
  const normalizedSku = sku.normalize("NFKC").trim().toUpperCase();
  if (
    sku.length === 0 ||
    sku.length > CATALOG_PRODUCT_LIMITS.sku ||
    normalizedSku.length === 0 ||
    normalizedSku.length > CATALOG_PRODUCT_LIMITS.sku ||
    CONTROL_CHARACTERS.test(sku) ||
    CONTROL_CHARACTERS.test(normalizedSku)
  ) {
    throw new CatalogProductValidationError(
      "sku and normalized SKU must contain 1 to 64 characters without controls",
    );
  }
  return { sku, normalizedSku };
}

function normalizePrice(value: unknown): Prisma.Decimal {
  if (typeof value !== "string" || !PRICE_PATTERN.test(value)) {
    throw new CatalogProductValidationError(
      "price must be a decimal string from 0 to 999999999.9999 with at most four decimals",
    );
  }
  const price = new Prisma.Decimal(value);
  if (price.gt(CATALOG_PRODUCT_LIMITS.price)) {
    throw new CatalogProductValidationError(
      `price must not exceed ${CATALOG_PRODUCT_LIMITS.price}`,
    );
  }
  return price;
}

function normalizeTaxRate(value: unknown): Prisma.Decimal | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !RATE_PATTERN.test(value)) {
    throw new CatalogProductValidationError(
      "taxRate must be a decimal string from 0 to 100 with at most four decimals",
    );
  }
  const rate = new Prisma.Decimal(value);
  if (rate.gt(CATALOG_PRODUCT_LIMITS.taxRate)) {
    throw new CatalogProductValidationError(
      `taxRate must not exceed ${CATALOG_PRODUCT_LIMITS.taxRate}`,
    );
  }
  return rate;
}

function normalizeCurrency(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) {
    throw new CatalogProductValidationError("currency must be an uppercase three-character code");
  }
  return value;
}

function normalizeCustomValues(value: unknown): Prisma.InputJsonObject | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new CatalogProductValidationError("customValues must be a JSON object or null");
  }
  const seen = new WeakSet<object>();
  const validateJsonValue = (current: unknown, depth: number): void => {
    if (depth > CATALOG_PRODUCT_LIMITS.customValuesDepth) {
      throw new CatalogProductValidationError("customValues exceeds depth 8");
    }
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean" ||
      (typeof current === "number" && Number.isFinite(current))
    ) {
      return;
    }
    if (typeof current !== "object") {
      throw new CatalogProductValidationError("customValues must contain only JSON values");
    }
    if (seen.has(current)) {
      throw new CatalogProductValidationError("customValues must not contain cycles");
    }
    seen.add(current);
    if (Array.isArray(current)) {
      const keys = Reflect.ownKeys(current);
      if (
        keys.length !== current.length + 1 ||
        keys.some((key) => key !== "length" && typeof key !== "string")
      ) {
        throw new CatalogProductValidationError("customValues arrays must be dense JSON arrays");
      }
      for (let index = 0; index < current.length; index += 1) {
        if (!Object.hasOwn(current, index)) {
          throw new CatalogProductValidationError("customValues arrays must be dense JSON arrays");
        }
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
          throw new CatalogProductValidationError("customValues must not contain accessors");
        }
        validateJsonValue(descriptor.value, depth + 1);
      }
      seen.delete(current);
      return;
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CatalogProductValidationError("customValues must contain only plain JSON objects");
    }
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (
        typeof key !== "string" ||
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        throw new CatalogProductValidationError("customValues must not contain hidden properties");
      }
      if (UNSAFE_JSON_KEYS.has(key))
        throw new CatalogProductValidationError("customValues contains an unsafe key");
      validateJsonValue(descriptor.value, depth + 1);
    }
    seen.delete(current);
  };
  validateJsonValue(value, 1);
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new CatalogProductValidationError("customValues must be JSON serializable");
  }
  if (Buffer.byteLength(serialized, "utf8") > CATALOG_PRODUCT_LIMITS.customValuesBytes) {
    throw new CatalogProductValidationError("customValues exceeds 16 KiB UTF-8");
  }
  let clone: unknown;
  try {
    clone = JSON.parse(serialized) as unknown;
  } catch {
    throw new CatalogProductValidationError("customValues must be valid JSON");
  }
  if (clone === null || typeof clone !== "object" || Array.isArray(clone)) {
    throw new CatalogProductValidationError("customValues must be a JSON object or null");
  }
  return clone as Prisma.InputJsonObject;
}

function toView(product: Product): CatalogProductView {
  return {
    id: product.id,
    tenantId: product.tenantId,
    organizationUnitId: product.organizationUnitId,
    sku: product.sku,
    normalizedSku: product.normalizedSku,
    name: product.name,
    description: product.description,
    category: product.category,
    unit: product.unit,
    price: product.price.toFixed(4),
    currency: product.currency,
    taxCode: product.taxCode,
    taxRate: product.taxRate?.toFixed(4) ?? null,
    active: product.active,
    isExceptional: product.isExceptional,
    customValues: product.customValues,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

function auditSummary(product: Product): Prisma.InputJsonObject {
  return {
    active: product.active,
    category: product.category,
    currency: product.currency,
    isExceptional: product.isExceptional,
    name: product.name,
    organizationUnitId: product.organizationUnitId,
    price: product.price.toFixed(4),
    sku: product.sku,
    taxCode: product.taxCode,
    taxRate: product.taxRate?.toFixed(4) ?? null,
    unit: product.unit,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameProductValue(current: unknown, next: unknown): boolean {
  if (next === Prisma.DbNull) return current === null;
  if (current instanceof Prisma.Decimal && next instanceof Prisma.Decimal) {
    return current.equals(next);
  }
  if (
    current !== null &&
    next !== null &&
    typeof current === "object" &&
    typeof next === "object"
  ) {
    return canonicalJson(current) === canonicalJson(next);
  }
  return Object.is(current, next);
}

async function assertOrganizationUnit(
  database: Pick<Prisma.TransactionClient, "organizationUnit">,
  tenantId: string,
  organizationUnitId: string | null,
): Promise<void> {
  if (organizationUnitId === null) return;
  const unit = await database.organizationUnit.findFirst({
    select: { id: true },
    where: { id: organizationUnitId, tenantId },
  });
  if (unit === null)
    throw new CatalogProductValidationError("organizationUnitId must belong to the tenant");
}

async function recordMutation(
  context: TenantContext,
  transaction: Prisma.TransactionClient,
  product: Product,
  metadata: CatalogMutationMetadata,
  action: "created" | "updated" | "archived",
  before?: Product,
): Promise<void> {
  const access = createTenantDataAccess(context, transaction);
  await access.audit.append({
    action: `catalog_product.${action}`,
    actorId: metadata.actorUserId,
    actorType: "tenant_user",
    ...(before === undefined ? {} : { beforeSummary: auditSummary(before) }),
    afterSummary: auditSummary(product),
    entityId: product.id,
    entityType: "Product",
    organizationUnitId: product.organizationUnitId,
    requestId: metadata.requestId,
  });
  await access.outbox.append({
    aggregateId: product.id,
    aggregateType: "Product",
    eventType: `catalog_product.${action}`,
    payload: { productId: product.id, tenantId: context.tenantId },
  });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function assertCustomValuesFitDatabase(
  transaction: Prisma.TransactionClient,
  customValues: Prisma.InputJsonObject | null,
): Promise<void> {
  if (customValues === null) return;
  const [result] = await transaction.$queryRaw<Array<{ bytes: number }>>(Prisma.sql`
    SELECT octet_length(${JSON.stringify(customValues)}::jsonb::text) AS bytes
  `);
  if (result === undefined || result.bytes > CATALOG_PRODUCT_LIMITS.customValuesBytes) {
    throw new CatalogProductValidationError(
      "customValues exceeds 16 KiB UTF-8 when stored as JSONB",
    );
  }
}

export async function createCatalogProduct(
  context: TenantContext,
  database: CatalogProductManagerDatabase,
  input: CatalogProductInput,
  metadata: CatalogMutationMetadata,
): Promise<CatalogProductView> {
  const tenant = createTenantContext(context.tenantId);
  requireMetadata(metadata);
  const { sku, normalizedSku } = normalizeSku(input.sku);
  const name = normalizeText(input.name, "name", CATALOG_PRODUCT_LIMITS.name, true) as string;
  const description =
    input.description === undefined
      ? null
      : normalizeText(input.description, "description", CATALOG_PRODUCT_LIMITS.description, false);
  const category =
    input.category === undefined
      ? null
      : normalizeText(input.category, "category", CATALOG_PRODUCT_LIMITS.category, false);
  const unit = normalizeText(input.unit, "unit", CATALOG_PRODUCT_LIMITS.unit, true) as string;
  const price = normalizePrice(input.price);
  const currency = normalizeCurrency(input.currency);
  const taxCode =
    input.taxCode === undefined
      ? null
      : normalizeText(input.taxCode, "taxCode", CATALOG_PRODUCT_LIMITS.taxCode, false);
  const taxRate = normalizeTaxRate(input.taxRate);
  const organizationUnitId = input.organizationUnitId ?? null;
  if (organizationUnitId !== null) requireId(organizationUnitId);
  const isExceptional = input.isExceptional ?? false;
  if (typeof isExceptional !== "boolean")
    throw new CatalogProductValidationError("isExceptional must be boolean");
  const customValues = normalizeCustomValues(input.customValues);

  try {
    return await database.$transaction(async (transaction) => {
      await assertTenantOperational(tenant, transaction);
      await assertOrganizationUnit(transaction, tenant.tenantId, organizationUnitId);
      await assertCustomValuesFitDatabase(transaction, customValues);
      const product = await transaction.product.create({
        data: {
          category,
          currency,
          ...(customValues === null ? {} : { customValues }),
          description,
          isExceptional,
          name,
          normalizedSku,
          organizationUnitId,
          price,
          sku,
          taxCode,
          taxRate,
          unit,
          tenantId: tenant.tenantId,
        },
      });
      await recordMutation(tenant, transaction, product, metadata, "created");
      return toView(product);
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new CatalogProductConflictError("sku must be unique within the tenant");
    throw error;
  }
}

export async function getCatalogProductById(
  context: TenantContext,
  database: CatalogProductManagerDatabase,
  id: string,
): Promise<CatalogProductView | null> {
  const tenant = createTenantContext(context.tenantId);
  if (!CANONICAL_UUID.test(id)) return null;
  const product = await database.product.findFirst({ where: { id, tenantId: tenant.tenantId } });
  return product === null ? null : toView(product);
}

export async function listCatalogProducts(
  context: TenantContext,
  database: CatalogProductManagerDatabase,
  filters: CatalogProductListFilters = {},
): Promise<CatalogProductListPage> {
  const tenant = createTenantContext(context.tenantId);
  const limit = filters.limit ?? CATALOG_PRODUCT_LIMITS.defaultPageSize;
  if (!Number.isInteger(limit) || limit < 1 || limit > CATALOG_PRODUCT_LIMITS.maxPageSize) {
    throw new CatalogProductValidationError(
      `limit must be between 1 and ${CATALOG_PRODUCT_LIMITS.maxPageSize}`,
    );
  }
  if (filters.cursor !== undefined) requireId(filters.cursor);
  if (filters.organizationUnitId !== undefined) requireId(filters.organizationUnitId);
  if (filters.active !== undefined && typeof filters.active !== "boolean") {
    throw new CatalogProductValidationError("active must be boolean");
  }
  if (
    filters.search !== undefined &&
    (typeof filters.search !== "string" || filters.search.length > 150)
  ) {
    throw new CatalogProductValidationError("search must be a string up to 150 characters");
  }
  if (
    filters.category !== undefined &&
    (typeof filters.category !== "string" ||
      filters.category.length > CATALOG_PRODUCT_LIMITS.category)
  ) {
    throw new CatalogProductValidationError("category must be a string up to 120 characters");
  }
  if (filters.organizationUnitId !== undefined) {
    await assertOrganizationUnit(database, tenant.tenantId, filters.organizationUnitId);
  }
  const search = filters.search?.trim();
  const where: Prisma.ProductWhereInput = {
    tenantId: tenant.tenantId,
    ...(filters.active === undefined ? {} : { active: filters.active }),
    ...(filters.category === undefined ? {} : { category: filters.category }),
    ...(filters.cursor === undefined ? {} : { id: { gt: filters.cursor } }),
    ...(filters.organizationUnitId === undefined && (search === undefined || search.length === 0)
      ? {}
      : {
          AND: [
            ...(filters.organizationUnitId === undefined
              ? []
              : [
                  {
                    OR: [
                      { organizationUnitId: null },
                      { organizationUnitId: filters.organizationUnitId },
                    ],
                  },
                ]),
            ...(search === undefined || search.length === 0
              ? []
              : [
                  {
                    OR: [
                      { sku: { contains: search, mode: "insensitive" as const } },
                      { name: { contains: search, mode: "insensitive" as const } },
                    ],
                  },
                ]),
          ],
        }),
  };
  const rows = await database.product.findMany({ orderBy: { id: "asc" }, take: limit + 1, where });
  const hasNext = rows.length > limit;
  const pageRows = hasNext ? rows.slice(0, limit) : rows;
  return {
    items: pageRows.map(toView),
    nextCursor: hasNext ? (pageRows.at(-1)?.id ?? null) : null,
  };
}

async function lockProduct(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  id: string,
): Promise<Product> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "products" WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${id}::uuid FOR UPDATE
  `);
  const current = rows[0];
  if (current === undefined) throw new CatalogProductNotFoundError(id);
  const product = await transaction.product.findFirst({ where: { id: current.id, tenantId } });
  if (product === null) throw new CatalogProductNotFoundError(id);
  return product;
}

export async function updateCatalogProduct(
  context: TenantContext,
  database: CatalogProductManagerDatabase,
  id: string,
  patch: CatalogProductPatch,
  metadata: CatalogMutationMetadata,
): Promise<CatalogProductView> {
  const tenant = createTenantContext(context.tenantId);
  const productId = requireId(id);
  requireMetadata(metadata);
  const keys = Object.keys(patch) as Array<keyof CatalogProductPatch>;
  if (keys.length === 0 || keys.every((key) => patch[key] === undefined)) {
    throw new CatalogProductValidationError("At least one product field must be updated");
  }
  const data: Prisma.ProductUncheckedUpdateInput = {};
  let customValues: Prisma.InputJsonObject | null | undefined;
  if (patch.sku !== undefined) Object.assign(data, normalizeSku(patch.sku));
  if (patch.name !== undefined)
    data.name = normalizeText(patch.name, "name", CATALOG_PRODUCT_LIMITS.name, true) as string;
  if (patch.description !== undefined)
    data.description = normalizeText(
      patch.description,
      "description",
      CATALOG_PRODUCT_LIMITS.description,
      false,
    );
  if (patch.category !== undefined)
    data.category = normalizeText(
      patch.category,
      "category",
      CATALOG_PRODUCT_LIMITS.category,
      false,
    );
  if (patch.unit !== undefined)
    data.unit = normalizeText(patch.unit, "unit", CATALOG_PRODUCT_LIMITS.unit, true) as string;
  if (patch.price !== undefined) data.price = normalizePrice(patch.price);
  if (patch.currency !== undefined) data.currency = normalizeCurrency(patch.currency);
  if (patch.taxCode !== undefined)
    data.taxCode = normalizeText(patch.taxCode, "taxCode", CATALOG_PRODUCT_LIMITS.taxCode, false);
  if (patch.taxRate !== undefined) data.taxRate = normalizeTaxRate(patch.taxRate);
  if (patch.organizationUnitId !== undefined) {
    data.organizationUnitId =
      patch.organizationUnitId === null ? null : requireId(patch.organizationUnitId);
  }
  if (patch.isExceptional !== undefined) {
    if (typeof patch.isExceptional !== "boolean")
      throw new CatalogProductValidationError("isExceptional must be boolean");
    data.isExceptional = patch.isExceptional;
  }
  if (patch.customValues !== undefined) {
    customValues = normalizeCustomValues(patch.customValues);
    data.customValues = customValues === null ? Prisma.DbNull : customValues;
  }

  try {
    return await database.$transaction(async (transaction) => {
      await assertTenantOperational(tenant, transaction);
      const before = await lockProduct(transaction, tenant.tenantId, productId);
      if (
        !Object.entries(data).some(
          ([field, value]) => !sameProductValue(before[field as keyof Product], value),
        )
      ) {
        return toView(before);
      }
      const targetUnit =
        patch.organizationUnitId === undefined
          ? before.organizationUnitId
          : (data.organizationUnitId as string | null);
      await assertOrganizationUnit(transaction, tenant.tenantId, targetUnit);
      if (customValues !== undefined)
        await assertCustomValuesFitDatabase(transaction, customValues);
      const product = await transaction.product.update({
        data,
        where: { id: productId, tenantId: tenant.tenantId },
      });
      await recordMutation(tenant, transaction, product, metadata, "updated", before);
      return toView(product);
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new CatalogProductConflictError("sku must be unique within the tenant");
    throw error;
  }
}

export async function archiveCatalogProduct(
  context: TenantContext,
  database: CatalogProductManagerDatabase,
  id: string,
  metadata: CatalogMutationMetadata,
): Promise<CatalogProductView> {
  const tenant = createTenantContext(context.tenantId);
  const productId = requireId(id);
  requireMetadata(metadata);
  return database.$transaction(async (transaction) => {
    await assertTenantOperational(tenant, transaction);
    const before = await lockProduct(transaction, tenant.tenantId, productId);
    if (!before.active) return toView(before);
    const product = await transaction.product.update({
      data: { active: false },
      where: { id: productId, tenantId: tenant.tenantId },
    });
    await recordMutation(tenant, transaction, product, metadata, "archived", before);
    return toView(product);
  });
}
