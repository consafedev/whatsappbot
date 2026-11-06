import { describe, expect, it } from "vitest";
import { parseProductCustomValues } from "./catalog-api";
import {
  formatCatalogMoney,
  getCatalogCapabilities,
  getCatalogPageState,
} from "./catalog-view-model";

describe("catalog view model", () => {
  it("serializes an erased custom-values field as explicit null while retaining entered objects", () => {
    expect(parseProductCustomValues("")).toBeNull();
    expect(parseProductCustomValues("  ")).toBeNull();
    expect(parseProductCustomValues('{"color":"azul"}')).toEqual({ color: "azul" });
    expect(() => parseProductCustomValues("[]")).toThrow(/objeto JSON/);
  });

  it("catalogGatesReadOnlyAndModuleStates", () => {
    expect(getCatalogCapabilities({ modules: [], permissions: ["catalog.read"] })).toMatchObject({
      moduleEnabled: false,
      canRead: false,
      canManage: false,
    });
    expect(
      getCatalogCapabilities({ modules: ["module.catalog"], permissions: ["catalog.read"] }),
    ).toMatchObject({ moduleEnabled: true, canRead: true, canManage: false });
  });

  it("catalogErrorEmptyAndLoadedStates", () => {
    expect(getCatalogPageState({ loading: true, error: null, items: [] })).toBe("loading");
    expect(getCatalogPageState({ loading: false, error: "offline", items: [] })).toBe("error");
    expect(getCatalogPageState({ loading: false, error: null, items: [] })).toBe("empty");
    expect(getCatalogPageState({ loading: false, error: null, items: [{ id: "p1" }] })).toBe(
      "loaded",
    );
  });

  it("formats large money values without numeric coercion", () => {
    expect(formatCatalogMoney("1234567890123456.78", "USD", 2)).toBe(
      "1,234,567,890,123,456.78 USD",
    );
  });
});
