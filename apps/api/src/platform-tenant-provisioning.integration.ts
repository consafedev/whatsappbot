import { randomUUID } from "node:crypto";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  hashPlatformSessionToken,
  PlatformPasswordHasher,
  tenantCookieConfig,
} from "@whatsapp-platform/auth";
import { loadNonSecretConfig } from "@whatsapp-platform/config";
import {
  createTenantContext,
  createTenantDataAccess,
  type TenantContext,
} from "@whatsapp-platform/database";
import {
  createPlatformAuthRepository,
  createPlatformDatabaseClient,
  createTenantAuthRepository,
  type PrismaClient,
  syncPermissionCatalog,
} from "@whatsapp-platform/database/platform";
import { PERMISSION_CATALOG } from "@whatsapp-platform/rbac";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "./app";
import { TENANT_AUTH_OPTIONS, TENANT_AUTH_REPOSITORY, TenantUserSessionGuard } from "./tenant-auth";
import {
  CurrentTenantContext,
  TENANT_DATA_ACCESS_DATABASE,
  TenantContextGuard,
  TenantDataAccessFactory,
} from "./tenant-context";
import { TenantAuthorized, TenantPermissionGuard } from "./tenant-rbac";

const origin = "http://localhost:3005";
const prefix = "e03-s02-api";
const adminEmail = `${prefix}-admin@example.invalid`;
const adminPassword = "platform provisioning secure password";
const ownerPassword = "owner bootstrap secure password";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let rbacApp: Awaited<ReturnType<typeof NestFactory.create>>;
let baseUrl: string;
let rbacBaseUrl: string;
let adminId: string;
let platformCookie: string;
let tenantCookie: string;
let tenantId: string;
let ownerId: string;

@Controller("provisioning-rbac-probe")
class ProvisioningRbacProbeController {
  @Get()
  @TenantAuthorized("tenant.settings.manage")
  read(@CurrentTenantContext() context: TenantContext) {
    return { tenantId: context.tenantId };
  }
}

@Module({
  controllers: [ProvisioningRbacProbeController],
  providers: [
    TenantUserSessionGuard,
    TenantContextGuard,
    TenantPermissionGuard,
    TenantDataAccessFactory,
    { provide: TENANT_AUTH_REPOSITORY, useFactory: () => createTenantAuthRepository(prisma) },
    {
      provide: TENANT_AUTH_OPTIONS,
      useValue: { cookie: tenantCookieConfig("test"), webOrigin: origin },
    },
    { provide: TENANT_DATA_ACCESS_DATABASE, useFactory: () => prisma },
  ],
})
class ProvisioningRbacTestModule {}

function cookieFrom(response: Response, name: string): string {
  const value = response.headers.get("set-cookie");
  if (value === null || !value.startsWith(`${name}=`)) throw new Error(`Expected ${name}`);
  return value.split(";", 1)[0] ?? "";
}

async function platformLogin(email = adminEmail, password = adminPassword): Promise<string> {
  const response = await fetch(`${baseUrl}/platform/auth/login`, {
    body: JSON.stringify({ email, password }),
    headers: { "content-type": "application/json", origin },
    method: "POST",
  });
  expect(response.status).toBe(200);
  return cookieFrom(response, "platform_session");
}

function createBody(slug = `${prefix}-created`) {
  return {
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: "Provisioned Tenant",
    enabledModules: ["module.messaging.basic", "module.automation.basic"],
    legalName: "Provisioned Tenant SA",
    limits: {
      channelAccounts: 1,
      monthlyAiBudget: 0,
      organizationUnits: 1,
      storageBytes: 0,
      users: 1,
    },
    owner: {
      displayName: "Provisioned Owner",
      email: `${prefix}-owner@example.invalid`,
      password: ownerPassword,
    },
    slug,
  };
}

async function post(body: unknown, cookie = platformCookie): Promise<Response> {
  return fetch(`${baseUrl}/platform/tenants`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie },
    method: "POST",
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
  await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  await prisma.platformAdminSession.deleteMany({ where: { platformAdmin: { email: adminEmail } } });
  await prisma.auditLog.deleteMany({ where: { actorId: adminId || "not-created" } });
  await prisma.platformAdmin.deleteMany({ where: { email: adminEmail } });
}

describe.sequential("Platform tenant provisioning API", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
    prisma = createPlatformDatabaseClient({ databaseUrl });
    await cleanup();
    await syncPermissionCatalog(prisma);
    const admin = await createPlatformAuthRepository(prisma).bootstrapAdmin({
      displayName: "Provisioning Admin",
      email: adminEmail,
      locale: "es-MX",
      passwordHash: await new PlatformPasswordHasher().hash(adminPassword),
      requestId: randomUUID(),
      timezone: "America/Mexico_City",
    });
    adminId = admin.id;
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
    rbacApp = await NestFactory.create(ProvisioningRbacTestModule, { logger: false });
    await rbacApp.listen(0, "127.0.0.1");
    rbacBaseUrl = await rbacApp.getUrl();
  });

  afterAll(async () => {
    if (rbacApp !== undefined) await rbacApp.close();
    if (app !== undefined) await app.close();
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("rejects missing Platform auth before provisioning", async () => {
    expect((await post(createBody(), "")).status).toBe(401);
    expect(await prisma.tenant.count({ where: { slug: `${prefix}-created` } })).toBe(0);
  });

  it("creates an active tenant with a minimal safe 201 response", async () => {
    const response = await post(createBody());
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown> & {
      tenant: { id: string };
      owner: { id: string };
    };
    tenantId = body.tenant.id;
    ownerId = body.owner.id;
    expect(body).toMatchObject({
      enabledModules: ["module.messaging.basic", "module.automation.basic"],
      limits: { users: 1 },
      owner: { displayName: "Provisioned Owner", email: `${prefix}-owner@example.invalid` },
      tenant: { displayName: "Provisioned Tenant", status: "active" },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(ownerPassword);
    expect(serialized).not.toContain("passwordHash");
    const databaseSerialized = JSON.stringify(
      await Promise.all([
        prisma.auditLog.findMany({ where: { tenantId } }),
        prisma.domainEventOutbox.findMany({ where: { tenantId } }),
      ]),
    );
    expect(databaseSerialized).not.toContain(ownerPassword);
    expect(databaseSerialized).not.toContain("passwordHash");
    const storedOwner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    expect(storedOwner.passwordHash).not.toBe(ownerPassword);
    await expect(
      new PlatformPasswordHasher().verify(storedOwner.passwordHash, ownerPassword),
    ).resolves.toBe(true);
  });

  it("allows immediate Owner login, tenant context, and all 31 RBAC grants", async () => {
    const login = await fetch(`${baseUrl}/auth/tenants/${prefix}-created/login`, {
      body: JSON.stringify({ email: `${prefix}-owner@example.invalid`, password: ownerPassword }),
      headers: { "content-type": "application/json", origin },
      method: "POST",
    });
    expect(login.status).toBe(200);
    tenantCookie = cookieFrom(login, "tenant_session");
    const me = await fetch(`${baseUrl}/auth/me`, { headers: { cookie: tenantCookie } });
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({
      tenant: { id: tenantId },
      user: { id: ownerId },
    });
    const permissions = await createTenantDataAccess(
      createTenantContext(tenantId),
      prisma,
    ).permissions.resolveForUser(ownerId);
    expect([...permissions].sort()).toEqual(PERMISSION_CATALOG.map(({ key }) => key).sort());
    const protectedResponse = await fetch(`${rbacBaseUrl}/provisioning-rbac-probe`, {
      headers: { cookie: tenantCookie },
    });
    expect(protectedResponse.status).toBe(200);
    await expect(protectedResponse.json()).resolves.toEqual({ tenantId });
    const platformAttempt = await fetch(`${baseUrl}/platform/auth/login`, {
      body: JSON.stringify({ email: `${prefix}-owner@example.invalid`, password: ownerPassword }),
      headers: { "content-type": "application/json", origin },
      method: "POST",
    });
    expect(platformAttempt.status).toBe(401);
  });

  it("rejects Tenant User auth, revoked sessions, and disabled Platform Admin", async () => {
    expect((await post(createBody(`${prefix}-tenant-cookie`), tenantCookie)).status).toBe(401);
    const revokedCookie = await platformLogin();
    const raw = revokedCookie.split("=", 2)[1];
    if (raw === undefined) throw new Error("Missing platform token");
    await prisma.platformAdminSession.update({
      data: { revokedAt: new Date() },
      where: { tokenHash: new Uint8Array(hashPlatformSessionToken(raw)) },
    });
    expect((await post(createBody(`${prefix}-revoked`), revokedCookie)).status).toBe(401);
    await prisma.platformAdmin.update({ data: { status: "disabled" }, where: { id: adminId } });
    expect((await post(createBody(`${prefix}-disabled`))).status).toBe(401);
    await prisma.platformAdmin.update({ data: { status: "active" }, where: { id: adminId } });
  });

  it("returns safe conflict, validation, module, limit, and deployment errors without partial tenants", async () => {
    expect((await post(createBody())).status).toBe(409);
    expect(
      (
        await post({
          ...createBody(`${prefix}-unknown`),
          enabledModules: ["module.fake_superpowers"],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post({
          ...createBody(`${prefix}-zero-users`),
          limits: { ...createBody().limits, users: 0 },
        })
      ).status,
    ).toBe(400);
    expect(
      (await post({ ...createBody(`${prefix}-unknown-field`), tenantId: randomUUID() })).status,
    ).toBe(400);
    expect(
      (await post({ ...createBody(`${prefix}-deployment`), deploymentId: randomUUID() })).status,
    ).toBe(422);
    expect(
      await prisma.tenant.count({
        where: {
          slug: {
            in: [
              `${prefix}-unknown`,
              `${prefix}-zero-users`,
              `${prefix}-unknown-field`,
              `${prefix}-deployment`,
            ],
          },
        },
      }),
    ).toBe(0);
  });

  it("keeps the E03-S01 list accurate after provisioning and Owner activity", async () => {
    const response = await fetch(`${baseUrl}/platform/tenants?search=${prefix}-created`, {
      headers: { cookie: platformCookie },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [
        {
          channelCount: null,
          deployment: null,
          enabledModules: ["module.automation.basic", "module.messaging.basic"],
          lastActivityAt: expect.any(String),
          status: "active",
          userCount: 1,
        },
      ],
      total: 1,
    });
  });
});
