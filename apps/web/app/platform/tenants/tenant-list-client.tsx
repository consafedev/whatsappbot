"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import {
  channelCountLabel,
  formatObservedActivity,
  moduleLabel,
  type PlatformTenantListResponse,
  requestStateForResponse,
  type TenantListRequestState,
  type TenantStatus,
} from "./tenant-list-view-model";

const statusLabels: Readonly<Record<TenantStatus, string>> = {
  active: "Activo",
  archived: "Archivado",
  offboarding: "Offboarding",
  provisioning: "Provisioning",
  suspended: "Suspendido",
};

const deploymentStatusLabels = {
  degraded: "Degraded",
  healthy: "Healthy",
  maintenance: "Mantenimiento",
  offline: "Offline",
} as const;

type LoadState = "loading" | TenantListRequestState;

export function TenantListClient({
  apiBaseUrl,
  createdSlug,
}: Readonly<{ apiBaseUrl: string; createdSlug: string | null }>) {
  const router = useRouter();
  const [data, setData] = useState<PlatformTenantListResponse | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (retry < 0) return;
    const controller = new AbortController();
    const parameters = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (search.length > 0) parameters.set("search", search);
    if (status.length > 0) parameters.set("status", status);
    setState("loading");

    void fetch(`${apiBaseUrl}/platform/tenants?${parameters}`, {
      credentials: "include",
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          setData(null);
          setState(requestStateForResponse(response.status));
          return;
        }
        const payload = (await response.json()) as PlatformTenantListResponse;
        setData(payload);
        setState(requestStateForResponse(response.status, payload.items));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setData(null);
        setState("error");
      });

    return () => controller.abort();
  }, [apiBaseUrl, page, retry, search, status]);

  useEffect(() => {
    if (state === "unauthorized") {
      router.replace("/?access=platform&next=%2Fplatform%2Ftenants#portal-login");
    }
  }, [router, state]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearch(searchDraft.trim());
  }

  const first = data === null || data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const last = data === null ? 0 : Math.min(data.page * data.pageSize, data.total);
  const hasNext = data !== null && data.page * data.pageSize < data.total;

  return (
    <div className="platform-shell">
      <aside className="platform-sidebar" aria-label="Navegación de Platform Control">
        <div className="platform-brand">
          <span className="platform-mark" aria-hidden="true">
            W
          </span>
          <span>
            <strong>WhatsApp Bot</strong>
            <small>Platform Control</small>
          </span>
        </div>
        <nav>
          <span className="nav-group-label">Platform Control</span>
          <span className="nav-item nav-item-active" aria-current="page">
            Tenants
          </span>
        </nav>
        <div className="platform-role">Super Admin · interno</div>
      </aside>

      <div className="platform-main">
        <header className="platform-topbar">
          <strong>Platform Control</strong>
          <span aria-hidden="true">·</span>
          <span>Tenants</span>
        </header>
        <main className="tenant-content">
          <div className="tenant-heading">
            <div>
              <p className="kicker">Platform Control</p>
              <h1>Tenants</h1>
              <p className="tenant-subtitle">
                Estado operativo y uso real, sin exponer contenido sensible.
              </p>
            </div>
            <a className="button-primary" href="/platform/tenants/new">
              Crear tenant
            </a>
          </div>

          {createdSlug !== null && (
            <div className="success-banner" role="status">
              Tenant creado: <code>{createdSlug}</code>
            </div>
          )}

          <div className="tenant-toolbar">
            <form className="tenant-search" onSubmit={submitSearch}>
              <label htmlFor="tenant-search">Buscar tenants</label>
              <div className="search-row">
                <input
                  id="tenant-search"
                  maxLength={200}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Nombre, razón social o slug"
                  type="search"
                  value={searchDraft}
                />
                <button type="submit">Buscar</button>
              </div>
            </form>
            <div className="tenant-filter">
              <label htmlFor="tenant-status">Estado</label>
              <select
                id="tenant-status"
                onChange={(event) => {
                  setPage(1);
                  setStatus(event.target.value);
                }}
                value={status}
              >
                <option value="">Todos</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {state === "loading" && (
            <div className="state-panel" role="status">
              Cargando tenants…
            </div>
          )}
          {state === "unauthorized" && (
            <div className="state-panel state-error" role="alert">
              <strong>Sesión de Platform Admin requerida</strong>
              <span>Redirigiendo al acceso de Platform Control…</span>
              <Link href="/?access=platform&next=%2Fplatform%2Ftenants#portal-login">
                Iniciar sesión
              </Link>
            </div>
          )}
          {state === "error" && (
            <div className="state-panel state-error" role="alert">
              <strong>No fue posible cargar los tenants</strong>
              <span>La respuesta administrativa no está disponible en este momento.</span>
              <button type="button" onClick={() => setRetry((value) => value + 1)}>
                Reintentar
              </button>
            </div>
          )}
          {state === "empty" && (
            <div className="state-panel" role="status">
              <strong>No hay tenants</strong>
            </div>
          )}

          {state === "loaded" && data !== null && (
            <>
              <div className="tenant-table-wrap">
                <table className="tenant-table">
                  <thead>
                    <tr>
                      <th scope="col">Tenant</th>
                      <th scope="col">Estado</th>
                      <th scope="col">Deployment</th>
                      <th scope="col">Módulos</th>
                      <th scope="col">Canales</th>
                      <th scope="col">Usuarios</th>
                      <th scope="col">Actividad</th>
                      <th scope="col">Salud</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((tenant) => (
                      <tr key={tenant.id}>
                        <td>
                          <strong>
                            <Link href={`/platform/tenants/${tenant.id}`}>
                              {tenant.displayName}
                            </Link>
                          </strong>
                          <span className="cell-meta">{tenant.legalName}</span>
                          <code>{tenant.slug}</code>
                        </td>
                        <td>
                          <span className={`status status-${tenant.status}`}>
                            {statusLabels[tenant.status]}
                          </span>
                        </td>
                        <td>
                          {tenant.deployment === null ? (
                            "—"
                          ) : (
                            <>
                              <strong>{tenant.deployment.name}</strong>
                              <span className="cell-meta">
                                {tenant.deployment.mode} · {tenant.deployment.environment}
                              </span>
                              <code>{tenant.deployment.currentVersion}</code>
                            </>
                          )}
                        </td>
                        <td>
                          <div className="module-list">
                            {tenant.enabledModules.length === 0
                              ? "—"
                              : tenant.enabledModules.map((key) => (
                                  <span className="module-badge" key={key}>
                                    {moduleLabel(key)}
                                  </span>
                                ))}
                          </div>
                        </td>
                        <td
                          className="numeric"
                          title={tenant.channelCount === null ? "Sin datos disponibles" : undefined}
                        >
                          {channelCountLabel(tenant.channelCount)}
                        </td>
                        <td className="numeric">{tenant.userCount}</td>
                        <td>
                          <time dateTime={tenant.lastActivityAt ?? undefined}>
                            {formatObservedActivity(tenant.lastActivityAt)}
                          </time>
                        </td>
                        <td>
                          {tenant.deployment === null ? (
                            "—"
                          ) : (
                            <span className={`health health-${tenant.deployment.status}`}>
                              <span aria-hidden="true" />
                              {deploymentStatusLabels[tenant.deployment.status]}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="tenant-pagination">
                <span>
                  Mostrando {first}–{last} de {data.total} tenants
                </span>
                <div>
                  <button
                    type="button"
                    disabled={page === 1}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={!hasNext}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
