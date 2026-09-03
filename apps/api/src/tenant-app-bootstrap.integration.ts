import {
  generateOpaqueToken,
  hashOpaqueToken,
  PlatformPasswordHasher,
} from "@whatsapp-platform/auth";
import { loadNonSecretConfig } from "@whatsapp-platform/config";
import {
  createPlatformDatabaseClient,
  type PrismaClient,
  syncPermissionCatalog,
} from "@whatsapp-platform/database/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "./app";

const origin = "http://localhost:3005";
const prefix = "e04-s01-bootstrap";
const password = "tenant app shell password";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl = "";
let tenantAId = "";
let tenantBId = "";
let userAId = "";
let tenantCookie = "";

function binary(value: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

async function session(
  tenantId: string,
  userId: string,
  expiresAt = new Date(Date.now() + 3_600_000),
) {
  const token = generateOpaqueToken();
  const row = await prisma.userSession.create({
    data: { expiresAt, tenantId, tokenHash: binary(hashOpaqueToken(token)), userId },
  });
  return { cookie: `tenant_session=${token}`, id: row.id };
}

function bootstrap(cookie = tenantCookie, suffix = ""): Promise<Response> {
  return fetch(`${baseUrl}/app/bootstrap${suffix}`, {
    headers: { cookie, "x-tenant-id": tenantBId, "x-workspace-id": tenantBId },
  });
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
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

describe.sequential("E04-S01 tenant app bootstrap", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
    prisma = createPlatformDatabaseClient({ databaseUrl });
    await cleanup();
    await syncPermissionCatalog(prisma);
    const [tenantA, tenantB] = await Promise.all(
      ["a", "b"].map((marker) =>
        prisma.tenant.create({
          data: {
            defaultCurrency: "MXN",
            defaultLocale: "es-MX",
            defaultTimezone: "America/Mexico_City",
            displayName: `Shell ${marker}`,
            legalName: `Shell ${marker}`,
            slug: `${prefix}-${marker}`,
            status: "active",
          },
        }),
      ),
    );
    if (tenantA === undefined || tenantB === undefined) throw new Error("Tenant fixtures failed");
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    const user = await prisma.user.create({
      data: {
        displayName: "Usuario Shell A",
        email: `${prefix}-a@example.invalid`,
        locale: "es-MX",
        passwordHash: await new PlatformPasswordHasher().hash(password),
        tenantId: tenantAId,
        timezone: "America/Mexico_City",
      },
    });
    userAId = user.id;
    const role = await prisma.role.create({
      data: { key: "shell", name: "Shell", tenantId: tenantAId },
    });
    const permissions = await prisma.permission.findMany({
      where: { key: { in: ["quotes.read", "channels.read"] } },
    });
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ permissionId: permission.id, roleId: role.id })),
    });
    await prisma.userRole.create({
      data: { roleId: role.id, tenantId: tenantAId, userId: userAId },
    });
    await prisma.tenantEntitlement.createMany({
      data: [
        {
          enabled: true,
          entitlementKey: "module.quotes",
          source: "plan",
          tenantId: tenantAId,
        },
        {
          enabled: true,
          entitlementKey: "module.messaging.basic",
          source: "plan",
          tenantId: tenantAId,
        },
        {
          enabled: true,
          endsAt: new Date(Date.now() - 1000),
          entitlementKey: "module.catalog",
          source: "plan",
          tenantId: tenantAId,
        },
        {
          enabled: true,
          entitlementKey: "module.quotes",
          source: "plan",
          tenantId: tenantBId,
        },
      ],
    });
    tenantCookie = (await session(tenantAId, userAId)).cookie;
    app = await createApiApplication(loadNonSecretConfig());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await prisma?.$disconnect();
  });

  it("derives safe identity, effective modules and effective permissions only from the tenant session", async () => {
    const response = await bootstrap(tenantCookie, `?tenantId=${tenantBId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      branding: {
        colorMode: "light",
        logo: null,
        preset: "corporate-blue",
        tokens: { primary: "#294f7c", surface: "#ffffff" },
      },
      effectiveModules: ["module.messaging.basic", "module.quotes"],
      effectivePermissions: ["channels.read", "quotes.read"],
      tenant: { displayName: "Shell a", id: tenantAId, slug: `${prefix}-a` },
      user: { displayName: "Usuario Shell A", id: userAId },
    });
    expect(JSON.stringify(body)).not.toMatch(
      /passwordHash|tokenHash|brandingConfig|settings|audit|deployment/i,
    );
  });

  it("fails closed for missing, platform, revoked, expired, disabled and suspended sessions", async () => {
    expect((await bootstrap("")).status).toBe(401);
    expect((await bootstrap("platform_session=not-a-tenant-session")).status).toBe(401);
    const revoked = await session(tenantAId, userAId);
    await prisma.userSession.update({ data: { revokedAt: new Date() }, where: { id: revoked.id } });
    expect((await bootstrap(revoked.cookie)).status).toBe(401);
    expect(
      (await bootstrap((await session(tenantAId, userAId, new Date(Date.now() - 1))).cookie))
        .status,
    ).toBe(401);
    await prisma.user.update({
      data: { status: "disabled" },
      where: { id: userAId, tenantId: tenantAId },
    });
    expect((await bootstrap()).status).toBe(401);
    await prisma.user.update({
      data: { status: "active" },
      where: { id: userAId, tenantId: tenantAId },
    });
    await prisma.tenant.update({
      data: { status: "suspended", suspendedAt: new Date() },
      where: { id: tenantAId },
    });
    expect((await bootstrap()).status).toBe(401);
    await prisma.tenant.update({
      data: { status: "active", suspendedAt: null },
      where: { id: tenantAId },
    });
    expect((await bootstrap()).status).toBe(200);
  });

  it("refreshes entitlement and permission changes for the same valid session", async () => {
    await prisma.tenantEntitlement.update({
      data: { enabled: false },
      where: { tenantId_entitlementKey: { entitlementKey: "module.quotes", tenantId: tenantAId } },
    });
    expect(
      ((await (await bootstrap()).json()) as { effectiveModules: string[] }).effectiveModules,
    ).not.toContain("module.quotes");
    await prisma.rolePermission.deleteMany({
      where: { role: { tenantId: tenantAId }, permission: { key: "quotes.read" } },
    });
    expect(
      ((await (await bootstrap()).json()) as { effectivePermissions: string[] })
        .effectivePermissions,
    ).not.toContain("quotes.read");
  });

  it("revokes the real session through logout and rejects a later bootstrap", async () => {
    const activeCookie = (await session(tenantAId, userAId)).cookie;
    const response = await fetch(`${baseUrl}/auth/logout`, {
      headers: { cookie: activeCookie, origin },
      method: "POST",
    });
    expect(response.status).toBe(204);
    expect((await bootstrap(activeCookie)).status).toBe(401);
  });

  it("resolves the tenant theme from brandingConfig without leaking raw configuration", async () => {
    await prisma.tenant.update({
      data: {
        brandingConfig: {
          version: 1,
          preset: "premium-minimal",
          colorMode: "dark",
          logo: { kind: "url", url: "https://cdn.example.com/logo.png" },
        },
      },
      where: { id: tenantAId },
    });
    const response = await bootstrap();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.branding).toMatchObject({
      colorMode: "dark",
      preset: "premium-minimal",
      tokens: { primary: "#e8e4da", surface: "#1a1a1a" },
    });
    await prisma.tenant.update({ data: { brandingConfig: {} }, where: { id: tenantAId } });
    expect((await bootstrap()).status).toBe(200);
  });

  it("hides the stored logo in bootstrap while module.white_label is not effective", async () => {
    await prisma.tenant.update({
      data: {
        brandingConfig: {
          version: 1,
          preset: "corporate-blue",
          colorMode: "light",
          logo: { kind: "url", url: "https://cdn.example.com/logo.png" },
        },
      },
      where: { id: tenantAId },
    });
    const response = await bootstrap();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.branding).toMatchObject({
      colorMode: "light",
      logo: null,
      preset: "corporate-blue",
    });
    expect(JSON.stringify(body)).not.toMatch(/https:\/\/cdn\.example\.com\/logo\.png/);
    await prisma.tenant.update({ data: { brandingConfig: {} }, where: { id: tenantAId } });
    expect((await bootstrap()).status).toBe(200);
  });
});
