import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { PERMISSION_CATALOG } from "@whatsapp-platform/rbac";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTenantContext,
  createTenantDataAccess,
  type TenantDataAccess,
  TenantRbacRecordNotFoundError,
  UnknownPermissionKeyError,
  withTenantTransaction,
} from "./index";
import { createPlatformDatabaseClient, type PrismaClient, syncPermissionCatalog } from "./platform";

const slugs = { a: "e02-s05-rbac-a", b: "e02-s05-rbac-b" } as const;
const unknownPermissionKey = "e02-s05.unknown";
let prisma: PrismaClient;
let tenantA: TenantDataAccess;
let tenantB: TenantDataAccess;
let tenantAId: string;
let tenantBId: string;
let userAId: string;
let userBId: string;
let unitAId: string;
let unitBId: string;
let roleAId: string;
let roleBId: string;

async function cleanFixtures(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { in: Object.values(slugs) } },
  });
  const tenantIds = tenants.map(({ id }) => id);
  if (tenantIds.length > 0) {
    await prisma.userRole.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: tenantIds } } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.userPasswordResetToken.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.userSession.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.role.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }
  await prisma.rolePermission.deleteMany({
    where: { permission: { key: unknownPermissionKey } },
  });
  await prisma.permission.deleteMany({ where: { key: unknownPermissionKey } });
  await prisma.role.deleteMany({ where: { key: "e02-s05-global-template", tenantId: null } });
}

describe.sequential("tenant RBAC foundation", () => {
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

    const [userA, userB, unitA, unitB] = await Promise.all([
      prisma.user.create({
        data: {
          displayName: "RBAC User A",
          email: "rbac@example.invalid",
          locale: "es-MX",
          passwordHash: "unused-rbac-test-hash-a",
          tenantId: tenantAId,
          timezone: "America/Mexico_City",
        },
      }),
      prisma.user.create({
        data: {
          displayName: "RBAC User B",
          email: "rbac@example.invalid",
          locale: "es-MX",
          passwordHash: "unused-rbac-test-hash-b",
          tenantId: tenantBId,
          timezone: "America/Mexico_City",
        },
      }),
      prisma.organizationUnit.create({
        data: { name: "RBAC Unit A", tenantId: tenantAId, type: "department" },
      }),
      prisma.organizationUnit.create({
        data: { name: "RBAC Unit B", tenantId: tenantBId, type: "department" },
      }),
    ]);
    userAId = userA.id;
    userBId = userB.id;
    unitAId = unitA.id;
    unitBId = unitB.id;
  });

  afterAll(async () => {
    if (prisma === undefined) return;
    await cleanFixtures();
    await prisma.$disconnect();
  });

  it("creates the four RBAC tables with UUIDv7, TIMESTAMPTZ(3), indexes, and composite FKs", async () => {
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('role', 'permission', 'user_role', 'role_permission')
      ORDER BY table_name
    `;
    expect(tables.map(({ table_name }) => table_name)).toEqual([
      "permission",
      "role",
      "role_permission",
      "user_role",
    ]);

    const idDefaults = await prisma.$queryRaw<
      Array<{ column_default: string; table_name: string }>
    >`
      SELECT table_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('role', 'permission', 'user_role')
        AND column_name = 'id'
      ORDER BY table_name
    `;
    expect(idDefaults).toHaveLength(3);
    expect(idDefaults.every(({ column_default }) => column_default.includes("uuidv7"))).toBe(true);

    const timestampColumns = await prisma.$queryRaw<
      Array<{ data_type: string; datetime_precision: number }>
    >`
      SELECT data_type, datetime_precision
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('role', 'permission', 'user_role', 'role_permission')
        AND column_name IN ('created_at', 'updated_at')
    `;
    expect(timestampColumns).toHaveLength(8);
    expect(
      timestampColumns.every(
        ({ data_type, datetime_precision }) =>
          data_type === "timestamp with time zone" && datetime_precision === 3,
      ),
    ).toBe(true);

    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname
      FROM pg_constraint
      WHERE conname IN (
        'user_role_tenant_id_user_id_fkey',
        'user_role_tenant_id_role_id_fkey',
        'user_role_tenant_id_organization_unit_id_fkey'
      )
      ORDER BY conname
    `;
    expect(constraints).toHaveLength(3);
    const tenantWideIndex = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'user_role_tenant_wide_assignment_key'
    `;
    expect(tenantWideIndex).toHaveLength(1);
  });

  it("synchronizes exactly 29 canonical permissions twice and preserves unknown rows", async () => {
    await prisma.permission.create({
      data: { description: "Must survive catalog sync", key: unknownPermissionKey },
    });
    await prisma.permission.update({
      data: { description: "stale" },
      where: { key: "channels.read" },
    });
    expect(await syncPermissionCatalog(prisma)).toEqual({ synchronized: 29 });
    expect(await syncPermissionCatalog(prisma)).toEqual({ synchronized: 29 });
    const canonical = await prisma.permission.findMany({
      orderBy: { key: "asc" },
      where: { key: { in: PERMISSION_CATALOG.map(({ key }) => key) } },
    });
    expect(canonical).toHaveLength(29);
    expect(new Set(canonical.map(({ key }) => key)).size).toBe(29);
    expect(canonical.find(({ key }) => key === "channels.read")?.description).toBe(
      "Read channel configuration",
    );
    expect(await prisma.permission.count({ where: { key: unknownPermissionKey } })).toBe(1);
  });

  it("creates custom roles tenant-scoped and rejects duplicate keys only within one tenant", async () => {
    const [roleA, roleB] = await Promise.all([
      tenantA.roles.createCustom({ key: "support", name: "Support A" }),
      tenantB.roles.createCustom({ key: "support", name: "Support B" }),
    ]);
    roleAId = roleA.id;
    roleBId = roleB.id;
    expect(roleA).toMatchObject({ isSystem: false, tenantId: tenantAId });
    expect(roleB).toMatchObject({ isSystem: false, tenantId: tenantBId });
    await expect(
      tenantA.roles.createCustom({ key: "support", name: "Duplicate Support A" }),
    ).rejects.toMatchObject({ code: "P2002" });

    const hostile = await tenantA.roles.createCustom({
      key: "hostile-input",
      name: "Hostile input",
      tenantId: tenantBId,
      isSystem: true,
    } as Parameters<typeof tenantA.roles.createCustom>[0]);
    expect(hostile).toMatchObject({ isSystem: false, tenantId: tenantAId });
    expect(await tenantA.roles.findById(roleBId)).toBeNull();
    expect(await tenantB.roles.findById(roleAId)).toBeNull();
    expect((await tenantA.roles.list()).every(({ tenantId }) => tenantId === tenantAId)).toBe(true);
  });

  it("assigns same-tenant User and OU idempotently and rejects cross-tenant/global roles", async () => {
    const assigned = await tenantA.userRoles.assign({ roleId: roleAId, userId: userAId });
    const duplicate = await tenantA.userRoles.assign({ roleId: roleAId, userId: userAId });
    expect(duplicate.id).toBe(assigned.id);
    const scoped = await tenantA.userRoles.assign({
      organizationUnitId: unitAId,
      roleId: roleAId,
      userId: userAId,
    });
    expect(scoped).toMatchObject({ organizationUnitId: unitAId, tenantId: tenantAId });

    await expect(
      tenantA.userRoles.assign({ roleId: roleBId, userId: userAId }),
    ).rejects.toBeInstanceOf(TenantRbacRecordNotFoundError);
    await expect(
      tenantA.userRoles.assign({ roleId: roleAId, userId: userBId }),
    ).rejects.toBeInstanceOf(TenantRbacRecordNotFoundError);
    await expect(
      tenantA.userRoles.assign({
        organizationUnitId: unitBId,
        roleId: roleAId,
        userId: userAId,
      }),
    ).rejects.toBeInstanceOf(TenantRbacRecordNotFoundError);

    const globalRole = await prisma.role.create({
      data: { isSystem: true, key: "e02-s05-global-template", name: "Global template" },
    });
    await expect(
      tenantA.userRoles.assign({ roleId: globalRole.id, userId: userAId }),
    ).rejects.toBeInstanceOf(TenantRbacRecordNotFoundError);
  });

  it("enforces User, Role, OU, and global-template assignment isolation in PostgreSQL", async () => {
    await expect(
      prisma.userRole.create({ data: { roleId: roleBId, tenantId: tenantAId, userId: userAId } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.userRole.create({ data: { roleId: roleAId, tenantId: tenantAId, userId: userBId } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.userRole.create({
        data: {
          organizationUnitId: unitBId,
          roleId: roleAId,
          tenantId: tenantAId,
          userId: userAId,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    const globalRole = await prisma.role.findFirstOrThrow({
      where: { key: "e02-s05-global-template", tenantId: null },
    });
    await expect(
      prisma.userRole.create({
        data: { roleId: globalRole.id, tenantId: tenantAId, userId: userAId },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.userRole.create({ data: { roleId: roleAId, tenantId: tenantAId, userId: userAId } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("grants canonically typed permissions idempotently and rejects cross-tenant roles", async () => {
    const first = await tenantA.rolePermissions.grant(roleAId, "channels.read");
    const second = await tenantA.rolePermissions.grant(roleAId, "channels.read");
    expect(second).toMatchObject({ permissionId: first.permissionId, roleId: first.roleId });
    expect(await tenantA.permissions.resolveForUser(userAId)).toEqual(new Set(["channels.read"]));
    await tenantB.rolePermissions.grant(roleBId, "audit.read");
    expect(await tenantA.permissions.resolveForUser(userAId)).toEqual(new Set(["channels.read"]));
    await expect(tenantA.rolePermissions.grant(roleBId, "channels.manage")).rejects.toBeInstanceOf(
      TenantRbacRecordNotFoundError,
    );
    await expect(
      tenantA.rolePermissions.grant(roleAId, unknownPermissionKey as "channels.read"),
    ).rejects.toBeInstanceOf(UnknownPermissionKeyError);
  });

  it("unions multiple roles and authorizes by permissions rather than role names", async () => {
    const [owner, viewer] = await Promise.all([
      tenantA.roles.createCustom({ key: "owner-test", name: "Owner" }),
      tenantA.roles.createCustom({ key: "viewer-test", name: "Viewer" }),
    ]);
    await tenantA.rolePermissions.grant(viewer.id, "audit.read");
    await Promise.all([
      tenantA.userRoles.assign({ roleId: owner.id, userId: userAId }),
      tenantA.userRoles.assign({ roleId: viewer.id, userId: userAId }),
    ]);
    const permissions = await tenantA.permissions.resolveForUser(userAId);
    expect(permissions.has("channels.read")).toBe(true);
    expect(permissions.has("audit.read")).toBe(true);
    expect(permissions.has("channels.manage")).toBe(false);
  });

  it("fails closed for OU-scoped assignments until a tenant-wide assignment exists", async () => {
    const role = await tenantA.roles.createCustom({ key: "sales", name: "Sales" });
    await tenantA.rolePermissions.grant(role.id, "channels.manage");
    await tenantA.userRoles.assign({
      organizationUnitId: unitAId,
      roleId: role.id,
      userId: userAId,
    });
    expect((await tenantA.permissions.resolveForUser(userAId)).has("channels.manage")).toBe(false);
    await tenantA.userRoles.assign({ roleId: role.id, userId: userAId });
    expect((await tenantA.permissions.resolveForUser(userAId)).has("channels.manage")).toBe(true);
  });

  it("fails closed for constrained and unknown permission rows", async () => {
    const role = await tenantA.roles.createCustom({ key: "constrained", name: "Constrained" });
    await tenantA.rolePermissions.grant(role.id, "quotes.approve", {
      scopeConstraints: { maximumAmount: 1000 },
    });
    await tenantA.userRoles.assign({ roleId: role.id, userId: userAId });
    expect((await tenantA.permissions.resolveForUser(userAId)).has("quotes.approve")).toBe(false);

    const unknown = await prisma.permission.findUniqueOrThrow({
      where: { key: unknownPermissionKey },
    });
    await prisma.rolePermission.create({ data: { permissionId: unknown.id, roleId: role.id } });
    const effective = await tenantA.permissions.resolveForUser(userAId);
    expect([...effective]).not.toContain(unknownPermissionKey);

    await tenantA.rolePermissions.grant(role.id, "quotes.approve");
    expect((await tenantA.permissions.resolveForUser(userAId)).has("quotes.approve")).toBe(true);
  });

  it("reflects permission and role revocation immediately without session snapshots", async () => {
    expect((await tenantA.permissions.resolveForUser(userAId)).has("channels.read")).toBe(true);
    expect(await tenantA.rolePermissions.revoke(roleAId, "channels.read")).toBe(true);
    expect((await tenantA.permissions.resolveForUser(userAId)).has("channels.read")).toBe(false);
    await tenantA.rolePermissions.grant(roleAId, "channels.read");
    expect((await tenantA.permissions.resolveForUser(userAId)).has("channels.read")).toBe(true);
    expect(await tenantA.userRoles.revoke({ roleId: roleAId, userId: userAId })).toBe(true);
    expect((await tenantA.permissions.resolveForUser(userAId)).has("channels.read")).toBe(false);
  });

  it("composes RBAC mutation and explicit actor audit in one tenant transaction", async () => {
    const role = await withTenantTransaction(
      createTenantContext(tenantAId),
      prisma,
      async (data) => {
        const created = await data.roles.createCustom({ key: "audited", name: "Audited" });
        await data.audit.append({
          action: "rbac.role.created",
          actorId: userAId,
          actorType: "tenant_user",
          afterSummary: { key: created.key, name: created.name },
          entityId: created.id,
          entityType: "Role",
          requestId: "e02-s05-audited-role",
        });
        return created;
      },
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: role.id, requestId: "e02-s05-audited-role" },
    });
    expect(audit).toMatchObject({ actorId: userAId, tenantId: tenantAId });
  });
});
