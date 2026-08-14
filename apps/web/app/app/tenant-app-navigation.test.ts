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
});
