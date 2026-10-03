import {
  applyDecorators,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import {
  calculateNextRun,
  cancelScheduledTask,
  createScheduledTask,
  isValidCronExpression,
  listScheduledTaskRuns,
  listScheduledTasks,
  type Prisma,
  retryScheduledTask,
  type ScheduledTaskDatabase,
  ScheduledTaskInvalidStateError,
  ScheduledTaskNotFoundError,
  ScheduledTaskValidationError,
  type TenantContext,
  TenantNotOperationalError,
} from "@whatsapp-platform/database";
import type { PermissionKey } from "@whatsapp-platform/rbac";
import { NoopScheduledTaskQueue, type ScheduledTaskQueue } from "./scheduled-tasks-queue";
import { TenantUserSessionGuard } from "./tenant-auth";
import { CurrentTenantContext, TenantContextGuard } from "./tenant-context";
import { RequireEntitlements, TenantEntitlementGuard } from "./tenant-entitlements";
import { RequirePermissions, TenantPermissionGuard } from "./tenant-rbac";

export const SCHEDULED_TASKS_DATABASE = Symbol("SCHEDULED_TASKS_DATABASE");
export const SCHEDULED_TASKS_QUEUE = Symbol("SCHEDULED_TASKS_QUEUE");

function scheduledTasksAuthorized(
  ...permissions: readonly PermissionKey[]
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    RequirePermissions(...permissions),
    UseGuards(
      TenantUserSessionGuard,
      TenantContextGuard,
      TenantPermissionGuard,
      TenantEntitlementGuard,
    ),
  );
}

export interface CreateScheduledTaskDto {
  readonly name?: string;
  readonly taskType?: string;
  readonly payload?: unknown;
  readonly cronExpression?: string | null;
  readonly scheduledFor?: string;
  readonly maxRetries?: number;
}

export interface ListScheduledTasksQuery {
  readonly status?: string;
  readonly limit?: string;
  readonly offset?: string;
}

export interface ListScheduledTaskRunsQuery {
  readonly limit?: string;
  readonly offset?: string;
}

function parseRunQueryInteger(value: string, field: string): number;
function parseRunQueryInteger(value: undefined, field: string): undefined;
function parseRunQueryInteger(value: string | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^(0|[1-9]\d*)$/u.test(value)) {
    throw new BadRequestException(`${field} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new BadRequestException(`${field} must be a safe integer`);
  }
  return parsed;
}

export interface RetryScheduledTaskDto {
  readonly runAt?: string;
}

function notOperational(error: unknown): unknown {
  if (error instanceof TenantNotOperationalError) {
    return new ForbiddenException({
      code: "TENANT_NOT_OPERATIONAL",
      error: "Forbidden",
      message: "Tenant is not operational",
      statusCode: 403,
    });
  }
  return error;
}

@Injectable()
export class ScheduledTasksService {
  constructor(
    @Inject(SCHEDULED_TASKS_DATABASE) private readonly database: ScheduledTaskDatabase,
    @Inject(SCHEDULED_TASKS_QUEUE) private readonly queue: ScheduledTaskQueue,
  ) {}

  async create(context: TenantContext, dto: CreateScheduledTaskDto) {
    try {
      const cronExpression =
        dto.cronExpression === undefined || dto.cronExpression === null
          ? dto.cronExpression
          : dto.cronExpression.trim();
      if (
        cronExpression !== undefined &&
        cronExpression !== null &&
        !isValidCronExpression(cronExpression)
      ) {
        throw new BadRequestException("Invalid cron expression");
      }
      const scheduledFor =
        dto.scheduledFor === undefined && typeof cronExpression === "string"
          ? calculateNextRun(cronExpression, new Date())
          : new Date(dto.scheduledFor ?? "");
      const task = await createScheduledTask(this.database, {
        tenantId: context.tenantId,
        name: dto.name ?? "",
        taskType: dto.taskType ?? "",
        payload: dto.payload as Prisma.InputJsonValue,
        scheduledFor,
        ...(cronExpression === undefined ? {} : { cronExpression }),
        ...(dto.maxRetries === undefined ? {} : { maxRetries: dto.maxRetries }),
      });

      if (task.scheduledFor.getTime() > Date.now()) {
        try {
          await this.queue.enqueue(task);
        } catch {
          throw new ServiceUnavailableException("Scheduled task queue is unavailable");
        }
      }

      return task;
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) throw error;
      if (error instanceof ScheduledTaskValidationError) {
        throw new BadRequestException(error.message);
      }
      throw notOperational(error);
    }
  }

  async list(context: TenantContext, query: ListScheduledTasksQuery) {
    try {
      return await listScheduledTasks(this.database, {
        tenantId: context.tenantId,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.limit === undefined ? {} : { limit: Number.parseInt(query.limit, 10) }),
        ...(query.offset === undefined ? {} : { offset: Number.parseInt(query.offset, 10) }),
      });
    } catch (error: unknown) {
      if (error instanceof ScheduledTaskValidationError) {
        throw new BadRequestException(error.message);
      }
      throw notOperational(error);
    }
  }

  async listRuns(context: TenantContext, query: ListScheduledTaskRunsQuery, taskId?: string) {
    try {
      if (taskId !== undefined) {
        const task = await this.database.scheduledTask.findUnique({
          where: { tenantId_id: { id: taskId, tenantId: context.tenantId } },
          select: { id: true },
        });
        if (task === null) throw new NotFoundException("Scheduled task not found");
      }
      return await listScheduledTaskRuns(this.database, {
        tenantId: context.tenantId,
        ...(taskId === undefined ? {} : { taskId }),
        ...(query.limit === undefined ? {} : { limit: parseRunQueryInteger(query.limit, "limit") }),
        ...(query.offset === undefined
          ? {}
          : { offset: parseRunQueryInteger(query.offset, "offset") }),
      });
    } catch (error: unknown) {
      if (error instanceof NotFoundException) throw error;
      if (error instanceof ScheduledTaskValidationError) {
        throw new BadRequestException(error.message);
      }
      throw notOperational(error);
    }
  }

  async cancel(context: TenantContext, taskId: string) {
    try {
      return await cancelScheduledTask(this.database, {
        tenantId: context.tenantId,
        id: taskId,
      });
    } catch (error: unknown) {
      if (error instanceof ScheduledTaskNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof ScheduledTaskInvalidStateError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof ScheduledTaskValidationError) {
        throw new BadRequestException(error.message);
      }
      throw notOperational(error);
    }
  }

  async retry(context: TenantContext, taskId: string, dto: RetryScheduledTaskDto = {}) {
    try {
      if (dto.runAt !== undefined && typeof dto.runAt !== "string") {
        throw new ScheduledTaskValidationError("runAt must be a valid date");
      }
      const task = await retryScheduledTask(this.database, {
        tenantId: context.tenantId,
        id: taskId,
        ...(dto.runAt === undefined ? {} : { runAt: new Date(dto.runAt) }),
      });
      try {
        await this.queue.enqueue(task);
      } catch {
        throw new ServiceUnavailableException("Scheduled task queue is unavailable");
      }
      return task;
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) throw error;
      if (error instanceof ScheduledTaskNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof ScheduledTaskInvalidStateError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof ScheduledTaskValidationError) {
        throw new BadRequestException(error.message);
      }
      throw notOperational(error);
    }
  }
}

@Controller("api/v1/scheduled-tasks")
@RequireEntitlements("module.scheduling")
export class ScheduledTasksController {
  constructor(private readonly service: ScheduledTasksService) {}

  @Get()
  @scheduledTasksAuthorized("scheduling.read")
  async list(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: ListScheduledTasksQuery,
  ) {
    const data = await this.service.list(context, query);
    return { success: true, data };
  }

  @Get("runs")
  @scheduledTasksAuthorized("scheduling.read")
  async listTenantRuns(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: ListScheduledTaskRunsQuery,
  ) {
    const data = await this.service.listRuns(context, query);
    return { success: true, data };
  }

  @Get(":id/runs")
  @scheduledTasksAuthorized("scheduling.read")
  async listTaskRuns(
    @CurrentTenantContext() context: TenantContext,
    @Param("id") taskId: string,
    @Query() query: ListScheduledTaskRunsQuery,
  ) {
    const data = await this.service.listRuns(context, query, taskId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @scheduledTasksAuthorized("scheduling.manage")
  async create(
    @CurrentTenantContext() context: TenantContext,
    @Body() body: CreateScheduledTaskDto,
  ) {
    const data = await this.service.create(context, body ?? {});
    return { success: true, data };
  }

  @Delete(":taskId")
  @scheduledTasksAuthorized("scheduling.manage")
  async cancel(@CurrentTenantContext() context: TenantContext, @Param("taskId") taskId: string) {
    const data = await this.service.cancel(context, taskId);
    return { success: true, data };
  }

  @Post(":id/retry")
  @HttpCode(HttpStatus.OK)
  @scheduledTasksAuthorized("scheduling.manage")
  async retry(
    @CurrentTenantContext() context: TenantContext,
    @Param("id") taskId: string,
    @Body() body?: RetryScheduledTaskDto,
  ) {
    const data = await this.service.retry(context, taskId, body ?? {});
    return { success: true, data };
  }
}

export function createDefaultScheduledTaskQueue(): ScheduledTaskQueue {
  return new NoopScheduledTaskQueue();
}
