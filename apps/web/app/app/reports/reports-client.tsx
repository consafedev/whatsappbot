"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTenantAppBootstrap } from "../tenant-app-shell";
import { ReportsKpiCards } from "./reports-kpi-cards";
import { ReportsTimeSeriesChart } from "./reports-time-series-chart";
import {
  type DatePresetKey,
  fetchMessageTimeSeries,
  fetchOperationalOverview,
  type MessageTimeSeriesData,
  resolveDatePreset,
  type TenantOperationalOverview,
} from "./reports-view-model";

type ReportsClientProps = Readonly<{
  apiBaseUrl?: string | undefined;
}>;

const PRESET_OPTIONS: ReadonlyArray<{ key: DatePresetKey; label: string }> = Object.freeze([
  { key: "7d", label: "Últimos 7 días" },
  { key: "30d", label: "Últimos 30 días" },
  { key: "this_month", label: "Este mes" },
  { key: "custom", label: "Personalizado" },
]);

function toDateInputFormat(isoString: string): string {
  if (!isoString) return "";
  try {
    return isoString.slice(0, 10);
  } catch {
    return "";
  }
}

export function ReportsClient({ apiBaseUrl }: ReportsClientProps) {
  const bootstrap = useTenantAppBootstrap();
  const base = (
    apiBaseUrl ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://localhost:3001"
  ).replace(/\/$/, "");

  const hasReportsModule = bootstrap.effectiveModules.includes("module.reports");
  const canReadReports = bootstrap.effectivePermissions.includes("reports.read");

  // Date range state
  const [selectedPreset, setSelectedPreset] = useState<DatePresetKey>("7d");
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>(() =>
    resolveDatePreset("7d"),
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  // Time-series interval
  const [interval, setInterval] = useState<"day" | "hour">("day");

  // Analytics data state
  const [overview, setOverview] = useState<TenantOperationalOverview | null>(null);
  const [timeSeries, setTimeSeries] = useState<MessageTimeSeriesData | null>(null);

  // Status flags
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch data
  const loadReportsData = useCallback(
    async (isManualRefresh = false) => {
      if (!hasReportsModule || !canReadReports) return;

      const fromTime = new Date(dateRange.from).getTime();
      const toTime = new Date(dateRange.to).getTime();

      if (Number.isNaN(fromTime) || Number.isNaN(toTime)) {
        setValidationError("Por favor ingresa fechas válidas.");
        return;
      }

      if (fromTime > toTime) {
        setValidationError("La fecha inicial no puede ser posterior a la fecha final.");
        return;
      }

      setValidationError(null);

      if (isManualRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const [overviewData, timeSeriesData] = await Promise.all([
          fetchOperationalOverview(base, { from: dateRange.from, to: dateRange.to }),
          fetchMessageTimeSeries(base, { from: dateRange.from, to: dateRange.to, interval }),
        ]);

        setOverview(overviewData);
        setTimeSeries(timeSeriesData);
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Error al cargar los reportes operacionales.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [base, canReadReports, dateRange.from, dateRange.to, hasReportsModule, interval],
  );

  // Initial load and reload when date range or interval changes
  useEffect(() => {
    if (!hasReportsModule || !canReadReports) {
      setLoading(false);
      return;
    }
    loadReportsData();
  }, [hasReportsModule, canReadReports, loadReportsData]);

  // Handle preset change
  const handlePresetSelect = (preset: DatePresetKey) => {
    setSelectedPreset(preset);
    if (preset !== "custom") {
      const newRange = resolveDatePreset(preset);
      setDateRange(newRange);
      setValidationError(null);
    }
  };

  // Handle manual date inputs
  const handleFromDateChange = (val: string) => {
    if (!val) return;
    const newFrom = new Date(`${val}T00:00:00.000Z`).toISOString();
    setSelectedPreset("custom");
    setDateRange((prev) => ({ ...prev, from: newFrom }));
  };

  const handleToDateChange = (val: string) => {
    if (!val) return;
    const newTo = new Date(`${val}T23:59:59.999Z`).toISOString();
    setSelectedPreset("custom");
    setDateRange((prev) => ({ ...prev, to: newTo }));
  };

  // Unauthorized or module missing gating
  if (!hasReportsModule || !canReadReports) {
    return (
      <div className="p-8 max-w-4xl mx-auto" data-testid="reports-unauthorized">
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 p-6 text-center shadow-sm">
          <span className="text-4xl mb-3 inline-block" aria-hidden="true">
            🔒
          </span>
          <h2 className="text-lg font-semibold text-amber-900 dark:text-amber-200">
            Acceso no autorizado o módulo no contratado
          </h2>
          <p className="text-sm text-amber-700 dark:text-amber-400 mt-2 max-w-md mx-auto">
            {!hasReportsModule
              ? "El módulo de Reportes y Analíticas (module.reports) no está habilitado para este tenant."
              : "No cuentas con el permiso requerido (reports.read) para visualizar métricas operativas."}
          </p>
          <div className="mt-5">
            <Link
              href="/app"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
            >
              ← Ir al inicio
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="reports-client-container">
      {/* Top Header & Range Selection */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Reportes y Analíticas
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Métricas operativas consolidadas, volumen de mensajería y consumo de IA.
          </p>
        </div>

        {/* Date Controls & Refresh */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Presets */}
          <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            {PRESET_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => handlePresetSelect(opt.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  selectedPreset === opt.key
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Date Picker Inputs */}
          <div className="flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
              <span>Desde:</span>
              <input
                type="date"
                value={toDateInputFormat(dateRange.from)}
                onChange={(e) => handleFromDateChange(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
              <span>Hasta:</span>
              <input
                type="date"
                value={toDateInputFormat(dateRange.to)}
                onChange={(e) => handleToDateChange(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </label>
          </div>

          {/* Live Refresh Button */}
          <button
            type="button"
            onClick={() => loadReportsData(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            title="Actualizar métricas"
          >
            <span
              className={`inline-block ${refreshing || loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            >
              🔄
            </span>
            <span>{refreshing ? "Actualizando..." : "Actualizar"}</span>
          </button>
        </div>
      </div>

      {/* Validation Error Banner */}
      {validationError && (
        <div
          className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/20 p-4 text-xs text-rose-800 dark:text-rose-300 flex items-center justify-between"
          data-testid="reports-validation-error"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden="true">⚠️</span>
            <span>{validationError}</span>
          </div>
          <button
            type="button"
            onClick={() => handlePresetSelect("7d")}
            className="text-xs font-semibold underline hover:no-underline"
          >
            Restablecer a últimos 7 días
          </button>
        </div>
      )}

      {/* API Error Banner */}
      {error && (
        <div
          className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/20 p-4 text-xs text-rose-800 dark:text-rose-300 flex items-center justify-between"
          data-testid="reports-api-error"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden="true">⚠️</span>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => loadReportsData(false)}
            className="px-3 py-1 rounded bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 transition-colors"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* KPI Cards Section */}
      <ReportsKpiCards overview={overview} loading={loading} />

      {/* Time-Series Chart Section */}
      <ReportsTimeSeriesChart
        timeSeries={timeSeries}
        interval={interval}
        onIntervalChange={setInterval}
        loading={loading}
      />
    </div>
  );
}
