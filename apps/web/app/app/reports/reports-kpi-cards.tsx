"use client";

import {
  formatCurrencyUsd,
  formatNumber,
  type TenantOperationalOverview,
} from "./reports-view-model";

type ReportsKpiCardsProps = Readonly<{
  overview: TenantOperationalOverview | null;
  loading: boolean;
}>;

export function ReportsKpiCards({ overview, loading }: ReportsKpiCardsProps) {
  if (loading || !overview) {
    return (
      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        data-testid="reports-kpis-loading"
      >
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm animate-pulse"
          >
            <div className="h-4 w-28 bg-slate-200 dark:bg-slate-800 rounded mb-3" />
            <div className="h-8 w-20 bg-slate-200 dark:bg-slate-800 rounded mb-2" />
            <div className="h-3 w-36 bg-slate-200 dark:bg-slate-800 rounded" />
          </div>
        ))}
      </div>
    );
  }

  const totalMessages = overview.inboundMessagesCount + overview.outboundMessagesCount;
  const totalConversations = overview.activeConversationsCount + overview.closedConversationsCount;
  const resolutionPercentage =
    totalConversations > 0
      ? Math.round((overview.closedConversationsCount / totalConversations) * 100)
      : 0;

  // Delivery rate color classes
  const rate = overview.deliverySuccessRate;
  const rateColorClass =
    rate >= 90
      ? "text-emerald-600 dark:text-emerald-400"
      : rate >= 70
        ? "text-amber-600 dark:text-amber-400"
        : "text-rose-600 dark:text-rose-400";

  const progressBgClass =
    rate >= 90 ? "bg-emerald-500" : rate >= 70 ? "bg-amber-500" : "bg-rose-500";

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      data-testid="reports-kpis-container"
    >
      {/* 1. Messaging Volume Card */}
      <div
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex flex-col justify-between"
        data-testid="kpi-card-messaging-volume"
      >
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Volumen de Mensajes
            </span>
            <span
              className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-sm"
              aria-hidden="true"
            >
              💬
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {formatNumber(totalMessages)}
            </span>
            <span className="text-xs text-slate-500">totales</span>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
            Entrantes:{" "}
            <strong className="font-semibold text-slate-800 dark:text-slate-200">
              {formatNumber(overview.inboundMessagesCount)}
            </strong>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-500" aria-hidden="true" />
            Salientes:{" "}
            <strong className="font-semibold text-slate-800 dark:text-slate-200">
              {formatNumber(overview.outboundMessagesCount)}
            </strong>
          </span>
        </div>
      </div>

      {/* 2. Delivery Success Rate Card */}
      <div
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex flex-col justify-between"
        data-testid="kpi-card-delivery-rate"
      >
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Efectividad de Entrega
            </span>
            <span
              className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-sm font-semibold"
              aria-hidden="true"
            >
              ✓✓
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className={`text-2xl font-bold ${rateColorClass}`}>{rate.toFixed(1)}%</span>
            <span className="text-xs text-slate-500">éxito</span>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className={`h-2 rounded-full transition-all duration-500 ${progressBgClass}`}
              style={{ width: `${Math.min(Math.max(rate, 0), 100)}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            Mensajes entregados y recibidos exitosamente
          </p>
        </div>
      </div>

      {/* 3. Conversation Status Card */}
      <div
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex flex-col justify-between"
        data-testid="kpi-card-conversations"
      >
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Conversaciones
            </span>
            <span
              className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm"
              aria-hidden="true"
            >
              👥
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {formatNumber(totalConversations)}
            </span>
            <span className="text-xs text-slate-500">atendidas</span>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
          <span>
            Activas:{" "}
            <strong className="font-semibold text-amber-600 dark:text-amber-400">
              {formatNumber(overview.activeConversationsCount)}
            </strong>
          </span>
          <span>
            Cerradas:{" "}
            <strong className="font-semibold text-emerald-600 dark:text-emerald-400">
              {formatNumber(overview.closedConversationsCount)}
            </strong>{" "}
            ({resolutionPercentage}%)
          </span>
        </div>
      </div>

      {/* 4. AI Token Usage Card */}
      <div
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex flex-col justify-between"
        data-testid="kpi-card-ai-tokens"
      >
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Consumo de IA
            </span>
            <span
              className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center text-sm"
              aria-hidden="true"
            >
              🤖
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {formatCurrencyUsd(overview.aiTokenUsage.estimatedCostUsd)}
            </span>
            <span className="text-xs text-slate-500">USD est.</span>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
          <div className="flex items-center justify-between">
            <span>Tokens totales:</span>
            <strong className="font-semibold text-slate-800 dark:text-slate-200">
              {formatNumber(overview.aiTokenUsage.totalTokens)}
            </strong>
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {formatNumber(overview.aiTokenUsage.promptTokens)} prompt ·{" "}
            {formatNumber(overview.aiTokenUsage.completionTokens)} resp.
          </p>
        </div>
      </div>
    </div>
  );
}
