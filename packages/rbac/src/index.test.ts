import { describe, expect, it } from "vitest";
import { INITIAL_TENANT_ROLES, isPermissionKey, PERMISSION_CATALOG } from "./index";

const documentedPermissionKeys = [
  "tenant.settings.manage",
  "tenant.users.manage",
  "tenant.roles.manage",
  "channels.read",
  "channels.manage",
  "contacts.read",
  "contacts.write",
  "conversations.read",
  "conversations.reply",
  "conversations.assign",
  "processes.read",
  "processes.create",
  "processes.update",
  "processes.transition",
  "action_requests.read",
  "action_requests.manage",
  "appointments.read",
  "appointments.manage",
  "quotes.read",
  "quotes.create",
  "quotes.approve",
  "quotes.send",
  "catalog.read",
  "catalog.manage",
  "rules.read",
  "rules.manage",
  "ai.settings.manage",
  "campaigns.read",
  "campaigns.manage",
  "integrations.manage",
  "reports.read",
  "audit.read",
  "exports.create",
] as const;

describe("RBAC catalogs", () => {
  it("contains exactly the documented permission baseline without duplicates", () => {
    const actual = PERMISSION_CATALOG.map(({ key }) => key);
    expect(actual).toEqual(documentedPermissionKeys);
    expect(new Set(actual).size).toBe(actual.length);
    expect(actual).toHaveLength(33);
  });

  it("recognizes only canonical permission keys", () => {
    expect(isPermissionKey("channels.manage")).toBe(true);
    expect(isPermissionKey("contacts.write")).toBe(true);
    expect(isPermissionKey("channels.mange")).toBe(false);
    expect(isPermissionKey("platform.tenants.manage")).toBe(false);
  });

  it("defines the documented initial role names without a permission matrix", () => {
    expect(INITIAL_TENANT_ROLES).toEqual([
      { key: "owner", name: "Owner" },
      { key: "administrator", name: "Administrator" },
      { key: "supervisor", name: "Supervisor" },
      { key: "agent", name: "Agent" },
      { key: "operator", name: "Operator" },
      { key: "viewer", name: "Viewer" },
    ]);
    expect(INITIAL_TENANT_ROLES.every((role) => !("permissions" in role))).toBe(true);
  });
});
