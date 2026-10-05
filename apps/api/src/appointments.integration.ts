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

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
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
});
