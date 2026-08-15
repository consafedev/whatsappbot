"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  blankOrganizationUnitDraft,
  canonicalCreateBody,
  canonicalUpdateBody,
  draftFromUnit,
  ORGANIZATION_UNIT_TYPE_LABELS,
  type OrganizationUnitDraft,
} from "./tenant-organization-units-form";
import {
  buildOrganizationUnitTree,
  findOrganizationUnit,
  type OrganizationUnitItem,
  type OrganizationUnitTree,
  type OrganizationUnitTreeNode,
  parentCandidates,
} from "./tenant-organization-units-tree";

type LoadState =
  | { status: "loading" }
  | { status: "unauthorized" }
  | { status: "error" }
  | { status: "loaded"; tree: OrganizationUnitTree };

type MutationState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

const ROOT_INVARIANT_MESSAGE =
  "La unidad raíz es estructural y no se puede mover, desactivar ni cambiar de tipo.";
const LIMIT_MESSAGE = "Se alcanzó el límite de unidades organizativas del workspace.";

function conflictMessage(body: { code?: unknown; message?: unknown }): string {
  switch (body.code) {
    case "ORGANIZATION_UNIT_LIMIT_REACHED":
      return LIMIT_MESSAGE;
    case "ORGANIZATION_UNIT_ROOT_INVARIANT":
      return ROOT_INVARIANT_MESSAGE;
    case "ORGANIZATION_UNIT_CYCLE":
      return "El movimiento crearía un ciclo en la jerarquía.";
    case "ORGANIZATION_UNIT_DEPTH_EXCEEDED":
      return "La jerarquía supera la profundidad máxima permitida.";
    default:
      return typeof body.message === "string"
        ? body.message
        : "No fue posible guardar los cambios.";
  }
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown };
    return conflictMessage(body);
  } catch {
    return "No fue posible guardar los cambios.";
  }
}

export function TenantAppOrganizationUnits() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async (): Promise<void> => {
    setLoadState({ status: "loading" });
    const response = await fetch(`${API_BASE_URL}/app/organization-units`, {
      credentials: "include",
    }).catch(() => null);
    if (response === null) return setLoadState({ status: "error" });
    if (response.status === 401) return setLoadState({ status: "unauthorized" });
    if (!response.ok) return setLoadState({ status: "error" });
    const body = (await response.json()) as {
      items: OrganizationUnitItem[];
      usage: { used: number; limit: string | null };
    };
    setLoadState({
      status: "loaded",
      tree: { items: body.items, roots: buildOrganizationUnitTree(body.items), usage: body.usage },
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadState.status === "loading")
    return <p className="tenant-app-theme-note">Cargando unidades…</p>;
  if (loadState.status === "unauthorized")
    return <p className="tenant-app-theme-note">Tu sesión no está disponible.</p>;
  if (loadState.status === "error") {
    return (
      <div className="tenant-app-theme-note">
        <p>No fue posible cargar las unidades organizativas.</p>
        <button onClick={() => void load()} type="button">
          Reintentar
        </button>
      </div>
    );
  }

  return <TenantAppOrganizationUnitsPanel onRefresh={load} tree={loadState.tree} />;
}

function findNodeById(
  node: OrganizationUnitTreeNode,
  unitId: string,
): OrganizationUnitTreeNode | null {
  if (node.item.id === unitId) return node;
  for (const child of node.children) {
    const found = findNodeById(child, unitId);
    if (found !== null) return found;
  }
  return null;
}

function TenantAppOrganizationUnitsPanel({
  onRefresh,
  tree,
}: Readonly<{ onRefresh: () => Promise<void>; tree: OrganizationUnitTree }>) {
  const rootUnit = tree.roots[0]?.item ?? null;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState<OrganizationUnitDraft>(() =>
    blankOrganizationUnitDraft(rootUnit?.id ?? ""),
  );
  const [editDraft, setEditDraft] = useState<OrganizationUnitDraft | null>(null);
  const [mutation, setMutation] = useState<MutationState>({ status: "idle" });

  const selected = selectedId === null ? null : findOrganizationUnit(tree.items, selectedId);
  const selectedNode =
    selected === null
      ? null
      : (tree.roots.flatMap((root) => findNodeById(root, selected.id) ?? [])[0] ?? null);
  const isRoot = selected !== null && selected.parentId === null;

  const toggleExpanded = (unitId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(unitId)) {
        next.delete(unitId);
      } else {
        next.add(unitId);
      }
      return next;
    });

  const runMutation = async (request: () => Promise<Response>): Promise<boolean> => {
    setMutation({ status: "saving" });
    const response = await request().catch(() => null);
    if (response === null || !response.ok) {
      setMutation({
        status: "error",
        message:
          response === null ? "No fue posible guardar los cambios." : await responseError(response),
      });
      return false;
    }
    setMutation({ status: "saved" });
    await onRefresh();
    return true;
  };

  const submitCreate = async () => {
    const body = canonicalCreateBody(createDraft);
    if (body === null) {
      setMutation({ status: "error", message: "Revisa los datos de la nueva unidad." });
      return;
    }
    const ok = await runMutation(() =>
      fetch(`${API_BASE_URL}/app/organization-units`, {
        body: JSON.stringify(body),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    if (ok) setCreateDraft(blankOrganizationUnitDraft(createDraft.parentId));
  };

  const submitUpdate = async () => {
    if (selected === null || editDraft === null) return;
    const body = canonicalUpdateBody(selected, editDraft);
    if (body === null) {
      setMutation({ status: "error", message: "Revisa los datos de la unidad." });
      return;
    }
    const ok = await runMutation(() =>
      fetch(`${API_BASE_URL}/app/organization-units/${selected.id}`, {
        body: JSON.stringify(body),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "PATCH",
      }),
    );
    if (ok) {
      setEditDraft(null);
      setSelectedId(null);
      setMutation({ status: "idle" });
    }
  };

  const renderNode = (node: OrganizationUnitTreeNode): ReactNode => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(node.item.id);
    return (
      <li className="tenant-app-ou-node" key={node.item.id}>
        <div className="tenant-app-ou-row">
          {hasChildren ? (
            <button
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? "Contraer" : "Expandir"} ${node.item.name}`}
              className="tenant-app-ou-toggle"
              onClick={() => toggleExpanded(node.item.id)}
              type="button"
            >
              {isExpanded ? "▾" : "▸"}
            </button>
          ) : (
            <span aria-hidden="true" className="tenant-app-ou-toggle tenant-app-ou-toggle-empty" />
          )}
          <button
            aria-pressed={selectedId === node.item.id}
            className="tenant-app-ou-name"
            onClick={() => {
              setSelectedId(node.item.id);
              setEditDraft(draftFromUnit(node.item));
            }}
            type="button"
          >
            <span>
              {node.item.name}
              {node.item.parentId === null ? <small> (raíz)</small> : null}
            </span>
            <small className="tenant-app-ou-kind">
              {node.item.type === "company"
                ? "Compañía"
                : ORGANIZATION_UNIT_TYPE_LABELS[node.item.type]}
              {!node.item.active ? " · Inactiva" : ""}
            </small>
          </button>
        </div>
        {hasChildren && isExpanded ? (
          <ul className="tenant-app-ou-children">{node.children.map(renderNode)}</ul>
        ) : null}
      </li>
    );
  };

  return (
    <section className="tenant-app-ou-editor">
      <p className="kicker">Configuración</p>
      <h1>Organización</h1>
      <p className="tenant-app-theme-subtitle">
        Crea y organiza las unidades de tu workspace: sucursales, departamentos y equipos.
      </p>

      {tree.usage.limit !== null ? (
        <p className="tenant-app-ou-usage">
          {tree.usage.used} de {tree.usage.limit} unidades en uso.
        </p>
      ) : null}

      <div className="tenant-app-theme-section">
        <h2>Árbol de unidades</h2>
        <ul aria-label="Unidades organizativas" className="tenant-app-ou-tree">
          {tree.roots.map(renderNode)}
        </ul>
      </div>

      {selected !== null && editDraft !== null ? (
        <div className="tenant-app-theme-section">
          <h2>{isRoot ? "Unidad raíz" : "Editar unidad"}</h2>
          <TenantAppOrganizationUnitForm
            draft={editDraft}
            isRoot={isRoot}
            onDraft={setEditDraft}
            parentCandidatesValue={
              isRoot || selectedNode === null ? [] : parentCandidates(tree.items, selectedNode)
            }
            submitLabel="Guardar cambios"
            onSave={() => void submitUpdate()}
          />
        </div>
      ) : null}

      <div className="tenant-app-theme-section">
        <h2>Nueva unidad</h2>
        <TenantAppOrganizationUnitForm
          draft={createDraft}
          isRoot={false}
          onDraft={setCreateDraft}
          parentCandidatesValue={tree.items}
          submitLabel="Crear unidad"
          onSave={() => void submitCreate()}
        />
      </div>

      {mutation.status === "saving" ? (
        <p className="tenant-app-theme-feedback">Guardando…</p>
      ) : null}
      {mutation.status === "saved" ? (
        <p className="tenant-app-theme-feedback">Cambios guardados.</p>
      ) : null}
      {mutation.status === "error" ? (
        <p className="tenant-app-theme-error" role="alert">
          {mutation.message}
        </p>
      ) : null}
    </section>
  );
}

function TenantAppOrganizationUnitForm({
  draft,
  isRoot,
  onDraft,
  onSave,
  parentCandidatesValue,
  submitLabel,
}: Readonly<{
  draft: OrganizationUnitDraft;
  isRoot: boolean;
  onDraft: (draft: OrganizationUnitDraft) => void;
  onSave: () => void;
  parentCandidatesValue: readonly OrganizationUnitItem[];
  submitLabel: string;
}>) {
  return (
    <div className="tenant-app-ou-form">
      {!isRoot ? (
        <label className="tenant-app-theme-color">
          <span>Depende de</span>
          <select
            onChange={(event) => onDraft({ ...draft, parentId: event.target.value })}
            value={draft.parentId}
          >
            {parentCandidatesValue.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="tenant-app-theme-help">{ROOT_INVARIANT_MESSAGE}</p>
      )}

      <label className="tenant-app-theme-color">
        <span>Nombre</span>
        <input
          maxLength={120}
          onChange={(event) => onDraft({ ...draft, name: event.target.value })}
          value={draft.name}
        />
      </label>

      {!isRoot ? (
        <label className="tenant-app-theme-color">
          <span>Tipo</span>
          <select
            onChange={(event) =>
              onDraft({ ...draft, type: event.target.value as OrganizationUnitDraft["type"] })
            }
            value={draft.type}
          >
            {(
              Object.keys(ORGANIZATION_UNIT_TYPE_LABELS) as Array<OrganizationUnitDraft["type"]>
            ).map((type) => (
              <option key={type} value={type}>
                {ORGANIZATION_UNIT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="tenant-app-theme-color">
        <span>Código</span>
        <input
          maxLength={40}
          onChange={(event) => onDraft({ ...draft, code: event.target.value })}
          placeholder="Opcional"
          value={draft.code}
        />
      </label>

      <label className="tenant-app-theme-color">
        <span>Zona horaria (IANA)</span>
        <input
          maxLength={100}
          onChange={(event) => onDraft({ ...draft, timezone: event.target.value })}
          placeholder="Ej. America/Mexico_City"
          value={draft.timezone}
        />
      </label>

      {!isRoot ? (
        <label className="tenant-app-theme-color">
          <span>Activa</span>
          <input
            checked={draft.active}
            onChange={(event) => onDraft({ ...draft, active: event.target.checked })}
            type="checkbox"
          />
        </label>
      ) : null}

      <div className="tenant-app-theme-actions">
        <button className="tenant-app-theme-save" onClick={onSave} type="button">
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
