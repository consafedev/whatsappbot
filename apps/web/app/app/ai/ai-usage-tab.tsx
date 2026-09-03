"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type AiUsageSummary,
  fetchAiUsageSummary,
  formatCostUsd,
  formatTokens,
} from "./ai-view-model";

type AiUsageTabProps = Readonly<{
  apiBaseUrl: string;
}>;

export function AiUsageTab({ apiBaseUrl }: AiUsageTabProps) {
  const [summary, setSummary] = useState<AiUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAiUsageSummary(apiBaseUrl);
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar telemetría de uso");
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Consumo y Costos de IA
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Métricas acumuladas del consumo de tokens y estimación de costos en USD.
          </p>
        </div>

        <button
          type="button"
          onClick={loadSummary}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
        >
          <span>↻ Actualizar</span>
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-sm text-slate-500">
          Cargando telemetría de consumo...
        </div>
      ) : summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* Card: Total Requests */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Peticiones Totales
            </p>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {summary.totalRequests.toLocaleString()}
              </span>
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                {summary.successfulRequests} exitosas
              </span>
            </div>
          </div>

          {/* Card: Total Tokens */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Tokens Totales
            </p>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {formatTokens(summary.totalTokens)}
              </span>
              <span className="text-xs text-slate-500">
                {formatTokens(summary.totalPromptTokens)} in /{" "}
                {formatTokens(summary.totalCompletionTokens)} out
              </span>
            </div>
          </div>

          {/* Card: Estimated Cost */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Costo Estimado (USD)
            </p>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                {formatCostUsd(summary.totalEstimatedCostUsd)}
              </span>
              <span className="text-xs text-slate-400 font-mono">~0.01$/1K tok</span>
            </div>
          </div>

          {/* Card: Prompt Tokens */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Tokens de Entrada (Prompt)
            </p>
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {summary.totalPromptTokens.toLocaleString()}
            </span>
          </div>

          {/* Card: Completion Tokens */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Tokens de Salida (Completado)
            </p>
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {summary.totalCompletionTokens.toLocaleString()}
            </span>
          </div>

          {/* Card: Average Latency */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Latencia Promedio
            </p>
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {summary.averageLatencyMs.toFixed(0)} ms
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
