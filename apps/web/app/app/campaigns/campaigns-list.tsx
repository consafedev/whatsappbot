"use client";

import { useState } from "react";
import {
  type CampaignListItem,
  calculateProgress,
  formatCampaignStatus,
} from "./campaigns-view-model";

type CampaignsListProps = Readonly<{
  campaigns: readonly CampaignListItem[];
  loading: boolean;
  canManage: boolean;
  onStart: (campaignId: string) => Promise<void>;
  onPause: (campaignId: string) => Promise<void>;
  onCancel: (campaignId: string) => Promise<void>;
  onPopulate: (campaignId: string) => Promise<void>;
}>;

export function CampaignsList({
  campaigns,
  loading,
  canManage,
  onStart,
  onPause,
  onCancel,
  onPopulate,
}: CampaignsListProps) {
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mb-2" />
        <p className="text-sm text-slate-500 dark:text-slate-400">Cargando campañas...</p>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center text-xl mb-3">
          📢
        </div>
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          No hay campañas disponibles
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1">
          No se encontraron campañas con los filtros aplicados. Puedes crear tu primera campaña
          masiva haciendo clic en "+ Nueva Campaña".
        </p>
      </div>
    );
  }

  async function handleAction(campaignId: string, actionFn: (id: string) => Promise<void>) {
    setActionLoadingId(campaignId);
    try {
      await actionFn(campaignId);
    } finally {
      setActionLoadingId(null);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider">
              <th className="px-6 py-3.5">Campaña</th>
              <th className="px-6 py-3.5">Estado</th>
              <th className="px-6 py-3.5">Progreso de Envío</th>
              <th className="px-6 py-3.5">Métricas</th>
              <th className="px-6 py-3.5">Velocidad</th>
              <th className="px-6 py-3.5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {campaigns.map((camp) => {
              const statusDetails = formatCampaignStatus(camp.status);
              const progressPct = calculateProgress(camp.sentCount, camp.totalRecipients);
              const isActionLoading = actionLoadingId === camp.id;

              return (
                <tr
                  key={camp.id}
                  className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                >
                  {/* Campaign Name & Details */}
                  <td className="px-6 py-4">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {camp.name}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      Canal:{" "}
                      {camp.channelDisplayName ??
                        camp.channelAccount?.displayName ??
                        camp.channelAccountId.substring(0, 8)}{" "}
                      • Creada{" "}
                      {new Date(camp.createdAt).toLocaleDateString("es-MX", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </div>
                  </td>

                  {/* Status Badge */}
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusDetails.className}`}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: statusDetails.dotColor }}
                      />
                      {statusDetails.label}
                    </span>
                  </td>

                  {/* Progress Bar */}
                  <td className="px-6 py-4 min-w-[200px]">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {camp.sentCount} / {camp.totalRecipients}
                      </span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {progressPct}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-emerald-500 h-2 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </td>

                  {/* Delivery Metrics Counts */}
                  <td className="px-6 py-4 text-xs text-slate-600 dark:text-slate-400">
                    <div className="flex gap-2">
                      <span title="Entregados" className="text-sky-600 dark:text-sky-400">
                        ✓✓ {camp.deliveredCount}
                      </span>
                      <span title="Leídos" className="text-emerald-600 dark:text-emerald-400">
                        👁 {camp.readCount ?? "—"}
                      </span>
                      {camp.failedCount > 0 && (
                        <span
                          title="Fallidos"
                          className="text-rose-600 dark:text-rose-400 font-medium"
                        >
                          ✕ {camp.failedCount}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Rate Limit */}
                  <td className="px-6 py-4 text-xs text-slate-500 dark:text-slate-400 font-mono">
                    {camp.rateLimitPerMinute} /min
                  </td>

                  {/* Actions Column */}
                  <td className="px-6 py-4 text-right">
                    {canManage ? (
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        {/* DRAFT Actions */}
                        {camp.status === "DRAFT" && (
                          <>
                            {camp.totalRecipients === 0 ? (
                              <button
                                type="button"
                                disabled={isActionLoading}
                                onClick={() => handleAction(camp.id, onPopulate)}
                                className="px-2.5 py-1 text-xs font-medium rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-900/50"
                              >
                                Poblar Audiencia
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={isActionLoading}
                                onClick={() => handleAction(camp.id, onStart)}
                                className="px-2.5 py-1 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
                              >
                                Iniciar
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={isActionLoading}
                              onClick={() => handleAction(camp.id, onCancel)}
                              className="px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                            >
                              Cancelar
                            </button>
                          </>
                        )}

                        {/* RUNNING Actions */}
                        {camp.status === "RUNNING" && (
                          <>
                            <button
                              type="button"
                              disabled={isActionLoading}
                              onClick={() => handleAction(camp.id, onPause)}
                              className="px-2.5 py-1 text-xs font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 shadow-sm"
                            >
                              Pausar
                            </button>
                            <button
                              type="button"
                              disabled={isActionLoading}
                              onClick={() => handleAction(camp.id, onCancel)}
                              className="px-2.5 py-1 text-xs font-medium rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                            >
                              Cancelar
                            </button>
                          </>
                        )}

                        {/* PAUSED Actions */}
                        {camp.status === "PAUSED" && (
                          <>
                            <button
                              type="button"
                              disabled={isActionLoading}
                              onClick={() => handleAction(camp.id, onStart)}
                              className="px-2.5 py-1 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
                            >
                              Reanudar
                            </button>
                            <button
                              type="button"
                              disabled={isActionLoading}
                              onClick={() => handleAction(camp.id, onCancel)}
                              className="px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                            >
                              Cancelar
                            </button>
                          </>
                        )}

                        {/* COMPLETED / CANCELLED / FAILED: Read-only label */}
                        {(camp.status === "COMPLETED" ||
                          camp.status === "CANCELLED" ||
                          camp.status === "FAILED") && (
                          <span className="text-xs text-slate-400 italic">Finalizada</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Solo lectura</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
