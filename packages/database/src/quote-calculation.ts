import { createHash } from "node:crypto";
import type { Prisma } from "./generated/prisma/client";

export const QUOTE_CALCULATION_LIMITS = Object.freeze({
  aggregateIntegerDigits: 20,
  discount: "999999999999999.9999",
  itemCount: 200,
  maxCurrencyAmount: "999999999.9999",
  maxQuantity: "999999.999",
  maxRate: "100",
});

export type QuoteDecimalField =
  | "quantity"
  | "unitPrice"
  | "discountValue"
  | "taxRate"
  | "shippingTotal";

export type QuoteCalculationLineInput = Readonly<{
  quantity: string;
  unitPrice: string;
  discountType: "fixed" | "percent";
  discountValue: string;
  taxRate: string | null;
  currency: string;
}>;

export type QuoteCalculationInput = Readonly<{
  currency: string;
  currencyPrecision: number;
  shippingTotal: string;
  lines: readonly QuoteCalculationLineInput[];
}>;

export type QuoteCalculationLineResult = Readonly<{
  gross: string;
  discount: string;
  net: string;
  tax: string;
  lineTotal: string;
}>;

export type QuoteCalculationResult = Readonly<{
  lines: readonly QuoteCalculationLineResult[];
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  shippingTotal: string;
  total: string;
  calculationInputHash: string;
}>;

export class QuoteCalculationValidationError extends Error {
  override readonly name = "QuoteCalculationValidationError";
}

type DecimalParts = Readonly<{ coefficient: bigint; scale: number }>;

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;
const DECIMAL_RULES: Readonly<
  Record<QuoteDecimalField, Readonly<{ maxScale: number; maxValue: string }>>
> = {
  quantity: { maxScale: 3, maxValue: QUOTE_CALCULATION_LIMITS.maxQuantity },
  unitPrice: { maxScale: 4, maxValue: QUOTE_CALCULATION_LIMITS.maxCurrencyAmount },
  discountValue: { maxScale: 4, maxValue: QUOTE_CALCULATION_LIMITS.discount },
  taxRate: { maxScale: 4, maxValue: QUOTE_CALCULATION_LIMITS.maxRate },
  shippingTotal: { maxScale: 4, maxValue: QUOTE_CALCULATION_LIMITS.maxCurrencyAmount },
};

function fail(message: string): never {
  throw new QuoteCalculationValidationError(message);
}

function parseDecimal(value: unknown, field: QuoteDecimalField): DecimalParts {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    return fail(`${field} must be a non-negative plain decimal string`);
  }
  const rule = DECIMAL_RULES[field];
  if (rule === undefined) return fail("decimal field is not supported");
  const [whole, fractional = ""] = value.split(".");
  if (fractional.length > rule.maxScale) {
    return fail(`${field} has too many fractional digits`);
  }
  const coefficient = BigInt(`${whole}${fractional}`);
  const parsed = { coefficient, scale: fractional.length };
  if (compareParts(parsed, parseUnchecked(rule.maxValue)) > 0) {
    return fail(`${field} exceeds its maximum value`);
  }
  if (field === "quantity" && coefficient === 0n) {
    return fail("quantity must be greater than zero");
  }
  return parsed;
}

function parseUnchecked(value: string): DecimalParts {
  const [whole, fractional = ""] = value.split(".");
  return { coefficient: BigInt(`${whole}${fractional}`), scale: fractional.length };
}

function pow10(scale: number): bigint {
  return 10n ** BigInt(scale);
}

function compareParts(left: DecimalParts, right: DecimalParts): number {
  const scale = Math.max(left.scale, right.scale);
  const a = left.coefficient * pow10(scale - left.scale);
  const b = right.coefficient * pow10(scale - right.scale);
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalDecimal(value: DecimalParts): string {
  if (value.coefficient === 0n) return "0";
  let coefficient = value.coefficient;
  let scale = value.scale;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  if (scale === 0) return coefficient.toString();
  const digits = coefficient.toString().padStart(scale + 1, "0");
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

function roundRational(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < 0n) return fail("invalid non-negative rational");
  const whole = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? whole + 1n : whole;
}

function toMinorUnits(value: DecimalParts, precision: number, field: string): bigint {
  if (value.scale <= precision) return value.coefficient * pow10(precision - value.scale);
  const excessScale = value.scale - precision;
  const divisor = pow10(excessScale);
  if (value.coefficient % divisor !== 0n) {
    return fail(`${field} has nonzero fractional digits beyond quote currency precision`);
  }
  return value.coefficient / divisor;
}

function roundAmount(numerator: bigint, denominator: bigint, precision: number): bigint {
  return roundRational(numerator * pow10(precision), denominator);
}

function formatMinorUnits(value: bigint, precision: number): string {
  const digits = value.toString().padStart(precision + 1, "0");
  if (precision === 0) return digits;
  return `${digits.slice(0, -precision)}.${digits.slice(-precision)}`;
}

function assertAggregateBound(value: bigint, precision: number): void {
  const maximum = pow10(QUOTE_CALCULATION_LIMITS.aggregateIntegerDigits + precision) - 1n;
  if (value > maximum) fail("aggregate amount exceeds NUMERIC(24,4) capacity");
}

export function validateQuoteDecimal(value: string, field: QuoteDecimalField): string {
  return canonicalDecimal(parseDecimal(value, field));
}

export function isDiscountWithinPercentCeiling(
  discount: string,
  gross: string,
  maximumPercent: string,
): boolean {
  const parseAmount = (value: string): DecimalParts => {
    if (typeof value !== "string" || !DECIMAL_PATTERN.test(value))
      return fail("discount and gross must be non-negative decimal strings");
    const [wholePart, fractional = ""] = value.split(".");
    const whole = wholePart ?? "";
    if (whole.length > QUOTE_CALCULATION_LIMITS.aggregateIntegerDigits || fractional.length > 4)
      return fail("discount or gross exceeds aggregate amount precision");
    return { coefficient: BigInt(`${whole}${fractional}`), scale: fractional.length };
  };
  const discountParts = parseAmount(discount);
  const grossParts = parseAmount(gross);
  const maximumParts = parseDecimal(maximumPercent, "taxRate");
  if (compareParts(maximumParts, parseUnchecked(QUOTE_CALCULATION_LIMITS.maxRate)) > 0)
    return fail("maximum discount percent must not exceed 100");
  if (grossParts.coefficient === 0n) return discountParts.coefficient === 0n;
  if (compareParts(discountParts, grossParts) > 0) return false;
  return (
    discountParts.coefficient * 100n * pow10(grossParts.scale + maximumParts.scale) <=
    grossParts.coefficient * maximumParts.coefficient * pow10(discountParts.scale)
  );
}

function assertInput(input: QuoteCalculationInput): void {
  if (input === null || typeof input !== "object") fail("quote calculation input is required");
  if (typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency))
    fail("currency must be an uppercase three-character code");
  if (
    !Number.isInteger(input.currencyPrecision) ||
    input.currencyPrecision < 0 ||
    input.currencyPrecision > 4
  )
    fail("currencyPrecision must be an integer from 0 to 4");
  if (
    !Array.isArray(input.lines) ||
    input.lines.length < 1 ||
    input.lines.length > QUOTE_CALCULATION_LIMITS.itemCount
  )
    fail("lines must contain 1 to 200 items");
}

export function calculateQuote(input: QuoteCalculationInput): QuoteCalculationResult {
  assertInput(input);
  const precision = input.currencyPrecision;
  const shipping = parseDecimal(input.shippingTotal, "shippingTotal");
  const shippingMinor = toMinorUnits(shipping, precision, "shippingTotal");
  const canonicalLines: Array<Record<string, string | null>> = [];
  let subtotal = 0n;
  let discountTotal = 0n;
  let taxTotal = 0n;
  const results = input.lines.map((line) => {
    if (line.currency !== input.currency) fail("line currency must match quote currency");
    if (line.discountType !== "fixed" && line.discountType !== "percent")
      fail("discountType must be fixed or percent");
    if (line.taxRate === null) fail("taxRate must be configured before calculation");

    const quantity = parseDecimal(line.quantity, "quantity");
    const unitPrice = parseDecimal(line.unitPrice, "unitPrice");
    const discount = parseDecimal(
      line.discountValue,
      line.discountType === "percent" ? "taxRate" : "discountValue",
    );
    const taxRate = parseDecimal(line.taxRate, "taxRate");
    if (compareParts(taxRate, parseUnchecked(QUOTE_CALCULATION_LIMITS.maxRate)) > 0)
      fail("taxRate must not exceed 100");

    const grossMinor = roundAmount(
      quantity.coefficient * unitPrice.coefficient,
      pow10(quantity.scale + unitPrice.scale),
      precision,
    );
    const discountMinor =
      line.discountType === "percent"
        ? roundRational(grossMinor * discount.coefficient, 100n * pow10(discount.scale))
        : toMinorUnits(discount, precision, "fixed discount");
    if (grossMinor === 0n && discountMinor > 0n)
      fail("positive discount is invalid when rounded line gross is zero");
    if (discountMinor > grossMinor) fail("discount must not exceed rounded line gross");
    const netMinor = grossMinor - discountMinor;
    const taxMinor = roundRational(netMinor * taxRate.coefficient, 100n * pow10(taxRate.scale));
    const lineTotalMinor = netMinor + taxMinor;
    subtotal += grossMinor;
    discountTotal += discountMinor;
    taxTotal += taxMinor;
    assertAggregateBound(grossMinor, precision);
    assertAggregateBound(discountMinor, precision);
    assertAggregateBound(taxMinor, precision);
    assertAggregateBound(lineTotalMinor, precision);

    canonicalLines.push({
      quantity: canonicalDecimal(quantity),
      unitPrice: canonicalDecimal(unitPrice),
      discountType: line.discountType,
      discountValue: canonicalDecimal(discount),
      taxRate: canonicalDecimal(taxRate),
      currency: input.currency,
    });
    return {
      gross: formatMinorUnits(grossMinor, precision),
      discount: formatMinorUnits(discountMinor, precision),
      net: formatMinorUnits(netMinor, precision),
      tax: formatMinorUnits(taxMinor, precision),
      lineTotal: formatMinorUnits(lineTotalMinor, precision),
    };
  });

  const total = subtotal - discountTotal + taxTotal + shippingMinor;
  for (const amount of [subtotal, discountTotal, taxTotal, shippingMinor, total])
    assertAggregateBound(amount, precision);

  const canonicalInput = {
    currency: input.currency,
    currencyPrecision: precision,
    shippingTotal: canonicalDecimal(shipping),
    lines: canonicalLines,
  };
  const calculationInputHash = createHash("sha256")
    .update(JSON.stringify(canonicalInput))
    .digest("hex");

  return {
    lines: results,
    subtotal: formatMinorUnits(subtotal, precision),
    discountTotal: formatMinorUnits(discountTotal, precision),
    taxTotal: formatMinorUnits(taxTotal, precision),
    shippingTotal: formatMinorUnits(shippingMinor, precision),
    total: formatMinorUnits(total, precision),
    calculationInputHash,
  };
}

export async function recalculateQuoteInTransaction(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  quoteId: string,
  nextRevision: number,
): Promise<QuoteCalculationResult> {
  if (!Number.isSafeInteger(nextRevision) || nextRevision < 1)
    fail("nextRevision must be a positive safe integer");
  const quote = await transaction.quote.findFirst({
    where: { tenantId, id: quoteId },
    include: { items: { orderBy: { position: "asc" } } },
  });
  if (quote === null) fail("Quote must belong to the tenant before calculation");

  const result = calculateQuote({
    currency: quote.currency,
    currencyPrecision: quote.currencyPrecision,
    shippingTotal: quote.shippingTotal.toString(),
    lines: quote.items.map((item) => ({
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      discountType: item.discountKind as "fixed" | "percent",
      discountValue: item.discountValue.toString(),
      taxRate: item.taxRate?.toString() ?? null,
      currency: item.currency,
    })),
  });

  for (const [index, item] of quote.items.entries()) {
    const line = result.lines[index];
    if (line === undefined) fail("calculated line result is missing");
    await transaction.quoteItem.update({
      where: { tenantId_id: { tenantId, id: item.id } },
      data: {
        grossTotal: line.gross,
        discountTotal: line.discount,
        netTotal: line.net,
        taxTotal: line.tax,
        lineTotal: line.lineTotal,
      },
    });
  }
  await transaction.quote.update({
    where: { tenantId_id: { tenantId, id: quoteId } },
    data: {
      revision: nextRevision,
      subtotal: result.subtotal,
      discountTotal: result.discountTotal,
      taxTotal: result.taxTotal,
      total: result.total,
      calculatedRevision: nextRevision,
      calculationInputHash: result.calculationInputHash,
    },
  });
  return result;
}
