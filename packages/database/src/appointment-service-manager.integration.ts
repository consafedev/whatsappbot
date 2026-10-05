import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AppointmentServiceNotFoundError,
  AppointmentServiceValidationError,
  archiveAppointmentService,
  createAppointmentService,
  getAppointmentServiceById,
  listAppointmentServices,
  updateAppointmentService,
} from "./appointment-service-manager";
import { createPlatformDatabaseClient, Prisma, type PrismaClient } from "./platform";
import { createTenantContext } from "./tenant-context";
import { TenantNotOperationalError } from "./tenant-operational";

const prefix = "e14-s01-service";
const metadata = { actorUserId: "e14-s01-test-user", requestId: `${prefix}-request` };
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";
let suspendedTenantId = "";
let unitAId = "";
let unitBId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.appointmentService.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

async function createUnit(tenantId: string, name: string): Promise<string> {
  const unit = await prisma.organizationUnit.create({
    data: { name, tenantId, type: "branch" },
  });
  return unit.id;
}

describe.sequential("E14-S01 appointment service manager", () => {
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
            displayName: `Appointment Services ${marker}`,
            legalName: `Appointment Services ${marker}`,
            slug: `${prefix}-${marker}`,
            status: marker === "suspended" ? "suspended" : "active",
          },
        }),
      ),
    );
    const [tenantA, tenantB, suspendedTenant] = tenants;
    if (tenantA === undefined || tenantB === undefined || suspendedTenant === undefined) {
      throw new Error("Appointment service tenant fixtures failed");
    }
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    suspendedTenantId = suspendedTenant.id;
    [unitAId, unitBId] = await Promise.all([
      createUnit(tenantAId, "Tenant A unit"),
      createUnit(tenantBId, "Tenant B unit"),
    ]);
  });

  afterAll(async () => {
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("creates a service with duration, buffers, price, and atomic audit/outbox records", async () => {
    const created = await createAppointmentService(
      createTenantContext(tenantAId),
      prisma,
      {
        bufferAfterMinutes: 10,
        bufferBeforeMinutes: 5,
        currency: "USD",
        description: "Initial consultation",
        durationMinutes: 45,
        name: "Consultation",
        organizationUnitId: unitAId,
        price: new Prisma.Decimal("125.50"),
      },
      metadata,
    );

    expect(created).toMatchObject({
      active: true,
      bufferAfterMinutes: 10,
      bufferBeforeMinutes: 5,
      currency: "USD",
      description: "Initial consultation",
      durationMinutes: 45,
      name: "Consultation",
      organizationUnitId: unitAId,
      price: new Prisma.Decimal("125.50"),
      tenantId: tenantAId,
    });

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "appointment_service.created",
        entityId: created.id,
        tenantId: tenantAId,
      },
    });
    expect(audit).toMatchObject({
      actorId: metadata.actorUserId,
      actorType: "tenant_user",
      entityType: "AppointmentService",
      organizationUnitId: unitAId,
      requestId: metadata.requestId,
    });
    expect(audit?.afterSummary).toMatchObject({
      bufferAfterMinutes: 10,
      bufferBeforeMinutes: 5,
      currency: "USD",
      durationMinutes: 45,
      name: "Consultation",
      price: "125.50",
    });

    const event = await prisma.domainEventOutbox.findFirst({
      where: {
        aggregateId: created.id,
        eventType: "appointment_service.created",
        tenantId: tenantAId,
      },
    });
    expect(event?.payload).toMatchObject({
      appointmentServiceId: created.id,
      tenantId: tenantAId,
    });
  });

  it("rejects invalid duration, buffers, and price", async () => {
    const context = createTenantContext(tenantAId);
    for (const input of [
      { durationMinutes: 0, name: "Invalid duration" },
      { bufferBeforeMinutes: -1, durationMinutes: 30, name: "Invalid before buffer" },
      { bufferAfterMinutes: -1, durationMinutes: 30, name: "Invalid after buffer" },
      { durationMinutes: 30, name: "Invalid price", price: -0.01 },
    ]) {
      await expect(
        createAppointmentService(context, prisma, input, metadata),
      ).rejects.toBeInstanceOf(AppointmentServiceValidationError);
    }
  });

  it("rejects an OrganizationUnit owned by another tenant", async () => {
    await expect(
      createAppointmentService(
        createTenantContext(tenantAId),
        prisma,
        { durationMinutes: 30, name: "Foreign unit", organizationUnitId: unitBId },
        metadata,
      ),
    ).rejects.toBeInstanceOf(AppointmentServiceValidationError);
  });

  it("validates updates and allows explicit OrganizationUnit detachment", async () => {
    const context = createTenantContext(tenantAId);
    const service = await createAppointmentService(
      context,
      prisma,
      { durationMinutes: 30, name: "Update validation", organizationUnitId: unitAId },
      metadata,
    );

    await expect(
      updateAppointmentService(context, prisma, service.id, { durationMinutes: 0 }, metadata),
    ).rejects.toBeInstanceOf(AppointmentServiceValidationError);
    await expect(
      updateAppointmentService(
        context,
        prisma,
        service.id,
        { organizationUnitId: unitBId },
        metadata,
      ),
    ).rejects.toBeInstanceOf(AppointmentServiceValidationError);

    const detached = await updateAppointmentService(
      context,
      prisma,
      service.id,
      { organizationUnitId: null },
      metadata,
    );
    expect(detached.organizationUnitId).toBeNull();
  });

  it("lists with tenant, active, unit, search, pagination, and total filters", async () => {
    const context = createTenantContext(tenantAId);
    await createAppointmentService(
      context,
      prisma,
      { durationMinutes: 30, name: "Dental cleaning", organizationUnitId: unitAId },
      metadata,
    );
    const target = await createAppointmentService(
      context,
      prisma,
      { durationMinutes: 60, name: "Dental surgery", organizationUnitId: unitAId },
      metadata,
    );
    await updateAppointmentService(context, prisma, target.id, { active: false }, metadata);
    await createAppointmentService(
      createTenantContext(tenantBId),
      prisma,
      { durationMinutes: 20, name: "Dental surgery B", organizationUnitId: unitBId },
      metadata,
    );

    const page = await listAppointmentServices(context, prisma, {
      active: true,
      limit: 1,
      offset: 0,
      organizationUnitId: unitAId,
      search: "dental",
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.name).toBe("Dental cleaning");
    expect(page.total).toBe(1);

    const all = await listAppointmentServices(context, prisma, { search: "dental" });
    expect(all.items.every(({ tenantId }) => tenantId === tenantAId)).toBe(true);
    expect(all.total).toBe(2);
  });

  it("returns the same not-found result for missing and foreign-tenant IDs", async () => {
    const contextA = createTenantContext(tenantAId);
    const contextB = createTenantContext(tenantBId);
    const serviceA = await createAppointmentService(
      contextA,
      prisma,
      { durationMinutes: 30, name: "Tenant A private service" },
      metadata,
    );

    await expect(getAppointmentServiceById(contextB, prisma, serviceA.id)).rejects.toBeInstanceOf(
      AppointmentServiceNotFoundError,
    );
    await expect(
      updateAppointmentService(contextB, prisma, serviceA.id, { name: "Hijacked" }, metadata),
    ).rejects.toBeInstanceOf(AppointmentServiceNotFoundError);
    await expect(
      archiveAppointmentService(contextB, prisma, serviceA.id, metadata),
    ).rejects.toBeInstanceOf(AppointmentServiceNotFoundError);
    await expect(getAppointmentServiceById(contextA, prisma, serviceA.id)).resolves.toMatchObject({
      name: "Tenant A private service",
    });
  });

  it("archives by deactivation and records the update atomically", async () => {
    const context = createTenantContext(tenantAId);
    const service = await createAppointmentService(
      context,
      prisma,
      { durationMinutes: 30, name: "Archive me" },
      metadata,
    );
    const archived = await archiveAppointmentService(context, prisma, service.id, metadata);
    expect(archived.active).toBe(false);
    expect(
      await prisma.auditLog.count({
        where: {
          action: "appointment_service.archived",
          entityId: service.id,
          tenantId: tenantAId,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.domainEventOutbox.count({
        where: {
          aggregateId: service.id,
          eventType: "appointment_service.archived",
          tenantId: tenantAId,
        },
      }),
    ).toBe(1);
  });

  it("rejects mutations for non-operational tenants", async () => {
    await expect(
      createAppointmentService(
        createTenantContext(suspendedTenantId),
        prisma,
        { durationMinutes: 30, name: "Suspended service" },
        metadata,
      ),
    ).rejects.toBeInstanceOf(TenantNotOperationalError);
  });
});
