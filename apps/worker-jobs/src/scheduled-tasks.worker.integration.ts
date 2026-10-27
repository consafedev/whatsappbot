import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { recoverStaleScheduledTasks } from "@whatsapp-platform/database";
import {
  createPlatformDatabaseClient,
  type PrismaClient,
} from "@whatsapp-platform/database/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processScheduledTaskJob } from "./scheduled-tasks.worker";

const prefix = "e14-s08-worker-retry";
let database: PrismaClient;
let tenantId = "";

async function cleanup(): Promise<void> {
  const tenants = await database.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length === 0) return;
  await database.appointmentReminder.deleteMany({ where: { tenantId: { in: ids } } });
  await database.appointment.deleteMany({ where: { tenantId: { in: ids } } });
  await database.scheduledTaskRun.deleteMany({ where: { tenantId: { in: ids } } });
  await database.scheduledTask.deleteMany({ where: { tenantId: { in: ids } } });
  await database.appointmentService.deleteMany({ where: { tenantId: { in: ids } } });
  await database.appointmentResource.deleteMany({ where: { tenantId: { in: ids } } });
  await database.message.deleteMany({ where: { tenantId: { in: ids } } });
  await database.outboundMessage.deleteMany({ where: { tenantId: { in: ids } } });
  await database.conversation.deleteMany({ where: { tenantId: { in: ids } } });
  await database.channelAccount.deleteMany({ where: { tenantId: { in: ids } } });
  await database.contact.deleteMany({ where: { tenantId: { in: ids } } });
  await database.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await database.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await database.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await database.tenant.deleteMany({ where: { id: { in: ids } } });
}

describe.sequential("E14-S08 scheduled reminder retry history", () => {
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
    await database.tenantEntitlement.createMany({
      data: [
        "module.appointments",
        "module.scheduling",
        "module.messaging.basic",
        "module.crm_lite",
      ].map((entitlementKey) => ({
        entitlementKey,
        enabled: true,
        source: "contract",
        tenantId,
      })),
    });
  }, 60_000);

  afterAll(async () => {
    if (database) {
      await cleanup();
      await database.$disconnect();
    }
  }, 60_000);

  it("records one failed run and schedules a new bounded attempt before stale recovery", async () => {
    const now = new Date();
    const startsAt = new Date(now.getTime() + 60 * 60_000);
    const dueAt = new Date(now.getTime() - 1_000);
    const [contact, channel, service, resource] = await Promise.all([
      database.contact.create({
        data: { tenantId, name: "Retry Contact", phoneNumber: `+5255${Date.now()}` },
      }),
      database.channelAccount.create({
        data: {
          tenantId,
          active: true,
          displayName: "Retry Channel",
          providerType: "mock",
          status: "connected",
        },
      }),
      database.appointmentService.create({
        data: { tenantId, name: "Retry Service", durationMinutes: 30 },
      }),
      database.appointmentResource.create({
        data: { tenantId, name: "Retry Resource", capacity: 1 },
      }),
    ]);
    const conversation = await database.conversation.create({
      data: {
        tenantId,
        channelAccountId: channel.id,
        contactId: contact.id,
        status: "open",
        automationMode: "AUTO",
      },
    });
    const appointment = await database.appointment.create({
      data: {
        tenantId,
        contactId: contact.id,
        serviceId: service.id,
        resourceId: resource.id,
        idempotencyKey: `${prefix}-booking`,
        status: "CONFIRMED",
        confirmationStatus: "CONFIRMED",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        occupiedStartsAt: startsAt,
        occupiedEndsAt: new Date(startsAt.getTime() + 30 * 60_000),
        durationMinutes: 30,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        timezoneSnapshot: "UTC",
        source: "dashboard",
      },
    });
    const reminderId = (await database.$queryRaw<Array<{ id: string }>>`SELECT uuidv7() AS id`)[0]
      ?.id;
    if (reminderId === undefined) throw new Error("Could not allocate reminder id");
    await database.scheduledTask.create({
      data: {
        id: reminderId,
        tenantId,
        name: "Recordatorio de cita",
        taskType: "APPOINTMENT_REMINDER",
        payload: { reminderId },
        scheduledFor: dueAt,
        workflowRunAt: dueAt,
        status: "PENDING",
      },
    });
    await database.appointmentReminder.create({
      data: {
        id: reminderId,
        tenantId,
        appointmentId: appointment.id,
        conversationId: conversation.id,
        offsetMinutes: 30,
        dueAt,
        taskId: reminderId,
        status: "PENDING",
      },
    });

    await database.$executeRawUnsafe(`CREATE FUNCTION e14_s08_fail_reminder_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'message.queued' THEN
          RAISE EXCEPTION 'intentional E14-S08 queue persistence failure';
        END IF;
        RETURN NEW;
      END $$`);
    await database.$executeRawUnsafe(
      "CREATE TRIGGER e14_s08_fail_reminder_enqueue BEFORE INSERT ON domain_event_outbox FOR EACH ROW EXECUTE FUNCTION e14_s08_fail_reminder_enqueue()",
    );
    try {
      await processScheduledTaskJob(
        { data: { taskId: reminderId, tenantId } },
        { database, enqueue: async () => undefined, now: () => now },
      );

      const failedAttempt = await database.scheduledTask.findUniqueOrThrow({
        where: { tenantId_id: { id: reminderId, tenantId } },
      });
      expect(failedAttempt).toMatchObject({
        status: "PENDING",
        retryCount: 1,
        errorMessage: "APPOINTMENT_REMINDER_EXECUTION_FAILED",
      });
      expect(failedAttempt.scheduledFor.getTime()).toBeGreaterThan(now.getTime());
      await expect(
        database.scheduledTaskRun.findMany({ where: { tenantId, taskId: reminderId } }),
      ).resolves.toMatchObject([{ status: "FAILED", retryAttempt: 0 }]);
      await expect(
        database.outboundMessage.count({
          where: { tenantId, idempotencyKey: `appointment-reminder:${appointment.id}:30` },
        }),
      ).resolves.toBe(0);

      const recovery = await recoverStaleScheduledTasks(database, {
        limit: 10,
        staleBefore: new Date(now.getTime() + 60_000),
      });
      expect(recovery.recoveredCount).toBe(0);
      await expect(
        database.scheduledTask.findUniqueOrThrow({
          where: { tenantId_id: { id: reminderId, tenantId } },
        }),
      ).resolves.toMatchObject({ status: "PENDING", retryCount: 1 });
      await expect(
        database.scheduledTaskRun.count({
          where: { tenantId, taskId: reminderId, status: "TIMEOUT" },
        }),
      ).resolves.toBe(0);
      await expect(
        database.scheduledTaskRun.count({ where: { tenantId, taskId: reminderId } }),
      ).resolves.toBe(1);
    } finally {
      await database.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS e14_s08_fail_reminder_enqueue ON domain_event_outbox",
      );
      await database.$executeRawUnsafe("DROP FUNCTION IF EXISTS e14_s08_fail_reminder_enqueue()");
    }
  });
});
