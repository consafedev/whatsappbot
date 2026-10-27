import type {
  DurableScheduleIntent,
  WorkflowOrchestrator,
  WorkflowRef,
  WorkflowStatus,
} from "@whatsapp-platform/workflows";
import type { Prisma, ScheduledTaskStatus } from "./generated/prisma/client";

export class WorkflowIntentConflictError extends Error {
  override readonly name = "WorkflowIntentConflictError";

  constructor() {
    super("Workflow reference already belongs to a different durable intent");
  }
}

export class WorkflowReferenceNotFoundError extends Error {
  override readonly name = "WorkflowReferenceNotFoundError";

  constructor() {
    super("Workflow reference was not found for tenant");
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalUuid(value: string, field: string): string {
  if (!UUID_V7.test(value)) throw new TypeError(`${field} must be a UUIDv7`);
  return value.toLowerCase();
}

function matchesIntent(
  existing: {
    tenantId: string;
    id: string;
    taskType: string;
    name: string;
    workflowRunAt: Date | null;
    payload: Prisma.JsonValue;
  },
  intent: DurableScheduleIntent,
): boolean {
  return (
    existing.tenantId === intent.tenantId &&
    existing.id === intent.id &&
    existing.taskType === intent.taskType &&
    existing.name === intent.name &&
    existing.workflowRunAt?.getTime() === intent.runAt.getTime() &&
    canonicalJson(existing.payload) === canonicalJson(intent.payload)
  );
}

function status(value: ScheduledTaskStatus): WorkflowStatus {
  return value;
}

/** Adapts the caller's open transaction to the existing PostgreSQL durable scheduler. */
export function createPostgresWorkflowOrchestrator(
  transaction: Prisma.TransactionClient,
): WorkflowOrchestrator {
  return {
    async schedule(intent) {
      const tenantId = canonicalUuid(intent.tenantId, "tenantId");
      const id = canonicalUuid(intent.id, "id");
      if (!(intent.runAt instanceof Date) || Number.isNaN(intent.runAt.getTime())) {
        throw new TypeError("runAt must be a valid date");
      }
      const normalized = {
        ...intent,
        id,
        tenantId,
        payload: intent.payload,
      };
      await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`workflow:${tenantId}:${id}`}, 0))`;
      const existing = await transaction.scheduledTask.findUnique({
        where: { tenantId_id: { tenantId, id } },
      });
      if (existing !== null) {
        if (!matchesIntent(existing, normalized)) throw new WorkflowIntentConflictError();
        return { id: existing.id, tenantId: existing.tenantId };
      }

      const created = await transaction.scheduledTask.create({
        data: {
          id,
          tenantId,
          taskType: normalized.taskType,
          name: normalized.name,
          payload: normalized.payload as Prisma.InputJsonValue,
          scheduledFor: normalized.runAt,
          workflowRunAt: normalized.runAt,
          status: "PENDING",
        },
      });
      return { id: created.id, tenantId: created.tenantId };
    },
    async cancel(ref: WorkflowRef) {
      const tenantId = canonicalUuid(ref.tenantId, "tenantId");
      const id = canonicalUuid(ref.id, "id");
      const existing = await transaction.scheduledTask.findUnique({
        where: { tenantId_id: { tenantId, id } },
      });
      if (existing === null) throw new WorkflowReferenceNotFoundError();
      if (existing.status === "PENDING" || existing.status === "PROCESSING") {
        await transaction.scheduledTask.updateMany({
          data: { status: "CANCELLED" },
          where: {
            id,
            tenantId,
            status: { in: ["PENDING", "PROCESSING"] },
          },
        });
      }
      const current = await transaction.scheduledTask.findUnique({
        where: { tenantId_id: { tenantId, id } },
      });
      if (current === null) throw new WorkflowReferenceNotFoundError();
      return status(current.status);
    },
    async getStatus(ref: WorkflowRef) {
      const tenantId = canonicalUuid(ref.tenantId, "tenantId");
      const id = canonicalUuid(ref.id, "id");
      const task = await transaction.scheduledTask.findUnique({
        select: { status: true },
        where: { tenantId_id: { tenantId, id } },
      });
      return task === null ? null : status(task.status);
    },
  };
}
