"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTenantAppBootstrap } from "./tenant-app-shell";
import {
  assignmentKey,
  groupPermissionCatalog,
  type PermissionCatalogItem,
} from "./tenant-app-users-view-model";

type Assignment = Readonly<{ roleId: string; organizationUnitId: string | null }>;
type RoleOption = Readonly<{ id: string; key: string; name: string; isSystem: boolean }>;
type UnitOption = Readonly<{ id: string; name: string; parentId: string | null; active: boolean }>;
type User = Readonly<{
  id: string;
  displayName: string;
  email: string;
  status: "active" | "disabled";
  lastLoginAt: string | null;
  createdAt: string;
  roleAssignments: readonly Readonly<{
    role: Readonly<{ id: string; key: string; name: string }>;
    organizationUnit: Readonly<{ id: string; name: string }> | null;
  }>[];
}>;
type UserPage = Readonly<{
  items: readonly User[];
  page: number;
  pageSize: number;
  total: number;
  usage: Readonly<{ used: number; limit: string | null }>;
}>;
type Options = Readonly<{ roles: readonly RoleOption[]; organizationUnits: readonly UnitOption[] }>;
type Role = Readonly<{
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionKeys: readonly string[];
}>;
type RolePage = Readonly<{ roles: readonly Role[]; permissions: readonly PermissionCatalogItem[] }>;
type LoadState<T> =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "unauthorized" | "forbidden" | "error"; message?: string }>
  | Readonly<{ status: "loaded"; data: T }>;
type MutationState = Readonly<{ status: "idle" | "saving" | "saved" | "error"; message?: string }>;

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
const EMPTY_ASSIGNMENTS: readonly Assignment[] = [];

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return fallback;
  const value = body as { code?: unknown; message?: unknown };
  if (value.code === "USER_LIMIT_REACHED")
    return "Se alcanzó el límite de usuarios activos del workspace.";
  if (value.code === "LAST_OWNER_REQUIRED")
    return "Debe permanecer al menos un Owner activo con alcance de workspace.";
  if (value.code === "OWNER_ROLE_READ_ONLY")
    return "El permiso del Owner del sistema es de solo lectura.";
  if (value.code === "ROLE_PERMISSION_SCOPE_CONFLICT")
    return "Ese permiso tiene restricciones de alcance y no se puede editar aquí.";
  if (value.code === "USER_EMAIL_CONFLICT")
    return "Ya existe un usuario con ese email en este workspace.";
  return typeof value.message === "string" ? value.message : fallback;
}

async function responseFailure(response: Response, fallback: string): Promise<string> {
  try {
    return errorMessage(await response.json(), fallback);
  } catch {
    return fallback;
  }
}

async function getJson<T>(path: string): Promise<{ response: Response; data: T | null }> {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: "include" }).catch(
    () => null,
  );
  if (response === null) throw new Error("No fue posible conectar con el API.");
  if (!response.ok) return { data: null, response };
  return { data: (await response.json()) as T, response };
}

function loadFailure(response: Response): LoadState<never> {
  if (response.status === 401) return { status: "unauthorized" };
  if (response.status === 403)
    return { status: "forbidden", message: "No tienes permiso para esta sección." };
  return { status: "error", message: "No fue posible cargar los datos." };
}

function formatDate(value: string | null): string {
  if (value === null) return "Nunca";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(value));
}

function roleAssignmentLabel(assignment: User["roleAssignments"][number]): string {
  return `${assignment.role.name} · ${assignment.organizationUnit?.name ?? "Todo el workspace"}`;
}

export function TenantAppUsers() {
  const bootstrap = useTenantAppBootstrap();
  const canUsers = bootstrap.effectivePermissions.includes("tenant.users.manage");
  const canRoles = bootstrap.effectivePermissions.includes("tenant.roles.manage");
  const [section, setSection] = useState<"users" | "roles">(canUsers ? "users" : "roles");
  const [users, setUsers] = useState<LoadState<Readonly<{ page: UserPage; options: Options }>>>({
    status: "loading",
  });
  const [roles, setRoles] = useState<LoadState<RolePage>>({ status: "loading" });
  const [mutation, setMutation] = useState<MutationState>({ status: "idle" });

  const loadUsers = useCallback(async () => {
    if (!canUsers) return;
    setUsers({ status: "loading" });
    try {
      const [pageResult, optionsResult] = await Promise.all([
        getJson<UserPage>("/app/users?page=1&pageSize=25"),
        getJson<Options>("/app/users/options"),
      ]);
      if (!pageResult.response.ok) return setUsers(loadFailure(pageResult.response));
      if (!optionsResult.response.ok) return setUsers(loadFailure(optionsResult.response));
      if (pageResult.data === null || optionsResult.data === null)
        return setUsers({ status: "error" });
      setUsers({ data: { options: optionsResult.data, page: pageResult.data }, status: "loaded" });
    } catch (error) {
      setUsers({
        message: error instanceof Error ? error.message : "No fue posible cargar los usuarios.",
        status: "error",
      });
    }
  }, [canUsers]);

  const loadRoles = useCallback(async () => {
    if (!canRoles) return;
    setRoles({ status: "loading" });
    try {
      const result = await getJson<RolePage>("/app/roles");
      if (!result.response.ok) return setRoles(loadFailure(result.response));
      if (result.data === null) return setRoles({ status: "error" });
      setRoles({ data: result.data, status: "loaded" });
    } catch (error) {
      setRoles({
        message: error instanceof Error ? error.message : "No fue posible cargar los roles.",
        status: "error",
      });
    }
  }, [canRoles]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);
  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  if (!canUsers && !canRoles) {
    return (
      <section className="tenant-app-users">
        <p className="tenant-app-users-note">
          No tienes permisos para administrar usuarios o roles.
        </p>
      </section>
    );
  }

  const runMutation = async (
    request: () => Promise<Response>,
    success: string,
  ): Promise<boolean> => {
    setMutation({ status: "saving" });
    const response = await request().catch(() => null);
    if (response === null) {
      setMutation({ message: "No fue posible conectar con el API.", status: "error" });
      return false;
    }
    if (!response.ok) {
      setMutation({
        message: await responseFailure(response, "No fue posible guardar los cambios."),
        status: "error",
      });
      return false;
    }
    setMutation({ message: success, status: "saved" });
    return true;
  };

  const refreshUsers = async () => {
    await loadUsers();
  };
  const refreshRoles = async () => {
    await loadRoles();
  };

  return (
    <section className="tenant-app-users">
      <p className="kicker">Administración</p>
      <h1>Usuarios y roles</h1>
      <p className="tenant-app-users-subtitle">
        Gestiona accesos reales del workspace, con roles tenant-wide o acotados a una unidad
        organizativa.
      </p>
      <div
        aria-label="Secciones de usuarios y roles"
        className="tenant-app-users-tabs"
        role="tablist"
      >
        {canUsers ? (
          <button
            aria-selected={section === "users"}
            className={section === "users" ? "is-active" : ""}
            onClick={() => setSection("users")}
            role="tab"
            type="button"
          >
            Usuarios
          </button>
        ) : null}
        {canRoles ? (
          <button
            aria-selected={section === "roles"}
            className={section === "roles" ? "is-active" : ""}
            onClick={() => setSection("roles")}
            role="tab"
            type="button"
          >
            Roles
          </button>
        ) : null}
      </div>
      {mutation.status === "error" ? (
        <p className="tenant-app-users-error" role="alert">
          {mutation.message}
        </p>
      ) : null}
      {mutation.status === "saved" ? (
        <p className="tenant-app-users-feedback" role="status">
          {mutation.message}
        </p>
      ) : null}
      {section === "users" && canUsers ? (
        <UsersPanel
          loadState={users}
          mutation={mutation}
          onRefresh={refreshUsers}
          runMutation={runMutation}
        />
      ) : canRoles ? (
        <RolesPanel
          loadState={roles}
          mutation={mutation}
          onRefresh={refreshRoles}
          runMutation={runMutation}
        />
      ) : null}
    </section>
  );
}

function UsersPanel({
  loadState,
  mutation,
  onRefresh,
  runMutation,
}: Readonly<{
  loadState: LoadState<Readonly<{ page: UserPage; options: Options }>>;
  mutation: MutationState;
  onRefresh: () => Promise<void>;
  runMutation: (request: () => Promise<Response>, success: string) => Promise<boolean>;
}>) {
  if (loadState.status !== "loaded") {
    return <LoadStateMessage state={loadState} retry={onRefresh} label="usuarios" />;
  }
  return (
    <UsersLoaded
      data={loadState.data}
      mutation={mutation}
      onRefresh={onRefresh}
      runMutation={runMutation}
    />
  );
}

function UsersLoaded({
  data,
  mutation,
  onRefresh,
  runMutation,
}: Readonly<{
  data: Readonly<{ page: UserPage; options: Options }>;
  mutation: MutationState;
  onRefresh: () => Promise<void>;
  runMutation: (request: () => Promise<Response>, success: string) => Promise<boolean>;
}>) {
  const [createOpen, setCreateOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [assignments, setAssignments] = useState<readonly Assignment[]>(EMPTY_ASSIGNMENTS);
  const [selectedRoleId, setSelectedRoleId] = useState(data.options.roles[0]?.id ?? "");
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingAssignments, setEditingAssignments] =
    useState<readonly Assignment[]>(EMPTY_ASSIGNMENTS);

  const addAssignment = (
    current: readonly Assignment[],
    set: (value: readonly Assignment[]) => void,
  ) => {
    if (selectedRoleId === "") return;
    const organizationUnitId = selectedUnitId === "" ? null : selectedUnitId;
    const next = { organizationUnitId, roleId: selectedRoleId };
    if (
      current.some(
        (item) =>
          assignmentKey(item.roleId, item.organizationUnitId) ===
          assignmentKey(next.roleId, next.organizationUnitId),
      )
    )
      return;
    set(current.concat(next));
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedPassword = password;
    setPassword("");
    const ok = await runMutation(
      () =>
        fetch(`${API_BASE_URL}/app/users`, {
          body: JSON.stringify({
            displayName,
            email,
            password: submittedPassword,
            roleAssignments: assignments,
          }),
          credentials: "include",
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      "Usuario creado.",
    );
    if (ok) {
      setDisplayName("");
      setEmail("");
      setAssignments(EMPTY_ASSIGNMENTS);
      setCreateOpen(false);
      await onRefresh();
    }
  };

  const changeStatus = async (user: User) => {
    if (
      user.status === "active" &&
      !window.confirm(`¿Desactivar a ${user.displayName}? Sus sesiones activas quedarán revocadas.`)
    )
      return;
    if (
      await runMutation(
        () =>
          fetch(`${API_BASE_URL}/app/users/${user.id}/status`, {
            body: JSON.stringify({ status: user.status === "active" ? "disabled" : "active" }),
            credentials: "include",
            headers: { "content-type": "application/json" },
            method: "PATCH",
          }),
        user.status === "active" ? "Usuario desactivado." : "Usuario reactivado.",
      )
    )
      await onRefresh();
  };

  const saveAssignments = async () => {
    if (editingUserId === null) return;
    if (
      await runMutation(
        () =>
          fetch(`${API_BASE_URL}/app/users/${editingUserId}/role-assignments`, {
            body: JSON.stringify({ assignments: editingAssignments }),
            credentials: "include",
            headers: { "content-type": "application/json" },
            method: "PUT",
          }),
        "Asignaciones actualizadas.",
      )
    ) {
      setEditingUserId(null);
      await onRefresh();
    }
  };

  const roleById = useMemo(
    () => new Map(data.options.roles.map((role) => [role.id, role])),
    [data.options.roles],
  );
  const unitById = useMemo(
    () => new Map(data.options.organizationUnits.map((unit) => [unit.id, unit])),
    [data.options.organizationUnits],
  );
  const assignmentText = (item: Assignment) =>
    `${roleById.get(item.roleId)?.name ?? "Rol"} · ${item.organizationUnitId === null ? "Todo el workspace" : (unitById.get(item.organizationUnitId)?.name ?? "Unidad")}`;

  return (
    <>
      <div className="tenant-app-users-toolbar">
        <div>
          <strong>{data.page.usage.used}</strong> usuarios activos
          {data.page.usage.limit === null ? "" : ` de ${data.page.usage.limit}`}
        </div>
        <button
          className="tenant-app-users-primary"
          onClick={() => setCreateOpen((open) => !open)}
          type="button"
        >
          {createOpen ? "Cancelar" : "Crear usuario"}
        </button>
      </div>
      {createOpen ? (
        <form
          className="tenant-app-users-card tenant-app-users-form"
          onSubmit={(event) => void submitCreate(event)}
        >
          <h2>Nuevo usuario</h2>
          <div className="tenant-app-users-form-grid">
            <label>
              Nombre
              <input
                autoComplete="name"
                onChange={(event) => setDisplayName(event.target.value)}
                required
                value={displayName}
              />
            </label>
            <label>
              Email
              <input
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            <label>
              Contraseña inicial
              <input
                autoComplete="new-password"
                minLength={15}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
          </div>
          <AssignmentEditor
            assignments={assignments}
            onAdd={() => addAssignment(assignments, setAssignments)}
            onRemove={(key) =>
              setAssignments(
                assignments.filter(
                  (item) => assignmentKey(item.roleId, item.organizationUnitId) !== key,
                ),
              )
            }
            onRole={setSelectedRoleId}
            onUnit={setSelectedUnitId}
            roles={data.options.roles}
            selectedRoleId={selectedRoleId}
            selectedUnitId={selectedUnitId}
            units={data.options.organizationUnits}
            text={assignmentText}
          />
          <button
            className="tenant-app-users-primary"
            disabled={mutation.status === "saving"}
            type="submit"
          >
            {mutation.status === "saving" ? "Guardando…" : "Crear usuario"}
          </button>
        </form>
      ) : null}
      {editingUserId !== null ? (
        <div className="tenant-app-users-card tenant-app-users-form">
          <h2>Administrar roles y scopes</h2>
          <AssignmentEditor
            assignments={editingAssignments}
            onAdd={() => addAssignment(editingAssignments, setEditingAssignments)}
            onRemove={(key) =>
              setEditingAssignments(
                editingAssignments.filter(
                  (item) => assignmentKey(item.roleId, item.organizationUnitId) !== key,
                ),
              )
            }
            onRole={setSelectedRoleId}
            onUnit={setSelectedUnitId}
            roles={data.options.roles}
            selectedRoleId={selectedRoleId}
            selectedUnitId={selectedUnitId}
            units={data.options.organizationUnits}
            text={assignmentText}
          />
          <div className="tenant-app-users-actions">
            <button
              className="tenant-app-users-primary"
              disabled={mutation.status === "saving"}
              onClick={() => void saveAssignments()}
              type="button"
            >
              Guardar asignaciones
            </button>
            <button onClick={() => setEditingUserId(null)} type="button">
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
      <div className="tenant-app-users-card tenant-app-users-table-wrap">
        <h2>Usuarios</h2>
        {data.page.items.length === 0 ? (
          <p className="tenant-app-users-note">No hay usuarios que mostrar.</p>
        ) : (
          <table className="tenant-app-users-table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Estado</th>
                <th>Roles y alcance</th>
                <th>Último acceso</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data.page.items.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.displayName}</strong>
                    <small>{user.email}</small>
                  </td>
                  <td>
                    <span className={`tenant-app-users-status is-${user.status}`}>
                      {user.status === "active" ? "Activo" : "Desactivado"}
                    </span>
                  </td>
                  <td>
                    <div className="tenant-app-users-chips">
                      {user.roleAssignments.length === 0 ? (
                        <span>Sin roles</span>
                      ) : (
                        user.roleAssignments.map((item) => (
                          <span key={`${item.role.id}:${item.organizationUnit?.id ?? "wide"}`}>
                            {roleAssignmentLabel(item)}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td>{formatDate(user.lastLoginAt)}</td>
                  <td>
                    <div className="tenant-app-users-actions">
                      <button
                        onClick={() => {
                          setEditingUserId(user.id);
                          setEditingAssignments(
                            user.roleAssignments.map((item) => ({
                              organizationUnitId: item.organizationUnit?.id ?? null,
                              roleId: item.role.id,
                            })),
                          );
                        }}
                        type="button"
                      >
                        Roles
                      </button>
                      <button onClick={() => void changeStatus(user)} type="button">
                        {user.status === "active" ? "Desactivar" : "Reactivar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function AssignmentEditor({
  assignments,
  onAdd,
  onRemove,
  onRole,
  onUnit,
  roles,
  selectedRoleId,
  selectedUnitId,
  text,
  units,
}: Readonly<{
  assignments: readonly Assignment[];
  onAdd: () => void;
  onRemove: (key: string) => void;
  onRole: (value: string) => void;
  onUnit: (value: string) => void;
  roles: readonly RoleOption[];
  selectedRoleId: string;
  selectedUnitId: string;
  text: (assignment: Assignment) => string;
  units: readonly UnitOption[];
}>) {
  return (
    <fieldset className="tenant-app-users-assignments">
      <legend>Roles y alcance</legend>
      <div className="tenant-app-users-assignment-row">
        <label>
          Rol
          <select onChange={(event) => onRole(event.target.value)} value={selectedRoleId}>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Alcance
          <select onChange={(event) => onUnit(event.target.value)} value={selectedUnitId}>
            <option value="">Todo el workspace</option>
            {units.map((unit) => (
              <option disabled={!unit.active} key={unit.id} value={unit.id}>
                {unit.name}
                {unit.active ? "" : " (inactiva)"}
              </option>
            ))}
          </select>
        </label>
        <button onClick={onAdd} type="button">
          Agregar
        </button>
      </div>
      <ul className="tenant-app-users-assignment-list">
        {assignments.map((item) => (
          <li key={assignmentKey(item.roleId, item.organizationUnitId)}>
            <span>{text(item)}</span>
            <button
              aria-label={`Quitar ${text(item)}`}
              onClick={() => onRemove(assignmentKey(item.roleId, item.organizationUnitId))}
              type="button"
            >
              Quitar
            </button>
          </li>
        ))}
      </ul>
      <small>Un rol con alcance de unidad no equivale a un permiso para todo el workspace.</small>
    </fieldset>
  );
}

function RolesPanel({
  loadState,
  mutation,
  onRefresh,
  runMutation,
}: Readonly<{
  loadState: LoadState<RolePage>;
  mutation: MutationState;
  onRefresh: () => Promise<void>;
  runMutation: (request: () => Promise<Response>, success: string) => Promise<boolean>;
}>) {
  if (loadState.status !== "loaded")
    return <LoadStateMessage state={loadState} retry={onRefresh} label="roles" />;
  return (
    <RolesLoaded
      data={loadState.data}
      mutation={mutation}
      onRefresh={onRefresh}
      runMutation={runMutation}
    />
  );
}

function RolesLoaded({
  data,
  mutation,
  onRefresh,
  runMutation,
}: Readonly<{
  data: RolePage;
  mutation: MutationState;
  onRefresh: () => Promise<void>;
  runMutation: (request: () => Promise<Response>, success: string) => Promise<boolean>;
}>) {
  const [roleId, setRoleId] = useState(data.roles[0]?.id ?? "");
  const role = data.roles.find((item) => item.id === roleId) ?? data.roles[0];
  const [selectedPermissions, setSelectedPermissions] = useState<readonly string[]>(
    role?.permissionKeys ?? [],
  );
  useEffect(() => setSelectedPermissions(role?.permissionKeys ?? []), [role]);
  if (role === undefined)
    return <p className="tenant-app-users-note">No hay roles built-in disponibles.</p>;
  const groups = groupPermissionCatalog(data.permissions);
  const readOnly = role.key === "owner" && role.isSystem;
  const save = async () => {
    const additions = selectedPermissions.filter((key) => !role.permissionKeys.includes(key));
    if (
      additions.length > 0 &&
      !window.confirm("Estás concediendo permisos adicionales. ¿Deseas continuar?")
    )
      return;
    if (
      await runMutation(
        () =>
          fetch(`${API_BASE_URL}/app/roles/${role.id}/permissions`, {
            body: JSON.stringify({ permissionKeys: selectedPermissions }),
            credentials: "include",
            headers: { "content-type": "application/json" },
            method: "PUT",
          }),
        "Permisos actualizados.",
      )
    )
      await onRefresh();
  };
  return (
    <div className="tenant-app-users-card tenant-app-roles-card">
      <div className="tenant-app-users-role-picker">
        <label>
          Rol
          <select onChange={(event) => setRoleId(event.target.value)} value={role.id}>
            {data.roles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {readOnly ? (
          <span className="tenant-app-users-note">
            Owner del sistema: permisos de solo lectura.
          </span>
        ) : null}
      </div>
      <p className="tenant-app-users-subtitle">
        Los permisos se agrupan desde el catálogo canónico. Los scopes de Organization Unit no se
        convierten en permisos tenant-wide.
      </p>
      {groups.map((group) => (
        <fieldset className="tenant-app-users-permission-group" key={group.id}>
          <legend>{group.label}</legend>
          {group.items.map((permission) => (
            <label key={permission.key}>
              <input
                checked={selectedPermissions.includes(permission.key)}
                disabled={readOnly || mutation.status === "saving"}
                onChange={(event) =>
                  setSelectedPermissions((current) =>
                    event.target.checked
                      ? [...current, permission.key]
                      : current.filter((key) => key !== permission.key),
                  )
                }
                type="checkbox"
              />{" "}
              <span>
                <strong>{permission.key}</strong>
                <small>{permission.description}</small>
              </span>
            </label>
          ))}
        </fieldset>
      ))}
      {!readOnly ? (
        <button
          className="tenant-app-users-primary"
          disabled={mutation.status === "saving"}
          onClick={() => void save()}
          type="button"
        >
          {mutation.status === "saving" ? "Guardando…" : "Guardar permisos"}
        </button>
      ) : null}
      <p className="tenant-app-users-note">Roles personalizados: no disponible todavía.</p>
    </div>
  );
}

function LoadStateMessage({
  state,
  retry,
  label,
}: Readonly<{ state: LoadState<unknown>; retry: () => Promise<void>; label: string }>) {
  if (state.status === "loading") return <p className="tenant-app-users-note">Cargando {label}…</p>;
  if (state.status === "unauthorized")
    return <p className="tenant-app-users-note">Tu sesión no está disponible.</p>;
  if (state.status === "forbidden") return <p className="tenant-app-users-note">{state.message}</p>;
  if (state.status === "error") {
    return (
      <div className="tenant-app-users-note">
        <p>{state.message ?? `No fue posible cargar ${label}.`}</p>
        <button onClick={() => void retry()} type="button">
          Reintentar
        </button>
      </div>
    );
  }
  return null;
}
