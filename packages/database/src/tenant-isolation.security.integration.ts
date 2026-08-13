import { randomBytes, randomUUID } from "node:crypto";
import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as TenantSafeDatabase from "./index";
import {
  createTenantContext,
  createTenantDataAccess,
  type OrganizationUnitCreateData,
  type TenantDataAccess,
  type TenantEntitlementCreateData,
  TenantScopedRecordNotFoundError,
  withTenantTransaction,
} from "./index";
import {
  createPlatformAuditWriter,
  createPlatformDatabaseClient,
  type PrismaClient,
  syncPermissionCatalog,
} from "./platform";

const slugs = { a: "e02-s04-security-a", b: "e02-s04-security-b" } as const;
const platformRequestPrefix = "e02-s04-platform-";
let prisma: PrismaClient;
let tenantA: TenantDataAccess;
let tenantB: TenantDataAccess;
let tenantAId: string;
let tenantBId: string;
let entitlementAId: string;
let entitlementBId: string;
let rootAId: string;
let childAId: string;
let rootBId: string;
let userAId: string;
let userBId: string;

function binary(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(randomBytes(32));
}

async function cleanFixtures(): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { requestId: { startsWith: platformRequestPrefix } } });
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { in: Object.values(slugs) } },
  });
  const tenantIds = tenants.map(({ id }) => id);
  if (tenantIds.length === 0) return;
  await prisma.userRole.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: tenantIds } } } });
  await prisma.userPasswordResetToken.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.userSession.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.role.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}

describe.sequential("E02-S04 tenant isolation security matrix", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
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
    tenantA = createTenantDataAccess(createTenantContext(tenantAId), prisma);
    tenantB = createTenantDataAccess(createTenantContext(tenantBId), prisma);

    const [entitlementA, entitlementB, rootA, rootB, userA, userB] = await Promise.all([
      tenantA.entitlements.create({
        enabled: true,
        entitlementKey: "module.security-a",
        source: "contract",
      }),
      tenantB.entitlements.create({
        enabled: true,
        entitlementKey: "module.security-b",
        source: "contract",
      }),
      tenantA.organizationUnits.create({ name: "Security Root A", type: "company" }),
      tenantB.organizationUnits.create({ name: "Security Root B", type: "company" }),
      prisma.user.create({
        data: {
          displayName: "Security User A",
          email: "security@example.invalid",
          locale: "es-MX",
          passwordHash: "security-test-hash-a",
          tenantId: tenantAId,
          timezone: "America/Mexico_City",
        },
      }),
      prisma.user.create({
        data: {
          displayName: "Security User B",
          email: "security@example.invalid",
          locale: "es-MX",
          passwordHash: "security-test-hash-b",
          tenantId: tenantBId,
          timezone: "America/Mexico_City",
        },
      }),
    ]);
    entitlementAId = entitlementA.id;
    entitlementBId = entitlementB.id;
    rootAId = rootA.id;
    rootBId = rootB.id;
    userAId = userA.id;
    userBId = userB.id;
    childAId = (
      await tenantA.organizationUnits.create({
        name: "Security Child A",
        parentId: rootAId,
        type: "department",
      })
    ).id;
  });

  afterAll(async () => {
    if (prisma === undefined) return;
    await cleanFixtures();
    await prisma.$disconnect();
  });

  it("keeps privileged and publisher operations outside the tenant-safe root", () => {
    expect("PrismaClient" in TenantSafeDatabase).toBe(false);
    expect("createPlatformAuditWriter" in TenantSafeDatabase).toBe(false);
    expect("createPlatformDatabaseClient" in TenantSafeDatabase).toBe(false);
    expect(Object.keys(tenantA.outbox)).toEqual(["append"]);
    expect("markPublished" in tenantA.outbox).toBe(false);
    expect("recordFailure" in tenantA.outbox).toBe(false);
    expect("listAllTenants" in tenantA.outbox).toBe(false);
  });

  it("isolates TenantEntitlement reads, updates, creates, and hostile extra properties", async () => {
    const [listA, byId, byKey] = await Promise.all([
      tenantA.entitlements.list(),
      tenantA.entitlements.findById(entitlementBId),
      tenantA.entitlements.findByKey("module.security-b"),
    ]);
    expect(listA.map(({ id }) => id)).toContain(entitlementAId);
    expect(listA.map(({ id }) => id)).not.toContain(entitlementBId);
    expect(byId).toBeNull();
    expect(byKey).toBeNull();
    await expect(tenantA.entitlements.update(entitlementBId, { enabled: false })).rejects.toEqual(
      new TenantScopedRecordNotFoundError("TenantEntitlement"),
    );
    expect((await tenantB.entitlements.findById(entitlementBId))?.enabled).toBe(true);

    const hostile = {
      enabled: true,
      entitlementKey: "module.hostile-extra",
      source: "contract",
      tenant: { connect: { id: tenantBId } },
      tenantId: tenantBId,
    } as TenantEntitlementCreateData & { tenant: unknown; tenantId: string };
    const created = await tenantA.entitlements.create(hostile);
    expect(created.tenantId).toBe(tenantAId);
  });

  it("isolates OrganizationUnit lists, hierarchy, updates, creates, and cross-parent attempts", async () => {
    const [allA, rootsA, childrenA, childrenUsingBParent, crossRead] = await Promise.all([
      tenantA.organizationUnits.list(),
      tenantA.organizationUnits.listRoots(),
      tenantA.organizationUnits.listChildren(rootAId),
      tenantA.organizationUnits.listChildren(rootBId),
      tenantA.organizationUnits.findById(rootBId),
    ]);
    expect(allA.every(({ tenantId }) => tenantId === tenantAId)).toBe(true);
    expect(allA.map(({ id }) => id)).not.toContain(rootBId);
    expect(rootsA.map(({ id }) => id)).toContain(rootAId);
    expect(rootsA.map(({ id }) => id)).not.toContain(childAId);
    expect(childrenA.map(({ id }) => id)).toContain(childAId);
    expect(childrenUsingBParent).toEqual([]);
    expect(crossRead).toBeNull();
    await expect(
      tenantA.organizationUnits.update(rootBId, { name: "Must remain B" }),
    ).rejects.toEqual(new TenantScopedRecordNotFoundError("OrganizationUnit"));
    expect((await tenantB.organizationUnits.findById(rootBId))?.name).toBe("Security Root B");

    const hostile = {
      name: "Hostile unit remains A",
      tenant: { connect: { id: tenantBId } },
      tenantId: tenantBId,
      type: "branch",
    } as OrganizationUnitCreateData & { tenant: unknown; tenantId: string };
    expect((await tenantA.organizationUnits.create(hostile)).tenantId).toBe(tenantAId);
    await expect(
      tenantA.organizationUnits.create({
        name: "Invalid cross-tenant parent",
        parentId: rootBId,
        type: "department",
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("injects tenant into Outbox and Audit while preserving platform-only null audit", async () => {
    const hostileEvent = {
      aggregateId: tenantAId,
      aggregateType: "Tenant",
      eventType: "tenant.security.hostile",
      payload: { attemptedTenantId: tenantBId },
      tenantId: tenantBId,
    };
    const hostileAudit = {
      action: "tenant.security.hostile",
      actorType: "system",
      entityId: tenantAId,
      entityType: "Tenant",
      requestId: "e02-s04-tenant-hostile-audit",
      tenantId: tenantBId,
    };
    const [eventA, eventB, auditA, platformAudit] = await Promise.all([
      tenantA.outbox.append(hostileEvent),
      tenantB.outbox.append({
        aggregateId: tenantBId,
        aggregateType: "Tenant",
        eventType: "tenant.security.b",
        payload: {},
      }),
      tenantA.audit.append(hostileAudit),
      createPlatformAuditWriter(prisma).append({
        action: "platform.security.check",
        actorType: "system",
        entityId: "tenant-isolation",
        entityType: "SecuritySuite",
        requestId: `${platformRequestPrefix}${randomUUID()}`,
      }),
    ]);
    expect(eventA.tenantId).toBe(tenantAId);
    expect(eventB.tenantId).toBe(tenantBId);
    expect(auditA.tenantId).toBe(tenantAId);
    expect(platformAudit.tenantId).toBeNull();
    await expect(
      tenantA.audit.append({
        action: "tenant.security.cross-ou",
        actorType: "system",
        entityId: rootBId,
        entityType: "OrganizationUnit",
        organizationUnitId: rootBId,
        requestId: "e02-s04-cross-ou",
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("commits domain, organization unit, audit, and outbox with isolated parallel contexts", async () => {
    const commit = (tenantId: string, marker: string) =>
      withTenantTransaction(createTenantContext(tenantId), prisma, async (data) => {
        const entitlement = await data.entitlements.create({
          entitlementKey: `module.transaction-${marker}`,
          source: "contract",
        });
        const unit = await data.organizationUnits.create({
          name: `Transaction unit ${marker}`,
          type: "team",
        });
        const audit = await data.audit.append({
          action: "tenant.security.transaction",
          actorType: "system",
          entityId: entitlement.id,
          entityType: "TenantEntitlement",
          organizationUnitId: unit.id,
          requestId: `e02-s04-transaction-${marker}`,
        });
        const event = await data.outbox.append({
          aggregateId: entitlement.id,
          aggregateType: "TenantEntitlement",
          eventType: "tenant.security.transaction",
          payload: { marker },
        });
        return { audit, entitlement, event, unit };
      });
    const [resultA, resultB] = await Promise.all([commit(tenantAId, "a"), commit(tenantBId, "b")]);
    expect(Object.values(resultA).every(({ tenantId }) => tenantId === tenantAId)).toBe(true);
    expect(Object.values(resultB).every(({ tenantId }) => tenantId === tenantBId)).toBe(true);
  });

  it("rolls back every tenant-scoped component without affecting the other tenant", async () => {
    const key = "module.security-rollback-a";
    const beforeB = await prisma.tenantEntitlement.count({ where: { tenantId: tenantBId } });
    await expect(
      withTenantTransaction(createTenantContext(tenantAId), prisma, async (data) => {
        const entitlement = await data.entitlements.create({
          entitlementKey: key,
          source: "trial",
        });
        const unit = await data.organizationUnits.create({ name: "Rollback unit A", type: "team" });
        await data.audit.append({
          action: "tenant.security.rollback",
          actorType: "system",
          entityId: entitlement.id,
          entityType: "TenantEntitlement",
          organizationUnitId: unit.id,
          requestId: "e02-s04-rollback-a",
        });
        await data.outbox.append({
          aggregateId: entitlement.id,
          aggregateType: "TenantEntitlement",
          eventType: "tenant.security.rollback",
          payload: {},
        });
        throw new Error("intentional tenant isolation rollback");
      }),
    ).rejects.toThrow("intentional tenant isolation rollback");
    expect(await prisma.tenantEntitlement.count({ where: { entitlementKey: key } })).toBe(0);
    expect(await prisma.organizationUnit.count({ where: { name: "Rollback unit A" } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { requestId: "e02-s04-rollback-a" } })).toBe(0);
    expect(
      await prisma.domainEventOutbox.count({ where: { eventType: "tenant.security.rollback" } }),
    ).toBe(0);
    expect(await prisma.tenantEntitlement.count({ where: { tenantId: tenantBId } })).toBe(beforeB);
  });

  it("enforces every existing composite tenant foreign key", async () => {
    await expect(
      prisma.userSession.create({
        data: {
          expiresAt: new Date(Date.now() + 60_000),
          tenantId: tenantBId,
          tokenHash: binary(),
          userId: userAId,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.userPasswordResetToken.create({
        data: {
          expiresAt: new Date(Date.now() + 60_000),
          tenantId: tenantAId,
          tokenHash: binary(),
          userId: userBId,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.organizationUnit.create({
        data: { name: "Raw cross parent", parentId: rootBId, tenantId: tenantAId, type: "team" },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.auditLog.create({
        data: {
          action: "tenant.security.raw-cross-ou",
          actorType: "system",
          entityId: rootBId,
          entityType: "OrganizationUnit",
          organizationUnitId: rootBId,
          requestId: "e02-s04-raw-cross-ou",
          tenantId: tenantAId,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("keeps mixed concurrent reads and writes isolated on one Prisma client", async () => {
    const operations = Array.from({ length: 12 }, (_, index) => {
      const data = index % 2 === 0 ? tenantA : tenantB;
      const expectedTenantId = index % 2 === 0 ? tenantAId : tenantBId;
      return Promise.all([
        data.entitlements.list(),
        data.organizationUnits.create({ name: `Concurrent ${index}`, type: "other" }),
      ]).then(([entitlements, unit]) => ({ entitlements, expectedTenantId, unit }));
    });
    const results = await Promise.all(operations);
    expect(
      results.every(
        ({ entitlements, expectedTenantId, unit }) =>
          unit.tenantId === expectedTenantId &&
          entitlements.every(({ tenantId }) => tenantId === expectedTenantId),
      ),
    ).toBe(true);
  });

  it("isolates Role, UserRole, and RolePermission surfaces across tenants", async () => {
    const [roleA, roleB] = await Promise.all([
      tenantA.roles.createCustom({ key: "security-role", name: "Security Role A" }),
      tenantB.roles.createCustom({ key: "security-role", name: "Security Role B" }),
    ]);
    await Promise.all([
      tenantA.rolePermissions.grant(roleA.id, "channels.read"),
      tenantB.rolePermissions.grant(roleB.id, "channels.manage"),
    ]);
    await tenantA.userRoles.assign({ roleId: roleA.id, userId: userAId });

    expect(await tenantA.roles.findById(roleB.id)).toBeNull();
    expect(await tenantB.roles.findById(roleA.id)).toBeNull();
    await expect(tenantA.userRoles.assign({ roleId: roleB.id, userId: userAId })).rejects.toThrow(
      "Tenant-scoped Role was not found",
    );
    await expect(
      tenantA.userRoles.assign({
        organizationUnitId: rootBId,
        roleId: roleA.id,
        userId: userAId,
      }),
    ).rejects.toThrow("Tenant-scoped OrganizationUnit was not found");
    expect(await tenantA.permissions.resolveForUser(userAId)).toEqual(new Set(["channels.read"]));
    expect((await tenantA.permissions.resolveForUser(userAId)).has("channels.manage")).toBe(false);
  });
});
