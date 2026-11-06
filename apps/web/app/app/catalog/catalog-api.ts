import type { CatalogFilters, CatalogProduct } from "./catalog-view-model";

export class CatalogApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "CatalogApiError";
  }
}

type Envelope<T> = Readonly<{ success: true; data: T }>;
type CatalogPage = Readonly<{ items: readonly CatalogProduct[]; nextCursor: string | null }>;
export type ProductInput = Readonly<{
  sku: string;
  name: string;
  unit: string;
  price: string;
  currency: string;
  description?: string | null;
  category?: string | null;
  taxCode?: string | null;
  taxRate?: string | null;
  organizationUnitId?: string | null;
  isExceptional?: boolean;
  customValues?: unknown;
}>;
export type CatalogOrganizationUnit = Readonly<{ id: string; name: string; code: string | null }>;

export function parseProductCustomValues(value: string): unknown | null {
  if (!value.trim()) return null;
  if (new TextEncoder().encode(value).byteLength > 16 * 1024) {
    throw new Error("Los datos personalizados exceden 16 KiB.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Los datos personalizados deben ser JSON válido.");
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Los datos personalizados deben ser un objeto JSON.");
  }
  return parsed;
}

async function errorFrom(response: Response): Promise<CatalogApiError> {
  let message = `La solicitud no se completó (${response.status}).`;
  try {
    const body = (await response.json()) as { message?: string | readonly string[] };
    if (typeof body.message === "string") message = body.message;
    if (Array.isArray(body.message)) message = body.message.join("; ");
  } catch {
    // Preserve the status message when the server does not return JSON.
  }
  if (response.status === 401) message = "Tu sesión expiró. Inicia sesión y vuelve a intentarlo.";
  if (response.status === 403) message = "Tu acceso al catálogo cambió. Actualiza la página.";
  if (response.status === 404) message = "El producto ya no está disponible. Actualiza la lista.";
  if (response.status === 409)
    message = "El SKU ya está en uso o el producto cambió. Actualiza la lista.";
  return new CatalogApiError(message, response.status);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    ...init,
  });
  if (!response.ok) throw await errorFrom(response);
  const envelope = (await response.json()) as Envelope<T>;
  if (envelope.success !== true || !("data" in envelope)) {
    throw new CatalogApiError(
      "La respuesta del catálogo no tiene el formato esperado.",
      response.status,
    );
  }
  return envelope.data;
}

export function createCatalogApi(apiBaseUrl: string) {
  const root = `${apiBaseUrl.replace(/\/$/, "")}/api/v1/products`;
  return {
    loadCatalog(filters: CatalogFilters = {}): Promise<CatalogPage> {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== "") query.set(key, String(value));
      }
      return request(`${root}${query.size ? `?${query.toString()}` : ""}`);
    },
    loadOrganizationUnits(
      options: { search?: string; cursor?: string; limit?: number } = {},
    ): Promise<{
      items: readonly CatalogOrganizationUnit[];
      nextCursor: string | null;
      limit: number;
    }> {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(options))
        if (value !== undefined && value !== "") query.set(key, String(value));
      return request(
        `${root}/options/organization-units${query.size ? `?${query.toString()}` : ""}`,
      );
    },
    saveProduct(input: ProductInput, id?: string): Promise<CatalogProduct> {
      return request(id ? `${root}/${encodeURIComponent(id)}` : root, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(input),
      });
    },
    archiveProduct(id: string): Promise<CatalogProduct> {
      return request(`${root}/${encodeURIComponent(id)}/archive`, { method: "POST" });
    },
  };
}

export type CatalogApi = ReturnType<typeof createCatalogApi>;
