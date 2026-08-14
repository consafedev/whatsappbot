import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTenantContext,
  createTenantDataAccess,
  type TenantDataAccess,
  TenantScopedRecordNotFoundError,
} from "./index";
import { createPlatformDatabaseClient, type PrismaClient } from "./platform";
import {
  createTenantEntitlementWriter,
  type TenantEntitlementWriter,
} from "./tenant-entitlement-writer";

const slugs = {
  tenantA: "e01-s03-tenant-a",
  tenantB: "e01-s03-tenant-b",
} as const;

let prisma: PrismaClient;
let tenantA: TenantDataAccess;
let tenantB: TenantDataAccess;
let entitlementWriterA: TenantEntitlementWriter;
let entitlementWriterB: TenantEntitlementWriter;
let tenantAId: string;
let tenantBId: string;
let entitlementAId: string;
let entitlementBId: string;
let unitAId: string;
let unitBId: string;

async function cleanFixtures(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { in: [slugs.tenantA, slugs.tenantB] } },
  });
  const tenantIds = tenants.map(({ id }) => id);

  if (tenantIds.length === 0) {
    return;
  }

  await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}

describe.sequential("tenant-aware data access integration", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanFixtures();

    const [createdTenantA, createdTenantB] = await Promise.all([
      prisma.tenant.create({
        data: {
          defaultCurrency: "MXN",
          defaultLocale: "es-MX",
          defaultTimezone: "America/Mexico_City",
          displayName: "E01-S03 Tenant A",
          legalName: "E01-S03 Tenant A SA de CV",
          slug: slugs.tenantA,
          status: "active",
        },
      }),
      prisma.tenant.create({
        data: {
          defaultCurrency: "MXN",
          defaultLocale: "es-MX",
          defaultTimezone: "America/Mexico_City",
          displayName: "E01-S03 Tenant B",
          legalName: "E01-S03 Tenant B SA de CV",
          slug: slugs.tenantB,
          status: "active",
        },
      }),
    ]);

    tenantAId = createdTenantA.id;
    tenantBId = createdTenantB.id;
    tenantA = createTenantDataAccess(createTenantContext(tenantAId), prisma);
    tenantB = createTenantDataAccess(createTenantContext(tenantBId), prisma);
    entitlementWriterA = createTenantEntitlementWriter(createTenantContext(tenantAId), prisma);
    entitlementWriterB = createTenantEntitlementWriter(createTenantContext(tenantBId), prisma);

    const [entitlementA, entitlementB, unitA, unitB] = await Promise.all([
      entitlementWriterA.create({
        enabled: true,
        entitlementKey: "module.tenant-a-only",
        source: "contract",
      }),
      entitlementWriterB.create({
        enabled: true,
        entitlementKey: "module.tenant-b-only",
        source: "contract",
      }),
      tenantA.organizationUnits.create({ name: "Tenant A Root", type: "company" }),
      tenantB.organizationUnits.create({ name: "Tenant B Root", type: "company" }),
    ]);

    entitlementAId = entitlementA.id;
    entitlementBId = entitlementB.id;
    unitAId = unitA.id;
    unitBId = unitB.id;
  });

  afterAll(async () => {
    if (prisma === undefined) {
      return;
    }

    await cleanFixtures();
    await prisma.$disconnect();
  });

  it("keeps entitlement lists isolated for two contexts on the same client", async () => {
    const [listA, listB] = await Promise.all([
      tenantA.entitlements.list(),
      tenantB.entitlements.list(),
    ]);

    expect(listA.map(({ tenantId }) => tenantId)).toEqual([tenantAId]);
    expect(listA.map(({ id }) => id)).toContain(entitlementAId);
    expect(listA.map(({ id }) => id)).not.toContain(entitlementBId);
    expect(listB.map(({ tenantId }) => tenantId)).toEqual([tenantBId]);
    expect(listB.map(({ id }) => id)).toContain(entitlementBId);
    expect(listB.map(({ id }) => id)).not.toContain(entitlementAId);
  });

  it("returns not found for cross-tenant entitlement reads", async () => {
    await expect(tenantA.entitlements.findById(entitlementBId)).resolves.toBeNull();
    await expect(tenantA.entitlements.findByKey("module.tenant-b-only")).resolves.toBeNull();
  });

  it("rejects a cross-tenant entitlement update without revealing ownership", async () => {
    await expect(
      entitlementWriterA.update(entitlementBId, { enabled: false }),
    ).rejects.toMatchObject({
      code: "P2025",
    });

    await expect(tenantB.entitlements.findById(entitlementBId)).resolves.toMatchObject({
      enabled: true,
      tenantId: tenantBId,
    });
  });

  it("injects the entitlement tenant from context", async () => {
    const created = await entitlementWriterA.create({
      enabled: false,
      entitlementKey: "module.context-injected",
      source: "manual_override",
    });

    expect(created.tenantId).toBe(tenantAId);
  });

  it("keeps organization unit lists and reads tenant-scoped", async () => {
    const [listA, listB, crossTenantRead] = await Promise.all([
      tenantA.organizationUnits.list(),
      tenantB.organizationUnits.list(),
      tenantA.organizationUnits.findById(unitBId),
    ]);

    expect(listA.every(({ tenantId }) => tenantId === tenantAId)).toBe(true);
    expect(listA.map(({ id }) => id)).toContain(unitAId);
    expect(listA.map(({ id }) => id)).not.toContain(unitBId);
    expect(listB.every(({ tenantId }) => tenantId === tenantBId)).toBe(true);
    expect(listB.map(({ id }) => id)).toContain(unitBId);
    expect(crossTenantRead).toBeNull();
  });

  it("rejects a cross-tenant organization unit update", async () => {
    await expect(
      tenantA.organizationUnits.update(unitBId, { name: "Hidden mutation" }),
    ).rejects.toEqual(new TenantScopedRecordNotFoundError("OrganizationUnit"));

    await expect(tenantB.organizationUnits.findById(unitBId)).resolves.toMatchObject({
      name: "Tenant B Root",
      tenantId: tenantBId,
    });
  });

  it("injects the organization unit tenant and scopes hierarchy reads", async () => {
    const child = await tenantA.organizationUnits.create({
      name: "Tenant A Child",
      parentId: unitAId,
      type: "department",
    });
    const [roots, children] = await Promise.all([
      tenantA.organizationUnits.listRoots(),
      tenantA.organizationUnits.listChildren(unitAId),
    ]);

    expect(child.tenantId).toBe(tenantAId);
    expect(roots.map(({ id }) => id)).toContain(unitAId);
    expect(roots.map(({ id }) => id)).not.toContain(child.id);
    expect(children.map(({ id }) => id)).toContain(child.id);
    expect(children.every(({ tenantId }) => tenantId === tenantAId)).toBe(true);
  });

  it("preserves the database cross-tenant parent constraint", async () => {
    await expect(
      tenantA.organizationUnits.create({
        name: "Invalid Cross Tenant Child",
        parentId: unitBId,
        type: "department",
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("works with a Prisma TransactionClient", async () => {
    const created = await prisma.$transaction(async (transaction) => {
      return createTenantEntitlementWriter(createTenantContext(tenantAId), transaction).create({
        enabled: true,
        entitlementKey: "module.transaction-compatible",
        source: "contract",
      });
    });

    expect(created.tenantId).toBe(tenantAId);
    await expect(tenantA.entitlements.findById(created.id)).resolves.toMatchObject({
      tenantId: tenantAId,
    });
  });
});
