"use client";

import { useCallback, useEffect, useState } from "react";
import { useTenantAppBootstrap } from "../tenant-app-shell";
import { AiAgentSettingsTab } from "./ai-agent-settings-tab";
import { AiKnowledgeTab } from "./ai-knowledge-tab";
import { AiUsageTab } from "./ai-usage-tab";
import { fetchAiAgentConfig, type TenantAiAgentConfig } from "./ai-view-model";

type TabId = "agent" | "knowledge" | "usage";

type AiClientProps = Readonly<{
  apiBaseUrl?: string | undefined;
}>;

export function AiClient({ apiBaseUrl }: AiClientProps) {
  const bootstrap = useTenantAppBootstrap();
  const base = apiBaseUrl ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

  const hasAiModule = bootstrap.effectiveModules.includes("module.ai");
  const hasManagePermission = bootstrap.effectivePermissions.includes("ai.settings.manage");

  const [activeTab, setActiveTab] = useState<TabId>("agent");
  const [config, setConfig] = useState<TenantAiAgentConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  const loadConfig = useCallback(async () => {
    if (!hasAiModule || !hasManagePermission) return;
    setLoadingConfig(true);
    setError(null);
    try {
      const data = await fetchAiAgentConfig(base);
      setConfig(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar configuración del agente");
    } finally {
      setLoadingConfig(false);
    }
  }, [base, hasAiModule, hasManagePermission]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  if (!hasAiModule) {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-600 flex items-center justify-center text-xl font-bold">
          !
        </div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Módulo de Inteligencia Artificial No Contratado
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Tu organización no cuenta con el módulo{" "}
          <code className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">
            module.ai
          </code>{" "}
          activado. Contacta al administrador de la plataforma para habilitar las funcionalidades de
          agente autónomo y base de conocimiento.
        </p>
      </div>
    );
  }

  if (!hasManagePermission) {
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
            ai.settings.manage
          </code>{" "}
          para administrar el agente de IA y la base de conocimiento.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          Consola de Inteligencia Artificial
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Gestiona las directivas del agente autónomo de WhatsApp, administra la base de
          conocimiento vectorial RAG y supervisa el consumo de tokens.
        </p>
      </div>

      {/* Toast alert */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 rounded-xl bg-slate-900 text-white px-4 py-3 shadow-xl text-sm flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
          <span>✓</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="border-b border-slate-200 dark:border-slate-800">
        <nav className="flex space-x-8" aria-label="Pestañas de IA">
          <button
            type="button"
            onClick={() => setActiveTab("agent")}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === "agent"
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            Agente Autónomo
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("knowledge")}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === "knowledge"
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            Base de Conocimiento
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("usage")}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === "usage"
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            Consumo y Costos
          </button>
        </nav>
      </div>

      {/* Tab Contents */}
      {activeTab === "agent" && (
        <>
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          )}
          {loadingConfig ? (
            <div className="p-12 text-center text-sm text-slate-500">
              Cargando configuración del agente...
            </div>
          ) : config ? (
            <AiAgentSettingsTab
              apiBaseUrl={base}
              config={config}
              onSaved={(updated) => setConfig(updated)}
              showToast={showToast}
            />
          ) : null}
        </>
      )}

      {activeTab === "knowledge" && <AiKnowledgeTab apiBaseUrl={base} showToast={showToast} />}

      {activeTab === "usage" && <AiUsageTab apiBaseUrl={base} />}
    </div>
  );
}
