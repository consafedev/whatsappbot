"use client";

import type { AlertsOverviewData, OperationalAnomalyAlert } from "./reports-view-model";

type ReportsAlertsProps = Readonly<{
  alertsData: AlertsOverviewData | null;
  loading?: boolean | undefined;
  onRefresh?: (() => void) | undefined;
}>;

function getRemediationAdvice(code: string): string {
  switch (code) {
    case "HIGH_FAILURE_RATE":
      return "Recomendación: Verificar mensajes salientes en cola y estado del proveedor de WhatsApp.";
    case "OUTBOX_BACKLOG":
      return "Recomendación: Verificar el rendimiento del worker de WhatsApp y la tasa de despacho.";
    case "HIGH_LATENCY_DB":
      return "Recomendación: Revisar carga de base de datos PostgreSQL y pool de conexiones activas.";
    case "HIGH_LATENCY_REDIS":
      return "Recomendación: Inspeccionar el contenedor de Redis y el consumo de memoria.";
    case "CHANNEL_DISCONNECTED":
      return "Recomendación: Ir a Configuración de Canales para reconectar la sesión de WhatsApp.";
    default:
      return "Recomendación: Revisar los registros de observabilidad operativa.";
  }
}

export function ReportsAlerts({ alertsData, loading = false, onRefresh }: ReportsAlertsProps) {
  if (!alertsData) {
    if (loading) {
      return (
        <div
          data-testid="reports-alerts-loading"
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-3 animate-pulse text-xs text-slate-500"
        >
          Evaluando anomalías operativas…
        </div>
      );
    }
    return null;
  }

  const { activeAlerts, summary, evaluatedAt } = alertsData;
  const isHealthy = summary.total === 0;
  const hasCritical = summary.critical > 0;

  const formattedDate = (() => {
    try {
      return new Date(evaluatedAt).toLocaleTimeString("es-MX", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return evaluatedAt;
    }
  })();

  if (isHealthy) {
    return (
      <div
        data-testid="reports-alerts-healthy"
        className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-200 text-xs shadow-sm"
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/80 text-emerald-600 dark:text-emerald-300 font-bold text-xs">
            ✓
          </span>
          <div>
            <span className="font-semibold text-emerald-950 dark:text-emerald-100">
              Sin anomalías operativas detectadas
            </span>
            <span className="text-emerald-700 dark:text-emerald-400 ml-2 hidden sm:inline">
              Base de datos, Redis, outbox y canales operan dentro de umbrales normales.
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
            {formattedDate}
          </span>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              title="Volver a evaluar alertas"
              className="p-1 rounded text-emerald-700 dark:text-emerald-400 hover:text-emerald-950 dark:hover:text-emerald-100 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40 transition-colors"
            >
              🔄
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="reports-alerts-banner"
      className={`rounded-xl border p-4 shadow-sm transition-colors ${
        hasCritical
          ? "border-rose-300 dark:border-rose-900/70 bg-rose-50/70 dark:bg-rose-950/30 text-rose-950 dark:text-rose-100"
          : "border-amber-300 dark:border-amber-900/70 bg-amber-50/70 dark:bg-amber-950/30 text-amber-950 dark:text-amber-100"
      }`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-rose-200/80 dark:border-rose-900/50">
        <div className="flex items-center gap-2.5">
          <span className="text-lg" aria-hidden="true">
            {hasCritical ? "🚨" : "⚠️"}
          </span>
          <div>
            <h3 className="text-sm font-bold">
              {hasCritical
                ? "Anomalías operativas críticas detectadas"
                : "Advertencias operativas detectadas"}
            </h3>
            <p className="text-xs opacity-90">
              Se detectaron {summary.total} condición(es) que superan los umbrales de seguridad.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {summary.critical > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-200/80 dark:bg-rose-900/80 text-rose-900 dark:text-rose-100 border border-rose-300 dark:border-rose-700">
              {summary.critical} Crítica(s)
            </span>
          )}
          {summary.warning > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-200/80 dark:bg-amber-900/80 text-amber-900 dark:text-amber-100 border border-amber-300 dark:border-amber-700">
              {summary.warning} Advertencia(s)
            </span>
          )}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              title="Volver a evaluar alertas"
              className="ml-2 px-2.5 py-1 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-xs"
            >
              {loading ? "Evaluando…" : "Reevaluar"}
            </button>
          )}
        </div>
      </div>

      {/* Alerts list */}
      <div className="mt-3 space-y-2.5">
        {activeAlerts.map((alert: OperationalAnomalyAlert) => {
          const isCrit = alert.severity === "critical";
          return (
            <div
              key={alert.id}
              data-testid={`alert-item-${alert.code.toLowerCase()}`}
              className={`p-3 rounded-lg border text-xs ${
                isCrit
                  ? "bg-rose-100/70 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800/80 text-rose-950 dark:text-rose-100"
                  : "bg-amber-100/70 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/80 text-amber-950 dark:text-amber-100"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-semibold uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded ${
                      isCrit
                        ? "bg-rose-600 text-white font-bold"
                        : "bg-amber-600 text-white font-bold"
                    }`}
                  >
                    {alert.severity}
                  </span>
                  <span className="font-bold text-sm">{alert.title}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] font-mono opacity-80">
                  <span>Valor: {String(alert.metricValue)}</span>
                  <span>|</span>
                  <span>Umbral: {String(alert.thresholdValue)}</span>
                </div>
              </div>

              <p className="mt-1 leading-relaxed">{alert.message}</p>
              <p className="mt-1.5 font-medium opacity-90 text-[11px]">
                💡 {getRemediationAdvice(alert.code)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
