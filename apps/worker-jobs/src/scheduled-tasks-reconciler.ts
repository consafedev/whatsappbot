import {
  recoverStaleScheduledTasks,
  type ScheduledTask,
  type ScheduledTaskDatabase,
} from "@whatsapp-platform/database";

const RECONCILIATION_INTERVAL_MS = 60_000;
const RECONCILIATION_BATCH_SIZE = 100;
const STALE_TASK_THRESHOLD_MS = 300_000;

export interface ScheduledTasksReconcilerDependencies {
  readonly database: ScheduledTaskDatabase;
  readonly enqueue: (task: ScheduledTask) => Promise<void>;
  readonly now?: () => Date;
}

export interface ScheduledTasksReconciler {
  start(): Promise<void>;
  stop(): Promise<void>;
  runOnce(): Promise<{ failedCount: number; recoveredCount: number; enqueuedCount: number }>;
}

function logReconciliationFailure(error: unknown): void {
  console.error(
    JSON.stringify({
      component: "scheduled-tasks-reconciler",
      error: error instanceof Error ? error.name : "UnknownError",
      service: "worker-jobs",
      status: "failed",
    }),
  );
}

export function createScheduledTasksReconciler(
  dependencies: ScheduledTasksReconcilerDependencies,
): ScheduledTasksReconciler {
  const now = dependencies.now ?? (() => new Date());
  let interval: ReturnType<typeof setInterval> | undefined;
  let inFlight: Promise<void> | undefined;
  let started = false;
  let stopped = false;

  async function runOnce(): Promise<{
    failedCount: number;
    recoveredCount: number;
    enqueuedCount: number;
  }> {
    const currentTime = now();
    const recovery = await recoverStaleScheduledTasks(dependencies.database, {
      limit: RECONCILIATION_BATCH_SIZE,
      staleBefore: new Date(currentTime.getTime() - STALE_TASK_THRESHOLD_MS),
    });
    const pendingTasks = await dependencies.database.scheduledTask.findMany({
      orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
      take: RECONCILIATION_BATCH_SIZE,
      where: {
        scheduledFor: { lte: currentTime },
        status: "PENDING",
        tenant: { status: "active" },
      },
    });
    for (const task of pendingTasks) await dependencies.enqueue(task);

    return { ...recovery, enqueuedCount: pendingTasks.length };
  }

  function runSafely(): Promise<void> {
    if (inFlight !== undefined) return inFlight.then(() => undefined);
    inFlight = runOnce()
      .then(() => undefined)
      .catch(logReconciliationFailure)
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  }

  return {
    async start(): Promise<void> {
      if (started) return;
      started = true;
      stopped = false;
      await runSafely();
      if (!stopped) {
        interval = setInterval(() => void runSafely(), RECONCILIATION_INTERVAL_MS);
      }
    },
    async stop(): Promise<void> {
      stopped = true;
      if (interval !== undefined) {
        clearInterval(interval);
        interval = undefined;
      }
      await inFlight;
    },
    runOnce,
  };
}
