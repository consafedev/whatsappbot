export const tenantModuleOptions = [
  ["module.messaging.basic", "Messaging Basic"],
  ["module.automation.basic", "Automatización básica"],
  ["module.automation.advanced", "Automatización avanzada"],
  ["module.crm_lite", "CRM Lite"],
  ["module.processes", "Procesos"],
  ["module.action_requests", "Solicitudes de acción"],
  ["module.appointments", "Agenda"],
  ["module.catalog", "Catálogo"],
  ["module.quotes", "Cotizaciones"],
  ["module.documents", "Documentos"],
  ["module.customer_portal", "Portal de clientes"],
  ["module.ai", "IA"],
  ["module.integrations", "Integraciones"],
  ["module.white_label", "White label"],
] as const;

export const defaultTenantModules = ["module.messaging.basic", "module.automation.basic"] as const;

export type TenantProvisioningForm = Readonly<{
  legalName: string;
  displayName: string;
  slug: string;
  defaultTimezone: string;
  defaultLocale: string;
  defaultCurrency: string;
  deploymentId: string;
  ownerDisplayName: string;
  ownerEmail: string;
  ownerPassword: string;
  enabledModules: readonly string[];
  channelAccounts: string;
  users: string;
  organizationUnits: string;
  storageBytes: string;
  monthlyAiBudget: string;
}>;

function integer(value: string): number {
  return Number(value);
}

export function tenantProvisioningPayload(form: TenantProvisioningForm) {
  return {
    defaultCurrency: form.defaultCurrency,
    defaultLocale: form.defaultLocale,
    defaultTimezone: form.defaultTimezone,
    deploymentId: form.deploymentId.trim() || null,
    displayName: form.displayName,
    enabledModules: form.enabledModules,
    legalName: form.legalName,
    limits: {
      channelAccounts: integer(form.channelAccounts),
      monthlyAiBudget: form.monthlyAiBudget.trim() === "" ? null : Number(form.monthlyAiBudget),
      organizationUnits: integer(form.organizationUnits),
      storageBytes: integer(form.storageBytes),
      users: integer(form.users),
    },
    owner: {
      displayName: form.ownerDisplayName,
      email: form.ownerEmail,
      password: form.ownerPassword,
    },
    slug: form.slug,
  };
}

export function provisioningErrorMessage(status: number): string {
  if (status === 400) return "Revisa los campos y la política de contraseña.";
  if (status === 401) return "Tu sesión de Platform Admin no es válida.";
  if (status === 409) return "El slug ya pertenece a otro tenant.";
  if (status === 422) return "El deployment seleccionado no está disponible.";
  if (status === 503)
    return "El catálogo de permisos no está preparado. Ejecuta el sync operativo.";
  return "No fue posible crear el tenant. Intenta nuevamente.";
}
