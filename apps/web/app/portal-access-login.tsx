"use client";

import { type FormEvent, useState } from "react";
import type { PortalAudience, PortalDestination } from "./root-portal-view-model";

type LoginState = "idle" | "submitting" | "error";

function formValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) ?? "").trim();
}

function loginError(status: number | null): string {
  if (status === 429) {
    return "Se alcanzó el límite temporal de intentos. Espera un minuto antes de volver a intentar.";
  }
  if (status === null) {
    return "El servicio de acceso no está disponible. Verifica la conexión e inténtalo nuevamente.";
  }
  return "No fue posible iniciar sesión. Verifica los datos de acceso o contacta a tu administrador.";
}

export function PortalAccessLogin({
  apiBaseUrl,
  initialAudience,
  initialDestination,
}: Readonly<{
  apiBaseUrl: string;
  initialAudience: PortalAudience;
  initialDestination: PortalDestination;
}>) {
  const [audience, setAudience] = useState<PortalAudience>(initialAudience);
  const [tenantDestination, setTenantDestination] = useState<"/app" | "/app/inbox">(
    initialDestination === "/app" ? "/app" : "/app/inbox",
  );
  const [state, setState] = useState<LoginState>("idle");
  const [error, setError] = useState("");

  const selectAudience = (next: PortalAudience) => {
    setAudience(next);
    setError("");
    setState("idle");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = formValue(form, "email").toLocaleLowerCase("en-US");
    const password = String(new FormData(form).get("password") ?? "");
    const tenantSlug = formValue(form, "tenantSlug").toLocaleLowerCase("en-US");
    const endpoint =
      audience === "platform"
        ? "/platform/auth/login"
        : `/auth/tenants/${encodeURIComponent(tenantSlug)}/login`;

    setError("");
    setState("submitting");
    const response = await fetch(`${apiBaseUrl}${endpoint}`, {
      body: JSON.stringify({ deviceLabel: "Portal web", email, password }),
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }).catch(() => null);

    const passwordInput = form.elements.namedItem("password");
    if (passwordInput instanceof HTMLInputElement) passwordInput.value = "";
    if (response === null || !response.ok) {
      setError(loginError(response?.status ?? null));
      setState("error");
      return;
    }

    window.location.assign(audience === "platform" ? "/platform/tenants" : tenantDestination);
  };

  const isSubmitting = state === "submitting";

  return (
    <section
      aria-labelledby="portal-login-title"
      className={`portal-login-panel is-${audience}`}
      id="portal-login"
    >
      <div className="portal-login-copy">
        <p className="portal-kicker">Acceso seguro</p>
        <h2 id="portal-login-title">Inicia sesión en tu superficie</h2>
        <p>
          Platform Control y los workspaces tenant usan identidades y cookies separadas. La sesión
          se valida contra PostgreSQL en cada solicitud protegida.
        </p>
        <ul>
          <li>Las contraseñas no se almacenan en el navegador.</li>
          <li>El workspace se resuelve por slug antes de autenticar.</li>
          <li>Permisos y módulos se vuelven a validar en el backend.</li>
        </ul>
      </div>

      <div className="portal-login-card">
        <fieldset className="portal-login-tabs">
          <legend>Tipo de acceso</legend>
          <button
            aria-pressed={audience === "tenant"}
            onClick={() => selectAudience("tenant")}
            type="button"
          >
            Workspace tenant
          </button>
          <button
            aria-pressed={audience === "platform"}
            onClick={() => selectAudience("platform")}
            type="button"
          >
            Platform Admin
          </button>
        </fieldset>

        <div className="portal-login-heading">
          <span aria-hidden="true" className="portal-login-mark">
            {audience === "platform" ? "PC" : "TW"}
          </span>
          <div>
            <h3>{audience === "platform" ? "Platform Control" : "Tenant Workspace"}</h3>
            <p>
              {audience === "platform"
                ? "Acceso interno exclusivo para administradores de plataforma."
                : "Owner, Admin, Supervisor, Agent, Operator y demás roles tenant usan este acceso."}
            </p>
          </div>
        </div>

        <form className="portal-login-form" onSubmit={submit}>
          {audience === "tenant" ? (
            <label>
              Slug del workspace
              <input
                autoCapitalize="none"
                autoComplete="organization"
                maxLength={120}
                name="tenantSlug"
                placeholder="mi-empresa"
                required
              />
            </label>
          ) : null}
          <label>
            Correo
            <input
              autoCapitalize="none"
              autoComplete="username"
              maxLength={320}
              name="email"
              placeholder="nombre@empresa.com"
              required
              type="email"
            />
          </label>
          <label>
            Contraseña
            <input
              autoComplete="current-password"
              maxLength={128}
              minLength={15}
              name="password"
              required
              type="password"
            />
          </label>
          {audience === "tenant" ? (
            <label>
              Abrir después de ingresar
              <select
                name="destination"
                onChange={(event) =>
                  setTenantDestination(event.target.value === "/app" ? "/app" : "/app/inbox")
                }
                value={tenantDestination}
              >
                <option value="/app/inbox">Consola de operador · Inbox</option>
                <option value="/app">Inicio del workspace</option>
              </select>
            </label>
          ) : null}

          {error.length > 0 ? (
            <p className="portal-login-error" role="alert">
              {error}
            </p>
          ) : null}

          <button className="portal-login-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Verificando…" : "Iniciar sesión"}
            <span aria-hidden="true">→</span>
          </button>
        </form>
      </div>
    </section>
  );
}
