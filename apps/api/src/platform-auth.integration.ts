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
import { bootstrapPlatformAdmin } from "./platform-admin-create";

const email = "e02-s01-admin@example.invalid";
const password = "correct horse battery staple";
const origin = "http://localhost:3000";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl: string;
let validCookie: string;

async function login(loginEmail = email, loginPassword = password, requestOrigin = origin) {
  return fetch(`${baseUrl}/platform/auth/login`, {
    body: JSON.stringify({
      deviceLabel: "integration",
      email: loginEmail,
      password: loginPassword,
    }),
    headers: { "content-type": "application/json", origin: requestOrigin },
    method: "POST",
  });
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null) throw new Error("Expected session cookie");
  return setCookie.split(";", 1)[0] ?? "";
}

describe.sequential("Platform Admin authentication integration", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
    prisma = createPlatformDatabaseClient({ databaseUrl });
    await prisma.platformAdminSession.deleteMany({ where: { platformAdmin: { email } } });
    await prisma.platformAdmin.deleteMany({ where: { email } });
    await createPlatformAuthRepository(prisma).bootstrapAdmin({
      displayName: "E02 S01 Admin",
      email,
      locale: "es-MX",
      passwordHash: await new PlatformPasswordHasher().hash(password),
      requestId: randomUUID(),
      timezone: "America/Mexico_City",
    });
    app = await createApiApplication(
      loadNonSecretConfig({ NODE_ENV: "test", PLATFORM_WEB_ORIGIN: origin }),
    );
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (prisma !== undefined) {
      await prisma.platformAdminSession.deleteMany({ where: { platformAdmin: { email } } });
      await prisma.platformAdmin.deleteMany({ where: { email } });
      await prisma.$disconnect();
    }
  });

  it("rejects invalid origin and non-JSON login requests", async () => {
    expect((await login(email, password, "https://evil.example")).status).toBe(403);
    const response = await fetch(`${baseUrl}/platform/auth/login`, {
      body: "email=nope",
      headers: { "content-type": "text/plain", origin },
      method: "POST",
    });
    expect(response.status).toBe(415);
  });

  it("uses UUIDv7, BYTEA token hashes, and timestamptz session fields", async () => {
    const [physical] = await prisma.$queryRaw<
      Array<{ id_type: string; token_type: string; expires_type: string }>
    >`
      SELECT
        (SELECT data_type FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'platform_admin' AND column_name = 'id') AS id_type,
        (SELECT data_type FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'platform_admin_session' AND column_name = 'token_hash') AS token_type,
        (SELECT data_type FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'platform_admin_session' AND column_name = 'expires_at') AS expires_type
    `;
    expect(physical).toEqual({
      expires_type: "timestamp with time zone",
      id_type: "uuid",
      token_type: "bytea",
    });
    const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { email } });
    const [version] = await prisma.$queryRaw<Array<{ version: number }>>`
      SELECT uuid_extract_version(${admin.id}::uuid) AS version
    `;
    expect(version?.version).toBe(7);
    expect(admin.passwordHash).toMatch(/^\$argon2id\$/);
    expect(admin.status).toBe("active");
    expect(admin.mfaState).toBe("disabled");
  });

  it("rejects a duplicate normalized bootstrap identity and never bootstraps at API start", async () => {
    await expect(
      bootstrapPlatformAdmin({
        PLATFORM_ADMIN_BOOTSTRAP_DISPLAY_NAME: "Duplicate",
        PLATFORM_ADMIN_BOOTSTRAP_EMAIL: " E02-S01-ADMIN@EXAMPLE.INVALID ",
        PLATFORM_ADMIN_BOOTSTRAP_PASSWORD: "duplicate bootstrap password",
      }),
    ).rejects.toBeDefined();
    await expect(prisma.platformAdmin.count({ where: { email } })).resolves.toBe(1);
  });

  it("uses the same generic response for unknown email and wrong password", async () => {
    const unknown = await login("unknown@example.invalid", password);
    const wrong = await login(email, "wrong password value");
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    const unknownBody = (await unknown.json()) as { message: string };
    const wrongBody = (await wrong.json()) as { message: string };
    expect(unknownBody.message).toBe(wrongBody.message);
  });

  it("creates independent opaque sessions and exposes only the safe profile", async () => {
    const first = await login();
    const second = await login();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstCookie = cookieFrom(first);
    const secondCookie = cookieFrom(second);
    validCookie = firstCookie;
    expect(firstCookie).not.toBe(secondCookie);
    expect(JSON.stringify(await first.json())).not.toContain("passwordHash");

    const me = await fetch(`${baseUrl}/platform/auth/me`, { headers: { cookie: firstCookie } });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { admin: { email: string } };
    expect(meBody.admin.email).toBe(email);

    const sessions = await prisma.platformAdminSession.findMany({
      where: { platformAdmin: { email } },
    });
    expect(sessions).toHaveLength(2);
    for (const session of sessions) {
      expect(firstCookie).not.toContain(Buffer.from(session.tokenHash).toString("base64url"));
      expect(session.tokenHash).toHaveLength(32);
    }
    const rawToken = firstCookie.split("=", 2)[1];
    if (rawToken === undefined) throw new Error("Missing raw cookie token");
    expect(
      sessions.some((session) =>
        Buffer.from(session.tokenHash).equals(hashPlatformSessionToken(rawToken)),
      ),
    ).toBe(true);
    const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { email } });
    expect(admin.lastLoginAt).toBeInstanceOf(Date);

    expect((await fetch(`${baseUrl}/platform/auth/me`)).status).toBe(401);
    expect(
      (
        await fetch(`${baseUrl}/platform/auth/me`, {
          headers: { cookie: "platform_session=random-invalid-token" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${baseUrl}/platform/auth/me`, {
          headers: { cookie: `platform_session=${sessions[0]?.id}` },
        })
      ).status,
    ).toBe(401);
  });

  it("rejects disabled admins, expired sessions, and revoked sessions", async () => {
    const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { email } });
    await prisma.platformAdmin.update({ data: { status: "disabled" }, where: { id: admin.id } });
    expect((await login()).status).toBe(401);
    expect(
      (await fetch(`${baseUrl}/platform/auth/me`, { headers: { cookie: validCookie } })).status,
    ).toBe(401);
    await prisma.platformAdmin.update({ data: { status: "active" }, where: { id: admin.id } });

    const expiredLogin = await login();
    const expiredCookie = cookieFrom(expiredLogin);
    const newest = await prisma.platformAdminSession.findFirstOrThrow({
      orderBy: { createdAt: "desc" },
      where: { platformAdminId: admin.id },
    });
    await prisma.platformAdminSession.update({
      data: { expiresAt: new Date(Date.now() - 1_000) },
      where: { id: newest.id },
    });
    expect(
      (await fetch(`${baseUrl}/platform/auth/me`, { headers: { cookie: expiredCookie } })).status,
    ).toBe(401);

    const idleLogin = await login();
    const idleCookie = cookieFrom(idleLogin);
    const idleSession = await prisma.platformAdminSession.findFirstOrThrow({
      orderBy: { createdAt: "desc" },
      where: { platformAdminId: admin.id },
    });
    await prisma.platformAdminSession.update({
      data: { lastSeenAt: new Date(Date.now() - 31 * 60 * 1_000) },
      where: { id: idleSession.id },
    });
    expect(
      (await fetch(`${baseUrl}/platform/auth/me`, { headers: { cookie: idleCookie } })).status,
    ).toBe(401);

    const activeLogin = await login();
    const activeCookie = cookieFrom(activeLogin);
    const logout = await fetch(`${baseUrl}/platform/auth/logout`, {
      headers: { cookie: activeCookie, origin },
      method: "POST",
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(
      (await fetch(`${baseUrl}/platform/auth/me`, { headers: { cookie: activeCookie } })).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${baseUrl}/platform/auth/logout`, {
          headers: { cookie: activeCookie, origin },
          method: "POST",
        })
      ).status,
    ).toBe(204);
  });

  it("writes platform login/logout audit rows with tenant_id null", async () => {
    const rows = await prisma.auditLog.findMany({
      where: { action: { in: ["platform_admin.login.succeeded", "platform_admin.logout"] } },
    });
    expect(rows.some((row) => row.action === "platform_admin.login.succeeded")).toBe(true);
    expect(rows.some((row) => row.action === "platform_admin.logout")).toBe(true);
    expect(rows.every((row) => row.tenantId === null)).toBe(true);
  });
});
