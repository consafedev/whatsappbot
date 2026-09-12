export interface WorkerJobsRuntimeDatabase {
  $disconnect(): Promise<void>;
}

export interface WorkerJobsRuntimeQueue {
  close(): Promise<void>;
  waitUntilReady(): Promise<unknown>;
}

export interface WorkerJobsRuntimeWorker {
  close(): Promise<void>;
  waitUntilReady(): Promise<unknown>;
}

export interface WorkerJobsRuntimeDependencies {
  readonly database: WorkerJobsRuntimeDatabase;
  readonly environment: string;
  readonly queue: WorkerJobsRuntimeQueue;
  readonly worker: WorkerJobsRuntimeWorker;
}

export interface WorkerJobsRuntime {
  start(): Promise<void>;
  shutdown(): Promise<void>;
}

export function createWorkerJobsRuntime(
  dependencies: WorkerJobsRuntimeDependencies,
): WorkerJobsRuntime {
  let shutdownPromise: Promise<void> | undefined;

  return {
    async start(): Promise<void> {
      await dependencies.queue.waitUntilReady();
      await dependencies.worker.waitUntilReady();
      console.info(
        JSON.stringify({
          environment: dependencies.environment,
          queue: "scheduled-tasks",
          service: "worker-jobs",
          status: "ready",
          worker: "scheduled-tasks",
        }),
      );
    },
    shutdown(): Promise<void> {
      shutdownPromise ??= (async () => {
        await dependencies.worker.close();
        await dependencies.queue.close();
        await dependencies.database.$disconnect();
      })();
      return shutdownPromise;
    },
  };
}
