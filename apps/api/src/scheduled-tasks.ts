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
  cancelScheduledTask,
  createScheduledTask,
  listScheduledTasks,
  type Prisma,
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
      const task = await createScheduledTask(this.database, {
        tenantId: context.tenantId,
        name: dto.name ?? "",
        taskType: dto.taskType ?? "",
        payload: dto.payload as Prisma.InputJsonValue,
        scheduledFor: new Date(dto.scheduledFor ?? ""),
        ...(dto.cronExpression === undefined ? {} : { cronExpression: dto.cronExpression }),
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
}

export function createDefaultScheduledTaskQueue(): ScheduledTaskQueue {
  return new NoopScheduledTaskQueue();
}
