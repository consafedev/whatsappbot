import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AppointmentAvailabilityExceptionNotFoundError,
  AppointmentAvailabilityExceptionValidationError,
  createAvailabilityException,
  deleteAvailabilityException,
  getAvailabilityExceptionById,
  listAvailabilityExceptions,
  updateAvailabilityException,
} from "./appointment-exception-manager";
import { createPlatformDatabaseClient, type PrismaClient } from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e14-s04-exception";
const metadata = { actorUserId: `${prefix}-actor`, requestId: `${prefix}-request` };
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";
let suspendedTenantId = "";
let resourceAId = "";
let resourceBId = "";
let inactiveResourceId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.appointmentAvailabilityException.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentResource.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

describe.sequential("E14-S04 appointment availability exception manager", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    const tenants = await Promise.all(
      ["a", "b", "suspended"].map((marker) =>
        prisma.tenant.create({
          data: {
            defaultCurrency: "MXN",
            defaultLocale: "es-MX",
            defaultTimezone: "America/Mexico_City",
            displayName: `Exception ${marker}`,
            legalName: `Exception ${marker}`,
            slug: `${prefix}-${marker}`,
            status: marker === "suspended" ? "suspended" : "active",
          },
        }),
      ),
    );
    const [tenantA, tenantB, suspendedTenant] = tenants;
    if (tenantA === undefined || tenantB === undefined || suspendedTenant === undefined) {
      throw new Error("Availability exception tenant fixtures failed");
    }
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    suspendedTenantId = suspendedTenant.id;
    const [resourceA, resourceB, inactiveResource] = await Promise.all([
      prisma.appointmentResource.create({ data: { name: "Resource A", tenantId: tenantAId } }),
      prisma.appointmentResource.create({ data: { name: "Resource B", tenantId: tenantBId } }),
      prisma.appointmentResource.create({
        data: { active: false, name: "Inactive resource", tenantId: tenantAId },
      }),
    ]);
    resourceAId = resourceA.id;
    resourceBId = resourceB.id;
    inactiveResourceId = inactiveResource.id;
  });

  afterAll(async () => {
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("creates tenant-owned exceptions with audit and outbox records", async () => {
    const created = await createAvailabilityException(
      createTenantContext(tenantAId),
      prisma,
      {
        resourceId: resourceAId,
        type: "BLOCKED",
        startsAt: "2026-10-25T09:00:00-06:00",
        endsAt: "2026-10-25T10:00:00-06:00",
        reason: "Holiday",
      },
      metadata,
    );
    expect(created).toMatchObject({
      tenantId: tenantAId,
      resourceId: resourceAId,
      type: "BLOCKED",
      startsAt: new Date("2026-10-25T15:00:00.000Z"),
      endsAt: new Date("2026-10-25T16:00:00.000Z"),
      reason: "Holiday",
    });
    expect(
      await prisma.auditLog.count({ where: { entityId: created.id, tenantId: tenantAId } }),
    ).toBe(1);
    expect(
      await prisma.domainEventOutbox.count({
        where: { aggregateId: created.id, tenantId: tenantAId },
      }),
    ).toBe(1);
  });

  it("requires explicit offsets, rejects invalid dates and inverted intervals", async () => {
    const context = createTenantContext(tenantAId);
    const invalidIntervals: Array<[string, string]> = [
      ["2026-10-25T09:00:00", "2026-10-25T10:00:00Z"],
      ["2026-02-30T09:00:00Z", "2026-02-30T10:00:00Z"],
      ["2026-10-25T10:00:00Z", "2026-10-25T09:00:00Z"],
    ];
    for (const [startsAt, endsAt] of invalidIntervals) {
      await expect(
        createAvailabilityException(
          context,
          prisma,
          { resourceId: resourceAId, startsAt, endsAt },
          metadata,
        ),
      ).rejects.toBeInstanceOf(AppointmentAvailabilityExceptionValidationError);
    }
    await expect(
      createAvailabilityException(
        context,
        prisma,
        {
          resourceId: inactiveResourceId,
          startsAt: "2026-10-25T09:00:00Z",
          endsAt: "2026-10-25T10:00:00Z",
        },
        metadata,
      ),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityExceptionValidationError);
    await expect(
      createAvailabilityException(
        context,
        prisma,
        {
          resourceId: resourceBId,
          startsAt: "2026-10-25T09:00:00Z",
          endsAt: "2026-10-25T10:00:00Z",
        },
        metadata,
      ),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityExceptionValidationError);
  });

  it("filters overlap using half-open intervals and keeps tenant isolation", async () => {
    const context = createTenantContext(tenantAId);
    const created = await Promise.all([
      createAvailabilityException(
        context,
        prisma,
        {
          resourceId: resourceAId,
          startsAt: "2026-10-26T09:00:00Z",
          endsAt: "2026-10-26T10:00:00Z",
        },
        metadata,
      ),
      createAvailabilityException(
        context,
        prisma,
        {
          resourceId: resourceAId,
          type: "EXTRA_AVAILABILITY",
          startsAt: "2026-10-26T10:00:00Z",
          endsAt: "2026-10-26T11:00:00Z",
        },
        metadata,
      ),
      createAvailabilityException(
        createTenantContext(tenantBId),
        prisma,
        {
          resourceId: resourceBId,
          startsAt: "2026-10-26T09:00:00Z",
          endsAt: "2026-10-26T10:00:00Z",
        },
        metadata,
      ),
    ]);
    const page = await listAvailabilityExceptions(context, prisma, {
      resourceId: resourceAId,
      from: "2026-10-26T10:00:00Z",
      to: "2026-10-26T11:00:00Z",
    });
    expect(page.items.map(({ id }) => id)).toEqual([created[1]?.id]);
    expect(page.total).toBe(1);
    expect(page.items.every(({ tenantId }) => tenantId === tenantAId)).toBe(true);
    await expect(
      listAvailabilityExceptions(context, prisma, {
        from: "2026-10-27T00:00:00Z",
        to: "2026-10-26T00:00:00Z",
      }),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityExceptionValidationError);
  });

  it("rejects blank and unknown patches, hides foreign IDs, and deletes with audit/outbox", async () => {
    const contextA = createTenantContext(tenantAId);
    const contextB = createTenantContext(tenantBId);
    const item = await createAvailabilityException(
      contextA,
      prisma,
      {
        resourceId: resourceAId,
        startsAt: "2026-10-27T09:00:00Z",
        endsAt: "2026-10-27T10:00:00Z",
        reason: "  ",
      },
      metadata,
    );
    await expect(
      updateAvailabilityException(contextA, prisma, item.id, {}, metadata),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityExceptionValidationError);
    await expect(
      updateAvailabilityException(contextA, prisma, item.id, { unknown: true } as never, metadata),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityExceptionValidationError);
    expect(item.reason).toBeNull();
    await expect(getAvailabilityExceptionById(contextB, prisma, item.id)).rejects.toBeInstanceOf(
      AppointmentAvailabilityExceptionNotFoundError,
    );
    await expect(
      updateAvailabilityException(contextB, prisma, item.id, { active: false }, metadata),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityExceptionNotFoundError);
    await expect(
      deleteAvailabilityException(contextB, prisma, item.id, metadata),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityExceptionNotFoundError);
    await deleteAvailabilityException(contextA, prisma, item.id, metadata);
    expect(
      await prisma.appointmentAvailabilityException.findFirst({
        where: { id: item.id, tenantId: tenantAId },
      }),
    ).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: item.id,
          action: "appointment_availability_exception.deleted",
          tenantId: tenantAId,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.domainEventOutbox.count({
        where: {
          aggregateId: item.id,
          eventType: "appointment_availability_exception.deleted",
          tenantId: tenantAId,
        },
      }),
    ).toBe(1);
  });

  it("serializes competing boundary patches and preserves a valid interval", async () => {
    const context = createTenantContext(tenantAId);
    const item = await createAvailabilityException(
      context,
      prisma,
      {
        resourceId: resourceAId,
        startsAt: "2026-10-29T09:00:00Z",
        endsAt: "2026-10-29T11:00:00Z",
      },
      metadata,
    );
    const updatesBefore = await prisma.auditLog.count({
      where: {
        action: "appointment_availability_exception.updated",
        entityId: item.id,
        tenantId: tenantAId,
      },
    });
    const results = await Promise.allSettled([
      updateAvailabilityException(
        context,
        prisma,
        item.id,
        { startsAt: "2026-10-29T10:00:00Z" },
        { ...metadata, requestId: `${prefix}-race-start` },
      ),
      updateAvailabilityException(
        context,
        prisma,
        item.id,
        { endsAt: "2026-10-29T09:30:00Z" },
        { ...metadata, requestId: `${prefix}-race-end` },
      ),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(AppointmentAvailabilityExceptionValidationError),
    });
    const final = await prisma.appointmentAvailabilityException.findFirst({
      where: { id: item.id, tenantId: tenantAId },
    });
    expect(final).not.toBeNull();
    expect(final?.startsAt.getTime()).toBeLessThan(final?.endsAt.getTime() ?? 0);
    expect(
      await prisma.auditLog.count({
        where: {
          action: "appointment_availability_exception.updated",
          entityId: item.id,
          tenantId: tenantAId,
        },
      }),
    ).toBe(updatesBefore + 1);
  });

  it("rolls back the exception when the audit write fails and rejects suspended tenants", async () => {
    const context = createTenantContext(tenantAId);
    const rollbackStart = new Date("2026-10-28T09:00:00Z");
    const failingDatabase = {
      $transaction: (callback: (transaction: unknown) => Promise<unknown>) =>
        prisma.$transaction((transaction) => {
          const proxy = new Proxy(transaction, {
            get(target, property, receiver) {
              if (property !== "auditLog") return Reflect.get(target, property, receiver);
              return new Proxy(target.auditLog, {
                get(delegate, method, delegateReceiver) {
                  if (method === "create")
                    return () => Promise.reject(new Error("deliberate audit failure"));
                  return Reflect.get(delegate, method, delegateReceiver);
                },
              });
            },
          });
          return callback(proxy);
        }),
    };
    await expect(
      createAvailabilityException(
        context,
        failingDatabase as never,
        {
          resourceId: resourceAId,
          startsAt: rollbackStart.toISOString(),
          endsAt: "2026-10-28T10:00:00Z",
        },
        metadata,
      ),
    ).rejects.toThrow("deliberate audit failure");
    expect(
      await prisma.appointmentAvailabilityException.count({
        where: { resourceId: resourceAId, startsAt: rollbackStart, tenantId: tenantAId },
      }),
    ).toBe(0);
    await expect(
      createAvailabilityException(
        createTenantContext(suspendedTenantId),
        prisma,
        {
          resourceId: resourceAId,
          startsAt: "2026-10-28T09:00:00Z",
          endsAt: "2026-10-28T10:00:00Z",
        },
        metadata,
      ),
    ).rejects.toThrow();
  });
});
