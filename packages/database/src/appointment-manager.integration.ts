import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AppointmentConflictError,
  AppointmentNotFoundError,
  AppointmentValidationError,
  cancelAppointment,
  createAppointment,
  getAppointmentById,
  listAppointments,
  rebookAppointment,
} from "./appointment-manager";
import {
  AppointmentResourceCapacityConflictError,
  updateAppointmentResource,
} from "./appointment-resource-manager";
import { createPlatformDatabaseClient, type PrismaClient } from "./platform";
import { createTenantContext } from "./tenant-context";
import { TenantModuleEntitlementRequiredError } from "./tenant-entitlements";
import { TenantNotOperationalError } from "./tenant-operational";

const prefix = "e14-s07-lifecycle";
let database: PrismaClient;
let tenant = "",
  foreignTenant = "",
  user = "",
  foreignUser = "",
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

async function booked(resourceId: string, minute: number, idempotencyKey: string) {
  return createAppointment(
    context(),
    database,
    {
      serviceId: service,
      resourceId,
      contactId: contact,
      startsAt: at(minute),
      idempotencyKey,
      notes: "keep appointment history",
    },
    actor(),
  );
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
    const foreignActor = await database.user.create({
      data: {
        tenantId: foreignTenant,
        email: `${prefix}-foreign@example.invalid`,
        passwordHash: "test-hash",
        displayName: "Foreign Actor",
        status: "active",
        locale: "es-MX",
        timezone: "UTC",
      },
    });
    foreignUser = foreignActor.id;
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

  it("cancels once, preserves the booking snapshot, and releases capacity", async () => {
    const resourceId = await resource(1);
    const old = await booked(resourceId, 0, "cancel-release");
    const auditBefore = await database.auditLog.count({
      where: { tenantId: tenant, entityId: old.id, action: "appointment.cancelled" },
    });
    const first = await cancelAppointment(context(), database, old.id.toUpperCase(), actor());
    const replay = await cancelAppointment(context(), database, old.id, actor());
    expect(first).toMatchObject({ id: old.id, status: "CANCELLED", notes: old.notes });
    expect(first.occupiedStartsAt).toEqual(old.occupiedStartsAt);
    expect(replay.id).toBe(first.id);
    expect(
      await database.auditLog.count({
        where: { tenantId: tenant, entityId: old.id, action: "appointment.cancelled" },
      }),
    ).toBe(auditBefore + 1);
    expect(
      await database.domainEventOutbox.count({
        where: { tenantId: tenant, aggregateId: old.id, eventType: "appointment.cancelled" },
      }),
    ).toBe(1);
    const replacement = await booked(resourceId, 0, "cancel-capacity-released");
    expect(replacement.status).toBe("CONFIRMED");
  });

  it("rejects cancellation from other states and rechecks tenant, module, and active actor on replay", async () => {
    const resourceId = await resource(1);
    const completed = await booked(resourceId, 0, "cancel-terminal");
    await database.appointment.update({
      where: { id: completed.id },
      data: { status: "COMPLETED" },
    });
    await expect(
      cancelAppointment(context(), database, completed.id, actor()),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
    const cancelled = await booked(resourceId, 60, "cancel-authority");
    await cancelAppointment(context(), database, cancelled.id, actor());
    await database.user.update({ where: { id: user }, data: { status: "disabled" } });
    await expect(
      cancelAppointment(context(), database, cancelled.id, actor()),
    ).rejects.toBeInstanceOf(AppointmentValidationError);
    await database.user.update({ where: { id: user }, data: { status: "active" } });
    await database.tenantEntitlement.update({
      where: {
        tenantId_entitlementKey: { tenantId: tenant, entitlementKey: "module.appointments" },
      },
      data: { enabled: false },
    });
    await expect(
      cancelAppointment(context(), database, cancelled.id, actor()).then(() => undefined),
    ).rejects.toBeInstanceOf(TenantModuleEntitlementRequiredError);
    await database.tenantEntitlement.update({
      where: {
        tenantId_entitlementKey: { tenantId: tenant, entitlementKey: "module.appointments" },
      },
      data: { enabled: true },
    });
    await database.tenant.update({ where: { id: tenant }, data: { status: "suspended" } });
    await expect(
      cancelAppointment(context(), database, cancelled.id, actor()),
    ).rejects.toBeInstanceOf(TenantNotOperationalError);
    await database.tenant.update({ where: { id: tenant }, data: { status: "active" } });
  });

  it("rebooks in place with immutable lineage and current configuration snapshots", async () => {
    const resourceId = await resource(1);
    const old = await booked(resourceId, 0, "rebook-original");
    expect(old.timezoneSnapshot).toBe("UTC");
    await database.appointmentService.update({
      where: { id: service },
      data: { durationMinutes: 45, bufferBeforeMinutes: 5, bufferAfterMinutes: 10 },
    });
    await database.tenant.update({
      where: { id: tenant },
      data: { defaultTimezone: "America/Mexico_City" },
    });
    let replacement: Awaited<ReturnType<typeof rebookAppointment>>;
    try {
      replacement = await rebookAppointment(
        context(),
        database,
        old.id.toUpperCase(),
        { startsAt: at(0), idempotencyKey: "rebook-same-slot" },
        actor(),
      );
    } finally {
      await database.tenant.update({
        where: { id: tenant },
        data: { defaultTimezone: "UTC" },
      });
    }
    const oldAfter = await database.appointment.findFirstOrThrow({
      where: { tenantId: tenant, id: old.id },
    });
    expect(oldAfter.status).toBe("RESCHEDULED");
    expect(oldAfter.notes).toBe(old.notes);
    expect(oldAfter.durationMinutes).toBe(old.durationMinutes);
    expect(replacement).toMatchObject({
      status: "CONFIRMED",
      rescheduledFromId: old.id,
      notes: old.notes,
    });
    expect(replacement.durationMinutes).toBe(45);
    expect(replacement.bufferBeforeMinutes).toBe(5);
    expect(replacement.timezoneSnapshot).toBe("America/Mexico_City");
    expect((await listAppointments(context(), database)).items.map((row) => row.id)).toEqual(
      expect.arrayContaining([old.id, replacement.id]),
    );
  });

  it("rolls back rebooking when the destination is unavailable", async () => {
    const oldResource = await resource(1);
    const targetResource = await resource(1);
    const old = await booked(oldResource, 0, "rebook-rollback-old");
    await booked(targetResource, 0, "rebook-rollback-occupier");
    const auditBefore = await database.auditLog.count({
      where: {
        tenantId: tenant,
        action: { in: ["appointment.rescheduled", "appointment.created"] },
      },
    });
    const outboxBefore = await database.domainEventOutbox.count({
      where: {
        tenantId: tenant,
        eventType: { in: ["appointment.rescheduled", "appointment.created"] },
      },
    });
    await expect(
      rebookAppointment(
        context(),
        database,
        old.id,
        {
          startsAt: at(0),
          resourceId: targetResource,
          idempotencyKey: "rebook-rollback-new",
        },
        actor(),
      ),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
    expect((await database.appointment.findUniqueOrThrow({ where: { id: old.id } })).status).toBe(
      "CONFIRMED",
    );
    expect(
      await database.appointment.count({ where: { tenantId: tenant, rescheduledFromId: old.id } }),
    ).toBe(0);
    expect(
      await database.auditLog.count({
        where: {
          tenantId: tenant,
          action: { in: ["appointment.rescheduled", "appointment.created"] },
        },
      }),
    ).toBe(auditBefore);
    expect(
      await database.domainEventOutbox.count({
        where: {
          tenantId: tenant,
          eventType: { in: ["appointment.rescheduled", "appointment.created"] },
        },
      }),
    ).toBe(outboxBefore);
  });

  it("rolls back cancellation and rebooking with their audit and outbox when the event write fails", async () => {
    const resourceId = await resource(2);
    const cancelTarget = await booked(resourceId, 0, "cancel-outbox-rollback");
    const rebookTarget = await booked(resourceId, 60, "rebook-outbox-rollback");
    const auditBefore = await database.auditLog.count({
      where: {
        tenantId: tenant,
        action: { in: ["appointment.cancelled", "appointment.rescheduled"] },
      },
    });
    const outboxBefore = await database.domainEventOutbox.count({
      where: {
        tenantId: tenant,
        eventType: { in: ["appointment.cancelled", "appointment.rescheduled"] },
      },
    });
    await database.$executeRawUnsafe(`CREATE FUNCTION e14_s07_reject_lifecycle_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type IN ('appointment.cancelled', 'appointment.rescheduled')
          AND NEW.aggregate_id IN ('${cancelTarget.id}', '${rebookTarget.id}')
        THEN RAISE EXCEPTION 'intentional E14-S07 lifecycle rollback'; END IF;
        RETURN NEW;
      END $$`);
    await database.$executeRawUnsafe(
      "CREATE TRIGGER e14_s07_reject_lifecycle_outbox BEFORE INSERT ON domain_event_outbox FOR EACH ROW EXECUTE FUNCTION e14_s07_reject_lifecycle_outbox()",
    );
    try {
      await expect(
        cancelAppointment(context(), database, cancelTarget.id, actor()),
      ).rejects.toThrow("intentional E14-S07 lifecycle rollback");
      await expect(
        rebookAppointment(
          context(),
          database,
          rebookTarget.id,
          {
            startsAt: at(120),
            idempotencyKey: "rebook-outbox-rollback-new",
          },
          actor(),
        ),
      ).rejects.toThrow("intentional E14-S07 lifecycle rollback");
      expect(
        (await database.appointment.findUniqueOrThrow({ where: { id: cancelTarget.id } })).status,
      ).toBe("CONFIRMED");
      expect(
        (await database.appointment.findUniqueOrThrow({ where: { id: rebookTarget.id } })).status,
      ).toBe("CONFIRMED");
      expect(
        await database.appointment.count({
          where: { tenantId: tenant, rescheduledFromId: rebookTarget.id },
        }),
      ).toBe(0);
      expect(
        await database.auditLog.count({
          where: {
            tenantId: tenant,
            action: { in: ["appointment.cancelled", "appointment.rescheduled"] },
          },
        }),
      ).toBe(auditBefore);
      expect(
        await database.domainEventOutbox.count({
          where: {
            tenantId: tenant,
            eventType: { in: ["appointment.cancelled", "appointment.rescheduled"] },
          },
        }),
      ).toBe(outboxBefore);
    } finally {
      await database.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS e14_s07_reject_lifecycle_outbox ON domain_event_outbox",
      );
      await database.$executeRawUnsafe("DROP FUNCTION IF EXISTS e14_s07_reject_lifecycle_outbox()");
    }
  });

  it("serializes rebooking against a capacity-one booking and sorts opposite resource locks", async () => {
    const sourceResource = await resource(1);
    const targetResource = await resource(1);
    const source = await booked(sourceResource, 0, "rebook-capacity-source");
    const race = await Promise.allSettled([
      rebookAppointment(
        context(),
        database,
        source.id,
        {
          startsAt: at(60),
          resourceId: targetResource,
          idempotencyKey: "rebook-capacity-race",
        },
        actor(),
      ),
      createAppointment(
        context(),
        database,
        {
          serviceId: service,
          resourceId: targetResource,
          contactId: contact,
          startsAt: at(60),
          idempotencyKey: "create-capacity-race",
        },
        actor(),
      ),
    ]);
    expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      race.filter(
        (result) =>
          result.status === "rejected" && result.reason instanceof AppointmentConflictError,
      ),
    ).toHaveLength(1);
    const occupied = await database.appointment.count({
      where: {
        tenantId: tenant,
        resourceId: targetResource,
        status: { in: ["REQUESTED", "CONFIRMED"] },
        occupiedStartsAt: { lt: new Date(start.getTime() + 90 * 60_000) },
        occupiedEndsAt: { gt: new Date(start.getTime() + 60 * 60_000) },
      },
    });
    expect(occupied).toBe(1);

    const [leftResource, rightResource] = await Promise.all([resource(2), resource(2)]);
    const [left, right] = await Promise.all([
      booked(leftResource, 0, "opposite-rebook-left"),
      booked(rightResource, 60, "opposite-rebook-right"),
    ]);
    const oppositeLocks = Promise.all([
      rebookAppointment(
        context(),
        database,
        left.id,
        {
          startsAt: at(120),
          resourceId: rightResource,
          idempotencyKey: "opposite-left-to-right",
        },
        actor(),
      ),
      rebookAppointment(
        context(),
        database,
        right.id,
        {
          startsAt: at(90),
          resourceId: leftResource,
          idempotencyKey: "opposite-right-to-left",
        },
        actor(),
      ),
    ]);
    await expect(
      Promise.race([
        oppositeLocks,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("opposite rebooking deadlocked")), 5_000),
        ),
      ]),
    ).resolves.toBeDefined();
  });

  it("serializes rebooking, distinguishes command receipts, and replays after replacement cancellation", async () => {
    const resourceId = await resource(2);
    const old = await booked(resourceId, 0, "rebook-race-old");
    const command = { startsAt: at(60), idempotencyKey: "rebook-race-key" };
    const [first, second] = await Promise.all([
      rebookAppointment(context(), database, old.id, command, actor()),
      rebookAppointment(context(), database, old.id.toUpperCase(), command, {
        ...actor(),
        actorUserId: user.toUpperCase(),
      }),
    ]);
    expect(first.id).toBe(second.id);
    expect(first.rescheduledFromId).toBe(old.id);
    expect(
      await database.appointment.count({ where: { tenantId: tenant, rescheduledFromId: old.id } }),
    ).toBe(1);
    await expect(
      rebookAppointment(
        context(),
        database,
        old.id,
        {
          startsAt: at(120),
          idempotencyKey: "rebook-second-child",
        },
        actor(),
      ),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
    const secondParent = await booked(resourceId, 120, "rebook-other-parent");
    await expect(
      rebookAppointment(context(), database, secondParent.id, command, actor()),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
    await database.appointmentService.update({
      where: { id: service },
      data: { active: false, durationMinutes: 60 },
    });
    await cancelAppointment(context(), database, first.id, actor());
    expect((await rebookAppointment(context(), database, old.id, command, actor())).id).toBe(
      first.id,
    );
    await database.appointmentService.update({
      where: { id: service },
      data: { active: true, durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
    });
    await expect(
      createAppointment(
        context(),
        database,
        {
          serviceId: service,
          resourceId,
          contactId: contact,
          startsAt: at(60),
          idempotencyKey: command.idempotencyKey,
        },
        actor(),
      ),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
    const plainOnly = await createAppointment(
      context(),
      database,
      {
        serviceId: service,
        resourceId,
        contactId: contact,
        startsAt: at(90),
        idempotencyKey: "plain-create-receipt",
      },
      actor(),
    );
    await expect(
      rebookAppointment(
        context(),
        database,
        old.id,
        {
          startsAt: at(300),
          idempotencyKey: plainOnly.idempotencyKey,
        },
        actor(),
      ),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
    await expect(
      rebookAppointment(
        context(),
        database,
        old.id,
        {
          startsAt: at(120),
          idempotencyKey: command.idempotencyKey,
        },
        actor(),
      ),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
  });

  it("allows only one concurrent rebook command to replace the same parent", async () => {
    const resourceId = await resource(2);
    const old = await booked(resourceId, 0, "rebook-different-keys-parent");
    const attempts = await Promise.allSettled([
      rebookAppointment(
        context(),
        database,
        old.id,
        {
          startsAt: at(60),
          idempotencyKey: "rebook-different-keys-a",
        },
        actor(),
      ),
      rebookAppointment(
        context(),
        database,
        old.id.toUpperCase(),
        {
          startsAt: at(120),
          idempotencyKey: "rebook-different-keys-b",
        },
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
    expect(
      await database.appointment.count({
        where: { tenantId: tenant, rescheduledFromId: old.id },
      }),
    ).toBe(1);
  });

  it("rejects tenant-mixed parents and resources and scopes replacement uniqueness", async () => {
    const resourceId = await resource(1);
    const old = await booked(resourceId, 0, "rebook-tenant-parent");
    const foreignResource = await database.appointmentResource.create({
      data: { tenantId: foreignTenant, name: `Foreign resource ${crypto.randomUUID()}` },
    });
    const foreignService = await database.appointmentService.create({
      data: { tenantId: foreignTenant, name: "Foreign service", durationMinutes: 30 },
    });
    const foreignContact = await database.contact.create({
      data: {
        tenantId: foreignTenant,
        name: "Foreign contact",
        phoneNumber: "+525500000201",
      },
    });
    const foreignParent = await database.appointment.create({
      data: {
        tenantId: foreignTenant,
        contactId: foreignContact.id,
        serviceId: foreignService.id,
        resourceId: foreignResource.id,
        idempotencyKey: "foreign-parent-row",
        status: "CONFIRMED",
        confirmationStatus: "CONFIRMED",
        startsAt: start,
        endsAt: new Date(start.getTime() + 30 * 60_000),
        occupiedStartsAt: start,
        occupiedEndsAt: new Date(start.getTime() + 30 * 60_000),
        durationMinutes: 30,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        timezoneSnapshot: "UTC",
        source: "dashboard",
      },
    });
    await expect(
      rebookAppointment(
        context(),
        database,
        old.id,
        {
          startsAt: at(60),
          resourceId: foreignResource.id,
          idempotencyKey: "rebook-foreign-resource",
        },
        actor(),
      ),
    ).rejects.toBeInstanceOf(AppointmentNotFoundError);
    await rebookAppointment(
      context(),
      database,
      old.id,
      {
        startsAt: at(60),
        idempotencyKey: "rebook-foreign-parent",
      },
      actor(),
    );
    await expect(
      rebookAppointment(
        createTenantContext(foreignTenant),
        database,
        old.id,
        {
          startsAt: at(60),
          idempotencyKey: "rebook-foreign-tenant",
        },
        { ...actor(), actorUserId: foreignUser },
      ),
    ).rejects.toBeInstanceOf(AppointmentNotFoundError);
    await expect(
      database.appointment.create({
        data: {
          tenantId: tenant,
          contactId: contact,
          serviceId: service,
          resourceId,
          idempotencyKey: "cross-tenant-lineage",
          status: "CONFIRMED",
          confirmationStatus: "CONFIRMED",
          startsAt: start,
          endsAt: new Date(start.getTime() + 30 * 60_000),
          occupiedStartsAt: start,
          occupiedEndsAt: new Date(start.getTime() + 30 * 60_000),
          durationMinutes: 30,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
          timezoneSnapshot: "UTC",
          source: "dashboard",
          rescheduledFromId: foreignParent.id,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});
