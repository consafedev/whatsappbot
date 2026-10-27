export function resolveAssociationPatch(
  currentId: string | null,
  editable: boolean,
  submittedId: string,
): string | null {
  if (!editable) return currentId;
  return submittedId || null;
}

export async function loadContactConversations<T extends Readonly<{ contactId: string }>>(
  fetchPage: (query: Readonly<{ limit: 50; cursor?: string }>) => Promise<{
    items: readonly T[];
    nextCursor?: string | null;
  }>,
  contactId: string,
): Promise<T[]> {
  const matching: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await fetchPage({ limit: 50, ...(cursor ? { cursor } : {}) });
    matching.push(...page.items.filter((item) => item.contactId === contactId));
    cursor = page.nextCursor ?? undefined;
    if (cursor && seenCursors.has(cursor)) break;
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return matching;
}
