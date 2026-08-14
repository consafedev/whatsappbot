"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { resolveTenantNavigation } from "./tenant-app-navigation";

export type TenantAppBootstrap = Readonly<{
  branding: Readonly<{ mode: "platform_default" }>;
  effectiveModules: readonly string[];
  effectivePermissions: readonly string[];
  tenant: Readonly<{
    defaultLocale: string;
    defaultTimezone: string;
    displayName: string;
    id: string;
    slug: string;
  }>;
  user: Readonly<{
    displayName: string;
    email: string;
    id: string;
    locale: string;
    mfaState: string;
    timezone: string;
  }>;
}>;

const TenantBootstrapContext = createContext<TenantAppBootstrap | null>(null);

export function useTenantAppBootstrap(): TenantAppBootstrap {
  const bootstrap = useContext(TenantBootstrapContext);
  if (bootstrap === null) throw new Error("Tenant app bootstrap is unavailable");
  return bootstrap;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase();
}

export function TenantAppShell({
  apiBaseUrl,
  children,
}: Readonly<{ apiBaseUrl: string; children: ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const [bootstrap, setBootstrap] = useState<TenantAppBootstrap | null>(null);
  const [state, setState] = useState<"loading" | "unauthorized" | "error" | "loaded">("loading");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setState("loading");
    const response = await fetch(`${apiBaseUrl}/app/bootstrap`, { credentials: "include" }).catch(
      () => null,
    );
    if (response === null) return setState("error");
    if (response.status === 401) {
      setBootstrap(null);
      return setState("unauthorized");
    }
    if (!response.ok) return setState("error");
    setBootstrap((await response.json()) as TenantAppBootstrap);
    setState("loaded");
  }, [apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  if (state === "loading") return <main className="tenant-app-state">Cargando workspace…</main>;
  if (state === "unauthorized")
    return <main className="tenant-app-state">Tu sesión no está disponible.</main>;
  if (state === "error") {
    return (
      <main className="tenant-app-state">
        <p>No fue posible cargar el workspace.</p>
        <button onClick={() => void load()} type="button">
          Reintentar
        </button>
      </main>
    );
  }
  if (bootstrap === null) return null;

  const navigation = resolveTenantNavigation(
    bootstrap.effectiveModules,
    bootstrap.effectivePermissions,
  );
  const closeDrawer = () => setDrawerOpen(false);
  const logout = async () => {
    setLogoutError(false);
    const response = await fetch(`${apiBaseUrl}/auth/logout`, {
      credentials: "include",
      headers: { origin: window.location.origin },
      method: "POST",
    }).catch(() => null);
    if (response?.status === 204) {
      setBootstrap(null);
      router.replace("/");
      return;
    }
    setLogoutError(true);
  };

  return (
    <TenantBootstrapContext.Provider value={bootstrap}>
      <div className="tenant-app-shell">
        <button
          aria-controls="tenant-app-sidebar"
          aria-expanded={drawerOpen}
          aria-label="Abrir navegación"
          className="tenant-app-menu-toggle"
          onClick={() => setDrawerOpen(true)}
          type="button"
        >
          ☰
        </button>
        {drawerOpen ? (
          <button
            aria-label="Cerrar navegación"
            className="tenant-app-backdrop"
            onClick={closeDrawer}
            type="button"
          />
        ) : null}
        <aside
          className={`tenant-app-sidebar${drawerOpen ? " is-open" : ""}`}
          id="tenant-app-sidebar"
        >
          <div className="tenant-app-brand">
            <span aria-hidden="true" className="tenant-app-mark">
              W
            </span>
            <span>
              <strong>{bootstrap.tenant.displayName}</strong>
              <small>Workspace</small>
            </span>
          </div>
          <nav aria-label="Navegación del workspace">
            {navigation.map((group) => (
              <section className="tenant-app-nav-group" key={group.id}>
                <h2>{group.label}</h2>
                {group.items.map((item) =>
                  item.href === null ? (
                    <span aria-disabled="true" className="tenant-app-nav-placeholder" key={item.id}>
                      {item.label}
                      <small>Próximamente</small>
                    </span>
                  ) : (
                    <Link
                      aria-current={pathname === item.href ? "page" : undefined}
                      className="tenant-app-nav-link"
                      href={item.href}
                      key={item.id}
                      onClick={closeDrawer}
                    >
                      {item.label}
                    </Link>
                  ),
                )}
              </section>
            ))}
          </nav>
          <div className="tenant-app-user">
            <button
              aria-expanded={menuOpen}
              className="tenant-app-user-trigger"
              onClick={() => setMenuOpen((open) => !open)}
              type="button"
            >
              <span aria-hidden="true" className="tenant-app-avatar">
                {initials(bootstrap.user.displayName)}
              </span>
              <span>
                <strong>{bootstrap.user.displayName}</strong>
                <small>{bootstrap.user.email}</small>
              </span>
            </button>
            {menuOpen ? (
              <div className="tenant-app-user-menu">
                <button onClick={() => void logout()} type="button">
                  Cerrar sesión
                </button>
                {logoutError ? <p role="alert">No fue posible cerrar sesión.</p> : null}
              </div>
            ) : null}
          </div>
        </aside>
        <div className="tenant-app-main">
          <header className="tenant-app-topbar">
            <span>Workspace</span>
            <strong>Inicio</strong>
          </header>
          <main className="tenant-app-content">{children}</main>
        </div>
      </div>
    </TenantBootstrapContext.Provider>
  );
}
