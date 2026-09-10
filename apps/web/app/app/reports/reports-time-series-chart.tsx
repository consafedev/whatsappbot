"use client";

import { useState } from "react";
import {
  formatNumber,
  type MessageTimeSeriesBucket,
  type MessageTimeSeriesData,
} from "./reports-view-model";

type ReportsTimeSeriesChartProps = Readonly<{
  timeSeries: MessageTimeSeriesData | null;
  interval: "day" | "hour";
  onIntervalChange: (interval: "day" | "hour") => void;
  loading: boolean;
}>;

const SKELETON_BARS: ReadonlyArray<{ id: string; height: number }> = Object.freeze([
  { id: "sk-1", height: 40 },
  { id: "sk-2", height: 65 },
  { id: "sk-3", height: 30 },
  { id: "sk-4", height: 85 },
  { id: "sk-5", height: 55 },
  { id: "sk-6", height: 90 },
  { id: "sk-7", height: 45 },
  { id: "sk-8", height: 70 },
  { id: "sk-9", height: 60 },
  { id: "sk-10", height: 80 },
]);

function formatBucketLabel(raw: string, interval: "day" | "hour"): string {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;

    if (interval === "hour") {
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      return `${hours}:${minutes}`;
    }

    const day = String(d.getDate()).padStart(2, "0");
    const monthNames = [
      "Ene",
      "Feb",
      "Mar",
      "Abr",
      "May",
      "Jun",
      "Jul",
      "Ago",
      "Sep",
      "Oct",
      "Nov",
      "Dic",
    ];
    const month = monthNames[d.getMonth()] ?? "";
    return `${day} ${month}`;
  } catch {
    return raw;
  }
}

function formatFullTimestamp(raw: string): string {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString("es-MX", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return raw;
  }
}

export function ReportsTimeSeriesChart({
  timeSeries,
  interval,
  onIntervalChange,
  loading,
}: ReportsTimeSeriesChartProps) {
  const [activeBucket, setActiveBucket] = useState<MessageTimeSeriesBucket | null>(null);

  const buckets = timeSeries?.buckets ?? [];
  const maxVal = Math.max(
    1,
    ...buckets.map((b) => Math.max(b.inboundCount, b.outboundCount, b.totalCount)),
  );

  return (
    <div
      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm"
      data-testid="reports-time-series-container"
    >
      {/* Header with Title, Interval controls, and Legend */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Tendencia de Volumen de Mensajes
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Distribución temporal de mensajes entrantes y salientes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Legend */}
          <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-400 mr-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" aria-hidden="true" />
              Entrantes
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500" aria-hidden="true" />
              Salientes
            </span>
          </div>

          {/* Interval Toggle Buttons */}
          <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => onIntervalChange("day")}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                interval === "day"
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              Por Día
            </button>
            <button
              type="button"
              onClick={() => onIntervalChange("hour")}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                interval === "hour"
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              Por Hora
            </button>
          </div>
        </div>
      </div>

      {/* Body: Chart or Loading or Empty State */}
      <div className="mt-6">
        {loading ? (
          <div className="h-64 flex items-end justify-between gap-2 px-6 pt-4 animate-pulse">
            {SKELETON_BARS.map((bar) => (
              <div
                key={bar.id}
                className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-t"
                style={{ height: `${bar.height}%` }}
              />
            ))}
          </div>
        ) : buckets.length === 0 ? (
          <div
            className="h-64 flex flex-col items-center justify-center text-center p-6"
            data-testid="reports-chart-empty"
          >
            <span className="text-3xl mb-2 text-slate-400" aria-hidden="true">
              📊
            </span>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              No hay datos para el período seleccionado
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
              No se registraron mensajes entrantes ni salientes en este rango de fechas.
            </p>
          </div>
        ) : (
          <div className="relative">
            {/* Active Tooltip Details Box */}
            <div
              className={`mb-3 p-2.5 rounded-lg border text-xs transition-opacity duration-150 ${
                activeBucket
                  ? "opacity-100 border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20"
                  : "opacity-0 pointer-events-none"
              }`}
            >
              {activeBucket && (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    📅 {formatFullTimestamp(activeBucket.bucket)}
                  </span>
                  <div className="flex items-center gap-4">
                    <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                      Entrantes: {formatNumber(activeBucket.inboundCount)}
                    </span>
                    <span className="text-indigo-700 dark:text-indigo-400 font-medium">
                      Salientes: {formatNumber(activeBucket.outboundCount)}
                    </span>
                    <span className="text-slate-700 dark:text-slate-300 font-bold">
                      Total: {formatNumber(activeBucket.totalCount)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Visual Column Bars with Y-Gridlines */}
            <div className="relative h-60 w-full flex items-end">
              {/* Horizontal Reference Gridlines */}
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none text-[10px] text-slate-400 dark:text-slate-500">
                <div className="border-b border-slate-100 dark:border-slate-800/80 w-full flex justify-between pr-2">
                  <span>{formatNumber(maxVal)}</span>
                </div>
                <div className="border-b border-slate-100 dark:border-slate-800/80 w-full flex justify-between pr-2">
                  <span>{formatNumber(Math.round(maxVal * 0.5))}</span>
                </div>
                <div className="border-b border-slate-200 dark:border-slate-700 w-full flex justify-between pr-2">
                  <span>0</span>
                </div>
              </div>

              {/* Bar columns container */}
              <div className="relative z-10 w-full h-full flex items-end gap-1.5 sm:gap-2 px-1">
                {buckets.map((b) => {
                  const inboundPct = Math.min((b.inboundCount / maxVal) * 100, 100);
                  const outboundPct = Math.min((b.outboundCount / maxVal) * 100, 100);
                  const isHovered = activeBucket?.bucket === b.bucket;

                  return (
                    <button
                      type="button"
                      key={b.bucket}
                      onMouseEnter={() => setActiveBucket(b)}
                      onMouseLeave={() => setActiveBucket(null)}
                      onFocus={() => setActiveBucket(b)}
                      onBlur={() => setActiveBucket(null)}
                      className={`flex-1 h-full flex flex-col justify-end items-center group cursor-pointer transition-transform bg-transparent border-none p-0 focus:outline-none ${
                        isHovered ? "scale-105" : ""
                      }`}
                      data-testid={`time-series-bucket-${b.bucket}`}
                      aria-label={`${formatFullTimestamp(b.bucket)}: ${b.inboundCount} entrantes, ${b.outboundCount} salientes`}
                    >
                      {/* Side by side grouped bars */}
                      <div className="w-full flex items-end justify-center gap-0.5 sm:gap-1 h-[88%] pointer-events-none">
                        {/* Inbound bar */}
                        <div
                          className="w-1/2 max-w-[14px] bg-emerald-500 hover:bg-emerald-600 dark:bg-emerald-500 dark:hover:bg-emerald-400 rounded-t transition-all duration-200"
                          style={{
                            height: b.inboundCount > 0 ? `${Math.max(inboundPct, 4)}%` : "0%",
                          }}
                          title={`Entrantes: ${b.inboundCount}`}
                        />
                        {/* Outbound bar */}
                        <div
                          className="w-1/2 max-w-[14px] bg-indigo-500 hover:bg-indigo-600 dark:bg-indigo-500 dark:hover:bg-indigo-400 rounded-t transition-all duration-200"
                          style={{
                            height: b.outboundCount > 0 ? `${Math.max(outboundPct, 4)}%` : "0%",
                          }}
                          title={`Salientes: ${b.outboundCount}`}
                        />
                      </div>

                      {/* X-axis label */}
                      <span className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-full text-center group-hover:font-semibold group-hover:text-slate-900 dark:group-hover:text-slate-100 pointer-events-none">
                        {formatBucketLabel(b.bucket, interval)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
