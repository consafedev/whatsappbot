"use client";

import { useEffect, useState } from "react";
import {
  type CampaignChannelItem,
  type CampaignListItem,
  createCampaign,
  extractMustacheVariables,
  fetchChannelsForCampaigns,
  fetchMessageTemplates,
  type MessageTemplateItem,
  populateAudience,
} from "./campaigns-view-model";

type CampaignWizardModalProps = Readonly<{
  apiBaseUrl: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (campaign: CampaignListItem) => void;
  showToast: (msg: string) => void;
}>;

export function CampaignWizardModal({
  apiBaseUrl,
  isOpen,
  onClose,
  onSuccess,
  showToast,
}: CampaignWizardModalProps) {
  // Wizard steps: 1: General Info, 2: Message/Template, 3: Audience, 4: Rate & Review
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Form State
  const [name, setName] = useState("");
  const [channelAccountId, setChannelAccountId] = useState("");
  const [messageMode, setMessageMode] = useState<"template" | "custom">("custom");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [customContent, setCustomContent] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [autoPopulate, setAutoPopulate] = useState(true);
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(30);

  // Async data
  const [channels, setChannels] = useState<readonly CampaignChannelItem[]>([]);
  const [templates, setTemplates] = useState<readonly MessageTemplateItem[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setName("");
      setChannelAccountId("");
      setMessageMode("custom");
      setSelectedTemplateId("");
      setCustomContent("");
      setTagsInput("");
      setTags([]);
      setAutoPopulate(true);
      setRateLimitPerMinute(30);
      setError(null);

      // Fetch channels & templates
      setLoadingData(true);
      Promise.all([
        fetchChannelsForCampaigns(apiBaseUrl).catch(() => []),
        fetchMessageTemplates(apiBaseUrl).catch(() => []),
      ])
        .then(([channelsList, templatesList]) => {
          setChannels(channelsList);
          if (channelsList.length > 0 && channelsList[0]) {
            setChannelAccountId(channelsList[0].id);
          }
          setTemplates(templatesList);
        })
        .finally(() => setLoadingData(false));
    }
  }, [isOpen, apiBaseUrl]);

  if (!isOpen) return null;

  const currentMessageText =
    messageMode === "template"
      ? (templates.find((t) => t.id === selectedTemplateId)?.content ?? "")
      : customContent;

  const detectedVariables = extractMustacheVariables(currentMessageText);

  function handleAddTag() {
    const trimmed = tagsInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
      setTagsInput("");
    }
  }

  function handleRemoveTag(tagToRemove: string) {
    setTags((prev) => prev.filter((t) => t !== tagToRemove));
  }

  function handleKeyDownTag(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      handleAddTag();
    }
  }

  function validateStep(currentStep: number): boolean {
    setError(null);
    if (currentStep === 1) {
      if (!name.trim()) {
        setError("El nombre de la campaña es requerido.");
        return false;
      }
      if (!channelAccountId) {
        setError("Debes seleccionar una cuenta o canal de WhatsApp.");
        return false;
      }
    }
    if (currentStep === 2) {
      if (messageMode === "template" && !selectedTemplateId) {
        setError("Debes seleccionar una plantilla.");
        return false;
      }
      if (messageMode === "custom" && !customContent.trim()) {
        setError("El contenido del mensaje no puede estar vacío.");
        return false;
      }
    }
    return true;
  }

  function handleNext() {
    if (validateStep(step)) {
      if (step < 4) {
        setStep((prev) => (prev + 1) as 1 | 2 | 3 | 4);
      }
    }
  }

  function handleBack() {
    setError(null);
    if (step > 1) {
      setStep((prev) => (prev - 1) as 1 | 2 | 3 | 4);
    }
  }

  async function handleFinalSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const audienceFilter = tags.length > 0 ? { tags } : undefined;
      const created = await createCampaign(apiBaseUrl, {
        name: name.trim(),
        channelAccountId,
        templateId: messageMode === "template" ? selectedTemplateId : undefined,
        messageContent: messageMode === "custom" ? customContent.trim() : undefined,
        rateLimitPerMinute,
        audienceFilter,
      });

      if (autoPopulate) {
        try {
          const populateRes = await populateAudience(apiBaseUrl, created.id);
          showToast(
            `Campaña creada con éxito. Se segmentaron ${populateRes.populatedCount} destinatarios.`,
          );
        } catch {
          showToast("Campaña creada en borrador. Error al poblar audiencia automáticamente.");
        }
      } else {
        showToast("Campaña creada exitosamente en estado borrador.");
      }

      onSuccess(created);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear la campaña.");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedChannel = channels.find((c) => c.id === channelAccountId);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-wizard-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4 bg-slate-50 dark:bg-slate-800/50">
          <div>
            <h2
              id="modal-wizard-title"
              className="text-lg font-semibold text-slate-900 dark:text-slate-100"
            >
              Nueva Campaña de WhatsApp
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Paso {step} de 4: {step === 1 && "Configuración General"}
              {step === 2 && "Mensaje y Plantilla"}
              {step === 3 && "Segmentación de Audiencia"}
              {step === 4 && "Velocidad y Confirmación"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
            aria-label="Cerrar modal"
          >
            ✕
          </button>
        </div>

        {/* Stepper Progress Bar */}
        <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5">
          <div
            className="bg-emerald-600 h-1.5 transition-all duration-300 ease-in-out"
            style={{ width: `${(step / 4) * 100}%` }}
          />
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3 text-sm rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          {/* STEP 1: GENERAL INFO */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="campaign-name"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1"
                >
                  Nombre de la Campaña *
                </label>
                <input
                  id="campaign-name"
                  type="text"
                  required
                  placeholder="Ej. Promoción Fin de Mes - Marzo"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label
                  htmlFor="channel-select"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1"
                >
                  Canal de Envío (WhatsApp) *
                </label>
                {loadingData ? (
                  <p className="text-sm text-slate-400">Cargando canales disponibles...</p>
                ) : channels.length === 0 ? (
                  <p className="text-sm text-amber-600">
                    No se encontraron cuentas de WhatsApp registradas. Por favor vincula una primero
                    en Canales.
                  </p>
                ) : (
                  <select
                    id="channel-select"
                    value={channelAccountId}
                    onChange={(e) => setChannelAccountId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    {channels.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.displayName} ({ch.phoneNumber ?? "Sin número"} - {ch.status})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: MESSAGE & TEMPLATE */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex space-x-4 border-b border-slate-200 dark:border-slate-800 pb-2">
                <button
                  type="button"
                  onClick={() => setMessageMode("custom")}
                  className={`text-sm font-medium pb-2 border-b-2 -mb-2 ${
                    messageMode === "custom"
                      ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Mensaje Personalizado
                </button>
                <button
                  type="button"
                  onClick={() => setMessageMode("template")}
                  className={`text-sm font-medium pb-2 border-b-2 -mb-2 ${
                    messageMode === "template"
                      ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Usar Plantilla Guardada
                </button>
              </div>

              {messageMode === "template" ? (
                <div>
                  <label
                    htmlFor="template-select"
                    className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1"
                  >
                    Seleccionar Plantilla
                  </label>
                  {templates.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      No hay plantillas registradas. Puedes redactar un mensaje personalizado.
                    </p>
                  ) : (
                    <select
                      id="template-select"
                      value={selectedTemplateId}
                      onChange={(e) => setSelectedTemplateId(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="">-- Elige una plantilla --</option>
                      {templates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          {tpl.name} {tpl.category ? `(${tpl.category})` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="custom-message"
                    className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1"
                  >
                    Contenido del Mensaje *
                  </label>
                  <textarea
                    id="custom-message"
                    rows={4}
                    value={customContent}
                    onChange={(e) => setCustomContent(e.target.value)}
                    placeholder="Hola {{nombre}}, tenemos una oferta exclusiva para ti en {{sucursal}}..."
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Puedes incluir variables mustache como{" "}
                    <code className="text-emerald-600 font-mono">{"{{nombre}}"}</code> o{" "}
                    <code className="text-emerald-600 font-mono">{"{{empresa}}"}</code>.
                  </p>
                </div>
              )}

              {/* Detected Variables Feedback */}
              {detectedVariables.length > 0 && (
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 p-3 border border-emerald-200 dark:border-emerald-800">
                  <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                    Variables detectadas para sustitución dinámica:
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {detectedVariables.map((v) => (
                      <span
                        key={v}
                        className="px-2 py-0.5 rounded-full text-xs font-mono font-medium bg-emerald-200 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200"
                      >
                        {`{{${v}}}`}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: AUDIENCE & SEGMENTATION */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="audience-tags"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1"
                >
                  Filtrar por Etiquetas de Contacto
                </label>
                <div className="flex gap-2">
                  <input
                    id="audience-tags"
                    type="text"
                    placeholder="Escribe una etiqueta y presiona Enter o Agregar"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    onKeyDown={handleKeyDownTag}
                    className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={handleAddTag}
                    className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200"
                  >
                    Agregar
                  </button>
                </div>
              </div>

              {/* Tags Badges */}
              {tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-sky-100 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300 border border-sky-300 dark:border-sky-800"
                    >
                      <span>#{tag}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="text-sky-600 hover:text-sky-900 dark:text-sky-400"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Sin etiquetas seleccionadas: la campaña se segmentará sobre todos los contactos
                  disponibles.
                </p>
              )}

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoPopulate}
                    onChange={(e) => setAutoPopulate(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300 font-medium">
                    Segmentar y poblar destinatarios inmediatamente al crear
                  </span>
                </label>
                <p className="text-xs text-slate-400 ml-6 mt-0.5">
                  Si se desmarca, la campaña se guardará con 0 destinatarios y podrás poblarla
                  manualmente después.
                </p>
              </div>
            </div>
          )}

          {/* STEP 4: RATE LIMIT & REVIEW */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label
                    htmlFor="rate-limit-slider"
                    className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300"
                  >
                    Velocidad de Envío (Tasa por Minuto)
                  </label>
                  <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    {rateLimitPerMinute} msgs / min
                  </span>
                </div>
                <input
                  id="rate-limit-slider"
                  type="range"
                  min="10"
                  max="120"
                  step="5"
                  value={rateLimitPerMinute}
                  onChange={(e) => setRateLimitPerMinute(Number(e.target.value))}
                  className="w-full accent-emerald-600 cursor-pointer"
                />
                <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                  <span>10 msgs/min (Muy Seguro)</span>
                  <span>30 msgs/min (Recomendado)</span>
                  <span>120 msgs/min (Rápido)</span>
                </div>
              </div>

              {/* Review Summary Box */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-4 space-y-2 text-sm">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-xs uppercase tracking-wider mb-2">
                  Resumen de la Campaña
                </h3>
                <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Nombre:</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">{name}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Canal:</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {selectedChannel?.displayName ?? channelAccountId}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Tipo de Mensaje:</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {messageMode === "template"
                      ? "Plantilla guardada"
                      : "Texto libre personalizado"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Segmentación:</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {tags.length > 0 ? tags.map((t) => `#${t}`).join(", ") : "Todos los contactos"}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500 dark:text-slate-400">Poblado inicial:</span>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    {autoPopulate ? "Inmediato al crear" : "Manual posterior"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 px-6 py-4 bg-slate-50 dark:bg-slate-800/50">
          <div>
            {step > 1 && (
              <button
                type="button"
                onClick={handleBack}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              >
                ← Anterior
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            {step < 4 ? (
              <button
                type="button"
                onClick={handleNext}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
              >
                Siguiente →
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinalSubmit}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white shadow-sm"
              >
                {submitting ? "Creando..." : "Crear Campaña"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
