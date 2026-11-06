export type QuoteLine = Readonly<{
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
  metadata: unknown;
}>;

export type Quote = Readonly<{
  id: string;
  number: string;
  status: string;
  revision: number;
  autonomyLevel: 0 | 1 | 2 | 3;
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
  lines: readonly QuoteLine[];
  createdAt: string;
  updatedAt: string;
}>;

export type QuotePolicy = Readonly<{
  autonomyLevel: 0 | 1 | 2 | 3;
  maxAutoSendAmount: string | null;
  maxAutoSendCurrency: string | null;
  maxDiscountPercent: string | null;
  minMarginPercent: string | null;
  requireStock: boolean;
  newCustomerRequiresApproval: boolean;
  exceptionalProductRequiresApproval: boolean;
  allowSelfApproval: boolean;
  revision: number;
  contentHash: string;
}>;

export type QuoteCapabilities = Readonly<{
  moduleEnabled: boolean;
  canRead: boolean;
  canCreate: boolean;
  canApprove: boolean;
  canSend: boolean;
  canManagePolicy: boolean;
  canReadCatalog: boolean;
  canUseMessaging: boolean;
  canUseCrm: boolean;
}>;

export function getQuoteCapabilities(input: {
  modules: readonly string[];
  permissions: readonly string[];
}): QuoteCapabilities {
  const modules = new Set(input.modules);
  const permissions = new Set(input.permissions);
  const moduleEnabled = modules.has("module.quotes");
  return {
    moduleEnabled,
    canRead: moduleEnabled && permissions.has("quotes.read"),
    canCreate: moduleEnabled && permissions.has("quotes.create"),
    canApprove: moduleEnabled && permissions.has("quotes.approve"),
    canSend: moduleEnabled && permissions.has("quotes.send"),
    canManagePolicy:
      moduleEnabled &&
      permissions.has("tenant.settings.manage") &&
      permissions.has("quotes.approve"),
    canReadCatalog: modules.has("module.catalog") && permissions.has("catalog.read"),
    canUseMessaging: modules.has("module.messaging.basic"),
    canUseCrm: modules.has("module.crm_lite"),
  };
}

export function getQuotesPageState(input: {
  moduleEnabled: boolean;
  canRead: boolean;
  loading: boolean;
  error: string | null;
  items: readonly { id: string }[];
}): "module-disabled" | "permission-denied" | "loading" | "error" | "empty" | "loaded" {
  if (!input.moduleEnabled) return "module-disabled";
  if (!input.canRead) return "permission-denied";
  if (input.loading) return "loading";
  if (input.error) return "error";
  return input.items.length === 0 ? "empty" : "loaded";
}

export function quoteActions(quote: Quote, capabilities: QuoteCapabilities, now = Date.now()) {
  const editable = ["draft", "pending_approval", "approved", "rejected"].includes(quote.status);
  const requestable = ["draft", "rejected", "approved"].includes(quote.status);
  const expired = quote.validUntil !== null && now >= Date.parse(quote.validUntil);
  const currentCalculation =
    quote.calculatedRevision === quote.revision &&
    quote.total !== null &&
    quote.calculationInputHash !== null;
  return {
    canEdit: capabilities.canCreate && editable,
    canRequestApproval:
      capabilities.canCreate &&
      capabilities.canUseCrm &&
      requestable &&
      currentCalculation &&
      !expired,
    canApprove:
      capabilities.canApprove &&
      capabilities.canUseCrm &&
      quote.status === "pending_approval" &&
      currentCalculation &&
      !expired,
    canReject:
      capabilities.canApprove && capabilities.canUseCrm && quote.status === "pending_approval",
    canCancel: capabilities.canCreate && editable,
    canSend: false as const,
    calculationCurrent: currentCalculation,
    expired,
  };
}

export function formatQuoteMoney(amount: string, currency: string, precision = 2): string {
  return `${formatExactDecimal(amount, precision)} ${currency}`;
}

export function formatExactDecimal(amount: string, precision?: number): string {
  if (!/^-?\d+(?:\.\d+)?$/.test(amount)) return amount;
  const negative = amount.startsWith("-");
  const unsigned = negative ? amount.slice(1) : amount;
  const [rawInteger = "0", rawFraction = ""] = unsigned.split(".");
  const integer = rawInteger.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction =
    precision === undefined
      ? rawFraction
      : rawFraction.length > precision
        ? rawFraction
        : rawFraction.padEnd(precision, "0");
  return `${negative ? "-" : ""}${integer}${fraction.length ? `.${fraction}` : ""}`;
}

export function replayDescription(result: {
  replayed: boolean;
  recordedOutcome: { status: string; revision: number; result?: string };
  current: { status: string; revision: number };
}): string | null {
  if (!result.replayed && result.recordedOutcome.result === undefined) return null;
  const original = `${result.recordedOutcome.status} (revisión ${result.recordedOutcome.revision})`;
  const prefix = result.replayed ? "Reintento reconocido. " : "";
  const resultLabel =
    result.recordedOutcome.result === undefined
      ? ""
      : `Resultado registrado: ${result.recordedOutcome.result}. `;
  return `${prefix}${resultLabel}Acción original: ${original}. Estado actual: ${result.current.status} (revisión ${result.current.revision}).`;
}

export function quoteStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: "Borrador",
    pending_approval: "Pendiente de aprobación",
    approved: "Aprobada",
    rejected: "Rechazada",
    sent: "Enviada",
    accepted: "Aceptada",
    expired: "Vencida",
    cancelled: "Cancelada",
  };
  return labels[status] ?? status;
}
