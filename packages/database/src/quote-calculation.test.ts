import { describe, expect, it } from "vitest";
import {
  calculateQuote,
  isDiscountWithinPercentCeiling,
  type QuoteCalculationInput,
  validateQuoteDecimal,
} from "./quote-calculation";

function line(
  overrides: Partial<QuoteCalculationInput["lines"][number]> = {},
): QuoteCalculationInput["lines"][number] {
  return {
    quantity: "1",
    unitPrice: "1",
    discountType: "fixed",
    discountValue: "0",
    taxRate: "0",
    currency: "USD",
    ...overrides,
  };
}

function quote(overrides: Partial<QuoteCalculationInput> = {}): QuoteCalculationInput {
  return {
    currency: "USD",
    currencyPrecision: 2,
    shippingTotal: "0",
    lines: [line()],
    ...overrides,
  };
}

describe("deterministic quote calculation", () => {
  it("quantityPriceDiscountAndExclusiveTaxGolden", () => {
    expect(
      calculateQuote(
        quote({
          lines: [
            line({
              quantity: "2.5",
              unitPrice: "10.00",
              discountType: "percent",
              discountValue: "10",
              taxRate: "8",
            }),
          ],
        }),
      ),
    ).toMatchObject({
      lines: [{ gross: "25.00", discount: "2.50", net: "22.50", tax: "1.80", lineTotal: "24.30" }],
      subtotal: "25.00",
      discountTotal: "2.50",
      taxTotal: "1.80",
      shippingTotal: "0.00",
      total: "24.30",
    });
  });

  it("halfUpBoundariesAtPrecisionZeroTwoThreeFour", () => {
    const cases = [
      { precision: 0, quantity: "1", unitPrice: "1.5", expected: "2" },
      { precision: 2, quantity: "1", unitPrice: "1.005", expected: "1.01" },
      { precision: 3, quantity: "1", unitPrice: "1.0005", expected: "1.001" },
      { precision: 4, quantity: "0.001", unitPrice: "0.05", expected: "0.0001" },
    ];
    for (const example of cases) {
      expect(
        calculateQuote(
          quote({
            currencyPrecision: example.precision,
            lines: [line({ quantity: example.quantity, unitPrice: example.unitPrice })],
          }),
        ).lines[0]?.gross,
      ).toBe(example.expected);
    }
  });

  it("fixedDiscountIsPerLine", () => {
    expect(
      calculateQuote(
        quote({
          lines: [
            line({ quantity: "3", unitPrice: "10", discountType: "fixed", discountValue: "4" }),
          ],
        }),
      ).lines[0],
    ).toMatchObject({ gross: "30.00", discount: "4.00", net: "26.00", lineTotal: "26.00" });
  });

  it("shippingIsUntaxed", () => {
    expect(
      calculateQuote(
        quote({
          shippingTotal: "5",
          lines: [line({ unitPrice: "10", taxRate: "10" })],
        }),
      ),
    ).toMatchObject({ subtotal: "10.00", taxTotal: "1.00", shippingTotal: "5.00", total: "16.00" });
  });

  it("lineAndAggregateTotalsAreExact", () => {
    expect(
      calculateQuote(
        quote({
          lines: [
            line({
              quantity: "2",
              unitPrice: "1.25",
              discountType: "percent",
              discountValue: "20",
              taxRate: "10",
            }),
            line({
              quantity: "1.5",
              unitPrice: "4",
              discountType: "fixed",
              discountValue: "1",
              taxRate: "0",
            }),
          ],
        }),
      ),
    ).toMatchObject({
      lines: [
        { gross: "2.50", discount: "0.50", net: "2.00", tax: "0.20", lineTotal: "2.20" },
        { gross: "6.00", discount: "1.00", net: "5.00", tax: "0.00", lineTotal: "5.00" },
      ],
      subtotal: "8.50",
      discountTotal: "1.50",
      taxTotal: "0.20",
      total: "7.20",
    });
  });

  it("calculationInputHashIsCanonicalAndChangesWithInputs", () => {
    const base = calculateQuote(
      quote({ lines: [line({ quantity: "1.000", unitPrice: "1.2300" })] }),
    );
    const equivalent = calculateQuote(
      quote({ lines: [line({ quantity: "1", unitPrice: "1.23" })] }),
    );
    const changed = calculateQuote(quote({ lines: [line({ quantity: "1", unitPrice: "1.24" })] }));
    const changedCurrency = calculateQuote(
      quote({
        currency: "EUR",
        lines: [line({ quantity: "1.000", unitPrice: "1.2300", currency: "EUR" })],
      }),
    );
    const changedPrecision = calculateQuote(
      quote({ currencyPrecision: 3, lines: [line({ quantity: "1.000", unitPrice: "1.2300" })] }),
    );
    const changedShipping = calculateQuote(
      quote({ shippingTotal: "1", lines: [line({ quantity: "1.000", unitPrice: "1.2300" })] }),
    );
    expect(equivalent.calculationInputHash).toBe(base.calculationInputHash);
    expect(changed.calculationInputHash).not.toBe(base.calculationInputHash);
    expect(changedCurrency.calculationInputHash).not.toBe(base.calculationInputHash);
    expect(changedPrecision.calculationInputHash).not.toBe(base.calculationInputHash);
    expect(changedShipping.calculationInputHash).not.toBe(base.calculationInputHash);
    expect(validateQuoteDecimal("0001.2300", "unitPrice")).toBe("1.23");
  });

  it("discountCeilingUsesExactCrossMultiplication", () => {
    expect(isDiscountWithinPercentCeiling("0.01", "0.03", "33.3334")).toBe(true);
    expect(isDiscountWithinPercentCeiling("0.02", "0.03", "66.6666")).toBe(false);
  });

  it("rejectsPositiveDiscountOnZeroGross", () => {
    expect(() =>
      calculateQuote(quote({ lines: [line({ unitPrice: "0", discountValue: "0.01" })] })),
    ).toThrow("positive discount is invalid when rounded line gross is zero");
  });

  it("rejectsMissingTaxRateAndMixedCurrency", () => {
    expect(() => calculateQuote(quote({ lines: [line({ taxRate: null })] }))).toThrow();
    expect(() => calculateQuote(quote({ lines: [line({ currency: "EUR" })] }))).toThrow();
  });

  it("rejectsFixedDiscountStorageOverflowAndCurrencyExcess", () => {
    expect(() =>
      calculateQuote(
        quote({
          lines: [line({ unitPrice: "999999999.9999", discountValue: "1000000000000000" })],
        }),
      ),
    ).toThrow();
    expect(() => calculateQuote(quote({ lines: [line({ discountValue: "0.001" })] }))).toThrow();
  });

  it("handlesLargeAggregateBeyondNumberSafeIntegerWithoutNumericCoercion", () => {
    const result = calculateQuote(
      quote({
        lines: Array.from({ length: 200 }, () =>
          line({ quantity: "999999.999", unitPrice: "999999999.9999" }),
        ),
      }),
    );
    expect(result.total).toBe("199999999799980000.00");
    expect(BigInt(result.total.replace(".", ""))).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
  });

  it("rejectsExponentNegativeExcessScaleOverflowAndMoreThan200Lines", () => {
    expect(() => validateQuoteDecimal("1e2", "unitPrice")).toThrow();
    expect(() => validateQuoteDecimal("-1", "quantity")).toThrow();
    expect(() => validateQuoteDecimal("1.0000", "quantity")).toThrow();
    expect(() => validateQuoteDecimal("1000000000", "unitPrice")).toThrow();
    expect(() => validateQuoteDecimal("1000000", "quantity")).toThrow();
    expect(() => validateQuoteDecimal("100.0001", "taxRate")).toThrow();
    expect(() => validateQuoteDecimal("1000000000", "shippingTotal")).toThrow();
    expect(() => validateQuoteDecimal("1000000000000000", "discountValue")).toThrow();
    expect(() => calculateQuote(quote({ shippingTotal: "1.001" }))).toThrow();
    expect(() =>
      calculateQuote(quote({ lines: Array.from({ length: 201 }, () => line()) })),
    ).toThrow();
  });
});
