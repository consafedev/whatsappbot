import { describe, expect, it } from "vitest";
import {
  absentQuotePolicyHash,
  type CalculatedQuote,
  DEFAULT_QUOTE_POLICY,
  evaluateQuotePolicy,
  type QuotePolicyView,
  quotePolicyContentHash,
  type TrustedQuotePolicyFacts,
} from "./quote-policy";

const eligiblePolicy: QuotePolicyView = {
  ...DEFAULT_QUOTE_POLICY,
  autonomyLevel: 2,
  maxAutoSendAmount: "1000",
  maxAutoSendCurrency: "MXN",
  maxDiscountPercent: "100",
};

const eligibleLine: CalculatedQuote["lines"][number] = {
  gross: "1000.00",
  discount: "100.00",
  net: "900.00",
  tax: "100.00",
  lineTotal: "1000.00",
};

const eligibleQuote: CalculatedQuote = {
  currency: "MXN",
  total: "1000.00",
  lines: [eligibleLine],
};

const trustedFacts: TrustedQuotePolicyFacts = {
  stockAvailable: true,
  marginPercent: "30",
  returningCustomer: true,
  exceptionalProduct: false,
};

describe("quote policy evaluation", () => {
  it("defaultsToManualWithoutWriteOnReadAtRevisionZero", () => {
    expect(DEFAULT_QUOTE_POLICY).toMatchObject({
      autonomyLevel: 0,
      revision: 0,
      requireStock: false,
      newCustomerRequiresApproval: true,
      exceptionalProductRequiresApproval: true,
      allowSelfApproval: false,
      maxAutoSendAmount: null,
      maxAutoSendCurrency: null,
      maxDiscountPercent: null,
      minMarginPercent: null,
    });
  });

  it("absentDefaultHashIsDeterministic", () => {
    expect(absentQuotePolicyHash()).toBe(absentQuotePolicyHash());
    expect(absentQuotePolicyHash()).toMatch(/^[a-f0-9]{64}$/);
  });

  it("policyHashIncludesRevisionButNotActorOrTimestamp", () => {
    expect(quotePolicyContentHash(eligiblePolicy, 4)).toBe(
      quotePolicyContentHash({ ...eligiblePolicy }, 4),
    );
    expect(quotePolicyContentHash(eligiblePolicy, 4)).not.toBe(
      quotePolicyContentHash(eligiblePolicy, 5),
    );
  });

  it("changeAndRevertDoesNotResurrectPriorHash", () => {
    const initial = quotePolicyContentHash(eligiblePolicy, 4);
    const changed = quotePolicyContentHash({ ...eligiblePolicy, allowSelfApproval: true }, 5);
    const reverted = quotePolicyContentHash(eligiblePolicy, 6);
    expect(changed).not.toBe(initial);
    expect(reverted).not.toBe(initial);
  });

  it("requiresBoundedAmountAndCurrencyForAutonomyTwoOrThree", () => {
    const missingAmount = evaluateQuotePolicy(
      { ...eligiblePolicy, maxAutoSendAmount: null, maxAutoSendCurrency: null },
      eligibleQuote,
      trustedFacts,
    );
    const missingCurrency = evaluateQuotePolicy(
      { ...eligiblePolicy, maxAutoSendCurrency: null },
      eligibleQuote,
      trustedFacts,
    );
    expect(missingAmount.decision).toBe("HUMAN_REVIEW");
    expect(missingCurrency.decision).toBe("HUMAN_REVIEW");
  });

  it("comparesAmountInclusivelyAndCurrencyExactly", () => {
    expect(evaluateQuotePolicy(eligiblePolicy, eligibleQuote, trustedFacts).decision).toBe(
      "AUTO_APPROVE",
    );
    expect(
      evaluateQuotePolicy(eligiblePolicy, { ...eligibleQuote, total: "1000.01" }, trustedFacts)
        .decision,
    ).toBe("HUMAN_REVIEW");
    expect(
      evaluateQuotePolicy(eligiblePolicy, { ...eligibleQuote, currency: "USD" }, trustedFacts)
        .decision,
    ).toBe("HUMAN_REVIEW");
  });

  it("keepsAutonomyThreeWithinTheSameDeterministicGates", () => {
    expect(
      evaluateQuotePolicy({ ...eligiblePolicy, autonomyLevel: 3 }, eligibleQuote, trustedFacts)
        .decision,
    ).toBe("AUTO_APPROVE");
    expect(
      evaluateQuotePolicy(
        { ...eligiblePolicy, autonomyLevel: 3, minMarginPercent: "0" },
        eligibleQuote,
        { ...trustedFacts, marginPercent: "99" },
      ).decision,
    ).toBe("HUMAN_REVIEW");
  });

  it("blocksAutomaticWhenStockOrProtectedMarginIsUnknown", () => {
    expect(
      evaluateQuotePolicy({ ...eligiblePolicy, requireStock: true }, eligibleQuote, {
        ...trustedFacts,
        stockAvailable: null,
      }).decision,
    ).toBe("HUMAN_REVIEW");
    expect(
      evaluateQuotePolicy({ ...eligiblePolicy, minMarginPercent: "10" }, eligibleQuote, {
        ...trustedFacts,
        marginPercent: null,
      }).decision,
    ).toBe("HUMAN_REVIEW");
  });

  it("usesTrustedHistoryAndExceptionalFacts", () => {
    expect(
      evaluateQuotePolicy(eligiblePolicy, eligibleQuote, {
        ...trustedFacts,
        returningCustomer: false,
      }).decision,
    ).toBe("HUMAN_REVIEW");
    expect(
      evaluateQuotePolicy(eligiblePolicy, eligibleQuote, {
        ...trustedFacts,
        exceptionalProduct: true,
      }).decision,
    ).toBe("HUMAN_REVIEW");
  });

  it("defaultsExceptionalItemsToHumanReview", () => {
    expect(
      evaluateQuotePolicy(DEFAULT_QUOTE_POLICY, eligibleQuote, {
        ...trustedFacts,
        exceptionalProduct: true,
      }).decision,
    ).toBe("HUMAN_REVIEW");
  });

  it("appliesLineDiscountRatioWithIntegerComparison", () => {
    expect(
      evaluateQuotePolicy(
        { ...eligiblePolicy, maxDiscountPercent: "10" },
        eligibleQuote,
        trustedFacts,
      ).decision,
    ).toBe("AUTO_APPROVE");
    expect(
      evaluateQuotePolicy(
        { ...eligiblePolicy, maxDiscountPercent: "9.9999" },
        eligibleQuote,
        trustedFacts,
      ).decision,
    ).toBe("HUMAN_REVIEW");
  });

  it("requiresAnExplicitDiscountCeilingForAutomaticApproval", () => {
    const noDiscountQuote: CalculatedQuote = {
      ...eligibleQuote,
      lines: [
        { ...eligibleLine, discount: "0.00", net: "1000.00", tax: "0.00", lineTotal: "1000.00" },
      ],
    };
    expect(
      evaluateQuotePolicy(
        { ...eligiblePolicy, maxDiscountPercent: null },
        noDiscountQuote,
        trustedFacts,
      ).decision,
    ).toBe("HUMAN_REVIEW");
  });
});
