export type CatalogProduct = Readonly<{
  id: string;
  organizationUnitId: string | null;
  sku: string;
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
  customValues: unknown;
  createdAt: string;
  updatedAt: string;
}>;

export type CatalogFilters = Readonly<{
  active?: boolean;
  category?: string;
  cursor?: string;
  limit?: number;
  organizationUnitId?: string;
  search?: string;
}>;

export type CatalogCapabilities = Readonly<{
  moduleEnabled: boolean;
  canRead: boolean;
  canManage: boolean;
}>;

export type CatalogPageState = "loading" | "error" | "empty" | "loaded";

export function getCatalogCapabilities(input: {
  modules: readonly string[];
  permissions: readonly string[];
}): CatalogCapabilities {
  const moduleEnabled = input.modules.includes("module.catalog");
  return {
    moduleEnabled,
    canRead: moduleEnabled && input.permissions.includes("catalog.read"),
    canManage: moduleEnabled && input.permissions.includes("catalog.manage"),
  };
}

export function getCatalogPageState(input: {
  loading: boolean;
  error: string | null;
  items: readonly { id: string }[];
}): CatalogPageState {
  if (input.loading) return "loading";
  if (input.error) return "error";
  return input.items.length === 0 ? "empty" : "loaded";
}

export function formatCatalogMoney(amount: string, currency: string, precision = 2): string {
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
