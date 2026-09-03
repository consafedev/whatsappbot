import { Body, Controller, Get, Module, Param, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { generateOpaqueToken, hashOpaqueToken, tenantCookieConfig } from "@whatsapp-platform/auth";
import {
  createTenantContext,
  createTenantDataAccess,
  type TenantContext,
} from "@whatsapp-platform/database";
import {
  createPlatformDatabaseClient,
  createTenantAuthRepository,
  type PrismaClient,
  syncPermissionCatalog,
} from "@whatsapp-platform/database/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TENANT_AUTH_OPTIONS, TENANT_AUTH_REPOSITORY, TenantUserSessionGuard } from "./tenant-auth";
import {
  CurrentTenantContext,
  TENANT_DATA_ACCESS_DATABASE,
  TenantContextGuard,
  TenantDataAccessFactory,
} from "./tenant-context";
import { TenantAuthorized, TenantPermissionGuard } from "./tenant-rbac";

const slugs = { a: "e02-s05-guard-a", b: "e02-s05-guard-b" } as const;
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof NestFactory.create>>;
let baseUrl: string;
let tenantAId: string;
let tenantBId: string;
let userAId: string;
let userBId: string;
let unitAId: string;
let cookieA: string;
let cookieB: string;
let ownerAId: string;
let viewerAId: string;
let roleBId: string;

@Controller("rbac-probe")
class TenantRbacProbeController {
  @Get("audit/:tenantId")
  @TenantAuthorized("audit.read")
  audit(@Param("tenantId") routeTenantId: string, @CurrentTenantContext() context: TenantContext) {
    return { contextTenantId: context.tenantId, routeTenantId };
  }

  @Post("audit/:tenantId")
  @TenantAuthorized("audit.read")
  auditOverride(
    @Body() body: { tenantId?: unknown },
    @Param("tenantId") routeTenantId: string,
    @CurrentTenantContext() context: TenantContext,
  ) {
    return { bodyTenantId: body.tenantId, contextTenantId: context.tenantId, routeTenantId };
  }

  @Get("channels/:tenantId")
  @TenantAuthorized("channels.read", "channels.manage")
  channels(
    @Param("tenantId") routeTenantId: string,
    @CurrentTenantContext() context: TenantContext,
  ) {
    return { contextTenantId: context.tenantId, routeTenantId };
  }

  @Get("users/:tenantId")
  @TenantAuthorized("tenant.users.manage")
  users(@CurrentTenantContext() context: TenantContext) {
    return { contextTenantId: context.tenantId };
  }

  @Get("exports/:tenantId")
  @TenantAuthorized("exports.create")
  exports(@CurrentTenantContext() context: TenantContext) {
    return { contextTenantId: context.tenantId };
  }
}

@Module({
  controllers: [TenantRbacProbeController],
  providers: [
    TenantUserSessionGuard,
    TenantContextGuard,
    TenantPermissionGuard,
    TenantDataAccessFactory,
    {
      provide: TENANT_AUTH_REPOSITORY,
      useFactory: () => createTenantAuthRepository(prisma),
    },
    {
      provide: TENANT_AUTH_OPTIONS,
      useValue: { cookie: tenantCookieConfig("test"), webOrigin: "http://localhost:3005" },
    },
    { provide: TENANT_DATA_ACCESS_DATABASE, useFactory: () => prisma },
  ],
})
class TenantRbacTestModule {}

function binary(value: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

async function createSession(tenantId: string, userId: string): Promise<string> {
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

async function request(
  path: string,
  options: {
    body?: unknown;
    cookie?: string;
    headers?: Record<string, string>;
    method?: string;
  } = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...options.headers,
    },
    method: options.method ?? "GET",
  });
}

async function cleanFixtures(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { in: Object.values(slugs) } },
  });
  const tenantIds = tenants.map(({ id }) => id);
  if (tenantIds.length === 0) return;
  await prisma.userRole.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: tenantIds } } } });
  await prisma.userSession.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.role.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}

describe.sequential("TenantPermissionGuard integration", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
    prisma = createPlatformDatabaseClient({ databaseUrl });
    await prisma.$connect();
    await cleanFixtures();
    await syncPermissionCatalog(prisma);

    const [createdA, createdB] = await Promise.all(
      Object.values(slugs).map((slug) =>
        prisma.tenant.create({
          data: {
            defaultCurrency: "MXN",
            defaultLocale: "es-MX",
            defaultTimezone: "America/Mexico_City",
            displayName: slug,
            legalName: slug,
            slug,
            status: "active",
          },
        }),
      ),
    );
    if (createdA === undefined || createdB === undefined) throw new Error("Tenant fixtures failed");
    tenantAId = createdA.id;
    tenantBId = createdB.id;
    const [userA, userB, unitA] = await Promise.all([
      prisma.user.create({
        data: {
          displayName: "Guard User A",
          email: "guard@example.invalid",
          locale: "es-MX",
          passwordHash: "unused-guard-test-hash-a",
          tenantId: tenantAId,
          timezone: "America/Mexico_City",
        },
      }),
      prisma.user.create({
        data: {
          displayName: "Guard User B",
          email: "guard@example.invalid",
          locale: "es-MX",
          passwordHash: "unused-guard-test-hash-b",
          tenantId: tenantBId,
          timezone: "America/Mexico_City",
        },
      }),
      prisma.organizationUnit.create({
        data: { name: "Guard Unit A", tenantId: tenantAId, type: "department" },
      }),
    ]);
    userAId = userA.id;
    userBId = userB.id;
    unitAId = unitA.id;
    const dataA = createTenantDataAccess(createTenantContext(tenantAId), prisma);
    const dataB = createTenantDataAccess(createTenantContext(tenantBId), prisma);
    const [ownerA, viewerA, roleB] = await Promise.all([
      dataA.roles.createCustom({ key: "owner", name: "Owner" }),
      dataA.roles.createCustom({ key: "viewer", name: "Viewer" }),
      dataB.roles.createCustom({ key: "viewer", name: "Viewer" }),
    ]);
    ownerAId = ownerA.id;
    viewerAId = viewerA.id;
    roleBId = roleB.id;
    await Promise.all([
      dataA.userRoles.assign({ roleId: ownerA.id, userId: userAId }),
      dataB.rolePermissions.grant(roleB.id, "audit.read"),
      dataB.userRoles.assign({ roleId: roleB.id, userId: userBId }),
    ]);
    [cookieA, cookieB] = await Promise.all([
      createSession(tenantAId, userAId),
      createSession(tenantBId, userBId),
    ]);

    app = await NestFactory.create(TenantRbacTestModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (prisma !== undefined) {
      await cleanFixtures();
      await prisma.$disconnect();
    }
  });

  it("returns 401 without a tenant session", async () => {
    expect((await request(`/rbac-probe/audit/${tenantAId}`)).status).toBe(401);
  });

  it("returns 403 for an authenticated user without the required permission", async () => {
    expect((await request(`/rbac-probe/audit/${tenantAId}`, { cookie: cookieA })).status).toBe(403);
  });

  it("does not let a role in tenant B authorize the user in tenant A", async () => {
    expect((await request(`/rbac-probe/audit/${tenantBId}`, { cookie: cookieA })).status).toBe(403);
    expect((await request(`/rbac-probe/audit/${tenantAId}`, { cookie: cookieB })).status).toBe(200);
  });

  it("denies Owner without a grant and allows Viewer with the grant", async () => {
    const dataA = createTenantDataAccess(createTenantContext(tenantAId), prisma);
    expect((await request(`/rbac-probe/audit/${tenantAId}`, { cookie: cookieA })).status).toBe(403);
    await dataA.rolePermissions.grant(viewerAId, "audit.read");
    await dataA.userRoles.assign({ roleId: viewerAId, userId: userAId });
    expect((await request(`/rbac-probe/audit/${tenantAId}`, { cookie: cookieA })).status).toBe(200);
    expect(ownerAId).not.toBe(viewerAId);
  });

  it("requires ALL declared permissions", async () => {
    const dataA = createTenantDataAccess(createTenantContext(tenantAId), prisma);
    await dataA.rolePermissions.grant(viewerAId, "channels.read");
    expect((await request(`/rbac-probe/channels/${tenantAId}`, { cookie: cookieA })).status).toBe(
      403,
    );
    await dataA.rolePermissions.grant(viewerAId, "channels.manage");
    expect((await request(`/rbac-probe/channels/${tenantAId}`, { cookie: cookieA })).status).toBe(
      200,
    );
  });

  it("fails closed for an OU-scoped assignment in the generic tenant-wide guard", async () => {
    const dataA = createTenantDataAccess(createTenantContext(tenantAId), prisma);
    const role = await dataA.roles.createCustom({ key: "ou-users", name: "OU Users" });
    await dataA.rolePermissions.grant(role.id, "tenant.users.manage");
    await dataA.userRoles.assign({ organizationUnitId: unitAId, roleId: role.id, userId: userAId });
    expect((await request(`/rbac-probe/users/${tenantAId}`, { cookie: cookieA })).status).toBe(403);
    await dataA.userRoles.assign({ roleId: role.id, userId: userAId });
    expect((await request(`/rbac-probe/users/${tenantAId}`, { cookie: cookieA })).status).toBe(200);
  });

  it("fails closed for constrained grants in the generic guard", async () => {
    const dataA = createTenantDataAccess(createTenantContext(tenantAId), prisma);
    const role = await dataA.roles.createCustom({ key: "constrained-export", name: "Export" });
    await dataA.rolePermissions.grant(role.id, "exports.create", {
      scopeConstraints: { resource: "organization_unit" },
    });
    await dataA.userRoles.assign({ roleId: role.id, userId: userAId });
    expect((await request(`/rbac-probe/exports/${tenantAId}`, { cookie: cookieA })).status).toBe(
      403,
    );
    await dataA.rolePermissions.grant(role.id, "exports.create");
    expect((await request(`/rbac-probe/exports/${tenantAId}`, { cookie: cookieA })).status).toBe(
      200,
    );
  });

  it("ignores hostile body, query, header, and route tenant overrides", async () => {
    const response = await request(`/rbac-probe/audit/${tenantBId}?tenantId=${tenantBId}`, {
      body: { tenantId: tenantBId },
      cookie: cookieA,
      headers: { "x-tenant-id": tenantBId, "x-workspace-id": tenantBId },
      method: "POST",
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      bodyTenantId: tenantBId,
      contextTenantId: tenantAId,
      routeTenantId: tenantBId,
    });
  });

  it("reflects revoke and grant on the next request using the same session", async () => {
    const dataA = createTenantDataAccess(createTenantContext(tenantAId), prisma);
    expect((await request(`/rbac-probe/audit/${tenantAId}`, { cookie: cookieA })).status).toBe(200);
    await dataA.rolePermissions.revoke(viewerAId, "audit.read");
    expect((await request(`/rbac-probe/audit/${tenantAId}`, { cookie: cookieA })).status).toBe(403);
    await dataA.rolePermissions.grant(viewerAId, "audit.read");
    expect((await request(`/rbac-probe/audit/${tenantAId}`, { cookie: cookieA })).status).toBe(200);
  });

  it("preserves 401 precedence for disabled users and suspended tenants", async () => {
    await prisma.user.update({ data: { status: "disabled" }, where: { id: userAId } });
    expect((await request(`/rbac-probe/audit/${tenantAId}`, { cookie: cookieA })).status).toBe(401);
    await prisma.user.update({ data: { status: "active" }, where: { id: userAId } });
    await prisma.tenant.update({ data: { status: "suspended" }, where: { id: tenantAId } });
    expect((await request(`/rbac-probe/audit/${tenantAId}`, { cookie: cookieA })).status).toBe(401);
    await prisma.tenant.update({ data: { status: "active" }, where: { id: tenantAId } });
  });

  it("never stores permissions in UserSession", async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_session'
    `;
    expect(columns.map(({ column_name }) => column_name)).not.toContain("permissions");
    expect(roleBId).not.toBe(viewerAId);
  });
});
