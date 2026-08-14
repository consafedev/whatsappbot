"use client";

import { moduleLabel } from "./tenant-app-navigation";
import { useTenantAppBootstrap } from "./tenant-app-shell";

export function TenantAppHome() {
  const bootstrap = useTenantAppBootstrap();
  return (
    <section className="tenant-app-home">
      <p className="kicker">Workspace activo</p>
      <h1>Hola, {bootstrap.user.displayName}</h1>
      <p>Estás en {bootstrap.tenant.displayName}.</p>
      <section aria-labelledby="effective-modules-heading" className="tenant-app-modules">
        <h2 id="effective-modules-heading">Módulos efectivos</h2>
        {bootstrap.effectiveModules.length === 0 ? (
          <p>No hay módulos efectivos disponibles.</p>
        ) : (
          <ul>
            {bootstrap.effectiveModules.map((moduleKey) => (
              <li key={moduleKey}>{moduleLabel(moduleKey)}</li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
