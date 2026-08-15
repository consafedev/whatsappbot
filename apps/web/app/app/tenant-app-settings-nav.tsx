"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SETTINGS_SECTIONS: Readonly<Array<Readonly<{ href: string; id: string; label: string }>>> =
  Object.freeze([
    { href: "/app/settings/theme", id: "appearance", label: "Apariencia" },
    { href: "/app/settings/organization-units", id: "organization", label: "Organización" },
  ]);

export function TenantAppSettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Configuración" className="tenant-app-settings-nav">
      {SETTINGS_SECTIONS.map(({ href, id, label }) => {
        const active = pathname === href;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`tenant-app-settings-nav-link${active ? " is-active" : ""}`}
            href={href}
            key={id}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
