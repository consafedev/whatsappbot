export const MODULE_ENTITLEMENT_KEYS = [
  "module.messaging.basic",
  "module.automation.basic",
  "module.automation.advanced",
  "module.crm_lite",
  "module.processes",
  "module.action_requests",
  "module.appointments",
  "module.catalog",
  "module.quotes",
  "module.documents",
  "module.customer_portal",
  "module.ai",
  "module.integrations",
  "module.white_label",
] as const;

export type ModuleEntitlementKey = (typeof MODULE_ENTITLEMENT_KEYS)[number];

export const LIMIT_ENTITLEMENT_KEYS = [
  "limit.channel_accounts",
  "limit.users",
  "limit.organization_units",
  "limit.storage_bytes",
  "limit.monthly_ai_budget",
] as const;

export type LimitEntitlementKey = (typeof LIMIT_ENTITLEMENT_KEYS)[number];

const moduleKeys = new Set<string>(MODULE_ENTITLEMENT_KEYS);
const limitKeys = new Set<string>(LIMIT_ENTITLEMENT_KEYS);

export function isModuleEntitlementKey(value: string): value is ModuleEntitlementKey {
  return moduleKeys.has(value);
}

export function isLimitEntitlementKey(value: string): value is LimitEntitlementKey {
  return limitKeys.has(value);
}
