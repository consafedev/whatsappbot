import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppointmentAvailabilityQueryValidationError } from "./appointment-availability-calculator";
import {
  AppointmentAvailabilityTargetNotFoundError,
  findAppointmentAvailability,
} from "./appointment-slot-query";
import { createPlatformDatabaseClient, type PrismaClient } from "./platform";
import { createTenantContext } from "./tenant-context";
import { TenantModuleEntitlementRequiredError } from "./tenant-entitlements";

const prefix = "e14-s05-slot-query";
let prisma: PrismaClient;
let tenantA = "",
  tenantB = "",
  serviceA = "",
  resourceA = "",
  resourceB = "";
const base = { from: "2026-10-26T09:00:00.000Z", to: "2026-10-26T11:00:00.000Z" };

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map((row) => row.id);
  await prisma.appointmentAvailabilityException.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentAvailabilityRule.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentResource.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentService.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

describe.sequential("E14-S05 scoped availability query", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    const [a, b] = await Promise.all(
      ["a", "b"].map((marker) =>
        prisma.tenant.create({
          data: {
            slug: `${prefix}-${marker}`,
            status: "active",
            legalName: marker,
            displayName: marker,
            defaultTimezone: "UTC",
            defaultLocale: "es-MX",
            defaultCurrency: "MXN",
          },
        }),
      ),
    );
    if (!a || !b) throw new Error("tenant fixtures failed");
    tenantA = a.id;
    tenantB = b.id;
    await prisma.tenantEntitlement.create({
      data: {
        tenantId: tenantA,
        entitlementKey: "module.appointments",
        enabled: true,
        source: "contract",
      },
    });
    const [service, resource, foreignResource] = await Promise.all([
      prisma.appointmentService.create({
        data: { tenantId: tenantA, name: "Service", durationMinutes: 30 },
      }),
      prisma.appointmentResource.create({
        data: { tenantId: tenantA, name: "Resource", capacity: 2 },
      }),
      prisma.appointmentResource.create({ data: { tenantId: tenantB, name: "Foreign resource" } }),
    ]);
    serviceA = service.id;
    resourceA = resource.id;
    resourceB = foreignResource.id;
    await prisma.appointmentAvailabilityRule.create({
      data: {
        tenantId: tenantA,
        resourceId: resourceA,
        serviceId: serviceA,
        dayOfWeek: 1,
        startTime: "09:00",
        endTime: "11:00",
        capacity: 2,
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("returns tenant-scoped slots and applies a partial-second block", async () => {
    const context = createTenantContext(tenantA);
    const initial = await findAppointmentAvailability(context, prisma, {
      ...base,
      serviceId: serviceA,
      resourceId: resourceA,
      limit: 1,
    });
    expect(initial.slots[0]).toMatchObject({
      startsAt: base.from,
      capacity: 2,
      resourceId: resourceA,
    });
    expect(initial.nextFrom).toBeDefined();
    await prisma.appointmentAvailabilityException.create({
      data: {
        tenantId: tenantA,
        resourceId: resourceA,
        type: "BLOCKED",
        startsAt: new Date("2026-10-26T09:15:00.001Z"),
        endsAt: new Date("2026-10-26T09:15:00.002Z"),
      },
    });
    const after = await findAppointmentAvailability(context, prisma, {
      ...base,
      serviceId: serviceA,
      resourceId: resourceA,
    });
    expect(after.slots.some((slot) => slot.startsAt === base.from)).toBe(false);
    expect(after.slots.some((slot) => slot.startsAt === "2026-10-26T09:16:00.000Z")).toBe(true);
  });

  it("fails closed for foreign resources and missing tenant entitlement", async () => {
    await expect(
      findAppointmentAvailability(createTenantContext(tenantA), prisma, {
        ...base,
        serviceId: serviceA,
        resourceId: resourceB,
      }),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityTargetNotFoundError);
    await expect(
      findAppointmentAvailability(createTenantContext(tenantB), prisma, {
        ...base,
        serviceId: serviceA,
        resourceId: resourceB,
      }),
    ).rejects.toBeInstanceOf(TenantModuleEntitlementRequiredError);
  });

  it("filters service-specific rules while including generic rules", async () => {
    const resource = await prisma.appointmentResource.create({
      data: { tenantId: tenantA, name: "Service filter" },
    });
    const other = await prisma.appointmentService.create({
      data: { tenantId: tenantA, name: "Other service", durationMinutes: 30 },
    });
    await prisma.appointmentAvailabilityRule.create({
      data: {
        tenantId: tenantA,
        resourceId: resource.id,
        serviceId: other.id,
        dayOfWeek: 1,
        startTime: "09:00",
        endTime: "10:00",
      },
    });
    const context = createTenantContext(tenantA);
    const input = { ...base, serviceId: serviceA, resourceId: resource.id };
    expect((await findAppointmentAvailability(context, prisma, input)).slots).toHaveLength(0);
    await prisma.appointmentAvailabilityRule.create({
      data: {
        tenantId: tenantA,
        resourceId: resource.id,
        dayOfWeek: 1,
        startTime: "10:00",
        endTime: "11:00",
      },
    });
    const slots = (await findAppointmentAvailability(context, prisma, input)).slots;
    expect(slots.some((slot) => slot.startsAt === "2026-10-26T09:00:00.000Z")).toBe(false);
    expect(slots.some((slot) => slot.startsAt === "2026-10-26T10:00:00.000Z")).toBe(true);
  });

  it("rejects malformed higher-priority businessHours without falling back", async () => {
    await prisma.tenant.update({
      where: { id: tenantA },
      data: { settings: { businessHours: { timezone: "UTC", schedules: [] } } },
    });
    await prisma.appointmentResource.update({
      where: { id: resourceA },
      data: { metadata: { businessHours: { timezone: "+01:00", schedules: [] } } },
    });
    await expect(
      findAppointmentAvailability(createTenantContext(tenantA), prisma, {
        ...base,
        serviceId: serviceA,
        resourceId: resourceA,
      }),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityQueryValidationError);
    await prisma.appointmentResource.update({ where: { id: resourceA }, data: { metadata: {} } });
  });

  it("resolves unit timezone and rejects incompatible or inactive linked units", async () => {
    const [unitA, unitB] = await Promise.all([
      prisma.organizationUnit.create({
        data: { tenantId: tenantA, type: "branch", name: "Unit A", timezone: "America/New_York" },
      }),
      prisma.organizationUnit.create({
        data: { tenantId: tenantA, type: "branch", name: "Unit B", timezone: "Europe/London" },
      }),
    ]);
    const service = await prisma.appointmentService.create({
      data: {
        tenantId: tenantA,
        name: "Unit service",
        durationMinutes: 30,
        organizationUnitId: unitA.id,
      },
    });
    const resource = await prisma.appointmentResource.create({
      data: { tenantId: tenantA, name: "Unit resource" },
    });
    const input = { ...base, serviceId: service.id, resourceId: resource.id };
    expect(
      (await findAppointmentAvailability(createTenantContext(tenantA), prisma, input)).timezone,
    ).toBe("America/New_York");
    await prisma.appointmentResource.update({
      where: { id: resource.id },
      data: { organizationUnitId: unitB.id },
    });
    await expect(
      findAppointmentAvailability(createTenantContext(tenantA), prisma, input),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityTargetNotFoundError);
    await prisma.appointmentResource.update({
      where: { id: resource.id },
      data: { organizationUnitId: null },
    });
    await prisma.organizationUnit.update({ where: { id: unitA.id }, data: { active: false } });
    await expect(
      findAppointmentAvailability(createTenantContext(tenantA), prisma, input),
    ).rejects.toBeInstanceOf(AppointmentAvailabilityTargetNotFoundError);
  });
});
