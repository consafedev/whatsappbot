import { describe, expect, it } from "vitest";
import { resolveTenantNavigation } from "./tenant-app-navigation";

describe("tenant app navigation", () => {
  it("uses effective module and permission gates without broken future links", () => {
    const navigation = resolveTenantNavigation(["module.quotes"], ["quotes.read"]);
    const items = navigation.flatMap((group) => group.items);
    expect(items.map((item) => item.id)).toEqual(["home", "quotes"]);
    expect(items.find((item) => item.id === "quotes")?.href).toBeNull();
    expect(items.every((item) => item.href !== "#")).toBe(true);
  });

  it("does not infer access from a role name", () => {
    const items = resolveTenantNavigation(["module.messaging.basic"], []).flatMap(
      (group) => group.items,
    );
    expect(items.map((item) => item.id)).toEqual(["home"]);
  });

  it("exposes the theme settings route only with the settings permission", () => {
    const without = resolveTenantNavigation([], []).flatMap((group) => group.items);
    expect(without.some((item) => item.id === "settings")).toBe(false);

    const withPermission = resolveTenantNavigation([], ["tenant.settings.manage"]).flatMap(
      (group) => group.items,
    );
    expect(withPermission.find((item) => item.id === "settings")?.href).toBe("/app/settings/theme");
  });

  it("exposes user management when either user or role administration is granted", () => {
    const without = resolveTenantNavigation([], []).flatMap((group) => group.items);
    expect(without.some((item) => item.id === "users")).toBe(false);

    const users = resolveTenantNavigation([], ["tenant.users.manage"]).flatMap(
      (group) => group.items,
    );
    expect(users.find((item) => item.id === "users")?.href).toBe("/app/users");

    const roles = resolveTenantNavigation([], ["tenant.roles.manage"]).flatMap(
      (group) => group.items,
    );
    expect(roles.find((item) => item.id === "users")?.href).toBe("/app/users");
  });

  it("exposes inbox route when messaging module and conversations.read permission are granted", () => {
    const withoutModule = resolveTenantNavigation([], ["conversations.read"]).flatMap(
      (group) => group.items,
    );
    expect(withoutModule.some((item) => item.id === "inbox")).toBe(false);

    const withoutPerm = resolveTenantNavigation(["module.messaging.basic"], []).flatMap(
      (group) => group.items,
    );
    expect(withoutPerm.some((item) => item.id === "inbox")).toBe(false);

    const withBoth = resolveTenantNavigation(
      ["module.messaging.basic"],
      ["conversations.read"],
    ).flatMap((group) => group.items);
    expect(withBoth.find((item) => item.id === "inbox")?.href).toBe("/app/inbox");
  });

  it("exposes automations /app/rules route when module.automation.basic and rules.read permission are granted", () => {
    const withoutModule = resolveTenantNavigation([], ["rules.read"]).flatMap(
      (group) => group.items,
    );
    expect(withoutModule.some((item) => item.id === "automations")).toBe(false);

    const withoutPerm = resolveTenantNavigation(["module.automation.basic"], []).flatMap(
      (group) => group.items,
    );
    expect(withoutPerm.some((item) => item.id === "automations")).toBe(false);

    const withBoth = resolveTenantNavigation(
      ["module.automation.basic"],
      ["rules.read"],
    ).flatMap((group) => group.items);
    expect(withBoth.find((item) => item.id === "automations")?.href).toBe("/app/rules");
  });
});
