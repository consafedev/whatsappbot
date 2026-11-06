import type { QuoteLine } from "./quotes-view-model";

export type QuoteEditorLine = Readonly<
  | {
      source: "catalog";
      productId: string;
      quantity: string;
      discount?: Readonly<{ kind: "fixed" | "percent"; value: string }>;
      originalPosition?: number;
      explicitRefresh?: boolean;
    }
  | {
      source: "manual";
      sku?: string | null;
      description: string;
      unit: string;
      quantity: string;
      unitPrice: string;
      currency: string;
      taxCode?: string | null;
      taxRate?: string | null;
      discount?: Readonly<{ kind: "fixed" | "percent"; value: string }>;
      metadata?: unknown;
    }
>;

export type QuoteDraftInput = Readonly<{
  idempotencyKey: string;
  organizationUnitId: string;
  contactId: string;
  currency: string;
  lines: readonly Record<string, unknown>[];
  validUntil?: string | null;
  terms?: string | null;
  notes?: string | null;
  shippingTotal?: string;
}>;

export type QuoteDraftPatch = Readonly<{
  expectedRevision: number;
  idempotencyKey: string;
  metadata: Readonly<Record<string, string | null>>;
  replaceLines?: readonly Record<string, unknown>[];
}>;

const MAX_LINES = 200;
const MAX_INPUT_BYTES = 256 * 1024;
const DECIMAL = /^\d{1,15}(?:\.\d{1,4})?$/;
const QUANTITY = /^(?:0|[1-9]\d{0,5})(?:\.\d{1,3})?$/;
const PRICE = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,4})?$/;
const TAX_RATE = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/;
const PERCENT = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/;

function requireDecimal(value: string, name: string, pattern = DECIMAL): string {
  if (!pattern.test(value)) throw new Error(`${name} debe ser una cantidad decimal válida.`);
  return value;
}

function assertAtMostOneHundred(value: string, name: string): void {
  const [whole = "0", fraction = ""] = value.split(".");
  if (
    whole.length > 3 ||
    (whole.length === 3 && whole > "100") ||
    (whole === "100" && /[1-9]/.test(fraction))
  ) {
    throw new Error(`${name} no puede exceder 100.`);
  }
}

function serializeLines(lines: readonly QuoteEditorLine[]): readonly Record<string, unknown>[] {
  if (lines.length < 1 || lines.length > MAX_LINES) {
    throw new Error(`La cotización debe tener entre 1 y ${MAX_LINES} conceptos.`);
  }
  return lines.map((line) => {
    const quantity = requireDecimal(line.quantity, "La cantidad", QUANTITY);
    const discount = line.discount
      ? {
          kind: line.discount.kind,
          value: requireDecimal(
            line.discount.value,
            "El descuento",
            line.discount.kind === "percent" ? PERCENT : DECIMAL,
          ),
        }
      : undefined;
    if (discount?.kind === "percent")
      assertAtMostOneHundred(discount.value, "El descuento porcentual");
    if (line.source === "catalog") {
      if (!line.productId) throw new Error("Selecciona un producto válido del catálogo.");
      return { productId: line.productId, quantity, ...(discount ? { discount } : {}) };
    }
    requireDecimal(line.unitPrice, "El precio", PRICE);
    if (line.taxRate !== undefined && line.taxRate !== null) {
      requireDecimal(line.taxRate, "La tasa de impuesto", TAX_RATE);
      assertAtMostOneHundred(line.taxRate, "La tasa de impuesto");
    }
    const value = {
      productId: null,
      ...(line.sku === undefined ? {} : { sku: line.sku }),
      description: line.description,
      unit: line.unit,
      quantity,
      unitPrice: line.unitPrice,
      currency: line.currency,
      ...(line.taxCode === undefined ? {} : { taxCode: line.taxCode }),
      ...(line.taxRate === undefined ? {} : { taxRate: line.taxRate }),
      ...(discount ? { discount } : {}),
      ...(line.metadata === undefined ? {} : { metadata: line.metadata }),
    };
    return value;
  });
}

function assertBoundedBytes(value: unknown): void {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_INPUT_BYTES) {
    throw new Error("La información de la cotización excede el límite permitido.");
  }
}

export function buildQuoteDraftInput(input: {
  idempotencyKey: string;
  organizationUnitId: string;
  contactId: string;
  currency: string;
  lines: readonly QuoteEditorLine[];
  validUntil?: string | null;
  terms?: string | null;
  notes?: string | null;
  shippingTotal?: string;
}): QuoteDraftInput {
  const body = {
    idempotencyKey: input.idempotencyKey,
    organizationUnitId: input.organizationUnitId,
    contactId: input.contactId,
    currency: input.currency,
    lines: serializeLines(input.lines),
    ...(input.validUntil === undefined ? {} : { validUntil: input.validUntil }),
    ...(input.terms === undefined ? {} : { terms: input.terms }),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    ...(input.shippingTotal === undefined ? {} : { shippingTotal: input.shippingTotal }),
  };
  if (!/^[A-Z]{3}$/.test(body.currency))
    throw new Error("La moneda debe ser un código de tres letras en mayúsculas.");
  if (body.terms !== undefined && body.terms !== null && body.terms.length > 8000)
    throw new Error("Los términos no pueden exceder 8000 caracteres.");
  if (body.notes !== undefined && body.notes !== null && body.notes.length > 4000)
    throw new Error("Las notas internas no pueden exceder 4000 caracteres.");
  if (body.shippingTotal !== undefined) requireDecimal(body.shippingTotal, "El envío", PRICE);
  assertBoundedBytes(body);
  return body;
}

export function buildQuoteDraftPatch(input: {
  expectedRevision: number;
  idempotencyKey: string;
  metadata: Readonly<Record<string, string | null>>;
  lines?: readonly QuoteEditorLine[];
}): QuoteDraftPatch {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new Error("La revisión de la cotización no es válida.");
  }
  if (
    input.metadata.terms !== undefined &&
    input.metadata.terms !== null &&
    input.metadata.terms.length > 8000
  )
    throw new Error("Los términos no pueden exceder 8000 caracteres.");
  if (
    input.metadata.notes !== undefined &&
    input.metadata.notes !== null &&
    input.metadata.notes.length > 4000
  )
    throw new Error("Las notas internas no pueden exceder 4000 caracteres.");
  if (input.metadata.shippingTotal !== undefined && input.metadata.shippingTotal !== null)
    requireDecimal(input.metadata.shippingTotal, "El envío", PRICE);
  const body = {
    expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey,
    metadata: input.metadata,
    ...(input.lines === undefined ? {} : { replaceLines: serializeLines(input.lines) }),
  };
  if (input.metadata.currency && !/^[A-Z]{3}$/.test(input.metadata.currency))
    throw new Error("La moneda debe ser un código de tres letras en mayúsculas.");
  assertBoundedBytes(body);
  return body;
}

export function buildQuoteManualConversion(
  position: number,
  snapshot: Readonly<Record<string, unknown>>,
): Readonly<{ position: number; snapshot: Readonly<Record<string, unknown>> }> {
  if (!Number.isSafeInteger(position) || position < 0)
    throw new Error("La posición del concepto no es válida.");
  const allowed = new Set([
    "sku",
    "description",
    "unit",
    "unitPrice",
    "currency",
    "taxCode",
    "taxRate",
    "metadata",
  ]);
  if (Object.keys(snapshot).some((key) => !allowed.has(key)))
    throw new Error("El concepto manual contiene campos no permitidos.");
  for (const key of ["description", "unit", "unitPrice", "currency"] as const) {
    if (typeof snapshot[key] !== "string")
      throw new Error(`Falta el snapshot ${key} del concepto.`);
  }
  requireDecimal(snapshot.unitPrice as string, "El precio", PRICE);
  if (snapshot.taxRate !== undefined && snapshot.taxRate !== null) {
    if (typeof snapshot.taxRate !== "string")
      throw new Error("La tasa de impuesto debe ser decimal.");
    requireDecimal(snapshot.taxRate, "La tasa de impuesto", TAX_RATE);
    assertAtMostOneHundred(snapshot.taxRate, "La tasa de impuesto");
  }
  if (snapshot.sku !== undefined && snapshot.sku !== null && typeof snapshot.sku !== "string")
    throw new Error("El SKU debe ser texto o nulo.");
  if (
    snapshot.taxCode !== undefined &&
    snapshot.taxCode !== null &&
    typeof snapshot.taxCode !== "string"
  )
    throw new Error("El código fiscal debe ser texto o nulo.");
  const conversion = { position, snapshot };
  assertBoundedBytes(conversion);
  return conversion;
}

export function editorLinesFromQuote(quote: { lines: readonly QuoteLine[] }): QuoteEditorLine[] {
  return quote.lines.map((line) =>
    line.source === "catalog"
      ? {
          source: "catalog",
          productId: line.productId ?? "",
          quantity: line.quantity,
          discount: { kind: line.discountKind, value: line.discountValue },
        }
      : {
          source: "manual",
          sku: line.sku,
          description: line.description,
          unit: line.unit,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          currency: line.currency,
          taxCode: line.taxCode,
          taxRate: line.taxRate,
          discount: { kind: line.discountKind, value: line.discountValue },
          metadata: line.metadata,
        },
  );
}

function normalizedEditorLine(line: QuoteEditorLine): Readonly<Record<string, unknown>> {
  if (line.source === "catalog") {
    return {
      source: "catalog",
      productId: line.productId,
      quantity: line.quantity,
      discount: line.discount ?? null,
    };
  }
  return {
    source: "manual",
    sku: line.sku ?? null,
    description: line.description,
    unit: line.unit,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    currency: line.currency,
    taxCode: line.taxCode ?? null,
    taxRate: line.taxRate ?? null,
    discount: line.discount ?? null,
    metadata: line.metadata ?? null,
  };
}

export function quoteEditorLinesEqual(
  quote: { lines: readonly QuoteLine[] },
  lines: readonly QuoteEditorLine[],
): boolean {
  const saved = editorLinesFromQuote(quote);
  return (
    saved.length === lines.length &&
    saved.every((line, index) => {
      const edited = lines[index];
      return (
        edited !== undefined &&
        !(edited.source === "catalog" && edited.explicitRefresh) &&
        JSON.stringify(normalizedEditorLine(line)) === JSON.stringify(normalizedEditorLine(edited))
      );
    })
  );
}

export function catalogSnapshotPositionsNeedingConversion(
  quote: { lines: readonly QuoteLine[] },
  lines: readonly QuoteEditorLine[],
): number[] {
  if (quoteEditorLinesEqual(quote, lines)) return [];
  return lines.flatMap((line) =>
    line.source === "catalog" && line.originalPosition !== undefined && !line.explicitRefresh
      ? [line.originalPosition]
      : [],
  );
}

export function formatValidUntilForInput(value: string | null): string {
  if (value === null) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function resolveValidUntilInput(
  value: string,
  originalValue: string | null,
  edited: boolean,
): string | null {
  if (!edited) return originalValue;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("La fecha de vigencia no es válida.");
  return date.toISOString();
}
