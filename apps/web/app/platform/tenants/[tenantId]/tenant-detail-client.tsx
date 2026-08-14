"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  type DeferredState,
  deferredStateForStatus,
  detailStateForStatus,
  displayDate,
  displayLimit,
  type PlatformTenantAuditPage,
  type PlatformTenantDetail,
  type PlatformTenantUserPage,
  TENANT_DETAIL_TABS,
  type TenantDetailState,
} from "./tenant-detail-view-model";

type Tab = (typeof TENANT_DETAIL_TABS)[number];
type DetailLoadState = "loading" | TenantDetailState;

function StatePanel({ state }: Readonly<{ state: DetailLoadState }>) {
  const message =
    state === "loading"
      ? "Cargando tenant…"
      : state === "not-found"
        ? "El tenant no existe."
        : state === "unauthorized"
          ? "Tu sesión de Platform Admin no es válida."
          : "No fue posible cargar el tenant.";
  return (
    <div className="state-panel">
      <strong>{message}</strong>
    </div>
  );
}

function Pager({
  page,
  pageSize,
  total,
  onChange,
}: Readonly<{ page: number; pageSize: number; total: number; onChange(value: number): void }>) {
  return (
    <div className="tenant-pagination">
      <span>
        Página {page} · {total} registros
      </span>
      <div>
        <button type="button" disabled={page === 1} onClick={() => onChange(page - 1)}>
          Anterior
        </button>
        <button
          type="button"
          disabled={page * pageSize >= total}
          onClick={() => onChange(page + 1)}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

export function TenantDetailClient({
  apiBaseUrl,
  tenantId,
}: Readonly<{ apiBaseUrl: string; tenantId: string }>) {
  const [detail, setDetail] = useState<PlatformTenantDetail | null>(null);
  const [state, setState] = useState<DetailLoadState>("loading");
  const [tab, setTab] = useState<Tab>("General");
  const [users, setUsers] = useState<PlatformTenantUserPage | null>(null);
  const [usersState, setUsersState] = useState<DeferredState>("idle");
  const [usersPage, setUsersPage] = useState(1);
  const [audit, setAudit] = useState<PlatformTenantAuditPage | null>(null);
  const [auditState, setAuditState] = useState<DeferredState>("idle");
  const [auditPage, setAuditPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    void fetch(`${apiBaseUrl}/platform/tenants/${encodeURIComponent(tenantId)}`, {
      credentials: "include",
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const next = detailStateForStatus(response.status);
        setState(next);
        setDetail(next === "loaded" ? ((await response.json()) as PlatformTenantDetail) : null);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setState("error");
      });
    return () => controller.abort();
  }, [apiBaseUrl, tenantId]);

  useEffect(() => {
    if (tab !== "Usuarios") return;
    const controller = new AbortController();
    setUsersState("loading");
    void fetch(
      `${apiBaseUrl}/platform/tenants/${encodeURIComponent(tenantId)}/users?page=${usersPage}&pageSize=25`,
      {
        credentials: "include",
        headers: { accept: "application/json" },
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const payload = response.ok ? ((await response.json()) as PlatformTenantUserPage) : null;
        setUsers(payload);
        setUsersState(deferredStateForStatus(response.status, payload?.items.length ?? 0));
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setUsersState("error");
      });
    return () => controller.abort();
  }, [apiBaseUrl, tab, tenantId, usersPage]);

  useEffect(() => {
    if (tab !== "Auditoría") return;
    const controller = new AbortController();
    setAuditState("loading");
    void fetch(
      `${apiBaseUrl}/platform/tenants/${encodeURIComponent(tenantId)}/audit?page=${auditPage}&pageSize=25`,
      {
        credentials: "include",
        headers: { accept: "application/json" },
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const payload = response.ok ? ((await response.json()) as PlatformTenantAuditPage) : null;
        setAudit(payload);
        setAuditState(deferredStateForStatus(response.status, payload?.items.length ?? 0));
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setAuditState("error");
      });
    return () => controller.abort();
  }, [apiBaseUrl, auditPage, tab, tenantId]);

  return (
    <div className="platform-shell">
      <aside className="platform-sidebar" aria-label="Navegación de Platform Control">
        <div className="platform-brand">
          <span className="platform-mark" aria-hidden="true">
            W
          </span>
          <span>
            <strong>Platform Control</strong>
            <small>WhatsApp Automation</small>
          </span>
        </div>
        <nav>
          <span className="nav-group-label">Administración</span>
          <Link className="nav-item nav-item-active" href="/platform/tenants">
            Tenants
          </Link>
        </nav>
        <div className="platform-role">Platform Admin</div>
      </aside>
      <div className="platform-main">
        <header className="platform-topbar">
          <Link href="/platform/tenants">Tenants</Link>
          <span>/</span>
          <strong>{detail?.general.displayName ?? "Detalle"}</strong>
        </header>
        <main className="tenant-content tenant-detail-content">
          {state !== "loaded" || detail === null ? (
            <StatePanel state={state} />
          ) : (
            <>
              <div className="tenant-heading">
                <div>
                  <p className="kicker">Tenant</p>
                  <h1>{detail.general.displayName}</h1>
                  <p className="tenant-subtitle">
                    {detail.general.legalName} · <code>{detail.general.slug}</code>
                  </p>
                </div>
                <span className={`status status-${detail.general.status}`}>
                  {detail.general.status}
                </span>
              </div>
              <div className="detail-tabs" role="tablist" aria-label="Detalle del tenant">
                {TENANT_DETAIL_TABS.map((name) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === name}
                    className={tab === name ? "is-active" : ""}
                    key={name}
                    onClick={() => setTab(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <section className="detail-panel" role="tabpanel">
                {tab === "General" && (
                  <>
                    <h2>Información general</h2>
                    <dl className="detail-grid">
                      {[
                        ["ID", detail.general.id],
                        ["Nombre legal", detail.general.legalName],
                        ["Nombre visible", detail.general.displayName],
                        ["Slug", detail.general.slug],
                        ["Estado", detail.general.status],
                        ["Zona horaria", detail.general.defaultTimezone],
                        ["Locale", detail.general.defaultLocale],
                        ["Moneda", detail.general.defaultCurrency],
                        ["Creado", displayDate(detail.general.createdAt)],
                        ["Actualizado", displayDate(detail.general.updatedAt)],
                        ["Suspendido", displayDate(detail.general.suspendedAt)],
                        ["Tema", detail.general.themeMode],
                        ["Branding personalizado", detail.general.brandingOverride ? "Sí" : "No"],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <h2>Unidad raíz</h2>
                    {detail.organizationRoot === null ? (
                      <p className="neutral-note">No hay unidad raíz registrada.</p>
                    ) : (
                      <dl className="detail-grid">
                        <div>
                          <dt>Nombre</dt>
                          <dd>{detail.organizationRoot.name}</dd>
                        </div>
                        <div>
                          <dt>Tipo</dt>
                          <dd>{detail.organizationRoot.type}</dd>
                        </div>
                        <div>
                          <dt>Activa</dt>
                          <dd>{detail.organizationRoot.active ? "Sí" : "No"}</dd>
                        </div>
                        <div>
                          <dt>ID</dt>
                          <dd>{detail.organizationRoot.id}</dd>
                        </div>
                      </dl>
                    )}
                  </>
                )}
                {tab === "Módulos" && (
                  <>
                    <h2>Entitlements de módulos</h2>
                    <div className="tenant-table-wrap">
                      <table className="tenant-table detail-table">
                        <thead>
                          <tr>
                            <th>Módulo</th>
                            <th>Configurado</th>
                            <th>Efectivo</th>
                            <th>Origen</th>
                            <th>Inicio</th>
                            <th>Fin</th>
                            <th>Config</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.modules.map((module) => (
                            <tr key={module.key}>
                              <td>
                                <code>{module.key}</code>
                              </td>
                              <td>{module.enabled ? "Sí" : "No"}</td>
                              <td>{module.effective ? "Sí" : "No"}</td>
                              <td>{module.source ?? "—"}</td>
                              <td>{displayDate(module.startsAt)}</td>
                              <td>{displayDate(module.endsAt)}</td>
                              <td>{module.configPresent ? "Presente" : "Vacía"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <h2>Límites</h2>
                    <div className="tenant-table-wrap">
                      <table className="tenant-table detail-table">
                        <thead>
                          <tr>
                            <th>Clave</th>
                            <th>Valor</th>
                            <th>Origen</th>
                            <th>Inicio</th>
                            <th>Fin</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.limits.map((limit) => (
                            <tr key={limit.key}>
                              <td>
                                <code>{limit.key}</code>
                              </td>
                              <td>{displayLimit(limit.limitValue)}</td>
                              <td>{limit.source ?? "—"}</td>
                              <td>{displayDate(limit.startsAt)}</td>
                              <td>{displayDate(limit.endsAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                {tab === "Usuarios" &&
                  (usersState === "loading" || usersState === "idle" ? (
                    <p className="neutral-note">Cargando usuarios…</p>
                  ) : usersState === "empty" ? (
                    <p className="neutral-note">Este tenant no tiene usuarios.</p>
                  ) : usersState !== "loaded" || users === null ? (
                    <p className="neutral-note">
                      No fue posible cargar los usuarios ({usersState}).
                    </p>
                  ) : (
                    <>
                      <h2>Usuarios</h2>
                      <div className="tenant-table-wrap">
                        <table className="tenant-table detail-table">
                          <thead>
                            <tr>
                              <th>Usuario</th>
                              <th>Estado</th>
                              <th>Locale / zona</th>
                              <th>MFA</th>
                              <th>Último acceso</th>
                              <th>Roles</th>
                            </tr>
                          </thead>
                          <tbody>
                            {users.items.map((user) => (
                              <tr key={user.id}>
                                <td>
                                  <strong>{user.displayName}</strong>
                                  <span className="cell-meta">{user.email}</span>
                                </td>
                                <td>{user.status}</td>
                                <td>
                                  {user.locale}
                                  <span className="cell-meta">{user.timezone}</span>
                                </td>
                                <td>{user.mfaState}</td>
                                <td>{displayDate(user.lastLoginAt)}</td>
                                <td>
                                  {user.roles.length === 0
                                    ? "—"
                                    : user.roles.map((role) => (
                                        <span
                                          className="module-badge"
                                          key={`${role.key}-${role.organizationUnit?.id ?? "all"}`}
                                        >
                                          {role.name}
                                          {role.organizationUnit === null
                                            ? ""
                                            : ` · ${role.organizationUnit.name}`}
                                        </span>
                                      ))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <Pager
                        page={users.page}
                        pageSize={users.pageSize}
                        total={users.total}
                        onChange={setUsersPage}
                      />
                    </>
                  ))}
                {tab === "Canales" && (
                  <>
                    <h2>Canales</h2>
                    <p className="neutral-note">
                      La información de canales todavía no está disponible. No se infiere ningún
                      conteo.
                    </p>
                  </>
                )}
                {tab === "Deployment" && (
                  <>
                    <h2>Deployment</h2>
                    {detail.deployment === null ? (
                      <p className="neutral-note">Este tenant no tiene deployment asignado.</p>
                    ) : (
                      <dl className="detail-grid">
                        {[
                          ["Nombre", detail.deployment.name],
                          ["Modo", detail.deployment.mode],
                          ["Entorno", detail.deployment.environment],
                          ["Versión actual", detail.deployment.currentVersion],
                          ["Versión objetivo", detail.deployment.targetVersion ?? "—"],
                          ["Canal", detail.deployment.releaseChannel],
                          ["Estado", detail.deployment.status],
                          ["Última salud", displayDate(detail.deployment.lastHealthAt)],
                          ["ID", detail.deployment.id],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </>
                )}
                {tab === "Uso" && (
                  <>
                    <h2>Uso observado</h2>
                    <div className="usage-grid">
                      {Object.entries(detail.usage).map(([key, value]) => (
                        <article key={key}>
                          <strong>{key}</strong>
                          <span>Usado: {value.used === null ? "No disponible" : value.used}</span>
                          <span>Límite: {displayLimit(value.limit)}</span>
                        </article>
                      ))}
                    </div>
                    <p className="neutral-note">
                      Los valores no observables se muestran como no disponibles; nunca se
                      sustituyen por cero.
                    </p>
                  </>
                )}
                {tab === "Auditoría" &&
                  (auditState === "loading" || auditState === "idle" ? (
                    <p className="neutral-note">Cargando auditoría…</p>
                  ) : auditState === "empty" ? (
                    <p className="neutral-note">No hay eventos de auditoría para este tenant.</p>
                  ) : auditState !== "loaded" || audit === null ? (
                    <p className="neutral-note">
                      No fue posible cargar la auditoría ({auditState}).
                    </p>
                  ) : (
                    <>
                      <h2>Auditoría</h2>
                      <div className="tenant-table-wrap">
                        <table className="tenant-table detail-table">
                          <thead>
                            <tr>
                              <th>Fecha</th>
                              <th>Acción</th>
                              <th>Actor</th>
                              <th>Entidad</th>
                              <th>Request ID</th>
                              <th>Unidad</th>
                            </tr>
                          </thead>
                          <tbody>
                            {audit.items.map((item) => (
                              <tr key={item.id}>
                                <td>{displayDate(item.occurredAt)}</td>
                                <td>{item.action}</td>
                                <td>
                                  {item.actorType}
                                  <span className="cell-meta">{item.actorId ?? "—"}</span>
                                </td>
                                <td>
                                  {item.entityType}
                                  <span className="cell-meta">{item.entityId}</span>
                                </td>
                                <td>
                                  <code>{item.requestId}</code>
                                </td>
                                <td>{item.organizationUnitId ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <Pager
                        page={audit.page}
                        pageSize={audit.pageSize}
                        total={audit.total}
                        onChange={setAuditPage}
                      />
                    </>
                  ))}
                {tab === "Backup" && (
                  <>
                    <h2>Backup</h2>
                    <p className="neutral-note">
                      El estado de backup todavía no está disponible. Esta vista no representa
                      respaldos, fechas ni resultados simulados.
                    </p>
                  </>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
