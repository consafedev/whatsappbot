import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/prisma/client";
import { createPlatformDatabaseClient } from "./platform";
import { createPlatformTenantQueryService } from "./platform-tenant-query";

const prefix = "e03-s01-query";
const now = new Date("2026-08-13T18:00:00.000Z");
let prisma: PrismaClient;

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, deploymentId: true },
    where: { slug: { startsWith: prefix } },
  });
  const tenantIds = tenants.map(({ id }) => id);
  const deploymentIds = tenants.flatMap(({ deploymentId }) =>
    deploymentId === null ? [] : [deploymentId],
  );
  await prisma.userSession.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.platformDeployment.deleteMany({ where: { id: { in: deploymentIds } } });
}

async function createUser(tenantId: string, suffix: string) {
  return prisma.user.create({
    data: {
      displayName: `User ${suffix}`,
      email: `${prefix}-${suffix}@example.invalid`,
      locale: "es-MX",
      passwordHash: "not-used-by-query-test",
      tenantId,
      timezone: "America/Mexico_City",
    },
  });
}

describe.sequential("Platform tenant query integration", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
    prisma = createPlatformDatabaseClient({ databaseUrl });
    await cleanup();

    const [healthy, degraded] = await Promise.all([
      prisma.platformDeployment.create({
        data: {
          currentVersion: "0.3.1",
          environment: "production",
          lastHealthAt: new Date("2026-08-13T17:50:00.000Z"),
          mode: "shared",
          name: `${prefix} Shared`,
          releaseChannel: "stable",
          status: "healthy",
        },
      }),
      prisma.platformDeployment.create({
        data: {
          currentVersion: "0.3.0",
          environment: "staging",
          lastHealthAt: new Date("2026-08-13T17:45:00.000Z"),
          mode: "dedicated",
          name: `${prefix} Dedicated`,
          releaseChannel: "candidate",
          status: "degraded",
        },
      }),
    ]);
    const [tenantA, tenantB] = await Promise.all([
      prisma.tenant.create({
        data: {
          defaultCurrency: "MXN",
          defaultLocale: "es-MX",
          defaultTimezone: "America/Mexico_City",
          deploymentId: healthy.id,
          displayName: "Alpha Tenant",
          legalName: "Alpha Legal SA",
          slug: `${prefix}-alpha`,
          status: "active",
        },
      }),
      prisma.tenant.create({
        data: {
          defaultCurrency: "MXN",
          defaultLocale: "es-MX",
          defaultTimezone: "America/Mexico_City",
          deploymentId: degraded.id,
          displayName: "Beta Tenant",
          legalName: "Beta Operations SA",
          slug: `${prefix}-beta`,
          status: "suspended",
        },
      }),
      prisma.tenant.create({
        data: {
          defaultCurrency: "MXN",
          defaultLocale: "es-MX",
          defaultTimezone: "America/Mexico_City",
          displayName: "Gamma Tenant",
          legalName: "Gamma Holdings SA",
          slug: `${prefix}-gamma`,
          status: "provisioning",
        },
      }),
    ]);
    const [userA1, userA2, userB] = await Promise.all([
      createUser(tenantA.id, "a1"),
      createUser(tenantA.id, "a2"),
      createUser(tenantB.id, "b1"),
    ]);
    await Promise.all([
      prisma.userSession.create({
        data: {
          expiresAt: new Date("2026-08-14T18:00:00.000Z"),
          lastSeenAt: new Date("2026-08-13T16:00:00.000Z"),
          tenantId: tenantA.id,
          tokenHash: new Uint8Array(32).fill(1),
          userId: userA1.id,
        },
      }),
      prisma.userSession.create({
        data: {
          expiresAt: new Date("2026-08-14T18:00:00.000Z"),
          lastSeenAt: new Date("2026-08-13T17:00:00.000Z"),
          tenantId: tenantB.id,
          tokenHash: new Uint8Array(32).fill(2),
          userId: userB.id,
        },
      }),
      prisma.auditLog.create({
        data: {
          action: "query.test",
          actorId: userA2.id,
          actorType: "user",
          entityId: tenantA.id,
          entityType: "Tenant",
          occurredAt: new Date("2026-08-13T16:30:00.000Z"),
          requestId: `${prefix}-request`,
          tenantId: tenantA.id,
        },
      }),
      prisma.tenantEntitlement.createMany({
        data: [
          {
            enabled: true,
            entitlementKey: "module.messaging.basic",
            source: "plan",
            tenantId: tenantA.id,
          },
          {
            enabled: false,
            entitlementKey: "module.disabled",
            source: "plan",
            tenantId: tenantA.id,
          },
          {
            enabled: true,
            entitlementKey: "module.future",
            source: "trial",
            startsAt: new Date("2026-08-14T00:00:00.000Z"),
            tenantId: tenantA.id,
          },
          {
            enabled: true,
            endsAt: new Date("2026-08-13T17:59:59.000Z"),
            entitlementKey: "module.expired",
            source: "trial",
            tenantId: tenantA.id,
          },
          { enabled: true, entitlementKey: "limit.users", source: "plan", tenantId: tenantA.id },
          {
            enabled: true,
            entitlementKey: "quotes.approve",
            source: "manual_override",
            tenantId: tenantA.id,
          },
          {
            enabled: true,
            endsAt: new Date("2026-08-14T00:00:00.000Z"),
            entitlementKey: "module.quotes",
            source: "contract",
            startsAt: new Date("2026-08-12T00:00:00.000Z"),
            tenantId: tenantB.id,
          },
        ],
      }),
    ]);
  });

  afterAll(async () => {
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("returns safe real summaries with modules, users, activity, deployment health, and deferred channels", async () => {
    const result = await createPlatformTenantQueryService(prisma).list({
      now,
      page: 1,
      pageSize: 25,
      search: prefix,
    });
    expect(result.total).toBe(3);
    expect(result.items.map(({ displayName }) => displayName)).toEqual([
      "Alpha Tenant",
      "Beta Tenant",
      "Gamma Tenant",
    ]);
    const [alpha, beta, gamma] = result.items;
    expect(alpha).toMatchObject({
      channelCount: null,
      enabledModules: ["module.messaging.basic"],
      status: "active",
      userCount: 2,
    });
    expect(alpha?.deployment).toMatchObject({ status: "healthy", currentVersion: "0.3.1" });
    expect(alpha?.lastActivityAt?.toISOString()).toBe("2026-08-13T16:30:00.000Z");
    expect(beta).toMatchObject({ enabledModules: ["module.quotes"], userCount: 1 });
    expect(beta?.deployment?.status).toBe("degraded");
    expect(beta?.lastActivityAt?.toISOString()).toBe("2026-08-13T17:00:00.000Z");
    expect(gamma).toMatchObject({ channelCount: null, deployment: null, userCount: 0 });
    expect(gamma?.lastActivityAt).toBeNull();
  });

  it("paginates with stable order and a real total", async () => {
    const query = createPlatformTenantQueryService(prisma);
    const first = await query.list({ now, page: 1, pageSize: 2, search: prefix });
    const second = await query.list({ now, page: 2, pageSize: 2, search: prefix });
    expect(first).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(second).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(new Set([...first.items, ...second.items].map(({ id }) => id)).size).toBe(3);
  });

  it("searches display name, legal name, and slug case-insensitively", async () => {
    const query = createPlatformTenantQueryService(prisma);
    await expect(
      query.list({ now, page: 1, pageSize: 25, search: "ALPHA TENANT" }),
    ).resolves.toMatchObject({ total: 1 });
    await expect(
      query.list({ now, page: 1, pageSize: 25, search: "beta operations" }),
    ).resolves.toMatchObject({ total: 1 });
    await expect(
      query.list({ now, page: 1, pageSize: 25, search: `${prefix}-GAMMA` }),
    ).resolves.toMatchObject({ total: 1 });
  });

  it("filters only by canonical tenant status", async () => {
    const result = await createPlatformTenantQueryService(prisma).list({
      now,
      page: 1,
      pageSize: 25,
      search: prefix,
      status: "active",
    });
    expect(result.items.map(({ status }) => status)).toEqual(["active"]);
  });
});
