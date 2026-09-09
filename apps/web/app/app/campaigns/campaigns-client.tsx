"use client";

import { useCallback, useEffect, useState } from "react";
import { useTenantAppBootstrap } from "../tenant-app-shell";
import { CampaignWizardModal } from "./campaign-wizard-modal";
import { CampaignsList } from "./campaigns-list";
import {
  type CampaignListItem,
  cancelCampaign,
  fetchCampaigns,
  pauseCampaign,
  populateAudience,
  startCampaign,
} from "./campaigns-view-model";

type CampaignsClientProps = Readonly<{
  apiBaseUrl?: string | undefined;
}>;

export function CampaignsClient({ apiBaseUrl }: CampaignsClientProps) {
  const bootstrap = useTenantAppBootstrap();
  const base = apiBaseUrl || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

  const hasCampaignsModule = bootstrap.effectiveModules.includes("module.campaigns");
  const canReadCampaigns = bootstrap.effectivePermissions.includes("campaigns.read");
  const canManageCampaigns = bootstrap.effectivePermissions.includes("campaigns.manage");

  // State
  const [campaigns, setCampaigns] = useState<readonly CampaignListItem[]>([]);
  const [_total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  const loadCampaigns = useCallback(async () => {
    if (!hasCampaignsModule || !canReadCampaigns) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCampaigns(base, {
        status: statusFilter,
        limit: 50,
      });
      setCampaigns(data.campaigns);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar campañas");
    } finally {
      setLoading(false);
    }
  }, [base, hasCampaignsModule, canReadCampaigns, statusFilter]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  // Action handlers
  const handleStart = useCallback(
    async (campaignId: string) => {
      try {
        const updated = await startCampaign(base, campaignId);
        setCampaigns((prev) => prev.map((c) => (c.id === campaignId ? updated : c)));
        showToast("Campaña iniciada exitosamente.");
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Error al iniciar la campaña.");
      }
    },
    [base, showToast],
  );

  const handlePause = useCallback(
    async (campaignId: string) => {
      try {
        const updated = await pauseCampaign(base, campaignId);
        setCampaigns((prev) => prev.map((c) => (c.id === campaignId ? updated : c)));
        showToast("Campaña pausada exitosamente.");
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Error al pausar la campaña.");
      }
    },
    [base, showToast],
  );

  const handleCancel = useCallback(
    async (campaignId: string) => {
      try {
        const updated = await cancelCampaign(base, campaignId);
        setCampaigns((prev) => prev.map((c) => (c.id === campaignId ? updated : c)));
        showToast("Campaña cancelada exitosamente.");
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Error al cancelar la campaña.");
      }
    },
    [base, showToast],
  );

  const handlePopulate = useCallback(
    async (campaignId: string) => {
      try {
        const res = await populateAudience(base, campaignId);
        showToast(`Audiencia poblada con éxito: ${res.totalAdded} contactos segmentados.`);
        loadCampaigns();
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Error al poblar audiencia.");
      }
    },
    [base, showToast, loadCampaigns],
  );

  // Check module entitlement
  if (!hasCampaignsModule) {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-600 flex items-center justify-center text-xl font-bold">
          !
        </div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Módulo de Campañas No Contratado
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Tu organización no cuenta con el módulo{" "}
          <code className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">
            module.campaigns
          </code>{" "}
          activado. Contacta al administrador de la plataforma para habilitar el motor de campañas y
          envíos masivos.
        </p>
      </div>
    );
  }

  // Check read permission
  if (!canReadCampaigns) {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/40 text-rose-600 flex items-center justify-center text-xl font-bold">
          ✕
        </div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Permiso Insuficiente
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Requieres el permiso{" "}
          <code className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">
            campaigns.read
          </code>{" "}
          para visualizar y dar seguimiento a las campañas de mensajería.
        </p>
      </div>
    );
  }

  // Filter campaigns by search query locally
  const filteredCampaigns = campaigns.filter((camp) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return camp.name.toLowerCase().includes(q) || camp.id.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Campañas de Mensajería
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Diseña, segmenta y ejecuta transmisiones masivas y personalizadas de WhatsApp con
            control de velocidad.
          </p>
        </div>

        {canManageCampaigns && (
          <button
            type="button"
            onClick={() => setIsWizardOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 transition-colors self-start sm:self-auto"
          >
            <span>+</span> Nueva Campaña
          </button>
        )}
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 px-4 py-3 shadow-lg text-sm transition-all"
        >
          {toastMessage}
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex-1 max-w-sm">
          <input
            type="text"
            placeholder="Buscar por nombre de campaña..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="status-filter" className="text-xs font-semibold uppercase text-slate-500">
            Estado:
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="ALL">Todas las campañas</option>
            <option value="DRAFT">Borradores</option>
            <option value="SCHEDULED">Programadas</option>
            <option value="RUNNING">En ejecución</option>
            <option value="PAUSED">Pausadas</option>
            <option value="COMPLETED">Completadas</option>
            <option value="CANCELLED">Canceladas</option>
            <option value="FAILED">Fallidas</option>
          </select>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-950/40 p-4 text-sm text-rose-800 dark:text-rose-300 flex justify-between items-center">
          <span>{error}</span>
          <button
            type="button"
            onClick={loadCampaigns}
            className="underline font-medium hover:text-rose-900"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Campaigns List Component */}
      <CampaignsList
        campaigns={filteredCampaigns}
        loading={loading}
        canManage={canManageCampaigns}
        onStart={handleStart}
        onPause={handlePause}
        onCancel={handleCancel}
        onPopulate={handlePopulate}
      />

      {/* Campaign Creation Wizard Modal */}
      <CampaignWizardModal
        apiBaseUrl={base}
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onSuccess={() => loadCampaigns()}
        showToast={showToast}
      />
    </div>
  );
}
