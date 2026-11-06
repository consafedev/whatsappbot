import type {
  QuoteDraftInput as EditorQuoteDraftInput,
  QuoteDraftPatch,
} from "./quote-editor-model";
import type { Quote, QuotePolicy } from "./quotes-view-model";

export class QuotesApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "QuotesApiError";
  }
}

export type QuoteRecordedOutcome = Readonly<{
  quoteId: string;
  number: string;
  status: string;
  revision: number;
  result?: string;
}>;
export type QuoteCommandOutcome<T> = Readonly<{
  replayed: boolean;
  recordedOutcome: QuoteRecordedOutcome;
  current: T;
}>;
export type QuotePage = Readonly<{ items: readonly Quote[]; nextCursor: string | null }>;
export type QuoteFilters = Readonly<{
  status?: string;
  contactId?: string;
  cursor?: string;
  limit?: number;
}>;
export type QuoteApprovalView = Readonly<{
  id: string;
  quoteId: string;
  status: string;
  quoteStatus: string;
  revision: number;
  sourceRevision: number;
  resultingRevision: number;
  policyRevision: number;
  policyHash: string;
  allowSelfApprovalSnapshot: boolean;
  requestActorUserId: string;
  decisionActorType: string | null;
  decisionActorUserId: string | null;
  requestReasonCodes: readonly string[];
  decisionReasonCode: string | null;
  decisionNote: string | null;
  requestedAt: string;
  decidedAt: string | null;
  isCurrent: boolean;
}>;
export type QuoteCancellationView = Readonly<{
  quoteId: string;
  number: string;
  status: string;
  revision: number;
}>;
export type QuoteContactOption = Readonly<{ id: string; name: string; phoneNumber: string }>;
export type QuoteOrganizationUnitOption = Readonly<{
  id: string;
  name: string;
  code: string | null;
}>;
export type QuoteOptionsPage<T> = Readonly<{
  items: readonly T[];
  nextCursor: string | null;
  limit: number;
}>;

async function errorFrom(response: Response): Promise<QuotesApiError> {
  let message = `La solicitud no se completó (${response.status}).`;
  try {
    const body = (await response.json()) as { message?: string | readonly string[] };
    if (typeof body.message === "string") message = body.message;
    if (Array.isArray(body.message)) message = body.message.join("; ");
  } catch {
    // Keep the status-specific default for non-JSON responses.
  }
  if (response.status === 401) message = "Tu sesión expiró. Inicia sesión y vuelve a intentarlo.";
  if (response.status === 403) message = "Tu acceso a esta acción cambió. Actualiza la página.";
  if (response.status === 404) message = "La cotización ya no está disponible.";
  if (response.status === 409)
    message =
      "La cotización cambió o la política ya no permite esta acción. Actualiza el registro.";
  return new QuotesApiError(message, response.status);
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
  const envelope = (await response.json()) as { success?: boolean; data?: T };
  if (envelope.success !== true || !Object.hasOwn(envelope, "data")) {
    throw new QuotesApiError(
      "La respuesta de cotizaciones no tiene el formato esperado.",
      response.status,
    );
  }
  return envelope.data as T;
}

export type QuoteDraftInput = EditorQuoteDraftInput;

type QuotePatchBase = Readonly<{
  idempotencyKey: string;
  expectedRevision: number;
  metadata: Readonly<Record<string, string | null>>;
}>;
export type QuotePatchInput = QuotePatchBase &
  (
    | Readonly<{ replaceLines: readonly Record<string, unknown>[]; convertToManual?: never }>
    | Readonly<{
        convertToManual: readonly Readonly<{
          position: number;
          snapshot: Readonly<Record<string, unknown>>;
        }>[];
        replaceLines?: never;
      }>
    | Readonly<{ replaceLines?: never; convertToManual?: never }>
  );
export type QuoteManualConversionInput = Readonly<{
  idempotencyKey: string;
  expectedRevision: number;
  convertToManual: readonly Readonly<{
    position: number;
    snapshot: Readonly<Record<string, unknown>>;
  }>[];
}>;

export type QuotePolicyInput = Omit<QuotePolicy, "contentHash" | "revision"> &
  Readonly<{ expectedRevision: number; idempotencyKey: string }>;

export function createQuotesApi(apiBaseUrl: string) {
  const root = `${apiBaseUrl.replace(/\/$/, "")}/api/v1/quotes`;
  return {
    loadQuotes(filters: QuoteFilters = {}): Promise<QuotePage> {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters))
        if (value !== undefined && value !== "") query.set(key, String(value));
      return request(`${root}${query.size ? `?${query.toString()}` : ""}`);
    },
    loadQuote(id: string): Promise<Quote> {
      return request(`${root}/${encodeURIComponent(id)}`);
    },
    loadContactOptions(
      options: { search?: string; cursor?: string; limit?: number } = {},
    ): Promise<QuoteOptionsPage<QuoteContactOption>> {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(options))
        if (value !== undefined && value !== "") query.set(key, String(value));
      return request(`${root}/options/contacts${query.size ? `?${query.toString()}` : ""}`);
    },
    loadOrganizationUnitOptions(
      options: { search?: string; cursor?: string; limit?: number } = {},
    ): Promise<QuoteOptionsPage<QuoteOrganizationUnitOption>> {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(options))
        if (value !== undefined && value !== "") query.set(key, String(value));
      return request(
        `${root}/options/organization-units${query.size ? `?${query.toString()}` : ""}`,
      );
    },
    saveQuoteDraft(
      id: string | null,
      input: QuoteDraftInput | QuotePatchInput | QuoteDraftPatch | QuoteManualConversionInput,
    ): Promise<QuoteCommandOutcome<Quote>> {
      return request(id ? `${root}/${encodeURIComponent(id)}` : root, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(input),
      });
    },
    requestApproval(id: string, input: { idempotencyKey: string; expectedRevision: number }) {
      return request<QuoteCommandOutcome<QuoteApprovalView>>(
        `${root}/${encodeURIComponent(id)}/approval-request`,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    approveQuote(
      id: string,
      input: {
        idempotencyKey: string;
        expectedRevision: number;
        reasonCode: "manual_review";
        note?: string;
      },
    ) {
      return request<QuoteCommandOutcome<QuoteApprovalView>>(
        `${root}/${encodeURIComponent(id)}/approve`,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    rejectQuote(
      id: string,
      input: {
        idempotencyKey: string;
        expectedRevision: number;
        reasonCode: "manual_review";
        note?: string;
      },
    ) {
      return request<QuoteCommandOutcome<QuoteApprovalView>>(
        `${root}/${encodeURIComponent(id)}/reject`,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    cancelQuote(id: string, input: { idempotencyKey: string; expectedRevision: number }) {
      return request<QuoteCommandOutcome<QuoteCancellationView>>(
        `${root}/${encodeURIComponent(id)}/cancel`,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    loadPolicy(): Promise<QuotePolicy> {
      return request(`${root}/policy`);
    },
    updatePolicy(input: QuotePolicyInput): Promise<QuoteCommandOutcome<QuotePolicy>> {
      return request(`${root}/policy`, { method: "PUT", body: JSON.stringify(input) });
    },
  };
}

export type QuotesApi = ReturnType<typeof createQuotesApi>;
