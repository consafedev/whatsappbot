import type { Prisma, PrismaClient, ScheduledTaskRun } from "./generated/prisma/client";
import { ScheduledTaskRunStatus } from "./generated/prisma/enums";
import { ScheduledTaskValidationError } from "./scheduled-task-manager";
import { createTenantContext } from "./tenant-context";
import { assertTenantOperational } from "./tenant-operational";

export type ScheduledTaskRunDatabase = Pick<
  PrismaClient,
  "$transaction" | "scheduledTaskRun" | "tenant"
>;

export interface RecordTaskRunInput {
  readonly tenantId: string;
  readonly taskId: string;
  readonly status: ScheduledTaskRunStatus;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly durationMs: number;
  readonly retryAttempt: number;
  readonly errorMessage?: string | null;
  readonly metadata?: Prisma.InputJsonValue;
}

export interface ListScheduledTaskRunsInput {
  readonly tenantId: string;
  readonly taskId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

function assertRunInput(input: RecordTaskRunInput): void {
  if (!Object.values(ScheduledTaskRunStatus).includes(input.status)) {
    throw new ScheduledTaskValidationError("status must be a scheduled task run status");
  }
  if (!(input.startedAt instanceof Date) || Number.isNaN(input.startedAt.getTime())) {
    throw new ScheduledTaskValidationError("startedAt must be a valid date");
  }
  if (!(input.completedAt instanceof Date) || Number.isNaN(input.completedAt.getTime())) {
    throw new ScheduledTaskValidationError("completedAt must be a valid date");
  }
  if (!Number.isInteger(input.durationMs) || input.durationMs < 0) {
    throw new ScheduledTaskValidationError("durationMs must be a non-negative integer");
  }
  if (!Number.isInteger(input.retryAttempt) || input.retryAttempt < 0) {
    throw new ScheduledTaskValidationError("retryAttempt must be a non-negative integer");
  }
}

function assertPagination(input: ListScheduledTaskRunsInput): {
  readonly limit: number;
  readonly offset: number;
} {
  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ScheduledTaskValidationError("limit must be a positive integer");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ScheduledTaskValidationError("offset must be a non-negative integer");
  }
  return { limit, offset };
}

/** Appends one immutable terminal run; duplicate claim timestamps are idempotent. */
export async function recordTaskRun(
  database: ScheduledTaskRunDatabase,
  input: RecordTaskRunInput,
): Promise<boolean> {
  assertRunInput(input);
  const tenant = createTenantContext(input.tenantId);
  const errorMessage = input.errorMessage?.trim().slice(0, 500) || null;

  return database.$transaction(async (transaction) => {
    const result = await transaction.scheduledTaskRun.createMany({
      data: [
        {
          completedAt: input.completedAt,
          durationMs: input.durationMs,
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
          errorMessage,
          retryAttempt: input.retryAttempt,
          startedAt: input.startedAt,
          status: input.status,
          taskId: input.taskId,
          tenantId: tenant.tenantId,
        },
      ],
      skipDuplicates: true,
    });
    return result.count === 1;
  });
}

/** Lists recent run history for one task or the current tenant only. */
export async function listScheduledTaskRuns(
  database: ScheduledTaskRunDatabase,
  input: ListScheduledTaskRunsInput,
): Promise<{
  readonly items: readonly ScheduledTaskRun[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}> {
  const tenant = createTenantContext(input.tenantId);
  await assertTenantOperational(tenant, database);
  const { limit, offset } = assertPagination(input);
  const where: Prisma.ScheduledTaskRunWhereInput = {
    tenantId: tenant.tenantId,
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
  };

  const [items, total] = await Promise.all([
    database.scheduledTaskRun.findMany({
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit,
      where,
    }),
    database.scheduledTaskRun.count({ where }),
  ]);
  return { items, total, limit, offset };
}
