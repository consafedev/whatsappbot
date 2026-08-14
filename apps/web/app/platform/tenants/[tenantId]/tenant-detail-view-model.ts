export type TenantDetailState = "loaded" | "not-found" | "unauthorized" | "error";
export type DeferredState =
  | "idle"
  | "loading"
  | "loaded"
  | "empty"
  | "unauthorized"
  | "not-found"
  | "error";

export const TENANT_DETAIL_TABS = [
  "General",
  "Módulos",
  "Usuarios",
  "Canales",
  "Deployment",
  "Uso",
  "Auditoría",
  "Backup",
] as const;

export type PlatformTenantDetail = Readonly<{
  general: Readonly<{
    id: string;
    legalName: string;
    displayName: string;
    slug: string;
    status: string;
    defaultTimezone: string;
    defaultLocale: string;
    defaultCurrency: string;
    createdAt: string;
    updatedAt: string;
    suspendedAt: string | null;
    themeMode: string;
    brandingOverride: boolean;
  }>;
  organizationRoot: Readonly<{ id: string; name: string; type: string; active: boolean }> | null;
  modules: readonly Readonly<{
    key: string;
    enabled: boolean;
    effective: boolean;
    source: string | null;
    startsAt: string | null;
    endsAt: string | null;
    configPresent: boolean;
  }>[];
  limits: readonly Readonly<{
    key: string;
    limitValue: string | null;
    source: string | null;
    startsAt: string | null;
    endsAt: string | null;
  }>[];
  usage: Readonly<Record<string, Readonly<{ used: number | null; limit: string | null }>>>;
  channels: Readonly<{ available: false; count: null }>;
  deployment: Readonly<{
    id: string;
    name: string;
    mode: string;
    environment: string;
    currentVersion: string;
    targetVersion: string | null;
    releaseChannel: string;
    status: string;
    lastHealthAt: string | null;
  }> | null;
  backup: Readonly<{ available: false }>;
}>;

export type PlatformTenantUserPage = Readonly<{
  items: readonly Readonly<{
    id: string;
    email: string;
    displayName: string;
    status: string;
    locale: string;
    timezone: string;
    lastLoginAt: string | null;
    mfaState: string;
    createdAt: string;
    roles: readonly Readonly<{
      name: string;
      key: string;
      organizationUnit: Readonly<{ id: string; name: string }> | null;
    }>[];
  }>[];
  page: number;
  pageSize: number;
  total: number;
}>;

export type PlatformTenantAuditPage = Readonly<{
  items: readonly Readonly<{
    id: string;
    actorType: string;
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    organizationUnitId: string | null;
    requestId: string;
    occurredAt: string;
  }>[];
  page: number;
  pageSize: number;
  total: number;
}>;

export function detailStateForStatus(status: number): TenantDetailState {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not-found";
  return status >= 200 && status < 300 ? "loaded" : "error";
}

export function deferredStateForStatus(status: number, itemCount: number): DeferredState {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not-found";
  if (status < 200 || status >= 300) return "error";
  return itemCount === 0 ? "empty" : "loaded";
}

export function displayDate(value: string | null, locale = "es-MX"): string {
  if (value === null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function displayLimit(value: string | null): string {
  return value === null ? "No configurado" : value;
}
