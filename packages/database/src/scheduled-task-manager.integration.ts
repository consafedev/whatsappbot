import { loadDatabaseConfig } from "@whatsapp-platform/config";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  type PrismaClient,
  syncPermissionCatalog,
} from "@whatsapp-platform/database/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CronExpressionValidationError } from "./cron-evaluator";
import { ScheduledTaskStatus } from "./generated/prisma/enums";
import {
  cancelScheduledTask,
  claimDueScheduledTasks,
  claimScheduledTask,
  createScheduledTask,
  listScheduledTasks,
  markScheduledTaskCompleted,
  markScheduledTaskFailed,
  rescheduleRecurringTask,
  ScheduledTaskInvalidStateError,
  ScheduledTaskNotFoundError,
  ScheduledTaskValidationError,
} from "./scheduled-task-manager";

const prefix = "e13-s01-scheduled-task-db";
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length === 0) return;

  await prisma.scheduledTask.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userSession.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userPasswordResetToken.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userRole.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: ids } } } });
  await prisma.role.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

async function provision(marker: string): Promise<string> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Scheduled Task ${marker}`,
    enabledModules: ["module.scheduling"],
    legalName: `Scheduled Task ${marker} SA de CV`,
    limits: {
      channelAccounts: 1,
      monthlyAiBudget: null,
      organizationUnits: 1,
      storageBytes: 1024,
      users: 1,
    },
    owner: {
      displayName: `Scheduled Task Owner ${marker}`,
      email: `${prefix}-${marker}@example.invalid`,
      locale: "es-MX",
      passwordHash: "$argon2id$test-hash-not-reversible",
      timezone: "America/Mexico_City",
    },
    requestId: `${prefix}-${marker}`,
    slug: `${prefix}-${marker}`,
  });
  return result.tenant.id;
}

function futureDate(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

function pastDate(minutes = 1): Date {
  return new Date(Date.now() - minutes * 60_000);
}

describe.sequential("scheduled-task-manager integration", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    tenantAId = await provision("a");
    tenantBId = await provision("b");
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("creates pending tasks with durable defaults and validates required fields", async () => {
    const task = await createScheduledTask(prisma, {
      name: "Enviar recordatorio",
      payload: { contactId: "contact-a" },
      scheduledFor: futureDate(10),
      taskType: "send.reminder",
      tenantId: tenantAId,
    });

    expect(task.tenantId).toBe(tenantAId);
    expect(task.status).toBe("PENDING");
    expect(task.retryCount).toBe(0);
    expect(task.maxRetries).toBe(3);
    expect(task.payload).toEqual({ contactId: "contact-a" });
    expect(task.nextRunAt).toBeNull();

    await expect(
      createScheduledTask(prisma, {
        name: "Invalid date",
        scheduledFor: new Date("invalid"),
        taskType: "send.reminder",
        tenantId: tenantAId,
      }),
    ).rejects.toBeInstanceOf(ScheduledTaskValidationError);

    await expect(
      createScheduledTask(prisma, {
        name: "Invalid type",
        scheduledFor: futureDate(10),
        taskType: "  ",
        tenantId: tenantAId,
      }),
    ).rejects.toBeInstanceOf(ScheduledTaskValidationError);

    await expect(
      createScheduledTask(prisma, {
        cronExpression: "@daily",
        name: "Invalid cron",
        scheduledFor: futureDate(10),
        taskType: "send.reminder",
        tenantId: tenantAId,
      }),
    ).rejects.toBeInstanceOf(CronExpressionValidationError);
  });

  it("lists only the current tenant and cancels by tenant-scoped composite key", async () => {
    const taskA = await createScheduledTask(prisma, {
      name: "Tenant A task",
      scheduledFor: futureDate(20),
      taskType: "tenant.a",
      tenantId: tenantAId,
    });
    const taskB = await createScheduledTask(prisma, {
      name: "Tenant B task",
      scheduledFor: futureDate(20),
      taskType: "tenant.b",
      tenantId: tenantBId,
    });

    const listA = await listScheduledTasks(prisma, { limit: 50, tenantId: tenantAId });
    expect(listA.tasks.some(({ id }) => id === taskA.id)).toBe(true);
    expect(listA.tasks.some(({ id }) => id === taskB.id)).toBe(false);

    await expect(
      cancelScheduledTask(prisma, { id: taskA.id, tenantId: tenantBId }),
    ).rejects.toBeInstanceOf(ScheduledTaskNotFoundError);

    const cancelled = await cancelScheduledTask(prisma, {
      id: taskA.id,
      tenantId: tenantAId,
    });
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("does not cancel completed tasks and persists completion/failure transitions", async () => {
    const task = await createScheduledTask(prisma, {
      name: "State machine task",
      scheduledFor: pastDate(),
      taskType: "state.machine",
      tenantId: tenantAId,
    });
    const processing = (
      await claimDueScheduledTasks(prisma, {
        dueBefore: new Date(),
        limit: 1,
        tenantId: tenantAId,
      })
    )[0];
    expect(processing?.id).toBe(task.id);

    const completed = await markScheduledTaskCompleted(prisma, {
      id: task.id,
      nextRunAt: futureDate(30),
      tenantId: tenantAId,
    });
    expect(completed.status).toBe("COMPLETED");
    expect(completed.nextRunAt).toBeInstanceOf(Date);

    await expect(
      cancelScheduledTask(prisma, { id: task.id, tenantId: tenantAId }),
    ).rejects.toBeInstanceOf(ScheduledTaskInvalidStateError);

    const failedTask = await createScheduledTask(prisma, {
      name: "Retryable task",
      scheduledFor: pastDate(),
      taskType: "retryable",
      tenantId: tenantAId,
      maxRetries: 1,
    });
    await claimDueScheduledTasks(prisma, { dueBefore: new Date(), limit: 1, tenantId: tenantAId });
    const retrying = await markScheduledTaskFailed(prisma, {
      canRetry: true,
      error: "Temporary error",
      id: failedTask.id,
      tenantId: tenantAId,
    });
    expect(retrying.status).toBe("PENDING");
    expect(retrying.retryCount).toBe(1);

    await claimDueScheduledTasks(prisma, { dueBefore: new Date(), limit: 1, tenantId: tenantAId });
    const failed = await markScheduledTaskFailed(prisma, {
      canRetry: true,
      error: "Retry exhausted",
      id: failedTask.id,
      tenantId: tenantAId,
    });
    expect(failed.status).toBe("FAILED");
  });

  it("claims due tasks atomically without duplicates and never crosses tenants", async () => {
    const taskIds = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        createScheduledTask(prisma, {
          name: `Concurrent ${index}`,
          scheduledFor: pastDate(2),
          taskType: "concurrent",
          tenantId: tenantAId,
        }).then(({ id }) => id),
      ),
    );

    const [first, second] = await Promise.all([
      claimDueScheduledTasks(prisma, { dueBefore: new Date(), limit: 2, tenantId: tenantAId }),
      claimDueScheduledTasks(prisma, { dueBefore: new Date(), limit: 2, tenantId: tenantAId }),
    ]);
    const claimedIds = [...first, ...second].map(({ id }) => id);
    expect(new Set(claimedIds).size).toBe(4);
    expect(new Set(claimedIds)).toEqual(new Set(taskIds));

    const crossTenantClaim = await claimDueScheduledTasks(prisma, {
      dueBefore: new Date(),
      limit: 50,
      tenantId: tenantBId,
    });
    expect(crossTenantClaim.some(({ id }) => taskIds.includes(id))).toBe(false);
  });

  it("claims scheduled work by tenant identity and advances only recurring processing tasks", async () => {
    const dueAt = new Date("2026-01-05T09:00:00.000Z");
    const claimAt = new Date("2026-01-05T09:00:00.000Z");
    const recurringTask = await createScheduledTask(prisma, {
      cronExpression: "0 9 * * 1-5",
      name: "Weekday recurring task",
      payload: { source: "cron" },
      scheduledFor: dueAt,
      taskType: "send.follow-up",
      tenantId: tenantAId,
    });
    const earlyTask = await createScheduledTask(prisma, {
      name: "Early task",
      scheduledFor: new Date("2026-01-05T09:01:00.000Z"),
      taskType: "send.follow-up",
      tenantId: tenantAId,
    });
    const tenantBTask = await createScheduledTask(prisma, {
      name: "Tenant B task",
      scheduledFor: dueAt,
      taskType: "send.follow-up",
      tenantId: tenantBId,
    });

    await expect(
      claimScheduledTask(prisma, {
        expectedTenantId: tenantBTask.tenantId,
        id: recurringTask.id,
        now: claimAt,
      }),
    ).resolves.toBeNull();
    await expect(
      claimScheduledTask(prisma, {
        expectedTenantId: tenantAId,
        id: earlyTask.id,
        now: claimAt,
      }),
    ).resolves.toBeNull();

    const claimed = await claimScheduledTask(prisma, {
      expectedTenantId: tenantAId,
      id: recurringTask.id,
      now: claimAt,
    });
    expect(claimed?.status).toBe(ScheduledTaskStatus.PROCESSING);
    await expect(
      claimScheduledTask(prisma, {
        expectedTenantId: tenantAId,
        id: recurringTask.id,
        now: claimAt,
      }),
    ).resolves.toBeNull();

    const rescheduled = await rescheduleRecurringTask(prisma, {
      id: recurringTask.id,
      lastRunAt: claimAt,
      tenantId: tenantAId,
    });
    expect(rescheduled.status).toBe(ScheduledTaskStatus.PENDING);
    expect(rescheduled.scheduledFor).toEqual(new Date("2026-01-06T09:00:00.000Z"));
    expect(rescheduled.nextRunAt).toEqual(new Date("2026-01-06T09:00:00.000Z"));
    expect(rescheduled.lastRunAt).toEqual(claimAt);
    expect(rescheduled.retryCount).toBe(0);

    const oneTimeTask = await createScheduledTask(prisma, {
      name: "One-time task",
      scheduledFor: dueAt,
      taskType: "send.follow-up",
      tenantId: tenantAId,
    });
    await claimScheduledTask(prisma, {
      expectedTenantId: tenantAId,
      id: oneTimeTask.id,
      now: claimAt,
    });

    const completed = await rescheduleRecurringTask(prisma, {
      id: oneTimeTask.id,
      lastRunAt: claimAt,
      tenantId: tenantAId,
    });
    expect(completed.status).toBe(ScheduledTaskStatus.COMPLETED);
    expect(completed.lastRunAt).toEqual(claimAt);
    expect(completed.retryCount).toBe(0);
  });

  it("allows only one concurrent recurring reschedule transition", async () => {
    const dueAt = new Date("2026-01-05T09:00:00.000Z");
    const task = await createScheduledTask(prisma, {
      cronExpression: "0 9 * * 1-5",
      name: "Concurrent recurring task",
      scheduledFor: dueAt,
      taskType: "send.follow-up",
      tenantId: tenantAId,
    });
    await claimScheduledTask(prisma, {
      expectedTenantId: tenantAId,
      id: task.id,
      now: dueAt,
    });

    const results = await Promise.allSettled([
      rescheduleRecurringTask(prisma, {
        id: task.id,
        lastRunAt: dueAt,
        tenantId: tenantAId,
      }),
      rescheduleRecurringTask(prisma, {
        id: task.id,
        lastRunAt: dueAt,
        tenantId: tenantAId,
      }),
    ]);
    const fulfilled = results.filter(({ status }) => status === "fulfilled");
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(ScheduledTaskInvalidStateError);
    expect(
      await prisma.scheduledTask.findUnique({
        where: { tenantId_id: { id: task.id, tenantId: tenantAId } },
      }),
    ).toMatchObject({
      lastRunAt: dueAt,
      nextRunAt: new Date("2026-01-06T09:00:00.000Z"),
      scheduledFor: new Date("2026-01-06T09:00:00.000Z"),
      status: ScheduledTaskStatus.PENDING,
    });
  });
});
