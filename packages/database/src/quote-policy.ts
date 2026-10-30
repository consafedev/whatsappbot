import { createHash } from "node:crypto";
import { isDiscountWithinPercentCeiling } from "./quote-calculation";

export type QuotePolicyConfiguration = Readonly<{
  autonomyLevel: 0 | 1 | 2 | 3;
  maxAutoSendAmount: string | null;
  maxAutoSendCurrency: string | null;
  maxDiscountPercent: string | null;
  minMarginPercent: string | null;
  requireStock: boolean;
  newCustomerRequiresApproval: boolean;
  exceptionalProductRequiresApproval: boolean;
  allowSelfApproval: boolean;
}>;

export type QuotePolicyView = QuotePolicyConfiguration &
  Readonly<{ revision: number; contentHash: string }>;

export type QuotePolicyInput = Readonly<{
  idempotencyKey: string;
  expectedRevision: number;
  autonomyLevel: 0 | 1 | 2 | 3;
  maxAutoSendAmount?: string | null;
  maxAutoSendCurrency?: string | null;
  maxDiscountPercent?: string | null;
  minMarginPercent?: string | null;
  requireStock?: boolean;
  newCustomerRequiresApproval?: boolean;
  exceptionalProductRequiresApproval?: boolean;
  allowSelfApproval?: boolean;
}>;

export type QuoteMutationMetadata = Readonly<{ actorUserId: string; requestId: string }>;

export type CalculatedQuote = Readonly<{
  currency: string;
  total: string;
  lines: readonly Readonly<{
    gross: string;
    discount: string;
    net: string;
    tax: string;
    lineTotal: string;
  }>[];
}>;

/** Facts must be resolved from tenant-scoped database state by the caller. */
export type TrustedQuotePolicyFacts = Readonly<{
  stockAvailable: boolean | null;
  marginPercent: string | null;
  returningCustomer: boolean;
  exceptionalProduct: boolean;
}>;

export type QuotePolicyEvaluation = Readonly<{
  decision: "AUTO_APPROVE" | "HUMAN_REVIEW";
  reasons: readonly QuotePolicyReason[];
}>;

export type QuotePolicyReason =
  | "manual_policy"
  | "automatic_amount_currency_required"
  | "amount_exceeds_policy_limit"
  | "currency_does_not_match_policy"
  | "discount_ceiling_not_configured"
  | "discount_exceeds_policy_limit"
  | "stock_requirement_unverifiable"
  | "minimum_margin_unverifiable"
  | "new_customer_requires_approval"
  | "exceptional_product_requires_approval";

export const DEFAULT_QUOTE_POLICY_CONFIGURATION: QuotePolicyConfiguration = Object.freeze({
  autonomyLevel: 0,
  maxAutoSendAmount: null,
  maxAutoSendCurrency: null,
  maxDiscountPercent: null,
  minMarginPercent: null,
  requireStock: false,
  newCustomerRequiresApproval: true,
  exceptionalProductRequiresApproval: true,
  allowSelfApproval: false,
});

export function quotePolicyContentHash(
  configuration: QuotePolicyConfiguration,
  revision: number,
): string {
  const canonical = JSON.stringify({
    autonomyLevel: configuration.autonomyLevel,
    maxAutoSendAmount: configuration.maxAutoSendAmount,
    maxAutoSendCurrency: configuration.maxAutoSendCurrency,
    maxDiscountPercent: configuration.maxDiscountPercent,
    minMarginPercent: configuration.minMarginPercent,
    requireStock: configuration.requireStock,
    newCustomerRequiresApproval: configuration.newCustomerRequiresApproval,
    exceptionalProductRequiresApproval: configuration.exceptionalProductRequiresApproval,
    allowSelfApproval: configuration.allowSelfApproval,
    revision,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export const DEFAULT_QUOTE_POLICY: QuotePolicyView = Object.freeze({
  ...DEFAULT_QUOTE_POLICY_CONFIGURATION,
  revision: 0,
  contentHash: quotePolicyContentHash(DEFAULT_QUOTE_POLICY_CONFIGURATION, 0),
});

export function absentQuotePolicyHash(): string {
  return DEFAULT_QUOTE_POLICY.contentHash;
}

function compareDecimal(left: string, right: string): number {
  const toParts = (value: string) => {
    if (!/^\d{1,20}(?:\.\d{1,4})?$/.test(value))
      throw new TypeError("quote policy amount must fit NUMERIC(24,4)");
    const [whole = "0", fraction = ""] = value.split(".");
    return BigInt(`${whole}${fraction}`) * 10n ** BigInt(4 - fraction.length);
  };
  const a = toParts(left);
  const b = toParts(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function evaluateQuotePolicy(
  policy: QuotePolicyView,
  quote: CalculatedQuote,
  facts: TrustedQuotePolicyFacts,
): QuotePolicyEvaluation {
  const reasons: QuotePolicyReason[] = [];
  if (policy.autonomyLevel < 2) reasons.push("manual_policy");

  if (policy.autonomyLevel >= 2) {
    if (policy.maxAutoSendAmount === null || policy.maxAutoSendCurrency === null) {
      reasons.push("automatic_amount_currency_required");
    } else {
      if (quote.currency !== policy.maxAutoSendCurrency)
        reasons.push("currency_does_not_match_policy");
      if (compareDecimal(quote.total, policy.maxAutoSendAmount) > 0)
        reasons.push("amount_exceeds_policy_limit");
    }
    if (policy.maxDiscountPercent === null) {
      reasons.push("discount_ceiling_not_configured");
    } else if (
      quote.lines.some(
        (line) =>
          !isDiscountWithinPercentCeiling(
            line.discount,
            line.gross,
            policy.maxDiscountPercent as string,
          ),
      )
    ) {
      reasons.push("discount_exceeds_policy_limit");
    }
    if (policy.requireStock) reasons.push("stock_requirement_unverifiable");
    if (policy.minMarginPercent !== null) reasons.push("minimum_margin_unverifiable");
    if (policy.newCustomerRequiresApproval && !facts.returningCustomer)
      reasons.push("new_customer_requires_approval");
    if (policy.exceptionalProductRequiresApproval && facts.exceptionalProduct)
      reasons.push("exceptional_product_requires_approval");
  }

  return reasons.length === 0
    ? { decision: "AUTO_APPROVE", reasons }
    : { decision: "HUMAN_REVIEW", reasons };
}
