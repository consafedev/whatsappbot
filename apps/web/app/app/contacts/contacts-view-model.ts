export interface ContactItem {
  readonly id: string;
  readonly name: string;
  readonly phoneNumber: string;
  readonly email?: string | null | undefined;
  readonly avatarUrl?: string | null | undefined;
  readonly status: "ACTIVE" | "ARCHIVED" | string;
  readonly tags: readonly string[];
  readonly customAttributes?: Record<string, unknown> | null | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ContactPageResponse {
  readonly items: readonly ContactItem[];
  readonly total: number;
  readonly limit: number;
  readonly page: number;
}

export interface CreateContactInput {
  readonly name: string;
  readonly phoneNumber: string;
  readonly email?: string | undefined;
  readonly avatarUrl?: string | undefined;
  readonly status?: "ACTIVE" | "ARCHIVED" | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly customAttributes?: Record<string, unknown> | undefined;
}

export interface UpdateContactInput {
  readonly name?: string | undefined;
  readonly email?: string | undefined;
  readonly avatarUrl?: string | undefined;
  readonly status?: "ACTIVE" | "ARCHIVED" | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly customAttributes?: Record<string, unknown> | undefined;
}

export class ContactApiError extends Error {
  readonly statusCode: number;
  readonly code?: string | undefined;

  constructor(message: string, statusCode: number, code?: string | undefined) {
    super(message);
    this.name = "ContactApiError";
    this.statusCode = statusCode;
    if (code !== undefined) {
      this.code = code;
    }
  }
}

/**
 * Parses a comma-separated or newline-separated tags string into a unique, trimmed lowercase array.
 */
export function parseTagsInput(tagsString: string | null | undefined): string[] {
  if (!tagsString) return [];
  const parts = tagsString.split(/[,\n]/);
  const set = new Set<string>();
  for (const part of parts) {
    const trimmed = part.trim().toLowerCase();
    if (trimmed.length > 0) {
      set.add(trimmed);
    }
  }
  return Array.from(set);
}

/**
 * Formats a list of tags into a comma-separated string for display or editing.
 */
export function formatTagsOutput(tags: readonly string[] | null | undefined): string {
  if (!tags || tags.length === 0) return "";
  return tags.join(", ");
}

async function parseErrorResponse(response: Response): Promise<ContactApiError> {
  let message = `Error en el servidor (${response.status})`;
  let code: string | undefined;

  try {
    const data = (await response.json()) as {
      code?: string;
      message?: string | string[];
      error?: string;
    };
    if (typeof data.message === "string") {
      message = data.message;
    } else if (Array.isArray(data.message) && data.message.length > 0) {
      message = data.message.join(", ");
    } else if (typeof data.error === "string") {
      message = data.error;
    }
    if (typeof data.code === "string") {
      code = data.code;
    }
  } catch {
    // Non-JSON error
  }

  if (response.status === 401) message = "Sesión no autorizada o expirada";
  if (response.status === 403)
    message = "No tienes permiso suficiente o el módulo de contactos no está activo";
  if (response.status === 404) message = "Contacto no encontrado";
  if (response.status === 409) message = "Ya existe un contacto con este número de teléfono";

  return new ContactApiError(message, response.status, code);
}

/**
 * Fetches paginated contacts for the active tenant.
 */
export async function fetchContacts(
  apiBaseUrl: string,
  options?: {
    search?: string | undefined;
    tag?: string | undefined;
    status?: string | undefined;
    limit?: number | undefined;
    page?: number | undefined;
  },
): Promise<ContactPageResponse> {
  const query = new URLSearchParams();
  if (options?.search) query.set("search", options.search);
  if (options?.tag) query.set("tag", options.tag);
  if (options?.status && options.status !== "ALL") query.set("status", options.status);
  if (options?.limit !== undefined) query.set("limit", String(options.limit));
  if (options?.page !== undefined) query.set("page", String(options.page));

  const qs = query.toString();
  const url = `${apiBaseUrl}/api/v1/contacts${qs ? `?${qs}` : ""}`;

  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "GET",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return (await response.json()) as ContactPageResponse;
}

/**
 * Fetches a single contact by ID.
 */
export async function fetchContactDetail(
  apiBaseUrl: string,
  contactId: string,
): Promise<ContactItem> {
  const url = `${apiBaseUrl}/api/v1/contacts/${encodeURIComponent(contactId)}`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "GET",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return (await response.json()) as ContactItem;
}

/**
 * Creates a new contact.
 */
export async function createContact(
  apiBaseUrl: string,
  payload: CreateContactInput,
): Promise<ContactItem> {
  const url = `${apiBaseUrl}/api/v1/contacts`;
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return (await response.json()) as ContactItem;
}

/**
 * Updates an existing contact.
 */
export async function updateContact(
  apiBaseUrl: string,
  contactId: string,
  payload: UpdateContactInput,
): Promise<ContactItem> {
  const url = `${apiBaseUrl}/api/v1/contacts/${encodeURIComponent(contactId)}`;
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    method: "PATCH",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return (await response.json()) as ContactItem;
}

/**
 * Archives a contact.
 */
export async function archiveContact(apiBaseUrl: string, contactId: string): Promise<ContactItem> {
  const url = `${apiBaseUrl}/api/v1/contacts/${encodeURIComponent(contactId)}`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "DELETE",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return (await response.json()) as ContactItem;
}
