"use client";

import { useEffect, useState } from "react";
import type { PlatformTenantDetail } from "./tenant-detail-view-model";

type ModuleItem = PlatformTenantDetail["modules"][number];
type LimitItem = PlatformTenantDetail["limits"][number];

const statusLabels = {
  disabled: "Disabled",
  effective: "Enabled / effective",
  expired: "Enabled / expired",
  scheduled: "Enabled / scheduled",
} as const;

function inputDate(value: string | null): string {
  if (value === null) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function apiDate(value: string): string | null {
  return value === "" ? null : new Date(value).toISOString();
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: unknown };
    return typeof payload.message === "string" ? payload.message : `Error ${response.status}`;
  } catch {
    return `Error ${response.status}`;
  }
}

export function EntitlementControls({
  apiBaseUrl,
  tenantId,
  modules,
  limits,
  onRefresh,
}: Readonly<{
  apiBaseUrl: string;
  tenantId: string;
  modules: PlatformTenantDetail["modules"];
  limits: PlatformTenantDetail["limits"];
  onRefresh(): Promise<void>;
}>) {
  const [selected, setSelected] = useState<ModuleItem | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [configText, setConfigText] = useState("{}");
  const [moduleBusy, setModuleBusy] = useState<string | null>(null);
  const [limitBusy, setLimitBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [limitValues, setLimitValues] = useState<Record<string, string>>({});
  const [limitDates, setLimitDates] = useState<
    Record<string, { startsAt: string; endsAt: string }>
  >({});

  useEffect(() => {
    setLimitValues(Object.fromEntries(limits.map((item) => [item.key, item.limitValue ?? ""])));
    setLimitDates(
      Object.fromEntries(
        limits.map((item) => [
          item.key,
          { endsAt: inputDate(item.endsAt), startsAt: inputDate(item.startsAt) },
        ]),
      ),
    );
  }, [limits]);

  async function patchModule(module: ModuleItem, enabled: boolean): Promise<void> {
    if (
      !enabled &&
      !window.confirm(
        "El módulo dejará de permitir nuevas operaciones. Sus datos y configuración se conservarán.",
      )
    )
      return;
    setMessage(null);
    setModuleBusy(module.key);
    try {
      const response = await fetch(
        `${apiBaseUrl}/platform/tenants/${encodeURIComponent(tenantId)}/entitlements/modules/${encodeURIComponent(module.key)}`,
        {
          body: JSON.stringify({ enabled }),
          credentials: "include",
          headers: { "content-type": "application/json" },
          method: "PATCH",
        },
      );
      if (!response.ok) throw new Error(await errorMessage(response));
      await onRefresh();
      setMessage(`${module.key} actualizado.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible actualizar el módulo.");
    } finally {
      setModuleBusy(null);
    }
  }

  async function openEditor(module: ModuleItem): Promise<void> {
    setSelected(module);
    setStartsAt(inputDate(module.startsAt));
    setEndsAt(inputDate(module.endsAt));
    setConfigText("Cargando…");
    setMessage(null);
    try {
      const response = await fetch(
        `${apiBaseUrl}/platform/tenants/${encodeURIComponent(tenantId)}/entitlements/modules/${encodeURIComponent(module.key)}/config`,
        { credentials: "include", headers: { accept: "application/json" } },
      );
      if (!response.ok) throw new Error(await errorMessage(response));
      const payload = (await response.json()) as { config: Record<string, unknown> };
      setConfigText(JSON.stringify(payload.config, null, 2));
    } catch (error) {
      setConfigText("{}");
      setMessage(
        error instanceof Error ? error.message : "No fue posible cargar la configuración.",
      );
    }
  }

  async function saveModule(): Promise<void> {
    if (selected === null) return;
    let config: unknown;
    try {
      config = JSON.parse(configText);
      if (config === null || typeof config !== "object" || Array.isArray(config)) {
        throw new Error("La configuración debe ser un objeto JSON.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "JSON inválido.");
      return;
    }
    setModuleBusy(selected.key);
    setMessage(null);
    try {
      const response = await fetch(
        `${apiBaseUrl}/platform/tenants/${encodeURIComponent(tenantId)}/entitlements/modules/${encodeURIComponent(selected.key)}`,
        {
          body: JSON.stringify({
            config,
            enabled: selected.enabled,
            endsAt: apiDate(endsAt),
            startsAt: apiDate(startsAt),
          }),
          credentials: "include",
          headers: { "content-type": "application/json" },
          method: "PATCH",
        },
      );
      if (!response.ok) throw new Error(await errorMessage(response));
      await onRefresh();
      setSelected(null);
      setMessage(`${selected.key} actualizado.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible guardar el módulo.");
    } finally {
      setModuleBusy(null);
    }
  }

  async function saveLimit(limit: LimitItem): Promise<void> {
    const value = limitValues[limit.key] ?? "";
    const dates = limitDates[limit.key] ?? { endsAt: "", startsAt: "" };
    setLimitBusy(limit.key);
    setMessage(null);
    try {
      const response = await fetch(
        `${apiBaseUrl}/platform/tenants/${encodeURIComponent(tenantId)}/entitlements/limits/${encodeURIComponent(limit.key)}`,
        {
          body: JSON.stringify({
            endsAt: apiDate(dates.endsAt),
            startsAt: apiDate(dates.startsAt),
            value,
          }),
          credentials: "include",
          headers: { "content-type": "application/json" },
          method: "PATCH",
        },
      );
      if (!response.ok) throw new Error(await errorMessage(response));
      await onRefresh();
      setMessage(`${limit.key} actualizado.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible guardar el límite.");
    } finally {
      setLimitBusy(null);
    }
  }

  return (
    <>
      <h2>Entitlements de módulos</h2>
      <div className="entitlement-grid">
        {modules.map((module) => (
          <article className="entitlement-card" key={module.key}>
            <div>
              <code>{module.key}</code>
              <span className={`entitlement-status entitlement-${module.status}`}>
                {statusLabels[module.status]}
              </span>
            </div>
            <small>
              {module.source ?? "Sin row"} ·{" "}
              {module.configPresent ? "Config presente" : "Config vacía"}
            </small>
            <div className="entitlement-actions">
              <button
                type="button"
                disabled={moduleBusy !== null}
                onClick={() => void patchModule(module, !module.enabled)}
              >
                {moduleBusy === module.key
                  ? "Guardando…"
                  : module.enabled
                    ? "Deshabilitar"
                    : "Habilitar"}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => void openEditor(module)}
              >
                Vigencia y config
              </button>
            </div>
          </article>
        ))}
      </div>

      {selected !== null && (
        <section className="entitlement-editor" aria-label="Configuración avanzada">
          <div className="editor-heading">
            <div>
              <h3>Configuración avanzada</h3>
              <code>{selected.key}</code>
            </div>
            <button type="button" className="button-secondary" onClick={() => setSelected(null)}>
              Cerrar
            </button>
          </div>
          <div className="form-grid">
            <label className="form-field">
              Inicio opcional
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            </label>
            <label className="form-field">
              Fin opcional
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
            </label>
          </div>
          <label className="form-field config-field">
            Config JSON · reemplaza el objeto completo
            <textarea
              value={configText}
              onChange={(event) => setConfigText(event.target.value)}
              spellCheck={false}
            />
          </label>
          <p className="config-warning">
            No almacenar secretos, API keys ni credenciales de providers.
          </p>
          <button type="button" disabled={moduleBusy !== null} onClick={() => void saveModule()}>
            Guardar vigencia y configuración
          </button>
        </section>
      )}

      <h2>Límites</h2>
      <div className="limit-editor-grid">
        {limits.map((limit) => {
          const dates = limitDates[limit.key] ?? { endsAt: "", startsAt: "" };
          return (
            <article className="limit-card" key={limit.key}>
              <code>{limit.key}</code>
              <label className="form-field">
                Valor exacto
                <input
                  inputMode="decimal"
                  min="0"
                  value={limitValues[limit.key] ?? ""}
                  onChange={(event) =>
                    setLimitValues((current) => ({ ...current, [limit.key]: event.target.value }))
                  }
                />
              </label>
              <div className="form-grid">
                <label className="form-field">
                  Inicio
                  <input
                    type="datetime-local"
                    value={dates.startsAt}
                    onChange={(event) =>
                      setLimitDates((current) => ({
                        ...current,
                        [limit.key]: { ...dates, startsAt: event.target.value },
                      }))
                    }
                  />
                </label>
                <label className="form-field">
                  Fin
                  <input
                    type="datetime-local"
                    value={dates.endsAt}
                    onChange={(event) =>
                      setLimitDates((current) => ({
                        ...current,
                        [limit.key]: { ...dates, endsAt: event.target.value },
                      }))
                    }
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={limitBusy !== null}
                onClick={() => void saveLimit(limit)}
              >
                {limitBusy === limit.key ? "Guardando…" : "Guardar límite"}
              </button>
            </article>
          );
        })}
      </div>
      {message !== null && <p className="entitlement-feedback">{message}</p>}
    </>
  );
}
