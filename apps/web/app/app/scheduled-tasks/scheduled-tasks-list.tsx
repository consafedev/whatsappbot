"use client";

import {
  formatDateTime,
  formatTaskStatus,
  formatTaskType,
  type ScheduledTaskItem,
  type ScheduledTaskStatusTone,
} from "./scheduled-tasks-view-model";

type ScheduledTasksListProps = Readonly<{
  canManage: boolean;
  isPending: (taskId: string) => boolean;
  onCancel: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  tasks: readonly ScheduledTaskItem[];
}>;

const STATUS_CLASSES: Readonly<Record<ScheduledTaskStatusTone, string>> = Object.freeze({
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  red: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300",
  gray: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
});

export function ScheduledTasksList({
  canManage,
  isPending,
  onCancel,
  onRetry,
  tasks,
}: ScheduledTasksListProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <table className="min-w-[900px] w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
          <tr>
            <th className="px-4 py-3 font-medium" scope="col">
              Tarea
            </th>
            <th className="px-4 py-3 font-medium" scope="col">
              Recurrencia
            </th>
            <th className="px-4 py-3 font-medium" scope="col">
              Próxima ejecución
            </th>
            <th className="px-4 py-3 font-medium" scope="col">
              Última ejecución / Reintentos
            </th>
            <th className="px-4 py-3 font-medium" scope="col">
              Estado
            </th>
            <th className="px-4 py-3 font-medium" scope="col">
              Acciones
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {tasks.map((task) => {
            const status = formatTaskStatus(task.status);
            const pending = isPending(task.id);
            const canCancel = task.status === "PENDING" || task.status === "PROCESSING";
            const canRetry = task.status === "FAILED" || task.status === "CANCELLED";

            return (
              <tr className="align-top text-slate-700 dark:text-slate-200" key={task.id}>
                <td className="max-w-xs px-4 py-4">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">{task.name}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {formatTaskType(task.taskType)}
                  </p>
                  {task.errorMessage ? (
                    <details className="mt-2 text-xs text-rose-700 dark:text-rose-300">
                      <summary className="cursor-pointer font-medium">Diagnóstico de falla</summary>
                      <p className="mt-1 whitespace-pre-wrap break-words">{task.errorMessage}</p>
                    </details>
                  ) : null}
                </td>
                <td className="px-4 py-4">
                  {task.cronExpression ? (
                    <code className="rounded bg-slate-100 px-2 py-1 font-mono text-xs dark:bg-slate-800">
                      {task.cronExpression}
                    </code>
                  ) : (
                    <span className="text-slate-500 dark:text-slate-400">Puntual</span>
                  )}
                </td>
                <td className="px-4 py-4">{formatDateTime(task.scheduledFor)}</td>
                <td className="px-4 py-4">
                  <p>{formatDateTime(task.lastRunAt)}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {task.retryCount} / {task.maxRetries} reintentos
                  </p>
                </td>
                <td className="px-4 py-4">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[status.tone]}`}
                  >
                    {status.label}
                  </span>
                </td>
                <td className="px-4 py-4">
                  {canManage && canCancel ? (
                    <button
                      className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
                      disabled={pending}
                      onClick={() => onCancel(task.id)}
                      type="button"
                    >
                      {pending ? "Procesando…" : "Cancelar"}
                    </button>
                  ) : null}
                  {canManage && canRetry ? (
                    <button
                      className="rounded-md bg-blue-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-50"
                      disabled={pending}
                      onClick={() => onRetry(task.id)}
                      type="button"
                    >
                      {pending ? "Procesando…" : "Reintentar"}
                    </button>
                  ) : null}
                  {!canManage || (!canCancel && !canRetry) ? (
                    <span className="text-xs text-slate-400">—</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
