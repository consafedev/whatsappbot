"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTenantAppBootstrap } from "../../tenant-app-shell";
import {
  type CampaignAudienceMemberItem,
  type CampaignDetail,
  type CampaignMetrics,
  fetchCampaignAudience,
  fetchCampaignDetail,
  fetchCampaignMetrics,
  formatCampaignStatus,
} from "../campaigns-view-model";
import { CampaignAudienceTable } from "./campaign-audience-table";
import { CampaignFunnelView } from "./campaign-funnel-view";
import { CampaignKpiCards } from "./campaign-kpi-cards";

type CampaignAnalyticsClientProps = Readonly<{
  campaignId: string;
  apiBaseUrl?: string | undefined;
}>;

export function CampaignAnalyticsClient({ campaignId, apiBaseUrl }: CampaignAnalyticsClientProps) {
  const bootstrap = useTenantAppBootstrap();
  const base = apiBaseUrl || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

  const hasCampaignsModule = bootstrap.effectiveModules.includes("module.campaigns");
  const canReadCampaigns = bootstrap.effectivePermissions.includes("campaigns.read");

  // State
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [metrics, setMetrics] = useState<CampaignMetrics | null>(null);
  const [audience, setAudience] = useState<readonly CampaignAudienceMemberItem[]>([]);
  const [audienceTotal, setAudienceTotal] = useState(0);

  const [loading, setLoading] = useState(true);
  const [loadingAudience, setLoadingAudience] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Audience filters and pagination
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  // Load campaign & metrics
  const loadOverview = useCallback(async () => {
    if (!hasCampaignsModule || !canReadCampaigns) return;
    try {
      const [campaignData, metricsData] = await Promise.all([
        fetchCampaignDetail(base, campaignId),
        fetchCampaignMetrics(base, campaignId),
      ]);
      setCampaign(campaignData);
      setMetrics(metricsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar métricas de la campaña");
    }
  }, [base, campaignId, hasCampaignsModule, canReadCampaigns]);

  // Load audience members
  const loadAudience = useCallback(async () => {
    if (!hasCampaignsModule || !canReadCampaigns) return;
    setLoadingAudience(true);
    try {
      const result = await fetchCampaignAudience(base, campaignId, {
        status: statusFilter === "ALL" ? undefined : statusFilter,
        limit,
        offset,
      });
      setAudience(result.members);
      setAudienceTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar la audiencia de la campaña");
    } finally {
      setLoadingAudience(false);
    }
  }, [base, campaignId, hasCampaignsModule, canReadCampaigns, statusFilter, offset]);

  // Initial load
  useEffect(() => {
    if (!hasCampaignsModule || !canReadCampaigns) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    Promise.all([loadOverview(), loadAudience()]).finally(() => {
      setLoading(false);
    });
  }, [hasCampaignsModule, canReadCampaigns, loadOverview, loadAudience]);

  // Handle manual refresh
  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    await Promise.all([loadOverview(), loadAudience()]);
    setRefreshing(false);
  };

  // Status filter change
  const handleStatusFilterChange = (newStatus: string) => {
    setStatusFilter(newStatus);
    setOffset(0);
  };

  // Pagination change
  const handlePageChange = (newOffset: number) => {
    setOffset(newOffset);
  };

  // Access check
  if (!hasCampaignsModule || !canReadCampaigns) {
    return (
      <div className="p-8 max-w-4xl mx-auto" data-testid="campaign-analytics-unauthorized">
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 p-6 text-center">
          <span className="text-4xl mb-3 inline-block">🔒</span>
          <h2 className="text-lg font-semibold text-amber-900 dark:text-amber-200">
            Acceso no autorizado o módulo no activo
          </h2>
          <p className="text-sm text-amber-700 dark:text-amber-400 mt-2 max-w-md mx-auto">
            {!hasCampaignsModule
              ? "El módulo de Campañas no está habilitado para este tenant."
              : "No cuentas con los permisos requeridos (campaigns.read) para ver métricas de campañas."}
          </p>
          <div className="mt-4">
            <Link
              href="/app/campaigns"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              ← Volver al listado
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const statusBadge = campaign ? formatCampaignStatus(campaign.status) : null;

  return (
    <div className="space-y-6" data-testid="campaign-analytics-container">
      {/* Navigation & Header */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Link
            href="/app/campaigns"
            className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
          >
            ← Campañas
          </Link>
          <span className="text-xs text-slate-400">/</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">Métricas y Embudo</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {campaign ? campaign.name : "Cargando campaña..."}
              </h1>
              {statusBadge && (
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusBadge.className}`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: statusBadge.dotColor }}
                  />
                  {statusBadge.label}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <span>
                ID: <code className="font-mono text-[11px]">{campaignId}</code>
              </span>
              {campaign?.channelAccountId && (
                <>
                  <span>•</span>
                  <span>
                    Canal:{" "}
                    <code className="font-mono text-[11px]">{campaign.channelAccountId}</code>
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 shadow-xs transition-colors disabled:opacity-50"
            >
              <span className={refreshing ? "animate-spin" : ""}>🔄</span>
              <span>{refreshing ? "Actualizando..." : "Actualizar"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Global Error Banner */}
      {error && (
        <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-200 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs font-semibold hover:underline"
          >
            Descartar
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <CampaignKpiCards metrics={metrics} loading={loading} />

      {/* Conversion Funnel */}
      <CampaignFunnelView metrics={metrics} loading={loading} />

      {/* Audience Breakdown Table */}
      <CampaignAudienceTable
        audience={audience}
        total={audienceTotal}
        loading={loadingAudience}
        statusFilter={statusFilter}
        onStatusFilterChange={handleStatusFilterChange}
        offset={offset}
        limit={limit}
        onPageChange={handlePageChange}
      />
    </div>
  );
}
