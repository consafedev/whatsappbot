"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTenantAppBootstrap } from "../tenant-app-shell";
import { ScheduledTaskCreateModal } from "./scheduled-task-create-modal";
import { ScheduledTaskRunsModal } from "./scheduled-task-runs-modal";
import { ScheduledTasksList } from "./scheduled-tasks-list";
import {
  type CreateScheduledTaskInput,
  cancelScheduledTask,
  canManageScheduledTasks,
  canReadScheduledTasks,
  createScheduledTask,
  fetchScheduledTasks,
  retryScheduledTask,
  type ScheduledTaskItem,
  type ScheduledTaskStatus,
} from "./scheduled-tasks-view-model";

type ScheduledTasksClientProps = Readonly<{
  apiBaseUrl?: string | undefined;
}>;

type StatusFilter = "ALL" | ScheduledTaskStatus;
const PAGE_SIZE = 20;

const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = Object.freeze([
  { value: "ALL", label: "Todos" },
  { value: "PENDING", label: "Pendiente" },
  { value: "PROCESSING", label: "En ejecución" },
  { value: "COMPLETED", label: "Completada" },
  { value: "FAILED", label: "Fallida" },
  { value: "CANCELLED", label: "Cancelada" },
]);

export function ScheduledTasksClient({ apiBaseUrl }: ScheduledTasksClientProps) {
  const bootstrap = useTenantAppBootstrap();
  const base = (
    apiBaseUrl ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://localhost:3001"
  ).replace(/\/$/, "");
  const hasSchedulingModule = bootstrap.effectiveModules.includes("module.scheduling");
  const canRead = canReadScheduledTasks(bootstrap.effectiveModules, bootstrap.effectivePermissions);
  const canManage = canManageScheduledTasks(bootstrap.effectivePermissions);

  const [tasks, setTasks] = useState<readonly ScheduledTaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutatingTaskId, setMutatingTaskId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [historyTask, setHistoryTask] = useState<ScheduledTaskItem | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);

  const loadTasks = useCallback(
    async (manualRefresh = false) => {
      if (!canRead) {
        requestControllerRef.current?.abort();
        setLoading(false);
        setRefreshing(false);
        return;
      }
      requestControllerRef.current?.abort();
      const controller = new AbortController();
      requestControllerRef.current = controller;
      if (manualRefresh) setRefreshing(true);
      else setLoading(true);
      setErrorMessage(null);

      try {
        const response = await fetchScheduledTasks(base, {
          ...(statusFilter === "ALL" ? {} : { status: statusFilter }),
          limit: PAGE_SIZE,
          offset,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setTasks(response.items);
        setTotal(response.total);
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setErrorMessage(
          error instanceof Error ? error.message : "No fue posible cargar las tareas programadas.",
        );
      } finally {
        if (!controller.signal.aborted) {
          if (requestControllerRef.current === controller) requestControllerRef.current = null;
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [base, canRead, offset, statusFilter],
  );

  useEffect(() => {
    void loadTasks();
    return () => requestControllerRef.current?.abort();
  }, [loadTasks]);

  const filteredTasks = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("es-MX");
    if (!query) return tasks;
    return tasks.filter((task) => task.name.toLocaleLowerCase("es-MX").includes(query));
  }, [searchQuery, tasks]);

  const handleCancel = async (taskId: string) => {
    if (!canManage || mutatingTaskId !== null) return;
    setMutatingTaskId(taskId);
    setMutationError(null);
    try {
      await cancelScheduledTask(base, taskId);
      await loadTasks(true);
    } catch (error: unknown) {
      setMutationError(
        error instanceof Error ? error.message : "No fue posible cancelar la tarea.",
      );
    } finally {
      setMutatingTaskId(null);
    }
  };

  const handleRetry = async (taskId: string) => {
    if (!canManage || mutatingTaskId !== null) return;
    setMutatingTaskId(taskId);
    setMutationError(null);
    try {
      await retryScheduledTask(base, taskId);
      await loadTasks(true);
    } catch (error: unknown) {
      setMutationError(
        error instanceof Error ? error.message : "No fue posible reintentar la tarea.",
      );
    } finally {
      setMutatingTaskId(null);
    }
  };

  const handleCreate = async (input: CreateScheduledTaskInput) => {
    if (!canManage || isCreating) return;
    setIsCreating(true);
    setMutationError(null);
    try {
      await createScheduledTask(base, input);
      setIsCreateModalOpen(false);
      await loadTasks(true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "No fue posible crear la tarea.";
      setMutationError(message);
      throw error;
    } finally {
      setIsCreating(false);
    }
  };

  if (!hasSchedulingModule) {
    return (
      <section className="mx-auto max-w-3xl rounded-xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900/50 dark:bg-amber-950/20">
        <h1 className="text-xl font-semibold text-amber-900 dark:text-amber-200">
          Módulo de programación no contratado
        </h1>
        <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
          El módulo <code>module.scheduling</code> no está habilitado para este tenant.
        </p>
      </section>
    );
  }

  if (!canRead) {
    return (
      <section className="mx-auto max-w-3xl rounded-xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-900/50 dark:bg-rose-950/20">
        <h1 className="text-xl font-semibold text-rose-900 dark:text-rose-200">
          Acceso no autorizado
        </h1>
        <p className="mt-2 text-sm text-rose-800 dark:text-rose-300">
          Necesitas el permiso <code>scheduling.read</code> para consultar tareas programadas.
        </p>
      </section>
    );
  }

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Tareas Programadas
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Consulta y administra tareas puntuales o recurrentes del workspace.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            disabled={refreshing || loading}
            onClick={() => void loadTasks(true)}
            type="button"
          >
            {refreshing ? "Actualizando…" : "Actualizar"}
          </button>
          {canManage ? (
            <button
              className="rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800"
              onClick={() => setIsCreateModalOpen(true)}
              type="button"
            >
              Programar Nueva Tarea
            </button>
          ) : null}
        </div>
      </header>

      <section
        aria-label="Filtros de tareas programadas"
        className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row dark:border-slate-800 dark:bg-slate-900"
      >
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          <span>Buscar en esta página</span>
          <input
            className="rounded-md border border-slate-300 bg-white px-3 py-2 font-normal dark:border-slate-700 dark:bg-slate-950"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Nombre de la tarea"
            type="search"
            value={searchQuery}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 sm:w-56">
          <span>Estado</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-2 font-normal dark:border-slate-700 dark:bg-slate-950"
            onChange={(event) => {
              setStatusFilter(event.target.value as StatusFilter);
              setOffset(0);
            }}
            value={statusFilter}
          >
            {STATUS_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {errorMessage ? (
        <div
          className="flex items-center justify-between gap-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200"
          role="alert"
        >
          <span>{errorMessage}</span>
          <button
            className="shrink-0 font-semibold underline"
            onClick={() => void loadTasks()}
            type="button"
          >
            Reintentar carga
          </button>
        </div>
      ) : null}

      {mutationError ? (
        <p
          className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200"
          role="alert"
        >
          {mutationError}
        </p>
      ) : null}

      {loading ? (
        <div
          aria-live="polite"
          className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900"
        >
          Cargando tareas programadas…
        </div>
      ) : errorMessage ? null : filteredTasks.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="font-medium text-slate-800 dark:text-slate-200">
            {tasks.length === 0
              ? "No hay tareas programadas"
              : "No hay coincidencias en esta página"}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {tasks.length === 0
              ? "Cuando programes una tarea, aparecerá aquí."
              : "Prueba con otro nombre o cambia de página."}
          </p>
        </div>
      ) : (
        <ScheduledTasksList
          canManage={canManage}
          canRead={canRead}
          isPending={(taskId) => mutatingTaskId === taskId}
          onCancel={(taskId) => void handleCancel(taskId)}
          onHistory={(taskId) =>
            setHistoryTask(filteredTasks.find((task) => task.id === taskId) ?? null)
          }
          onRetry={(taskId) => void handleRetry(taskId)}
          tasks={filteredTasks}
        />
      )}

      <nav aria-label="Paginación de tareas" className="flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {total} tareas · Página {currentPage} de {totalPages}
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
      </nav>

      <ScheduledTaskCreateModal
        canManage={canManage}
        isOpen={isCreateModalOpen}
        isSubmitting={isCreating}
        onClose={() => setIsCreateModalOpen(false)}
        onCreate={handleCreate}
      />
      <ScheduledTaskRunsModal
        apiBaseUrl={base}
        isOpen={canRead && historyTask !== null}
        onClose={() => setHistoryTask(null)}
        task={historyTask}
      />
    </div>
  );
}
