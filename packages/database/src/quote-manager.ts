import { createHash } from "node:crypto";
import { Prisma, type Quote, type QuoteItem } from "./generated/prisma/client";
import { normalizeJsonObject } from "./json-object";
import {
  QUOTE_CALCULATION_LIMITS,
  QuoteCalculationValidationError,
  recalculateQuoteInTransaction,
} from "./quote-calculation";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess, type TenantTransactionDatabase } from "./tenant-data-access";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

export const QUOTE_DRAFT_LIMITS = Object.freeze({
  commandBytes: 256 * 1024,
  discount: QUOTE_CALCULATION_LIMITS.discount,
  idempotencyKey: 128,
  itemCount: QUOTE_CALCULATION_LIMITS.itemCount,
  lineDescription: 2000,
  lineMetadataBytes: 16 * 1024,
  lineMetadataDepth: 8,
  lineSku: 64,
  lineUnit: 32,
  maxCurrencyPrice: QUOTE_CALCULATION_LIMITS.maxCurrencyAmount,
  maxQuantity: QUOTE_CALCULATION_LIMITS.maxQuantity,
  notes: 4000,
  terms: 8000,
});

export type QuoteMutationMetadata = Readonly<{ actorUserId: string; requestId: string }>;

export type QuoteDiscountInput = Readonly<{ kind: "fixed" | "percent"; value: string }>;

export type QuoteLineInput = Readonly<
  | { productId: string; quantity: string; discount?: QuoteDiscountInput }
  | {
      productId: null;
      sku?: string | null;
      description: string;
      unit: string;
      quantity: string;
      unitPrice: string;
      currency: string;
      taxCode?: string | null;
      taxRate?: string | null;
      discount?: QuoteDiscountInput;
      metadata?: unknown;
    }
>;

export type ManualQuoteLineSnapshot = Readonly<{
  sku?: string | null;
  description: string;
  unit: string;
  unitPrice: string;
  currency: string;
  taxCode?: string | null;
  taxRate?: string | null;
  metadata?: unknown;
}>;

export type QuoteDraftInput = Readonly<{
  idempotencyKey: string;
  organizationUnitId: string;
  contactId: string;
  currency: string;
  lines: readonly QuoteLineInput[];
  validUntil?: string | null;
  terms?: string | null;
  notes?: string | null;
  shippingTotal?: string;
}>;

export type QuoteDraftPatch = Readonly<{
  metadata?: Readonly<{
    organizationUnitId?: string;
    contactId?: string;
    currency?: string;
    validUntil?: string | null;
    terms?: string | null;
    notes?: string | null;
    shippingTotal?: string;
  }>;
  replaceLines?: readonly QuoteLineInput[];
  convertToManual?: readonly Readonly<{ position: number; snapshot: ManualQuoteLineSnapshot }>[];
  idempotencyKey: string;
}>;

export type QuoteListFilters = Readonly<{
  status?: string;
  contactId?: string;
  cursor?: string;
  limit?: number;
}>;

export type QuoteManagerDatabase = TenantTransactionDatabase &
  Pick<
    Prisma.TransactionClient,
    | "quote"
    | "quoteItem"
    | "quoteCommandReceipt"
    | "quoteCommercialContributor"
    | "contact"
    | "organizationUnit"
    | "product"
    | "user"
    | "tenant"
    | "tenantEntitlement"
  >;

export type QuoteDraftLineView = Readonly<{
  id: string;
  position: number;
  productId: string | null;
  source: "catalog" | "manual";
  sku: string | null;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  currency: string;
  taxCode: string | null;
  taxRate: string | null;
  discountKind: "fixed" | "percent";
  discountValue: string;
  grossTotal: string | null;
  discountTotal: string | null;
  netTotal: string | null;
  taxTotal: string | null;
  lineTotal: string | null;
  isExceptional: boolean;
  metadata: Prisma.JsonValue | null;
}>;

export type QuoteDraftView = Readonly<{
  id: string;
  tenantId: string;
  number: string;
  numberSequence: string;
  status: string;
  revision: number;
  autonomyLevel: 0;
  organizationUnitId: string;
  contactId: string;
  currency: string;
  currencyPrecision: number;
  validUntil: string | null;
  terms: string | null;
  notes: string | null;
  shippingTotal: string;
  subtotal: string | null;
  discountTotal: string | null;
  taxTotal: string | null;
  total: string | null;
  calculatedRevision: number | null;
  calculationInputHash: string | null;
  customerNameSnapshot: string;
  customerPhoneSnapshot: string;
  organizationUnitNameSnapshot: string;
  salespersonNameSnapshot: string;
  lines: readonly QuoteDraftLineView[];
  createdAt: string;
  updatedAt: string;
}>;

export type QuoteRecordedOutcome = Readonly<{
  quoteId: string;
  number: string;
  status: "draft";
  revision: number;
}>;

export type QuoteCommandOutcome<T> = Readonly<{
  replayed: boolean;
  recordedOutcome: QuoteRecordedOutcome;
  current: T;
}>;

export type QuoteListPage = Readonly<{
  items: readonly QuoteDraftView[];
  nextCursor: string | null;
}>;

export class QuoteValidationError extends Error {
  override readonly name = "QuoteValidationError";
}
export class QuoteNotFoundError extends Error {
  override readonly name = "QuoteNotFoundError";
  constructor(readonly quoteId: string) {
    super("Quote was not found");
  }
}
export class QuoteCommandConflictError extends Error {
  override readonly name = "QuoteCommandConflictError";
}
export class QuoteRevisionConflictError extends Error {
  override readonly name = "QuoteRevisionConflictError";
}
export class QuoteAuthorizationError extends Error {
  override readonly name = "QuoteAuthorizationError";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY = /^\d{1,15}(?:\.\d{1,4})?$/;
const PRICE = /^\d{1,9}(?:\.\d{1,4})?$/;
const QUANTITY = /^\d{1,6}(?:\.\d{1,3})?$/;
const RATE = /^\d{1,3}(?:\.\d{1,4})?$/;
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function exactKeys(value: object, allowed: readonly string[], field: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new QuoteValidationError(`${field} contains an unknown field`);
  }
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value))
    throw new QuoteValidationError(`${field} must be a UUIDv7`);
  return value.toLowerCase();
}

function text(value: unknown, field: string, max: number, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string")
    throw new QuoteValidationError(`${field} must be a string${nullable ? " or null" : ""}`);
  const result = value.trim();
  if ((!nullable && result.length === 0) || result.length > max)
    throw new QuoteValidationError(
      `${field} must contain ${nullable ? "0" : "1"} to ${max} characters`,
    );
  return result;
}

function decimal(value: unknown, field: string, pattern: RegExp, max: string): string {
  if (typeof value !== "string" || !pattern.test(value))
    throw new QuoteValidationError(`${field} must be a bounded decimal string`);
  const result = new Prisma.Decimal(value);
  if (!result.isFinite() || result.isNegative() || result.gt(max))
    throw new QuoteValidationError(`${field} is out of range`);
  return result.toFixed(4);
}

function normalizeDiscount(value: unknown): Readonly<{ kind: "fixed" | "percent"; value: string }> {
  let kind: "fixed" | "percent" = "fixed";
  let raw: unknown = "0";
  if (value !== undefined) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new QuoteValidationError("discount must contain kind and value");
    exactKeys(value, ["kind", "value"], "discount");
    const record = value as { kind?: unknown; value?: unknown };
    if (record.kind !== "fixed" && record.kind !== "percent")
      throw new QuoteValidationError("discount kind must be fixed or percent");
    kind = record.kind;
    raw = record.value;
  }
  const normalized = decimal(
    raw,
    "discount value",
    kind === "percent" ? RATE : MONEY,
    kind === "percent" ? "100" : QUOTE_DRAFT_LIMITS.discount,
  );
  return { kind, value: normalized };
}

function quantity(value: unknown): string {
  if (typeof value !== "string" || !QUANTITY.test(value))
    throw new QuoteValidationError("quantity must be a decimal string with at most three decimals");
  const result = new Prisma.Decimal(value);
  if (!result.gt(0) || result.gt(QUOTE_DRAFT_LIMITS.maxQuantity))
    throw new QuoteValidationError("quantity must be greater than zero and at most 999999.999");
  return result.toFixed(3);
}

function currency(value: unknown): Readonly<{ code: string; precision: number }> {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value))
    throw new QuoteValidationError("currency must be an uppercase three-character code");
  let precision: number;
  try {
    precision =
      new Intl.NumberFormat("en", { style: "currency", currency: value }).resolvedOptions()
        .maximumFractionDigits ?? 0;
  } catch {
    throw new QuoteValidationError("currency is not supported by Intl currency metadata");
  }
  if (precision < 0 || precision > 4)
    throw new QuoteValidationError("currency precision is outside the supported range");
  return { code: value, precision };
}

function validUntil(value: unknown): Date | null | undefined {
  if (value === undefined || value === null) return value;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
  ) {
    throw new QuoteValidationError("validUntil must be an ISO instant with an explicit offset");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new QuoteValidationError("validUntil must be a valid instant");
  return date;
}

function normalizeJson(value: unknown): Prisma.InputJsonObject | null {
  return normalizeJsonObject(value, {
    depthLimit: QUOTE_DRAFT_LIMITS.lineMetadataDepth,
    byteLimit: QUOTE_DRAFT_LIMITS.lineMetadataBytes,
    forbiddenKeys: FORBIDDEN_JSON_KEYS,
    fail: (reason) =>
      new QuoteValidationError(
        {
          root: "metadata must be a plain JSON object or null",
          depth: "metadata exceeds depth 8",
          value: "metadata must contain JSON values without cycles",
          cycle: "metadata must contain JSON values without cycles",
          array: "metadata arrays must be dense JSON arrays",
          accessor: "metadata must not contain accessors",
          prototype: "metadata must contain plain JSON values",
          hidden: "metadata must not contain hidden properties or accessors",
          "unsafe-key": "metadata contains a reserved key",
          serializable: "metadata must be JSON serializable",
          "invalid-json": "metadata must be a JSON object",
          size: "metadata exceeds 16 KiB UTF-8",
        }[reason],
      ),
  });
}

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function toLineView(line: QuoteItem, currencyPrecision: number): QuoteDraftLineView {
  return {
    id: line.id,
    position: line.position,
    productId: line.productId,
    source: line.source as "catalog" | "manual",
    sku: line.sku,
    description: line.description,
    unit: line.unit,
    quantity: line.quantity.toFixed(3),
    unitPrice: line.unitPrice.toFixed(4),
    currency: line.currency,
    taxCode: line.taxCode,
    taxRate: line.taxRate?.toFixed(4) ?? null,
    discountKind: line.discountKind as "fixed" | "percent",
    discountValue: line.discountValue.toFixed(4),
    grossTotal: line.grossTotal?.toFixed(currencyPrecision) ?? null,
    discountTotal: line.discountTotal?.toFixed(currencyPrecision) ?? null,
    netTotal: line.netTotal?.toFixed(currencyPrecision) ?? null,
    taxTotal: line.taxTotal?.toFixed(currencyPrecision) ?? null,
    lineTotal: line.lineTotal?.toFixed(currencyPrecision) ?? null,
    isExceptional: line.isExceptional,
    metadata: line.metadata,
  };
}

function toView(quote: Quote & { items: QuoteItem[] }): QuoteDraftView {
  return {
    id: quote.id,
    tenantId: quote.tenantId,
    number: quote.number,
    numberSequence: quote.numberSequence.toString(),
    status: quote.status,
    revision: quote.revision,
    autonomyLevel: 0,
    organizationUnitId: quote.organizationUnitId,
    contactId: quote.contactId,
    currency: quote.currency,
    currencyPrecision: quote.currencyPrecision,
    validUntil: quote.validUntil?.toISOString() ?? null,
    terms: quote.terms,
    notes: quote.notes,
    shippingTotal: quote.shippingTotal.toFixed(4),
    subtotal: quote.subtotal?.toFixed(quote.currencyPrecision) ?? null,
    discountTotal: quote.discountTotal?.toFixed(quote.currencyPrecision) ?? null,
    taxTotal: quote.taxTotal?.toFixed(quote.currencyPrecision) ?? null,
    total: quote.total?.toFixed(quote.currencyPrecision) ?? null,
    calculatedRevision: quote.calculatedRevision,
    calculationInputHash: quote.calculationInputHash,
    customerNameSnapshot: quote.customerNameSnapshot,
    customerPhoneSnapshot: quote.customerPhoneSnapshot,
    organizationUnitNameSnapshot: quote.organizationUnitNameSnapshot,
    salespersonNameSnapshot: quote.salespersonNameSnapshot,
    lines: quote.items.map((line) => toLineView(line, quote.currencyPrecision)),
    createdAt: quote.createdAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
  };
}

async function recalculateDraft(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  quoteId: string,
  revision: number,
): Promise<void> {
  try {
    await recalculateQuoteInTransaction(transaction, tenantId, quoteId, revision);
  } catch (error) {
    if (error instanceof QuoteCalculationValidationError)
      throw new QuoteValidationError(error.message);
    throw error;
  }
}

function metadataValid(metadata: QuoteMutationMetadata): void {
  requireUuid(metadata.actorUserId, "actorUserId");
  if (typeof metadata.requestId !== "string" || metadata.requestId.trim().length === 0)
    throw new QuoteValidationError("requestId is required");
}

function keyValid(value: unknown): string {
  const key = text(value, "idempotencyKey", QUOTE_DRAFT_LIMITS.idempotencyKey) as string;
  return key;
}

function normalizedManualLine(
  input: Extract<QuoteLineInput, { productId: null }>,
  position: number,
  targetCurrency: string,
) {
  exactKeys(
    input,
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
  const inputCurrency = currency(input.currency).code;
  if (inputCurrency !== targetCurrency)
    throw new QuoteValidationError("line currency must match quote currency");
  const taxRate =
    input.taxRate === undefined || input.taxRate === null
      ? null
      : decimal(input.taxRate, "taxRate", RATE, "100");
  if (taxRate !== null && new Prisma.Decimal(taxRate).gt(100))
    throw new QuoteValidationError("taxRate must not exceed 100");
  return {
    position,
    productId: null,
    source: "manual",
    sku: input.sku === undefined ? null : text(input.sku, "sku", QUOTE_DRAFT_LIMITS.lineSku, true),
    description: text(
      input.description,
      "description",
      QUOTE_DRAFT_LIMITS.lineDescription,
    ) as string,
    unit: text(input.unit, "unit", QUOTE_DRAFT_LIMITS.lineUnit) as string,
    quantity: new Prisma.Decimal(quantity(input.quantity)),
    unitPrice: new Prisma.Decimal(
      decimal(input.unitPrice, "unitPrice", PRICE, QUOTE_DRAFT_LIMITS.maxCurrencyPrice),
    ),
    currency: inputCurrency,
    taxCode: input.taxCode === undefined ? null : text(input.taxCode, "taxCode", 64, true),
    taxRate: taxRate === null ? null : new Prisma.Decimal(taxRate),
    discountKind: normalizeDiscount(input.discount).kind,
    discountValue: new Prisma.Decimal(normalizeDiscount(input.discount).value),
    isExceptional: true,
    metadata: normalizeJson(input.metadata),
  };
}

function normalizedHeader(input: QuoteDraftInput) {
  exactKeys(
    input,
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
    "quote input",
  );
  if (
    !Array.isArray(input.lines) ||
    input.lines.length < 1 ||
    input.lines.length > QUOTE_DRAFT_LIMITS.itemCount
  )
    throw new QuoteValidationError("lines must contain 1 to 200 items");
  const curr = currency(input.currency);
  const valid = validUntil(input.validUntil);
  const result = {
    idempotencyKey: keyValid(input.idempotencyKey),
    organizationUnitId: requireUuid(input.organizationUnitId, "organizationUnitId"),
    contactId: requireUuid(input.contactId, "contactId"),
    currency: curr.code,
    currencyPrecision: curr.precision,
    validUntil: valid === undefined ? null : valid,
    terms:
      input.terms === undefined ? null : text(input.terms, "terms", QUOTE_DRAFT_LIMITS.terms, true),
    notes:
      input.notes === undefined ? null : text(input.notes, "notes", QUOTE_DRAFT_LIMITS.notes, true),
    shippingTotal: new Prisma.Decimal(
      decimal(
        input.shippingTotal ?? "0",
        "shippingTotal",
        PRICE,
        QUOTE_DRAFT_LIMITS.maxCurrencyPrice,
      ),
    ),
    lines: input.lines.map((line, index) => {
      if (line === null || typeof line !== "object" || Array.isArray(line))
        throw new QuoteValidationError("each line must be an object");
      if (line.productId === null)
        return normalizedManualLine(
          line as Extract<QuoteLineInput, { productId: null }>,
          index,
          curr.code,
        );
      exactKeys(line, ["productId", "quantity", "discount"], "catalog line");
      const discount = normalizeDiscount(line.discount);
      return {
        position: index,
        productId: requireUuid(line.productId, "productId"),
        quantity: new Prisma.Decimal(quantity(line.quantity)),
        discountKind: discount.kind,
        discountValue: new Prisma.Decimal(discount.value),
      };
    }),
  };
  if (
    Buffer.byteLength(canonical({ ...result, idempotencyKey: undefined }), "utf8") >
    QUOTE_DRAFT_LIMITS.commandBytes
  )
    throw new QuoteValidationError("normalized commercial input exceeds 256 KiB UTF-8");
  return result;
}

function normalizeUpdateIntent(patch: QuoteDraftPatch): QuoteDraftPatch {
  exactKeys(
    patch,
    ["metadata", "replaceLines", "convertToManual", "idempotencyKey"],
    "quote patch",
  );
  const idempotencyKey = keyValid(patch.idempotencyKey);
  if (patch.replaceLines !== undefined && patch.convertToManual !== undefined)
    throw new QuoteValidationError("replaceLines and convertToManual cannot be combined");
  let metadata: QuoteDraftPatch["metadata"];
  if (patch.metadata !== undefined) {
    exactKeys(
      patch.metadata,
      [
        "organizationUnitId",
        "contactId",
        "currency",
        "validUntil",
        "terms",
        "notes",
        "shippingTotal",
      ],
      "metadata patch",
    );
    const valid =
      patch.metadata.validUntil === undefined ? undefined : validUntil(patch.metadata.validUntil);
    metadata = {
      ...(patch.metadata.organizationUnitId === undefined
        ? {}
        : {
            organizationUnitId: requireUuid(
              patch.metadata.organizationUnitId,
              "organizationUnitId",
            ),
          }),
      ...(patch.metadata.contactId === undefined
        ? {}
        : { contactId: requireUuid(patch.metadata.contactId, "contactId") }),
      ...(patch.metadata.currency === undefined
        ? {}
        : { currency: currency(patch.metadata.currency).code }),
      ...(patch.metadata.validUntil === undefined
        ? {}
        : { validUntil: valid === undefined || valid === null ? null : valid.toISOString() }),
      ...(patch.metadata.terms === undefined
        ? {}
        : { terms: text(patch.metadata.terms, "terms", QUOTE_DRAFT_LIMITS.terms, true) }),
      ...(patch.metadata.notes === undefined
        ? {}
        : { notes: text(patch.metadata.notes, "notes", QUOTE_DRAFT_LIMITS.notes, true) }),
      ...(patch.metadata.shippingTotal === undefined
        ? {}
        : {
            shippingTotal: decimal(
              patch.metadata.shippingTotal,
              "shippingTotal",
              PRICE,
              QUOTE_DRAFT_LIMITS.maxCurrencyPrice,
            ),
          }),
    };
  }
  const replaceLines = patch.replaceLines?.map((line, position): QuoteLineInput => {
    if (line === null || typeof line !== "object" || Array.isArray(line))
      throw new QuoteValidationError("each line must be an object");
    if (line.productId === null) {
      const normalized = normalizedManualLine(line, position, currency(line.currency).code);
      return {
        productId: null,
        sku: normalized.sku,
        description: normalized.description,
        unit: normalized.unit,
        quantity: normalized.quantity.toFixed(3),
        unitPrice: normalized.unitPrice.toFixed(4),
        currency: normalized.currency,
        taxCode: normalized.taxCode,
        taxRate: normalized.taxRate?.toFixed(4) ?? null,
        discount: {
          kind: normalized.discountKind as "fixed" | "percent",
          value: normalized.discountValue.toFixed(4),
        },
        metadata: normalized.metadata,
      };
    }
    exactKeys(line, ["productId", "quantity", "discount"], "catalog line");
    const discount = normalizeDiscount(line.discount);
    return {
      productId: requireUuid(line.productId, "productId"),
      quantity: quantity(line.quantity),
      discount,
    };
  });
  if (
    replaceLines !== undefined &&
    (replaceLines.length < 1 || replaceLines.length > QUOTE_DRAFT_LIMITS.itemCount)
  )
    throw new QuoteValidationError("replaceLines must contain 1 to 200 items");
  const convertToManual = patch.convertToManual?.map((conversion) => {
    exactKeys(conversion, ["position", "snapshot"], "manual conversion");
    if (!Number.isInteger(conversion.position) || conversion.position < 0)
      throw new QuoteValidationError("conversion position is invalid");
    const snapshot = conversion.snapshot;
    exactKeys(
      snapshot,
      ["sku", "description", "unit", "unitPrice", "currency", "taxCode", "taxRate", "metadata"],
      "manual snapshot",
    );
    const curr = currency(snapshot.currency).code;
    const taxRate =
      snapshot.taxRate === undefined || snapshot.taxRate === null
        ? null
        : decimal(snapshot.taxRate, "taxRate", RATE, "100");
    if (taxRate !== null && new Prisma.Decimal(taxRate).gt(100))
      throw new QuoteValidationError("taxRate must not exceed 100");
    return {
      position: conversion.position,
      snapshot: {
        ...(snapshot.sku === undefined
          ? {}
          : { sku: text(snapshot.sku, "sku", QUOTE_DRAFT_LIMITS.lineSku, true) }),
        description: text(
          snapshot.description,
          "description",
          QUOTE_DRAFT_LIMITS.lineDescription,
        ) as string,
        unit: text(snapshot.unit, "unit", QUOTE_DRAFT_LIMITS.lineUnit) as string,
        unitPrice: decimal(
          snapshot.unitPrice,
          "unitPrice",
          PRICE,
          QUOTE_DRAFT_LIMITS.maxCurrencyPrice,
        ),
        currency: curr,
        ...(snapshot.taxCode === undefined
          ? {}
          : { taxCode: text(snapshot.taxCode, "taxCode", 64, true) }),
        ...(snapshot.taxRate === undefined ? {} : { taxRate }),
        ...(snapshot.metadata === undefined ? {} : { metadata: normalizeJson(snapshot.metadata) }),
      },
    };
  });
  if (
    convertToManual !== undefined &&
    (convertToManual.length < 1 || convertToManual.length > QUOTE_DRAFT_LIMITS.itemCount)
  )
    throw new QuoteValidationError("convertToManual must contain 1 to 200 items");
  const normalized: QuoteDraftPatch = {
    idempotencyKey,
    ...(metadata === undefined ? {} : { metadata }),
    ...(replaceLines === undefined ? {} : { replaceLines }),
    ...(convertToManual === undefined ? {} : { convertToManual }),
  };
  if (
    (normalized.metadata === undefined || Object.keys(normalized.metadata).length === 0) &&
    normalized.replaceLines === undefined &&
    normalized.convertToManual === undefined
  )
    throw new QuoteValidationError(
      "Quote patch requires metadata fields, replacement lines, or manual conversion",
    );
  if (
    Buffer.byteLength(canonical({ ...normalized, idempotencyKey: undefined }), "utf8") >
    QUOTE_DRAFT_LIMITS.commandBytes
  )
    throw new QuoteValidationError("normalized quote patch exceeds 256 KiB UTF-8");
  return normalized;
}

async function revalidateQuoteMutationAuthority(
  transaction: Prisma.TransactionClient,
  tenant: TenantContext,
  actorUserId: string,
  organizationUnitId: string,
  catalogRequired: boolean,
  crmRequired: boolean,
): Promise<void> {
  await assertTenantOperational(tenant, transaction);
  await assertCurrentActor(transaction, tenant.tenantId, actorUserId);
  await loadUnit(transaction, tenant.tenantId, organizationUnitId);
  await assertTenantModuleEntitled(tenant, "module.quotes", transaction);
  if (crmRequired) await assertTenantModuleEntitled(tenant, "module.crm_lite", transaction);
  if (catalogRequired) await assertTenantModuleEntitled(tenant, "module.catalog", transaction);
  const effective = await createTenantDataAccess(tenant, transaction).permissions.resolveForUser(
    actorUserId,
  );
  if (!effective.has("quotes.create"))
    throw new QuoteAuthorizationError("quotes.create permission is required");
}

function assertCommercialInputSize(
  header: {
    organizationUnitId: string;
    contactId: string;
    currency: string;
    validUntil: Date | null;
    terms: string | null;
    notes: string | null;
    shippingTotal: Prisma.Decimal;
  },
  lines: readonly QuoteItem[],
): void {
  if (
    Buffer.byteLength(canonical(commercialRepresentation(header, lines)), "utf8") >
    QUOTE_DRAFT_LIMITS.commandBytes
  )
    throw new QuoteValidationError("resulting commercial input exceeds 256 KiB UTF-8");
}

function commercialRepresentation(
  header: {
    organizationUnitId: string;
    contactId: string;
    currency: string;
    validUntil: Date | null;
    terms: string | null;
    notes: string | null;
    shippingTotal: Prisma.Decimal;
  },
  lines: readonly QuoteItem[],
) {
  return {
    organizationUnitId: header.organizationUnitId,
    contactId: header.contactId,
    currency: header.currency,
    validUntil: header.validUntil?.toISOString() ?? null,
    terms: header.terms,
    notes: header.notes,
    shippingTotal: header.shippingTotal.toFixed(4),
    lines: lines.map((line) => ({
      position: line.position,
      productId: line.productId,
      source: line.source,
      sku: line.sku,
      description: line.description,
      unit: line.unit,
      quantity: line.quantity.toFixed(3),
      unitPrice: line.unitPrice.toFixed(4),
      currency: line.currency,
      taxCode: line.taxCode,
      taxRate: line.taxRate?.toFixed(4) ?? null,
      discountKind: line.discountKind,
      discountValue: line.discountValue.toFixed(4),
      isExceptional: line.isExceptional,
      metadata: line.metadata,
    })),
  };
}

export async function quoteTenantPolicyLock(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`quotes:tenant-policy:${tenantId.toLowerCase()}`}, 0))`;
}

async function commandLock(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  key: string,
): Promise<void> {
  await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`quotes:command:${tenantId.toLowerCase()}:${key}`}, 0))`;
}

async function numberLock(transaction: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`quotes:number:${tenantId.toLowerCase()}`}, 0))`;
}

async function loadQuote(transaction: Prisma.TransactionClient, tenantId: string, id: string) {
  return transaction.quote.findFirst({
    where: { id, tenantId },
    include: { items: { orderBy: { position: "asc" } } },
  });
}

export async function getQuoteById(
  context: TenantContext,
  database: QuoteManagerDatabase,
  quoteId: string,
): Promise<QuoteDraftView> {
  const tenant = createTenantContext(context.tenantId);
  if (!UUID.test(quoteId)) throw new QuoteNotFoundError(quoteId);
  const quote = await loadQuote(
    database as Prisma.TransactionClient,
    tenant.tenantId,
    quoteId.toLowerCase(),
  );
  if (quote === null) throw new QuoteNotFoundError(quoteId);
  return toView(quote);
}

async function assertCurrentActor(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  actorUserId: string,
): Promise<string> {
  const actor = await transaction.user.findFirst({
    select: { id: true, displayName: true },
    where: { id: actorUserId, tenantId, status: "active" },
  });
  if (actor === null)
    throw new QuoteValidationError("Authenticated actor is not active in this tenant");
  return text(actor.displayName, "salesperson display name", 150) as string;
}

async function loadContact(transaction: Prisma.TransactionClient, tenantId: string, id: string) {
  const contact = await transaction.contact.findFirst({
    select: { id: true, name: true, phoneNumber: true },
    where: { id, tenantId, status: "ACTIVE" },
  });
  if (contact === null)
    throw new QuoteValidationError("Contact must be active and belong to the tenant");
  return {
    name: text(contact.name, "customer name", 150) as string,
    phone: text(contact.phoneNumber, "customer phone", 64) as string,
  };
}

async function loadUnit(transaction: Prisma.TransactionClient, tenantId: string, id: string) {
  const unit = await transaction.organizationUnit.findFirst({
    select: { id: true, name: true, active: true },
    where: { id, tenantId },
  });
  if (unit === null || !unit.active)
    throw new QuoteValidationError("Organization unit must be active and belong to the tenant");
  return text(unit.name, "organization unit name", 150) as string;
}

async function lockContact(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  id: string,
): Promise<void> {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "contact" WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${id}::uuid FOR UPDATE`,
  );
}

async function lockUnit(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  id: string,
): Promise<void> {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "organization_unit" WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${id}::uuid FOR UPDATE`,
  );
}

async function lockActor(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  id: string,
): Promise<void> {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "tenant_user" WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${id}::uuid FOR UPDATE`,
  );
}

async function lockProducts(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  productIds: readonly string[],
): Promise<void> {
  for (const id of [...new Set(productIds)].sort()) {
    await transaction.$queryRaw`SELECT "id" FROM "products" WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${id}::uuid FOR UPDATE`;
  }
}

async function normalizeLines(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  organizationUnitId: string,
  currencyCode: string,
  lines: ReturnType<typeof normalizedHeader>["lines"],
) {
  const productIds = [
    ...new Set(
      lines.flatMap((line) =>
        "productId" in line && line.productId !== null ? [line.productId] : [],
      ),
    ),
  ].sort();
  await lockProducts(transaction, tenantId, productIds);
  const products = await transaction.product.findMany({
    where: { tenantId, id: { in: productIds } },
    orderBy: { id: "asc" },
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  return lines.map((line) => {
    if (!("productId" in line) || line.productId === null) return line;
    const product = byId.get(line.productId);
    if (!product?.active)
      throw new QuoteValidationError("Product must be active and belong to the tenant");
    if (product.organizationUnitId !== null && product.organizationUnitId !== organizationUnitId)
      throw new QuoteValidationError(
        "Product organization unit must match the Quote organization unit",
      );
    if (product.currency !== currencyCode)
      throw new QuoteValidationError("Product currency must match Quote currency");
    const description = product.description?.trim() ? product.description : product.name;
    return {
      position: line.position,
      productId: product.id,
      source: "catalog",
      sku: product.sku,
      description: text(description, "description", QUOTE_DRAFT_LIMITS.lineDescription) as string,
      unit: text(product.unit, "unit", QUOTE_DRAFT_LIMITS.lineUnit) as string,
      quantity: line.quantity,
      unitPrice: product.price,
      currency: product.currency,
      taxCode: product.taxCode,
      taxRate: product.taxRate,
      discountKind: line.discountKind,
      discountValue: line.discountValue,
      isExceptional: product.isExceptional,
      metadata: null,
    };
  });
}

async function assertMetadataFitsDatabase(
  transaction: Prisma.TransactionClient,
  lines: readonly { metadata?: Prisma.InputJsonObject | null }[],
): Promise<void> {
  for (const line of lines) {
    if (line.metadata === undefined || line.metadata === null) continue;
    const [result] = await transaction.$queryRaw<Array<{ bytes: number }>>(Prisma.sql`
      SELECT octet_length(${JSON.stringify(line.metadata)}::jsonb::text) AS bytes
    `);
    if (result === undefined || result.bytes > QUOTE_DRAFT_LIMITS.lineMetadataBytes) {
      throw new QuoteValidationError("metadata exceeds 16 KiB UTF-8 when stored as JSONB");
    }
  }
}

function lineCreateData(tenantId: string, quoteId: string, line: Record<string, unknown>) {
  const data = { ...line };
  if (data.metadata === null) data.metadata = Prisma.DbNull;
  return { tenantId, quoteId, ...data } as Prisma.QuoteItemUncheckedCreateInput;
}

async function lockQuote(transaction: Prisma.TransactionClient, tenantId: string, id: string) {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "quotes" WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${id}::uuid FOR UPDATE`,
  );
  if (rows.length === 0) throw new QuoteNotFoundError(id);
  const quote = await loadQuote(transaction, tenantId, id);
  if (quote === null) throw new QuoteNotFoundError(id);
  return quote;
}

function outcome(quote: Quote): QuoteRecordedOutcome {
  return { quoteId: quote.id, number: quote.number, status: "draft", revision: quote.revision };
}

async function replayIfPresent(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  actorUserId: string,
  key: string,
  commandType: string,
  requestHash: string,
) {
  const receipt = await transaction.quoteCommandReceipt.findUnique({
    where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: key } },
  });
  if (!receipt) return null;
  if (
    receipt.actorUserId !== actorUserId ||
    receipt.commandType !== commandType ||
    receipt.requestHash !== requestHash
  )
    throw new QuoteCommandConflictError(
      "Idempotency key was already used for a different quote command",
    );
  if (receipt.quoteId === null)
    throw new QuoteCommandConflictError("Idempotency key belongs to a different quote resource");
  const current = await loadQuote(transaction, tenantId, receipt.quoteId);
  if (current === null) throw new QuoteNotFoundError(receipt.quoteId);
  return {
    replayed: true,
    recordedOutcome: receipt.recordedOutcome as unknown as QuoteRecordedOutcome,
    current: toView(current),
  } satisfies QuoteCommandOutcome<QuoteDraftView>;
}

function receiptData(
  tenantId: string,
  quote: Quote,
  actorUserId: string,
  key: string,
  commandType: string,
  requestHash: string,
) {
  return {
    tenantId,
    resourceId: quote.id,
    quoteId: quote.id,
    actorUserId,
    idempotencyKey: key,
    commandType,
    requestHash,
    recordedOutcome: outcome(quote),
  };
}

export async function createQuoteDraft(
  context: TenantContext,
  database: QuoteManagerDatabase,
  input: QuoteDraftInput,
  metadata: QuoteMutationMetadata,
): Promise<QuoteCommandOutcome<QuoteDraftView>> {
  const tenant = createTenantContext(context.tenantId);
  metadataValid(metadata);
  const actorUserId = requireUuid(metadata.actorUserId, "actorUserId");
  const normalized = normalizedHeader(input);
  const commandHash = hash({ commandType: "create", ...normalized, idempotencyKey: undefined });
  return database.$transaction(async (transaction) => {
    await commandLock(transaction, tenant.tenantId, normalized.idempotencyKey);
    await quoteTenantPolicyLock(transaction, tenant.tenantId);
    await numberLock(transaction, tenant.tenantId);
    const existingReceipt = await transaction.quoteCommandReceipt.findUnique({
      where: {
        tenantId_idempotencyKey: {
          tenantId: tenant.tenantId,
          idempotencyKey: normalized.idempotencyKey,
        },
      },
    });
    const existingQuote =
      existingReceipt?.quoteId === null || existingReceipt === null
        ? null
        : await lockQuote(transaction, tenant.tenantId, existingReceipt.quoteId);
    const resourceUnitId = existingQuote?.organizationUnitId ?? normalized.organizationUnitId;
    const resourceContactId = existingQuote?.contactId ?? normalized.contactId;
    const productIds = [
      ...normalized.lines.flatMap((line) => (line.productId === null ? [] : [line.productId])),
      ...(existingQuote?.items.flatMap((line) =>
        line.productId === null ? [] : [line.productId],
      ) ?? []),
    ];
    const actorDisplayNameBeforeLocks =
      existingQuote === null
        ? await assertCurrentActor(transaction, tenant.tenantId, actorUserId)
        : existingQuote.salespersonNameSnapshot;
    const contactBeforeLocks =
      existingQuote === null
        ? await loadContact(transaction, tenant.tenantId, normalized.contactId)
        : null;
    const unitNameBeforeLocks =
      existingQuote === null
        ? await loadUnit(transaction, tenant.tenantId, normalized.organizationUnitId)
        : null;
    let numberSequence: bigint | null = null;
    let number: string | null = null;
    let quote: Quote | null = null;
    if (existingQuote === null) {
      const initialContact = contactBeforeLocks;
      const initialUnitName = unitNameBeforeLocks;
      if (initialContact === null || initialUnitName === null)
        throw new QuoteValidationError("Initial Quote references must belong to the tenant");
      const maximum = await transaction.quote.aggregate({
        _max: { numberSequence: true },
        where: { tenantId: tenant.tenantId },
      });
      numberSequence = (maximum._max.numberSequence ?? 0n) + 1n;
      if (numberSequence > 9999999999n)
        throw new QuoteValidationError("Tenant quote number sequence has reached its maximum");
      number = `Q-${numberSequence.toString().padStart(6, "0")}`;
      quote = await transaction.quote.create({
        data: {
          tenantId: tenant.tenantId,
          organizationUnitId: normalized.organizationUnitId,
          contactId: normalized.contactId,
          createdByUserId: actorUserId,
          numberSequence,
          number,
          status: "draft",
          revision: 1,
          autonomyLevel: 0,
          currency: normalized.currency,
          currencyPrecision: normalized.currencyPrecision,
          validUntil: normalized.validUntil,
          terms: normalized.terms,
          notes: normalized.notes,
          shippingTotal: normalized.shippingTotal,
          customerNameSnapshot: initialContact.name,
          customerPhoneSnapshot: initialContact.phone,
          organizationUnitNameSnapshot: initialUnitName,
          salespersonNameSnapshot: actorDisplayNameBeforeLocks,
        },
      });
    }
    await lockProducts(transaction, tenant.tenantId, productIds);
    await lockContact(transaction, tenant.tenantId, resourceContactId);
    await lockUnit(transaction, tenant.tenantId, resourceUnitId);
    await lockActor(transaction, tenant.tenantId, actorUserId);
    const catalogRequired =
      existingQuote === null
        ? normalized.lines.some((line) => line.productId !== null)
        : existingQuote.items.some((line) => line.source === "catalog") ||
          normalized.lines.some((line) => line.productId !== null);
    await revalidateQuoteMutationAuthority(
      transaction,
      tenant,
      actorUserId,
      resourceUnitId,
      catalogRequired,
      true,
    );
    const replay = await replayIfPresent(
      transaction,
      tenant.tenantId,
      actorUserId,
      normalized.idempotencyKey,
      "create",
      commandHash,
    );
    if (replay) return replay;
    if (quote === null || number === null || numberSequence === null)
      throw new QuoteValidationError("Quote draft number allocation failed");
    const actorDisplayName = await assertCurrentActor(transaction, tenant.tenantId, actorUserId);
    const [contactSnapshot, unitName] = await Promise.all([
      loadContact(transaction, tenant.tenantId, normalized.contactId),
      loadUnit(transaction, tenant.tenantId, normalized.organizationUnitId),
    ]);
    await transaction.quote.update({
      where: { tenantId_id: { tenantId: tenant.tenantId, id: quote.id } },
      data: {
        customerNameSnapshot: contactSnapshot.name,
        customerPhoneSnapshot: contactSnapshot.phone,
        organizationUnitNameSnapshot: unitName,
        salespersonNameSnapshot: actorDisplayName,
      },
    });
    const lines = await normalizeLines(
      transaction,
      tenant.tenantId,
      normalized.organizationUnitId,
      normalized.currency,
      normalized.lines,
    );
    await assertMetadataFitsDatabase(transaction, lines);
    assertCommercialInputSize(
      {
        organizationUnitId: normalized.organizationUnitId,
        contactId: normalized.contactId,
        currency: normalized.currency,
        validUntil: normalized.validUntil,
        terms: normalized.terms,
        notes: normalized.notes,
        shippingTotal: normalized.shippingTotal,
      },
      lines as QuoteItem[],
    );
    await transaction.quoteItem.createMany({
      data: lines.map((line) =>
        lineCreateData(tenant.tenantId, quote.id, line as Record<string, unknown>),
      ),
    });
    await recalculateDraft(transaction, tenant.tenantId, quote.id, quote.revision);
    await transaction.quoteCommercialContributor.create({
      data: { tenantId: tenant.tenantId, quoteId: quote.id, userId: actorUserId },
    });
    const access = createTenantDataAccess(tenant, transaction);
    await access.audit.append({
      action: "quote.draft_created",
      actorId: actorUserId,
      actorType: "tenant_user",
      afterSummary: { number, revision: 1, status: "draft" },
      entityId: quote.id,
      entityType: "Quote",
      organizationUnitId: quote.organizationUnitId,
      requestId: metadata.requestId,
    });
    await access.outbox.append({
      aggregateId: quote.id,
      aggregateType: "Quote",
      eventType: "quote.draft_created",
      payload: { quoteId: quote.id, revision: 1 },
    });
    await transaction.quoteCommandReceipt.create({
      data: receiptData(
        tenant.tenantId,
        quote,
        actorUserId,
        normalized.idempotencyKey,
        "create",
        commandHash,
      ),
    });
    const created = await loadQuote(transaction, tenant.tenantId, quote.id);
    if (!created) throw new QuoteNotFoundError(quote.id);
    return { replayed: false, recordedOutcome: outcome(quote), current: toView(created) };
  });
}

export async function updateQuoteDraft(
  context: TenantContext,
  database: QuoteManagerDatabase,
  quoteId: string,
  expectedRevision: number,
  patch: QuoteDraftPatch,
  metadata: QuoteMutationMetadata,
): Promise<QuoteCommandOutcome<QuoteDraftView>> {
  const tenant = createTenantContext(context.tenantId);
  metadataValid(metadata);
  const actorUserId = requireUuid(metadata.actorUserId, "actorUserId");
  requireUuid(quoteId, "quoteId");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    throw new QuoteValidationError("expectedRevision is required");
  const normalizedPatch = normalizeUpdateIntent(patch);
  const key = normalizedPatch.idempotencyKey;
  const commandHash = hash({
    commandType: "update",
    quoteId: quoteId.toLowerCase(),
    expectedRevision,
    patch: { ...normalizedPatch, idempotencyKey: undefined },
  });
  return database.$transaction(async (transaction) => {
    await commandLock(transaction, tenant.tenantId, key);
    await quoteTenantPolicyLock(transaction, tenant.tenantId);
    const before = await lockQuote(transaction, tenant.tenantId, quoteId.toLowerCase());
    const changes = normalizedPatch.metadata ?? {};
    const nextUnitId =
      changes.organizationUnitId === undefined
        ? before.organizationUnitId
        : requireUuid(changes.organizationUnitId, "organizationUnitId");
    const nextContactId =
      changes.contactId === undefined
        ? before.contactId
        : requireUuid(changes.contactId, "contactId");
    const nextCurrency =
      changes.currency === undefined || changes.currency === before.currency
        ? { code: before.currency, precision: before.currencyPrecision }
        : currency(changes.currency);
    const nextValidUntil =
      changes.validUntil === undefined ? before.validUntil : validUntil(changes.validUntil);
    const nextTerms =
      changes.terms === undefined
        ? before.terms
        : text(changes.terms, "terms", QUOTE_DRAFT_LIMITS.terms, true);
    const nextNotes =
      changes.notes === undefined
        ? before.notes
        : text(changes.notes, "notes", QUOTE_DRAFT_LIMITS.notes, true);
    const nextShipping =
      changes.shippingTotal === undefined
        ? before.shippingTotal
        : new Prisma.Decimal(
            decimal(
              changes.shippingTotal,
              "shippingTotal",
              PRICE,
              QUOTE_DRAFT_LIMITS.maxCurrencyPrice,
            ),
          );
    const existingReceipt = await transaction.quoteCommandReceipt.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: tenant.tenantId, idempotencyKey: key } },
    });
    const replayingThisQuote = existingReceipt?.quoteId === before.id;
    const targetUnitId = replayingThisQuote ? before.organizationUnitId : nextUnitId;
    const targetContactId = replayingThisQuote ? before.contactId : nextContactId;
    const catalogRequired =
      before.items.some((line) => line.source === "catalog") ||
      normalizedPatch.replaceLines?.some((line) => line.productId !== null) === true;
    const productIds = [
      ...before.items.flatMap((line) => (line.productId === null ? [] : [line.productId])),
      ...(normalizedPatch.replaceLines?.flatMap((line) =>
        line.productId === null ? [] : [line.productId],
      ) ?? []),
    ];
    await lockProducts(transaction, tenant.tenantId, productIds);
    await lockContact(transaction, tenant.tenantId, targetContactId);
    await lockUnit(transaction, tenant.tenantId, targetUnitId);
    await lockActor(transaction, tenant.tenantId, actorUserId);
    await revalidateQuoteMutationAuthority(
      transaction,
      tenant,
      actorUserId,
      targetUnitId,
      catalogRequired,
      changes.contactId !== undefined,
    );
    const replay = await replayIfPresent(
      transaction,
      tenant.tenantId,
      actorUserId,
      key,
      "update",
      commandHash,
    );
    if (replay) return replay;
    if (before.revision !== expectedRevision)
      throw new QuoteRevisionConflictError("Quote revision does not match expectedRevision");
    if (before.status !== "draft")
      throw new QuoteValidationError("Only draft quotes are editable in S02");
    const contactSnapshot =
      nextContactId === before.contactId
        ? { name: before.customerNameSnapshot, phone: before.customerPhoneSnapshot }
        : await loadContact(transaction, tenant.tenantId, nextContactId);
    const unitName =
      nextUnitId === before.organizationUnitId
        ? before.organizationUnitNameSnapshot
        : await loadUnit(transaction, tenant.tenantId, nextUnitId);
    let replacement: ReturnType<typeof normalizedHeader>["lines"] | null = null;
    if (normalizedPatch.replaceLines !== undefined) {
      replacement = normalizedPatch.replaceLines.map((line, position) =>
        line.productId === null
          ? normalizedManualLine(
              line as Extract<QuoteLineInput, { productId: null }>,
              position,
              nextCurrency.code,
            )
          : (() => {
              const discount = normalizeDiscount(line.discount);
              return {
                position,
                productId: requireUuid(line.productId, "productId"),
                quantity: new Prisma.Decimal(quantity(line.quantity)),
                discountKind: discount.kind,
                discountValue: new Prisma.Decimal(discount.value),
              };
            })(),
      );
    }
    if (replacement === null && nextCurrency.code !== before.currency) {
      throw new QuoteValidationError("Changing Quote currency requires explicit line replacement");
    }
    if (
      replacement === null &&
      nextUnitId !== before.organizationUnitId &&
      before.items.some((line) => line.source === "catalog")
    ) {
      throw new QuoteValidationError(
        "Changing Quote unit or currency with catalog lines requires explicit line replacement or manual conversion",
      );
    }
    const metadataOnly = replacement === null && normalizedPatch.convertToManual === undefined;
    const normalizedLines =
      replacement === null
        ? null
        : await normalizeLines(
            transaction,
            tenant.tenantId,
            nextUnitId,
            nextCurrency.code,
            replacement,
          );
    const convertedLines = new Map<number, ReturnType<typeof normalizedManualLine>>();
    if (normalizedPatch.convertToManual !== undefined) {
      for (const conversion of normalizedPatch.convertToManual) {
        const existing = before.items.find((line) => line.position === conversion.position);
        if (existing?.source !== "catalog")
          throw new QuoteValidationError("Only catalog lines can be converted to manual");
        const normalized = normalizedManualLine(
          {
            ...conversion.snapshot,
            productId: null,
            quantity: existing.quantity.toFixed(3),
            discount: {
              kind: existing.discountKind as "fixed" | "percent",
              value: existing.discountValue.toFixed(4),
            },
          },
          existing.position,
          nextCurrency.code,
        );
        convertedLines.set(existing.position, normalized);
      }
    }
    const resultingLines =
      normalizedLines ?? before.items.map((line) => convertedLines.get(line.position) ?? line);
    assertCommercialInputSize(
      {
        organizationUnitId: nextUnitId,
        contactId: nextContactId,
        currency: nextCurrency.code,
        validUntil: nextValidUntil ?? null,
        terms: nextTerms,
        notes: nextNotes,
        shippingTotal: nextShipping,
      },
      resultingLines as QuoteItem[],
    );
    const beforeCommercial = commercialRepresentation(
      {
        organizationUnitId: before.organizationUnitId,
        contactId: before.contactId,
        currency: before.currency,
        validUntil: before.validUntil,
        terms: before.terms,
        notes: before.notes,
        shippingTotal: before.shippingTotal,
      },
      before.items,
    );
    const nextCommercial = commercialRepresentation(
      {
        organizationUnitId: nextUnitId,
        contactId: nextContactId,
        currency: nextCurrency.code,
        validUntil: nextValidUntil ?? null,
        terms: nextTerms,
        notes: nextNotes,
        shippingTotal: nextShipping,
      },
      resultingLines as QuoteItem[],
    );
    if (canonical(beforeCommercial) === canonical(nextCommercial)) {
      await transaction.quoteCommandReceipt.create({
        data: receiptData(tenant.tenantId, before, actorUserId, key, "update", commandHash),
      });
      return {
        replayed: false,
        recordedOutcome: outcome(before),
        current: toView(before),
      };
    }
    await transaction.quote.update({
      where: { tenantId_id: { tenantId: tenant.tenantId, id: before.id } },
      data: {
        organizationUnitId: nextUnitId,
        contactId: nextContactId,
        currency: nextCurrency.code,
        currencyPrecision: nextCurrency.precision,
        validUntil: nextValidUntil ?? null,
        terms: nextTerms,
        notes: nextNotes,
        shippingTotal: nextShipping,
        customerNameSnapshot: contactSnapshot.name,
        customerPhoneSnapshot: contactSnapshot.phone,
        organizationUnitNameSnapshot: unitName,
        revision: { increment: 1 },
        calculatedRevision: null,
        calculationInputHash: null,
        subtotal: null,
        discountTotal: null,
        taxTotal: null,
        total: null,
      },
    });
    if (normalizedLines !== null) {
      await assertMetadataFitsDatabase(transaction, normalizedLines);
      await transaction.quoteItem.deleteMany({
        where: { tenantId: tenant.tenantId, quoteId: before.id },
      });
      await transaction.quoteItem.createMany({
        data: normalizedLines.map((line) =>
          lineCreateData(tenant.tenantId, before.id, line as Record<string, unknown>),
        ),
      });
    } else if (normalizedPatch.convertToManual !== undefined) {
      for (const conversion of normalizedPatch.convertToManual) {
        const existing = before.items.find((line) => line.position === conversion.position);
        const normalized = convertedLines.get(conversion.position);
        if (!existing || !normalized)
          throw new QuoteValidationError("Only catalog lines can be converted to manual");
        await assertMetadataFitsDatabase(transaction, [normalized]);
        const manualData = {
          ...normalized,
          metadata: normalized.metadata === null ? Prisma.DbNull : normalized.metadata,
        };
        await transaction.quoteItem.update({
          where: { tenantId_id: { tenantId: tenant.tenantId, id: existing.id } },
          data: manualData as Prisma.QuoteItemUncheckedUpdateInput,
        });
      }
    } else if (!metadataOnly) throw new QuoteValidationError("Unsupported quote patch");
    await recalculateDraft(transaction, tenant.tenantId, before.id, before.revision + 1);
    await transaction.quoteCommercialContributor.upsert({
      where: {
        tenantId_quoteId_userId: {
          tenantId: tenant.tenantId,
          quoteId: before.id,
          userId: actorUserId,
        },
      },
      create: { tenantId: tenant.tenantId, quoteId: before.id, userId: actorUserId },
      update: {},
    });
    const updated = await loadQuote(transaction, tenant.tenantId, before.id);
    if (!updated) throw new QuoteNotFoundError(before.id);
    const access = createTenantDataAccess(tenant, transaction);
    await access.audit.append({
      action: "quote.draft_updated",
      actorId: actorUserId,
      actorType: "tenant_user",
      beforeSummary: { revision: before.revision, status: before.status },
      afterSummary: { revision: updated.revision, status: updated.status },
      entityId: before.id,
      entityType: "Quote",
      organizationUnitId: updated.organizationUnitId,
      requestId: metadata.requestId,
    });
    await access.outbox.append({
      aggregateId: before.id,
      aggregateType: "Quote",
      eventType: "quote.draft_updated",
      payload: { quoteId: before.id, revision: updated.revision },
    });
    await transaction.quoteCommandReceipt.create({
      data: receiptData(tenant.tenantId, updated, actorUserId, key, "update", commandHash),
    });
    return { replayed: false, recordedOutcome: outcome(updated), current: toView(updated) };
  });
}

export async function listQuotes(
  context: TenantContext,
  database: QuoteManagerDatabase,
  filters: QuoteListFilters = {},
): Promise<QuoteListPage> {
  const tenant = createTenantContext(context.tenantId);
  const limit = filters.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new QuoteValidationError("limit must be between 1 and 100");
  if (filters.cursor !== undefined) requireUuid(filters.cursor, "cursor");
  if (filters.contactId !== undefined) requireUuid(filters.contactId, "contactId");
  if (
    filters.status !== undefined &&
    ![
      "draft",
      "pending_approval",
      "approved",
      "rejected",
      "cancelled",
      "sent",
      "accepted",
    ].includes(filters.status)
  )
    throw new QuoteValidationError("status is invalid");
  const rows = await database.quote.findMany({
    where: {
      tenantId: tenant.tenantId,
      ...(filters.status === undefined ? {} : { status: filters.status }),
      ...(filters.contactId === undefined ? {} : { contactId: filters.contactId }),
      ...(filters.cursor === undefined ? {} : { id: { gt: filters.cursor } }),
    },
    include: { items: { orderBy: { position: "asc" } } },
    orderBy: [{ id: "asc" }],
    take: limit + 1,
  });
  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : rows;
  return { items: items.map(toView), nextCursor: hasNext ? (items.at(-1)?.id ?? null) : null };
}
