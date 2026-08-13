import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlatformDatabaseClient, type PrismaClient } from "./platform";

const ids = {
  childUnit: "01989f20-0005-7000-8000-000000000005",
  deployment: "01989f20-0001-7000-8000-000000000001",
  entitlement: "01989f20-0003-7000-8000-000000000003",
  rootUnit: "01989f20-0004-7000-8000-000000000004",
  secondTenant: "01989f20-0006-7000-8000-000000000006",
  tenant: "01989f20-0002-7000-8000-000000000002",
} as const;

const featureFlagKey = "database.e01_s01.integration";
const generatedDeploymentName = "E01-S02 generated integration";
const generatedTenantSlug = "e01-s02-generated-integration";
let prisma: PrismaClient;

async function cleanFixtures(): Promise<void> {
  const tenantFilter = {
    OR: [{ id: { in: [ids.tenant, ids.secondTenant] } }, { slug: generatedTenantSlug }],
  };

  await prisma.organizationUnit.deleteMany({
    where: { tenant: tenantFilter },
  });
  await prisma.tenantEntitlement.deleteMany({ where: { tenant: tenantFilter } });
  await prisma.platformFeatureFlag.deleteMany({ where: { key: featureFlagKey } });
  await prisma.tenant.deleteMany({ where: tenantFilter });
  await prisma.platformDeployment.deleteMany({
    where: { OR: [{ id: ids.deployment }, { name: generatedDeploymentName }] },
  });
}

describe.sequential("database baseline integration", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanFixtures();
  });

  afterAll(async () => {
    if (prisma === undefined) {
      return;
    }

    await cleanFixtures();
    await prisma.$disconnect();
  });

  it("connects to PostgreSQL", async () => {
    await expect(prisma.$queryRaw`SELECT 1`).resolves.toEqual([{ "?column?": 1 }]);
  });

  it("generates UUIDv7 primary keys in PostgreSQL when ids are omitted", async () => {
    const deployment = await prisma.platformDeployment.create({
      data: {
        currentVersion: "0.0.0",
        environment: "development",
        mode: "shared",
        name: generatedDeploymentName,
        releaseChannel: "candidate",
        status: "healthy",
      },
    });
    const tenant = await prisma.tenant.create({
      data: {
        defaultCurrency: "MXN",
        defaultLocale: "es-MX",
        defaultTimezone: "America/Mexico_City",
        deploymentId: deployment.id,
        displayName: "Generated Integration Tenant",
        legalName: "Generated Integration Tenant SA de CV",
        slug: generatedTenantSlug,
        status: "active",
      },
    });
    const entitlement = await prisma.tenantEntitlement.create({
      data: {
        enabled: true,
        entitlementKey: "module.messaging.generated",
        source: "contract",
        tenantId: tenant.id,
      },
    });
    const organizationUnit = await prisma.organizationUnit.create({
      data: {
        name: "Generated Company",
        tenantId: tenant.id,
        type: "company",
      },
    });

    const generatedIds = [deployment.id, tenant.id, entitlement.id, organizationUnit.id];
    const versions = await Promise.all(
      generatedIds.map(async (id) => {
        const [result] = await prisma.$queryRaw<Array<{ version: number }>>`
          SELECT uuid_extract_version(${id}::uuid) AS version
        `;
        return result?.version;
      }),
    );

    expect(versions).toEqual([7, 7, 7, 7]);
    expect(deployment.createdAt).toBeInstanceOf(Date);
    expect(deployment.updatedAt).toBeInstanceOf(Date);
    expect(deployment.lastHealthAt).toBeNull();
    expect(tenant.suspendedAt).toBeNull();
    expect(entitlement.startsAt).toBeNull();
    expect(entitlement.endsAt).toBeNull();
  });

  it("keeps UUID and TIMESTAMPTZ(3) as the physical PostgreSQL types", async () => {
    const uuidColumns = await prisma.$queryRaw<
      Array<{ column_name: string; column_default: string; data_type: string; table_name: string }>
    >`
      SELECT table_name, column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND column_name = 'id'
        AND table_name IN ('platform_deployment', 'tenant', 'tenant_entitlement', 'organization_unit')
      ORDER BY table_name
    `;
    const timestampColumns = await prisma.$queryRaw<
      Array<{
        column_name: string;
        data_type: string;
        datetime_precision: number;
        table_name: string;
      }>
    >`
      SELECT table_name, column_name, data_type, datetime_precision
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN (
          'platform_deployment',
          'tenant',
          'tenant_entitlement',
          'platform_feature_flag',
          'organization_unit'
        )
        AND column_name IN (
          'created_at',
          'updated_at',
          'last_health_at',
          'suspended_at',
          'starts_at',
          'ends_at'
        )
      ORDER BY table_name, column_name
    `;

    expect(uuidColumns).toHaveLength(4);
    expect(uuidColumns.every((column) => column.data_type === "uuid")).toBe(true);
    expect(uuidColumns.every((column) => column.column_default === "uuidv7()")).toBe(true);
    expect(timestampColumns).toHaveLength(14);
    expect(
      timestampColumns.every(
        (column) =>
          column.data_type === "timestamp with time zone" && column.datetime_precision === 3,
      ),
    ).toBe(true);
  });

  it("updates updated_at after a real Prisma modification", async () => {
    const before = await prisma.tenant.findUniqueOrThrow({ where: { slug: generatedTenantSlug } });

    await new Promise((resolve) => setTimeout(resolve, 10));
    const after = await prisma.tenant.update({
      data: { displayName: "Generated Integration Tenant Updated" },
      where: { id: before.id },
    });

    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it("creates the platform deployment baseline", async () => {
    const deployment = await prisma.platformDeployment.create({
      data: {
        currentVersion: "0.0.0",
        environment: "development",
        id: ids.deployment,
        mode: "shared",
        name: "E01-S01 integration",
        releaseChannel: "candidate",
        status: "healthy",
      },
    });

    expect(deployment.id).toBe(ids.deployment);
  });

  it("creates a related tenant and technical feature flag", async () => {
    const tenant = await prisma.tenant.create({
      data: {
        defaultCurrency: "MXN",
        defaultLocale: "es-MX",
        defaultTimezone: "America/Mexico_City",
        deploymentId: ids.deployment,
        displayName: "Integration Tenant",
        id: ids.tenant,
        legalName: "Integration Tenant SA de CV",
        slug: "e01-s01-integration",
        status: "active",
      },
    });
    const featureFlag = await prisma.platformFeatureFlag.create({
      data: { enabledGlobally: false, key: featureFlagKey },
    });

    expect(tenant.deploymentId).toBe(ids.deployment);
    expect(featureFlag.key).toBe(featureFlagKey);
  });

  it("creates a tenant-owned entitlement", async () => {
    const entitlement = await prisma.tenantEntitlement.create({
      data: {
        enabled: true,
        entitlementKey: "module.messaging.basic",
        id: ids.entitlement,
        source: "contract",
        tenantId: ids.tenant,
      },
    });

    expect(entitlement.tenantId).toBe(ids.tenant);
  });

  it("creates root and child organization units for the same tenant", async () => {
    const root = await prisma.organizationUnit.create({
      data: {
        id: ids.rootUnit,
        name: "Company",
        tenantId: ids.tenant,
        type: "company",
      },
    });
    const child = await prisma.organizationUnit.create({
      data: {
        id: ids.childUnit,
        name: "Sales",
        parentId: root.id,
        tenantId: ids.tenant,
        type: "department",
      },
    });

    expect(child.parentId).toBe(root.id);
  });

  it("rejects a duplicate entitlement for the same tenant and key", async () => {
    await expect(
      prisma.tenantEntitlement.create({
        data: {
          enabled: false,
          entitlementKey: "module.messaging.basic",
          id: "01989f20-0007-7000-8000-000000000007",
          source: "manual_override",
          tenantId: ids.tenant,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects an entitlement period that ends before it starts", async () => {
    await expect(
      prisma.tenantEntitlement.create({
        data: {
          enabled: true,
          endsAt: new Date("2026-08-12T00:00:00.000Z"),
          entitlementKey: "module.appointments",
          id: "01989f20-0010-7000-8000-000000000010",
          source: "trial",
          startsAt: new Date("2026-08-13T00:00:00.000Z"),
          tenantId: ids.tenant,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects an invalid tenant foreign key", async () => {
    await expect(
      prisma.tenantEntitlement.create({
        data: {
          enabled: true,
          entitlementKey: "module.quotes",
          id: "01989f20-0008-7000-8000-000000000008",
          source: "trial",
          tenantId: "01989f20-9999-7000-8000-999999999999",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("rejects an organization parent from another tenant", async () => {
    await prisma.tenant.create({
      data: {
        defaultCurrency: "MXN",
        defaultLocale: "es-MX",
        defaultTimezone: "America/Mexico_City",
        displayName: "Second Tenant",
        id: ids.secondTenant,
        legalName: "Second Tenant SA de CV",
        slug: "e01-s01-second-integration",
        status: "active",
      },
    });

    await expect(
      prisma.organizationUnit.create({
        data: {
          id: "01989f20-0009-7000-8000-000000000009",
          name: "Invalid Cross Tenant Child",
          parentId: ids.rootUnit,
          tenantId: ids.secondTenant,
          type: "department",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});
