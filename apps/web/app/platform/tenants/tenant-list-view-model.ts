export type TenantStatus = "provisioning" | "active" | "suspended" | "offboarding" | "archived";

export type DeploymentStatus = "healthy" | "degraded" | "offline" | "maintenance";

export type PlatformTenantListItem = Readonly<{
  id: string;
  displayName: string;
  legalName: string;
  slug: string;
  status: TenantStatus;
  deployment: Readonly<{
    id: string;
    name: string;
    mode: "shared" | "dedicated" | "customer_hosted";
    environment: "production" | "staging" | "development";
    status: DeploymentStatus;
    currentVersion: string;
    lastHealthAt: string | null;
  }> | null;
  enabledModules: readonly string[];
  channelCount: number | null;
  userCount: number;
  lastActivityAt: string | null;
}>;

export type PlatformTenantListResponse = Readonly<{
  items: readonly PlatformTenantListItem[];
  page: number;
  pageSize: number;
  total: number;
}>;

export type TenantListRequestState = "loaded" | "empty" | "unauthorized" | "error";

const moduleLabels: Readonly<Record<string, string>> = {
  "module.action_requests": "Acciones",
  "module.agenda": "Agenda",
  "module.ai": "IA",
  "module.automation.advanced": "Automatización avanzada",
  "module.automation.basic": "Automatización",
  "module.catalog": "Catálogo",
  "module.crm_lite": "CRM Lite",
  "module.customer_portal": "Portal",
  "module.documents": "Documentos",
  "module.integrations": "Integraciones",
  "module.messaging.basic": "Messaging",
  "module.processes": "Procesos",
  "module.quotes": "Cotizaciones",
  "module.white_label": "White label",
};

export function moduleLabel(key: string): string {
  return moduleLabels[key] ?? key;
}

export function channelCountLabel(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("es-MX").format(value);
}

export function requestStateForResponse(
  status: number,
  items: readonly PlatformTenantListItem[] = [],
): TenantListRequestState {
  if (status === 401) return "unauthorized";
  if (status < 200 || status >= 300) return "error";
  return items.length === 0 ? "empty" : "loaded";
}

export function formatObservedActivity(value: string | null, locale = "es-MX"): string {
  if (value === null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
