import { randomUUID } from "node:crypto";
import {
  hashOpaqueToken,
  PlatformPasswordHasher,
  tenantCookieConfig,
} from "@whatsapp-platform/auth";
import { loadNonSecretConfig } from "@whatsapp-platform/config";
import {
  createPlatformAuthRepository,
  createPlatformDatabaseClient,
  createTenantAuthRepository,
  type PrismaClient,
} from "@whatsapp-platform/database/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "./app";
import {
  type PasswordResetDelivery,
  type PasswordResetDeliveryMessage,
  TenantAuthService,
} from "./tenant-auth";

const origin = "http://localhost:3000";
const sharedEmail = "same-user@example.invalid";
const tenantA = { slug: "e02-s02-a", password: "tenant A secure passphrase" };
const tenantB = { slug: "e02-s02-b", password: "tenant B secure passphrase" };
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl: string;
let tenantAId: string;
let tenantBId: string;
let userAId: string;
const deliveries: PasswordResetDeliveryMessage[] = [];
const delivery: PasswordResetDelivery = {
  deliver: async (message) => {
    deliveries.push(message);
  },
};

function cookieFrom(response: Response, name = "tenant_session"): string {
  const cookie = response.headers.get("set-cookie");
  if (cookie === null || !cookie.startsWith(`${name}=`)) throw new Error(`Expected ${name} cookie`);
  return cookie.split(";", 1)[0] ?? "";
}

async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      ...(cookie === undefined ? {} : { cookie }),
      "content-type": "application/json",
      origin,
    },
    method: "POST",
  });
}

async function login(slug: string, password: string, email = sharedEmail): Promise<Response> {
  return post(`/auth/tenants/${slug}/login`, { email, password });
}

describe.sequential("tenant user authentication integration", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
    prisma = createPlatformDatabaseClient({ databaseUrl });
    await prisma.userPasswordResetToken.deleteMany({
      where: { tenant: { slug: { startsWith: "e02-s02-" } } },
    });
    await prisma.userSession.deleteMany({
      where: { tenant: { slug: { startsWith: "e02-s02-" } } },
    });
    await prisma.user.deleteMany({ where: { tenant: { slug: { startsWith: "e02-s02-" } } } });
    await prisma.platformAdminSession.deleteMany({
      where: { platformAdmin: { email: "e02-s02-platform@example.invalid" } },
    });
    await prisma.platformAdmin.deleteMany({ where: { email: "e02-s02-platform@example.invalid" } });
    await prisma.auditLog.deleteMany({ where: { tenant: { slug: { startsWith: "e02-s02-" } } } });
    await prisma.tenant.deleteMany({ where: { slug: { startsWith: "e02-s02-" } } });

    const createdA = await prisma.tenant.create({
      data: {
        defaultCurrency: "MXN",
        defaultLocale: "es-MX",
        defaultTimezone: "America/Mexico_City",
        displayName: "Tenant Auth A",
        legalName: "Tenant Auth A",
        slug: tenantA.slug,
        status: "active",
      },
    });
    const createdB = await prisma.tenant.create({
      data: {
        defaultCurrency: "MXN",
        defaultLocale: "es-MX",
        defaultTimezone: "America/Mexico_City",
        displayName: "Tenant Auth B",
        legalName: "Tenant Auth B",
        slug: tenantB.slug,
        status: "active",
      },
    });
    tenantAId = createdA.id;
    tenantBId = createdB.id;

    const repository = createTenantAuthRepository(prisma);
    const service = new TenantAuthService(
      repository,
      { cookie: tenantCookieConfig("test"), webOrigin: origin },
      delivery,
    );
    userAId = (
      await service.createTenantUserIdentity({
        displayName: "Same User A",
        email: ` ${sharedEmail.toUpperCase()} `,
        password: tenantA.password,
        tenantId: tenantAId,
      })
    ).id;
    await service.createTenantUserIdentity({
      displayName: "Same User B",
      email: sharedEmail,
      password: tenantB.password,
      tenantId: tenantBId,
    });
    await service.createTenantUserIdentity({
      displayName: "Other User",
      email: "other-user@example.invalid",
      password: "other user secure passphrase",
      tenantId: tenantAId,
    });
    await createPlatformAuthRepository(prisma).bootstrapAdmin({
      displayName: "Platform Isolation",
      email: "e02-s02-platform@example.invalid",
      locale: "es-MX",
      passwordHash: await new PlatformPasswordHasher().hash("platform isolation passphrase"),
      requestId: randomUUID(),
      timezone: "America/Mexico_City",
    });

    app = await createApiApplication(
      loadNonSecretConfig({
        NODE_ENV: "test",
        PLATFORM_WEB_ORIGIN: origin,
        TENANT_WEB_ORIGIN: origin,
      }),
      {
        passwordResetDelivery: delivery,
      },
    );
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (prisma !== undefined) {
      await prisma.userPasswordResetToken.deleteMany({
        where: { tenant: { slug: { startsWith: "e02-s02-" } } },
      });
      await prisma.userSession.deleteMany({
        where: { tenant: { slug: { startsWith: "e02-s02-" } } },
      });
      await prisma.user.deleteMany({ where: { tenant: { slug: { startsWith: "e02-s02-" } } } });
      await prisma.platformAdminSession.deleteMany({
        where: { platformAdmin: { email: "e02-s02-platform@example.invalid" } },
      });
      await prisma.platformAdmin.deleteMany({
        where: { email: "e02-s02-platform@example.invalid" },
      });
      await prisma.auditLog.deleteMany({
        where: { tenant: { slug: { startsWith: "e02-s02-" } } },
      });
      await prisma.tenant.deleteMany({ where: { slug: { startsWith: "e02-s02-" } } });
      await prisma.$disconnect();
    }
  });

  it("enforces tenant-owned physical identity and composite session integrity", async () => {
    const users = await prisma.user.findMany({ where: { email: sharedEmail } });
    expect(users).toHaveLength(2);
    expect(
      users.every(
        (user) =>
          user.passwordHash.startsWith("$argon2id$") && user.passwordHash !== tenantA.password,
      ),
    ).toBe(true);
    await expect(
      prisma.user.create({
        data: {
          displayName: "Duplicate",
          email: sharedEmail,
          locale: "es-MX",
          passwordHash: users[0]?.passwordHash ?? "invalid",
          tenantId: tenantAId,
          timezone: "America/Mexico_City",
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.userSession.create({
        data: {
          expiresAt: new Date(Date.now() + 60_000),
          tenantId: tenantBId,
          tokenHash: new Uint8Array(hashOpaqueToken("invalid-composite")),
          userId: userAId,
        },
      }),
    ).rejects.toBeDefined();
    const [version] = await prisma.$queryRaw<Array<{ version: number }>>`
      SELECT uuid_extract_version(${userAId}::uuid) AS version
    `;
    expect(version?.version).toBe(7);
    const physical = await prisma.$queryRaw<
      Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>
    >`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (
          (table_name = 'tenant_user' AND column_name = 'tenant_id') OR
          (table_name IN ('user_session', 'user_password_reset_token') AND column_name = 'token_hash') OR
          (table_name = 'user_session' AND column_name = 'expires_at')
        )
      ORDER BY table_name, column_name
    `;
    expect(physical).toEqual([
      { column_name: "tenant_id", data_type: "uuid", is_nullable: "NO", table_name: "tenant_user" },
      {
        column_name: "token_hash",
        data_type: "bytea",
        is_nullable: "NO",
        table_name: "user_password_reset_token",
      },
      {
        column_name: "expires_at",
        data_type: "timestamp with time zone",
        is_nullable: "NO",
        table_name: "user_session",
      },
      {
        column_name: "token_hash",
        data_type: "bytea",
        is_nullable: "NO",
        table_name: "user_session",
      },
    ]);
  });

  it("scopes same-email login by tenant slug and returns generic failures", async () => {
    expect((await login(tenantA.slug, tenantA.password)).status).toBe(200);
    expect((await login(tenantB.slug, tenantB.password)).status).toBe(200);
    const failures = await Promise.all([
      login("unknown-tenant", tenantA.password),
      login(tenantA.slug, "incorrect password value"),
      login(tenantA.slug, tenantB.password),
      login(tenantB.slug, tenantA.password),
    ]);
    expect(failures.map((response) => response.status)).toEqual([401, 401, 401, 401]);
    const messages = await Promise.all(
      failures.map(async (response) => ((await response.json()) as { message: string }).message),
    );
    expect(new Set(messages).size).toBe(1);
  });

  it("creates hash-only opaque sessions and returns safe /me", async () => {
    const response = await login(tenantA.slug, tenantA.password);
    const cookie = cookieFrom(response);
    const body = (await response.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toMatch(/token|passwordHash/);
    const rawToken = cookie.split("=", 2)[1] ?? "";
    const session = await prisma.userSession.findUniqueOrThrow({
      where: { tokenHash: new Uint8Array(hashOpaqueToken(rawToken)) },
    });
    expect(Buffer.from(session.tokenHash)).toHaveLength(32);
    expect(rawToken).not.toContain(session.id);
    const me = await fetch(`${baseUrl}/auth/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(JSON.stringify(await me.json())).not.toContain("passwordHash");
    expect((await fetch(`${baseUrl}/auth/me`)).status).toBe(401);
    expect(
      (await fetch(`${baseUrl}/auth/me`, { headers: { cookie: `tenant_session=${session.id}` } }))
        .status,
    ).toBe(401);
  });

  it("isolates platform and tenant cookies in both directions", async () => {
    const platformLogin = await post("/platform/auth/login", {
      email: "e02-s02-platform@example.invalid",
      password: "platform isolation passphrase",
    });
    const platformCookie = cookieFrom(platformLogin, "platform_session");
    const tenantCookie = cookieFrom(await login(tenantA.slug, tenantA.password));
    expect(
      (await fetch(`${baseUrl}/auth/me`, { headers: { cookie: platformCookie } })).status,
    ).toBe(401);
    expect(
      (await fetch(`${baseUrl}/platform/auth/me`, { headers: { cookie: tenantCookie } })).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${baseUrl}/auth/me`, {
          headers: { cookie: `${platformCookie}; ${tenantCookie}` },
        })
      ).status,
    ).toBe(200);
    expect((await post("/auth/logout", {}, tenantCookie)).status).toBe(204);
    expect(
      (await fetch(`${baseUrl}/platform/auth/me`, { headers: { cookie: platformCookie } })).status,
    ).toBe(200);
    const freshTenantCookie = cookieFrom(await login(tenantA.slug, tenantA.password));
    expect((await post("/platform/auth/logout", {}, platformCookie)).status).toBe(204);
    expect(
      (await fetch(`${baseUrl}/auth/me`, { headers: { cookie: freshTenantCookie } })).status,
    ).toBe(200);
  });

  it("rejects expired, idle, revoked, disabled-user, and suspended-tenant sessions", async () => {
    const cookie = cookieFrom(await login(tenantA.slug, tenantA.password));
    const raw = cookie.split("=", 2)[1] ?? "";
    const session = await prisma.userSession.findUniqueOrThrow({
      where: { tokenHash: new Uint8Array(hashOpaqueToken(raw)) },
    });
    await prisma.userSession.update({
      data: { expiresAt: new Date(Date.now() - 1) },
      where: { id: session.id },
    });
    expect((await fetch(`${baseUrl}/auth/me`, { headers: { cookie } })).status).toBe(401);

    const idleCookie = cookieFrom(await login(tenantA.slug, tenantA.password));
    await prisma.userSession.updateMany({
      data: { lastSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1_000 - 1) },
      where: { tokenHash: new Uint8Array(hashOpaqueToken(idleCookie.split("=", 2)[1] ?? "")) },
    });
    expect((await fetch(`${baseUrl}/auth/me`, { headers: { cookie: idleCookie } })).status).toBe(
      401,
    );

    const activeCookie = cookieFrom(await login(tenantA.slug, tenantA.password));
    await prisma.user.update({ data: { status: "disabled" }, where: { id: userAId } });
    expect((await fetch(`${baseUrl}/auth/me`, { headers: { cookie: activeCookie } })).status).toBe(
      401,
    );
    expect((await login(tenantA.slug, tenantA.password)).status).toBe(401);
    await prisma.user.update({ data: { status: "active" }, where: { id: userAId } });
    await prisma.tenant.update({ data: { status: "suspended" }, where: { id: tenantAId } });
    expect((await fetch(`${baseUrl}/auth/me`, { headers: { cookie: activeCookie } })).status).toBe(
      401,
    );
    expect((await login(tenantA.slug, tenantA.password)).status).toBe(401);
    await prisma.tenant.update({ data: { status: "active" }, where: { id: tenantAId } });
  });

  it("logs out idempotently and revoke-all affects only the current user", async () => {
    const first = cookieFrom(await login(tenantA.slug, tenantA.password));
    const second = cookieFrom(await login(tenantA.slug, tenantA.password));
    const other = cookieFrom(
      await login(tenantA.slug, "other user secure passphrase", "other-user@example.invalid"),
    );
    const logout = await post("/auth/logout", {}, first);
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await post("/auth/logout", {}, first)).status).toBe(204);
    expect((await fetch(`${baseUrl}/auth/me`, { headers: { cookie: first } })).status).toBe(401);
    expect((await post("/auth/sessions/revoke-all", {}, second)).status).toBe(204);
    expect((await fetch(`${baseUrl}/auth/me`, { headers: { cookie: second } })).status).toBe(401);
    expect((await fetch(`${baseUrl}/auth/me`, { headers: { cookie: other } })).status).toBe(200);
  });

  it("requests password reset generically and exposes raw token only to delivery", async () => {
    const before = deliveries.length;
    const existing = await post(`/auth/tenants/${tenantA.slug}/password-reset/request`, {
      email: sharedEmail,
    });
    const unknown = await post(`/auth/tenants/${tenantA.slug}/password-reset/request`, {
      email: "unknown@example.invalid",
    });
    expect(existing.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(await existing.json()).toEqual(await unknown.json());
    expect(deliveries).toHaveLength(before + 1);
    const url = new URL(deliveries.at(-1)?.resetUrl ?? "invalid:");
    const rawToken = url.searchParams.get("token") ?? "";
    const reset = await prisma.userPasswordResetToken.findUniqueOrThrow({
      where: { tokenHash: new Uint8Array(hashOpaqueToken(rawToken)) },
    });
    expect(Buffer.from(reset.tokenHash).toString()).not.toBe(rawToken);
    expect(reset.expiresAt.getTime() - reset.createdAt.getTime()).toBeGreaterThanOrEqual(
      15 * 60 * 1_000 - 1_000,
    );
    await post(`/auth/tenants/${tenantA.slug}/password-reset/request`, { email: sharedEmail });
    expect(
      (await prisma.userPasswordResetToken.findUniqueOrThrow({ where: { id: reset.id } }))
        .revokedAt,
    ).toBeInstanceOf(Date);
  });

  it("confirms reset once, revokes old sessions, and rejects tenant mismatch/replay", async () => {
    const oldCookie = cookieFrom(await login(tenantB.slug, tenantB.password));
    await post(`/auth/tenants/${tenantB.slug}/password-reset/request`, { email: sharedEmail });
    const rawToken =
      new URL(deliveries.at(-1)?.resetUrl ?? "invalid:").searchParams.get("token") ?? "";
    expect(
      (
        await post(`/auth/tenants/${tenantA.slug}/password-reset/confirm`, {
          token: rawToken,
          newPassword: "new tenant B secure passphrase",
        })
      ).status,
    ).toBe(400);
    const confirm = await post(`/auth/tenants/${tenantB.slug}/password-reset/confirm`, {
      newPassword: "new tenant B secure passphrase",
      token: rawToken,
    });
    expect(confirm.status).toBe(204);
    expect(
      (
        await post(`/auth/tenants/${tenantB.slug}/password-reset/confirm`, {
          token: rawToken,
          newPassword: "another secure passphrase",
        })
      ).status,
    ).toBe(400);
    expect((await login(tenantB.slug, tenantB.password)).status).toBe(401);
    expect((await login(tenantB.slug, "new tenant B secure passphrase")).status).toBe(200);
    expect((await fetch(`${baseUrl}/auth/me`, { headers: { cookie: oldCookie } })).status).toBe(
      401,
    );
    const reset = await prisma.userPasswordResetToken.findUniqueOrThrow({
      where: { tokenHash: new Uint8Array(hashOpaqueToken(rawToken)) },
    });
    expect(reset.consumedAt).toBeInstanceOf(Date);
  });

  it("rejects expired and revoked reset tokens", async () => {
    await post(`/auth/tenants/${tenantA.slug}/password-reset/request`, { email: sharedEmail });
    const expiredToken =
      new URL(deliveries.at(-1)?.resetUrl ?? "invalid:").searchParams.get("token") ?? "";
    await prisma.userPasswordResetToken.update({
      data: { expiresAt: new Date(Date.now() - 1) },
      where: { tokenHash: new Uint8Array(hashOpaqueToken(expiredToken)) },
    });
    expect(
      (
        await post(`/auth/tenants/${tenantA.slug}/password-reset/confirm`, {
          newPassword: "expired token secure passphrase",
          token: expiredToken,
        })
      ).status,
    ).toBe(400);

    await post(`/auth/tenants/${tenantA.slug}/password-reset/request`, { email: sharedEmail });
    const revokedToken =
      new URL(deliveries.at(-1)?.resetUrl ?? "invalid:").searchParams.get("token") ?? "";
    await prisma.userPasswordResetToken.update({
      data: { revokedAt: new Date() },
      where: { tokenHash: new Uint8Array(hashOpaqueToken(revokedToken)) },
    });
    expect(
      (
        await post(`/auth/tenants/${tenantA.slug}/password-reset/confirm`, {
          newPassword: "revoked token secure passphrase",
          token: revokedToken,
        })
      ).status,
    ).toBe(400);
  });

  it("rejects cross-origin mutations and records tenant audit without secrets", async () => {
    const response = await fetch(`${baseUrl}/auth/tenants/${tenantA.slug}/login`, {
      body: JSON.stringify({ email: sharedEmail, password: tenantA.password }),
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      method: "POST",
    });
    expect(response.status).toBe(403);
    expect(
      (
        await post(`/auth/tenants/${tenantA.slug}/login`, {
          email: sharedEmail,
          password: tenantA.password,
          tenantId: tenantBId,
        })
      ).status,
    ).toBe(400);
    const rows = await prisma.auditLog.findMany({
      where: { tenantId: { in: [tenantAId, tenantBId] }, action: { startsWith: "tenant_user." } },
    });
    expect(new Set(rows.map((row) => row.action))).toEqual(
      new Set([
        "tenant_user.login.succeeded",
        "tenant_user.logout",
        "tenant_user.sessions.revoked",
        "tenant_user.password_reset.requested",
        "tenant_user.password_reset.completed",
      ]),
    );
    expect(JSON.stringify(rows)).not.toMatch(/passphrase|reset-password|tenant_session/);
    expect(rows.every((row) => row.tenantId !== null)).toBe(true);
  });
});
