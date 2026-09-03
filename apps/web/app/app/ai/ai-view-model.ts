export interface TenantAiAgentConfig {
  readonly id: string;
  readonly tenantId: string;
  readonly automationMode: "RULES_ONLY" | "HYBRID_RULES_AI" | "FULL_AI";
  readonly systemDirectives: string | null;
  readonly virtualAliasKey: string;
  readonly minConfidenceScore: number;
  readonly humanHandoffKeywords: string[];
  readonly outOfHoursReply: string | null;
  readonly isEnabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpdateAiAgentConfigInput {
  readonly automationMode?: "RULES_ONLY" | "HYBRID_RULES_AI" | "FULL_AI" | undefined;
  readonly systemDirectives?: string | null | undefined;
  readonly virtualAliasKey?: string | undefined;
  readonly minConfidenceScore?: number | undefined;
  readonly humanHandoffKeywords?: string[] | undefined;
  readonly outOfHoursReply?: string | null | undefined;
  readonly isEnabled?: boolean | undefined;
}

export interface KnowledgeDocumentItem {
  readonly id: string;
  readonly title: string;
  readonly sourceType: string;
  readonly sourceUrl?: string | null | undefined;
  readonly status: "PENDING" | "PROCESSING" | "INDEXED" | "FAILED" | string;
  readonly charCount: number;
  readonly tokenCount: number;
  readonly chunksCount: number;
  readonly errorMessage?: string | null | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface KnowledgeChunkItem {
  readonly id: string;
  readonly chunkIndex: number;
  readonly content: string;
  readonly tokenCount: number;
  readonly createdAt: string;
}

export interface KnowledgeDocumentDetail extends KnowledgeDocumentItem {
  readonly rawContent: string;
  readonly chunks: KnowledgeChunkItem[];
}

export interface CreateKnowledgeDocumentInput {
  readonly title: string;
  readonly sourceType: "text" | "markdown" | "faq" | string;
  readonly sourceUrl?: string | undefined;
  readonly rawContent: string;
}

export interface AiUsageSummary {
  readonly totalRequests: number;
  readonly successfulRequests: number;
  readonly totalPromptTokens: number;
  readonly totalCompletionTokens: number;
  readonly totalTokens: number;
  readonly totalEstimatedCostUsd: number;
  readonly averageLatencyMs: number;
}

export function formatDocumentStatus(status: string): {
  label: string;
  variant: "success" | "warning" | "error" | "neutral";
  className: string;
} {
  switch (status.toUpperCase()) {
    case "INDEXED":
      return {
        label: "Indexado",
        variant: "success",
        className:
          "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
      };
    case "PROCESSING":
    case "PENDING":
      return {
        label: "Procesando",
        variant: "warning",
        className:
          "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
      };
    case "FAILED":
      return {
        label: "Error",
        variant: "error",
        className:
          "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
      };
    default:
      return {
        label: status,
        variant: "neutral",
        className:
          "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
      };
  }
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return tokens.toLocaleString();
}

export function formatCostUsd(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

export function parseKeywordsInput(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0);
}

export function formatKeywordsOutput(keywords: readonly string[]): string {
  return keywords.join(", ");
}

export async function fetchAiAgentConfig(apiBaseUrl: string): Promise<TenantAiAgentConfig> {
  const res = await fetch(`${apiBaseUrl}/api/v1/ai/agent/config`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Error al obtener configuración del agente (${res.status}): ${errorText}`);
  }

  const json = (await res.json()) as { success: boolean; data: TenantAiAgentConfig };
  return json.data;
}

export async function updateAiAgentConfig(
  apiBaseUrl: string,
  payload: UpdateAiAgentConfigInput,
): Promise<TenantAiAgentConfig> {
  const res = await fetch(`${apiBaseUrl}/api/v1/ai/agent/config`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Error al actualizar configuración del agente (${res.status}): ${errorText}`);
  }

  const json = (await res.json()) as { success: boolean; data: TenantAiAgentConfig };
  return json.data;
}

export async function fetchKnowledgeDocuments(
  apiBaseUrl: string,
  limit = 20,
  offset = 0,
): Promise<{ documents: KnowledgeDocumentItem[]; total: number }> {
  const res = await fetch(
    `${apiBaseUrl}/api/v1/ai/knowledge/documents?limit=${limit}&offset=${offset}`,
    {
      credentials: "include",
      headers: { Accept: "application/json" },
    },
  );

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Error al listar documentos (${res.status}): ${errorText}`);
  }

  return (await res.json()) as { documents: KnowledgeDocumentItem[]; total: number };
}

export async function createKnowledgeDocument(
  apiBaseUrl: string,
  payload: CreateKnowledgeDocumentInput,
): Promise<KnowledgeDocumentItem> {
  const res = await fetch(`${apiBaseUrl}/api/v1/ai/knowledge/documents`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Error al crear documento (${res.status}): ${errorText}`);
  }

  return (await res.json()) as KnowledgeDocumentItem;
}

export async function fetchKnowledgeDocumentDetail(
  apiBaseUrl: string,
  documentId: string,
): Promise<KnowledgeDocumentDetail> {
  const res = await fetch(`${apiBaseUrl}/api/v1/ai/knowledge/documents/${documentId}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Error al obtener detalle del documento (${res.status}): ${errorText}`);
  }

  return (await res.json()) as KnowledgeDocumentDetail;
}

export async function deleteKnowledgeDocument(
  apiBaseUrl: string,
  documentId: string,
): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/api/v1/ai/knowledge/documents/${documentId}`, {
    method: "DELETE",
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Error al eliminar documento (${res.status}): ${errorText}`);
  }
}

export async function fetchAiUsageSummary(
  apiBaseUrl: string,
  since?: string,
): Promise<AiUsageSummary> {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  const res = await fetch(`${apiBaseUrl}/api/v1/ai/usage/summary${query}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Error al obtener resumen de uso (${res.status}): ${errorText}`);
  }

  return (await res.json()) as AiUsageSummary;
}
