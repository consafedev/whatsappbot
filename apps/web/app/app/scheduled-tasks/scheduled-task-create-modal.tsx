"use client";

import { useEffect, useId, useRef, useState } from "react";
import { parseMaxRetries, parsePayloadJson } from "./scheduled-task-create-validation";
import { getFocusTrapTarget } from "./scheduled-task-focus-trap";
import type { CreateScheduledTaskInput } from "./scheduled-tasks-view-model";

type ScheduledTaskCreateModalProps = Readonly<{
  canManage: boolean;
  isOpen: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onCreate: (input: CreateScheduledTaskInput) => Promise<void>;
}>;

type ScheduleMode = "one-off" | "recurring";
type CronPreset = "hourly" | "daily" | "monday" | "custom";

const CRON_PRESETS: Readonly<Record<Exclude<CronPreset, "custom">, string>> = Object.freeze({
  hourly: "0 * * * *",
  daily: "0 0 * * *",
  monday: "0 9 * * 1",
});

export function ScheduledTaskCreateModal({
  canManage,
  isOpen,
  isSubmitting,
  onClose,
  onCreate,
}: ScheduledTaskCreateModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const isSubmittingRef = useRef(isSubmitting);
  onCloseRef.current = onClose;
  isSubmittingRef.current = isSubmitting;
  const [name, setName] = useState("");
  const [taskType, setTaskType] = useState<"TRIGGER_RULE" | "CUSTOM_ACTION">("TRIGGER_RULE");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("one-off");
  const [scheduledFor, setScheduledFor] = useState("");
  const [cronPreset, setCronPreset] = useState<CronPreset>("hourly");
  const [cronExpression, setCronExpression] = useState(CRON_PRESETS.hourly);
  const [payloadText, setPayloadText] = useState("{}");
  const [maxRetriesText, setMaxRetriesText] = useState("3");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName("");
    setTaskType("TRIGGER_RULE");
    setScheduleMode("one-off");
    setScheduledFor("");
    setCronPreset("hourly");
    setCronExpression(CRON_PRESETS.hourly);
    setPayloadText("{}");
    setMaxRetriesText("3");
    setErrorMessage(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
    const focusableElements = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter(
        (element) => !element.hasAttribute("hidden"),
      );
    const firstFocusable = focusableElements()[0];
    (firstFocusable ?? dialog)?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!isSubmittingRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const target = getFocusTrapTarget(
        document.activeElement instanceof HTMLElement ? document.activeElement : null,
        focusableElements(),
        event.shiftKey,
      );
      if (target) {
        event.preventDefault();
        target.focus();
      } else if (focusableElements().length === 0) {
        event.preventDefault();
        dialog?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  if (!isOpen || !canManage) return null;

  const handleCronPresetChange = (preset: CronPreset) => {
    setCronPreset(preset);
    if (preset !== "custom") setCronExpression(CRON_PRESETS[preset]);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage || isSubmitting) return;
    setErrorMessage(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMessage("El nombre de la tarea es obligatorio.");
      return;
    }
    if (scheduleMode === "one-off" && !scheduledFor) {
      setErrorMessage("Selecciona la fecha y hora de ejecución.");
      return;
    }
    if (scheduleMode === "recurring" && !cronExpression.trim()) {
      setErrorMessage("Ingresa una expresión cron de cinco campos.");
      return;
    }

    let payload: Record<string, unknown>;
    let maxRetries: number;
    try {
      payload = parsePayloadJson(payloadText);
      maxRetries = parseMaxRetries(maxRetriesText);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Revisa los datos de la tarea.");
      return;
    }

    const input: CreateScheduledTaskInput = {
      name: trimmedName,
      taskType,
      payload,
      maxRetries,
      ...(scheduleMode === "one-off"
        ? { scheduledFor: new Date(scheduledFor).toISOString() }
        : { cronExpression: cronExpression.trim() }),
    };

    try {
      await onCreate(input);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "No fue posible crear la tarea.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100" id={titleId}>
              Programar nueva tarea
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Define cuándo debe ejecutarse y el tipo de acción.
            </p>
          </div>
          <button
            aria-label="Cerrar"
            className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <label className="block space-y-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            <span>Nombre de la tarea</span>
            <input
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>

          <label className="block space-y-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            <span>Tipo de tarea</span>
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              onChange={(event) =>
                setTaskType(event.target.value as "TRIGGER_RULE" | "CUSTOM_ACTION")
              }
              value={taskType}
            >
              <option value="TRIGGER_RULE">Disparador de Regla</option>
              <option value="CUSTOM_ACTION">Acción Personalizada</option>
            </select>
          </label>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Modalidad de ejecución
            </legend>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  checked={scheduleMode === "one-off"}
                  name="schedule-mode"
                  onChange={() => setScheduleMode("one-off")}
                  type="radio"
                />
                Puntual (fecha y hora)
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  checked={scheduleMode === "recurring"}
                  name="schedule-mode"
                  onChange={() => setScheduleMode("recurring")}
                  type="radio"
                />
                Recurrente (cron)
              </label>
            </div>
          </fieldset>

          {scheduleMode === "one-off" ? (
            <label className="block space-y-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              <span>Fecha y hora (zona horaria local)</span>
              <input
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                onChange={(event) => setScheduledFor(event.target.value)}
                required
                type="datetime-local"
                value={scheduledFor}
              />
            </label>
          ) : (
            <div className="space-y-2">
              <label className="block space-y-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                <span>Presets rápidos</span>
                <select
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                  onChange={(event) => handleCronPresetChange(event.target.value as CronPreset)}
                  value={cronPreset}
                >
                  <option value="hourly">Cada hora</option>
                  <option value="daily">Diario a medianoche</option>
                  <option value="monday">Cada lunes a las 9 AM</option>
                  <option value="custom">Personalizado</option>
                </select>
              </label>
              <label className="block space-y-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                <span>Expresión cron (UTC)</span>
                <input
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-950"
                  onChange={(event) => setCronExpression(event.target.value)}
                  placeholder="0 9 * * 1"
                  required
                  value={cronExpression}
                />
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Las expresiones cron se evalúan en UTC y usan cinco campos.
              </p>
            </div>
          )}

          <label className="block space-y-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            <span>Payload JSON (objeto)</span>
            <textarea
              className="min-h-28 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
              onChange={(event) => setPayloadText(event.target.value)}
              spellCheck={false}
              value={payloadText}
            />
          </label>

          <label className="block space-y-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            <span>Límite de reintentos</span>
            <input
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              inputMode="numeric"
              min={0}
              onChange={(event) => setMaxRetriesText(event.target.value)}
              type="number"
              value={maxRetriesText}
            />
          </label>

          {errorMessage ? (
            <p
              className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
              role="alert"
            >
              {errorMessage}
            </p>
          ) : null}

          <div className="flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
            <button
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              disabled={isSubmitting}
              onClick={onClose}
              type="button"
            >
              Volver
            </button>
            <button
              className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isSubmitting || !canManage}
              type="submit"
            >
              {isSubmitting ? "Guardando…" : "Crear tarea"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
