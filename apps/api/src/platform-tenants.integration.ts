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

const origin = "http://localhost:3000";
const prefix = "e03-s01-api";
const adminEmail = `${prefix}-admin@example.invalid`;
const adminPassword = "platform tenant list secure password";
const tenantPassword = "tenant cookie must not authorize platform";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl: string;
let adminId: string;
let platformCookie: string;
let tenantCookie: string;

function cookieFrom(response: Response, name: string): string {
  const cookie = response.headers.get("set-cookie");
  if (cookie === null || !cookie.startsWith(`${name}=`)) throw new Error(`Expected ${name}`);
  return cookie.split(";", 1)[0] ?? "";
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

async function cleanup(): Promise<void> {
  await prisma.userSession.deleteMany({ where: { tenant: { slug: { startsWith: prefix } } } });
  await prisma.auditLog.deleteMany({ where: { tenant: { slug: { startsWith: prefix } } } });
  await prisma.tenantEntitlement.deleteMany({
    where: { tenant: { slug: { startsWith: prefix } } },
  });
  await prisma.user.deleteMany({ where: { tenant: { slug: { startsWith: prefix } } } });
  await prisma.tenant.deleteMany({ where: { slug: { startsWith: prefix } } });
  await prisma.platformAdminSession.deleteMany({ where: { platformAdmin: { email: adminEmail } } });
  await prisma.platformAdmin.deleteMany({ where: { email: adminEmail } });
  await prisma.auditLog.deleteMany({ where: { actorId: adminId || "not-created" } });
}

describe.sequential("Platform tenant list API integration", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
    prisma = createPlatformDatabaseClient({ databaseUrl });
    await cleanup();
    const hasher = new PlatformPasswordHasher();
    const admin = await createPlatformAuthRepository(prisma).bootstrapAdmin({
      displayName: "E03 S01 Admin",
      email: adminEmail,
      locale: "es-MX",
      passwordHash: await hasher.hash(adminPassword),
      requestId: randomUUID(),
      timezone: "America/Mexico_City",
    });
    adminId = admin.id;
    const tenants = await Promise.all(
      [
        ["Alpha API", "active"],
        ["Beta API", "suspended"],
        ["Gamma API", "provisioning"],
      ].map(([displayName, status], index) =>
        prisma.tenant.create({
          data: {
            brandingConfig: { privateBranding: "must-not-leak" },
            defaultCurrency: "MXN",
            defaultLocale: "es-MX",
            defaultTimezone: "America/Mexico_City",
            displayName: displayName ?? "",
            legalName: `${displayName} Legal`,
            settings: { privateSetting: "must-not-leak" },
            slug: `${prefix}-${index + 1}`,
            status: status as "active" | "suspended" | "provisioning",
          },
        }),
      ),
    );
    const user = await prisma.user.create({
      data: {
        displayName: "Tenant User",
        email: `${prefix}-user@example.invalid`,
        locale: "es-MX",
        passwordHash: await hasher.hash(tenantPassword),
        tenantId: tenants[0]?.id ?? "",
        timezone: "America/Mexico_City",
      },
    });
    await prisma.tenantEntitlement.create({
      data: {
        config: { privateEntitlement: "must-not-leak" },
        enabled: true,
        entitlementKey: "module.messaging.basic",
        source: "plan",
        tenantId: user.tenantId,
      },
    });

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
    const tenantLogin = await fetch(`${baseUrl}/auth/tenants/${prefix}-1/login`, {
      body: JSON.stringify({ email: `${prefix}-user@example.invalid`, password: tenantPassword }),
      headers: { "content-type": "application/json", origin },
      method: "POST",
    });
    expect(tenantLogin.status).toBe(200);
    tenantCookie = cookieFrom(tenantLogin, "tenant_session");
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("returns a real paginated safe list to a valid Platform Admin session", async () => {
    const response = await fetch(`${baseUrl}/platform/tenants?search=${prefix}`, {
      headers: { cookie: platformCookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<Record<string, unknown>>;
      page: number;
      pageSize: number;
      total: number;
    };
    expect(body).toMatchObject({ page: 1, pageSize: 25, total: 3 });
    expect(body.items.map(({ displayName }) => displayName)).toEqual([
      "Alpha API",
      "Beta API",
      "Gamma API",
    ]);
    expect(body.items[0]).toEqual({
      channelCount: null,
      deployment: null,
      displayName: "Alpha API",
      enabledModules: ["module.messaging.basic"],
      id: body.items[0]?.id,
      lastActivityAt: expect.any(String),
      legalName: "Alpha API Legal",
      slug: `${prefix}-1`,
      status: "active",
      userCount: 1,
    });
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      "passwordHash",
      "tokenHash",
      "brandingConfig",
      "settings",
      "baseUrl",
      "metadata",
      "config",
      "privateBranding",
      "privateSetting",
      "privateEntitlement",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("returns 401 without a Platform session and for a real Tenant User cookie", async () => {
    expect((await fetch(`${baseUrl}/platform/tenants`)).status).toBe(401);
    expect(
      (await fetch(`${baseUrl}/platform/tenants`, { headers: { cookie: tenantCookie } })).status,
    ).toBe(401);
  });

  it("returns 401 for a revoked Platform session", async () => {
    const revokedCookie = await loginPlatform();
    const raw = revokedCookie.split("=", 2)[1];
    if (raw === undefined) throw new Error("Missing platform token");
    await prisma.platformAdminSession.update({
      data: { revokedAt: new Date() },
      where: { tokenHash: new Uint8Array(hashPlatformSessionToken(raw)) },
    });
    expect(
      (await fetch(`${baseUrl}/platform/tenants`, { headers: { cookie: revokedCookie } })).status,
    ).toBe(401);
  });

  it("returns 401 when the Platform Admin is disabled", async () => {
    await prisma.platformAdmin.update({ data: { status: "disabled" }, where: { id: adminId } });
    expect(
      (await fetch(`${baseUrl}/platform/tenants`, { headers: { cookie: platformCookie } })).status,
    ).toBe(401);
    await prisma.platformAdmin.update({ data: { status: "active" }, where: { id: adminId } });
  });

  it("validates pagination and canonical status while supporting search/filter", async () => {
    const active = await fetch(
      `${baseUrl}/platform/tenants?search=ALPHA%20API&status=active&page=1&pageSize=1`,
      { headers: { cookie: platformCookie } },
    );
    expect(active.status).toBe(200);
    await expect(active.json()).resolves.toMatchObject({ page: 1, pageSize: 1, total: 1 });
    expect(
      (
        await fetch(`${baseUrl}/platform/tenants?status=not-real`, {
          headers: { cookie: platformCookie },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${baseUrl}/platform/tenants?pageSize=101`, {
          headers: { cookie: platformCookie },
        })
      ).status,
    ).toBe(400);
  });
});
