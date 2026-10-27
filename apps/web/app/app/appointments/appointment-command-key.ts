export type CommandKeyEntry = Readonly<{ signature: string; key: string }>;

/** Reuses a retry key only while both the command intent and payload are unchanged. */
export function stableCommandKey(
  entries: Map<string, CommandKeyEntry>,
  intent: string,
  payload: unknown,
  createKey: () => string,
): string {
  const signature = JSON.stringify(payload);
  const previous = entries.get(intent);
  if (previous?.signature === signature) return previous.key;
  const key = createKey();
  entries.set(intent, { signature, key });
  return key;
}

/** Starts a distinct user intent, even if its eventual payload matches an earlier command. */
export function beginCommandIntent(entries: Map<string, CommandKeyEntry>, intent: string): void {
  entries.delete(intent);
}
