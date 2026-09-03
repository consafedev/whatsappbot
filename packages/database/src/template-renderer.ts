/**
 * Template variable substitution engine for WhatsApp campaigns and broadcasts.
 */

/**
 * Replaces {{variable}} placeholders with provided variable values.
 * If a variable is null or undefined, it replaces it with an empty string.
 */
export function renderTemplate(
  templateText: string,
  variables: Record<string, string | number | null | undefined> = {},
): string {
  if (!templateText) return "";

  return templateText.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_match, varName) => {
    const value = variables[varName];
    if (value === undefined || value === null) {
      return "";
    }
    return String(value);
  });
}

/**
 * Extracts unique variable keys from template text (e.g. ["nombre", "pedido"]).
 */
export function extractTemplateVariables(templateText: string): string[] {
  if (!templateText) return [];

  const matches = templateText.matchAll(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g);
  const vars = new Set<string>();
  for (const match of matches) {
    if (match[1]) {
      vars.add(match[1]);
    }
  }
  return Array.from(vars);
}
