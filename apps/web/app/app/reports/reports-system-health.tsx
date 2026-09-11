"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchSystemHealth,
  formatNumber,
  ReportsApiError,
  type SystemHealthData,
} from "./reports-view-model";

type ReportsSystemHealthProps = Readonly<{
  apiBaseUrl: string;
}>;

function getLatencyBadgeClass(latencyMs: number): {
  badge: string;
  dot: string;
  text: string;
} {
  if (latencyMs < 0) {
    return {
      badge: "bg-red-50 text-red-700 border-red-200",
      dot: "bg-red-500",
      text: "No disponible",
    };
  }
  if (latencyMs < 50) {
    return {
      badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
      dot: "bg-emerald-500",
      text: "Óptima (< 50ms)",
    };
  }
  if (latencyMs < 200) {
    return {
      badge: "bg-amber-50 text-amber-700 border-amber-200",
      dot: "bg-amber-500",
      text: "Moderada (< 200ms)",
    };
  }
  return {
    badge: "bg-rose-50 text-rose-700 border-rose-200",
    dot: "bg-rose-500",
    text: "Elevada (> 200ms)",
  };
}

function getWorkerBadgeClass(status: "active" | "degraded" | "inactive"): {
  badge: string;
  dot: string;
  label: string;
} {
  if (status === "active") {
    return {
      badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
      dot: "bg-emerald-500",
      label: "Activo",
    };
  }
  if (status === "degraded") {
    return {
      badge: "bg-amber-50 text-amber-700 border-amber-200",
      dot: "bg-amber-500",
      label: "Degradado",
    };
  }
  return {
    badge: "bg-rose-50 text-rose-700 border-rose-200",
    dot: "bg-rose-500",
    label: "Inactivo",
  };
}

export function ReportsSystemHealth({ apiBaseUrl }: ReportsSystemHealthProps) {
  const [data, setData] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHealthData = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const health = await fetchSystemHealth(apiBaseUrl);
        setData(health);
      } catch (err: unknown) {
        const message =
          err instanceof ReportsApiError
            ? err.message
            : "No se pudo obtener la información de salud del sistema.";
        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [apiBaseUrl],
  );

  useEffect(() => {
    void loadHealthData(false);
  }, [loadHealthData]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="h-24 w-full animate-pulse rounded-xl bg-slate-100" />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items
            <div key={i} className="h-32 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  const postgresBadge = data ? getLatencyBadgeClass(data.databaseLatencyMs) : null;
  const redisBadge = data ? getLatencyBadgeClass(data.redisLatencyMs) : null;
  const whatsappWorkerBadge = data ? getWorkerBadgeClass(data.workerStatus.whatsappWorker) : null;
  const jobsWorkerBadge = data ? getWorkerBadgeClass(data.workerStatus.jobsWorker) : null;

  const formattedTimestamp = data?.timestamp
    ? new Date(data.timestamp).toLocaleString("es-MX", {
        dateStyle: "medium",
        timeStyle: "medium",
      })
    : "—";

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Telemetría de Infraestructura y Colas
          </h2>
          <p className="text-sm text-slate-500">
            Sondas de latencia en tiempo real, rendimiento del outbox y estado operativo de workers.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            Última verificación: <strong className="text-slate-700">{formattedTimestamp}</strong>
          </span>
          <button
            type="button"
            onClick={() => void loadHealthData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
          >
            <svg
              className={`h-4 w-4 ${refreshing ? "animate-spin text-indigo-600" : "text-slate-500"}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {refreshing ? "Verificando..." : "Actualizar"}
          </button>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="flex items-center justify-between">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void loadHealthData(true)}
              className="font-medium underline hover:text-rose-900"
            >
              Reintentar
            </button>
          </div>
        </div>
      )}

      {/* Global Status Banner */}
      {data && (
        <div
          className={`flex items-center justify-between rounded-xl border p-4 shadow-sm ${
            data.status === "healthy"
              ? "border-emerald-200 bg-emerald-50/70 text-emerald-950"
              : data.status === "degraded"
                ? "border-amber-200 bg-amber-50/70 text-amber-950"
                : "border-rose-200 bg-rose-50/70 text-rose-950"
          }`}
        >
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex h-3 w-3 rounded-full ${
                data.status === "healthy"
                  ? "bg-emerald-500 ring-4 ring-emerald-100"
                  : data.status === "degraded"
                    ? "bg-amber-500 ring-4 ring-amber-100"
                    : "bg-rose-500 ring-4 ring-rose-100"
              }`}
            />
            <div>
              <p className="text-base font-semibold">
                {data.status === "healthy"
                  ? "Todos los sistemas funcionando con normalidad"
                  : data.status === "degraded"
                    ? "Rendimiento del sistema degradado o latencia elevada"
                    : "Atención crítica: uno o más servicios de infraestructura no responden"}
              </p>
              <p className="text-xs opacity-90">
                Estado general evaluado en base a sondas de PostgreSQL, Redis y colas de despacho.
              </p>
            </div>
          </div>
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
              data.status === "healthy"
                ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                : data.status === "degraded"
                  ? "border-amber-300 bg-amber-100 text-amber-800"
                  : "border-rose-300 bg-rose-100 text-rose-800"
            }`}
          >
            {data.status === "healthy"
              ? "Saludable"
              : data.status === "degraded"
                ? "Degradado"
                : "Crítico"}
          </span>
        </div>
      )}

      {/* Metrics Cards Grid */}
      {data && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {/* Card 1: PostgreSQL Ping Latency */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500">PostgreSQL (Prisma)</span>
              {postgresBadge && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${postgresBadge.badge}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${postgresBadge.dot}`} />
                  {postgresBadge.text}
                </span>
              )}
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight text-slate-900">
                {data.databaseLatencyMs >= 0 ? `${data.databaseLatencyMs}` : "—"}
              </span>
              <span className="text-sm text-slate-500">ms de latencia</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Sonda de consulta a la base de datos relacional de la plataforma.
            </p>
          </div>

          {/* Card 2: Redis Ping Latency */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500">Redis (Caché & Colas)</span>
              {redisBadge && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${redisBadge.badge}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${redisBadge.dot}`} />
                  {redisBadge.text}
                </span>
              )}
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight text-slate-900">
                {data.redisLatencyMs >= 0 ? `${data.redisLatencyMs}` : "—"}
              </span>
              <span className="text-sm text-slate-500">ms de latencia</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Ping directo RESP a través de socket nativo TCP.
            </p>
          </div>

          {/* Card 3: Outbox Pending Messages */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500">Mensajes en Cola (Outbox)</span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  data.outboxMetrics.pendingCount === 0
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                {data.outboxMetrics.pendingCount === 0 ? "Al día" : "Procesando"}
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight text-slate-900">
                {formatNumber(data.outboxMetrics.pendingCount)}
              </span>
              <span className="text-sm text-slate-500">pendientes</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Mensajes salientes esperando turno de despacho por el worker.
            </p>
          </div>

          {/* Card 4: Outbox Failed Messages */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500">Mensajes Fallidos</span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  data.outboxMetrics.failedCount === 0
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-rose-200 bg-rose-50 text-rose-700"
                }`}
              >
                {data.outboxMetrics.failedCount === 0 ? "Sin incidencias" : "Requiere atención"}
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span
                className={`text-3xl font-bold tracking-tight ${
                  data.outboxMetrics.failedCount > 0 ? "text-rose-600" : "text-slate-900"
                }`}
              >
                {formatNumber(data.outboxMetrics.failedCount)}
              </span>
              <span className="text-sm text-slate-500">con error</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Mensajes que agotaron sus reintentos máximos de envío.
            </p>
          </div>

          {/* Card 5: Average Transit Latency */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500">Tiempo Medio de Tránsito</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                Últimas 24h
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight text-slate-900">
                {data.outboxMetrics.averageTransitSeconds}
              </span>
              <span className="text-sm text-slate-500">segundos promedio</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Diferencia promedio entre creación y confirmación de envío.
            </p>
          </div>

          {/* Card 6: Workers Status Summary */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500">Estado de Workers</span>
              <span className="text-xs text-slate-400">Procesos asíncronos</span>
            </div>
            <div className="mt-4 space-y-2.5">
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-xs font-medium text-slate-700">WhatsApp Worker</span>
                {whatsappWorkerBadge && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${whatsappWorkerBadge.badge}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${whatsappWorkerBadge.dot}`} />
                    {whatsappWorkerBadge.label}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-xs font-medium text-slate-700">Jobs Worker (BullMQ)</span>
                {jobsWorkerBadge && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${jobsWorkerBadge.badge}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${jobsWorkerBadge.dot}`} />
                    {jobsWorkerBadge.label}
                  </span>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Derivado de disponibilidad de infraestructura (PostgreSQL/Redis). Aún no evalúa
              heartbeats de proceso de BullMQ.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
