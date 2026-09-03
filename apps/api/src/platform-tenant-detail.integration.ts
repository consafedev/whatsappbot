import { randomUUID } from "node:crypto";
import { hashPlatformSessionToken, PlatformPasswordHasher } from "@whatsapp-platform/auth";
import { loadNonSecretConfig } from "@whatsapp-platform/config";
import {
  createPlatformAuthRepository,
  createPlatformDatabaseClient,
  type PrismaClient,
} from "@whatsapp-platform/database/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "./app";

const origin = "http://localhost:3005";
const prefix = "e03-s03-api";
const adminEmail = `${prefix}-admin@example.invalid`;
const adminPassword = "platform tenant detail secure password";
const tenantPassword = "tenant detail cookie cannot authorize";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl = "";
let adminId = "";
let tenantId = "";
let platformCookie = "";
let tenantCookie = "";

function cookieFrom(response: Response, name: string) {
  const cookie = response.headers.get("set-cookie");
  if (cookie === null || !cookie.startsWith(`${name}=`)) throw new Error(`Expected ${name}`);
  return cookie.split(";", 1)[0] ?? "";
}

async function loginPlatform() {
  const response = await fetch(`${baseUrl}/platform/auth/login`, {
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    headers: { "content-type": "application/json", origin },
    method: "POST",
  });
  expect(response.status).toBe(200);
  return cookieFrom(response, "platform_session");
}

async function cleanup() {
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
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  await prisma.platformAdminSession.deleteMany({ where: { platformAdmin: { email: adminEmail } } });
  await prisma.platformAdmin.deleteMany({ where: { email: adminEmail } });
}

describe.sequential("Platform tenant detail API integration", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
    prisma = createPlatformDatabaseClient({ databaseUrl });
    await cleanup();
    const hasher = new PlatformPasswordHasher();
    const admin = await createPlatformAuthRepository(prisma).bootstrapAdmin({
      displayName: "E03 S03 Admin",
      email: adminEmail,
      locale: "es-MX",
      passwordHash: await hasher.hash(adminPassword),
      requestId: randomUUID(),
      timezone: "America/Mexico_City",
    });
    adminId = admin.id;
    const tenant = await prisma.tenant.create({
      data: {
        brandingConfig: { secretLogo: "must-not-leak" },
        defaultCurrency: "MXN",
        defaultLocale: "es-MX",
        defaultTimezone: "America/Mexico_City",
        displayName: "API Detail Tenant",
        legalName: "API Detail SA",
        settings: { privateSetting: "must-not-leak" },
        slug: `${prefix}-tenant`,
        status: "active",
      },
    });
    tenantId = tenant.id;
    const root = await prisma.organizationUnit.create({
      data: {
        address: { privateAddress: true },
        name: "API Root",
        settings: { secret: true },
        tenantId,
        type: "company",
      },
    });
    const [role, user] = await Promise.all([
      prisma.role.create({ data: { key: "owner", name: "Owner", tenantId } }),
      prisma.user.create({
        data: {
          displayName: "API Tenant User",
          email: `${prefix}-user@example.invalid`,
          locale: "es-MX",
          passwordHash: await hasher.hash(tenantPassword),
          tenantId,
          timezone: "America/Mexico_City",
        },
      }),
    ]);
    await Promise.all([
      prisma.userRole.create({
        data: { organizationUnitId: root.id, roleId: role.id, tenantId, userId: user.id },
      }),
      prisma.tenantEntitlement.create({
        data: {
          config: { privateEntitlement: true },
          enabled: true,
          entitlementKey: "module.messaging.basic",
          source: "plan",
          tenantId,
        },
      }),
      prisma.auditLog.create({
        data: {
          action: "tenant.read-test",
          actorId: user.id,
          actorType: "user",
          afterSummary: { secret: true },
          beforeSummary: { secret: true },
          entityId: tenantId,
          entityType: "Tenant",
          ipMetadata: { secretIp: true },
          requestId: `${prefix}-audit`,
          tenantId,
        },
      }),
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
    const login = await fetch(`${baseUrl}/auth/tenants/${prefix}-tenant/login`, {
      body: JSON.stringify({ email: `${prefix}-user@example.invalid`, password: tenantPassword }),
      headers: { "content-type": "application/json", origin },
      method: "POST",
    });
    expect(login.status).toBe(200);
    tenantCookie = cookieFrom(login, "tenant_session");
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("serves detail, paginated users and tenant-only audit to a Platform Admin", async () => {
    const [detailResponse, usersResponse, auditResponse] = await Promise.all([
      fetch(`${baseUrl}/platform/tenants/${tenantId}`, { headers: { cookie: platformCookie } }),
      fetch(`${baseUrl}/platform/tenants/${tenantId}/users?page=1&pageSize=25`, {
        headers: { cookie: platformCookie },
      }),
      fetch(`${baseUrl}/platform/tenants/${tenantId}/audit`, {
        headers: { cookie: platformCookie },
      }),
    ]);
    expect([detailResponse.status, usersResponse.status, auditResponse.status]).toEqual([
      200, 200, 200,
    ]);
    const detail = (await detailResponse.json()) as Record<string, unknown>;
    const users = (await usersResponse.json()) as { items: unknown[]; total: number };
    const audit = (await auditResponse.json()) as { items: unknown[]; total: number };
    expect(detail).toMatchObject({
      general: { id: tenantId, displayName: "API Detail Tenant", brandingOverride: true },
      channels: { available: false, count: null },
      backup: { available: false },
    });
    expect(users).toMatchObject({
      total: 1,
      items: [
        {
          displayName: "API Tenant User",
          roles: [{ key: "owner", organizationUnit: { name: "API Root" } }],
        },
      ],
    });
    expect(audit).toMatchObject({ total: 2 });
    expect(audit.items.map((item) => (item as { action: string }).action)).toEqual([
      "tenant_user.login.succeeded",
      "tenant.read-test",
    ]);
    const serialized = JSON.stringify({ detail, users, audit });
    for (const forbidden of [
      "passwordHash",
      "tokenHash",
      "brandingConfig",
      "settings",
      "baseUrl",
      "metadata",
      "privateSetting",
      "privateEntitlement",
      "beforeSummary",
      "afterSummary",
      "ipMetadata",
      "secretIp",
    ])
      expect(serialized).not.toContain(forbidden);
  });

  it("returns 401 without Platform authority, including Tenant User, revoked and disabled sessions", async () => {
    const path = `${baseUrl}/platform/tenants/${tenantId}`;
    expect((await fetch(path)).status).toBe(401);
    expect((await fetch(path, { headers: { cookie: tenantCookie } })).status).toBe(401);
    const revoked = await loginPlatform();
    const raw = revoked.split("=", 2)[1];
    if (raw === undefined) throw new Error("Missing token");
    await prisma.platformAdminSession.update({
      data: { revokedAt: new Date() },
      where: { tokenHash: new Uint8Array(hashPlatformSessionToken(raw)) },
    });
    expect((await fetch(path, { headers: { cookie: revoked } })).status).toBe(401);
    await prisma.platformAdmin.update({ data: { status: "disabled" }, where: { id: adminId } });
    expect((await fetch(path, { headers: { cookie: platformCookie } })).status).toBe(401);
    await prisma.platformAdmin.update({ data: { status: "active" }, where: { id: adminId } });
  });

  it("returns 400 for invalid identifiers and pagination", async () => {
    for (const path of ["not-a-uuid", "not-a-uuid/users", "not-a-uuid/audit"])
      expect(
        (
          await fetch(`${baseUrl}/platform/tenants/${path}`, {
            headers: { cookie: platformCookie },
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await fetch(`${baseUrl}/platform/tenants/${tenantId}/users?pageSize=101`, {
          headers: { cookie: platformCookie },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${baseUrl}/platform/tenants/${tenantId}/audit?unknown=1`, {
          headers: { cookie: platformCookie },
        })
      ).status,
    ).toBe(400);
  });

  it("returns 404 for a valid missing UUID on every detail endpoint", async () => {
    const missing = randomUUID();
    for (const suffix of ["", "/users", "/audit"])
      expect(
        (
          await fetch(`${baseUrl}/platform/tenants/${missing}${suffix}`, {
            headers: { cookie: platformCookie },
          })
        ).status,
      ).toBe(404);
  });
});
