import type { MessageTimeSeriesBucket, TenantOperationalOverviewResult } from "./analytics-manager";

const UTF8_BOM = "\uFEFF";
const CRLF = "\r\n";

/**
 * Escapes a single CSV field following RFC 4180 rules.
 */
export function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates an operational overview CSV table with UTF-8 BOM preamble.
 */
export function generateOperationalOverviewCsv(
  overview: TenantOperationalOverviewResult,
  options: { readonly from: Date; readonly to: Date },
): string {
  const fromStr = options.from.toISOString().slice(0, 10);
  const toStr = options.to.toISOString().slice(0, 10);

  const cost = (
    overview.aiTokenUsage.estimatedCostUsd ??
    overview.aiTokenUsage.costEstimatedUsd ??
    0
  ).toFixed(4);

  const lines = [
    "Reporte Operativo de Mensajería",
    `Periodo,${escapeCsvField(`${fromStr} a ${toStr}`)}`,
    "",
    "Métrica,Valor",
    `Mensajes Entrantes,${escapeCsvField(overview.inboundMessagesCount)}`,
    `Mensajes Salientes,${escapeCsvField(overview.outboundMessagesCount)}`,
    `Conversaciones Activas,${escapeCsvField(overview.activeConversationsCount)}`,
    `Conversaciones Cerradas,${escapeCsvField(overview.closedConversationsCount)}`,
    `Efectividad de Entrega,${escapeCsvField(`${overview.deliverySuccessRate}%`)}`,
    `Tokens de IA (Prompt),${escapeCsvField(overview.aiTokenUsage.promptTokens)}`,
    `Tokens de IA (Completitud),${escapeCsvField(overview.aiTokenUsage.completionTokens)}`,
    `Tokens de IA (Total),${escapeCsvField(overview.aiTokenUsage.totalTokens)}`,
    `Costo Estimado IA (USD),${escapeCsvField(`$${cost}`)}`,
  ];

  return `${UTF8_BOM}${lines.join(CRLF)}${CRLF}`;
}

export type TimeSeriesCsvInput =
  | readonly MessageTimeSeriesBucket[]
  | { readonly buckets: readonly MessageTimeSeriesBucket[] };

/**
 * Generates a time-series CSV table with UTF-8 BOM preamble.
 */
export function generateTimeSeriesCsv(timeSeries: TimeSeriesCsvInput): string {
  const buckets: readonly MessageTimeSeriesBucket[] = Array.isArray(timeSeries)
    ? timeSeries
    : "buckets" in timeSeries && Array.isArray(timeSeries.buckets)
      ? timeSeries.buckets
      : [];

  const header = "Fecha/Hora,Mensajes Entrantes,Mensajes Salientes,Volumen Total";
  const rows = buckets.map((item) => {
    const raw = item as unknown as Record<string, unknown>;
    const timestamp = String(raw.timestamp ?? raw.bucket ?? "");
    const inbound = Number(raw.inbound ?? raw.inboundCount ?? 0);
    const outbound = Number(raw.outbound ?? raw.outboundCount ?? 0);
    const total = Number(raw.total ?? raw.totalCount ?? inbound + outbound);

    return [
      escapeCsvField(timestamp),
      escapeCsvField(inbound),
      escapeCsvField(outbound),
      escapeCsvField(total),
    ].join(",");
  });

  const lines = [header, ...rows];
  return `${UTF8_BOM}${lines.join(CRLF)}${CRLF}`;
}
