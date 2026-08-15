export type PermissionCatalogItem = Readonly<{
  key: string;
  description: string;
}>;

export type PermissionGroup = Readonly<{
  id: string;
  label: string;
  items: readonly PermissionCatalogItem[];
}>;

const GROUP_LABELS: Readonly<Record<string, string>> = Object.freeze({
  action_requests: "Acciones requeridas",
  ai: "Inteligencia artificial",
  appointments: "Agenda",
  audit: "Auditoría",
  catalog: "Catálogo",
  channels: "Canales",
  conversations: "Conversaciones",
  exports: "Exportaciones",
  integrations: "Integraciones",
  processes: "Procesos",
  quotes: "Cotizaciones",
  reports: "Reportes",
  rules: "Automatizaciones",
  tenant: "Workspace",
});

export function groupPermissionCatalog(
  permissions: readonly PermissionCatalogItem[],
): readonly PermissionGroup[] {
  const groups = new Map<string, PermissionCatalogItem[]>();
  for (const permission of permissions) {
    const [groupId] = permission.key.split(".");
    const items = groups.get(groupId ?? "other") ?? [];
    items.push(permission);
    groups.set(groupId ?? "other", items);
  }
  return [...groups].map(([id, items]) => ({
    id,
    items,
    label: GROUP_LABELS[id] ?? id,
  }));
}

export function assignmentKey(roleId: string, organizationUnitId: string | null): string {
  return `${roleId}:${organizationUnitId ?? ""}`;
}
