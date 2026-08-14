import { PERMISSION_CATALOG } from "@whatsapp-platform/rbac";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/prisma/client";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  PlatformTenantPermissionCatalogError,
  syncPermissionCatalog,
} from "./platform";

const prefix = "e03-s02-db";
let prisma: PrismaClient;

function input(slug: string, requestId = `${prefix}-${slug}`) {
  return {
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Tenant ${slug}`,
    enabledModules: ["module.messaging.basic", "module.automation.basic"] as const,
    legalName: `Tenant ${slug} SA`,
    limits: {
      channelAccounts: 2,
      monthlyAiBudget: 125.25,
      organizationUnits: 1,
      storageBytes: 1_073_741_824,
      users: 5,
    },
    owner: {
      displayName: "Tenant Owner",
      email: "same-owner@example.invalid",
      locale: "es-MX",
      passwordHash: "$argon2id$not-plaintext-test-value",
      timezone: "America/Mexico_City",
    },
    requestId,
    slug,
  };
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
}

describe.sequential("Platform tenant provisioning repository", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
    prisma = createPlatformDatabaseClient({ databaseUrl });
    await cleanup();
    await syncPermissionCatalog(prisma);
  });

  afterAll(async () => {
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("atomically provisions the complete active tenant baseline", async () => {
    const result = await createPlatformTenantProvisioningRepository(prisma).provision(
      input(`${prefix}-complete`),
    );
    expect(result).toMatchObject({
      enabledModules: ["module.messaging.basic", "module.automation.basic"],
      owner: { email: "same-owner@example.invalid" },
      tenant: { status: "active" },
    });
    const tenantId = result.tenant.id;
    const [
      tenant,
      users,
      roles,
      grants,
      totalGrants,
      assignments,
      roots,
      entitlements,
      audits,
      events,
    ] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      prisma.user.findMany({ where: { tenantId } }),
      prisma.role.findMany({ orderBy: { key: "asc" }, where: { tenantId } }),
      prisma.rolePermission.findMany({ where: { role: { key: "owner", tenantId } } }),
      prisma.rolePermission.count({ where: { role: { tenantId } } }),
      prisma.userRole.findMany({ where: { tenantId } }),
      prisma.organizationUnit.findMany({ where: { tenantId } }),
      prisma.tenantEntitlement.findMany({
        orderBy: { entitlementKey: "asc" },
        where: { tenantId },
      }),
      prisma.auditLog.findMany({ where: { tenantId } }),
      prisma.domainEventOutbox.findMany({ where: { tenantId } }),
    ]);
    expect(tenant).toMatchObject({ brandingConfig: {}, settings: {}, status: "active" });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ mfaState: "disabled", status: "active" });
    expect(roles.map(({ key }) => key)).toEqual([
      "administrator",
      "agent",
      "operator",
      "owner",
      "supervisor",
      "viewer",
    ]);
    expect(roles.every(({ isSystem }) => isSystem)).toBe(true);
    expect(grants).toHaveLength(PERMISSION_CATALOG.length);
    expect(totalGrants).toBe(PERMISSION_CATALOG.length);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ organizationUnitId: null, userId: users[0]?.id });
    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({
      active: true,
      name: tenant.displayName,
      parentId: null,
      type: "company",
    });
    expect(entitlements).toHaveLength(7);
    expect(
      entitlements.filter(({ entitlementKey }) => entitlementKey.startsWith("module.")),
    ).toHaveLength(2);
    expect(
      entitlements.filter(({ entitlementKey }) => entitlementKey.startsWith("limit.")),
    ).toHaveLength(5);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "tenant.created", actorType: "platform_admin" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      attempts: 0,
      eventType: "tenant.created",
      publishedAt: null,
    });
    const serialized = JSON.stringify([result, audits, events]);
    expect(serialized).not.toContain(input(`${prefix}-complete`).owner.passwordHash);
  });

  it("rolls back every row after a controlled PostgreSQL failure during role provisioning", async () => {
    const rollbackSlug = `${prefix}-rollback`;
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION e03_s02_reject_supervisor() RETURNS trigger AS $$
      BEGIN
        IF NEW.name = 'Supervisor' AND EXISTS (
          SELECT 1 FROM tenant WHERE id = NEW.tenant_id AND slug = '${rollbackSlug}'
        ) THEN RAISE EXCEPTION 'controlled provisioning failure'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER e03_s02_reject_supervisor_trigger
      BEFORE INSERT ON role FOR EACH ROW EXECUTE FUNCTION e03_s02_reject_supervisor();
    `);
    try {
      await expect(
        createPlatformTenantProvisioningRepository(prisma).provision(input(rollbackSlug)),
      ).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS e03_s02_reject_supervisor_trigger ON role;
        DROP FUNCTION IF EXISTS e03_s02_reject_supervisor();
      `);
    }
    expect(await prisma.tenant.count({ where: { slug: rollbackSlug } })).toBe(0);
    expect(await prisma.user.count({ where: { tenant: { slug: rollbackSlug } } })).toBe(0);
    expect(await prisma.role.count({ where: { tenant: { slug: rollbackSlug } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { requestId: `${prefix}-${rollbackSlug}` } })).toBe(
      0,
    );
    expect(
      await prisma.domainEventOutbox.count({
        where: { payload: { path: ["slug"], equals: rollbackSlug } },
      }),
    ).toBe(0);
  });

  it("provisions two isolated tenants with the same owner email and shared global permissions", async () => {
    const repository = createPlatformTenantProvisioningRepository(prisma);
    const [a, b] = await Promise.all([
      repository.provision(input(`${prefix}-a`)),
      repository.provision(input(`${prefix}-b`)),
    ]);
    expect(a.tenant.id).not.toBe(b.tenant.id);
    expect(a.owner.email).toBe(b.owner.email);
    const [rolesA, rolesB, assignmentsA, rootsA, rootsB] = await Promise.all([
      prisma.role.findMany({ where: { tenantId: a.tenant.id } }),
      prisma.role.findMany({ where: { tenantId: b.tenant.id } }),
      prisma.userRole.findMany({ where: { tenantId: a.tenant.id } }),
      prisma.organizationUnit.findMany({ where: { tenantId: a.tenant.id } }),
      prisma.organizationUnit.findMany({ where: { tenantId: b.tenant.id } }),
    ]);
    expect(new Set(rolesA.map(({ id }) => id))).not.toEqual(new Set(rolesB.map(({ id }) => id)));
    expect(
      assignmentsA.every(
        ({ tenantId, userId }) => tenantId === a.tenant.id && userId === a.owner.id,
      ),
    ).toBe(true);
    expect(rootsA).toHaveLength(1);
    expect(rootsB).toHaveLength(1);
    expect(await prisma.permission.count()).toBeGreaterThanOrEqual(PERMISSION_CATALOG.length);
  });

  it("fails closed before tenant creation when the canonical permission catalog is incomplete", async () => {
    await cleanup();
    const missing = PERMISSION_CATALOG[0];
    await prisma.permission.delete({ where: { key: missing.key } });
    await expect(
      createPlatformTenantProvisioningRepository(prisma).provision(
        input(`${prefix}-missing-catalog`),
      ),
    ).rejects.toBeInstanceOf(PlatformTenantPermissionCatalogError);
    expect(await prisma.tenant.count({ where: { slug: `${prefix}-missing-catalog` } })).toBe(0);
    await syncPermissionCatalog(prisma);
  });
});
