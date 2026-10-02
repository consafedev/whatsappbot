export type ScheduledTaskStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface ScheduledTaskItem {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly taskType: string;
  readonly status: ScheduledTaskStatus;
  readonly payload: Record<string, unknown>;
  readonly cronExpression?: string | null;
  readonly scheduledFor: string;
  readonly lastRunAt?: string | null;
  readonly nextRunAt?: string | null;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly errorMessage?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScheduledTasksResponse {
  readonly items: readonly ScheduledTaskItem[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface CreateScheduledTaskInput {
  readonly name: string;
  readonly taskType: "TRIGGER_RULE" | "CUSTOM_ACTION" | string;
  readonly scheduledFor?: string;
  readonly cronExpression?: string;
  readonly payload?: Record<string, unknown>;
  readonly maxRetries?: number;
}

export type ScheduledTaskStatusTone = "amber" | "blue" | "green" | "red" | "gray";

export interface ScheduledTaskStatusPresentation {
  readonly label: string;
  readonly tone: ScheduledTaskStatusTone;
}

export class ScheduledTasksApiError extends Error {
  readonly statusCode: number;
  readonly code?: string | undefined;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = "ScheduledTasksApiError";
    this.statusCode = statusCode;
    if (code !== undefined) this.code = code;
  }
}

interface ApiEnvelope<T> {
  readonly success: true;
  readonly data: T;
}

interface ScheduledTaskListApiData {
  readonly tasks: readonly ScheduledTaskItem[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface FetchScheduledTasksOptions {
  readonly status?: ScheduledTaskStatus | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

function taskUrl(apiBaseUrl: string, path: string): string {
  return `${apiBaseUrl.replace(/\/$/, "")}/api/v1/scheduled-tasks${path}`;
}

async function parseErrorResponse(response: Response): Promise<ScheduledTasksApiError> {
  let message = `Error en el servidor (${response.status})`;
  let code: string | undefined;

  try {
    const body = (await response.json()) as {
      readonly code?: unknown;
      readonly message?: unknown;
      readonly error?: unknown;
    };
    if (typeof body.message === "string") {
      message = body.message;
    } else if (Array.isArray(body.message) && body.message.length > 0) {
      message = body.message.map(String).join(", ");
    } else if (typeof body.error === "string") {
      message = body.error;
    }
    if (typeof body.code === "string") code = body.code;
  } catch {
    // Non-JSON error responses retain a safe status-based message.
  }

  return new ScheduledTasksApiError(message, response.status, code);
}

async function fetchEnvelope<T>(
  url: string,
  init: RequestInit,
): Promise<{ readonly data: T; readonly status: number }> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ScheduledTasksApiError("No se pudo conectar con el servidor de tareas", 0);
  }

  if (!response.ok) throw await parseErrorResponse(response);

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ScheduledTasksApiError("Respuesta inválida del servidor", response.status);
  }
  if (
    envelope === null ||
    typeof envelope !== "object" ||
    envelope.success !== true ||
    !("data" in envelope)
  ) {
    throw new ScheduledTasksApiError("Respuesta inválida del servidor", response.status);
  }

  return { data: envelope.data, status: response.status };
}

export async function fetchScheduledTasks(
  apiBaseUrl: string,
  options: FetchScheduledTasksOptions = {},
): Promise<ScheduledTasksResponse> {
  const query = new URLSearchParams();
  if (options.status !== undefined) query.set("status", options.status);
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.offset !== undefined) query.set("offset", String(options.offset));
  const queryString = query.toString();
  const url = taskUrl(apiBaseUrl, queryString ? `?${queryString}` : "");
  const { data, status } = await fetchEnvelope<ScheduledTaskListApiData>(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "GET",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  if (
    data === null ||
    typeof data !== "object" ||
    !Array.isArray(data.tasks) ||
    typeof data.total !== "number" ||
    typeof data.limit !== "number" ||
    typeof data.offset !== "number"
  ) {
    throw new ScheduledTasksApiError("Respuesta inválida del servidor", status);
  }

  return { items: data.tasks, total: data.total, limit: data.limit, offset: data.offset };
}

export async function createScheduledTask(
  apiBaseUrl: string,
  input: CreateScheduledTaskInput,
): Promise<ScheduledTaskItem> {
  const { data } = await fetchEnvelope<ScheduledTaskItem>(taskUrl(apiBaseUrl, ""), {
    body: JSON.stringify(input),
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    method: "POST",
  });
  return data;
}

export async function cancelScheduledTask(
  apiBaseUrl: string,
  id: string,
): Promise<ScheduledTaskItem> {
  const { data } = await fetchEnvelope<ScheduledTaskItem>(
    taskUrl(apiBaseUrl, `/${encodeURIComponent(id)}`),
    {
      credentials: "include",
      headers: { Accept: "application/json" },
      method: "DELETE",
    },
  );
  return data;
}

export async function retryScheduledTask(
  apiBaseUrl: string,
  id: string,
  runAt?: string,
): Promise<ScheduledTaskItem> {
  const { data } = await fetchEnvelope<ScheduledTaskItem>(
    taskUrl(apiBaseUrl, `/${encodeURIComponent(id)}/retry`),
    {
      ...(runAt === undefined ? {} : { body: JSON.stringify({ runAt }) }),
      credentials: "include",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "POST",
    },
  );
  return data;
}

const STATUS_PRESENTATION: Readonly<Record<ScheduledTaskStatus, ScheduledTaskStatusPresentation>> =
  Object.freeze({
    PENDING: { label: "Pendiente", tone: "amber" },
    PROCESSING: { label: "En ejecución", tone: "blue" },
    COMPLETED: { label: "Completada", tone: "green" },
    FAILED: { label: "Fallida", tone: "red" },
    CANCELLED: { label: "Cancelada", tone: "gray" },
  });

export function formatTaskStatus(status: ScheduledTaskStatus): ScheduledTaskStatusPresentation {
  return STATUS_PRESENTATION[status];
}

export function formatTaskType(type: string): string {
  switch (type) {
    case "TRIGGER_RULE":
      return "Disparador de Regla";
    case "CUSTOM_ACTION":
      return "Acción Personalizada";
    default:
      return type;
  }
}

export function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return "Fecha no disponible";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function canReadScheduledTasks(
  effectiveModules: readonly string[],
  effectivePermissions: readonly string[],
): boolean {
  return (
    effectiveModules.includes("module.scheduling") &&
    effectivePermissions.includes("scheduling.read")
  );
}

export function canManageScheduledTasks(effectivePermissions: readonly string[]): boolean {
  return effectivePermissions.includes("scheduling.manage");
}
