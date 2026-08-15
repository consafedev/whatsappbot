import type { OrganizationUnitItem } from "./tenant-organization-units-tree";

export type OrganizationUnitType = "branch" | "department" | "team" | "other";

export type OrganizationUnitDraft = Readonly<{
  parentId: string;
  type: OrganizationUnitType;
  name: string;
  code: string;
  timezone: string;
  active: boolean;
}>;

export const ORGANIZATION_UNIT_TYPE_LABELS: Readonly<Record<OrganizationUnitType, string>> =
  Object.freeze({
    branch: "Sucursal",
    department: "Departamento",
    team: "Equipo",
    other: "Otro",
  });

export const ORGANIZATION_UNIT_NAME_MAX_LENGTH = 120;
export const ORGANIZATION_UNIT_CODE_MAX_LENGTH = 40;

export function blankOrganizationUnitDraft(parentId: string): OrganizationUnitDraft {
  return { active: true, code: "", name: "", parentId, timezone: "", type: "department" };
}

export function draftFromUnit(unit: OrganizationUnitItem): OrganizationUnitDraft {
  return {
    active: unit.active,
    code: unit.code ?? "",
    name: unit.name,
    parentId: unit.parentId ?? unit.id,
    timezone: unit.timezone ?? "",
    type: unit.type === "company" ? "department" : unit.type,
  };
}

export function canonicalCreateBody(draft: OrganizationUnitDraft): unknown | null {
  const name = draft.name.trim();
  const code = draft.code.trim();
  const timezone = draft.timezone.trim();
  if (
    draft.parentId === "" ||
    name === "" ||
    name.length > ORGANIZATION_UNIT_NAME_MAX_LENGTH ||
    code.length > ORGANIZATION_UNIT_CODE_MAX_LENGTH
  ) {
    return null;
  }
  const body: Record<string, unknown> = {
    active: draft.active,
    name,
    parentId: draft.parentId,
    type: draft.type,
  };
  if (code !== "") body.code = code;
  if (timezone !== "") body.timezone = timezone;
  return body;
}

export function canonicalUpdateBody(
  original: OrganizationUnitItem,
  draft: OrganizationUnitDraft,
): unknown | null {
  const body: Record<string, unknown> = {};
  const name = draft.name.trim();
  const code = draft.code.trim();
  const timezone = draft.timezone.trim();
  if (name === "" || name.length > ORGANIZATION_UNIT_NAME_MAX_LENGTH) return null;
  if (code.length > ORGANIZATION_UNIT_CODE_MAX_LENGTH) return null;
  const isRoot = original.parentId === null;
  if (name !== original.name) body.name = name;
  if (draft.code !== (original.code ?? "")) body.code = code === "" ? null : code;
  if (draft.timezone !== (original.timezone ?? ""))
    body.timezone = timezone === "" ? null : timezone;
  if (!isRoot) {
    if (draft.type !== original.type) body.type = draft.type;
    if (draft.parentId !== original.parentId) body.parentId = draft.parentId;
    if (draft.active !== original.active) body.active = draft.active;
  }
  return Object.keys(body).length === 0 ? null : body;
}
