export type PortalAudience = "platform" | "tenant";
export type PortalDestination = "/app" | "/app/inbox" | "/platform/tenants";

export type PortalSearchParams = Readonly<{
  access?: string | string[];
  next?: string | string[];
}>;

export const portalCards = [
  {
    badge: "Principal / Milestone A",
    description:
      "Atiende conversaciones, revisa el historial y responde desde el dashboard operativo.",
    eyebrow: "Operación diaria",
    href: "/app/inbox",
    icon: "IN",
    title: "Consola de Operador",
  },
  {
    badge: "Tenant Workspace",
    description:
      "Administra usuarios, unidades organizacionales, permisos y personalización del workspace.",
    eyebrow: "Administración tenant",
    href: "/app",
    icon: "TW",
    title: "Portal del Inquilino",
  },
  {
    badge: "Control interno",
    description:
      "Aprovisiona tenants, administra capacidades y consulta el estado operativo de la plataforma.",
    eyebrow: "Super Admin",
    href: "/platform/tenants",
    icon: "PC",
    title: "Plataforma Super Admin",
  },
] as const;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function resolvePortalAccess(parameters: PortalSearchParams): Readonly<{
  audience: PortalAudience;
  destination: PortalDestination;
}> {
  const audience: PortalAudience = first(parameters.access) === "platform" ? "platform" : "tenant";
  const requested = first(parameters.next);
  if (audience === "platform") {
    return { audience, destination: "/platform/tenants" };
  }
  return { audience, destination: requested === "/app" ? "/app" : "/app/inbox" };
}
