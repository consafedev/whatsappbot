"use client";

import { type CampaignMetrics, calculateFunnelStepPercentage } from "../campaigns-view-model";

type CampaignFunnelViewProps = Readonly<{
  metrics: CampaignMetrics | null;
  loading: boolean;
}>;

const SKELETON_KEYS = ["funnel-skel-1", "funnel-skel-2", "funnel-skel-3", "funnel-skel-4"];

export function CampaignFunnelView({ metrics, loading }: CampaignFunnelViewProps) {
  if (loading || !metrics) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm animate-pulse">
        <div className="h-5 w-48 bg-slate-200 dark:bg-slate-800 rounded mb-4" />
        <div className="space-y-4">
          {SKELETON_KEYS.map((key) => (
            <div key={key} className="h-14 bg-slate-100 dark:bg-slate-800/60 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // Funnel calculations
  const total = metrics.totalRecipients;
  const sentPct = calculateFunnelStepPercentage(metrics.sentCount, total);
  const deliveredPct = calculateFunnelStepPercentage(metrics.deliveredCount, metrics.sentCount);
  const readPct = calculateFunnelStepPercentage(metrics.readCount, metrics.deliveredCount);

  // Retention from top of funnel (overall conversion)
  const overallDeliveredPct = calculateFunnelStepPercentage(metrics.deliveredCount, total);
  const overallReadPct = calculateFunnelStepPercentage(metrics.readCount, total);

  const steps = [
    {
      id: "total",
      label: "1. Audiencia Total",
      sublabel: "Destinatarios seleccionados en la campaña",
      count: total,
      stepPercentage: 100,
      overallPercentage: 100,
      color: "bg-slate-700 dark:bg-slate-300",
      barColor: "bg-slate-500",
      icon: "👥",
    },
    {
      id: "sent",
      label: "2. Mensajes Despachados",
      sublabel: `${sentPct}% de la audiencia enviada`,
      count: metrics.sentCount,
      stepPercentage: sentPct,
      overallPercentage: sentPct,
      color: "bg-blue-600 dark:bg-blue-400",
      barColor: "bg-blue-500",
      icon: "📤",
    },
    {
      id: "delivered",
      label: "3. Entregas Confirmadas",
      sublabel: `${deliveredPct}% de los enviados recibidos por el usuario`,
      count: metrics.deliveredCount,
      stepPercentage: deliveredPct,
      overallPercentage: overallDeliveredPct,
      color: "bg-indigo-600 dark:bg-indigo-400",
      barColor: "bg-indigo-500",
      icon: "✓✓",
    },
    {
      id: "read",
      label: "4. Lecturas Registradas",
      sublabel: `${readPct}% de los entregados leídos (doble check azul)`,
      count: metrics.readCount,
      stepPercentage: readPct,
      overallPercentage: overallReadPct,
      color: "bg-emerald-600 dark:bg-emerald-400",
      barColor: "bg-emerald-500",
      icon: "👁",
    },
  ];

  return (
    <div
      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm"
      data-testid="campaign-funnel"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-5 border-b border-slate-200 dark:border-slate-800 gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>Embudo de Conversión y Entrega</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium">
              WhatsApp Direct
            </span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Seguimiento escalonado del ciclo de vida del mensaje desde el despacho hasta la lectura
          </p>
        </div>

        {/* Lateral counters */}
        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs">
            <span className="text-amber-700 dark:text-amber-300 font-semibold">
              {metrics.pendingCount.toLocaleString()}
            </span>{" "}
            <span className="text-amber-600 dark:text-amber-400">en cola</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs">
            <span className="text-rose-700 dark:text-rose-300 font-semibold">
              {metrics.failedCount.toLocaleString()}
            </span>{" "}
            <span className="text-rose-600 dark:text-rose-400">
              fallidos ({metrics.failureRate}%)
            </span>
          </div>
        </div>
      </div>

      {/* Visual Funnel Steps */}
      <div className="mt-6 space-y-4">
        {steps.map((step, idx) => (
          <div
            key={step.id}
            className="p-4 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-950/40 hover:bg-slate-50 dark:hover:bg-slate-950/70 transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-md bg-white dark:bg-slate-800 shadow-xs border border-slate-200 dark:border-slate-700 flex items-center justify-center text-xs">
                  {step.icon}
                </span>
                <div>
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {step.label}
                  </span>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{step.sublabel}</p>
                </div>
              </div>

              <div className="text-right">
                <div className="flex items-baseline justify-end gap-1.5">
                  <span className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {step.count.toLocaleString()}
                  </span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                    {step.stepPercentage}%
                  </span>
                </div>
                {idx > 0 && (
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                    {step.overallPercentage}% del total inicial
                  </p>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-2.5 rounded-full ${step.barColor} transition-all duration-500`}
                style={{ width: `${Math.max(step.overallPercentage, 1)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
