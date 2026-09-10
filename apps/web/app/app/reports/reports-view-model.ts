export interface AiTokenUsageSummary {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostUsd: number;
}

export interface TenantOperationalOverview {
  readonly inboundMessagesCount: number;
  readonly outboundMessagesCount: number;
  readonly activeConversationsCount: number;
  readonly closedConversationsCount: number;
  readonly aiTokenUsage: AiTokenUsageSummary;
  readonly deliverySuccessRate: number; // 0 - 100
}

export interface MessageTimeSeriesBucket {
  readonly bucket: string; // ISO date / timestamp
  readonly inboundCount: number;
  readonly outboundCount: number;
  readonly totalCount: number;
}

export interface MessageTimeSeriesData {
  readonly interval: "day" | "hour";
  readonly from: string;
  readonly to: string;
  readonly buckets: readonly MessageTimeSeriesBucket[];
}

export type DatePresetKey = "7d" | "30d" | "this_month" | "custom";

export class ReportsApiError extends Error {
  readonly statusCode: number;
  readonly code?: string | undefined;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = "ReportsApiError";
    this.statusCode = statusCode;
    if (code !== undefined) {
      this.code = code;
    }
  }
}

async function parseErrorResponse(response: Response): Promise<ReportsApiError> {
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

  if (response.status === 400 && message.includes("Error en el servidor")) {
    message = "Rango de fechas o parámetros inválidos";
  }
  if (response.status === 401) {
    message = "Sesión no autorizada o expirada";
  }
  if (response.status === 403) {
    message = "No tienes permiso suficiente o el módulo de reportes no está activo";
  }
  if (response.status === 404) {
    message = "Recurso no encontrado";
  }

  return new ReportsApiError(message, response.status, code);
}

/**
 * Resolves start and end ISO dates based on a named date preset.
 */
export function resolveDatePreset(
  preset: DatePresetKey,
  referenceDate: Date = new Date(),
): { from: string; to: string } {
  const to = referenceDate.toISOString();

  switch (preset) {
    case "7d": {
      const fromDate = new Date(referenceDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { from: fromDate.toISOString(), to };
    }
    case "30d": {
      const fromDate = new Date(referenceDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { from: fromDate.toISOString(), to };
    }
    case "this_month": {
      const fromDate = new Date(
        Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), 1, 0, 0, 0, 0),
      );
      return { from: fromDate.toISOString(), to };
    }
    case "custom": {
      const fromDate = new Date(referenceDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { from: fromDate.toISOString(), to };
    }
  }
}

/**
 * Formats an integer or decimal number with thousand separators.
 */
export function formatNumber(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return "0";
  }
  return new Intl.NumberFormat("es-MX").format(value);
}

/**
 * Formats a currency amount in USD with 4 decimal places for AI token granularity.
 */
export function formatCurrencyUsd(amount: number): string {
  if (Number.isNaN(amount) || !Number.isFinite(amount)) {
    return "$0.0000";
  }
  return `$${amount.toFixed(4)}`;
}

/**
 * Fetches aggregated operational metrics for the active tenant.
 */
export async function fetchOperationalOverview(
  apiBaseUrl: string,
  options?: { from?: string | undefined; to?: string | undefined },
): Promise<TenantOperationalOverview> {
  const query = new URLSearchParams();
  if (options?.from) {
    query.set("from", options.from);
  }
  if (options?.to) {
    query.set("to", options.to);
  }

  const qs = query.toString();
  const url = `${apiBaseUrl.replace(/\/$/, "")}/api/v1/analytics/overview${qs ? `?${qs}` : ""}`;

  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "GET",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const json = (await response.json()) as {
    data?: {
      inboundMessagesCount?: number;
      outboundMessagesCount?: number;
      activeConversationsCount?: number;
      closedConversationsCount?: number;
      aiTokenUsage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        estimatedCostUsd?: number;
        costEstimatedUsd?: number;
      };
      deliverySuccessRate?: number;
    };
  };

  const raw = json.data ?? {};
  const aiRaw = raw.aiTokenUsage ?? {};

  return {
    inboundMessagesCount: Number(raw.inboundMessagesCount ?? 0),
    outboundMessagesCount: Number(raw.outboundMessagesCount ?? 0),
    activeConversationsCount: Number(raw.activeConversationsCount ?? 0),
    closedConversationsCount: Number(raw.closedConversationsCount ?? 0),
    aiTokenUsage: {
      promptTokens: Number(aiRaw.promptTokens ?? 0),
      completionTokens: Number(aiRaw.completionTokens ?? 0),
      totalTokens: Number(aiRaw.totalTokens ?? 0),
      estimatedCostUsd: Number(aiRaw.estimatedCostUsd ?? aiRaw.costEstimatedUsd ?? 0),
    },
    deliverySuccessRate: Number(raw.deliverySuccessRate ?? 100),
  };
}

/**
 * Fetches time-series messaging metrics grouped by the given interval (day or hour).
 */
export async function fetchMessageTimeSeries(
  apiBaseUrl: string,
  options?: {
    from?: string | undefined;
    to?: string | undefined;
    interval?: "day" | "hour" | undefined;
  },
): Promise<MessageTimeSeriesData> {
  const interval = options?.interval ?? "day";
  const query = new URLSearchParams();
  if (options?.from) {
    query.set("from", options.from);
  }
  if (options?.to) {
    query.set("to", options.to);
  }
  query.set("interval", interval);

  const qs = query.toString();
  const url = `${apiBaseUrl.replace(/\/$/, "")}/api/v1/analytics/time-series${qs ? `?${qs}` : ""}`;

  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "GET",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const json = (await response.json()) as {
    data?: Array<{
      timestamp?: string;
      bucket?: string;
      inbound?: number;
      inboundCount?: number;
      outbound?: number;
      outboundCount?: number;
      total?: number;
      totalCount?: number;
    }>;
  };

  const rawBuckets = Array.isArray(json.data) ? json.data : [];
  const buckets: MessageTimeSeriesBucket[] = rawBuckets.map((b) => ({
    bucket: String(b.bucket ?? b.timestamp ?? ""),
    inboundCount: Number(b.inboundCount ?? b.inbound ?? 0),
    outboundCount: Number(b.outboundCount ?? b.outbound ?? 0),
    totalCount: Number(b.totalCount ?? b.total ?? 0),
  }));

  return {
    interval,
    from: options?.from ?? "",
    to: options?.to ?? "",
    buckets,
  };
}
