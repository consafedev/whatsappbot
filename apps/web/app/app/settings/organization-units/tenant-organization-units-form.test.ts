import { describe, expect, it } from "vitest";
import {
  blankOrganizationUnitDraft,
  canonicalCreateBody,
  canonicalUpdateBody,
  draftFromUnit,
  type OrganizationUnitDraft,
} from "./tenant-organization-units-form";
import type { OrganizationUnitItem } from "./tenant-organization-units-tree";

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

describe("organization unit form helpers", () => {
  it("creates a canonical body trimming optional fields", () => {
    const body = canonicalCreateBody({
      active: true,
      code: "  NTE  ",
      name: "  Sucursal Norte  ",
      parentId: "root",
      timezone: " America/Mexico_City ",
      type: "branch",
    });
    expect(body).toEqual({
      active: true,
      code: "NTE",
      name: "Sucursal Norte",
      parentId: "root",
      timezone: "America/Mexico_City",
      type: "branch",
    });
  });

  it("omits blank code and timezone from the create body", () => {
    const body = canonicalCreateBody({
      active: true,
      code: "",
      name: "Equipo",
      parentId: "root",
      timezone: "  ",
      type: "team",
    });
    expect(body).toEqual({ active: true, name: "Equipo", parentId: "root", type: "team" });
  });

  it("rejects invalid create drafts", () => {
    const base: OrganizationUnitDraft = {
      active: true,
      code: "",
      name: "X",
      parentId: "root",
      timezone: "",
      type: "team",
    };
    expect(canonicalCreateBody({ ...base, parentId: "" })).toBeNull();
    expect(canonicalCreateBody({ ...base, name: "  " })).toBeNull();
    expect(canonicalCreateBody({ ...base, name: "X".repeat(121) })).toBeNull();
    expect(canonicalCreateBody({ ...base, code: "C".repeat(41) })).toBeNull();
  });

  it("builds a draft from a unit keeping the root type as department", () => {
    const root = unit({ id: "root", type: "company", name: "Raíz" });
    expect(draftFromUnit(root)).toMatchObject({
      active: true,
      code: "",
      name: "Raíz",
      parentId: "root",
      timezone: "",
      type: "department",
    });
    const branch = unit({ id: "b", parentId: "root", type: "branch", name: "B", code: "B1" });
    expect(draftFromUnit(branch)).toMatchObject({ code: "B1", parentId: "root", type: "branch" });
  });

  it("diffs only changed fields and clears blank optional fields", () => {
    const original = unit({
      id: "b",
      parentId: "root",
      name: "Sucursal",
      code: "SUC",
      type: "branch",
    });
    const body = canonicalUpdateBody(original, {
      active: true,
      code: "",
      name: "Sucursal Renovada",
      parentId: "root",
      timezone: "",
      type: "branch",
    });
    expect(body).toEqual({ code: null, name: "Sucursal Renovada" });
    expect(
      canonicalUpdateBody(original, {
        active: true,
        code: "SUC",
        name: "Sucursal",
        parentId: "root",
        timezone: "",
        type: "branch",
      }),
    ).toBeNull();
  });

  it("excludes type, parent and active changes for the structural root", () => {
    const root = unit({ id: "root", type: "company", name: "Raíz" });
    const body = canonicalUpdateBody(root, {
      active: false,
      code: "R",
      name: "Raíz",
      parentId: "other",
      timezone: "",
      type: "team",
    });
    expect(body).toEqual({ code: "R" });
  });

  it("provides a blank draft for a given parent", () => {
    expect(blankOrganizationUnitDraft("root")).toEqual({
      active: true,
      code: "",
      name: "",
      parentId: "root",
      timezone: "",
      type: "department",
    });
  });
});
