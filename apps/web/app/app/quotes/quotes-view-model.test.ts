import { describe, expect, it } from "vitest";
import {
  formatQuoteMoney,
  getQuoteCapabilities,
  getQuotesPageState,
  type Quote,
  quoteActions,
  replayDescription,
} from "./quotes-view-model";

const quote = (overrides: Partial<Quote> = {}): Quote => ({
  id: "q1",
  number: "Q-000001",
  status: "draft",
  revision: 2,
  autonomyLevel: 0,
  organizationUnitId: "unit",
  contactId: "contact",
  currency: "MXN",
  currencyPrecision: 2,
  validUntil: null,
  terms: null,
  notes: null,
  shippingTotal: "0.0000",
  subtotal: "10.00",
  discountTotal: "0.00",
  taxTotal: "0.00",
  total: "10.00",
  calculatedRevision: 2,
  calculationInputHash: "hash",
  customerNameSnapshot: "Cliente",
  customerPhoneSnapshot: "+521",
  organizationUnitNameSnapshot: "Ventas",
  salespersonNameSnapshot: "Ana",
  lines: [],
  createdAt: "",
  updatedAt: "",
  ...overrides,
});

describe("quotes view model", () => {
  it("quoteActionsFollowPermissionAndStatus", () => {
    const readable = getQuoteCapabilities({
      modules: ["module.quotes"],
      permissions: ["quotes.read"],
    });
    expect(readable.canRead).toBe(true);
    expect(readable.canCreate).toBe(false);
    expect(readable.canApprove).toBe(false);

    expect(
      getQuoteCapabilities({
        modules: ["module.quotes"],
        permissions: ["quotes.create", "quotes.approve"],
      }),
    ).toMatchObject({ canRead: false, canCreate: true, canApprove: true });

    const createOnly = getQuoteCapabilities({
      modules: ["module.quotes", "module.crm_lite"],
      permissions: ["quotes.create"],
    });
    expect(quoteActions(quote(), createOnly)).toMatchObject({
      canEdit: true,
      canRequestApproval: true,
      canApprove: false,
      canSend: false,
    });
    expect(quoteActions(quote({ status: "sent" }), createOnly)).toMatchObject({
      canEdit: false,
      canRequestApproval: false,
      canCancel: false,
    });
    const crmOff = getQuoteCapabilities({
      modules: ["module.quotes"],
      permissions: ["quotes.create", "quotes.approve"],
    });
    expect(quoteActions(quote({ status: "pending_approval" }), crmOff)).toMatchObject({
      canRequestApproval: false,
      canApprove: false,
      canReject: false,
      canCancel: true,
    });
  });

  it("approvalAndPolicyPanelsReflectCurrentGuards", () => {
    const full = getQuoteCapabilities({
      modules: ["module.quotes", "module.crm_lite"],
      permissions: ["quotes.read", "quotes.create", "quotes.approve", "tenant.settings.manage"],
    });
    const expiredPending = quote({
      status: "pending_approval",
      validUntil: "2020-01-01T00:00:00.000Z",
    });
    expect(
      quoteActions(expiredPending, full, Date.parse("2025-01-01T00:00:00.000Z")),
    ).toMatchObject({
      canRequestApproval: false,
      canApprove: false,
      canReject: true,
      canCancel: true,
      expired: true,
    });
    expect(full.canManagePolicy).toBe(true);
    expect(
      getQuoteCapabilities({ modules: ["module.quotes"], permissions: ["quotes.approve"] })
        .canManagePolicy,
    ).toBe(false);
  });

  it("does not offer another request while pending authority freshness is not readable", () => {
    const full = getQuoteCapabilities({
      modules: ["module.quotes", "module.crm_lite"],
      permissions: ["quotes.read", "quotes.create", "quotes.approve"],
    });
    expect(quoteActions(quote({ status: "pending_approval" }), full)).toMatchObject({
      canRequestApproval: false,
    });
  });

  it("quoteListShowsPermissionAndModuleLoadingEmptyAndErrorStates", () => {
    expect(
      getQuotesPageState({
        moduleEnabled: false,
        canRead: true,
        loading: false,
        error: null,
        items: [],
      }),
    ).toBe("module-disabled");
    expect(
      getQuotesPageState({
        moduleEnabled: true,
        canRead: false,
        loading: false,
        error: null,
        items: [],
      }),
    ).toBe("permission-denied");
    expect(
      getQuotesPageState({
        moduleEnabled: true,
        canRead: true,
        loading: true,
        error: null,
        items: [],
      }),
    ).toBe("loading");
    expect(
      getQuotesPageState({
        moduleEnabled: true,
        canRead: true,
        loading: false,
        error: "offline",
        items: [],
      }),
    ).toBe("error");
    expect(
      getQuotesPageState({
        moduleEnabled: true,
        canRead: true,
        loading: false,
        error: null,
        items: [],
      }),
    ).toBe("empty");
  });

  it("quoteListAndEditorKeepExactDecimalStringsIncludingHugeTotals", () => {
    expect(formatQuoteMoney("99999999999999999999.99", "MXN", 2)).toBe(
      "99,999,999,999,999,999,999.99 MXN",
    );
  });

  it("replayOutcomeIsLabeledSeparateFromCurrentQuote", () => {
    expect(
      replayDescription({
        replayed: true,
        recordedOutcome: { status: "approved", revision: 3 },
        current: { status: "draft", revision: 5 },
      }),
    ).toBe(
      "Reintento reconocido. Acción original: approved (revisión 3). Estado actual: draft (revisión 5).",
    );
    expect(
      replayDescription({
        replayed: false,
        recordedOutcome: { status: "cancelled", revision: 6, result: "already_cancelled" },
        current: { status: "cancelled", revision: 6 },
      }),
    ).toBe(
      "Resultado registrado: already_cancelled. Acción original: cancelled (revisión 6). Estado actual: cancelled (revisión 6).",
    );
    expect(
      replayDescription({
        replayed: false,
        recordedOutcome: { status: "draft", revision: 1 },
        current: { status: "draft", revision: 1 },
      }),
    ).toBeNull();
  });
});
