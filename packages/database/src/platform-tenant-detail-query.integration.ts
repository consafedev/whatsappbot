import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/prisma/client";
import { createPlatformDatabaseClient } from "./platform";
import {
  createPlatformTenantDetailQueryService,
  PlatformTenantNotFoundError,
} from "./platform-tenant-detail-query";

const prefix = "e03-s03-detail";
const observedAt = new Date("2026-08-13T18:00:00.000Z");
let prisma: PrismaClient;
let tenantAId = "";

async function cleanup() {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, deploymentId: true },
    where: { slug: { startsWith: prefix } },
  });
  const tenantIds = tenants.map(({ id }) => id);
  const deploymentIds = tenants.flatMap(({ deploymentId }) =>
    deploymentId === null ? [] : [deploymentId],
  );
  await prisma.userRole.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: tenantIds } } } });
  await prisma.role.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ tenantId: { in: tenantIds } }, { requestId: { startsWith: prefix } }] },
  });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.platformDeployment.deleteMany({ where: { id: { in: deploymentIds } } });
}

describe.sequential("Platform tenant detail query integration", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
    prisma = createPlatformDatabaseClient({ databaseUrl });
    await cleanup();
    const deployment = await prisma.platformDeployment.create({
      data: {
        baseUrl: "https://private.invalid",
        currentVersion: "0.3.3",
        environment: "production",
        metadata: { secret: true },
        mode: "shared",
        name: `${prefix} deployment`,
        releaseChannel: "stable",
        status: "healthy",
        targetVersion: "0.3.4",
      },
    });
    const [tenantA, tenantB] = await Promise.all([
      prisma.tenant.create({
        data: {
          brandingConfig: { logo: "private" },
          defaultCurrency: "MXN",
          defaultLocale: "es-MX",
          defaultTimezone: "America/Mexico_City",
          deploymentId: deployment.id,
          displayName: "Alpha Detail",
          legalName: "Alpha Detail SA",
          settings: { themeMode: "dark", private: true },
          slug: `${prefix}-alpha`,
          status: "active",
        },
      }),
      prisma.tenant.create({
        data: {
          defaultCurrency: "USD",
          defaultLocale: "en-US",
          defaultTimezone: "UTC",
          displayName: "Beta Detail",
          legalName: "Beta Detail Inc",
          slug: `${prefix}-beta`,
          status: "active",
        },
      }),
    ]);
    tenantAId = tenantA.id;
    const [rootA, rootB] = await Promise.all([
      prisma.organizationUnit.create({
        data: { name: "Alpha Root", tenantId: tenantA.id, type: "company" },
      }),
      prisma.organizationUnit.create({
        data: { name: "Beta Root", tenantId: tenantB.id, type: "company" },
      }),
    ]);
    const [roleA, roleB, userA, userB] = await Promise.all([
      prisma.role.create({
        data: { isSystem: true, key: "owner", name: "Owner A", tenantId: tenantA.id },
      }),
      prisma.role.create({
        data: { isSystem: true, key: "owner", name: "Owner B", tenantId: tenantB.id },
      }),
      prisma.user.create({
        data: {
          displayName: "Alpha User",
          email: `${prefix}-alpha@example.invalid`,
          locale: "es-MX",
          passwordHash: "private-alpha-hash",
          tenantId: tenantA.id,
          timezone: "America/Mexico_City",
        },
      }),
      prisma.user.create({
        data: {
          displayName: "Beta User",
          email: `${prefix}-beta@example.invalid`,
          locale: "en-US",
          passwordHash: "private-beta-hash",
          tenantId: tenantB.id,
          timezone: "UTC",
        },
      }),
    ]);
    await Promise.all([
      prisma.userRole.create({
        data: {
          organizationUnitId: rootA.id,
          roleId: roleA.id,
          tenantId: tenantA.id,
          userId: userA.id,
        },
      }),
      prisma.userRole.create({
        data: {
          organizationUnitId: rootB.id,
          roleId: roleB.id,
          tenantId: tenantB.id,
          userId: userB.id,
        },
      }),
      prisma.tenantEntitlement.createMany({
        data: [
          {
            config: { internal: "hidden" },
            enabled: true,
            entitlementKey: "module.messaging.basic",
            source: "plan",
            tenantId: tenantA.id,
          },
          {
            enabled: true,
            entitlementKey: "module.ai",
            source: "trial",
            startsAt: new Date("2026-08-14T00:00:00.000Z"),
            tenantId: tenantA.id,
          },
          {
            enabled: true,
            endsAt: observedAt,
            entitlementKey: "module.quotes",
            source: "contract",
            tenantId: tenantA.id,
          },
          {
            enabled: false,
            entitlementKey: "module.documents",
            source: "manual_override",
            tenantId: tenantA.id,
          },
          {
            enabled: true,
            entitlementKey: "limit.users",
            limitValue: "15.0000",
            source: "contract",
            tenantId: tenantA.id,
          },
          {
            enabled: true,
            entitlementKey: "limit.organization_units",
            limitValue: "7.0000",
            source: "plan",
            tenantId: tenantA.id,
          },
          {
            enabled: true,
            entitlementKey: "limit.storage_bytes",
            limitValue: "9007199254740993.0000",
            source: "contract",
            tenantId: tenantA.id,
          },
          { enabled: true, entitlementKey: "module.ai", source: "plan", tenantId: tenantB.id },
        ],
      }),
      prisma.auditLog.create({
        data: {
          action: "alpha.updated",
          actorId: userA.id,
          actorType: "user",
          afterSummary: { secret: "hidden" },
          beforeSummary: { secret: "hidden" },
          entityId: tenantA.id,
          entityType: "Tenant",
          ipMetadata: { ip: "hidden" },
          occurredAt: new Date("2026-08-13T17:00:00.000Z"),
          organizationUnitId: rootA.id,
          requestId: `${prefix}-alpha`,
          tenantId: tenantA.id,
        },
      }),
      prisma.auditLog.create({
        data: {
          action: "beta.updated",
          actorId: userB.id,
          actorType: "user",
          entityId: tenantB.id,
          entityType: "Tenant",
          occurredAt: new Date("2026-08-13T18:00:00.000Z"),
          requestId: `${prefix}-beta`,
          tenantId: tenantB.id,
        },
      }),
      prisma.auditLog.create({
        data: {
          action: "platform.event",
          actorType: "platform_admin",
          entityId: randomUUID(),
          entityType: "Platform",
          requestId: `${prefix}-platform`,
          tenantId: null,
        },
      }),
    ]);
  });

  afterAll(async () => {
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("maps only safe detail fields, all canonical modules and Decimal limits", async () => {
    const detail = await createPlatformTenantDetailQueryService(prisma).detail(
      tenantAId,
      observedAt,
    );
    expect(detail.general).toMatchObject({
      brandingOverride: true,
      displayName: "Alpha Detail",
      themeMode: "dark",
    });
    expect(detail.organizationRoot).toMatchObject({ name: "Alpha Root", type: "company" });
    expect(detail.modules).toHaveLength(14);
    expect(detail.modules.find(({ key }) => key === "module.messaging.basic")).toMatchObject({
      configPresent: true,
      effective: true,
      enabled: true,
    });
    expect(detail.modules.find(({ key }) => key === "module.ai")).toMatchObject({
      effective: false,
      enabled: true,
    });
    expect(detail.modules.find(({ key }) => key === "module.quotes")).toMatchObject({
      effective: false,
    });
    expect(detail.limits).toHaveLength(5);
    expect(detail.limits.find(({ key }) => key === "limit.storage_bytes")?.limitValue).toBe(
      "9007199254740993.0000",
    );
    expect(detail.usage).toMatchObject({
      users: { used: 1, limit: "15.0000" },
      organizationUnits: { used: 1, limit: "7.0000" },
      channels: { used: null },
      storageBytes: { used: null },
      monthlyAiBudget: { used: null },
    });
    expect(detail.channels).toEqual({ available: false, count: null });
    expect(detail.backup).toEqual({ available: false });
    expect(detail.deployment).toMatchObject({ currentVersion: "0.3.3", targetVersion: "0.3.4" });
    expect(JSON.stringify(detail)).not.toMatch(/private|baseUrl|metadata|settings|brandingConfig/);
  });

  it("isolates and paginates users with safe roles and organization units", async () => {
    const page = await createPlatformTenantDetailQueryService(prisma).users(tenantAId, {
      page: 1,
      pageSize: 1,
    });
    expect(page).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    expect(page.items[0]).toMatchObject({
      displayName: "Alpha User",
      roles: [{ key: "owner", organizationUnit: { name: "Alpha Root" } }],
    });
    expect(JSON.stringify(page)).not.toMatch(/Beta User|passwordHash|private-alpha-hash/);
  });

  it("counts only active users towards usage.users", async () => {
    const query = createPlatformTenantDetailQueryService(prisma);
    const disabled = await prisma.user.create({
      data: {
        displayName: "Disabled Alpha",
        email: `${prefix}-disabled@example.invalid`,
        locale: "es-MX",
        passwordHash: "not-used-by-query-test",
        status: "disabled",
        tenantId: tenantAId,
        timezone: "America/Mexico_City",
      },
    });
    const detail = await query.detail(tenantAId, observedAt);
    expect(detail.usage.users).toEqual({ used: 1, limit: "15.0000" });
    const page = await query.users(tenantAId, { page: 1, pageSize: 25 });
    expect(page.total).toBe(2);
    await prisma.user.delete({ where: { id: disabled.id } });
  });

  it("isolates audit rows and omits summaries and IP metadata", async () => {
    const page = await createPlatformTenantDetailQueryService(prisma).audit(tenantAId, {
      page: 1,
      pageSize: 25,
    });
    expect(page.total).toBe(1);
    expect(page.items.map(({ action }) => action)).toEqual(["alpha.updated"]);
    expect(JSON.stringify(page)).not.toMatch(
      /beta.updated|platform.event|beforeSummary|afterSummary|ipMetadata|hidden/,
    );
  });

  it("returns a domain not-found error for detail, users and audit", async () => {
    const query = createPlatformTenantDetailQueryService(prisma);
    const missing = randomUUID();
    await expect(query.detail(missing)).rejects.toBeInstanceOf(PlatformTenantNotFoundError);
    await expect(query.users(missing, { page: 1, pageSize: 25 })).rejects.toBeInstanceOf(
      PlatformTenantNotFoundError,
    );
    await expect(query.audit(missing, { page: 1, pageSize: 25 })).rejects.toBeInstanceOf(
      PlatformTenantNotFoundError,
    );
  });
});
