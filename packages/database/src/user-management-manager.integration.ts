import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";
import { createTenantContext } from "./tenant-context";
import { createTenantDataAccess } from "./tenant-data-access";
import {
  createUserManagementManager,
  DuplicateRoleAssignmentError,
  LastOwnerRequiredError,
  OwnerRoleReadOnlyError,
  UserEmailConflictError,
  UserEmailInvalidError,
  UserLimitReachedError,
  type UserManagementManager,
  type UserManagementManagerDatabase,
  UserNotFoundError,
  UserRoleNotFoundError,
  UserScopeUnitNotFoundError,
} from "./user-management-manager";

const prefix = "e04-s04-um";
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";
let tenantCId = "";
let ownerAId = "";
let ownerBId = "";
let ownerCId = "";
let rootBId = "";
let roleAgentAId = "";
let roleOwnerAId = "";
let roleViewerAId = "";
let roleAgentBId = "";
let branchAId = "";
let manager: UserManagementManager;

const metadata = { actorUserId: "user-e04-s04", requestId: `${prefix}-op` };

const FAKE_HASH = "$argon2id$test-hash-not-reversible";

function requiredRoleId(roleId: string | undefined, roleName: string): string {
  if (roleId === undefined) throw new Error(`Missing ${roleName} role`);
  return roleId;
}

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.userSession.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userPasswordResetToken.deleteMany({ where: { tenantId: { in: ids } } });
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

async function provisionTenant(
  marker: string,
): Promise<{ ownerId: string; rootId: string; tenantId: string } & Record<string, string>> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `User Management ${marker}`,
    enabledModules: [],
    legalName: `User Management ${marker} SA`,
    limits: {
      channelAccounts: 2,
      monthlyAiBudget: null,
      organizationUnits: 5,
      storageBytes: 1_073_741_824,
      users: 5,
    },
    owner: {
      displayName: `Owner ${marker}`,
      email: `${prefix}-owner-${marker}@example.invalid`,
      locale: "es-MX",
      passwordHash: FAKE_HASH,
      timezone: "America/Mexico_City",
    },
    requestId: `${prefix}-provision-${marker}`,
    slug: `${prefix}-${marker}`,
  });
  const roles = await prisma.role.findMany({ where: { tenantId: result.tenant.id } });
  const roleIds = Object.fromEntries(
    roles.map((role) => [`role${role.name}Id`, role.id]),
  ) as Record<string, string>;
  return {
    ownerId: result.owner.id,
    rootId: result.organizationRoot.id,
    tenantId: result.tenant.id,
    ...roleIds,
  };
}

async function setUserLimit(tenantId: string, limitValue: string | number): Promise<void> {
  await prisma.tenantEntitlement.update({
    data: { enabled: true, limitValue: String(limitValue) },
    where: {
      tenantId_entitlementKey: { entitlementKey: "limit.users", tenantId },
    },
  });
}

async function resetTenantC(limitValue: string | number): Promise<void> {
  await prisma.user.updateMany({
    data: { status: "disabled" },
    where: { id: { not: ownerCId }, status: "active", tenantId: tenantCId },
  });
  await setUserLimit(tenantCId, limitValue);
}

function failingOutboxDatabase(): UserManagementManagerDatabase {
  return {
    auditLog: prisma.auditLog,
    domainEventOutbox: prisma.domainEventOutbox,
    organizationUnit: prisma.organizationUnit,
    permission: prisma.permission,
    role: prisma.role,
    rolePermission: prisma.rolePermission,
    tenant: prisma.tenant,
    tenantEntitlement: prisma.tenantEntitlement,
    user: prisma.user,
    userPasswordResetToken: prisma.userPasswordResetToken,
    userRole: prisma.userRole,
    userSession: prisma.userSession,
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
      )) as UserManagementManagerDatabase["$transaction"],
  };
}

function createInput(
  email: string,
  roleAssignments: readonly { roleId: string; organizationUnitId: string | null }[],
) {
  return { displayName: `User ${email}`, email, passwordHash: FAKE_HASH, roleAssignments };
}

describe.sequential("User management manager", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await syncPermissionCatalog(prisma);
    await cleanup();
    const [a, b, c] = await Promise.all([
      provisionTenant("a"),
      provisionTenant("b"),
      provisionTenant("c"),
    ]);
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
    tenantCId = c.tenantId;
    ownerAId = a.ownerId;
    ownerBId = b.ownerId;
    ownerCId = c.ownerId;
    rootBId = b.rootId;
    roleAgentAId = requiredRoleId(a.roleAgentId, "Agent");
    roleOwnerAId = requiredRoleId(a.roleOwnerId, "Owner");
    roleViewerAId = requiredRoleId(a.roleViewerId, "Viewer");
    roleAgentBId = requiredRoleId(b.roleAgentId, "Agent");
    await Promise.all([setUserLimit(tenantAId, 20), setUserLimit(tenantBId, 20)]);
    const branch = await prisma.organizationUnit.create({
      data: { active: true, name: "León", parentId: a.rootId, tenantId: tenantAId, type: "branch" },
    });
    branchAId = branch.id;
    manager = createUserManagementManager(prisma);
  });

  afterAll(async () => {
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("creates a tenant-scoped active user with defaults, hash and assignments", async () => {
    const context = createTenantContext(tenantAId);
    const created = await manager.create(
      context,
      createInput("alice@example.invalid", [{ roleId: roleAgentAId, organizationUnitId: null }]),
      metadata,
    );
    expect(created.status).toBe("active");
    expect(created.email).toBe("alice@example.invalid");
    expect(created.roleAssignments).toEqual([
      { organizationUnit: null, role: { id: roleAgentAId, key: "agent", name: "Agent" } },
    ]);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.tenantId).toBe(tenantAId);
    expect(stored.passwordHash).not.toContain("plaintext");
    expect(stored.mfaState).toBe("disabled");
    expect(stored.locale).toBe("es-MX");
    expect(stored.timezone).toBe("America/Mexico_City");
    expect("passwordHash" in created).toBe(false);
    const audit = await prisma.auditLog.findFirst({
      orderBy: { occurredAt: "desc" },
      where: { tenantId: tenantAId, action: "user.created", entityId: created.id },
    });
    expect(audit?.afterSummary).toEqual({ displayName: created.displayName, status: "active" });
    expect(
      await prisma.domainEventOutbox.count({
        where: { aggregateId: created.id, eventType: "user.created", tenantId: tenantAId },
      }),
    ).toBe(1);
  });

  it("rejects emails that are not normalized and duplicated emails in the same tenant", async () => {
    const context = createTenantContext(tenantAId);
    await expect(
      manager.create(
        context,
        createInput("  UPPER@example.invalid ", [
          { roleId: roleAgentAId, organizationUnitId: null },
        ]),
        metadata,
      ),
    ).rejects.toBeInstanceOf(UserEmailInvalidError);
    await expect(
      manager.create(
        context,
        createInput("alice@example.invalid", [{ roleId: roleAgentAId, organizationUnitId: null }]),
        metadata,
      ),
    ).rejects.toBeInstanceOf(UserEmailConflictError);
  });

  it("allows the same email in a different tenant", async () => {
    const created = await manager.create(
      createTenantContext(tenantBId),
      createInput("alice@example.invalid", [{ roleId: roleAgentBId, organizationUnitId: null }]),
      metadata,
    );
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.tenantId).toBe(tenantBId);
  });

  it("lists users with active-seat usage and never reveals another tenant", async () => {
    const page = await manager.list(createTenantContext(tenantAId), {
      page: 1,
      pageSize: 10,
    });
    expect(page.items.every(({ id }) => id !== ownerBId)).toBe(true);
    expect(page.total).toBe(2);
    expect(page.usage).toEqual({ used: 2, limit: "20.0000" });
    const filtered = await manager.list(createTenantContext(tenantAId), {
      page: 1,
      pageSize: 10,
      search: "alice",
    });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]?.email).toBe("alice@example.invalid");
  });

  it("supports tenant-wide and organization-unit scoped assignments", async () => {
    const context = createTenantContext(tenantAId);
    const created = await manager.create(
      context,
      createInput("scoped@example.invalid", [
        { roleId: roleAgentAId, organizationUnitId: branchAId },
        { roleId: roleViewerAId, organizationUnitId: null },
      ]),
      metadata,
    );
    const assignments = await prisma.userRole.findMany({
      where: { tenantId: tenantAId, userId: created.id },
    });
    expect(assignments).toHaveLength(2);
    const scoped = assignments.find(({ organizationUnitId }) => organizationUnitId === branchAId);
    const wide = assignments.find(({ organizationUnitId }) => organizationUnitId === null);
    expect(scoped?.roleId).toBe(roleAgentAId);
    expect(wide?.roleId).toBe(roleViewerAId);
  });

  it("rejects duplicate assignments and cross-tenant roles or units", async () => {
    const context = createTenantContext(tenantAId);
    await expect(
      manager.create(
        context,
        createInput("dupes@example.invalid", [
          { roleId: roleAgentAId, organizationUnitId: null },
          { roleId: roleAgentAId, organizationUnitId: null },
        ]),
        metadata,
      ),
    ).rejects.toBeInstanceOf(DuplicateRoleAssignmentError);
    await expect(
      manager.create(
        context,
        createInput("cross-role@example.invalid", [
          { roleId: roleAgentAId, organizationUnitId: null },
          { roleId: roleAgentBId, organizationUnitId: null },
        ]),
        metadata,
      ),
    ).rejects.toBeInstanceOf(UserRoleNotFoundError);
    await expect(
      manager.create(
        context,
        createInput("cross-unit@example.invalid", [
          { roleId: roleAgentAId, organizationUnitId: rootBId },
        ]),
        metadata,
      ),
    ).rejects.toBeInstanceOf(UserScopeUnitNotFoundError);
  });

  it("rejects cross-tenant user mutations with not-found", async () => {
    const contextA = createTenantContext(tenantAId);
    await expect(
      manager.updateStatus(contextA, ownerBId, { status: "disabled" }, metadata),
    ).rejects.toBeInstanceOf(UserNotFoundError);
    await expect(
      manager.replaceRoleAssignments(contextA, ownerBId, [], metadata),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it("enforces the active-seat limit with exact fractional decimals", async () => {
    const context = createTenantContext(tenantCId);
    await setUserLimit(tenantCId, "3.5");
    const first = await manager.create(context, createInput("frac@example.invalid", []), metadata);
    const second = await manager.create(
      context,
      createInput("frac2@example.invalid", []),
      metadata,
    );
    expect((await manager.list(context, { page: 1, pageSize: 10 })).usage).toEqual({
      used: 3,
      limit: "3.5000",
    });
    await expect(
      manager.create(context, createInput("frac3@example.invalid", []), metadata),
    ).rejects.toBeInstanceOf(UserLimitReachedError);
    expect(first.id).not.toBe(second.id);
    await prisma.tenantEntitlement.update({
      data: { enabled: false },
      where: { tenantId_entitlementKey: { entitlementKey: "limit.users", tenantId: tenantCId } },
    });
  });

  it("frees a seat on disable and consumes it again on reactivate", async () => {
    const context = createTenantContext(tenantCId);
    await resetTenantC("2");
    const created = await manager.create(
      context,
      createInput("cycle@example.invalid", []),
      metadata,
    );
    const disabled = await manager.updateStatus(
      context,
      created.id,
      { status: "disabled" },
      metadata,
    );
    expect(disabled.changed).toBe(true);
    expect((await manager.list(context, { page: 1, pageSize: 10 })).usage).toEqual({
      used: 1,
      limit: "2.0000",
    });
    const reactivated = await manager.updateStatus(
      context,
      created.id,
      { status: "active" },
      metadata,
    );
    expect(reactivated.changed).toBe(true);
    expect((await manager.list(context, { page: 1, pageSize: 10 })).usage).toEqual({
      used: 2,
      limit: "2.0000",
    });
  });

  it("revokes sessions and pending reset tokens on disable without reviving sessions", async () => {
    const context = createTenantContext(tenantCId);
    await resetTenantC("3");
    const created = await manager.create(
      context,
      createInput("revoke@example.invalid", []),
      metadata,
    );
    const session = await prisma.userSession.create({
      data: {
        expiresAt: new Date(Date.now() + 60_000),
        tenantId: tenantCId,
        tokenHash: Buffer.from(`token-${created.id}`),
        userId: created.id,
      },
    });
    const reset = await prisma.userPasswordResetToken.create({
      data: {
        expiresAt: new Date(Date.now() + 60_000),
        tenantId: tenantCId,
        tokenHash: Buffer.from(`reset-${created.id}`),
        userId: created.id,
      },
    });
    await manager.updateStatus(context, created.id, { status: "disabled" }, metadata);
    const storedSession = await prisma.userSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(storedSession.revokedAt).not.toBeNull();
    const storedReset = await prisma.userPasswordResetToken.findUniqueOrThrow({
      where: { id: reset.id },
    });
    expect(storedReset.revokedAt).not.toBeNull();
    await manager.updateStatus(context, created.id, { status: "active" }, metadata);
    const after = await prisma.userSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.revokedAt).not.toBeNull();
  });

  it("is idempotent for repeated disable and reactivate calls", async () => {
    const context = createTenantContext(tenantCId);
    await resetTenantC("3");
    const created = await manager.create(
      context,
      createInput("idem@example.invalid", []),
      metadata,
    );
    const first = await manager.updateStatus(context, created.id, { status: "disabled" }, metadata);
    const second = await manager.updateStatus(
      context,
      created.id,
      { status: "disabled" },
      metadata,
    );
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(
      await prisma.auditLog.count({
        where: { action: "user.disabled", entityId: created.id, tenantId: tenantCId },
      }),
    ).toBe(1);
    await manager.updateStatus(context, created.id, { status: "active" }, metadata);
    const again = await manager.updateStatus(context, created.id, { status: "active" }, metadata);
    expect(again.changed).toBe(false);
    expect(
      await prisma.auditLog.count({
        where: { action: "user.reactivated", entityId: created.id, tenantId: tenantCId },
      }),
    ).toBe(1);
  });

  it("protects the last active tenant-wide owner from disable and assignment removal", async () => {
    const context = createTenantContext(tenantAId);
    await expect(
      manager.updateStatus(context, ownerAId, { status: "disabled" }, metadata),
    ).rejects.toBeInstanceOf(LastOwnerRequiredError);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: ownerAId } });
    expect(stored.status).toBe("active");
    await expect(
      manager.replaceRoleAssignments(context, ownerAId, [], metadata),
    ).rejects.toBeInstanceOf(LastOwnerRequiredError);
    const ownerAssignments = await prisma.userRole.count({
      where: { tenantId: tenantAId, userId: ownerAId },
    });
    expect(ownerAssignments).toBe(1);
  });

  it("allows disabling one owner when another tenant-wide owner exists", async () => {
    const context = createTenantContext(tenantAId);
    const secondOwner = await manager.create(
      context,
      createInput("second-owner@example.invalid", [
        { roleId: roleOwnerAId, organizationUnitId: null },
      ]),
      metadata,
    );
    const result = await manager.updateStatus(
      context,
      secondOwner.id,
      { status: "disabled" },
      metadata,
    );
    expect(result.changed).toBe(true);
    await manager.updateStatus(context, secondOwner.id, { status: "active" }, metadata);
  });

  it("does not treat an organization-unit scoped owner as the tenant-wide owner", async () => {
    const context = createTenantContext(tenantAId);
    const scopedOwner = await manager.create(
      context,
      createInput("scoped-owner@example.invalid", [
        { roleId: roleOwnerAId, organizationUnitId: branchAId },
      ]),
      metadata,
    );
    await expect(
      manager.updateStatus(context, scopedOwner.id, { status: "disabled" }, metadata),
    ).resolves.toMatchObject({ changed: true });
    await manager.updateStatus(context, scopedOwner.id, { status: "active" }, metadata);
  });

  it("replaces role assignments atomically", async () => {
    const context = createTenantContext(tenantAId);
    const created = await manager.create(
      context,
      createInput("replace@example.invalid", [{ roleId: roleViewerAId, organizationUnitId: null }]),
      metadata,
    );
    const replaced = await manager.replaceRoleAssignments(
      context,
      created.id,
      [{ roleId: roleAgentAId, organizationUnitId: branchAId }],
      metadata,
    );
    expect(replaced.roleAssignments).toEqual([
      {
        organizationUnit: { id: branchAId, name: "León" },
        role: { id: roleAgentAId, key: "agent", name: "Agent" },
      },
    ]);
    const audit = await prisma.auditLog.findFirst({
      orderBy: { occurredAt: "desc" },
      where: { action: "user.role_assignments.updated", entityId: created.id, tenantId: tenantAId },
    });
    expect(audit?.beforeSummary).toEqual({
      roleAssignments: [{ organizationUnitId: null, roleId: roleViewerAId }],
    });
    expect(audit?.afterSummary).toEqual({
      roleAssignments: [{ organizationUnitId: branchAId, roleId: roleAgentAId }],
    });
  });

  it("manages role permissions and keeps the owner matrix read-only", async () => {
    const context = createTenantContext(tenantAId);
    const rolePage = await manager.listRoles(context);
    const agent = rolePage.roles.find(({ key }) => key === "agent");
    if (agent === undefined) throw new Error("Agent role missing");
    const updated = await manager.updateRolePermissions(
      context,
      agent.id,
      ["catalog.read"],
      metadata,
    );
    expect(updated.permissionKeys).toEqual(["catalog.read"]);
    const owner = rolePage.roles.find(({ key }) => key === "owner");
    if (owner === undefined) throw new Error("Owner role missing");
    await expect(
      manager.updateRolePermissions(context, owner.id, [], metadata),
    ).rejects.toBeInstanceOf(OwnerRoleReadOnlyError);
    const access = createTenantDataAccess(context, prisma);
    const actor = await manager.create(
      context,
      createInput("hot-perm@example.invalid", [{ roleId: agent.id, organizationUnitId: null }]),
      metadata,
    );
    expect((await access.permissions.resolveForUser(actor.id)).has("catalog.read")).toBe(true);
    await manager.updateRolePermissions(context, agent.id, [], metadata);
    expect((await access.permissions.resolveForUser(actor.id)).has("catalog.read")).toBe(false);
  });

  it("never allows concurrent creates to exceed the user limit", async () => {
    const context = createTenantContext(tenantCId);
    await resetTenantC("3");
    await manager.create(context, createInput("filler@example.invalid", []), metadata);
    const results = await Promise.allSettled(
      [1, 2, 3].map((n) =>
        manager.create(context, createInput(`concurrent-${n}@example.invalid`, []), metadata),
      ),
    );
    const accepted = results.filter(({ status }) => status === "fulfilled");
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(UserLimitReachedError);
    }
    expect(await prisma.user.count({ where: { status: "active", tenantId: tenantCId } })).toBe(3);
  });

  it("never allows concurrent reactivations to exceed the user limit", async () => {
    const context = createTenantContext(tenantCId);
    await resetTenantC("3");
    const first = await manager.create(
      context,
      createInput("react-1@example.invalid", []),
      metadata,
    );
    const second = await manager.create(
      context,
      createInput("react-2@example.invalid", []),
      metadata,
    );
    await manager.updateStatus(context, first.id, { status: "disabled" }, metadata);
    await manager.updateStatus(context, second.id, { status: "disabled" }, metadata);
    await setUserLimit(tenantCId, "2");
    const results = await Promise.allSettled([
      manager.updateStatus(context, first.id, { status: "active" }, metadata),
      manager.updateStatus(context, second.id, { status: "active" }, metadata),
    ]);
    const accepted = results.filter(({ status }) => status === "fulfilled");
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(UserLimitReachedError);
    expect(await prisma.user.count({ where: { status: "active", tenantId: tenantCId } })).toBe(2);
  });

  it("rolls back user creation when the outbox fails", async () => {
    const failingManager = createUserManagementManager(failingOutboxDatabase());
    await expect(
      failingManager.create(
        createTenantContext(tenantBId),
        createInput("rollback@example.invalid", [
          { roleId: roleAgentBId, organizationUnitId: null },
        ]),
        metadata,
      ),
    ).rejects.toThrow("forced outbox failure");
    expect(
      await prisma.user.count({
        where: { email: "rollback@example.invalid", tenantId: tenantBId },
      }),
    ).toBe(0);
    expect(
      await prisma.userRole.count({
        where: { tenantId: tenantBId, user: { email: "rollback@example.invalid" } },
      }),
    ).toBe(0);
  });

  it("rolls back status mutations when the outbox fails", async () => {
    const context = createTenantContext(tenantBId);
    const created = await manager.create(
      context,
      createInput("rollback2@example.invalid", []),
      metadata,
    );
    const session = await prisma.userSession.create({
      data: {
        expiresAt: new Date(Date.now() + 60_000),
        tenantId: tenantBId,
        tokenHash: Buffer.from("token-rollback2"),
        userId: created.id,
      },
    });
    const failingManager = createUserManagementManager(failingOutboxDatabase());
    await expect(
      failingManager.updateStatus(context, created.id, { status: "disabled" }, metadata),
    ).rejects.toThrow("forced outbox failure");
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.status).toBe("active");
    const storedSession = await prisma.userSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(storedSession.revokedAt).toBeNull();
  });

  it("rolls back assignment replacement when the outbox fails", async () => {
    const context = createTenantContext(tenantBId);
    const created = await manager.create(
      context,
      createInput("rollback3@example.invalid", [
        { roleId: roleAgentBId, organizationUnitId: null },
      ]),
      metadata,
    );
    const failingManager = createUserManagementManager(failingOutboxDatabase());
    await expect(
      failingManager.replaceRoleAssignments(context, created.id, [], metadata),
    ).rejects.toThrow("forced outbox failure");
    const assignments = await prisma.userRole.findMany({
      where: { tenantId: tenantBId, userId: created.id },
    });
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.roleId).toBe(roleAgentBId);
  });

  it("rolls back role permission mutations when the outbox fails", async () => {
    const context = createTenantContext(tenantBId);
    const rolePage = await manager.listRoles(context);
    const agent = rolePage.roles.find(({ key }) => key === "agent");
    if (agent === undefined) throw new Error("Agent role missing");
    const failingManager = createUserManagementManager(failingOutboxDatabase());
    await expect(
      failingManager.updateRolePermissions(context, agent.id, ["catalog.read"], metadata),
    ).rejects.toThrow("forced outbox failure");
    const after = (await manager.listRoles(context)).roles.find(({ key }) => key === "agent");
    expect(after?.permissionKeys).toEqual(agent.permissionKeys);
  });

  it("lists options with assignable roles and scope units", async () => {
    const options = await manager.options(createTenantContext(tenantAId));
    expect(options.roles.map(({ key }) => key).sort()).toEqual([
      "administrator",
      "agent",
      "operator",
      "owner",
      "supervisor",
      "viewer",
    ]);
    expect(options.organizationUnits.some(({ id }) => id === branchAId)).toBe(true);
    expect(options.organizationUnits.some(({ id }) => id === rootBId)).toBe(false);
  });
});
