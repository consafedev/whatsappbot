export type TenantAppNavigationItem = Readonly<{
  href: string | null;
  id: string;
  label: string;
  requiredModule?: string;
  requiredPermission?: string;
  requiredAnyPermissions?: readonly string[];
}>;

export type TenantAppNavigationGroup = Readonly<{
  id: string;
  items: readonly TenantAppNavigationItem[];
  label: string;
}>;

export const TENANT_MODULE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "module.action_requests": "Acciones requeridas",
  "module.appointments": "Agenda",
  "module.automation.advanced": "Automatizaciones avanzadas",
  "module.automation.basic": "Automatizaciones",
  "module.catalog": "Catálogo",
  "module.crm_lite": "Contactos",
  "module.customer_portal": "Portal del cliente",
  "module.documents": "Documentos",
  "module.integrations": "Integraciones",
  "module.messaging.basic": "Mensajería",
  "module.processes": "Procesos",
  "module.quotes": "Cotizaciones",
  "module.white_label": "White label",
  "module.ai": "IA",
});

const navigation: readonly TenantAppNavigationGroup[] = Object.freeze([
  {
    id: "operation",
    label: "Operación",
    items: [
      { href: "/app", id: "home", label: "Inicio" },
      {
        href: "/app/inbox",
        id: "inbox",
        label: "Inbox",
        requiredModule: "module.messaging.basic",
        requiredPermission: "conversations.read",
      },
      { href: null, id: "contacts", label: "Contactos", requiredModule: "module.crm_lite" },
      {
        href: null,
        id: "processes",
        label: "Procesos",
        requiredModule: "module.processes",
        requiredPermission: "processes.read",
      },
      {
        href: null,
        id: "actions",
        label: "Acciones requeridas",
        requiredModule: "module.action_requests",
        requiredPermission: "action_requests.read",
      },
      {
        href: null,
        id: "appointments",
        label: "Agenda",
        requiredModule: "module.appointments",
        requiredPermission: "appointments.read",
      },
      {
        href: null,
        id: "catalog",
        label: "Catálogo",
        requiredModule: "module.catalog",
        requiredPermission: "catalog.read",
      },
      {
        href: null,
        id: "quotes",
        label: "Cotizaciones",
        requiredModule: "module.quotes",
        requiredPermission: "quotes.read",
      },
    ],
  },
  {
    id: "configuration",
    label: "Configuración",
    items: [
      {
        href: "/app/rules",
        id: "automations",
        label: "Automatizaciones",
        requiredModule: "module.automation.basic",
        requiredPermission: "rules.read",
      },
      {
        href: null,
        id: "channels",
        label: "Canales",
        requiredModule: "module.messaging.basic",
        requiredPermission: "channels.read",
      },
      {
        href: null,
        id: "integrations",
        label: "Integraciones",
        requiredModule: "module.integrations",
        requiredPermission: "integrations.manage",
      },
      { href: null, id: "reports", label: "Reportes", requiredPermission: "reports.read" },
      {
        href: "/app/users",
        id: "users",
        label: "Usuarios y organización",
        requiredAnyPermissions: ["tenant.users.manage", "tenant.roles.manage"],
      },
      {
        href: "/app/settings/theme",
        id: "settings",
        label: "Configuración",
        requiredPermission: "tenant.settings.manage",
      },
    ],
  },
]);

export function moduleLabel(moduleKey: string): string {
  return TENANT_MODULE_LABELS[moduleKey] ?? moduleKey;
}

export function resolveTenantNavigation(
  effectiveModules: readonly string[],
  effectivePermissions: readonly string[],
): readonly TenantAppNavigationGroup[] {
  const modules = new Set(effectiveModules);
  const permissions = new Set(effectivePermissions);
  return navigation
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          (item.requiredModule === undefined || modules.has(item.requiredModule)) &&
          (item.requiredPermission === undefined || permissions.has(item.requiredPermission)) &&
          (item.requiredAnyPermissions === undefined ||
            item.requiredAnyPermissions.some((permission) => permissions.has(permission))),
      ),
    }))
    .filter((group) => group.items.length > 0);
}
