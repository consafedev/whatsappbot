import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlatformDatabaseClient, type PrismaClient } from "./platform";
import {
  createPostgresWorkflowOrchestrator,
  WorkflowIntentConflictError,
} from "./postgres-workflow-orchestrator";

const prefix = "workflow-port-e14-s08";
let database: PrismaClient;
let tenantId = "";

async function uuidv7(): Promise<string> {
  const row = (await database.$queryRaw<Array<{ id: string }>>`SELECT uuidv7() AS id`)[0];
  if (row === undefined) throw new Error("Could not allocate a UUIDv7 fixture");
  return row.id;
}

async function cleanup(): Promise<void> {
  const tenants = await database.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length === 0) return;
  await database.scheduledTask.deleteMany({ where: { tenantId: { in: ids } } });
  await database.tenant.deleteMany({ where: { id: { in: ids } } });
}

describe.sequential("PostgreSQL WorkflowOrchestrator adapter", () => {
  beforeAll(async () => {
    database = createPlatformDatabaseClient(loadDatabaseConfig());
    await database.$connect();
    await cleanup();
    const tenant = await database.tenant.create({
      data: {
        displayName: prefix,
        legalName: prefix,
        slug: `${prefix}-${crypto.randomUUID()}`,
        status: "active",
        defaultTimezone: "UTC",
        defaultLocale: "es-MX",
        defaultCurrency: "MXN",
      },
    });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    if (database) {
      await cleanup();
      await database.$disconnect();
    }
  });

  it("serializes concurrent schedule calls with the same stable intent", async () => {
    const id = await uuidv7();
    const intent = {
      id,
      tenantId,
      taskType: "APPOINTMENT_REMINDER",
      name: "Recordatorio de cita",
      runAt: new Date(Date.now() + 60_000),
      payload: { reminderId: id },
    } as const;
    const schedule = () =>
      database.$transaction((transaction) =>
        createPostgresWorkflowOrchestrator(transaction).schedule(intent),
      );
    const [first, second] = await Promise.all([schedule(), schedule()]);
    expect(first).toEqual(second);
    expect(await database.scheduledTask.count({ where: { id, tenantId } })).toBe(1);
  });

  it("normalizes UUID case for an identical intent replay", async () => {
    const id = await uuidv7();
    const intent = {
      id,
      tenantId,
      taskType: "APPOINTMENT_REMINDER",
      name: "Recordatorio de cita",
      runAt: new Date(Date.now() + 60_000),
      payload: { reminderId: id },
    } as const;
    const first = await database.$transaction((transaction) =>
      createPostgresWorkflowOrchestrator(transaction).schedule(intent),
    );
    const replay = await database.$transaction((transaction) =>
      createPostgresWorkflowOrchestrator(transaction).schedule({
        ...intent,
        id: id.toUpperCase(),
        tenantId: tenantId.toUpperCase(),
      }),
    );
    expect(replay).toEqual(first);
  });

  it("replays the immutable intent after stale-task recovery moves its next run", async () => {
    const id = await uuidv7();
    const intent = {
      id,
      tenantId,
      taskType: "APPOINTMENT_REMINDER",
      name: "Recordatorio de cita",
      runAt: new Date(Date.now() + 60_000),
      payload: { reminderId: id },
    } as const;
    await database.$transaction((transaction) =>
      createPostgresWorkflowOrchestrator(transaction).schedule(intent),
    );
    await database.scheduledTask.update({
      data: { scheduledFor: new Date(Date.now() + 120_000), retryCount: 1 },
      where: { tenantId_id: { id, tenantId } },
    });

    const replay = await database.$transaction((transaction) =>
      createPostgresWorkflowOrchestrator(transaction).schedule(intent),
    );
    expect(replay).toEqual({ id, tenantId });
    await expect(
      database.$transaction((transaction) =>
        createPostgresWorkflowOrchestrator(transaction).schedule({
          ...intent,
          runAt: new Date(intent.runAt.getTime() + 60_000),
        }),
      ),
    ).rejects.toBeInstanceOf(WorkflowIntentConflictError);
  });

  it("rejects reuse of the same stable reference with different payload or run time", async () => {
    const id = await uuidv7();
    const intent = {
      id,
      tenantId,
      taskType: "APPOINTMENT_REMINDER",
      name: "Recordatorio de cita",
      runAt: new Date(Date.now() + 60_000),
      payload: { reminderId: id },
    } as const;
    await database.$transaction((transaction) =>
      createPostgresWorkflowOrchestrator(transaction).schedule(intent),
    );
    await expect(
      database.$transaction((transaction) =>
        createPostgresWorkflowOrchestrator(transaction).schedule({
          ...intent,
          payload: { reminderId: id, other: "value" },
        }),
      ),
    ).rejects.toBeInstanceOf(WorkflowIntentConflictError);
    await expect(
      database.$transaction((transaction) =>
        createPostgresWorkflowOrchestrator(transaction).schedule({
          ...intent,
          payload: { reminderId: id.toUpperCase() },
        }),
      ),
    ).rejects.toBeInstanceOf(WorkflowIntentConflictError);
    await expect(
      database.$transaction((transaction) =>
        createPostgresWorkflowOrchestrator(transaction).schedule({
          ...intent,
          runAt: new Date(intent.runAt.getTime() + 60_000),
        }),
      ),
    ).rejects.toBeInstanceOf(WorkflowIntentConflictError);
  });
});
