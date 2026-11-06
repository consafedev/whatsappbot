import { describe, expect, it } from "vitest";
import {
  buildQuoteDraftInput,
  buildQuoteDraftPatch,
  buildQuoteManualConversion,
  catalogSnapshotPositionsNeedingConversion,
  formatValidUntilForInput,
  quoteEditorLinesEqual,
  resolveValidUntilInput,
} from "./quote-editor-model";
import type { Quote } from "./quotes-view-model";

describe("quote editor model", () => {
  const savedCatalogQuote = (): Quote => ({
    id: "q1",
    number: "Q-1",
    status: "draft",
    revision: 1,
    autonomyLevel: 0,
    organizationUnitId: "unit",
    contactId: "contact",
    currency: "MXN",
    currencyPrecision: 2,
    validUntil: null,
    terms: null,
    notes: null,
    shippingTotal: "0.0000",
    subtotal: null,
    discountTotal: null,
    taxTotal: null,
    total: null,
    calculatedRevision: null,
    calculationInputHash: null,
    customerNameSnapshot: "Cliente",
    customerPhoneSnapshot: "+521",
    organizationUnitNameSnapshot: "Ventas",
    salespersonNameSnapshot: "Ana",
    lines: [
      {
        id: "line-1",
        position: 0,
        productId: "product-1",
        source: "catalog",
        sku: "A-1",
        description: "Equipo snapshot",
        unit: "pieza",
        quantity: "1.000",
        unitPrice: "100.0000",
        currency: "MXN",
        taxCode: null,
        taxRate: "16.0000",
        discountKind: "fixed",
        discountValue: "0.0000",
        grossTotal: null,
        discountTotal: null,
        netTotal: null,
        taxTotal: null,
        lineTotal: null,
        isExceptional: false,
        metadata: null,
      },
    ],
    createdAt: "",
    updatedAt: "",
  });

  it("requires conversion or explicit refresh of every retained catalog snapshot before replaceLines", () => {
    const quote = savedCatalogQuote();
    const unchanged = {
      source: "catalog" as const,
      productId: "product-1",
      quantity: "1.000",
      discount: { kind: "fixed" as const, value: "0.0000" },
      originalPosition: 0,
    };
    expect(catalogSnapshotPositionsNeedingConversion(quote, [unchanged])).toEqual([]);
    expect(
      catalogSnapshotPositionsNeedingConversion(quote, [{ ...unchanged, quantity: "2.000" }]),
    ).toEqual([0]);
    expect(
      catalogSnapshotPositionsNeedingConversion(quote, [{ ...unchanged, explicitRefresh: true }]),
    ).toEqual([]);
    expect(
      catalogSnapshotPositionsNeedingConversion(quote, [
        {
          source: "manual",
          description: "Manual sibling edit",
          unit: "pieza",
          quantity: "1.000",
          unitPrice: "5.0000",
          currency: "MXN",
        },
        unchanged,
      ]),
    ).toEqual([0]);
  });

  it("serializes a refresh-only intent while leaving an untouched quote metadata-only", () => {
    const quote = savedCatalogQuote();
    const refreshOnly = [
      {
        source: "catalog" as const,
        productId: "product-1",
        quantity: "1.000",
        discount: { kind: "fixed" as const, value: "0.0000" },
        originalPosition: 0,
        explicitRefresh: true,
      },
    ];
    const refreshChangesLines = !quoteEditorLinesEqual(quote, refreshOnly);
    const refreshPatch = buildQuoteDraftPatch({
      expectedRevision: quote.revision,
      idempotencyKey: "refresh-key",
      metadata: { notes: "updated" },
      ...(refreshChangesLines ? { lines: refreshOnly } : {}),
    });
    expect("replaceLines" in refreshPatch).toBe(true);

    const unchanged = [
      {
        source: "catalog" as const,
        productId: "product-1",
        quantity: "1.000",
        discount: { kind: "fixed" as const, value: "0.0000" },
        originalPosition: 0,
      },
    ];
    expect(quoteEditorLinesEqual(quote, unchanged)).toBe(true);
    const metadataPatch = buildQuoteDraftPatch({
      expectedRevision: quote.revision,
      idempotencyKey: "metadata-key",
      metadata: { notes: "updated" },
      ...(quoteEditorLinesEqual(quote, unchanged) ? {} : { lines: unchanged }),
    });
    expect("replaceLines" in metadataPatch).toBe(false);

    const savedLine = quote.lines[0];
    if (!savedLine) throw new Error("Expected a saved catalog line fixture.");
    const quoteWithSibling = {
      ...quote,
      lines: [...quote.lines, { ...savedLine, id: "line-2", position: 1, productId: "product-2" }],
    };
    const [refreshedLine] = refreshOnly;
    if (!refreshedLine) throw new Error("Expected a refreshed catalog line fixture.");
    const mixedLines = [
      refreshedLine,
      {
        source: "catalog" as const,
        productId: "product-2",
        quantity: "1.000",
        discount: { kind: "fixed" as const, value: "0.0000" },
        originalPosition: 1,
      },
    ];
    expect(quoteEditorLinesEqual(quoteWithSibling, mixedLines)).toBe(false);
    expect(catalogSnapshotPositionsNeedingConversion(quoteWithSibling, mixedLines)).toEqual([1]);
  });

  it("renders validUntil as local wall time and preserves the original instant unless edited", () => {
    const original = "2026-11-05T12:34:56.789Z";
    expect(formatValidUntilForInput(original)).toBe("2026-11-05T06:34");
    expect(resolveValidUntilInput("2026-11-05T06:34", original, false)).toBe(original);
    expect(resolveValidUntilInput("2026-11-05T06:35", original, true)).toBe(
      new Date("2026-11-05T06:35").toISOString(),
    );
    expect(resolveValidUntilInput("", original, true)).toBeNull();
  });

  it("quoteEditorSerializesBoundedCatalogAndManualLinesWithoutTotalsOrActor", () => {
    const lines = [
      {
        source: "catalog" as const,
        productId: "product-1",
        quantity: "2.500",
        discount: { kind: "percent" as const, value: "10.0000" },
      },
      {
        source: "manual" as const,
        sku: "SVC",
        description: "Servicio",
        unit: "hora",
        quantity: "1.000",
        unitPrice: "999999999.9999",
        currency: "MXN",
        taxCode: null,
        taxRate: null,
        discount: { kind: "fixed" as const, value: "0.0000" },
      },
    ];
    const input = buildQuoteDraftInput({
      idempotencyKey: "draft-key",
      organizationUnitId: "unit-1",
      contactId: "contact-1",
      currency: "MXN",
      lines,
    });
    expect(input).toEqual({
      idempotencyKey: "draft-key",
      organizationUnitId: "unit-1",
      contactId: "contact-1",
      currency: "MXN",
      lines: [
        {
          productId: "product-1",
          quantity: "2.500",
          discount: { kind: "percent", value: "10.0000" },
        },
        {
          productId: null,
          sku: "SVC",
          description: "Servicio",
          unit: "hora",
          quantity: "1.000",
          unitPrice: "999999999.9999",
          currency: "MXN",
          taxCode: null,
          taxRate: null,
          discount: { kind: "fixed", value: "0.0000" },
        },
      ],
    });
    expect(JSON.stringify(input)).not.toMatch(/tenantId|actorId|total|subtotal|taxTotal/);
  });

  it("serializes expected revision and idempotency without authority or calculated fields", () => {
    const lines = [
      {
        source: "manual" as const,
        description: "Servicio",
        unit: "hora",
        quantity: "1.000",
        unitPrice: "10.0000",
        currency: "MXN",
      },
    ];
    const patch = buildQuoteDraftPatch({
      expectedRevision: 4,
      idempotencyKey: "key",
      metadata: { terms: "Net 30" },
      lines,
    });
    expect(patch).toEqual({
      expectedRevision: 4,
      idempotencyKey: "key",
      metadata: { terms: "Net 30" },
      replaceLines: [
        {
          productId: null,
          description: "Servicio",
          unit: "hora",
          quantity: "1.000",
          unitPrice: "10.0000",
          currency: "MXN",
        },
      ],
    });
    expect(JSON.stringify(patch)).not.toMatch(/actorId|tenantId|total|approvedBy/);
  });

  it("metadata-only edits omit replaceLines so Product snapshots are not refreshed", () => {
    const patch = buildQuoteDraftPatch({
      expectedRevision: 5,
      idempotencyKey: "metadata-key",
      metadata: { terms: "Updated" },
    });
    expect(patch).toEqual({
      expectedRevision: 5,
      idempotencyKey: "metadata-key",
      metadata: { terms: "Updated" },
    });
    expect("replaceLines" in patch).toBe(false);
  });

  it("converts a selected catalog snapshot without sending quantity, discount, totals, or actor fields", () => {
    expect(
      buildQuoteManualConversion(2, {
        sku: "A-1",
        description: "Equipo",
        unit: "pieza",
        unitPrice: "100.0000",
        currency: "MXN",
        taxCode: null,
        taxRate: "16.0000",
        metadata: { color: "azul" },
      }),
    ).toEqual({
      position: 2,
      snapshot: {
        sku: "A-1",
        description: "Equipo",
        unit: "pieza",
        unitPrice: "100.0000",
        currency: "MXN",
        taxCode: null,
        taxRate: "16.0000",
        metadata: { color: "azul" },
      },
    });
    expect(() =>
      buildQuoteManualConversion(0, {
        description: "x",
        unit: "u",
        unitPrice: "1.00",
        currency: "MXN",
        total: "1.00",
      }),
    ).toThrow(/campos no permitidos/);
  });

  it("rejects quote payloads above the server line and byte bounds", () => {
    const line = {
      source: "manual" as const,
      description: "x",
      unit: "u",
      quantity: "1.000",
      unitPrice: "1.0000",
      currency: "MXN",
    };
    expect(() =>
      buildQuoteDraftInput({
        idempotencyKey: "k",
        organizationUnitId: "u",
        contactId: "c",
        currency: "MXN",
        lines: Array.from({ length: 201 }, () => line),
      }),
    ).toThrow(/entre 1 y 200/);
    const largeLines = Array.from({ length: 200 }, () => ({
      ...line,
      description: "x".repeat(2000),
    }));
    expect(() =>
      buildQuoteDraftInput({
        idempotencyKey: "k",
        organizationUnitId: "u",
        contactId: "c",
        currency: "MXN",
        lines: largeLines,
      }),
    ).toThrow(/excede el límite/);
  });
});
