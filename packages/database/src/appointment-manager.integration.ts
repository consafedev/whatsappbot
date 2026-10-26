import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AppointmentConflictError,
  AppointmentNotFoundError,
  AppointmentValidationError,
  createAppointment,
  getAppointmentById,
  listAppointments,
} from "./appointment-manager";
import {
  AppointmentResourceCapacityConflictError,
  updateAppointmentResource,
} from "./appointment-resource-manager";
import { createPlatformDatabaseClient, type PrismaClient } from "./platform";
import { createTenantContext } from "./tenant-context";
import { TenantModuleEntitlementRequiredError } from "./tenant-entitlements";
import { TenantNotOperationalError } from "./tenant-operational";

const prefix = "e14-s06-booking";
let database: PrismaClient;
let tenant = "",
  foreignTenant = "",
  user = "",
  contact = "",
  service = "",
  longService = "";
let start: Date;
const actor = () => ({ actorUserId: user, requestId: `${prefix}-request` });
const context = () => createTenantContext(tenant);
const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000).toISOString();

async function cleanup() {
  const rows = await database.tenant.findMany({
    where: { slug: { startsWith: prefix } },
    select: { id: true },
  });
  const ids = rows.map((row) => row.id);
  await database.appointment.deleteMany({ where: { tenantId: { in: ids } } });
  await database.appointmentAvailabilityRule.deleteMany({ where: { tenantId: { in: ids } } });
  await database.appointmentResource.deleteMany({ where: { tenantId: { in: ids } } });
  await database.appointmentService.deleteMany({ where: { tenantId: { in: ids } } });
  await database.contact.deleteMany({ where: { tenantId: { in: ids } } });
  await database.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await database.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await database.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await database.user.deleteMany({ where: { tenantId: { in: ids } } });
  await database.tenant.deleteMany({ where: { id: { in: ids } } });
}

async function resource(capacity: number) {
  const row = await database.appointmentResource.create({
    data: { tenantId: tenant, name: `Resource ${crypto.randomUUID()}`, capacity },
  });
  await database.appointmentAvailabilityRule.create({
    data: {
      tenantId: tenant,
      resourceId: row.id,
      dayOfWeek: start.getUTCDay(),
      startTime: "08:00",
      endTime: "12:00",
      timezone: "UTC",
      capacity,
    },
  });
  return row.id;
}

describe.sequential("E14-S06 transactional appointment booking", () => {
  beforeAll(async () => {
    database = createPlatformDatabaseClient(loadDatabaseConfig());
    await database.$connect();
    await cleanup();
    start = new Date();
    start.setUTCDate(start.getUTCDate() + 14);
    start.setUTCHours(9, 0, 0, 0);
    const [a, b] = await Promise.all(
      ["a", "b"].map((suffix) =>
        database.tenant.create({
          data: {
            slug: `${prefix}-${suffix}`,
            status: "active",
            legalName: suffix,
            displayName: suffix,
            defaultTimezone: "UTC",
            defaultLocale: "es-MX",
            defaultCurrency: "MXN",
          },
        }),
      ),
    );
    if (!a || !b) throw new Error("tenant fixture failed");
    tenant = a.id;
    foreignTenant = b.id;
    await database.tenantEntitlement.create({
      data: {
        tenantId: tenant,
        entitlementKey: "module.appointments",
        enabled: true,
        source: "contract",
      },
    });
    await database.tenantEntitlement.create({
      data: {
        tenantId: foreignTenant,
        entitlementKey: "module.appointments",
        enabled: true,
        source: "contract",
      },
    });
    const [actorRow, contactRow, shortRow, longRow] = await Promise.all([
      database.user.create({
        data: {
          tenantId: tenant,
          email: `${prefix}@example.invalid`,
          passwordHash: "test-hash",
          displayName: "Actor",
          status: "active",
          locale: "es-MX",
          timezone: "UTC",
        },
      }),
      database.contact.create({
        data: { tenantId: tenant, name: "Contact", phoneNumber: "+525500000006" },
      }),
      database.appointmentService.create({
        data: { tenantId: tenant, name: "Short", durationMinutes: 30 },
      }),
      database.appointmentService.create({
        data: { tenantId: tenant, name: "Long", durationMinutes: 60 },
      }),
    ]);
    user = actorRow.id;
    contact = contactRow.id;
    service = shortRow.id;
    longService = longRow.id;
  }, 60_000);
  afterAll(async () => {
    if (database) {
      await cleanup();
      await database.$disconnect();
    }
  }, 60_000);

  it("serializes concurrent capacity-one creation and returns identical replay without duplicate side effects", async () => {
    const resourceId = await resource(1);
    const command = {
      serviceId: service,
      resourceId,
      contactId: contact,
      startsAt: at(0),
      idempotencyKey: "capacity-one",
    };
    const attempts = await Promise.allSettled([
      createAppointment(context(), database, command, actor()),
      createAppointment(
        context(),
        database,
        { ...command, idempotencyKey: "capacity-one-other" },
        actor(),
      ),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      attempts.filter(
        (result) =>
          result.status === "rejected" && result.reason instanceof AppointmentConflictError,
      ),
    ).toHaveLength(1);
    const winner = attempts.find((result) => result.status === "fulfilled");
    if (winner?.status !== "fulfilled") throw new Error("no booking winner");
    const replay = await createAppointment(
      context(),
      database,
      { ...command, idempotencyKey: winner.value.idempotencyKey },
      actor(),
    );
    expect(replay.id).toBe(winner.value.id);
    await expect(
      createAppointment(
        context(),
        database,
        { ...command, idempotencyKey: winner.value.idempotencyKey, notes: "changed" },
        actor(),
      ),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
    expect(
      await database.auditLog.count({
        where: { tenantId: tenant, entityId: winner.value.id, action: "appointment.created" },
      }),
    ).toBe(1);
    expect(
      await database.domainEventOutbox.count({
        where: { tenantId: tenant, aggregateId: winner.value.id, eventType: "appointment.created" },
      }),
    ).toBe(1);
  });

  it("uses peak overlap with mixed durations and enforces capacity decrease", async () => {
    const resourceId = await resource(2);
    const common = { resourceId, contactId: contact };
    const first = await createAppointment(
      context(),
      database,
      { ...common, serviceId: service, startsAt: at(0), idempotencyKey: "mixed-a" },
      actor(),
    );
    const second = await createAppointment(
      context(),
      database,
      { ...common, serviceId: service, startsAt: at(30), idempotencyKey: "mixed-b" },
      actor(),
    );
    const third = await createAppointment(
      context(),
      database,
      { ...common, serviceId: longService, startsAt: at(0), idempotencyKey: "mixed-c" },
      actor(),
    );
    expect([first, second, third].every((row) => row.status === "CONFIRMED")).toBe(true);
    await expect(
      createAppointment(
        context(),
        database,
        { ...common, serviceId: service, startsAt: at(0), idempotencyKey: "mixed-d" },
        actor(),
      ),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
    await expect(
      updateAppointmentResource(context(), database, resourceId, { capacity: 1 }, actor()),
    ).rejects.toBeInstanceOf(AppointmentResourceCapacityConflictError);
    expect(
      (await database.appointmentResource.findUniqueOrThrow({ where: { id: resourceId } }))
        .capacity,
    ).toBe(2);
  });

  it("keeps stored duration snapshots and tenant-scoped reads", async () => {
    const resourceId = await resource(1);
    const appointment = await createAppointment(
      context(),
      database,
      {
        serviceId: service,
        resourceId,
        contactId: contact,
        startsAt: at(60),
        idempotencyKey: "snapshot",
      },
      actor(),
    );
    await database.appointmentService.update({
      where: { id: service },
      data: { durationMinutes: 45, bufferBeforeMinutes: 10 },
    });
    expect((await getAppointmentById(context(), database, appointment.id)).durationMinutes).toBe(
      30,
    );
    expect(
      (await getAppointmentById(context(), database, appointment.id)).occupiedStartsAt,
    ).toEqual(appointment.occupiedStartsAt);
    expect(
      (await listAppointments(context(), database, { resourceId })).items.map((row) => row.id),
    ).toContain(appointment.id);
    await database.appointmentService.update({
      where: { id: service },
      data: { durationMinutes: 30, bufferBeforeMinutes: 0 },
    });
    await expect(
      getAppointmentById(createTenantContext(foreignTenant), database, appointment.id),
    ).rejects.toBeInstanceOf(AppointmentNotFoundError);
    expect((await listAppointments(createTenantContext(foreignTenant), database)).total).toBe(0);
    await expect(
      createAppointment(
        createTenantContext(foreignTenant),
        database,
        {
          serviceId: service,
          resourceId,
          contactId: contact,
          startsAt: at(90),
          idempotencyKey: "foreign",
        },
        actor(),
      ),
    ).rejects.toThrow();
    await expect(
      getAppointmentById(context(), database, crypto.randomUUID()),
    ).rejects.toBeInstanceOf(AppointmentValidationError);
  });

  it("returns one receipt for concurrent identical idempotency keys", async () => {
    const resourceId = await resource(1);
    const command = {
      serviceId: service,
      resourceId,
      contactId: contact,
      startsAt: at(0),
      idempotencyKey: "same-key-race",
    };
    const [first, second] = await Promise.all([
      createAppointment(context(), database, command, actor()),
      createAppointment(context(), database, command, actor()),
    ]);
    expect(first.id).toBe(second.id);
    expect(
      await database.appointment.count({
        where: { tenantId: tenant, idempotencyKey: "same-key-race" },
      }),
    ).toBe(1);
    expect(
      await database.auditLog.count({
        where: { tenantId: tenant, entityId: first.id, action: "appointment.created" },
      }),
    ).toBe(1);
    await database.appointmentResource.update({
      where: { id: resourceId },
      data: { active: false },
    });
    expect((await createAppointment(context(), database, command, actor())).id).toBe(first.id);
    await database.user.update({ where: { id: user }, data: { status: "disabled" } });
    await expect(createAppointment(context(), database, command, actor())).rejects.toBeInstanceOf(
      AppointmentValidationError,
    );
    await database.user.update({ where: { id: user }, data: { status: "active" } });
  });

  it("replays uppercase UUID spelling without duplicating side effects", async () => {
    const resourceId = await resource(1);
    const command = {
      serviceId: service.toUpperCase(),
      resourceId: resourceId.toUpperCase(),
      contactId: contact.toUpperCase(),
      startsAt: at(0),
      idempotencyKey: "uppercase-uuid-replay",
    };
    const uppercaseActor = { ...actor(), actorUserId: user.toUpperCase() };
    const first = await createAppointment(context(), database, command, uppercaseActor);
    const replay = await createAppointment(context(), database, command, uppercaseActor);

    expect(replay.id).toBe(first.id);
    expect(
      await database.appointment.count({
        where: { tenantId: tenant, idempotencyKey: command.idempotencyKey },
      }),
    ).toBe(1);
    expect(
      await database.auditLog.count({
        where: { tenantId: tenant, entityId: first.id, action: "appointment.created" },
      }),
    ).toBe(1);
    expect(
      await database.domainEventOutbox.count({
        where: { tenantId: tenant, aggregateId: first.id, eventType: "appointment.created" },
      }),
    ).toBe(1);
  });

  it("serializes the same command across tenant UUID spellings", async () => {
    const resourceId = await resource(1);
    const command = {
      serviceId: service,
      resourceId,
      contactId: contact,
      startsAt: at(0),
      idempotencyKey: "mixed-tenant-spelling",
    };
    const attempts = await Promise.allSettled([
      createAppointment(context(), database, command, actor()),
      createAppointment(createTenantContext(tenant.toUpperCase()), database, command, actor()),
    ]);

    expect(attempts.every((result) => result.status === "fulfilled")).toBe(true);
    const receipts = attempts.map((result) => {
      if (result.status !== "fulfilled") throw result.reason;
      return result.value;
    });
    expect(receipts[0]?.id).toBe(receipts[1]?.id);
    expect(
      await database.appointment.count({
        where: { tenantId: tenant, idempotencyKey: command.idempotencyKey },
      }),
    ).toBe(1);
  });

  it("preserves case-sensitive opaque idempotency keys", async () => {
    const resourceId = await resource(2);
    const common = {
      serviceId: service,
      resourceId,
      contactId: contact,
      startsAt: at(0),
    };
    const upper = await createAppointment(
      context(),
      database,
      { ...common, idempotencyKey: "Opaque-Key" },
      actor(),
    );
    const lower = await createAppointment(
      context(),
      database,
      { ...common, idempotencyKey: "opaque-key" },
      actor(),
    );

    expect(lower.id).not.toBe(upper.id);
    expect(
      await database.appointment.count({
        where: { tenantId: tenant, idempotencyKey: { in: ["Opaque-Key", "opaque-key"] } },
      }),
    ).toBe(2);
  });

  it("respects buffers and continuous coverage across midnight", async () => {
    const buffered = await database.appointmentService.create({
      data: {
        tenantId: tenant,
        name: "Buffered",
        durationMinutes: 30,
        bufferBeforeMinutes: 15,
        bufferAfterMinutes: 15,
      },
    });
    const resourceId = await resource(1);
    const booked = await createAppointment(
      context(),
      database,
      {
        serviceId: buffered.id,
        resourceId,
        contactId: contact,
        startsAt: at(0),
        idempotencyKey: "buffered",
      },
      actor(),
    );
    expect(booked.occupiedStartsAt.toISOString()).toBe(at(-15));
    expect(booked.occupiedEndsAt.toISOString()).toBe(at(45));
    await expect(
      createAppointment(
        context(),
        database,
        {
          serviceId: buffered.id,
          resourceId,
          contactId: contact,
          startsAt: at(30),
          idempotencyKey: "buffer-overlap",
        },
        actor(),
      ),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
    const overnightResource = await database.appointmentResource.create({
      data: { tenantId: tenant, name: "Overnight" },
    });
    const night = new Date(start);
    night.setUTCHours(23, 30, 0, 0);
    const next = new Date(night.getTime() + 86_400_000);
    await database.appointmentAvailabilityRule.createMany({
      data: [
        {
          tenantId: tenant,
          resourceId: overnightResource.id,
          dayOfWeek: night.getUTCDay(),
          startTime: "23:00",
          endTime: "24:00",
          timezone: "UTC",
        },
        {
          tenantId: tenant,
          resourceId: overnightResource.id,
          dayOfWeek: next.getUTCDay(),
          startTime: "00:00",
          endTime: "02:00",
          timezone: "UTC",
        },
      ],
    });
    const acrossMidnight = await createAppointment(
      context(),
      database,
      {
        serviceId: longService,
        resourceId: overnightResource.id,
        contactId: contact,
        startsAt: night.toISOString(),
        idempotencyKey: "overnight",
      },
      actor(),
    );
    expect(acrossMidnight.endsAt.getUTCDate()).toBe(next.getUTCDate());
  });

  it("rejects cross-tenant and inactive targets before persistence", async () => {
    const resourceId = await resource(1);
    const foreignContact = await database.contact.create({
      data: { tenantId: foreignTenant, name: "Foreign", phoneNumber: "+525500000106" },
    });
    const input = {
      serviceId: service,
      resourceId,
      contactId: foreignContact.id,
      startsAt: at(0),
      idempotencyKey: "foreign-contact",
    };
    await expect(createAppointment(context(), database, input, actor())).rejects.toBeInstanceOf(
      AppointmentNotFoundError,
    );
    const inactiveContact = await database.contact.create({
      data: {
        tenantId: tenant,
        name: "Inactive",
        phoneNumber: "+525500000107",
        status: "INACTIVE",
      },
    });
    await expect(
      createAppointment(
        context(),
        database,
        { ...input, contactId: inactiveContact.id, idempotencyKey: "inactive-contact" },
        actor(),
      ),
    ).rejects.toBeInstanceOf(AppointmentNotFoundError);
    await database.appointmentResource.update({
      where: { id: resourceId },
      data: { active: false },
    });
    await expect(
      createAppointment(
        context(),
        database,
        { ...input, contactId: contact, idempotencyKey: "inactive-resource" },
        actor(),
      ),
    ).rejects.toBeInstanceOf(AppointmentNotFoundError);
    await database.appointmentResource.update({
      where: { id: resourceId },
      data: { active: true },
    });
    await database.appointmentService.update({ where: { id: service }, data: { active: false } });
    await expect(
      createAppointment(
        context(),
        database,
        { ...input, contactId: contact, idempotencyKey: "inactive-service" },
        actor(),
      ),
    ).rejects.toBeInstanceOf(AppointmentNotFoundError);
    await database.appointmentService.update({ where: { id: service }, data: { active: true } });
    await database.user.update({ where: { id: user }, data: { status: "disabled" } });
    await expect(
      createAppointment(
        context(),
        database,
        { ...input, contactId: contact, idempotencyKey: "inactive-actor" },
        actor(),
      ),
    ).rejects.toBeInstanceOf(AppointmentValidationError);
    await database.user.update({ where: { id: user }, data: { status: "active" } });
    expect(await database.appointment.count({ where: { tenantId: tenant, resourceId } })).toBe(0);
  });

  it("serializes a capacity decrease against a competing booking", async () => {
    const resourceId = await resource(2);
    const common = { serviceId: service, resourceId, contactId: contact, startsAt: at(0) };
    await createAppointment(
      context(),
      database,
      { ...common, idempotencyKey: "capacity-race-first" },
      actor(),
    );
    const outcomes = await Promise.allSettled([
      createAppointment(
        context(),
        database,
        { ...common, idempotencyKey: "capacity-race-second" },
        actor(),
      ),
      updateAppointmentResource(context(), database, resourceId, { capacity: 1 }, actor()),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(
      outcomes.filter(
        (outcome) =>
          outcome.status === "rejected" &&
          (outcome.reason instanceof AppointmentConflictError ||
            outcome.reason instanceof AppointmentResourceCapacityConflictError),
      ),
    ).toHaveLength(1);
    const capacity = (
      await database.appointmentResource.findUniqueOrThrow({ where: { id: resourceId } })
    ).capacity;
    const count = await database.appointment.count({
      where: { tenantId: tenant, resourceId, startsAt: start },
    });
    expect(count).toBeLessThanOrEqual(capacity);
  });

  it("rechecks operational tenant and module entitlement", async () => {
    const resourceId = await resource(1);
    const input = {
      serviceId: service,
      resourceId,
      contactId: contact,
      startsAt: at(0),
      idempotencyKey: "tenant-module-check",
    };
    await database.tenant.update({ where: { id: tenant }, data: { status: "suspended" } });
    await expect(createAppointment(context(), database, input, actor())).rejects.toBeInstanceOf(
      TenantNotOperationalError,
    );
    await database.tenant.update({ where: { id: tenant }, data: { status: "active" } });
    await database.tenantEntitlement.update({
      where: {
        tenantId_entitlementKey: { tenantId: tenant, entitlementKey: "module.appointments" },
      },
      data: { enabled: false },
    });
    await expect(createAppointment(context(), database, input, actor())).rejects.toBeInstanceOf(
      TenantModuleEntitlementRequiredError,
    );
    await database.tenantEntitlement.update({
      where: {
        tenantId_entitlementKey: { tenantId: tenant, entitlementKey: "module.appointments" },
      },
      data: { enabled: true },
    });
    expect(
      await database.appointment.count({
        where: { tenantId: tenant, idempotencyKey: input.idempotencyKey },
      }),
    ).toBe(0);
  });

  it("rolls back booking and audit when outbox insertion fails", async () => {
    const resourceId = await resource(1);
    const auditBefore = await database.auditLog.count({
      where: { tenantId: tenant, action: "appointment.created" },
    });
    const outboxBefore = await database.domainEventOutbox.count({
      where: { tenantId: tenant, eventType: "appointment.created" },
    });
    await database.$executeRawUnsafe(`CREATE FUNCTION e14_s06_reject_rollback() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'appointment.created' AND EXISTS (
          SELECT 1 FROM appointments WHERE id = NEW.aggregate_id AND idempotency_key = 'rollback-check'
        ) THEN RAISE EXCEPTION 'intentional E14-S06 rollback'; END IF;
        RETURN NEW;
      END $$`);
    await database.$executeRawUnsafe(
      "CREATE TRIGGER e14_s06_reject_rollback BEFORE INSERT ON domain_event_outbox FOR EACH ROW EXECUTE FUNCTION e14_s06_reject_rollback()",
    );
    try {
      await expect(
        createAppointment(
          context(),
          database,
          {
            serviceId: service,
            resourceId,
            contactId: contact,
            startsAt: at(0),
            idempotencyKey: "rollback-check",
          },
          actor(),
        ),
      ).rejects.toThrow("intentional E14-S06 rollback");
      expect(
        await database.appointment.count({
          where: { tenantId: tenant, idempotencyKey: "rollback-check" },
        }),
      ).toBe(0);
      expect(
        await database.auditLog.count({
          where: { tenantId: tenant, action: "appointment.created" },
        }),
      ).toBe(auditBefore);
      expect(
        await database.domainEventOutbox.count({
          where: { tenantId: tenant, eventType: "appointment.created" },
        }),
      ).toBe(outboxBefore);
    } finally {
      await database.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS e14_s06_reject_rollback ON domain_event_outbox",
      );
      await database.$executeRawUnsafe("DROP FUNCTION IF EXISTS e14_s06_reject_rollback()");
    }
  });
});
