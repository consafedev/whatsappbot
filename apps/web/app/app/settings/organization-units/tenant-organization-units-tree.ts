export type OrganizationUnitItem = Readonly<{
  id: string;
  parentId: string | null;
  type: "company" | "branch" | "department" | "team" | "other";
  name: string;
  code: string | null;
  timezone: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type OrganizationUnitTreeNode = Readonly<{
  item: OrganizationUnitItem;
  children: readonly OrganizationUnitTreeNode[];
}>;

export type OrganizationUnitTree = Readonly<{
  items: readonly OrganizationUnitItem[];
  roots: readonly OrganizationUnitTreeNode[];
  usage: { used: number; limit: string | null };
}>;

function byNameThenId(a: OrganizationUnitItem, b: OrganizationUnitItem): number {
  const byName = a.name.localeCompare(b.name, "es");
  return byName === 0 ? a.id.localeCompare(b.id) : byName;
}

export function buildOrganizationUnitTree(
  items: readonly OrganizationUnitItem[],
): readonly OrganizationUnitTreeNode[] {
  const byParent = new Map<string | null, OrganizationUnitItem[]>();
  const presentIds = new Set<string>();
  for (const item of items) {
    presentIds.add(item.id);
    const siblings = byParent.get(item.parentId) ?? [];
    siblings.push(item);
    byParent.set(item.parentId, siblings);
  }
  const build = (parentId: string | null): readonly OrganizationUnitTreeNode[] =>
    (byParent.get(parentId) ?? [])
      .sort(byNameThenId)
      .map((item) => ({ children: build(item.id), item }));
  const roots = [...build(null)];
  for (const item of items) {
    if (item.parentId !== null && !presentIds.has(item.parentId)) {
      roots.push({ children: [], item });
    }
  }
  return roots;
}

export function findOrganizationUnit(
  items: readonly OrganizationUnitItem[],
  unitId: string,
): OrganizationUnitItem | null {
  return items.find(({ id }) => id === unitId) ?? null;
}

export function collectDescendantIds(node: OrganizationUnitTreeNode): readonly string[] {
  const result: string[] = [];
  const visit = (current: OrganizationUnitTreeNode): void => {
    for (const child of current.children) {
      result.push(child.item.id);
      visit(child);
    }
  };
  visit(node);
  return result;
}

export function parentCandidates(
  items: readonly OrganizationUnitItem[],
  node: OrganizationUnitTreeNode,
): readonly OrganizationUnitItem[] {
  const excluded = new Set(collectDescendantIds(node));
  return items.filter(({ id }) => id !== node.item.id && !excluded.has(id));
}
