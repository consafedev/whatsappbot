import {
  generateOpaqueToken,
  hashOpaqueToken,
  PlatformPasswordHasher,
} from "@whatsapp-platform/auth";
import { loadDatabaseConfig, loadNonSecretConfig } from "@whatsapp-platform/config";
import {
  createPlatformDatabaseClient,
  type PrismaClient,
  syncPermissionCatalog,
} from "@whatsapp-platform/database/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "./app";

const prefix = "e14-s01-service-api";
const password = "appointment service API integration password";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl = "";
let tenantAId = "";
let tenantBId = "";
let readCookie = "";
let manageCookie = "";
let noPermissionCookie = "";

function binary(value: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

async function createSession(tenantId: string, userId: string): Promise<string> {
  const token = generateOpaqueToken();
  await prisma.userSession.create({
    data: {
      expiresAt: new Date(Date.now() + 3_600_000),
      tenantId,
      tokenHash: binary(hashOpaqueToken(token)),
      userId,
    },
  });
  return `tenant_session=${token}`;
}

async function createUser(
  tenantId: string,
  marker: string,
  permissionKeys: readonly string[],
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      displayName: `Appointment ${marker}`,
      email: `${prefix}-${marker}@example.invalid`,
      locale: "es-MX",
      passwordHash: await new PlatformPasswordHasher().hash(password),
      tenantId,
      timezone: "America/Mexico_City",
    },
  });
  const role = await prisma.role.create({
    data: { key: `e14-${marker}`, name: `E14 ${marker}`, tenantId },
  });
  for (const key of permissionKeys) {
    const permission = await prisma.permission.findUnique({ where: { key } });
    if (permission === null) throw new Error(`Missing canonical permission: ${key}`);
    await prisma.rolePermission.create({ data: { permissionId: permission.id, roleId: role.id } });
  }
  await prisma.userRole.create({ data: { roleId: role.id, tenantId, userId: user.id } });
  return user.id;
}

function servicesUrl(path = ""): string {
  return `${baseUrl}/api/v1/appointments/services${path}`;
}

function resourcesUrl(path = ""): string {
  return `${baseUrl}/api/v1/appointments/resources${path}`;
}

function availabilityRulesUrl(path = ""): string {
  return `${baseUrl}/api/v1/appointments/availability-rules${path}`;
}

function availabilityUrl(path = ""): string {
  return `${baseUrl}/api/v1/appointments/availability${path}`;
}

function availabilityExceptionsUrl(path = ""): string {
  return `${baseUrl}/api/v1/appointments/exceptions${path}`;
}

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.appointmentAvailabilityRule.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentResource.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentService.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userSession.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userRole.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: ids } } } });
  await prisma.role.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

describe.sequential("E14-S01 appointments API", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    const [tenantA, tenantB] = await Promise.all(
      ["a", "b"].map((marker) =>
        prisma.tenant.create({
          data: {
            defaultCurrency: "MXN",
            defaultLocale: "es-MX",
            defaultTimezone: "America/Mexico_City",
            displayName: `Appointment API ${marker}`,
            legalName: `Appointment API ${marker}`,
            slug: `${prefix}-${marker}`,
            status: "active",
          },
        }),
      ),
    );
    if (tenantA === undefined || tenantB === undefined) throw new Error("Tenant fixtures failed");
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    await prisma.tenantEntitlement.createMany({
      data: [tenantAId, tenantBId].map((tenantId) => ({
        enabled: true,
        entitlementKey: "module.appointments",
        source: "contract" as const,
        tenantId,
      })),
    });
    const [readUser, manageUser, noPermissionUser] = await Promise.all([
      createUser(tenantAId, "reader", ["appointments.read"]),
      createUser(tenantAId, "manager", ["appointments.manage"]),
      createUser(tenantAId, "none", []),
    ]);
    readCookie = await createSession(tenantAId, readUser);
    manageCookie = await createSession(tenantAId, manageUser);
    noPermissionCookie = await createSession(tenantAId, noPermissionUser);
    app = await createApiApplication(loadNonSecretConfig({ NODE_ENV: "test" }));
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("requires a tenant session, module entitlement, and route permission", async () => {
    expect((await fetch(servicesUrl())).status).toBe(401);
    expect((await fetch(servicesUrl(), { headers: { cookie: noPermissionCookie } })).status).toBe(
      403,
    );
    expect((await fetch(servicesUrl(), { headers: { cookie: manageCookie } })).status).toBe(403);
    expect(
      (
        await fetch(servicesUrl(), {
          body: JSON.stringify({ durationMinutes: 30, name: "Reader cannot create" }),
          headers: { cookie: readCookie, "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(403);
    expect((await fetch(servicesUrl(), { headers: { cookie: readCookie } })).status).toBe(200);
    expect(
      (
        await fetch(servicesUrl("?search=north&search=south"), {
          headers: { cookie: readCookie },
        })
      ).status,
    ).toBe(400);
    expect((await fetch(resourcesUrl(), { headers: { cookie: readCookie } })).status).toBe(200);

    await prisma.tenantEntitlement.update({
      data: { enabled: false },
      where: {
        tenantId_entitlementKey: {
          entitlementKey: "module.appointments",
          tenantId: tenantAId,
        },
      },
    });
    expect((await fetch(servicesUrl(), { headers: { cookie: readCookie } })).status).toBe(403);
    expect((await fetch(resourcesUrl(), { headers: { cookie: readCookie } })).status).toBe(403);
    await prisma.tenantEntitlement.update({
      data: { enabled: true },
      where: {
        tenantId_entitlementKey: {
          entitlementKey: "module.appointments",
          tenantId: tenantAId,
        },
      },
    });
  });

  it("creates and lists services with the standard success envelope", async () => {
    const response = await fetch(servicesUrl(), {
      body: JSON.stringify({
        bufferAfterMinutes: 10,
        bufferBeforeMinutes: 5,
        durationMinutes: 45,
        name: "Initial consultation",
        price: "125.50",
      }),
      headers: {
        cookie: manageCookie,
        "content-type": "application/json",
        "x-request-id": `${prefix}-create`,
      },
      method: "POST",
    });
    expect(response.status).toBe(201);
    const createdBody = (await response.json()) as { success: boolean; data: { id: string } };
    expect(createdBody.success).toBe(true);
    expect(createdBody.data.id).toBeTruthy();
    expect(await prisma.appointmentService.count({ where: { tenantId: tenantAId } })).toBe(1);

    const list = await fetch(servicesUrl("?active=true&search=consultation&limit=20&offset=0"), {
      headers: { cookie: readCookie },
    });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      success: boolean;
      data: { items: Array<{ name: string }>; total: number };
    };
    expect(listBody).toMatchObject({
      data: { items: [{ name: "Initial consultation" }], total: 1 },
      success: true,
    });

    const detail = await fetch(servicesUrl(`/${createdBody.data.id}`), {
      headers: { cookie: readCookie },
    });
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { data: { name: string } }).data.name).toBe(
      "Initial consultation",
    );

    const updated = await fetch(servicesUrl(`/${createdBody.data.id}`), {
      body: JSON.stringify({ name: "Updated consultation", organizationUnitId: null }),
      headers: {
        cookie: manageCookie,
        "content-type": "application/json",
        "x-request-id": `${prefix}-patch`,
      },
      method: "PATCH",
    });
    expect(updated.status).toBe(200);

    const archived = await fetch(servicesUrl(`/${createdBody.data.id}`), {
      headers: { cookie: manageCookie, "x-request-id": `${prefix}-delete` },
      method: "DELETE",
    });
    expect(archived.status).toBe(200);
    expect(
      await prisma.appointmentService.findUnique({
        where: { id: createdBody.data.id, tenantId: tenantAId },
      }),
    ).toMatchObject({ active: false, name: "Updated consultation" });
  });

  it("requires manage permission for mutations and returns 404 across tenants", async () => {
    const created = await prisma.appointmentService.create({
      data: { durationMinutes: 30, name: "Private service", tenantId: tenantBId },
    });
    expect(
      (
        await fetch(servicesUrl(`/${created.id}`), {
          headers: { cookie: readCookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(servicesUrl(`/${created.id}`), {
          body: JSON.stringify({ name: "Hijacked" }),
          headers: { cookie: manageCookie, "content-type": "application/json" },
          method: "PATCH",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(servicesUrl(`/${created.id}`), {
          headers: { cookie: manageCookie },
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(servicesUrl("/00000000-0000-7000-8000-000000000001"), {
          headers: { cookie: readCookie },
        })
      ).status,
    ).toBe(404);
  });

  it("returns 400 and persists nothing for out-of-range integer fields", async () => {
    const response = await fetch(servicesUrl(), {
      body: JSON.stringify({ durationMinutes: 3_000_000_000, name: "Out of range service" }),
      headers: {
        cookie: manageCookie,
        "content-type": "application/json",
        "x-request-id": `${prefix}-out-of-range`,
      },
      method: "POST",
    });
    expect(response.status).toBe(400);
    expect(
      await prisma.appointmentService.count({
        where: { name: "Out of range service", tenantId: tenantAId },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { action: "appointment_service.created", requestId: `${prefix}-out-of-range` },
      }),
    ).toBe(0);
  });

  it("manages resources with the appointments guards, validation, envelope, and tenant 404s", async () => {
    expect((await fetch(resourcesUrl())).status).toBe(401);
    expect(
      (
        await fetch(resourcesUrl("?search=north&search=south"), {
          headers: { cookie: readCookie },
        })
      ).status,
    ).toBe(400);
    expect((await fetch(resourcesUrl(), { headers: { cookie: noPermissionCookie } })).status).toBe(
      403,
    );
    expect(
      (
        await fetch(resourcesUrl(), {
          body: JSON.stringify({ name: "Reader cannot create" }),
          headers: { cookie: readCookie, "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(resourcesUrl(), {
          body: JSON.stringify({ capacity: 2_147_483_648, name: "Capacity overflow" }),
          headers: { cookie: manageCookie, "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(400);
    const unknownKey = await fetch(resourcesUrl(), {
      body: JSON.stringify({ color: "red", name: "Unknown key" }),
      headers: { cookie: manageCookie, "content-type": "application/json" },
      method: "POST",
    });
    expect(unknownKey.status).toBe(400);
    expect(JSON.stringify(await unknownKey.json())).toContain(
      "Invalid appointment resource request",
    );

    const response = await fetch(resourcesUrl(), {
      body: JSON.stringify({
        capacity: 2,
        metadata: { room: "north" },
        name: "North room",
        type: "ROOM",
      }),
      headers: {
        cookie: manageCookie,
        "content-type": "application/json",
        "x-request-id": `${prefix}-resource-create`,
      },
      method: "POST",
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      success: boolean;
      data: { active: boolean; capacity: number; id: string; name: string; type: string };
    };
    expect(created).toMatchObject({
      data: { active: true, capacity: 2, name: "North room", type: "ROOM" },
      success: true,
    });

    const list = await fetch(
      resourcesUrl("?active=true&type=ROOM&search=north&limit=20&offset=0"),
      {
        headers: { cookie: readCookie },
      },
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      data: { items: [{ id: created.data.id, name: "North room" }], total: 1 },
      success: true,
    });

    const detail = await fetch(resourcesUrl(`/${created.data.id}`), {
      headers: { cookie: readCookie },
    });
    expect(detail.status).toBe(200);
    const updated = await fetch(resourcesUrl(`/${created.data.id}`), {
      body: JSON.stringify({ capacity: 3 }),
      headers: { cookie: manageCookie, "content-type": "application/json" },
      method: "PATCH",
    });
    expect(updated.status).toBe(200);
    const archived = await fetch(resourcesUrl(`/${created.data.id}`), {
      headers: { cookie: manageCookie },
      method: "DELETE",
    });
    expect(archived.status).toBe(200);
    expect(
      await prisma.appointmentResource.findUnique({
        where: { id: created.data.id, tenantId: tenantAId },
      }),
    ).toMatchObject({ active: false, capacity: 3 });

    const foreign = await prisma.appointmentResource.create({
      data: { name: "Tenant B resource", tenantId: tenantBId },
    });
    expect(
      (await fetch(resourcesUrl(`/${foreign.id}`), { headers: { cookie: readCookie } })).status,
    ).toBe(404);
    expect(
      (
        await fetch(resourcesUrl(`/${foreign.id}`), {
          body: JSON.stringify({ name: "Hijacked" }),
          headers: { cookie: manageCookie, "content-type": "application/json" },
          method: "PATCH",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(resourcesUrl(`/${foreign.id}`), {
          headers: { cookie: manageCookie },
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(resourcesUrl("/00000000-0000-7000-8000-000000000001"), {
          headers: { cookie: readCookie },
        })
      ).status,
    ).toBe(404);
  });

  it("manages availability rules with tenant guards, strict validation, audit, and envelopes", async () => {
    expect((await fetch(availabilityRulesUrl())).status).toBe(401);
    expect(
      (await fetch(availabilityRulesUrl(), { headers: { cookie: noPermissionCookie } })).status,
    ).toBe(403);
    expect(
      (await fetch(availabilityRulesUrl(), { headers: { cookie: manageCookie } })).status,
    ).toBe(403);
    expect(
      (
        await fetch(availabilityRulesUrl("?dayOfWeek=1&dayOfWeek=2"), {
          headers: { cookie: readCookie },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(availabilityRulesUrl("?active=true&active=false"), {
          headers: { cookie: readCookie },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(availabilityRulesUrl(), {
          body: JSON.stringify({
            dayOfWeek: 1,
            endTime: "10:00",
            resourceId: "00000000-0000-7000-8000-000000000001",
            startTime: "9:00",
          }),
          headers: { cookie: readCookie, "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(403);

    await prisma.tenantEntitlement.update({
      data: { enabled: false },
      where: {
        tenantId_entitlementKey: {
          entitlementKey: "module.appointments",
          tenantId: tenantAId,
        },
      },
    });
    try {
      expect(
        (await fetch(availabilityRulesUrl(), { headers: { cookie: readCookie } })).status,
      ).toBe(403);
    } finally {
      await prisma.tenantEntitlement.update({
        data: { enabled: true },
        where: {
          tenantId_entitlementKey: {
            entitlementKey: "module.appointments",
            tenantId: tenantAId,
          },
        },
      });
    }

    const resourceA = await prisma.appointmentResource.create({
      data: { name: "Availability API A", tenantId: tenantAId },
    });
    const invalid = await fetch(availabilityRulesUrl(), {
      body: JSON.stringify({
        dayOfWeek: 1,
        endTime: "09:00",
        resourceId: resourceA.id,
        startTime: "10:00",
      }),
      headers: { cookie: manageCookie, "content-type": "application/json" },
      method: "POST",
    });
    expect(invalid.status).toBe(400);
    expect(await prisma.appointmentAvailabilityRule.count({ where: { tenantId: tenantAId } })).toBe(
      0,
    );

    const createdResponse = await fetch(availabilityRulesUrl(), {
      body: JSON.stringify({
        capacity: 2,
        dayOfWeek: 1,
        effectiveFrom: "2026-10-01",
        effectiveTo: "2026-12-31",
        endTime: "17:00",
        resourceId: resourceA.id,
        startTime: "09:00",
        timezone: "America/Mexico_City",
      }),
      headers: {
        cookie: manageCookie,
        "content-type": "application/json",
        "x-request-id": `${prefix}-availability-create`,
      },
      method: "POST",
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      success: boolean;
      data: { active: boolean; capacity: number; dayOfWeek: number; id: string; startTime: string };
    };
    expect(created).toMatchObject({
      data: { active: true, capacity: 2, dayOfWeek: 1, startTime: "09:00" },
      success: true,
    });
    expect(
      await prisma.appointmentAvailabilityRule.findFirst({
        where: { id: created.data.id, tenantId: tenantAId },
      }),
    ).toMatchObject({ resourceId: resourceA.id, tenantId: tenantAId });

    const list = await fetch(
      availabilityRulesUrl(`?resourceId=${resourceA.id}&dayOfWeek=1&active=true&limit=20&offset=0`),
      { headers: { cookie: readCookie } },
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      data: { items: [{ id: created.data.id, resourceId: resourceA.id }], total: 1 },
      success: true,
    });
    expect(
      (
        await fetch(availabilityRulesUrl(`/${created.data.id}`), {
          headers: { cookie: readCookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(availabilityRulesUrl(`/${created.data.id}`), {
          body: JSON.stringify({ active: false }),
          headers: { cookie: readCookie, "content-type": "application/json" },
          method: "PATCH",
        })
      ).status,
    ).toBe(403);
    const updated = await fetch(availabilityRulesUrl(`/${created.data.id}`), {
      body: JSON.stringify({ endTime: "18:00" }),
      headers: { cookie: manageCookie, "content-type": "application/json" },
      method: "PATCH",
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { data: { endTime: string } }).data.endTime).toBe("18:00");
    const deleted = await fetch(availabilityRulesUrl(`/${created.data.id}`), {
      headers: { cookie: manageCookie },
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(
      await prisma.appointmentAvailabilityRule.findFirst({
        where: { id: created.data.id, tenantId: tenantAId },
      }),
    ).toBeNull();

    const resourceB = await prisma.appointmentResource.create({
      data: { name: "Availability API B", tenantId: tenantBId },
    });
    const foreign = await prisma.appointmentAvailabilityRule.create({
      data: {
        dayOfWeek: 2,
        endTime: "10:00",
        resourceId: resourceB.id,
        startTime: "09:00",
        tenantId: tenantBId,
      },
    });
    expect(
      (await fetch(availabilityRulesUrl(`/${foreign.id}`), { headers: { cookie: readCookie } }))
        .status,
    ).toBe(404);
    expect(
      (
        await fetch(availabilityRulesUrl(`/${foreign.id}`), {
          body: JSON.stringify({ active: false }),
          headers: { cookie: manageCookie, "content-type": "application/json" },
          method: "PATCH",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(availabilityRulesUrl(`/${foreign.id}`), {
          headers: { cookie: manageCookie },
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
  });

  it("manages availability exceptions with guards, strict timestamps, overlap filters, and tenant 404s", async () => {
    expect((await fetch(availabilityExceptionsUrl())).status).toBe(401);
    expect(
      (await fetch(availabilityExceptionsUrl(), { headers: { cookie: noPermissionCookie } }))
        .status,
    ).toBe(403);
    expect(
      (await fetch(availabilityExceptionsUrl(), { headers: { cookie: manageCookie } })).status,
    ).toBe(403);
    expect(
      (
        await fetch(
          availabilityExceptionsUrl("?from=2026-10-25T00%3A00%3A00Z&from=2026-10-26T00%3A00%3A00Z"),
          { headers: { cookie: readCookie } },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(availabilityExceptionsUrl("?active=true&active=false"), {
          headers: { cookie: readCookie },
        })
      ).status,
    ).toBe(400);
    await prisma.tenantEntitlement.update({
      data: { enabled: false },
      where: {
        tenantId_entitlementKey: {
          entitlementKey: "module.appointments",
          tenantId: tenantAId,
        },
      },
    });
    try {
      expect(
        (await fetch(availabilityExceptionsUrl(), { headers: { cookie: readCookie } })).status,
      ).toBe(403);
    } finally {
      await prisma.tenantEntitlement.update({
        data: { enabled: true },
        where: {
          tenantId_entitlementKey: {
            entitlementKey: "module.appointments",
            tenantId: tenantAId,
          },
        },
      });
    }

    const resourceA = await prisma.appointmentResource.create({
      data: { name: "Exception API A", tenantId: tenantAId },
    });
    const inactiveResource = await prisma.appointmentResource.create({
      data: { active: false, name: "Inactive exception resource", tenantId: tenantAId },
    });
    expect(
      (
        await fetch(availabilityExceptionsUrl(), {
          body: JSON.stringify({
            resourceId: inactiveResource.id,
            startsAt: "2026-10-26T09:00:00Z",
            endsAt: "2026-10-26T10:00:00Z",
          }),
          headers: { cookie: manageCookie, "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(400);
    const invalidBodies = [
      { resourceId: resourceA.id, startsAt: "2026-10-25T09:00:00", endsAt: "2026-10-25T10:00:00Z" },
      {
        resourceId: resourceA.id,
        startsAt: "2026-02-30T09:00:00Z",
        endsAt: "2026-02-30T10:00:00Z",
      },
      {
        resourceId: resourceA.id,
        startsAt: "2026-10-25T10:00:00Z",
        endsAt: "2026-10-25T09:00:00Z",
      },
    ];
    for (const body of invalidBodies) {
      expect(
        (
          await fetch(availabilityExceptionsUrl(), {
            body: JSON.stringify(body),
            headers: { cookie: manageCookie, "content-type": "application/json" },
            method: "POST",
          })
        ).status,
      ).toBe(400);
    }

    const createdResponse = await fetch(availabilityExceptionsUrl(), {
      body: JSON.stringify({
        resourceId: resourceA.id,
        type: "BLOCKED",
        startsAt: "2026-10-26T09:00:00-06:00",
        endsAt: "2026-10-26T10:00:00-06:00",
        reason: "  Maintenance  ",
      }),
      headers: {
        cookie: manageCookie,
        "content-type": "application/json",
        "x-request-id": `${prefix}-exception-create`,
      },
      method: "POST",
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      success: boolean;
      data: { id: string; reason: string; startsAt: string };
    };
    expect(created).toMatchObject({
      success: true,
      data: { reason: "Maintenance", startsAt: "2026-10-26T15:00:00.000Z" },
    });
    expect(
      await prisma.auditLog.count({
        where: {
          requestId: `${prefix}-exception-create`,
          action: "appointment_availability_exception.created",
        },
      }),
    ).toBe(1);

    const touching = await prisma.appointmentAvailabilityException.create({
      data: {
        endsAt: new Date("2026-10-26T17:00:00Z"),
        resourceId: resourceA.id,
        startsAt: new Date("2026-10-26T16:00:00Z"),
        tenantId: tenantAId,
        type: "EXTRA_AVAILABILITY",
      },
    });
    const list = await fetch(
      availabilityExceptionsUrl(
        "?resourceId=" +
          resourceA.id +
          "&from=2026-10-26T16%3A00%3A00Z&to=2026-10-26T17%3A00%3A00Z&type=EXTRA_AVAILABILITY",
      ),
      { headers: { cookie: readCookie } },
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      success: true,
      data: { items: [{ id: touching.id }], total: 1 },
    });
    expect(
      (
        await fetch(availabilityExceptionsUrl(`/${created.data.id}`), {
          headers: { cookie: readCookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(availabilityExceptionsUrl(`/${created.data.id}`), {
          body: JSON.stringify({ reason: " " }),
          headers: { cookie: manageCookie, "content-type": "application/json" },
          method: "PATCH",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(availabilityExceptionsUrl(`/${created.data.id}`), {
          body: JSON.stringify({ unexpected: true }),
          headers: { cookie: manageCookie, "content-type": "application/json" },
          method: "PATCH",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(availabilityExceptionsUrl(`/${created.data.id}`), {
          headers: { cookie: manageCookie },
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
    expect(
      await prisma.appointmentAvailabilityException.findFirst({
        where: { id: created.data.id, tenantId: tenantAId },
      }),
    ).toBeNull();

    const resourceB = await prisma.appointmentResource.create({
      data: { name: "Exception API B", tenantId: tenantBId },
    });
    const foreign = await prisma.appointmentAvailabilityException.create({
      data: {
        endsAt: new Date("2026-10-26T10:00:00Z"),
        resourceId: resourceB.id,
        startsAt: new Date("2026-10-26T09:00:00Z"),
        tenantId: tenantBId,
      },
    });
    expect(
      (
        await fetch(availabilityExceptionsUrl(`/${foreign.id}`), {
          headers: { cookie: readCookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(availabilityExceptionsUrl(`/${foreign.id}`), {
          body: JSON.stringify({ active: false }),
          headers: { cookie: manageCookie, "content-type": "application/json" },
          method: "PATCH",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(availabilityExceptionsUrl(`/${foreign.id}`), {
          headers: { cookie: manageCookie },
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
  });

  it("guards and validates the availability query", async () => {
    const service = await prisma.appointmentService.create({
      data: { tenantId: tenantAId, name: "Availability API service", durationMinutes: 30 },
    });
    const resource = await prisma.appointmentResource.create({
      data: { tenantId: tenantAId, name: "Availability API resource" },
    });
    const ruleBody = {
      resourceId: resource.id,
      serviceId: service.id,
      dayOfWeek: 1,
      startTime: "09:00",
      endTime: "11:00",
      timezone: "UTC",
    };
    const created = await fetch(availabilityRulesUrl(), {
      method: "POST",
      headers: { cookie: manageCookie, "content-type": "application/json" },
      body: JSON.stringify(ruleBody),
    });
    expect(created.status).toBe(201);
    const listed = await fetch(availabilityRulesUrl(`?serviceId=${service.id}`), {
      headers: { cookie: readCookie },
    });
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as { data: { items: Array<{ serviceId: string }> } };
    expect(listedBody.data.items.some((item) => item.serviceId === service.id)).toBe(true);
    const foreignService = await prisma.appointmentService.create({
      data: { tenantId: tenantBId, name: "Foreign availability service", durationMinutes: 30 },
    });
    expect(
      (
        await fetch(availabilityRulesUrl(), {
          method: "POST",
          headers: { cookie: manageCookie, "content-type": "application/json" },
          body: JSON.stringify({ ...ruleBody, serviceId: foreignService.id }),
        })
      ).status,
    ).toBe(400);
    const query = `?serviceId=${service.id}&resourceId=${resource.id}&from=2026-10-26T09%3A00%3A00Z&to=2026-10-26T10%3A00%3A00Z&limit=1`;
    expect((await fetch(availabilityUrl(query))).status).toBe(401);
    expect(
      (await fetch(availabilityUrl(query), { headers: { cookie: noPermissionCookie } })).status,
    ).toBe(403);
    expect(
      (await fetch(availabilityUrl(query), { headers: { cookie: manageCookie } })).status,
    ).toBe(403);
    const response = await fetch(availabilityUrl(query), { headers: { cookie: readCookie } });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      data: { timezone: string; slots: Array<{ startsAt: string }>; nextFrom?: string };
    };
    expect(result.data.slots[0]?.startsAt).toBe("2026-10-26T09:00:00.000Z");
    expect(result.data.nextFrom).toBe("2026-10-26T09:01:00.000Z");
    expect(
      (await fetch(availabilityUrl(`${query}&limit=2`), { headers: { cookie: readCookie } }))
        .status,
    ).toBe(400);
    expect(
      (await fetch(availabilityUrl(`${query}&unexpected=1`), { headers: { cookie: readCookie } }))
        .status,
    ).toBe(400);
    expect(
      (
        await fetch(
          availabilityUrl(query.replace("2026-10-26T09%3A00%3A00Z", "2026-10-26T09%3A00%3A00")),
          { headers: { cookie: readCookie } },
        )
      ).status,
    ).toBe(400);
  });

  it("accepts 24:00 only as an availability-rule end boundary over HTTP", async () => {
    const resource = await prisma.appointmentResource.create({
      data: { tenantId: tenantAId, name: "Midnight API resource" },
    });
    const valid = { resourceId: resource.id, dayOfWeek: 1, startTime: "22:00", endTime: "24:00" };
    const headers = { cookie: manageCookie, "content-type": "application/json" };
    const created = await fetch(availabilityRulesUrl(), {
      method: "POST",
      headers,
      body: JSON.stringify(valid),
    });
    expect(created.status).toBe(201);
    const response = (await created.json()) as { data: { id: string; endTime: string } };
    expect(response.data.endTime).toBe("24:00");
    expect(
      (
        await fetch(availabilityRulesUrl(`/${response.data.id}`), {
          method: "PATCH",
          headers,
          body: JSON.stringify({ endTime: "23:59" }),
        })
      ).status,
    ).toBe(200);
    const restored = await fetch(availabilityRulesUrl(`/${response.data.id}`), {
      method: "PATCH",
      headers,
      body: JSON.stringify({ endTime: "24:00" }),
    });
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as { data: { endTime: string } }).data.endTime).toBe("24:00");
    for (const invalid of [
      { ...valid, startTime: "24:00" },
      { ...valid, endTime: "24:01" },
    ]) {
      expect(
        (
          await fetch(availabilityRulesUrl(), {
            method: "POST",
            headers,
            body: JSON.stringify(invalid),
          })
        ).status,
      ).toBe(400);
    }
    for (const patch of [{ startTime: "24:00" }, { endTime: "24:01" }]) {
      expect(
        (
          await fetch(availabilityRulesUrl(`/${response.data.id}`), {
            method: "PATCH",
            headers,
            body: JSON.stringify(patch),
          })
        ).status,
      ).toBe(400);
    }
  });
});
