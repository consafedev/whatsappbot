export type CampaignStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

export interface CampaignListItem {
  readonly id: string;
  readonly name: string;
  readonly status: CampaignStatus | string;
  readonly channelAccountId: string;
  readonly channelDisplayName?: string | undefined;
  readonly templateId?: string | null | undefined;
  readonly totalRecipients: number;
  readonly sentCount: number;
  readonly deliveredCount: number;
  readonly readCount: number;
  readonly failedCount: number;
  readonly rateLimitPerMinute: number;
  readonly scheduledAt?: string | null | undefined;
  readonly startedAt?: string | null | undefined;
  readonly completedAt?: string | null | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CampaignDetail extends CampaignListItem {
  readonly messageContent?: string | null | undefined;
  readonly templateName?: string | null | undefined;
  readonly audienceFilter?: Record<string, unknown> | null | undefined;
  readonly errorMessage?: string | null | undefined;
}

export interface MessageTemplateItem {
  readonly id: string;
  readonly name: string;
  readonly category?: string | null | undefined;
  readonly content: string;
  readonly variables?: string[] | undefined;
  readonly mediaUrl?: string | null | undefined;
  readonly mediaType?: string | null | undefined;
  readonly createdAt: string;
  readonly updatedAt?: string | undefined;
}

export interface CreateCampaignInput {
  readonly name: string;
  readonly channelAccountId: string;
  readonly templateId?: string | null | undefined;
  readonly messageContent?: string | undefined;
  readonly rateLimitPerMinute?: number | undefined;
  readonly audienceFilter?: Record<string, unknown> | undefined;
  readonly scheduledAt?: string | null | undefined;
}

export interface CreateTemplateInput {
  readonly name: string;
  readonly category?: string | undefined;
  readonly content: string;
  readonly variables?: string[] | undefined;
  readonly mediaUrl?: string | null | undefined;
  readonly mediaType?: string | null | undefined;
}

export interface CampaignChannelItem {
  readonly id: string;
  readonly displayName: string;
  readonly phoneNumber?: string | null | undefined;
  readonly providerType: string;
  readonly status: string;
}

export interface PopulateAudienceResult {
  readonly campaignId: string;
  readonly populatedCount: number;
  readonly totalRecipients: number;
}

export interface CampaignsListResponse {
  readonly campaigns: readonly CampaignListItem[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface StatusBadgeDetails {
  readonly label: string;
  readonly variant: "success" | "warn" | "danger" | "info" | "neutral";
  readonly dotColor: string;
  readonly className: string;
}

/**
 * Normalizes campaign status strings and provides human-friendly badge details.
 */
export function formatCampaignStatus(status: string | null | undefined): StatusBadgeDetails {
  const normalized = (status ?? "").toUpperCase().trim();

  switch (normalized) {
    case "DRAFT":
      return {
        label: "Borrador",
        variant: "neutral",
        dotColor: "#868e96",
        className:
          "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
      };
    case "SCHEDULED":
      return {
        label: "Programada",
        variant: "info",
        dotColor: "#1c7ed6",
        className:
          "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800",
      };
    case "RUNNING":
      return {
        label: "En ejecución",
        variant: "info",
        dotColor: "#228be6",
        className:
          "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
      };
    case "PAUSED":
      return {
        label: "Pausada",
        variant: "warn",
        dotColor: "#f59f00",
        className:
          "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
      };
    case "COMPLETED":
      return {
        label: "Completada",
        variant: "success",
        dotColor: "#2b8a3e",
        className:
          "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
      };
    case "CANCELLED":
      return {
        label: "Cancelada",
        variant: "neutral",
        dotColor: "#adb5bd",
        className:
          "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
      };
    case "FAILED":
      return {
        label: "Fallida",
        variant: "danger",
        dotColor: "#c92a2a",
        className:
          "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
      };
    default:
      return {
        label: status || "Desconocido",
        variant: "neutral",
        dotColor: "#868e96",
        className:
          "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
      };
  }
}

/**
 * Calculates progress percentage safely without division by zero.
 */
export function calculateProgress(sentCount: number, totalRecipients: number): number {
  if (
    typeof sentCount !== "number" ||
    typeof totalRecipients !== "number" ||
    Number.isNaN(sentCount) ||
    Number.isNaN(totalRecipients) ||
    totalRecipients <= 0 ||
    sentCount <= 0
  ) {
    return 0;
  }
  const percentage = Math.round((sentCount / totalRecipients) * 100);
  return Math.min(100, Math.max(0, percentage));
}

/**
 * Extracts unique mustache variables from a template or text message, e.g. {{nombre}} -> ["nombre"].
 */
export function extractMustacheVariables(content: string | null | undefined): string[] {
  if (!content) return [];
  const regex = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;
  const variables = new Set<string>();
  let match = regex.exec(content);
  while (match !== null) {
    if (match[1]) {
      variables.add(match[1]);
    }
    match = regex.exec(content);
  }
  return Array.from(variables);
}

export class CampaignApiError extends Error {
  readonly statusCode: number;
  readonly code?: string | undefined;

  constructor(message: string, statusCode: number, code?: string | undefined) {
    super(message);
    this.name = "CampaignApiError";
    this.statusCode = statusCode;
    if (code !== undefined) {
      this.code = code;
    }
  }
}

async function parseErrorResponse(response: Response): Promise<CampaignApiError> {
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
    // Non-JSON response
  }

  if (response.status === 401) message = "Sesión no autorizada o expirada";
  if (response.status === 403)
    message = "No tienes permiso suficiente o el módulo de campañas no está activo";
  if (response.status === 404) message = "Recurso no encontrado";

  return new CampaignApiError(message, response.status, code);
}

/**
 * Fetches campaigns for the active tenant with optional status and pagination filtering.
 */
export async function fetchCampaigns(
  apiBaseUrl: string,
  options?: { status?: string; limit?: number; offset?: number },
): Promise<CampaignsListResponse> {
  const query = new URLSearchParams();
  if (options?.status && options.status !== "ALL") query.set("status", options.status);
  if (options?.limit !== undefined) query.set("limit", String(options.limit));
  if (options?.offset !== undefined) query.set("offset", String(options.offset));

  const qs = query.toString();
  const url = `${apiBaseUrl}/api/v1/campaigns${qs ? `?${qs}` : ""}`;

  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "GET",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const json = (await response.json()) as {
    data: {
      campaigns: CampaignListItem[];
      total: number;
      limit: number;
      offset: number;
    };
  };

  return json.data;
}

/**
 * Fetches a single campaign detail.
 */
export async function fetchCampaignDetail(
  apiBaseUrl: string,
  campaignId: string,
): Promise<CampaignDetail> {
  const url = `${apiBaseUrl}/api/v1/campaigns/${encodeURIComponent(campaignId)}`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "GET",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const json = (await response.json()) as { data: CampaignDetail };
  return json.data;
}

/**
 * Creates a new campaign.
 */
export async function createCampaign(
  apiBaseUrl: string,
  input: CreateCampaignInput,
): Promise<CampaignListItem> {
  const url = `${apiBaseUrl}/api/v1/campaigns`;
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    method: "POST",
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const json = (await response.json()) as { data: CampaignListItem };
  return json.data;
}

/**
 * Starts a draft or paused campaign.
 */
export async function startCampaign(
  apiBaseUrl: string,
  campaignId: string,
): Promise<CampaignListItem> {
  const url = `${apiBaseUrl}/api/v1/campaigns/${encodeURIComponent(campaignId)}/start`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const json = (await response.json()) as { data: CampaignListItem };
  return json.data;
}

/**
 * Pauses a running campaign.
 */
export async function pauseCampaign(
  apiBaseUrl: string,
  campaignId: string,
): Promise<CampaignListItem> {
  const url = `${apiBaseUrl}/api/v1/campaigns/${encodeURIComponent(campaignId)}/pause`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const json = (await response.json()) as { data: CampaignListItem };
  return json.data;
}

/**
 * Cancels an active or draft campaign.
 */
export async function cancelCampaign(
  apiBaseUrl: string,
  campaignId: string,
): Promise<CampaignListItem> {
  const url = `${apiBaseUrl}/api/v1/campaigns/${encodeURIComponent(campaignId)}/cancel`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const json = (await response.json()) as { data: CampaignListItem };
  return json.data;
}

/**
 * Segments and populates audience members for a campaign based on its filter.
 */
export async function populateAudience(
  apiBaseUrl: string,
  campaignId: string,
): Promise<PopulateAudienceResult> {
  const url = `${apiBaseUrl}/api/v1/campaigns/${encodeURIComponent(campaignId)}/audience/populate`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const json = (await response.json()) as { data: PopulateAudienceResult };
  return json.data;
}

/**
 * Fetches message templates.
 */
export async function fetchMessageTemplates(
  apiBaseUrl: string,
  category?: string,
): Promise<readonly MessageTemplateItem[]> {
  const query = category ? `?category=${encodeURIComponent(category)}` : "";
  const url = `${apiBaseUrl}/api/v1/campaigns/templates${query}`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "GET",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const json = (await response.json()) as { data: MessageTemplateItem[] };
  return json.data ?? [];
}

/**
 * Creates a message template.
 */
export async function createMessageTemplate(
  apiBaseUrl: string,
  input: CreateTemplateInput,
): Promise<MessageTemplateItem> {
  const url = `${apiBaseUrl}/api/v1/campaigns/templates`;
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    method: "POST",
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const json = (await response.json()) as { data: MessageTemplateItem };
  return json.data;
}

/**
 * Fetches WhatsApp channels available for campaigns.
 */
export async function fetchChannelsForCampaigns(
  apiBaseUrl: string,
): Promise<readonly CampaignChannelItem[]> {
  const url = `${apiBaseUrl}/api/v1/channels`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "GET",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const data = (await response.json()) as { items?: CampaignChannelItem[] } | CampaignChannelItem[];
  const rawList = Array.isArray(data) ? data : (data.items ?? []);

  return rawList.map((ch) => ({
    id: ch.id,
    displayName: ch.displayName,
    phoneNumber: ch.phoneNumber,
    providerType: ch.providerType,
    status: ch.status,
  }));
}
