"use client";

import { useState } from "react";
import {
  formatKeywordsOutput,
  parseKeywordsInput,
  type TenantAiAgentConfig,
  type UpdateAiAgentConfigInput,
  updateAiAgentConfig,
} from "./ai-view-model";

type AiAgentSettingsTabProps = Readonly<{
  apiBaseUrl: string;
  config: TenantAiAgentConfig;
  onSaved: (updated: TenantAiAgentConfig) => void;
  showToast: (msg: string) => void;
}>;

export function AiAgentSettingsTab({
  apiBaseUrl,
  config,
  onSaved,
  showToast,
}: AiAgentSettingsTabProps) {
  const [isEnabled, setIsEnabled] = useState(config.isEnabled);
  const [automationMode, setAutomationMode] = useState<
    "RULES_ONLY" | "HYBRID_RULES_AI" | "FULL_AI"
  >(config.automationMode);
  const [systemDirectives, setSystemDirectives] = useState(config.systemDirectives ?? "");
  const [virtualAliasKey, setVirtualAliasKey] = useState(config.virtualAliasKey);
  const [minConfidenceScore, setMinConfidenceScore] = useState(config.minConfidenceScore);
  const [keywordsText, setKeywordsText] = useState(
    formatKeywordsOutput(config.humanHandoffKeywords),
  );
  const [outOfHoursReply, setOutOfHoursReply] = useState(config.outOfHoursReply ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedKeywords = parseKeywordsInput(keywordsText);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload: UpdateAiAgentConfigInput = {
        isEnabled,
        automationMode,
        systemDirectives: systemDirectives.trim() || null,
        virtualAliasKey: virtualAliasKey.trim() || "platform-smart",
        minConfidenceScore,
        humanHandoffKeywords: parsedKeywords,
        outOfHoursReply: outOfHoursReply.trim() || null,
      };

      const updated = await updateAiAgentConfig(apiBaseUrl, payload);
      onSaved(updated);
      showToast("Configuración del agente guardada correctamente");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar configuración");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-4xl">
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Main Activation Toggle */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Estado del Agente Autónomo
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Habilita o deshabilita la intervención del bot de IA en las conversaciones entrantes
              de WhatsApp.
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-indigo-600"></div>
          </label>
        </div>
      </div>

      {/* Automation Mode Selection */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Modo de Automatización y Coexistencia
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Define la prioridad entre el motor determinista de reglas y el agente generativo de IA.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <label
            className={`flex flex-col p-4 rounded-xl border cursor-pointer transition-colors ${
              automationMode === "HYBRID_RULES_AI"
                ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20"
                : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
            }`}
          >
            <div className="flex items-center gap-2">
              <input
                type="radio"
                name="automationMode"
                value="HYBRID_RULES_AI"
                checked={automationMode === "HYBRID_RULES_AI"}
                onChange={() => setAutomationMode("HYBRID_RULES_AI")}
                className="text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Híbrido (Recomendado)
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              Evalúa primero las reglas deterministas. Si ninguna regla envía un mensaje, la IA
              responde con RAG.
            </p>
          </label>

          <label
            className={`flex flex-col p-4 rounded-xl border cursor-pointer transition-colors ${
              automationMode === "FULL_AI"
                ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20"
                : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
            }`}
          >
            <div className="flex items-center gap-2">
              <input
                type="radio"
                name="automationMode"
                value="FULL_AI"
                checked={automationMode === "FULL_AI"}
                onChange={() => setAutomationMode("FULL_AI")}
                className="text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                IA Completa
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              El agente de IA atiende todas las consultas de los clientes que no estén tomadas por
              un operador.
            </p>
          </label>

          <label
            className={`flex flex-col p-4 rounded-xl border cursor-pointer transition-colors ${
              automationMode === "RULES_ONLY"
                ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20"
                : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
            }`}
          >
            <div className="flex items-center gap-2">
              <input
                type="radio"
                name="automationMode"
                value="RULES_ONLY"
                checked={automationMode === "RULES_ONLY"}
                onChange={() => setAutomationMode("RULES_ONLY")}
                className="text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Solo Reglas
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              Desactiva las respuestas generativas de IA y opera exclusivamente con automatizaciones
              deterministas.
            </p>
          </label>
        </div>
      </div>

      {/* Directives & Personality */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Personalidad y Directivas del Asistente
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Instrucciones persistentes inyectadas en el prompt de sistema para controlar el tono,
          restricciones y directrices de atención.
        </p>

        <div>
          <label
            htmlFor="system-directives"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
          >
            Directivas del Sistema
          </label>
          <textarea
            id="system-directives"
            rows={4}
            value={systemDirectives}
            onChange={(e) => setSystemDirectives(e.target.value)}
            placeholder="ej. Eres un asistente servicial y empático de atención al cliente. Sé breve, profesional y no inventes precios..."
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div>
            <label
              htmlFor="virtual-alias"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Alias Virtual de Enrutamiento
            </label>
            <input
              id="virtual-alias"
              type="text"
              value={virtualAliasKey}
              onChange={(e) => setVirtualAliasKey(e.target.value)}
              placeholder="platform-smart"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Clave de enrutamiento resiliente (ej. platform-smart, platform-fast).
            </p>
          </div>

          <div>
            <label
              htmlFor="confidence-score"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Umbral Mínimo de Similitud RAG: {(minConfidenceScore * 100).toFixed(0)}%
            </label>
            <input
              id="confidence-score"
              type="range"
              min={0.5}
              max={0.95}
              step={0.05}
              value={minConfidenceScore}
              onChange={(e) => setMinConfidenceScore(Number.parseFloat(e.target.value))}
              className="w-full accent-indigo-600 cursor-pointer mt-2"
            />
            <div className="flex justify-between text-xs text-slate-400 mt-1">
              <span>50% (Permisivo)</span>
              <span>70% (Óptimo)</span>
              <span>95% (Estricto)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Human Handoff Triggers */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Traspaso a Operador Humano (Human Handoff)
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Si el contacto escribe alguna de estas palabras clave, el bot transfiere inmediatamente la
          conversación a un asesor humano y detiene las respuestas de IA.
        </p>

        <div>
          <label
            htmlFor="handoff-keywords"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
          >
            Palabras Clave de Traspaso (separadas por coma)
          </label>
          <input
            id="handoff-keywords"
            type="text"
            value={keywordsText}
            onChange={(e) => setKeywordsText(e.target.value)}
            placeholder="humano, asesor, persona, agente, ayuda"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {parsedKeywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {parsedKeywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center rounded-md bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300"
                >
                  {kw}
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <label
            htmlFor="out-of-hours"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
          >
            Respuesta Fuera de Horario (Opcional)
          </label>
          <textarea
            id="out-of-hours"
            rows={2}
            value={outOfHoursReply}
            onChange={(e) => setOutOfHoursReply(e.target.value)}
            placeholder="ej. En este momento estamos fuera de horario. Nuestro equipo te responderá a primera hora."
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 transition-colors"
        >
          {submitting ? "Guardando..." : "Guardar Configuración"}
        </button>
      </div>
    </form>
  );
}
