"use client";

import { useEffect, useId, useRef, useState } from "react";
import { getFocusTrapTarget } from "./scheduled-task-focus-trap";
import {
  fetchScheduledTaskRuns,
  formatDateTime,
  formatTaskRunDuration,
  formatTaskRunStatus,
  type ScheduledTaskItem,
  type ScheduledTaskRunItem,
} from "./scheduled-tasks-view-model";

const PAGE_SIZE = 20;

type ScheduledTaskRunsModalProps = Readonly<{
  apiBaseUrl: string;
  isOpen: boolean;
  onClose: () => void;
  task: ScheduledTaskItem | null;
}>;

const STATUS_CLASSES = {
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  red: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300",
  gray: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
} as const;

export function ScheduledTaskRunsModal({
  apiBaseUrl,
  isOpen,
  onClose,
  task,
}: ScheduledTaskRunsModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [runs, setRuns] = useState<readonly ScheduledTaskRunItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && task?.id) {
      setOffset(0);
    }
  }, [isOpen, task?.id]);

  useEffect(() => {
    // This state value intentionally retriggers the request after a manual retry.
    void reloadKey;
    if (!isOpen || !task) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchScheduledTaskRuns(apiBaseUrl, task.id, {
      limit: PAGE_SIZE,
      offset,
      signal: controller.signal,
    })
      .then((response) => {
        if (controller.signal.aborted) return;
        setRuns(response.items);
        setTotal(response.total);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "No fue posible cargar el historial.");
        setRuns([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [apiBaseUrl, isOpen, offset, reloadKey, task]);

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
    (focusableElements()[0] ?? dialog)?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
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

  if (!isOpen || !task) return null;

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900 sm:p-6"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100" id={titleId}>
              Historial de ejecuciones
            </h2>
            <p className="mt-1 break-words text-sm text-slate-500 dark:text-slate-400">
              {task.name}
            </p>
          </div>
          <button
            aria-label="Cerrar historial"
            className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        {error ? (
          <div
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200"
            role="alert"
          >
            <span>{error}</span>
            <button
              className="font-semibold underline"
              onClick={() => setReloadKey((current) => current + 1)}
              type="button"
            >
              Reintentar
            </button>
          </div>
        ) : null}

        {loading ? (
          <div aria-live="polite" className="py-12 text-center text-sm text-slate-500">
            Cargando historial…
          </div>
        ) : error ? null : runs.length === 0 ? (
          <div className="rounded-lg border border-slate-200 px-4 py-12 text-center dark:border-slate-800">
            <p className="font-medium text-slate-800 dark:text-slate-200">
              No hay ejecuciones registradas
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              El historial aparecerá después de la primera ejecución de esta tarea.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="min-w-[850px] w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium" scope="col">
                    Resultado
                  </th>
                  <th className="px-4 py-3 font-medium" scope="col">
                    Inicio
                  </th>
                  <th className="px-4 py-3 font-medium" scope="col">
                    Fin
                  </th>
                  <th className="px-4 py-3 font-medium" scope="col">
                    Duración
                  </th>
                  <th className="px-4 py-3 font-medium" scope="col">
                    Intento
                  </th>
                  <th className="px-4 py-3 font-medium" scope="col">
                    Detalle
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {runs.map((run) => (
                  <ScheduledTaskRunRow key={run.id} run={run} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <footer className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p aria-live="polite" className="text-sm text-slate-500 dark:text-slate-400">
            {total} ejecuciones · Página {currentPage} de {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700"
              disabled={offset === 0 || loading}
              onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
              type="button"
            >
              Anterior
            </button>
            <button
              className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700"
              disabled={offset + PAGE_SIZE >= total || loading}
              onClick={() => setOffset((current) => current + PAGE_SIZE)}
              type="button"
            >
              Siguiente
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function ScheduledTaskRunRow({ run }: Readonly<{ run: ScheduledTaskRunItem }>) {
  const status = formatTaskRunStatus(run.status);
  return (
    <tr className="align-top text-slate-700 dark:text-slate-200">
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[status.tone]}`}
        >
          {status.label}
        </span>
      </td>
      <td className="px-4 py-3">{formatDateTime(run.startedAt)}</td>
      <td className="px-4 py-3">{formatDateTime(run.completedAt)}</td>
      <td className="px-4 py-3">{formatTaskRunDuration(run.durationMs)}</td>
      <td className="px-4 py-3">{run.retryAttempt + 1}</td>
      <td className="max-w-sm px-4 py-3">
        {run.errorMessage ? (
          <details>
            <summary className="cursor-pointer font-medium text-rose-700 dark:text-rose-300">
              Ver error
            </summary>
            <p className="mt-2 whitespace-pre-wrap break-words text-xs">{run.errorMessage}</p>
          </details>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
    </tr>
  );
}
