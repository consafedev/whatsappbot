import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "./index";

const ids = {
  childUnit: "00000000-0000-4000-8000-000000000005",
  deployment: "00000000-0000-4000-8000-000000000001",
  entitlement: "00000000-0000-4000-8000-000000000003",
  rootUnit: "00000000-0000-4000-8000-000000000004",
  secondTenant: "00000000-0000-4000-8000-000000000006",
  tenant: "00000000-0000-4000-8000-000000000002",
} as const;

const featureFlagKey = "database.e01_s01.integration";
let prisma: PrismaClient;

async function cleanFixtures(): Promise<void> {
  await prisma.organizationUnit.deleteMany({
    where: { id: { in: [ids.childUnit, ids.rootUnit] } },
  });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: ids.tenant } });
  await prisma.platformFeatureFlag.deleteMany({ where: { key: featureFlagKey } });
  await prisma.tenant.deleteMany({ where: { id: { in: [ids.tenant, ids.secondTenant] } } });
  await prisma.platformDeployment.deleteMany({ where: { id: ids.deployment } });
}

describe.sequential("database baseline integration", () => {
  beforeAll(async () => {
    prisma = createPrismaClient(loadDatabaseConfig());
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
          id: "00000000-0000-4000-8000-000000000007",
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
          id: "00000000-0000-4000-8000-000000000010",
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
          id: "00000000-0000-4000-8000-000000000008",
          source: "trial",
          tenantId: "00000000-0000-4000-8000-999999999999",
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
          id: "00000000-0000-4000-8000-000000000009",
          name: "Invalid Cross Tenant Child",
          parentId: ids.rootUnit,
          tenantId: ids.secondTenant,
          type: "department",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});
