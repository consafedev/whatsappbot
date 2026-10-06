import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AppointmentResourceNotFoundError,
  AppointmentResourceValidationError,
  archiveAppointmentResource,
  createAppointmentResource,
  getAppointmentResourceById,
  listAppointmentResources,
  updateAppointmentResource,
} from "./appointment-resource-manager";
import { createPlatformDatabaseClient, type PrismaClient } from "./platform";
import { createTenantContext } from "./tenant-context";
import { TenantNotOperationalError } from "./tenant-operational";

const prefix = "e14-s02-resource";
const metadata = { actorUserId: "e14-s02-test-user", requestId: `${prefix}-request` };
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";
let suspendedTenantId = "";
let unitAId = "";
let unitBId = "";
let userAId = "";
let userBId = "";
let disabledUserAId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.appointmentResource.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userRole.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

async function createUnit(tenantId: string, name: string): Promise<string> {
  const unit = await prisma.organizationUnit.create({
    data: { name, tenantId, type: "branch" },
  });
  return unit.id;
}

async function createUser(tenantId: string, marker: string, active = true): Promise<string> {
  const user = await prisma.user.create({
    data: {
      displayName: `Appointment ${marker}`,
      email: `${prefix}-${marker}@example.invalid`,
      locale: "es-MX",
      passwordHash: "integration-test-hash",
      status: active ? "active" : "disabled",
      tenantId,
      timezone: "America/Mexico_City",
    },
  });
  return user.id;
}

describe.sequential("E14-S02 appointment resource manager", () => {
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
            displayName: `Appointment resources ${marker}`,
            legalName: `Appointment resources ${marker}`,
            slug: `${prefix}-${marker}`,
            status: marker === "suspended" ? "suspended" : "active",
          },
        }),
      ),
    );
    const [tenantA, tenantB, suspendedTenant] = tenants;
    if (tenantA === undefined || tenantB === undefined || suspendedTenant === undefined) {
      throw new Error("Appointment resource tenant fixtures failed");
    }
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    suspendedTenantId = suspendedTenant.id;
    [unitAId, unitBId, userAId, userBId, disabledUserAId] = await Promise.all([
      createUnit(tenantAId, "Tenant A unit"),
      createUnit(tenantBId, "Tenant B unit"),
      createUser(tenantAId, "user-a"),
      createUser(tenantBId, "user-b"),
      createUser(tenantAId, "disabled-user", false),
    ]);
  });

  afterAll(async () => {
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("creates a typed resource with capacity and metadata and writes AuditLog/Outbox", async () => {
    const created = await createAppointmentResource(
      createTenantContext(tenantAId),
      prisma,
      {
        capacity: 3,
        metadata: { specialty: "dentistry" },
        name: "Dental chair",
        type: "EQUIPMENT",
      },
      metadata,
    );
    expect(created).toMatchObject({
      active: true,
      capacity: 3,
      metadata: { specialty: "dentistry" },
      name: "Dental chair",
      tenantId: tenantAId,
      type: "EQUIPMENT",
    });
    expect(
      await prisma.auditLog.findFirst({
        where: {
          action: "appointment_resource.created",
          entityId: created.id,
          tenantId: tenantAId,
        },
      }),
    ).toMatchObject({
      actorId: metadata.actorUserId,
      entityType: "AppointmentResource",
      requestId: metadata.requestId,
    });
    expect(
      await prisma.domainEventOutbox.findFirst({
        where: {
          aggregateId: created.id,
          eventType: "appointment_resource.created",
          tenantId: tenantAId,
        },
      }),
    ).not.toBeNull();
  });

  it("links an active tenant user and same-tenant OrganizationUnit", async () => {
    const resource = await createAppointmentResource(
      createTenantContext(tenantAId),
      prisma,
      {
        name: "Dr. A",
        organizationUnitId: unitAId,
        userId: userAId,
      },
      metadata,
    );
    expect(resource).toMatchObject({
      capacity: 1,
      organizationUnitId: unitAId,
      type: "PRACTITIONER",
      userId: userAId,
    });
  });

  it("rejects empty names and capacities outside the PostgreSQL INT4 range", async () => {
    for (const input of [
      { capacity: 0, name: "Zero capacity" },
      { capacity: -1, name: "Negative capacity" },
      { capacity: 2_147_483_648, name: "Overflow capacity" },
      { capacity: 1.5, name: "Fractional capacity" },
      { capacity: 1, name: "  " },
    ]) {
      await expect(
        createAppointmentResource(createTenantContext(tenantAId), prisma, input, metadata),
      ).rejects.toBeInstanceOf(AppointmentResourceValidationError);
    }
    const resource = await createAppointmentResource(
      createTenantContext(tenantAId),
      prisma,
      { name: "Update capacity bounds" },
      metadata,
    );
    await expect(
      updateAppointmentResource(
        createTenantContext(tenantAId),
        prisma,
        resource.id,
        { capacity: 2_147_483_648 },
        metadata,
      ),
    ).rejects.toBeInstanceOf(AppointmentResourceValidationError);
  });

  it("rejects cross-tenant units/users and disabled user assignments", async () => {
    const context = createTenantContext(tenantAId);
    await expect(
      createAppointmentResource(
        context,
        prisma,
        { name: "Foreign unit", organizationUnitId: unitBId },
        metadata,
      ),
    ).rejects.toBeInstanceOf(AppointmentResourceValidationError);
    await expect(
      createAppointmentResource(
        context,
        prisma,
        { name: "Foreign user", userId: userBId },
        metadata,
      ),
    ).rejects.toBeInstanceOf(AppointmentResourceValidationError);
    await expect(
      createAppointmentResource(
        context,
        prisma,
        { name: "Disabled user", userId: disabledUserAId },
        metadata,
      ),
    ).rejects.toBeInstanceOf(AppointmentResourceValidationError);
    const resource = await createAppointmentResource(
      context,
      prisma,
      { name: "Safe assignments" },
      metadata,
    );
    await expect(
      updateAppointmentResource(
        context,
        prisma,
        resource.id,
        { organizationUnitId: unitBId },
        metadata,
      ),
    ).rejects.toBeInstanceOf(AppointmentResourceValidationError);
    await expect(
      updateAppointmentResource(context, prisma, resource.id, { userId: userBId }, metadata),
    ).rejects.toBeInstanceOf(AppointmentResourceValidationError);
  });

  it("lists by active/type/unit/user/search with pagination and a tenant total", async () => {
    const context = createTenantContext(tenantAId);
    await createAppointmentResource(
      context,
      prisma,
      { name: "Dental room", type: "ROOM", organizationUnitId: unitAId },
      metadata,
    );
    const target = await createAppointmentResource(
      context,
      prisma,
      {
        name: "Dental practitioner",
        type: "PRACTITIONER",
        organizationUnitId: unitAId,
        userId: userAId,
      },
      metadata,
    );
    await updateAppointmentResource(context, prisma, target.id, { active: false }, metadata);
    await createAppointmentResource(
      createTenantContext(tenantBId),
      prisma,
      { name: "Dental practitioner B", type: "PRACTITIONER", userId: userBId },
      metadata,
    );

    const page = await listAppointmentResources(context, prisma, {
      active: true,
      limit: 1,
      offset: 0,
      organizationUnitId: unitAId,
      search: "dental",
      type: "ROOM",
      userId: userAId,
    });
    expect(page.items).toHaveLength(0);
    expect(page.total).toBe(0);
    const inactivePractitioner = await listAppointmentResources(context, prisma, {
      active: false,
      type: "PRACTITIONER",
      userId: userAId,
    });
    expect(inactivePractitioner.items.map(({ id }) => id)).toEqual([target.id]);
    expect(inactivePractitioner.total).toBe(1);
    const roomPage = await listAppointmentResources(context, prisma, {
      active: true,
      limit: 1,
      offset: 0,
      organizationUnitId: unitAId,
      search: "dental",
      type: "ROOM",
    });
    expect(roomPage.items.map(({ name }) => name)).toEqual(["Dental room"]);
    expect(roomPage.total).toBe(1);
    const all = await listAppointmentResources(context, prisma, { search: "dental" });
    expect(all.items.every(({ tenantId }) => tenantId === tenantAId)).toBe(true);
    expect(all.total).toBe(3);

    await expect(
      listAppointmentResources(context, prisma, {
        search: ["dental", "room"] as unknown as string,
      }),
    ).rejects.toBeInstanceOf(AppointmentResourceValidationError);
  });

  it("rejects an undefined-only patch without creating audit or outbox records", async () => {
    const context = createTenantContext(tenantAId);
    const resource = await createAppointmentResource(
      context,
      prisma,
      { name: "Empty patch" },
      metadata,
    );
    const auditBefore = await prisma.auditLog.count({
      where: { entityId: resource.id, tenantId: tenantAId },
    });
    const outboxBefore = await prisma.domainEventOutbox.count({
      where: { aggregateId: resource.id, tenantId: tenantAId },
    });
    await expect(
      updateAppointmentResource(
        context,
        prisma,
        resource.id,
        { name: undefined, capacity: undefined },
        metadata,
      ),
    ).rejects.toBeInstanceOf(AppointmentResourceValidationError);
    expect(
      await prisma.auditLog.count({ where: { entityId: resource.id, tenantId: tenantAId } }),
    ).toBe(auditBefore);
    expect(
      await prisma.domainEventOutbox.count({
        where: { aggregateId: resource.id, tenantId: tenantAId },
      }),
    ).toBe(outboxBefore);
  });

  it("returns the same 404 for missing and foreign-tenant IDs on read/update/archive", async () => {
    const contextA = createTenantContext(tenantAId);
    const contextB = createTenantContext(tenantBId);
    const resource = await createAppointmentResource(
      contextA,
      prisma,
      { name: "Tenant A resource" },
      metadata,
    );
    await expect(getAppointmentResourceById(contextB, prisma, resource.id)).rejects.toBeInstanceOf(
      AppointmentResourceNotFoundError,
    );
    await expect(
      updateAppointmentResource(contextB, prisma, resource.id, { name: "Hijacked" }, metadata),
    ).rejects.toBeInstanceOf(AppointmentResourceNotFoundError);
    await expect(
      archiveAppointmentResource(contextB, prisma, resource.id, metadata),
    ).rejects.toBeInstanceOf(AppointmentResourceNotFoundError);
    await expect(getAppointmentResourceById(contextA, prisma, resource.id)).resolves.toMatchObject({
      name: "Tenant A resource",
    });
  });

  it("archives by deactivation and records the mutation", async () => {
    const context = createTenantContext(tenantAId);
    const resource = await createAppointmentResource(
      context,
      prisma,
      { name: "Archive resource" },
      metadata,
    );
    const archived = await archiveAppointmentResource(context, prisma, resource.id, metadata);
    expect(archived.active).toBe(false);
    expect(
      await prisma.auditLog.count({
        where: {
          action: "appointment_resource.archived",
          entityId: resource.id,
          tenantId: tenantAId,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.domainEventOutbox.count({
        where: {
          aggregateId: resource.id,
          eventType: "appointment_resource.archived",
          tenantId: tenantAId,
        },
      }),
    ).toBe(1);
  });

  it("rejects mutations for tenants that are not operational", async () => {
    await expect(
      createAppointmentResource(
        createTenantContext(suspendedTenantId),
        prisma,
        { name: "Suspended resource" },
        metadata,
      ),
    ).rejects.toBeInstanceOf(TenantNotOperationalError);
  });
});
