export function parsePayloadJson(value: string): Record<string, unknown> {
  if (value.trim() === "") return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("El payload debe ser un objeto JSON válido.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("El payload debe ser un objeto JSON válido.");
  }
  return parsed as Record<string, unknown>;
}

export function parseMaxRetries(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("El límite de reintentos debe ser un entero no negativo.");
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("El límite de reintentos debe ser un entero no negativo.");
  }
  return parsed;
}
