import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AppointmentAvailabilityRuleNotFoundError,
  type AppointmentAvailabilityRulePatch,
  AppointmentAvailabilityRuleValidationError,
  createAvailabilityRule,
  deleteAvailabilityRule,
  getAvailabilityRuleById,
  listAvailabilityRules,
  updateAvailabilityRule,
} from "./appointment-availability-manager";
import { createPlatformDatabaseClient, type PrismaClient } from "./platform";
import { createTenantContext } from "./tenant-context";
import { TenantNotOperationalError } from "./tenant-operational";

const prefix = "e14-s03-availability";
const metadata = { actorUserId: `${prefix}-actor`, requestId: `${prefix}-request` };
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";
let suspendedTenantId = "";
let resourceAId = "";
let inactiveResourceId = "";
let resourceBId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.appointmentAvailabilityRule.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentResource.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

describe.sequential("E14-S03 appointment availability rule manager", () => {
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
            displayName: `Availability ${marker}`,
            legalName: `Availability ${marker}`,
            slug: `${prefix}-${marker}`,
            status: marker === "suspended" ? "suspended" : "active",
          },
        }),
      ),
    );
    const [tenantA, tenantB, suspendedTenant] = tenants;
    if (tenantA === undefined || tenantB === undefined || suspendedTenant === undefined) {
      throw new Error("Availability rule tenant fixtures failed");
    }
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    suspendedTenantId = suspendedTenant.id;
    const [resourceA, inactiveResource, resourceB] = await Promise.all([
      prisma.appointmentResource.create({ data: { name: "Resource A", tenantId: tenantAId } }),
      prisma.appointmentResource.create({
        data: { active: false, name: "Inactive resource A", tenantId: tenantAId },
      }),
      prisma.appointmentResource.create({ data: { name: "Resource B", tenantId: tenantBId } }),
    ]);
    resourceAId = resourceA.id;
    inactiveResourceId = inactiveResource.id;
    resourceBId = resourceB.id;
  });

  afterAll(async () => {
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("creates rules for every weekday and records AuditLog and Outbox atomically", async () => {
    const context = createTenantContext(tenantAId);
    const rules = await Promise.all(
      Array.from({ length: 7 }, (_, dayOfWeek) =>
        createAvailabilityRule(
          context,
          prisma,
          {
            capacity: 2,
            dayOfWeek,
            endTime: "17:30",
            resourceId: resourceAId,
            startTime: "09:00",
            timezone: "America/Mexico_City",
          },
          metadata,
        ),
      ),
    );
    expect(rules.map(({ dayOfWeek }) => dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(rules.every(({ tenantId }) => tenantId === tenantAId)).toBe(true);
    expect(
      await prisma.auditLog.count({
        where: { action: "appointment_availability_rule.created", tenantId: tenantAId },
      }),
    ).toBe(7);
    expect(
      await prisma.domainEventOutbox.count({
        where: { eventType: "appointment_availability_rule.created", tenantId: tenantAId },
      }),
    ).toBe(7);
  });

  it("rejects invalid day, local time, date range, timezone, and capacity values", async () => {
    const context = createTenantContext(tenantAId);
    const valid = { dayOfWeek: 1, endTime: "10:00", resourceId: resourceAId, startTime: "09:00" };
    for (const dayOfWeek of [-1, 7, 1.5]) {
      await expect(
        createAvailabilityRule(context, prisma, { ...valid, dayOfWeek }, metadata),
      ).rejects.toBeInstanceOf(AppointmentAvailabilityRuleValidationError);
    }
    for (const [startTime, endTime] of [
      ["9:00", "10:00"],
      ["24:00", "25:00"],
      ["10:00", "10:00"],
      ["11:00", "10:00"],
    ] as const) {
      await expect(
        createAvailabilityRule(context, prisma, { ...valid, endTime, startTime }, metadata),
      ).rejects.toBeInstanceOf(AppointmentAvailabilityRuleValidationError);
    }
    for (const capacity of [0, -1, 1.5, 2_147_483_648]) {
      await expect(
        createAvailabilityRule(context, prisma, { ...valid, capacity }, metadata),
      ).rejects.toBeInstanceOf(AppointmentAvailabilityRuleValidationError);
    }
    await expect(
      createAvailabilityRule(
        context,
        prisma,
        { ...valid, effectiveFrom: "2026-02-02", effectiveTo: "2026-02-01" },
        metadata,
      ),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityRuleValidationError);
    await expect(
      createAvailabilityRule(context, prisma, { ...valid, effectiveFrom: "2026-02-30" }, metadata),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityRuleValidationError);
    await expect(
      createAvailabilityRule(context, prisma, { ...valid, timezone: "Not/A_Timezone" }, metadata),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityRuleValidationError);
  });

  it("requires an active resource belonging to the current tenant at both application and database layers", async () => {
    const context = createTenantContext(tenantAId);
    const valid = { dayOfWeek: 1, endTime: "10:00", startTime: "09:00" };
    await expect(
      createAvailabilityRule(context, prisma, { ...valid, resourceId: resourceBId }, metadata),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityRuleValidationError);
    await expect(
      createAvailabilityRule(
        context,
        prisma,
        { ...valid, resourceId: inactiveResourceId },
        metadata,
      ),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityRuleValidationError);
    await expect(
      prisma.appointmentAvailabilityRule.create({
        data: { ...valid, resourceId: resourceBId, tenantId: tenantAId },
      }),
    ).rejects.toThrow();
  });

  it("lists tenant rules by weekday then local start time with strict filters and paging", async () => {
    const context = createTenantContext(tenantAId);
    const sortResource = await prisma.appointmentResource.create({
      data: { name: "Sort resource", tenantId: tenantAId },
    });
    const created = await Promise.all([
      createAvailabilityRule(
        context,
        prisma,
        {
          dayOfWeek: 2,
          endTime: "12:00",
          resourceId: sortResource.id,
          startTime: "11:00",
        },
        metadata,
      ),
      createAvailabilityRule(
        context,
        prisma,
        {
          dayOfWeek: 1,
          endTime: "10:00",
          resourceId: sortResource.id,
          startTime: "09:00",
        },
        metadata,
      ),
      createAvailabilityRule(
        context,
        prisma,
        {
          dayOfWeek: 1,
          endTime: "12:00",
          resourceId: sortResource.id,
          startTime: "11:00",
        },
        metadata,
      ),
    ]);
    await createAvailabilityRule(
      createTenantContext(tenantBId),
      prisma,
      {
        dayOfWeek: 0,
        endTime: "10:00",
        resourceId: resourceBId,
        startTime: "09:00",
      },
      metadata,
    );
    const page = await listAvailabilityRules(context, prisma, {
      active: true,
      limit: 2,
      offset: 0,
      resourceId: sortResource.id,
    });
    expect(page.items.map(({ id }) => id)).toEqual(created.slice(1).map(({ id }) => id));
    expect(page.total).toBe(3);
    expect(page.items.every(({ tenantId }) => tenantId === tenantAId)).toBe(true);
    const filtered = await listAvailabilityRules(context, prisma, {
      active: true,
      dayOfWeek: 2,
      resourceId: sortResource.id,
    });
    expect(filtered.items.map(({ id }) => id)).toEqual([created[0]?.id]);
    expect(filtered.total).toBe(1);
    await expect(listAvailabilityRules(context, prisma, { dayOfWeek: 8 })).rejects.toBeInstanceOf(
      AppointmentAvailabilityRuleValidationError,
    );
  });

  it("rejects empty and invalid resulting patches without writes, and updates date boundaries", async () => {
    const context = createTenantContext(tenantAId);
    const rule = await createAvailabilityRule(
      context,
      prisma,
      {
        dayOfWeek: 3,
        effectiveFrom: "2026-02-01",
        effectiveTo: "2026-02-28",
        endTime: "12:00",
        resourceId: resourceAId,
        startTime: "09:00",
      },
      metadata,
    );
    const auditBefore = await prisma.auditLog.count({
      where: { entityId: rule.id, tenantId: tenantAId },
    });
    const outboxBefore = await prisma.domainEventOutbox.count({
      where: { aggregateId: rule.id, tenantId: tenantAId },
    });
    await expect(
      updateAvailabilityRule(
        context,
        prisma,
        rule.id,
        { dayOfWeek: undefined, active: undefined },
        metadata,
      ),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityRuleValidationError);
    await expect(
      updateAvailabilityRule(
        context,
        prisma,
        rule.id,
        { unexpected: true } as unknown as AppointmentAvailabilityRulePatch,
        metadata,
      ),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityRuleValidationError);
    await expect(
      updateAvailabilityRule(context, prisma, rule.id, { endTime: "08:00" }, metadata),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityRuleValidationError);
    await expect(
      updateAvailabilityRule(context, prisma, rule.id, { effectiveFrom: "2026-03-01" }, metadata),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityRuleValidationError);
    expect(await prisma.auditLog.count({ where: { entityId: rule.id, tenantId: tenantAId } })).toBe(
      auditBefore,
    );
    expect(
      await prisma.domainEventOutbox.count({
        where: { aggregateId: rule.id, tenantId: tenantAId },
      }),
    ).toBe(outboxBefore);
    const updated = await updateAvailabilityRule(
      context,
      prisma,
      rule.id,
      { effectiveTo: "2026-03-01", startTime: "10:00" },
      metadata,
    );
    expect(updated).toMatchObject({
      effectiveFrom: new Date("2026-02-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-03-01T00:00:00.000Z"),
      startTime: "10:00",
    });
  });

  it("hides foreign rules for get, update, and delete and records a successful deletion", async () => {
    const contextA = createTenantContext(tenantAId);
    const contextB = createTenantContext(tenantBId);
    const rule = await createAvailabilityRule(
      contextA,
      prisma,
      {
        dayOfWeek: 4,
        endTime: "12:00",
        resourceId: resourceAId,
        startTime: "09:00",
      },
      metadata,
    );
    await expect(getAvailabilityRuleById(contextB, prisma, rule.id)).rejects.toBeInstanceOf(
      AppointmentAvailabilityRuleNotFoundError,
    );
    await expect(
      updateAvailabilityRule(contextB, prisma, rule.id, { active: false }, metadata),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityRuleNotFoundError);
    await expect(
      deleteAvailabilityRule(contextB, prisma, rule.id, metadata),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityRuleNotFoundError);
    await expect(getAvailabilityRuleById(contextA, prisma, rule.id)).resolves.toMatchObject({
      tenantId: tenantAId,
    });
    await deleteAvailabilityRule(contextA, prisma, rule.id, metadata);
    expect(
      await prisma.appointmentAvailabilityRule.findFirst({
        where: { id: rule.id, tenantId: tenantAId },
      }),
    ).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: {
          action: "appointment_availability_rule.deleted",
          entityId: rule.id,
          tenantId: tenantAId,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.domainEventOutbox.count({
        where: {
          aggregateId: rule.id,
          eventType: "appointment_availability_rule.deleted",
          tenantId: tenantAId,
        },
      }),
    ).toBe(1);
  });

  it("rejects create mutations for a tenant that is not operational", async () => {
    await expect(
      createAvailabilityRule(
        createTenantContext(suspendedTenantId),
        prisma,
        {
          dayOfWeek: 1,
          endTime: "10:00",
          resourceId: resourceAId,
          startTime: "09:00",
        },
        metadata,
      ),
    ).rejects.toBeInstanceOf(TenantNotOperationalError);
  });
});
