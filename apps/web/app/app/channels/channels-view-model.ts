export type ChannelStatus =
  | "connected"
  | "connecting"
  | "pairing"
  | "qr_ready"
  | "disconnected"
  | "error"
  | "archived"
  | "CONNECTED"
  | "CONNECTING"
  | "QR_READY"
  | "DISCONNECTED"
  | "FAILED"
  | "ARCHIVED";

export type ChannelItem = Readonly<{
  id: string;
  displayName: string;
  name?: string | undefined;
  phoneNumber: string | null;
  providerType: string;
  status: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  organizationUnitId?: string | null | undefined;
  settings?: Record<string, unknown> | null | undefined;
}>;

export type ChannelHealthDiagnostic = Readonly<{
  status: string;
  isHealthy: boolean;
  lastHeartbeatAt: string | null;
  lastLatencyMs: number | null;
  socketStatus: "open" | "connecting" | "closed";
  isDegraded: boolean;
  reconnectAttempts: number;
}>;

export type QrPairingState = Readonly<{
  status: string;
  qrRaw: string | null;
  qrGeneratedAt: string | null;
  isExpired: boolean;
}>;

export type ChannelPairingInitiateResponse = Readonly<{
  channelAccountId: string;
  displayName: string;
  phoneNumber: string | null;
  status: string;
  updatedAt: string;
}>;

export type ChannelDisconnectResponse = Readonly<{
  channelAccountId: string;
  displayName: string;
  phoneNumber: string | null;
  status: string;
  updatedAt: string;
}>;

export type CreateChannelPayload = Readonly<{
  displayName: string;
  providerType?: string | undefined;
  phoneNumber?: string | null | undefined;
  organizationUnitId?: string | null | undefined;
}>;

export type StatusBadgeDetails = Readonly<{
  dotColor: string;
  label: string;
  variant: "success" | "warn" | "danger" | "info" | "neutral";
}>;

export type QrTtlRemaining = Readonly<{
  formattedCountdown: string;
  isExpired: boolean;
  secondsRemaining: number;
}>;

export class ChannelApiError extends Error {
  readonly statusCode: number;
  readonly code?: string | undefined;

  constructor(message: string, statusCode: number, code?: string | undefined) {
    super(message);
    this.name = "ChannelApiError";
    this.statusCode = statusCode;
    if (code !== undefined) {
      this.code = code;
    }
  }
}

/**
 * Normalizes status strings and provides human-friendly badge details.
 */
export function formatChannelStatus(status: string | null | undefined): StatusBadgeDetails {
  const normalized = (status ?? "").toLowerCase().trim();

  switch (normalized) {
    case "connected":
      return {
        dotColor: "#2b8a3e",
        label: "Conectado",
        variant: "success",
      };
    case "connecting":
    case "pairing":
      return {
        dotColor: "#1c7ed6",
        label: "Conectando...",
        variant: "info",
      };
    case "qr_ready":
      return {
        dotColor: "#f59f00",
        label: "Esperando escaneo",
        variant: "warn",
      };
    case "disconnected":
      return {
        dotColor: "#868e96",
        label: "Desconectado",
        variant: "neutral",
      };
    case "failed":
    case "error":
      return {
        dotColor: "#c92a2a",
        label: "Error",
        variant: "danger",
      };
    case "archived":
      return {
        dotColor: "#adb5bd",
        label: "Archivado",
        variant: "neutral",
      };
    default:
      return {
        dotColor: "#868e96",
        label: status || "Desconocido",
        variant: "neutral",
      };
  }
}

/**
 * Calculates remaining seconds for a 30s TTL WhatsApp QR code.
 */
export function calculateQrTtlRemaining(
  qrGeneratedAt: string | null | undefined,
  now = Date.now(),
  ttlSeconds = 30,
): QrTtlRemaining {
  if (!qrGeneratedAt) {
    return {
      formattedCountdown: "00:00",
      isExpired: true,
      secondsRemaining: 0,
    };
  }

  const generatedTime = new Date(qrGeneratedAt).getTime();
  if (Number.isNaN(generatedTime)) {
    return {
      formattedCountdown: "00:00",
      isExpired: true,
      secondsRemaining: 0,
    };
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - generatedTime) / 1000));
  const remaining = Math.max(0, ttlSeconds - elapsedSeconds);
  const isExpired = remaining <= 0;

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const formattedCountdown = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return {
    formattedCountdown,
    isExpired,
    secondsRemaining: remaining,
  };
}

/**
 * Formats latency numbers in milliseconds.
 */
export function formatLatency(latencyMs: number | null | undefined): string {
  if (latencyMs === null || latencyMs === undefined || Number.isNaN(latencyMs)) {
    return "—";
  }
  return `${Math.round(latencyMs)} ms`;
}

/**
 * Formats socket status string into Spanish label.
 */
export function formatSocketStatus(
  socketStatus: "open" | "connecting" | "closed" | string | null | undefined,
): string {
  switch (socketStatus) {
    case "open":
      return "Abierto (Activo)";
    case "connecting":
      return "Conectando...";
    case "closed":
      return "Cerrado";
    default:
      return socketStatus ? String(socketStatus) : "Desconocido";
  }
}

/**
 * Formats relative time in Spanish.
 */
export function formatRelativeTime(isoString: string | null | undefined, now = Date.now()): string {
  if (!isoString) return "Nunca";
  const date = new Date(isoString).getTime();
  if (Number.isNaN(date)) return "—";

  const diffMs = now - date;
  if (diffMs < 0) return "Ahora";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "hace unos segundos";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `hace ${diffDays} d`;

  return new Date(isoString).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Helper to process JSON errors from API.
 */
async function parseErrorResponse(response: Response): Promise<ChannelApiError> {
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
    message = "No tienes permiso suficiente o el módulo de mensajería no está activo";
  if (response.status === 404) message = "Canal no encontrado";

  return new ChannelApiError(message, response.status, code);
}

/**
 * Fetches the list of channels for the active tenant.
 */
export async function fetchChannels(apiBaseUrl: string): Promise<readonly ChannelItem[]> {
  const url = `${apiBaseUrl}/api/v1/channels`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "GET",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const data = (await response.json()) as { items?: ChannelItem[] } | ChannelItem[];
  return Array.isArray(data) ? data : (data.items ?? []);
}

/**
 * Creates a new channel account.
 */
export async function createChannel(
  apiBaseUrl: string,
  payload: CreateChannelPayload,
): Promise<ChannelItem> {
  const url = `${apiBaseUrl}/api/v1/channels`;
  const bodyPayload: Record<string, unknown> = {
    displayName: payload.displayName,
    providerType: payload.providerType ?? "baileys",
  };
  if (payload.organizationUnitId) {
    bodyPayload.organizationUnitId = payload.organizationUnitId;
  }
  if (payload.phoneNumber) {
    bodyPayload.phoneNumber = payload.phoneNumber;
  }

  const response = await fetch(url, {
    body: JSON.stringify(bodyPayload),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return (await response.json()) as ChannelItem;
}

/**
 * Initiates QR pairing session for a channel.
 */
export async function initiateChannelPairing(
  apiBaseUrl: string,
  channelId: string,
): Promise<ChannelPairingInitiateResponse> {
  const url = `${apiBaseUrl}/api/v1/channels/${encodeURIComponent(channelId)}/pair/initiate`;
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return (await response.json()) as ChannelPairingInitiateResponse;
}

/**
 * Fetches current QR code pairing state for a channel.
 */
export async function fetchChannelQr(
  apiBaseUrl: string,
  channelId: string,
): Promise<QrPairingState> {
  const url = `${apiBaseUrl}/api/v1/channels/${encodeURIComponent(channelId)}/pair/qr`;
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
    method: "GET",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return (await response.json()) as QrPairingState;
}

/**
 * Disconnects an active channel account.
 */
export async function disconnectChannel(
  apiBaseUrl: string,
  channelId: string,
  reason?: string,
): Promise<ChannelDisconnectResponse> {
  const url = `${apiBaseUrl}/api/v1/channels/${encodeURIComponent(channelId)}/disconnect`;
  const bodyPayload: Record<string, unknown> = {};
  if (reason) {
    bodyPayload.reason = reason;
  }

  const response = await fetch(url, {
    body: JSON.stringify(bodyPayload),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return (await response.json()) as ChannelDisconnectResponse;
}

/**
 * Fetches diagnostic health metrics for a channel.
 */
export async function fetchChannelHealth(
  apiBaseUrl: string,
  channelId: string,
): Promise<ChannelHealthDiagnostic> {
  const url = `${apiBaseUrl}/api/v1/channels/${encodeURIComponent(channelId)}/health`;
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
    method: "GET",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return (await response.json()) as ChannelHealthDiagnostic;
}
