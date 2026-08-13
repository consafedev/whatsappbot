import { Body, Controller, Get, Module, Param, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  generateOpaqueToken,
  generatePlatformSessionToken,
  hashOpaqueToken,
  hashPlatformSessionToken,
  tenantCookieConfig,
} from "@whatsapp-platform/auth";
import type { TenantContext } from "@whatsapp-platform/database";
import {
  createPlatformDatabaseClient,
  createTenantAuthRepository,
  type PrismaClient,
  type TenantSessionIdentity,
} from "@whatsapp-platform/database/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TENANT_AUTH_OPTIONS,
  TENANT_AUTH_REPOSITORY,
  TenantAuthenticated,
  TenantUserSessionGuard,
} from "./tenant-auth";
import {
  CurrentTenantContext,
  CurrentTenantIdentity,
  TENANT_DATA_ACCESS_DATABASE,
  TenantContextGuard,
  TenantDataAccessFactory,
} from "./tenant-context";

const slugs = { a: "e02-s03-tenant-a", b: "e02-s03-tenant-b" } as const;
const cookieName = "tenant_session";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof NestFactory.create>>;
let baseUrl: string;
let tenantAId: string;
let tenantBId: string;
let userAId: string;
let sessionAId: string;
let cookieA: string;
let cookieB: string;
let platformCookie: string;

@Controller("tenant-context-probe")
class TenantContextProbeController {
  constructor(private readonly dataAccessFactory: TenantDataAccessFactory) {}

  @Get(":tenantId")
  @TenantAuthenticated()
  async read(
    @Param("tenantId") routeTenantId: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
  ) {
    const entitlements = await this.dataAccessFactory.create(context).entitlements.list();
    return {
      auth: {
        sessionId: identity.sessionId,
        tenantId: identity.tenantId,
        userId: identity.userId,
      },
      contextFrozen: Object.isFrozen(context),
      contextTenantId: context.tenantId,
      entitlementKeys: entitlements.map(({ entitlementKey }) => entitlementKey),
      routeTenantId,
    };
  }

  @Post(":tenantId")
  @TenantAuthenticated()
  async write(
    @Body() body: { name?: unknown; tenantId?: unknown },
    @CurrentTenantContext() context: TenantContext,
  ) {
    const name = typeof body.name === "string" ? body.name : "Context-created unit";
    const unit = await this.dataAccessFactory
      .create(context)
      .organizationUnits.create({ name, type: "branch" });
    return { contextTenantId: context.tenantId, unitId: unit.id, unitTenantId: unit.tenantId };
  }
}

@Module({
  controllers: [TenantContextProbeController],
  providers: [
    TenantUserSessionGuard,
    TenantContextGuard,
    TenantDataAccessFactory,
    {
      provide: TENANT_AUTH_REPOSITORY,
      useFactory: () => createTenantAuthRepository(prisma),
    },
    {
      provide: TENANT_AUTH_OPTIONS,
      useValue: { cookie: tenantCookieConfig("test"), webOrigin: "http://localhost:3000" },
    },
    { provide: TENANT_DATA_ACCESS_DATABASE, useFactory: () => prisma },
  ],
})
class TenantContextTestModule {}

function authCookie(token: string, name = cookieName): string {
  return `${name}=${token}`;
}

function binary(value: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
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

async function createSession(
  tenantId: string,
  userId: string,
): Promise<{ id: string; token: string }> {
  const token = generateOpaqueToken();
  const session = await prisma.userSession.create({
    data: {
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      tenantId,
      tokenHash: binary(hashOpaqueToken(token)),
      userId,
    },
  });
  return { id: session.id, token };
}

async function cleanFixtures(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: "e02-s03-" } },
  });
  const tenantIds = tenants.map(({ id }) => id);
  if (tenantIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.userSession.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }
  await prisma.platformAdminSession.deleteMany({
    where: { platformAdmin: { email: "e02-s03-platform@example.invalid" } },
  });
  await prisma.platformAdmin.deleteMany({
    where: { email: "e02-s03-platform@example.invalid" },
  });
}

describe.sequential("authenticated tenant context integration", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
    prisma = createPlatformDatabaseClient({ databaseUrl });
    await prisma.$connect();
    await cleanFixtures();

    const tenants = await Promise.all(
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
    const tenantA = tenants[0];
    const tenantB = tenants[1];
    if (tenantA === undefined || tenantB === undefined) throw new Error("Tenant fixtures failed");
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    const [userA, userB] = await Promise.all([
      prisma.user.create({
        data: {
          displayName: "Context User A",
          email: "context-a@example.invalid",
          locale: "es-MX",
          passwordHash: "unused-in-session-test",
          tenantId: tenantAId,
          timezone: "America/Mexico_City",
        },
      }),
      prisma.user.create({
        data: {
          displayName: "Context User B",
          email: "context-b@example.invalid",
          locale: "es-MX",
          passwordHash: "unused-in-session-test",
          tenantId: tenantBId,
          timezone: "America/Mexico_City",
        },
      }),
    ]);
    userAId = userA.id;

    await Promise.all([
      prisma.tenantEntitlement.create({
        data: { entitlementKey: "module.context-a", source: "contract", tenantId: tenantAId },
      }),
      prisma.tenantEntitlement.create({
        data: { entitlementKey: "module.context-b", source: "contract", tenantId: tenantBId },
      }),
      prisma.organizationUnit.create({
        data: { name: "Existing A", tenantId: tenantAId, type: "branch" },
      }),
      prisma.organizationUnit.create({
        data: { name: "Existing B", tenantId: tenantBId, type: "branch" },
      }),
    ]);

    const [sessionA, sessionB] = await Promise.all([
      createSession(tenantAId, userA.id),
      createSession(tenantBId, userB.id),
    ]);
    sessionAId = sessionA.id;
    cookieA = authCookie(sessionA.token);
    cookieB = authCookie(sessionB.token);

    const platformToken = generatePlatformSessionToken();
    const platformAdmin = await prisma.platformAdmin.create({
      data: {
        displayName: "Context Platform Admin",
        email: "e02-s03-platform@example.invalid",
        locale: "es-MX",
        passwordHash: "unused-in-session-test",
        timezone: "America/Mexico_City",
      },
    });
    await prisma.platformAdminSession.create({
      data: {
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        platformAdminId: platformAdmin.id,
        tokenHash: binary(hashPlatformSessionToken(platformToken)),
      },
    });
    platformCookie = authCookie(platformToken, "platform_session");

    app = await NestFactory.create(TenantContextTestModule, { logger: false });
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

  it("derives context A and B from their authenticated sessions", async () => {
    const [responseA, responseB] = await Promise.all([
      request(`/tenant-context-probe/${tenantBId}`, { cookie: cookieA }),
      request(`/tenant-context-probe/${tenantAId}`, { cookie: cookieB }),
    ]);
    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    const [bodyA, bodyB] = await Promise.all([responseA.json(), responseB.json()]);
    expect(bodyA).toMatchObject({
      auth: { tenantId: tenantAId, userId: userAId },
      contextFrozen: true,
      contextTenantId: tenantAId,
      entitlementKeys: ["module.context-a"],
      routeTenantId: tenantBId,
    });
    expect(bodyB).toMatchObject({
      auth: { tenantId: tenantBId },
      contextFrozen: true,
      contextTenantId: tenantBId,
      entitlementKeys: ["module.context-b"],
      routeTenantId: tenantAId,
    });
  });

  it("ignores hostile query and tenant headers for scoped reads", async () => {
    const response = await request(`/tenant-context-probe/${tenantBId}?tenantId=${tenantBId}`, {
      cookie: cookieA,
      headers: { "x-tenant-id": tenantBId, "x-workspace-id": tenantBId },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      contextTenantId: tenantAId,
      entitlementKeys: ["module.context-a"],
    });
  });

  it("ignores hostile body tenantId and writes through TenantDataAccess as A", async () => {
    const name = "Written through context A";
    const response = await request(`/tenant-context-probe/${tenantBId}?tenantId=${tenantBId}`, {
      body: { name, tenantId: tenantBId },
      cookie: cookieA,
      headers: { "x-tenant-id": tenantBId, "x-workspace-id": tenantBId },
      method: "POST",
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      contextTenantId: tenantAId,
      unitTenantId: tenantAId,
    });
    expect(await prisma.organizationUnit.count({ where: { name, tenantId: tenantAId } })).toBe(1);
    expect(await prisma.organizationUnit.count({ where: { name, tenantId: tenantBId } })).toBe(0);
  });

  it("does not create context without a tenant session despite hostile request data", async () => {
    const response = await request(`/tenant-context-probe/${tenantBId}?tenantId=${tenantBId}`, {
      body: { name: "Must not write", tenantId: tenantBId },
      headers: { "x-tenant-id": tenantBId, "x-workspace-id": tenantBId },
      method: "POST",
    });
    expect(response.status).toBe(401);
    expect(await prisma.organizationUnit.count({ where: { name: "Must not write" } })).toBe(0);
  });

  it("does not treat a valid Platform Admin cookie as tenant authentication", async () => {
    const response = await request(`/tenant-context-probe/${tenantAId}`, {
      cookie: platformCookie,
    });
    expect(response.status).toBe(401);
  });

  it("rejects revoked and expired UserSession records", async () => {
    await prisma.userSession.update({ data: { revokedAt: new Date() }, where: { id: sessionAId } });
    expect((await request(`/tenant-context-probe/${tenantAId}`, { cookie: cookieA })).status).toBe(
      401,
    );
    await prisma.userSession.update({
      data: { expiresAt: new Date(Date.now() - 1), revokedAt: null },
      where: { id: sessionAId },
    });
    expect((await request(`/tenant-context-probe/${tenantAId}`, { cookie: cookieA })).status).toBe(
      401,
    );
    await prisma.userSession.update({
      data: { expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      where: { id: sessionAId },
    });
  });

  it("rejects a disabled user and a suspended tenant", async () => {
    await prisma.user.update({ data: { status: "disabled" }, where: { id: userAId } });
    expect((await request(`/tenant-context-probe/${tenantAId}`, { cookie: cookieA })).status).toBe(
      401,
    );
    await prisma.user.update({ data: { status: "active" }, where: { id: userAId } });
    await prisma.tenant.update({ data: { status: "suspended" }, where: { id: tenantAId } });
    expect((await request(`/tenant-context-probe/${tenantAId}`, { cookie: cookieA })).status).toBe(
      401,
    );
    await prisma.tenant.update({ data: { status: "active" }, where: { id: tenantAId } });
  });

  it("keeps concurrent A and B requests isolated without ambient state", async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        index % 2 === 0
          ? request(`/tenant-context-probe/${tenantBId}`, { cookie: cookieA })
          : request(`/tenant-context-probe/${tenantAId}`, { cookie: cookieB }),
      ),
    );
    const bodies = (await Promise.all(responses.map((response) => response.json()))) as Array<{
      contextTenantId: string;
    }>;
    expect(responses.every(({ status }) => status === 200)).toBe(true);
    expect(
      bodies.every((body, index) =>
        index % 2 === 0 ? body.contextTenantId === tenantAId : body.contextTenantId === tenantBId,
      ),
    ).toBe(true);
  });
});
