import {
  CronExpressionValidationError,
  calculateNextRun,
  isValidCronExpression,
} from "./cron-evaluator";
import { Prisma, type PrismaClient, type ScheduledTask } from "./generated/prisma/client";
import { ScheduledTaskStatus } from "./generated/prisma/enums";
import { createTenantContext } from "./tenant-context";
import { assertTenantOperational } from "./tenant-operational";

export type ScheduledTaskDatabase = Pick<PrismaClient, "scheduledTask" | "tenant" | "$transaction">;

export interface CreateScheduledTaskInput {
  readonly tenantId: string;
  readonly name: string;
  readonly taskType: string;
  readonly payload?: Prisma.InputJsonValue;
  readonly cronExpression?: string | null;
  readonly scheduledFor: Date;
  readonly maxRetries?: number;
}

export interface ListScheduledTasksInput {
  readonly tenantId: string;
  readonly status?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ClaimDueScheduledTasksInput {
  readonly tenantId?: string;
  readonly dueBefore: Date;
  readonly limit: number;
}

export interface ClaimScheduledTaskInput {
  readonly id: string;
  readonly expectedTenantId: string;
  readonly now?: Date;
}

export interface MarkScheduledTaskCompletedInput {
  readonly tenantId: string;
  readonly id: string;
  readonly nextRunAt?: Date;
}

export interface MarkScheduledTaskFailedInput {
  readonly tenantId: string;
  readonly id: string;
  readonly error: string;
  readonly canRetry: boolean;
}

export interface RescheduleRecurringTaskInput {
  readonly tenantId: string;
  readonly id: string;
  readonly lastRunAt: Date;
}

export class ScheduledTaskValidationError extends Error {
  readonly code = "SCHEDULED_TASK_VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "ScheduledTaskValidationError";
  }
}

export class ScheduledTaskNotFoundError extends Error {
  readonly code = "SCHEDULED_TASK_NOT_FOUND";

  constructor(id: string) {
    super(`Scheduled task '${id}' not found for tenant`);
    this.name = "ScheduledTaskNotFoundError";
  }
}

export class ScheduledTaskInvalidStateError extends Error {
  readonly code = "SCHEDULED_TASK_INVALID_STATE";
  readonly currentStatus: ScheduledTaskStatus;

  constructor(id: string, currentStatus: ScheduledTaskStatus, targetStatus: ScheduledTaskStatus) {
    super(`Cannot transition scheduled task '${id}' from '${currentStatus}' to '${targetStatus}'`);
    this.name = "ScheduledTaskInvalidStateError";
    this.currentStatus = currentStatus;
  }
}

const SCHEDULED_TASK_STATUSES = new Set<string>(Object.values(ScheduledTaskStatus));

function assertValidDate(value: Date, fieldName: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ScheduledTaskValidationError(`${fieldName} must be a valid date`);
  }
}

function assertPositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ScheduledTaskValidationError(`${fieldName} must be a positive integer`);
  }
}

function assertPagination(input: ListScheduledTasksInput): { limit: number; offset: number } {
  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;
  assertPositiveInteger(limit, "limit");
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ScheduledTaskValidationError("offset must be a non-negative integer");
  }
  return { limit, offset };
}

function parseStatus(value: string | undefined): ScheduledTaskStatus | undefined {
  if (value === undefined) return undefined;
  if (!SCHEDULED_TASK_STATUSES.has(value)) {
    throw new ScheduledTaskValidationError(`Unknown scheduled task status '${value}'`);
  }
  return value as ScheduledTaskStatus;
}

function assertRetryCount(value: number | undefined): number {
  const maxRetries = value ?? 3;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new ScheduledTaskValidationError("maxRetries must be a non-negative integer");
  }
  return maxRetries;
}

function assertErrorMessage(value: string): string {
  const error = value.trim();
  if (!error) throw new ScheduledTaskValidationError("error must not be empty");
  return error;
}

export async function createScheduledTask(
  database: ScheduledTaskDatabase,
  input: CreateScheduledTaskInput,
): Promise<ScheduledTask> {
  const tenant = createTenantContext(input.tenantId);
  const name = input.name.trim();
  const taskType = input.taskType.trim();
  if (!name) throw new ScheduledTaskValidationError("name must not be empty");
  if (!taskType) throw new ScheduledTaskValidationError("taskType must not be empty");
  assertValidDate(input.scheduledFor, "scheduledFor");
  const maxRetries = assertRetryCount(input.maxRetries);
  const cronExpression =
    input.cronExpression === undefined || input.cronExpression === null
      ? null
      : input.cronExpression.trim();
  if (cronExpression !== null && !isValidCronExpression(cronExpression)) {
    throw new CronExpressionValidationError("Invalid cron expression");
  }

  return database.$transaction(async (transaction) => {
    await assertTenantOperational(tenant, transaction);
    return transaction.scheduledTask.create({
      data: {
        cronExpression,
        maxRetries,
        name,
        payload: input.payload ?? {},
        scheduledFor: input.scheduledFor,
        status: ScheduledTaskStatus.PENDING,
        taskType,
        tenantId: tenant.tenantId,
      },
    });
  });
}

export async function cancelScheduledTask(
  database: ScheduledTaskDatabase,
  params: { readonly tenantId: string; readonly id: string },
): Promise<ScheduledTask> {
  const tenant = createTenantContext(params.tenantId);

  return database.$transaction(async (transaction) => {
    await assertTenantOperational(tenant, transaction);
    const task = await transaction.scheduledTask.findUnique({
      where: { tenantId_id: { id: params.id, tenantId: tenant.tenantId } },
    });
    if (task === null) throw new ScheduledTaskNotFoundError(params.id);
    if (task.status === ScheduledTaskStatus.COMPLETED) {
      throw new ScheduledTaskInvalidStateError(task.id, task.status, ScheduledTaskStatus.CANCELLED);
    }
    if (task.status === ScheduledTaskStatus.CANCELLED) return task;

    return transaction.scheduledTask.update({
      data: { status: ScheduledTaskStatus.CANCELLED },
      where: { tenantId_id: { id: task.id, tenantId: tenant.tenantId } },
    });
  });
}

export async function listScheduledTasks(
  database: ScheduledTaskDatabase,
  input: ListScheduledTasksInput,
): Promise<{ tasks: ScheduledTask[]; total: number; limit: number; offset: number }> {
  const tenant = createTenantContext(input.tenantId);
  await assertTenantOperational(tenant, database);
  const { limit, offset } = assertPagination(input);
  const status = parseStatus(input.status);
  const where: Prisma.ScheduledTaskWhereInput = {
    tenantId: tenant.tenantId,
    ...(status === undefined ? {} : { status }),
  };

  const [tasks, total] = await Promise.all([
    database.scheduledTask.findMany({
      orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
      skip: offset,
      take: limit,
      where,
    }),
    database.scheduledTask.count({ where }),
  ]);
  return { limit, offset, tasks, total };
}

export async function claimDueScheduledTasks(
  database: ScheduledTaskDatabase,
  input: ClaimDueScheduledTasksInput,
): Promise<ScheduledTask[]> {
  assertValidDate(input.dueBefore, "dueBefore");
  assertPositiveInteger(input.limit, "limit");
  const tenant = input.tenantId === undefined ? undefined : createTenantContext(input.tenantId);

  return database.$transaction(async (transaction) => {
    if (tenant !== undefined) await assertTenantOperational(tenant, transaction);
    const tenantClause =
      tenant === undefined ? Prisma.sql`` : Prisma.sql`AND st.tenant_id = ${tenant.tenantId}::uuid`;
    const claimed = await transaction.$queryRaw<Array<{ id: string; tenantId: string }>>`
      WITH due_tasks AS (
        SELECT st.id, st.tenant_id
        FROM "scheduled_tasks" AS st
        INNER JOIN "tenant" AS t ON t.id = st.tenant_id
        WHERE st.status = 'PENDING'::"scheduled_task_status"
          AND st.scheduled_for <= ${input.dueBefore}
          AND t.status = 'active'::"tenant_status"
          ${tenantClause}
        ORDER BY st.scheduled_for ASC, st.id ASC
        FOR UPDATE OF st SKIP LOCKED
        LIMIT ${input.limit}
      )
      UPDATE "scheduled_tasks" AS st
      SET status = 'PROCESSING'::"scheduled_task_status",
          last_run_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      FROM due_tasks
      WHERE st.tenant_id = due_tasks.tenant_id
        AND st.id = due_tasks.id
      RETURNING st.id, st.tenant_id AS "tenantId"
    `;
    if (claimed.length === 0) return [];

    const tasks = await Promise.all(
      claimed.map(({ id, tenantId }) =>
        transaction.scheduledTask.findUnique({ where: { tenantId_id: { id, tenantId } } }),
      ),
    );
    return tasks
      .filter((task): task is ScheduledTask => task !== null)
      .sort(
        (left, right) =>
          left.scheduledFor.getTime() - right.scheduledFor.getTime() ||
          left.id.localeCompare(right.id),
      );
  });
}

export async function claimScheduledTask(
  database: ScheduledTaskDatabase,
  input: ClaimScheduledTaskInput,
): Promise<ScheduledTask | null> {
  const now = input.now ?? new Date();
  assertValidDate(now, "now");

  return database.$transaction(async (transaction) => {
    const task = await transaction.scheduledTask.findUnique({ where: { id: input.id } });
    if (task === null || task.tenantId !== input.expectedTenantId) return null;

    const tenant = createTenantContext(task.tenantId);
    await assertTenantOperational(tenant, transaction);
    const claimed = await transaction.scheduledTask.updateMany({
      data: { status: ScheduledTaskStatus.PROCESSING },
      where: {
        id: task.id,
        scheduledFor: { lte: now },
        status: ScheduledTaskStatus.PENDING,
        tenantId: tenant.tenantId,
      },
    });
    if (claimed.count === 0) return null;

    return transaction.scheduledTask.findUnique({
      where: { tenantId_id: { id: task.id, tenantId: tenant.tenantId } },
    });
  });
}

export async function markScheduledTaskCompleted(
  database: ScheduledTaskDatabase,
  input: MarkScheduledTaskCompletedInput,
): Promise<ScheduledTask> {
  const tenant = createTenantContext(input.tenantId);
  if (input.nextRunAt !== undefined) assertValidDate(input.nextRunAt, "nextRunAt");

  return database.$transaction(async (transaction) => {
    await assertTenantOperational(tenant, transaction);
    const task = await transaction.scheduledTask.findUnique({
      where: { tenantId_id: { id: input.id, tenantId: tenant.tenantId } },
    });
    if (task === null) throw new ScheduledTaskNotFoundError(input.id);
    if (task.status !== ScheduledTaskStatus.PROCESSING) {
      throw new ScheduledTaskInvalidStateError(task.id, task.status, ScheduledTaskStatus.COMPLETED);
    }

    return transaction.scheduledTask.update({
      data: {
        lastRunAt: new Date(),
        ...(input.nextRunAt === undefined ? {} : { nextRunAt: input.nextRunAt }),
        status: ScheduledTaskStatus.COMPLETED,
      },
      where: { tenantId_id: { id: task.id, tenantId: tenant.tenantId } },
    });
  });
}

export async function markScheduledTaskFailed(
  database: ScheduledTaskDatabase,
  input: MarkScheduledTaskFailedInput,
): Promise<ScheduledTask> {
  const tenant = createTenantContext(input.tenantId);
  const error = assertErrorMessage(input.error);

  return database.$transaction(async (transaction) => {
    await assertTenantOperational(tenant, transaction);
    const task = await transaction.scheduledTask.findUnique({
      where: { tenantId_id: { id: input.id, tenantId: tenant.tenantId } },
    });
    if (task === null) throw new ScheduledTaskNotFoundError(input.id);
    if (task.status !== ScheduledTaskStatus.PROCESSING) {
      throw new ScheduledTaskInvalidStateError(task.id, task.status, ScheduledTaskStatus.FAILED);
    }

    const retry = input.canRetry && task.retryCount < task.maxRetries;
    return transaction.scheduledTask.update({
      data: {
        errorMessage: error,
        ...(retry
          ? { retryCount: { increment: 1 }, status: ScheduledTaskStatus.PENDING }
          : { status: ScheduledTaskStatus.FAILED }),
      },
      where: { tenantId_id: { id: task.id, tenantId: tenant.tenantId } },
    });
  });
}

export async function rescheduleRecurringTask(
  database: ScheduledTaskDatabase,
  input: RescheduleRecurringTaskInput,
): Promise<ScheduledTask> {
  const tenant = createTenantContext(input.tenantId);
  assertValidDate(input.lastRunAt, "lastRunAt");

  return database.$transaction(async (transaction) => {
    await assertTenantOperational(tenant, transaction);
    const task = await transaction.scheduledTask.findUnique({
      where: { tenantId_id: { id: input.id, tenantId: tenant.tenantId } },
    });
    if (task === null) throw new ScheduledTaskNotFoundError(input.id);
    const targetStatus =
      task.cronExpression === null ? ScheduledTaskStatus.COMPLETED : ScheduledTaskStatus.PENDING;
    if (task.status !== ScheduledTaskStatus.PROCESSING) {
      throw new ScheduledTaskInvalidStateError(task.id, task.status, targetStatus);
    }

    if (task.cronExpression === null) {
      return transaction.scheduledTask.update({
        data: { lastRunAt: input.lastRunAt, status: ScheduledTaskStatus.COMPLETED },
        where: { tenantId_id: { id: task.id, tenantId: tenant.tenantId } },
      });
    }

    const nextRunAt = calculateNextRun(task.cronExpression, input.lastRunAt);
    return transaction.scheduledTask.update({
      data: {
        lastRunAt: input.lastRunAt,
        nextRunAt,
        scheduledFor: nextRunAt,
        status: ScheduledTaskStatus.PENDING,
      },
      where: { tenantId_id: { id: task.id, tenantId: tenant.tenantId } },
    });
  });
}
