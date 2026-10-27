export type WorkflowsBoundary = "workflows";

export type WorkflowRef = Readonly<{ tenantId: string; id: string }>;

export type DurableScheduleIntent = Readonly<{
  readonly tenantId: string;
  readonly id: string;
  readonly taskType: string;
  readonly name: string;
  readonly runAt: Date;
  readonly payload: Readonly<Record<string, string>>;
}>;

export type WorkflowStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";

/** Transaction-bound durable scheduling port. Implementations must not open nested transactions. */
export interface WorkflowOrchestrator {
  schedule(intent: DurableScheduleIntent): Promise<WorkflowRef>;
  cancel(ref: WorkflowRef): Promise<WorkflowStatus>;
  getStatus(ref: WorkflowRef): Promise<WorkflowStatus | null>;
}
