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
const prefix = "e03-s05-api";
const adminEmail = `${prefix}-admin@example.invalid`;
const adminPassword = "tenant lifecycle platform password";
const ownerPassword = "tenant lifecycle owner password";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl = "";
let tenantAId = "";
let tenantBId = "";
let ownerAId = "";
let disabledAId = "";
let platformCookie = "";
let ownerACookie = "";
let ownerBCookie = "";

function binary(value: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

function cookieFrom(response: Response, name: string): string {
  const cookie = response.headers.get("set-cookie");
  if (cookie === null || !cookie.startsWith(`${name}=`)) throw new Error(`Expected ${name}`);
  return cookie.split(";", 1)[0] ?? "";
}

async function createTenantSession(
  tenantId: string,
  userId: string,
  expiresAt = new Date(Date.now() + 60 * 60 * 1000),
): Promise<{ cookie: string; id: string }> {
  const token = generateOpaqueToken();
  const session = await prisma.userSession.create({
    data: { expiresAt, tenantId, tokenHash: binary(hashOpaqueToken(token)), userId },
  });
  return { cookie: `tenant_session=${token}`, id: session.id };
}

async function platformLogin(): Promise<string> {
  const response = await fetch(`${baseUrl}/platform/auth/login`, {
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    headers: { "content-type": "application/json", origin },
    method: "POST",
  });
  expect(response.status).toBe(200);
  return cookieFrom(response, "platform_session");
}

function platformStatus(
  action: "suspend" | "reactivate",
  tenantId: string,
  cookie = platformCookie,
  body?: unknown,
) {
  return fetch(`${baseUrl}/platform/tenants/${tenantId}/${action}`, {
    headers: {
      cookie,
      "x-request-id": `${prefix}-${action}-${randomUUID()}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function probe(cookie: string, suffix = ""): Promise<Response> {
  return fetch(`${baseUrl}/__test/entitlements/quotes-create${suffix}`, { headers: { cookie } });
}

function tenantMe(cookie: string): Promise<Response> {
  return fetch(`${baseUrl}/auth/me`, { headers: { cookie } });
}

function tenantLogin(slug: string): Promise<Response> {
  return fetch(`${baseUrl}/auth/tenants/${slug}/login`, {
    body: JSON.stringify({ email: `${prefix}-owner-a@example.invalid`, password: ownerPassword }),
    headers: { "content-type": "application/json", origin },
    method: "POST",
  });
}

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.userPasswordResetToken.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userSession.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userRole.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: ids } } } });
  await prisma.role.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  await prisma.platformAdminSession.deleteMany({ where: { platformAdmin: { email: adminEmail } } });
  await prisma.platformAdmin.deleteMany({ where: { email: adminEmail } });
}

describe.sequential("E03-S05 suspend/reactivate tenant", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
    prisma = createPlatformDatabaseClient({ databaseUrl });
    await cleanup();
    await syncPermissionCatalog(prisma);
    const hasher = new PlatformPasswordHasher();
    await createPlatformAuthRepository(prisma).bootstrapAdmin({
      displayName: "E03 S05 Admin",
      email: adminEmail,
      locale: "es-MX",
      passwordHash: await hasher.hash(adminPassword),
      requestId: `${prefix}-bootstrap`,
      timezone: "America/Mexico_City",
    });
    const [tenantA, tenantB] = await Promise.all(
      ["a", "b"].map((marker) =>
        prisma.tenant.create({
          data: {
            defaultCurrency: "MXN",
            defaultLocale: "es-MX",
            defaultTimezone: "America/Mexico_City",
            displayName: `Lifecycle ${marker}`,
            legalName: `Lifecycle ${marker}`,
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
    const [roleA, roleB] = await Promise.all(
      [tenantAId, tenantBId].map((tenantId) =>
        prisma.role.create({ data: { key: "owner", name: "Owner", tenantId } }),
      ),
    );
    if (roleA === undefined || roleB === undefined) throw new Error("Role fixtures failed");
    await Promise.all([
      prisma.rolePermission.create({ data: { permissionId: permission.id, roleId: roleA.id } }),
      prisma.rolePermission.create({ data: { permissionId: permission.id, roleId: roleB.id } }),
    ]);
    const [ownerA, ownerB, disabledA] = await Promise.all([
      prisma.user.create({
        data: {
          displayName: "Owner A",
          email: `${prefix}-owner-a@example.invalid`,
          locale: "es-MX",
          passwordHash: await hasher.hash(ownerPassword),
          tenantId: tenantAId,
          timezone: "UTC",
        },
      }),
      prisma.user.create({
        data: {
          displayName: "Owner B",
          email: `${prefix}-owner-b@example.invalid`,
          locale: "es-MX",
          passwordHash: await hasher.hash(ownerPassword),
          tenantId: tenantBId,
          timezone: "UTC",
        },
      }),
      prisma.user.create({
        data: {
          displayName: "Disabled A",
          email: `${prefix}-disabled-a@example.invalid`,
          locale: "es-MX",
          passwordHash: await hasher.hash(ownerPassword),
          status: "disabled",
          tenantId: tenantAId,
          timezone: "UTC",
        },
      }),
    ]);
    ownerAId = ownerA.id;
    disabledAId = disabledA.id;
    await Promise.all([
      prisma.userRole.create({
        data: { roleId: roleA.id, tenantId: tenantAId, userId: ownerA.id },
      }),
      prisma.userRole.create({
        data: { roleId: roleB.id, tenantId: tenantBId, userId: ownerB.id },
      }),
      prisma.tenantEntitlement.create({
        data: {
          config: { preserved: true },
          enabled: true,
          entitlementKey: "module.quotes",
          source: "manual_override",
          tenantId: tenantAId,
        },
      }),
      prisma.tenantEntitlement.create({
        data: {
          config: { preserved: true },
          enabled: true,
          entitlementKey: "module.quotes",
          source: "manual_override",
          tenantId: tenantBId,
        },
      }),
    ]);
    const [a, b] = await Promise.all([
      createTenantSession(tenantAId, ownerA.id),
      createTenantSession(tenantBId, ownerB.id),
    ]);
    ownerACookie = a.cookie;
    ownerBCookie = b.cookie;
    app = await createApiApplication(
      loadNonSecretConfig({
        NODE_ENV: "test",
        PLATFORM_WEB_ORIGIN: origin,
        TENANT_WEB_ORIGIN: origin,
      }),
    );
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    platformCookie = await platformLogin();
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("blocks an existing session immediately without mutating it or tenant configuration", async () => {
    const beforeSession = await prisma.userSession.findFirstOrThrow({
      where: { tenantId: tenantAId, userId: ownerAId },
    });
    const resetToken = generateOpaqueToken();
    await prisma.userPasswordResetToken.create({
      data: {
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        tenantId: tenantAId,
        tokenHash: binary(hashOpaqueToken(resetToken)),
        userId: ownerAId,
      },
    });
    expect((await tenantMe(ownerACookie)).status).toBe(200);
    expect((await probe(ownerACookie)).status).toBe(200);
    expect((await tenantLogin(`${prefix}-a`)).status).toBe(200);

    const suspended = await platformStatus("suspend", tenantAId);
    expect(suspended.status).toBe(200);
    expect(await suspended.json()).toMatchObject({
      changed: true,
      tenant: { id: tenantAId, status: "suspended" },
    });
    expect((await tenantMe(ownerACookie)).status).toBe(401);
    expect((await probe(ownerACookie, "?status=active&tenantStatus=active")).status).toBe(401);
    expect((await tenantLogin(`${prefix}-a`)).status).toBe(401);
    const resetRequest = await fetch(`${baseUrl}/auth/tenants/${prefix}-a/password-reset/request`, {
      body: JSON.stringify({ email: `${prefix}-owner-a@example.invalid` }),
      headers: { "content-type": "application/json", origin },
      method: "POST",
    });
    expect(resetRequest.status).toBe(202);
    const resetConfirm = await fetch(`${baseUrl}/auth/tenants/${prefix}-a/password-reset/confirm`, {
      body: JSON.stringify({ newPassword: "tenant lifecycle reset password", token: resetToken }),
      headers: { "content-type": "application/json", origin },
      method: "POST",
    });
    expect(resetConfirm.status).toBe(400);
    expect((await platformStatus("suspend", tenantAId, ownerACookie)).status).toBe(401);
    expect(
      (await platformStatus("suspend", tenantAId, platformCookie, { status: "active" })).status,
    ).toBe(400);

    const afterSession = await prisma.userSession.findUniqueOrThrow({
      where: { id: beforeSession.id },
    });
    expect(afterSession).toMatchObject({
      expiresAt: beforeSession.expiresAt,
      revokedAt: beforeSession.revokedAt,
      tokenHash: beforeSession.tokenHash,
    });
    expect(
      await prisma.tenantEntitlement.findUniqueOrThrow({
        where: {
          tenantId_entitlementKey: { entitlementKey: "module.quotes", tenantId: tenantAId },
        },
      }),
    ).toMatchObject({ config: { preserved: true }, enabled: true });
  });

  it("reactivates the same valid session but never resurrects revoked, expired or disabled identities", async () => {
    const [revoked, expired, disabled] = await Promise.all([
      createTenantSession(tenantAId, ownerAId),
      createTenantSession(tenantAId, ownerAId, new Date(Date.now() - 1)),
      createTenantSession(tenantAId, disabledAId),
    ]);
    await prisma.userSession.update({ data: { revokedAt: new Date() }, where: { id: revoked.id } });
    const reactivated = await platformStatus("reactivate", tenantAId);
    expect(reactivated.status).toBe(200);
    expect(await reactivated.json()).toMatchObject({
      changed: true,
      tenant: { status: "active", suspendedAt: null },
    });
    expect((await tenantMe(ownerACookie)).status).toBe(200);
    expect((await probe(ownerACookie)).status).toBe(200);
    expect((await tenantLogin(`${prefix}-a`)).status).toBe(200);
    expect((await tenantMe(revoked.cookie)).status).toBe(401);
    expect((await tenantMe(expired.cookie)).status).toBe(401);
    expect((await tenantMe(disabled.cookie)).status).toBe(401);
  });

  it("keeps Platform Control and tenant B operational while tenant A is suspended", async () => {
    expect((await platformStatus("suspend", tenantAId)).status).toBe(200);
    expect((await probe(ownerACookie)).status).toBe(401);
    expect((await probe(ownerBCookie)).status).toBe(200);
    const module = await fetch(
      `${baseUrl}/platform/tenants/${tenantAId}/entitlements/modules/module.quotes`,
      {
        body: JSON.stringify({ enabled: true }),
        headers: { "content-type": "application/json", cookie: platformCookie },
        method: "PATCH",
      },
    );
    expect(module.status).toBe(200);
    expect((await probe(ownerACookie)).status).toBe(401);
    const [list, detail, users, audit] = await Promise.all([
      fetch(`${baseUrl}/platform/tenants`, { headers: { cookie: platformCookie } }),
      fetch(`${baseUrl}/platform/tenants/${tenantAId}`, { headers: { cookie: platformCookie } }),
      fetch(`${baseUrl}/platform/tenants/${tenantAId}/users`, {
        headers: { cookie: platformCookie },
      }),
      fetch(`${baseUrl}/platform/tenants/${tenantAId}/audit`, {
        headers: { cookie: platformCookie },
      }),
    ]);
    expect([list.status, detail.status, users.status, audit.status]).toEqual([200, 200, 200, 200]);
    expect((await detail.json()) as { general: { status: string } }).toMatchObject({
      general: { status: "suspended" },
    });
    expect((await platformStatus("reactivate", tenantAId)).status).toBe(200);
  });

  it("is idempotent, rejects invalid transitions and records only real status events", async () => {
    const first = await platformStatus("suspend", tenantAId);
    expect(first.status).toBe(200);
    const firstPayload = (await first.json()) as { tenant: { suspendedAt: string } };
    const duplicate = await platformStatus("suspend", tenantAId);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({
      changed: false,
      tenant: { suspendedAt: firstPayload.tenant.suspendedAt },
    });
    const reactivated = await platformStatus("reactivate", tenantAId);
    expect(reactivated.status).toBe(200);
    expect((await platformStatus("reactivate", tenantAId)).status).toBe(200);
    await prisma.tenant.update({ data: { status: "offboarding" }, where: { id: tenantAId } });
    expect((await platformStatus("suspend", tenantAId)).status).toBe(409);
    expect((await platformStatus("reactivate", tenantAId)).status).toBe(409);
    expect((await platformStatus("suspend", randomUUID())).status).toBe(404);
    expect((await platformStatus("suspend", "not-a-uuid")).status).toBe(400);
    expect(
      await prisma.auditLog.count({ where: { action: "tenant.suspended", tenantId: tenantAId } }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.domainEventOutbox.count({
        where: { eventType: "tenant.reactivated", tenantId: tenantAId },
      }),
    ).toBeGreaterThan(0);
  });
});
