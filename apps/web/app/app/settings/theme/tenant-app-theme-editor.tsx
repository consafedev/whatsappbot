"use client";

import {
  CUSTOM_PRESET,
  type ResolvedTenantTheme,
  resolveTenantTheme,
  TENANT_PRESET_KEYS,
  TENANT_THEME_PRESETS,
  type TenantBranding,
} from "@whatsapp-platform/themes";
import { useCallback, useEffect, useState } from "react";
import { useTenantAppBootstrap, useTenantAppBootstrapRefresh } from "../../tenant-app-shell";
import { tenantShellStyle } from "../../tenant-app-theme-style";
import { draftConfig, draftFromConfig, type TenantThemeDraft } from "./tenant-app-theme-form";

type LoadState =
  | { status: "loading" }
  | { status: "unauthorized" }
  | { status: "error" }
  | { status: "loaded"; config: TenantBranding; canEditLogo: boolean };

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

export function TenantAppThemeEditor() {
  const bootstrap = useTenantAppBootstrap();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async (): Promise<void> => {
    setLoadState({ status: "loading" });
    const response = await fetch(`${API_BASE_URL}/app/theme`, {
      credentials: "include",
    }).catch(() => null);
    if (response === null) return setLoadState({ status: "error" });
    if (response.status === 401) return setLoadState({ status: "unauthorized" });
    if (!response.ok) return setLoadState({ status: "error" });
    const theme = (await response.json()) as { config: TenantBranding };
    setLoadState({
      status: "loaded",
      config: theme.config,
      canEditLogo: bootstrap.effectiveModules.includes("module.white_label"),
    });
  }, [bootstrap.effectiveModules]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadState.status === "loading")
    return <p className="tenant-app-theme-note">Cargando tema…</p>;
  if (loadState.status === "unauthorized")
    return <p className="tenant-app-theme-note">Tu sesión no está disponible.</p>;
  if (loadState.status === "error") {
    return (
      <div className="tenant-app-theme-note">
        <p>No fue posible cargar el tema.</p>
        <button onClick={() => void load()} type="button">
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <TenantAppThemeEditorForm
      canEditLogo={loadState.canEditLogo}
      initialConfig={loadState.config}
    />
  );
}

function TenantAppThemeEditorForm({
  canEditLogo,
  initialConfig,
}: Readonly<{ canEditLogo: boolean; initialConfig: TenantBranding }>) {
  const bootstrap = useTenantAppBootstrap();
  const refresh = useTenantAppBootstrapRefresh();
  const [draft, setDraft] = useState<TenantThemeDraft>(() => draftFromConfig(initialConfig));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewBranding = draftConfig(draft);
  const previewTheme: ResolvedTenantTheme | null =
    previewBranding === null ? null : resolveTenantTheme(previewBranding);

  const patchDraft = (patch: Partial<TenantThemeDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const setColor = (name: keyof TenantThemeDraft["colors"], value: string) =>
    setDraft((current) => ({ ...current, colors: { ...current.colors, [name]: value } }));

  const save = async (body: unknown): Promise<boolean> => {
    setSaving(true);
    setSaved(false);
    setError(null);
    const response = await fetch(`${API_BASE_URL}/app/theme`, {
      body: JSON.stringify(body),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "PATCH",
    }).catch(() => null);
    if (response === null || !response.ok) {
      setSaving(false);
      return false;
    }
    const theme = (await response.json()) as { config: TenantBranding };
    setDraft(draftFromConfig(theme.config));
    await refresh();
    setSaving(false);
    setSaved(true);
    return true;
  };

  const submit = async () => {
    if (previewBranding === null) return;
    const ok = await save(previewBranding);
    if (!ok) setError("No fue posible guardar el tema.");
  };

  const reset = async () => {
    const ok = await save({});
    if (!ok) setError("No fue posible restablecer el tema.");
  };

  return (
    <section className="tenant-app-theme-editor">
      <p className="kicker">Configuración</p>
      <h1>Apariencia del workspace</h1>
      <p className="tenant-app-theme-subtitle">
        Elige un tema profesional o define los colores de tu marca. El logo requiere el módulo White
        label.
      </p>

      {previewTheme !== null ? (
        <section
          aria-label="Vista previa del tema"
          className="tenant-app-theme-preview-shell"
          style={tenantShellStyle(previewTheme)}
        >
          <div className="tenant-app-sidebar">
            <div className="tenant-app-brand">
              <span aria-hidden="true" className="tenant-app-mark">
                W
              </span>
              <span>
                <strong>{bootstrap.tenant.displayName}</strong>
                <small>Workspace</small>
              </span>
            </div>
            <div className="tenant-app-theme-preview-nav">
              <span>Inicio</span>
              <span>Inbox</span>
              <span>Contactos</span>
              <span>Configuración</span>
            </div>
          </div>
          <div className="tenant-app-theme-preview-main">
            <div className="tenant-app-topbar">
              <strong>Inicio</strong>
            </div>
            <div className="tenant-app-theme-preview-card">
              <span className="tenant-app-theme-preview-chip">Módulos efectivos</span>
            </div>
          </div>
        </section>
      ) : (
        <p className="tenant-app-theme-note">
          Corrige los colores personalizados para ver la vista previa.
        </p>
      )}

      <div className="tenant-app-theme-section">
        <h2>Tema</h2>
        <div className="tenant-app-theme-presets">
          {TENANT_PRESET_KEYS.map((key) => {
            const preset = TENANT_THEME_PRESETS[key];
            const tokens = preset.tokens[draft.colorMode];
            return (
              <button
                aria-pressed={draft.preset === key}
                className={`tenant-app-theme-preset${draft.preset === key ? " is-selected" : ""}`}
                key={key}
                onClick={() => patchDraft({ preset: key })}
                type="button"
              >
                <span
                  className="tenant-app-theme-preset-swatch"
                  style={{ background: tokens.primary, color: tokens.onPrimary }}
                >
                  Aa
                </span>
                <span>
                  <strong>{preset.label}</strong>
                  <small>{preset.description}</small>
                </span>
              </button>
            );
          })}
          <button
            aria-pressed={draft.preset === CUSTOM_PRESET}
            className={`tenant-app-theme-preset${draft.preset === CUSTOM_PRESET ? " is-selected" : ""}`}
            onClick={() => patchDraft({ preset: CUSTOM_PRESET })}
            type="button"
          >
            <span
              className="tenant-app-theme-preset-swatch"
              style={{
                background: "linear-gradient(135deg, #294f7c, #c2410c 60%, #7b3fa0)",
                color: "#ffffff",
              }}
            >
              Aa
            </span>
            <span>
              <strong>Personalizado</strong>
              <small>Define los colores de tu marca.</small>
            </span>
          </button>
        </div>
      </div>

      <div className="tenant-app-theme-section">
        <h2>Modo de color</h2>
        <div className="tenant-app-theme-modes">
          {(["light", "dark"] as const).map((mode) => (
            <button
              aria-pressed={draft.colorMode === mode}
              className={`tenant-app-theme-mode${draft.colorMode === mode ? " is-selected" : ""}`}
              key={mode}
              onClick={() => patchDraft({ colorMode: mode })}
              type="button"
            >
              {mode === "light" ? "Claro" : "Oscuro"}
            </button>
          ))}
        </div>
      </div>

      {draft.preset === CUSTOM_PRESET ? (
        <div className="tenant-app-theme-section">
          <h2>Colores de marca</h2>
          <p className="tenant-app-theme-help">
            Colores #RRGGBB con contraste suficiente para texto blanco (3.0 o más).
          </p>
          <div className="tenant-app-theme-colors">
            {(
              [
                ["primary", "Primario"],
                ["secondary", "Secundario"],
                ["accent", "Acento"],
              ] as const
            ).map(([key, label]) => (
              <label className="tenant-app-theme-color" key={key}>
                <span>{label}</span>
                <span className="tenant-app-theme-color-input">
                  <input
                    aria-label={`${label} (valor hex)`}
                    onChange={(event) => setColor(key, event.target.value)}
                    value={draft.colors[key]}
                  />
                  <input
                    aria-label={`${label} (selector)`}
                    className="tenant-app-theme-color-picker"
                    onChange={(event) => setColor(key, event.target.value)}
                    type="color"
                    value={draft.colors[key]}
                  />
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {canEditLogo ? (
        <div className="tenant-app-theme-section">
          <h2>Logo</h2>
          <label className="tenant-app-theme-logo">
            <span>URL pública HTTPS del logo</span>
            <input
              onChange={(event) => patchDraft({ logoChanged: true, logoUrl: event.target.value })}
              placeholder="https://cdn.example.com/logo.png"
              type="url"
              value={draft.logoUrl}
            />
          </label>
          <p className="tenant-app-theme-help">
            Deja el campo vacío para quitar el logo. Se valida como URL pública HTTPS sin
            credenciales.
          </p>
        </div>
      ) : null}

      <div className="tenant-app-theme-actions">
        <button
          className="tenant-app-theme-save"
          disabled={previewBranding === null || saving}
          onClick={() => void submit()}
          type="button"
        >
          Guardar cambios
        </button>
        <button
          className="tenant-app-theme-reset"
          disabled={saving}
          onClick={() => void reset()}
          type="button"
        >
          Restablecer a valores iniciales
        </button>
      </div>
      {saved ? <p className="tenant-app-theme-feedback">Tema guardado.</p> : null}
      {error !== null ? (
        <p className="tenant-app-theme-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
