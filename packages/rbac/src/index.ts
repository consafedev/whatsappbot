export const PERMISSION_CATALOG = [
  { key: "tenant.settings.manage", description: "Manage tenant settings" },
  { key: "tenant.users.manage", description: "Manage tenant users" },
  { key: "tenant.roles.manage", description: "Manage tenant roles" },
  { key: "channels.read", description: "Read channel configuration" },
  { key: "channels.manage", description: "Manage channel configuration" },
  { key: "contacts.read", description: "Read contacts" },
  { key: "contacts.write", description: "Create and manage contacts" },
  { key: "conversations.read", description: "Read conversations" },
  { key: "conversations.reply", description: "Reply to conversations" },
  { key: "conversations.assign", description: "Assign conversations" },
  { key: "processes.read", description: "Read processes" },
  { key: "processes.create", description: "Create processes" },
  { key: "processes.update", description: "Update processes" },
  { key: "processes.transition", description: "Transition processes" },
  { key: "action_requests.read", description: "Read action requests" },
  { key: "action_requests.manage", description: "Manage action requests" },
  { key: "appointments.read", description: "Read appointments" },
  { key: "appointments.manage", description: "Manage appointments" },
  { key: "quotes.read", description: "Read quotes" },
  { key: "quotes.create", description: "Create quotes" },
  { key: "quotes.approve", description: "Approve quotes" },
  { key: "quotes.send", description: "Send quotes" },
  { key: "catalog.read", description: "Read catalog data" },
  { key: "catalog.manage", description: "Manage catalog data" },
  { key: "rules.read", description: "Read automation rules" },
  { key: "rules.manage", description: "Manage automation rules" },
  { key: "ai.settings.manage", description: "Manage AI settings" },
  { key: "campaigns.read", description: "Read campaigns and templates" },
  { key: "campaigns.manage", description: "Manage campaigns and templates" },
  { key: "integrations.manage", description: "Manage integrations" },
  { key: "reports.read", description: "Read reports" },
  { key: "audit.read", description: "Read tenant audit records" },
  { key: "exports.create", description: "Create exports" },
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]["key"];

const permissionKeys = new Set<string>(PERMISSION_CATALOG.map(({ key }) => key));

export function isPermissionKey(value: string): value is PermissionKey {
  return permissionKeys.has(value);
}

export const INITIAL_TENANT_ROLES = [
  { key: "owner", name: "Owner" },
  { key: "administrator", name: "Administrator" },
  { key: "supervisor", name: "Supervisor" },
  { key: "agent", name: "Agent" },
  { key: "operator", name: "Operator" },
  { key: "viewer", name: "Viewer" },
] as const;

export type InitialTenantRoleKey = (typeof INITIAL_TENANT_ROLES)[number]["key"];
