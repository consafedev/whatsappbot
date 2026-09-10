"use client";

import type { CampaignMetrics } from "../campaigns-view-model";

type CampaignKpiCardsProps = Readonly<{
  metrics: CampaignMetrics | null;
  loading: boolean;
}>;

export function CampaignKpiCards({ metrics, loading }: CampaignKpiCardsProps) {
  if (loading || !metrics) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm animate-pulse"
          >
            <div className="h-4 w-24 bg-slate-200 dark:bg-slate-800 rounded mb-3" />
            <div className="h-8 w-16 bg-slate-200 dark:bg-slate-800 rounded mb-2" />
            <div className="h-3 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      data-testid="campaign-kpis"
    >
      {/* Total Recipients Card */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Audiencia Total
          </span>
          <span className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center text-sm">
            👥
          </span>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {metrics.totalRecipients.toLocaleString()}
          </span>
          <span className="text-xs text-slate-500">contactos</span>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {metrics.pendingCount}
          </span>{" "}
          en cola / pendientes
        </p>
      </div>

      {/* Delivery Rate Card */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Tasa de Entrega
          </span>
          <span className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-sm font-semibold">
            ✓✓
          </span>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
            {metrics.deliveryRate}%
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {metrics.deliveredCount.toLocaleString()}
          </span>{" "}
          entregados de{" "}
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {metrics.sentCount.toLocaleString()}
          </span>{" "}
          enviados
        </p>
      </div>

      {/* Read Rate Card */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Tasa de Lectura
          </span>
          <span className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-sm">
            👁
          </span>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {metrics.readRate}%
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {metrics.readCount.toLocaleString()}
          </span>{" "}
          leídos por destinatarios
        </p>
      </div>

      {/* Failure Rate Card */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Tasa de Fallo
          </span>
          <span className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center text-sm font-bold">
            ✕
          </span>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span
            className={`text-2xl font-bold ${metrics.failureRate > 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"}`}
          >
            {metrics.failureRate}%
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {metrics.failedCount.toLocaleString()}
          </span>{" "}
          mensajes no entregados
        </p>
      </div>
    </div>
  );
}
