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

const prefix = "e04-s02-theme-api";
const password = "tenant theme api password";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl = "";
let tenantAId = "";
let tenantBId = "";
let userAId = "";
let userBId = "";
let userCId = "";
let tenantACookie = "";
let tenantBCookie = "";
let userCCookie = "";

function binary(value: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

async function session(tenantId: string, userId: string) {
  const token = generateOpaqueToken();
  const row = await prisma.userSession.create({
    data: {
      expiresAt: new Date(Date.now() + 3_600_000),
      tenantId,
      tokenHash: binary(hashOpaqueToken(token)),
      userId,
    },
  });
  return { cookie: `tenant_session=${token}`, id: row.id };
}

async function createUser(tenantId: string, marker: string, roleId: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      displayName: `Usuario ${marker}`,
      email: `${prefix}-${marker}@example.invalid`,
      locale: "es-MX",
      passwordHash: await new PlatformPasswordHasher().hash(password),
      tenantId,
      timezone: "America/Mexico_City",
    },
  });
  if (roleId !== "") {
    await prisma.userRole.create({ data: { roleId, tenantId, userId: user.id } });
  }
  return user.id;
}

async function roleWithSettings(tenantId: string): Promise<string> {
  const role = await prisma.role.create({
    data: { key: "settings", name: "Settings", tenantId },
  });
  const permission = await prisma.permission.findUnique({
    where: { key: "tenant.settings.manage" },
  });
  if (permission !== null) {
    await prisma.rolePermission.create({
      data: { permissionId: permission.id, roleId: role.id },
    });
  }
  return role.id;
}

function get(cookie = tenantACookie): Promise<Response> {
  return fetch(`${baseUrl}/app/theme`, {
    headers: { cookie, "x-tenant-id": tenantBId, "x-workspace-id": tenantBId },
  });
}

function patch(cookie: string, body: unknown, requestId = `${prefix}-patch`): Promise<Response> {
  return fetch(`${baseUrl}/app/theme`, {
    body: JSON.stringify(body),
    headers: { cookie, "content-type": "application/json", "x-request-id": requestId },
    method: "PATCH",
  });
}

function bootstrap(cookie = tenantACookie): Promise<Response> {
  return fetch(`${baseUrl}/app/bootstrap`, {
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

describe.sequential("E04-S02 tenant theme API", () => {
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
            displayName: `Theme API ${marker}`,
            legalName: `Theme API ${marker}`,
            slug: `${prefix}-${marker}`,
            status: "active",
          },
        }),
      ),
    );
    if (tenantA === undefined || tenantB === undefined) throw new Error("Tenant fixtures failed");
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    const roleA = await roleWithSettings(tenantAId);
    const roleB = await roleWithSettings(tenantBId);
    userAId = await createUser(tenantAId, "a", roleA);
    userBId = await createUser(tenantBId, "b", roleB);
    userCId = await createUser(tenantAId, "c", "");
    await prisma.tenantEntitlement.create({
      data: {
        enabled: true,
        entitlementKey: "module.white_label",
        source: "plan",
        tenantId: tenantAId,
      },
    });
    tenantACookie = (await session(tenantAId, userAId)).cookie;
    tenantBCookie = (await session(tenantBId, userBId)).cookie;
    userCCookie = (await session(tenantAId, userCId)).cookie;
    app = await createApiApplication(loadNonSecretConfig());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await prisma?.$disconnect();
  });

  it("fails closed for missing, platform, revoked and suspended sessions", async () => {
    expect((await get("")).status).toBe(401);
    expect((await get("platform_session=not-a-tenant-session")).status).toBe(401);
    const revoked = await session(tenantAId, userAId);
    await prisma.userSession.update({ data: { revokedAt: new Date() }, where: { id: revoked.id } });
    expect((await get(revoked.cookie)).status).toBe(401);
    await prisma.tenant.update({
      data: { status: "suspended", suspendedAt: new Date() },
      where: { id: tenantAId },
    });
    expect((await patch(tenantACookie, {})).status).toBe(401);
    await prisma.tenant.update({
      data: { status: "active", suspendedAt: null },
      where: { id: tenantAId },
    });
    expect((await get()).status).toBe(200);
  });

  it("requires the settings permission for reads and writes", async () => {
    expect((await get(userCCookie)).status).toBe(403);
    expect(
      (await patch(userCCookie, { version: 1, preset: "corporate-blue", colorMode: "light" }))
        .status,
    ).toBe(403);
  });

  it("returns the default theme for an empty configuration", async () => {
    const response = await get(tenantBCookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.config).toEqual({
      version: 1,
      preset: "corporate-blue",
      colorMode: "light",
      logo: null,
    });
    expect(body.branding).toMatchObject({
      colorMode: "light",
      logo: null,
      preset: "corporate-blue",
      tokens: { primary: "#294f7c", surface: "#ffffff" },
    });
  });

  it("rejects malformed theme configurations", async () => {
    const invalid: unknown[] = [
      { version: 2, preset: "corporate-blue", colorMode: "light" },
      { version: 1, preset: "hacked", colorMode: "light" },
      { version: 1, preset: "corporate-blue", colorMode: "light", extra: "x" },
      { version: 1, preset: "custom", colorMode: "light" },
      {
        version: 1,
        preset: "custom",
        colorMode: "light",
        colors: { primary: "red", secondary: "#294f7c", accent: "#294f7c" },
      },
      {
        version: 1,
        preset: "custom",
        colorMode: "light",
        colors: { primary: "#f0f0f0", secondary: "#294f7c", accent: "#294f7c" },
      },
      {
        version: 1,
        preset: "custom",
        colorMode: "light",
        colors: { primary: "url(javascript:alert(1))", secondary: "#294f7c", accent: "#294f7c" },
      },
      {
        version: 1,
        preset: "corporate-blue",
        colorMode: "light",
        logo: { kind: "url", url: "http://cdn.example.com/logo.png" },
      },
      {
        version: 1,
        preset: "corporate-blue",
        colorMode: "light",
        logo: { kind: "url", url: "https://localhost/logo.png" },
      },
      { version: 1, preset: "corporate-blue", colorMode: "light", logo: { kind: "url", url: "x" } },
    ];
    for (const body of invalid) {
      const response = await patch(tenantACookie, body, `${prefix}-invalid`);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("persists a preset theme and reflects it in GET and bootstrap", async () => {
    const response = await patch(
      tenantACookie,
      { version: 1, preset: "premium-minimal", colorMode: "dark" },
      `${prefix}-preset`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.config).toEqual({ version: 1, preset: "premium-minimal", colorMode: "dark" });
    expect(body.branding).toMatchObject({
      colorMode: "dark",
      logo: null,
      preset: "premium-minimal",
      tokens: { primary: "#e8e4da" },
    });
    expect(((await (await get()).json()) as Record<string, unknown>).config).toMatchObject({
      preset: "premium-minimal",
    });
    const bootstrapBody = (await (await bootstrap()).json()) as Record<string, unknown>;
    expect(bootstrapBody.branding).toMatchObject({
      colorMode: "dark",
      preset: "premium-minimal",
      tokens: { primary: "#e8e4da" },
    });
  });

  it("allows custom colors and a logo only with the white label module", async () => {
    const denied = await patch(
      tenantBCookie,
      {
        version: 1,
        preset: "custom",
        colorMode: "light",
        colors: { primary: "#0b5394", secondary: "#1e8449", accent: "#7b3fa0" },
        logo: { kind: "url", url: "https://cdn.example.com/logo.png" },
      },
      `${prefix}-logo-denied`,
    );
    expect(denied.status).toBe(403);
    const deniedBody = (await denied.json()) as { message?: unknown };
    expect(JSON.stringify(deniedBody)).toMatch(/white_label/i);

    const colorsOnly = await patch(
      tenantBCookie,
      {
        version: 1,
        preset: "custom",
        colorMode: "light",
        colors: { primary: "#0b5394", secondary: "#1e8449", accent: "#7b3fa0" },
      },
      `${prefix}-colors-only`,
    );
    expect(colorsOnly.status).toBe(200);

    const allowed = await patch(
      tenantACookie,
      {
        version: 1,
        preset: "custom",
        colorMode: "light",
        colors: { primary: "#0b5394", secondary: "#1e8449", accent: "#7b3fa0" },
        logo: { kind: "url", url: "https://cdn.example.com/logo.png" },
      },
      `${prefix}-logo-allowed`,
    );
    expect(allowed.status).toBe(200);
    const body = (await allowed.json()) as Record<string, unknown>;
    expect(body.config).toMatchObject({
      preset: "custom",
      logo: { kind: "url", url: "https://cdn.example.com/logo.png" },
    });
    expect((body.branding as Record<string, unknown>).logo).toEqual({
      kind: "url",
      url: "https://cdn.example.com/logo.png",
    });
  });

  it("resets to the default theme with an empty patch", async () => {
    const response = await patch(tenantACookie, {}, `${prefix}-reset`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.config).toEqual({
      version: 1,
      preset: "corporate-blue",
      colorMode: "light",
      logo: null,
    });
  });

  it("writes audit and outbox events with the request id and never leaks the logo URL", async () => {
    await patch(
      tenantACookie,
      {
        version: 1,
        preset: "custom",
        colorMode: "dark",
        colors: { primary: "#0b5394", secondary: "#1e8449", accent: "#7b3fa0" },
        logo: { kind: "url", url: "https://cdn.example.com/logo.png" },
      },
      `${prefix}-audit`,
    );
    const audit = await prisma.auditLog.findFirst({
      orderBy: { occurredAt: "desc" },
      where: { tenantId: tenantAId, action: "tenant.theme.updated" },
    });
    expect(audit).toMatchObject({
      actorId: userAId,
      actorType: "tenant_user",
      entityId: tenantAId,
      entityType: "Tenant",
      requestId: `${prefix}-audit`,
    });
    expect(JSON.stringify(audit?.afterSummary)).not.toMatch(/cdn\.example|logo\.png/i);
    const outbox = await prisma.domainEventOutbox.findFirst({
      orderBy: { occurredAt: "desc" },
      where: { tenantId: tenantAId, eventType: "tenant.theme.updated" },
    });
    expect(outbox?.payload).toMatchObject({ preset: "custom", colorMode: "dark" });
    expect(JSON.stringify(outbox?.payload ?? {})).not.toMatch(/cdn\.example|logo\.png/i);
  });

  it("only mutates the session tenant even with hostile tenant headers", async () => {
    await patch(
      tenantACookie,
      { version: 1, preset: "modern-dark", colorMode: "light" },
      `${prefix}-hostile`,
    );
    const a = (await (await get(tenantACookie)).json()) as Record<string, unknown>;
    expect(a.config).toMatchObject({ preset: "modern-dark" });
    const b = (await (await get(tenantBCookie)).json()) as Record<string, unknown>;
    expect(b.config).toMatchObject({ preset: "custom", colorMode: "light" });
    await patch(tenantACookie, {}, `${prefix}-hostile-cleanup`);
  });

  it("hides the stored logo in bootstrap while white label is not effective and restores it on re-enable", async () => {
    const logoUrl = "https://cdn.example.com/logo.png";
    const configured = {
      version: 1,
      preset: "custom",
      colorMode: "light",
      colors: { primary: "#0b5394", secondary: "#1e8449", accent: "#7b3fa0" },
      logo: { kind: "url", url: logoUrl },
    };
    expect((await patch(tenantACookie, configured, `${prefix}-wl-cycle`)).status).toBe(200);

    const enabled = (await (await bootstrap()).json()) as {
      branding: { logo: unknown };
      effectiveModules: string[];
    };
    expect(enabled.effectiveModules).toContain("module.white_label");
    expect(enabled.branding.logo).toEqual({ kind: "url", url: logoUrl });

    await prisma.tenantEntitlement.update({
      data: { enabled: false },
      where: {
        tenantId_entitlementKey: { entitlementKey: "module.white_label", tenantId: tenantAId },
      },
    });

    const disabled = (await (await bootstrap()).json()) as {
      branding: { logo: unknown };
      effectiveModules: string[];
    };
    expect(disabled.effectiveModules).not.toContain("module.white_label");
    expect(disabled.branding.logo).toBeNull();

    const stored = (await (await get(tenantACookie)).json()) as { config: { logo?: unknown } };
    expect(stored.config.logo).toEqual({ kind: "url", url: logoUrl });

    await prisma.tenantEntitlement.update({
      data: { enabled: true },
      where: {
        tenantId_entitlementKey: { entitlementKey: "module.white_label", tenantId: tenantAId },
      },
    });

    const reEnabled = (await (await bootstrap()).json()) as { branding: { logo: unknown } };
    expect(reEnabled.branding.logo).toEqual({ kind: "url", url: logoUrl });

    await patch(tenantACookie, {}, `${prefix}-wl-cycle-cleanup`);
  });

  it("keeps the logo hidden for scheduled or expired white label entitlements", async () => {
    const logoUrl = "https://cdn.example.com/logo.png";
    const configured = {
      version: 1,
      preset: "corporate-blue",
      colorMode: "light",
      logo: { kind: "url", url: logoUrl },
    };
    expect((await patch(tenantACookie, configured, `${prefix}-wl-temporal`)).status).toBe(200);

    await prisma.tenantEntitlement.update({
      data: { enabled: true, endsAt: null, startsAt: new Date(Date.now() + 3_600_000) },
      where: {
        tenantId_entitlementKey: { entitlementKey: "module.white_label", tenantId: tenantAId },
      },
    });
    const scheduled = (await (await bootstrap()).json()) as {
      branding: { logo: unknown };
      effectiveModules: string[];
    };
    expect(scheduled.effectiveModules).not.toContain("module.white_label");
    expect(scheduled.branding.logo).toBeNull();

    await prisma.tenantEntitlement.update({
      data: { enabled: true, endsAt: new Date(Date.now() - 1000), startsAt: null },
      where: {
        tenantId_entitlementKey: { entitlementKey: "module.white_label", tenantId: tenantAId },
      },
    });
    const expired = (await (await bootstrap()).json()) as {
      branding: { logo: unknown };
      effectiveModules: string[];
    };
    expect(expired.effectiveModules).not.toContain("module.white_label");
    expect(expired.branding.logo).toBeNull();

    await prisma.tenantEntitlement.update({
      data: { enabled: true, endsAt: null, startsAt: null },
      where: {
        tenantId_entitlementKey: { entitlementKey: "module.white_label", tenantId: tenantAId },
      },
    });
    await patch(tenantACookie, {}, `${prefix}-wl-temporal-cleanup`);
  });
});
