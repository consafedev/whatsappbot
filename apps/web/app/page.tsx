import type { Metadata } from "next";
import Link from "next/link";
import { PortalAccessLogin } from "./portal-access-login";
import {
  type PortalSearchParams,
  portalCards,
  resolvePortalAccess,
} from "./root-portal-view-model";

export const metadata: Metadata = {
  description: "Acceso a Inbox, Tenant Workspace y Platform Control.",
  title: "Portal de acceso · WhatsApp Automation Platform",
};

export default async function Home({
  searchParams = Promise.resolve({}),
}: Readonly<{ searchParams?: Promise<PortalSearchParams> }>) {
  const selection = resolvePortalAccess(await searchParams);
  const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

  return (
    <div className="portal-hub">
      <header className="portal-hub-topbar">
        <Link className="portal-brand" href="/">
          <span aria-hidden="true" className="portal-brand-mark">
            W
          </span>
          <span>
            <strong>WhatsApp Automation</strong>
            <small>Business Operations Platform</small>
          </span>
        </Link>
        <div className="portal-trust-note">
          <span aria-hidden="true" />
          Acceso protegido por sesión
        </div>
      </header>

      <main className="portal-hub-main">
        <section className="portal-hero">
          <div>
            <p className="portal-kicker">Centro de acceso</p>
            <h1>Un punto de entrada para cada operación.</h1>
            <p className="portal-hero-copy">
              Entra a la consola de conversaciones, administra tu workspace o accede al control
              interno de la plataforma. Cada superficie conserva su propia autorización.
            </p>
          </div>
          <aside aria-label="Estado del producto" className="portal-milestone">
            <span>Milestone activo</span>
            <strong>Inbox operativo</strong>
            <p>Mensajería, contactos y conversación en tiempo real.</p>
          </aside>
        </section>

        <section aria-labelledby="portal-access-title" className="portal-access-section">
          <div className="portal-section-heading">
            <div>
              <p className="portal-kicker">Destinos disponibles</p>
              <h2 id="portal-access-title">Selecciona tu área de trabajo</h2>
            </div>
            <p>Las capacidades visibles después de ingresar dependen de módulos y permisos.</p>
          </div>

          <div className="portal-access-grid">
            {portalCards.map((card, index) => (
              <Link
                className={`portal-access-card${index === 0 ? " is-primary" : ""}`}
                href={card.href}
                key={card.href}
              >
                <div className="portal-card-head">
                  <span aria-hidden="true" className="portal-card-icon">
                    {card.icon}
                  </span>
                  <span className="portal-card-badge">{card.badge}</span>
                </div>
                <div>
                  <p className="portal-card-eyebrow">{card.eyebrow}</p>
                  <h3>{card.title}</h3>
                  <p>{card.description}</p>
                </div>
                <span className="portal-card-action">
                  Abrir superficie <span aria-hidden="true">→</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <PortalAccessLogin
          apiBaseUrl={apiBaseUrl}
          initialAudience={selection.audience}
          initialDestination={selection.destination}
        />
      </main>

      <footer className="portal-hub-footer">
        <span>WhatsApp Automation Platform</span>
        <span>Identidades Platform y Tenant separadas · Acceso auditable</span>
      </footer>
    </div>
  );
}
