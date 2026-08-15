import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createOrganizationUnitManager,
  ORGANIZATION_UNIT_MAX_DEPTH,
  OrganizationUnitCompanyTypeReservedError,
  OrganizationUnitCycleError,
  OrganizationUnitDepthError,
  OrganizationUnitLimitReachedError,
  type OrganizationUnitManager,
  type OrganizationUnitManagerDatabase,
  OrganizationUnitNotFoundError,
  OrganizationUnitParentNotFoundError,
  OrganizationUnitRootInvariantError,
} from "./organization-unit-manager";
import { createPlatformDatabaseClient, Prisma, type PrismaClient } from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e04-s03-ou";
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";
let tenantCId = "";
let rootAId = "";
let rootBId = "";
let rootCId = "";
let manager: OrganizationUnitManager;

const metadata = { actorUserId: "user-e04-s03", requestId: `${prefix}-op` };

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

async function createRoot(tenantId: string, name: string): Promise<string> {
  const root = await prisma.organizationUnit.create({
    data: { name, tenantId, type: "company" },
  });
  return root.id;
}

function failingOutboxDatabase(): OrganizationUnitManagerDatabase {
  return {
    organizationUnit: prisma.organizationUnit,
    tenantEntitlement: prisma.tenantEntitlement,
    $transaction: ((callback: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
      prisma.$transaction((transaction) =>
        callback(
          new Proxy(transaction, {
            get(target, property, receiver) {
              if (property === "domainEventOutbox") {
                return { create: async () => Promise.reject(new Error("forced outbox failure")) };
              }
              return Reflect.get(target, property, receiver);
            },
          }),
        ),
      )) as OrganizationUnitManagerDatabase["$transaction"],
  };
}

async function unitCount(tenantId: string): Promise<number> {
  return prisma.organizationUnit.count({ where: { tenantId } });
}

async function clearNonRootUnits(tenantId: string, rootId: string): Promise<void> {
  await prisma.auditLog.deleteMany({
    where: { tenantId, organizationUnitId: { not: rootId } },
  });
  await prisma.organizationUnit.deleteMany({
    where: { tenantId, id: { not: rootId } },
  });
}

describe.sequential("Organization unit manager", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    const [tenantA, tenantB, tenantC] = await Promise.all(
      ["a", "b", "c"].map((marker) =>
        prisma.tenant.create({
          data: {
            defaultCurrency: "MXN",
            defaultLocale: "es-MX",
            defaultTimezone: "America/Mexico_City",
            displayName: `Organization Units ${marker}`,
            legalName: `Organization Units ${marker}`,
            slug: `${prefix}-${marker}`,
            status: "active",
          },
        }),
      ),
    );
    if (tenantA === undefined || tenantB === undefined || tenantC === undefined) {
      throw new Error("Fixture failure");
    }
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    tenantCId = tenantC.id;
    rootAId = await createRoot(tenantAId, "Tenant A Company");
    rootBId = await createRoot(tenantBId, "Tenant B Company");
    rootCId = await createRoot(tenantCId, "Tenant C Company");
    manager = createOrganizationUnitManager(prisma);
  });

  afterAll(async () => {
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("lists the structural root with unlimited usage when no limit row exists", async () => {
    const page = await manager.list(createTenantContext(tenantAId));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: rootAId,
      parentId: null,
      type: "company",
      name: "Tenant A Company",
      active: true,
    });
    expect(page.usage).toEqual({ used: 1, limit: null });
  });

  it("creates a child unit atomically with audit and outbox events", async () => {
    const created = await manager.create(
      createTenantContext(tenantAId),
      {
        code: "SALES",
        name: "Ventas",
        parentId: rootAId,
        timezone: "America/Mexico_City",
        type: "department",
      },
      metadata,
    );
    expect(created).toMatchObject({
      parentId: rootAId,
      type: "department",
      name: "Ventas",
      code: "SALES",
      timezone: "America/Mexico_City",
      active: true,
    });
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const audit = await prisma.auditLog.findFirst({
      orderBy: { occurredAt: "desc" },
      where: { tenantId: tenantAId, action: "organization_unit.created" },
    });
    expect(audit).toMatchObject({
      actorId: "user-e04-s03",
      actorType: "tenant_user",
      entityId: created.id,
      entityType: "OrganizationUnit",
      organizationUnitId: created.id,
      requestId: `${prefix}-op`,
      beforeSummary: null,
    });
    expect(audit?.afterSummary).toMatchObject({
      name: "Ventas",
      type: "department",
      parentId: rootAId,
      code: "SALES",
      timezone: "America/Mexico_City",
      active: true,
    });
    expect(JSON.stringify(audit?.afterSummary)).not.toMatch(/tenantId|settings|address/i);

    const outbox = await prisma.domainEventOutbox.findFirst({
      orderBy: { occurredAt: "desc" },
      where: { tenantId: tenantAId, eventType: "organization_unit.created" },
    });
    expect(outbox).toMatchObject({
      aggregateId: created.id,
      aggregateType: "OrganizationUnit",
      eventType: "organization_unit.created",
    });
    expect(outbox?.payload).toMatchObject({
      unitId: created.id,
      parentId: rootAId,
      type: "department",
      active: true,
    });
  });

  it("rejects a company type child and a missing or foreign parent", async () => {
    const context = createTenantContext(tenantAId);
    await expect(
      manager.create(context, { name: "Holding", parentId: rootAId, type: "company" }, metadata),
    ).rejects.toBeInstanceOf(OrganizationUnitCompanyTypeReservedError);
    await expect(
      manager.create(
        context,
        { name: "Missing", parentId: "01989f20-0007-7000-8000-000000000001", type: "branch" },
        metadata,
      ),
    ).rejects.toBeInstanceOf(OrganizationUnitParentNotFoundError);
    await expect(
      manager.create(context, { name: "Foreign", parentId: rootBId, type: "branch" }, metadata),
    ).rejects.toBeInstanceOf(OrganizationUnitParentNotFoundError);
  });

  it("updates a child unit with before and after audit summaries", async () => {
    const created = await manager.create(
      createTenantContext(tenantAId),
      { name: "Sucursal Norte", parentId: rootAId, type: "branch" },
      { actorUserId: "user-e04-s03", requestId: `${prefix}-update` },
    );
    const updated = await manager.update(
      createTenantContext(tenantAId),
      created.id,
      { code: "NTE", name: "Sucursal Norte Renovada" },
      { actorUserId: "user-e04-s03", requestId: `${prefix}-update` },
    );
    expect(updated).toMatchObject({
      id: created.id,
      name: "Sucursal Norte Renovada",
      code: "NTE",
      parentId: rootAId,
    });

    const audit = await prisma.auditLog.findFirst({
      orderBy: { occurredAt: "desc" },
      where: { tenantId: tenantAId, action: "organization_unit.updated", entityId: created.id },
    });
    expect(audit?.beforeSummary).toMatchObject({ name: "Sucursal Norte", code: null });
    expect(audit?.afterSummary).toMatchObject({ name: "Sucursal Norte Renovada", code: "NTE" });

    const outbox = await prisma.domainEventOutbox.findFirst({
      orderBy: { occurredAt: "desc" },
      where: { tenantId: tenantAId, eventType: "organization_unit.updated" },
    });
    expect(outbox?.aggregateId).toBe(created.id);
    expect(outbox?.payload).toMatchObject({
      unitId: created.id,
      parentId: rootAId,
      type: "branch",
      active: true,
    });
  });

  it("keeps the structural root immutable for moves, deactivation and retyping", async () => {
    const context = createTenantContext(tenantAId);
    await expect(
      manager.update(
        context,
        rootAId,
        { parentId: "01989f20-0007-7000-8000-000000000002" },
        metadata,
      ),
    ).rejects.toBeInstanceOf(OrganizationUnitRootInvariantError);
    await expect(
      manager.update(context, rootAId, { active: false }, metadata),
    ).rejects.toBeInstanceOf(OrganizationUnitRootInvariantError);
    await expect(
      manager.update(context, rootAId, { type: "other" }, metadata),
    ).rejects.toBeInstanceOf(OrganizationUnitRootInvariantError);

    const renamed = await manager.update(context, rootAId, { name: "Tenant A Renamed" }, metadata);
    expect(renamed.name).toBe("Tenant A Renamed");
  });

  it("prevents self and descendant cycles without corrupting the tree", async () => {
    const context = createTenantContext(tenantAId);
    const level1 = await manager.create(
      context,
      { name: "Operaciones", parentId: rootAId, type: "department" },
      metadata,
    );
    const level2 = await manager.create(
      context,
      { name: "Mesa de ayuda", parentId: level1.id, type: "team" },
      metadata,
    );
    const level3 = await manager.create(
      context,
      { name: "Turno nocturno", parentId: level2.id, type: "team" },
      metadata,
    );
    await expect(
      manager.update(context, level2.id, { parentId: level2.id }, metadata),
    ).rejects.toBeInstanceOf(OrganizationUnitCycleError);
    await expect(
      manager.update(context, level1.id, { parentId: level3.id }, metadata),
    ).rejects.toBeInstanceOf(OrganizationUnitCycleError);
    await expect(
      manager.update(context, level2.id, { parentId: level3.id }, metadata),
    ).rejects.toBeInstanceOf(OrganizationUnitCycleError);

    const stored = await prisma.organizationUnit.findUnique({ where: { id: level2.id } });
    expect(stored?.parentId).toBe(level1.id);
    const storedRoot = await prisma.organizationUnit.findUnique({ where: { id: level1.id } });
    expect(storedRoot?.parentId).toBe(rootAId);
  });

  it("enforces the maximum hierarchy depth", async () => {
    const context = createTenantContext(tenantBId);
    let parent = rootBId;
    for (let depth = 1; depth <= ORGANIZATION_UNIT_MAX_DEPTH; depth += 1) {
      const unit = await manager.create(
        context,
        { name: `Depth ${depth}`, parentId: parent, type: "department" },
        metadata,
      );
      parent = unit.id;
    }
    await expect(
      manager.create(context, { name: "Too deep", parentId: parent, type: "department" }, metadata),
    ).rejects.toBeInstanceOf(OrganizationUnitDepthError);
  });

  it("rejects moving a subtree whose deepest descendant would exceed the maximum depth", async () => {
    const context = createTenantContext(tenantCId);
    await clearNonRootUnits(tenantCId, rootCId);
    let deepParent = rootCId;
    for (let depth = 1; depth <= ORGANIZATION_UNIT_MAX_DEPTH - 2; depth += 1) {
      const unit = await manager.create(
        context,
        { name: `Subtree Chain ${depth}`, parentId: deepParent, type: "department" },
        metadata,
      );
      deepParent = unit.id;
    }
    const s = await manager.create(
      context,
      { name: "Subtree S", parentId: rootCId, type: "branch" },
      metadata,
    );
    const c = await manager.create(
      context,
      { name: "Subtree C", parentId: s.id, type: "branch" },
      metadata,
    );
    const g = await manager.create(
      context,
      { name: "Subtree G", parentId: c.id, type: "branch" },
      metadata,
    );
    await expect(
      manager.update(context, s.id, { parentId: deepParent }, metadata),
    ).rejects.toBeInstanceOf(OrganizationUnitDepthError);

    const storedS = await prisma.organizationUnit.findUnique({ where: { id: s.id } });
    const storedC = await prisma.organizationUnit.findUnique({ where: { id: c.id } });
    const storedG = await prisma.organizationUnit.findUnique({ where: { id: g.id } });
    expect(storedS?.parentId).toBe(rootCId);
    expect(storedC?.parentId).toBe(s.id);
    expect(storedG?.parentId).toBe(c.id);
    expect(
      await prisma.auditLog.count({
        where: { tenantId: tenantCId, action: "organization_unit.updated", entityId: s.id },
      }),
    ).toBe(0);
    expect(
      await prisma.domainEventOutbox.count({
        where: { tenantId: tenantCId, eventType: "organization_unit.updated", aggregateId: s.id },
      }),
    ).toBe(0);
  });

  it("allows moving a subtree whose deepest descendant lands exactly at the maximum depth", async () => {
    const context = createTenantContext(tenantCId);
    await clearNonRootUnits(tenantCId, rootCId);
    let deepParent = rootCId;
    for (let depth = 1; depth <= ORGANIZATION_UNIT_MAX_DEPTH - 2; depth += 1) {
      const unit = await manager.create(
        context,
        { name: `Boundary Chain ${depth}`, parentId: deepParent, type: "department" },
        metadata,
      );
      deepParent = unit.id;
    }
    const s = await manager.create(
      context,
      { name: "Boundary S", parentId: rootCId, type: "branch" },
      metadata,
    );
    const c = await manager.create(
      context,
      { name: "Boundary C", parentId: s.id, type: "branch" },
      metadata,
    );
    const moved = await manager.update(context, s.id, { parentId: deepParent }, metadata);
    expect(moved.parentId).toBe(deepParent);
    const storedS = await prisma.organizationUnit.findUnique({ where: { id: s.id } });
    const storedC = await prisma.organizationUnit.findUnique({ where: { id: c.id } });
    expect(storedS?.parentId).toBe(deepParent);
    expect(storedC?.parentId).toBe(s.id);
  });

  it("enforces an effective organization unit limit counting the root", async () => {
    const context = createTenantContext(tenantBId);
    await clearNonRootUnits(tenantBId, rootBId);
    await prisma.tenantEntitlement.create({
      data: {
        enabled: true,
        entitlementKey: "limit.organization_units",
        limitValue: 3,
        source: "contract",
        tenantId: tenantBId,
      },
    });
    const first = await manager.create(
      context,
      { name: "Limited One", parentId: rootBId, type: "branch" },
      metadata,
    );
    const second = await manager.create(
      context,
      { name: "Limited Two", parentId: rootBId, type: "branch" },
      metadata,
    );
    expect((await manager.list(context)).usage).toEqual({ used: 3, limit: "3" });
    await expect(
      manager.create(
        context,
        { name: "Limited Three", parentId: rootBId, type: "branch" },
        metadata,
      ),
    ).rejects.toBeInstanceOf(OrganizationUnitLimitReachedError);

    await prisma.tenantEntitlement.update({
      data: { enabled: false },
      where: {
        tenantId_entitlementKey: {
          entitlementKey: "limit.organization_units",
          tenantId: tenantBId,
        },
      },
    });
    const afterDisable = await manager.create(
      context,
      { name: "After Disable", parentId: rootBId, type: "branch" },
      metadata,
    );
    expect(afterDisable.name).toBe("After Disable");
    expect(first.name).toBe("Limited One");
    expect(second.name).toBe("Limited Two");
  });

  it("rejects the next unit when the effective limit is fractional", async () => {
    const context = createTenantContext(tenantBId);
    await clearNonRootUnits(tenantBId, rootBId);
    await prisma.tenantEntitlement.update({
      data: { enabled: true, limitValue: new Prisma.Decimal("3.5") },
      where: {
        tenantId_entitlementKey: {
          entitlementKey: "limit.organization_units",
          tenantId: tenantBId,
        },
      },
    });
    await manager.create(
      context,
      { name: "Half One", parentId: rootBId, type: "branch" },
      metadata,
    );
    await manager.create(
      context,
      { name: "Half Two", parentId: rootBId, type: "branch" },
      metadata,
    );
    expect((await manager.list(context)).usage).toEqual({ used: 3, limit: "3.5" });
    await expect(
      manager.create(context, { name: "Half Three", parentId: rootBId, type: "branch" }, metadata),
    ).rejects.toBeInstanceOf(OrganizationUnitLimitReachedError);
  });

  it("keeps units strictly isolated between tenants", async () => {
    const contextA = createTenantContext(tenantAId);
    const contextB = createTenantContext(tenantBId);
    const pageA = await manager.list(contextA);
    expect(pageA.items.some(({ parentId }) => parentId === rootBId)).toBe(false);

    await expect(
      manager.update(contextA, rootBId, { name: "Hijack" }, metadata),
    ).rejects.toBeInstanceOf(OrganizationUnitNotFoundError);
    const foreign = pageA.items[0];
    await expect(
      manager.update(contextB, foreign?.id ?? "", { name: "Hijack" }, metadata),
    ).rejects.toBeInstanceOf(OrganizationUnitNotFoundError);
    await expect(
      manager.update(contextB, rootBId, { name: "Tenant B Renamed" }, metadata),
    ).resolves.toMatchObject({ name: "Tenant B Renamed" });
  });

  it("serializes concurrent creations with the advisory lock, enforcing the limit exactly once", async () => {
    const context = createTenantContext(tenantAId);
    await clearNonRootUnits(tenantAId, rootAId);
    await prisma.tenantEntitlement.create({
      data: {
        enabled: true,
        entitlementKey: "limit.organization_units",
        limitValue: new Prisma.Decimal(5),
        source: "contract",
        tenantId: tenantAId,
      },
    });
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        manager.create(
          context,
          { name: `Race ${index}`, parentId: rootAId, type: "branch" },
          { actorUserId: "user-e04-s03", requestId: `${prefix}-race-${index}` },
        ),
      ),
    );
    const fulfilled = attempts.filter(({ status }) => status === "fulfilled").length;
    const rejected = attempts.filter(({ status }) => status === "rejected");
    expect(fulfilled).toBe(4);
    expect(rejected.length).toBe(4);
    for (const result of rejected) {
      expect(result.status === "rejected" && result.reason).toBeInstanceOf(
        OrganizationUnitLimitReachedError,
      );
    }
    const page = await manager.list(context);
    expect(page.usage.used).toBe(5);
    expect(page.usage.limit).toBe("5");
  });

  it("rolls back the unit and audit when the outbox write fails", async () => {
    await prisma.tenantEntitlement.deleteMany({
      where: { tenantId: tenantAId, entitlementKey: "limit.organization_units" },
    });
    const before = await unitCount(tenantAId);
    const failingManager = createOrganizationUnitManager(failingOutboxDatabase());
    await expect(
      failingManager.create(
        createTenantContext(tenantAId),
        { name: "Rollback Unit", parentId: rootAId, type: "branch" },
        metadata,
      ),
    ).rejects.toThrow("forced outbox failure");
    expect(await unitCount(tenantAId)).toBe(before);
    const rollbackAudit = await prisma.auditLog.findMany({
      where: { tenantId: tenantAId, action: "organization_unit.created" },
    });
    expect(
      rollbackAudit.some(
        ({ afterSummary }) => (afterSummary as { name?: unknown }).name === "Rollback Unit",
      ),
    ).toBe(false);
  });
});
