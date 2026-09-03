import { randomUUID } from "node:crypto";
import {
  generateOpaqueToken,
  hashOpaqueToken,
  PlatformPasswordHasher,
} from "@whatsapp-platform/auth";
import { loadNonSecretConfig } from "@whatsapp-platform/config";
import {
  createPlatformAuthRepository,
  createPlatformDatabaseClient,
  type PrismaClient,
  syncPermissionCatalog,
} from "@whatsapp-platform/database/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "./app";

const origin = "http://localhost:3005";
const prefix = "e03-s04-api";
const adminEmail = `${prefix}-admin@example.invalid`;
const adminPassword = "module activation platform password";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl = "";
let adminId = "";
let tenantAId = "";
let tenantBId = "";
let platformCookie = "";
let ownerACookie = "";
let ownerBCookie = "";
let viewerACookie = "";

function binary(value: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

function cookieFrom(response: Response, name: string): string {
  const cookie = response.headers.get("set-cookie");
  if (cookie === null || !cookie.startsWith(`${name}=`)) throw new Error(`Expected ${name}`);
  return cookie.split(";", 1)[0] ?? "";
}

async function createTenantSession(tenantId: string, userId: string): Promise<string> {
  const token = generateOpaqueToken();
  await prisma.userSession.create({
    data: {
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      tenantId,
      tokenHash: binary(hashOpaqueToken(token)),
      userId,
    },
  });
  return `tenant_session=${token}`;
}

async function loginPlatform(): Promise<string> {
  const response = await fetch(`${baseUrl}/platform/auth/login`, {
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    headers: { "content-type": "application/json", origin },
    method: "POST",
  });
  expect(response.status).toBe(200);
  return cookieFrom(response, "platform_session");
}

async function patchModule(
  tenantId: string,
  body: unknown,
  key = "module.quotes",
  cookie = platformCookie,
): Promise<Response> {
  return fetch(
    `${baseUrl}/platform/tenants/${tenantId}/entitlements/modules/${encodeURIComponent(key)}`,
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        cookie,
        "x-request-id": `${prefix}-${randomUUID()}`,
      },
      method: "PATCH",
    },
  );
}

async function probe(cookie: string, suffix = ""): Promise<Response> {
  return fetch(`${baseUrl}/__test/entitlements/quotes-create${suffix}`, { headers: { cookie } });
}

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.userSession.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userRole.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: ids } } } });
  await prisma.role.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ tenantId: { in: ids } }, { requestId: { startsWith: prefix } }] },
  });
  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  await prisma.platformAdminSession.deleteMany({ where: { platformAdmin: { email: adminEmail } } });
  await prisma.platformAdmin.deleteMany({ where: { email: adminEmail } });
}

describe.sequential("E03-S04 module activation and enforcement", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
    prisma = createPlatformDatabaseClient({ databaseUrl });
    await cleanup();
    await syncPermissionCatalog(prisma);
    const hasher = new PlatformPasswordHasher();
    const admin = await createPlatformAuthRepository(prisma).bootstrapAdmin({
      displayName: "E03 S04 Admin",
      email: adminEmail,
      locale: "es-MX",
      passwordHash: await hasher.hash(adminPassword),
      requestId: `${prefix}-bootstrap`,
      timezone: "America/Mexico_City",
    });
    adminId = admin.id;
    const [tenantA, tenantB] = await Promise.all(
      ["a", "b"].map((marker) =>
        prisma.tenant.create({
          data: {
            defaultCurrency: "MXN",
            defaultLocale: "es-MX",
            defaultTimezone: "America/Mexico_City",
            displayName: `Entitlement ${marker}`,
            legalName: `Entitlement ${marker}`,
            slug: `${prefix}-${marker}`,
            status: "active",
          },
        }),
      ),
    );
    if (tenantA === undefined || tenantB === undefined) throw new Error("Tenant fixtures failed");
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key: "quotes.create" },
    });
    const [ownerRoleA, ownerRoleB, viewerRoleA] = await Promise.all([
      prisma.role.create({ data: { key: "owner", name: "Owner", tenantId: tenantAId } }),
      prisma.role.create({ data: { key: "owner", name: "Owner", tenantId: tenantBId } }),
      prisma.role.create({ data: { key: "viewer", name: "Viewer", tenantId: tenantAId } }),
    ]);
    await Promise.all([
      prisma.rolePermission.create({
        data: { permissionId: permission.id, roleId: ownerRoleA.id },
      }),
      prisma.rolePermission.create({
        data: { permissionId: permission.id, roleId: ownerRoleB.id },
      }),
    ]);
    const [ownerA, ownerB, viewerA] = await Promise.all([
      prisma.user.create({
        data: {
          displayName: "Owner A",
          email: `${prefix}-owner-a@example.invalid`,
          locale: "es-MX",
          passwordHash: "unused",
          tenantId: tenantAId,
          timezone: "UTC",
        },
      }),
      prisma.user.create({
        data: {
          displayName: "Owner B",
          email: `${prefix}-owner-b@example.invalid`,
          locale: "es-MX",
          passwordHash: "unused",
          tenantId: tenantBId,
          timezone: "UTC",
        },
      }),
      prisma.user.create({
        data: {
          displayName: "Viewer A",
          email: `${prefix}-viewer-a@example.invalid`,
          locale: "es-MX",
          passwordHash: "unused",
          tenantId: tenantAId,
          timezone: "UTC",
        },
      }),
    ]);
    await Promise.all([
      prisma.userRole.create({
        data: { roleId: ownerRoleA.id, tenantId: tenantAId, userId: ownerA.id },
      }),
      prisma.userRole.create({
        data: { roleId: ownerRoleB.id, tenantId: tenantBId, userId: ownerB.id },
      }),
      prisma.userRole.create({
        data: { roleId: viewerRoleA.id, tenantId: tenantAId, userId: viewerA.id },
      }),
    ]);
    [ownerACookie, ownerBCookie, viewerACookie] = await Promise.all([
      createTenantSession(tenantAId, ownerA.id),
      createTenantSession(tenantBId, ownerB.id),
      createTenantSession(tenantAId, viewerA.id),
    ]);
    app = await createApiApplication(
      loadNonSecretConfig({
        NODE_ENV: "test",
        PLATFORM_WEB_ORIGIN: origin,
        TENANT_WEB_ORIGIN: origin,
      }),
    );
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    platformCookie = await loginPlatform();
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("fails closed when absent and reflects enable-disable-enable in the same session", async () => {
    const absent = await probe(ownerACookie);
    expect(absent.status).toBe(403);
    expect(await absent.json()).toMatchObject({
      code: "ENTITLEMENT_REQUIRED",
      moduleKey: "module.quotes",
    });

    const enabled = await patchModule(tenantAId, {
      enabled: true,
      config: { template: "preserve" },
    });
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toMatchObject({
      effective: true,
      source: "manual_override",
      status: "effective",
    });
    expect((await probe(ownerACookie)).status).toBe(200);

    expect((await patchModule(tenantAId, { enabled: false })).status).toBe(200);
    expect((await probe(ownerACookie, "?module.quotes=true")).status).toBe(403);
    const forged = await fetch(`${baseUrl}/__test/entitlements/quotes-create`, {
      body: JSON.stringify({ moduleEnabled: true }),
      headers: {
        "content-type": "application/json",
        cookie: ownerACookie,
        "x-module-quotes": "true",
      },
      method: "POST",
    });
    expect(forged.status).toBe(403);
    expect((await patchModule(tenantAId, { enabled: true })).status).toBe(200);
    expect((await probe(ownerACookie)).status).toBe(200);
    const row = await prisma.tenantEntitlement.findUniqueOrThrow({
      where: { tenantId_entitlementKey: { entitlementKey: "module.quotes", tenantId: tenantAId } },
    });
    expect(row.config).toEqual({ template: "preserve" });
  });

  it("requires both permission and the tenant-local module without A/B contamination", async () => {
    await patchModule(tenantAId, { enabled: false });
    await patchModule(tenantBId, { enabled: true });
    expect((await probe(ownerACookie)).status).toBe(403);
    expect((await probe(ownerBCookie)).status).toBe(200);
    await patchModule(tenantAId, { enabled: true });
    expect((await probe(viewerACookie)).status).toBe(403);
    expect((await probe(ownerACookie)).status).toBe(200);
  });

  it("enforces future, expired and current windows from PostgreSQL", async () => {
    const now = Date.now();
    expect(
      (
        await patchModule(tenantAId, {
          enabled: true,
          startsAt: new Date(now + 60_000).toISOString(),
          endsAt: null,
        })
      ).status,
    ).toBe(200);
    expect((await probe(ownerACookie)).status).toBe(403);
    expect(
      (
        await patchModule(tenantAId, {
          startsAt: null,
          endsAt: new Date(now - 60_000).toISOString(),
        })
      ).status,
    ).toBe(200);
    expect((await probe(ownerACookie)).status).toBe(403);
    expect(
      (
        await patchModule(tenantAId, {
          startsAt: new Date(now - 60_000).toISOString(),
          endsAt: new Date(now + 60_000).toISOString(),
        })
      ).status,
    ).toBe(200);
    expect((await probe(ownerACookie)).status).toBe(200);
  });

  it("protects Platform mutations and rejects unknown targets and unsafe DTOs", async () => {
    expect((await patchModule(tenantAId, { enabled: true }, "module.quotes", "")).status).toBe(401);
    expect(
      (await patchModule(tenantAId, { enabled: true }, "module.quotes", ownerACookie)).status,
    ).toBe(401);
    expect((await patchModule(tenantAId, { enabled: true }, "module.fake")).status).toBe(400);
    expect((await patchModule(randomUUID(), { enabled: true })).status).toBe(404);
    expect((await patchModule(tenantAId, { source: "plan" })).status).toBe(400);
    expect((await patchModule(tenantAId, { config: [] })).status).toBe(400);
    const start = new Date(Date.now() + 120_000).toISOString();
    expect((await patchModule(tenantAId, { startsAt: start, endsAt: null })).status).toBe(200);
    expect((await patchModule(tenantAId, { endsAt: new Date().toISOString() })).status).toBe(400);
  });

  it("preserves exact Decimal limits and refreshes list/detail plus transactional records", async () => {
    await patchModule(tenantAId, { enabled: true, startsAt: null, endsAt: null });
    const limit = await fetch(
      `${baseUrl}/platform/tenants/${tenantAId}/entitlements/limits/limit.storage_bytes`,
      {
        body: JSON.stringify({ value: "9007199254740993" }),
        headers: {
          "content-type": "application/json",
          cookie: platformCookie,
          "x-request-id": `${prefix}-limit-exact`,
        },
        method: "PATCH",
      },
    );
    expect(limit.status).toBe(200);
    expect(await limit.json()).toMatchObject({ value: "9007199254740993.0000" });
    const [detailResponse, listResponse] = await Promise.all([
      fetch(`${baseUrl}/platform/tenants/${tenantAId}`, { headers: { cookie: platformCookie } }),
      fetch(`${baseUrl}/platform/tenants`, { headers: { cookie: platformCookie } }),
    ]);
    const detail = (await detailResponse.json()) as {
      limits: Array<{ key: string; limitValue: string | null }>;
    };
    const list = (await listResponse.json()) as {
      items: Array<{ id: string; enabledModules: string[] }>;
    };
    expect(detail.limits.find(({ key }) => key === "limit.storage_bytes")?.limitValue).toBe(
      "9007199254740993.0000",
    );
    expect(list.items.find(({ id }) => id === tenantAId)?.enabledModules).toContain(
      "module.quotes",
    );
    expect(
      await prisma.auditLog.count({
        where: { action: "tenant.entitlement.changed", tenantId: tenantAId },
      }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.domainEventOutbox.count({
        where: { eventType: "tenant.entitlement.changed", tenantId: tenantAId },
      }),
    ).toBeGreaterThan(0);
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key: "quotes.create" },
    });
    expect(permission.key).toBe("quotes.create");
    expect(adminId).not.toBe("");
  });
});
