import { describe, expect, it } from "vitest";
import {
  buildOrganizationUnitTree,
  collectDescendantIds,
  findOrganizationUnit,
  type OrganizationUnitItem,
  parentCandidates,
} from "./tenant-organization-units-tree";

function unit(partial: Partial<OrganizationUnitItem> & { id: string }): OrganizationUnitItem {
  return {
    active: true,
    code: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    name: partial.id,
    parentId: null,
    timezone: null,
    type: "department",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("organization unit tree helpers", () => {
  it("builds a nested forest with roots and children", () => {
    const items = [
      unit({ id: "root", type: "company", name: "Raíz" }),
      unit({ id: "a", parentId: "root", name: "Sucursal A" }),
      unit({ id: "b", parentId: "root", name: "Sucursal B" }),
      unit({ id: "a1", parentId: "a", name: "Equipo A1" }),
    ];
    const roots = buildOrganizationUnitTree(items);
    expect(roots.map(({ item }) => item.id)).toEqual(["root"]);
    expect(roots[0]?.children.map(({ item }) => item.id)).toEqual(["a", "b"]);
    expect(roots[0]?.children[0]?.children.map(({ item }) => item.id)).toEqual(["a1"]);
  });

  it("sorts siblings by name and then by id", () => {
    const items = [
      unit({ id: "z", name: "Zeta" }),
      unit({ id: "a2", name: "Alfa" }),
      unit({ id: "a1", name: "Alfa" }),
    ];
    const roots = buildOrganizationUnitTree(items);
    expect(roots.map(({ item }) => item.id)).toEqual(["a1", "a2", "z"]);
  });

  it("treats orphan items with missing parents as roots", () => {
    const items = [unit({ id: "orphan", parentId: "missing" })];
    const roots = buildOrganizationUnitTree(items);
    expect(roots.map(({ item }) => item.id)).toEqual(["orphan"]);
  });

  it("finds a unit by id and returns null for unknown ids", () => {
    const items = [unit({ id: "x" })];
    expect(findOrganizationUnit(items, "x")?.id).toBe("x");
    expect(findOrganizationUnit(items, "y")).toBeNull();
  });

  it("collects all descendant ids of a node", () => {
    const items = [
      unit({ id: "root", type: "company", name: "Raíz" }),
      unit({ id: "a", parentId: "root" }),
      unit({ id: "b", parentId: "root" }),
      unit({ id: "a1", parentId: "a" }),
      unit({ id: "a2", parentId: "a" }),
      unit({ id: "a1x", parentId: "a1" }),
    ];
    const roots = buildOrganizationUnitTree(items);
    const root = roots[0];
    if (root === undefined) throw new Error("missing root");
    expect(collectDescendantIds(root)).toEqual(["a", "a1", "a1x", "a2", "b"]);
  });

  it("excludes the node itself and its descendants from parent candidates", () => {
    const items = [
      unit({ id: "root", type: "company", name: "Raíz" }),
      unit({ id: "a", parentId: "root" }),
      unit({ id: "b", parentId: "root" }),
      unit({ id: "a1", parentId: "a" }),
    ];
    const roots = buildOrganizationUnitTree(items);
    const a = roots[0]?.children[0];
    if (a === undefined) throw new Error("missing child");
    const candidates = parentCandidates(items, a);
    expect(candidates.map(({ id }) => id)).toEqual(["root", "b"]);
  });
});
