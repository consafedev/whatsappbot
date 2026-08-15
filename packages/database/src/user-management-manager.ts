import { isPermissionKey, PERMISSION_CATALOG, type PermissionKey } from "@whatsapp-platform/rbac";
import {
  Prisma,
  type TenantEntitlement,
  type User,
  type UserRole,
} from "./generated/prisma/client";
import type { UserStatus } from "./generated/prisma/enums";
import { UnknownPermissionKeyError } from "./rbac-data-access";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { tenantEntitlementEffective } from "./tenant-entitlements";

export type UserRoleAssignmentInput = Readonly<{
  roleId: string;
  organizationUnitId: string | null;
}>;

export type UserCreateInput = Readonly<{
  displayName: string;
  email: string;
  passwordHash: string;
  roleAssignments: readonly UserRoleAssignmentInput[];
}>;

export type UserUpdateStatusInput = Readonly<{
  status: UserStatus;
}>;

export type UserListOptions = Readonly<{
  page: number;
  pageSize: number;
  search?: string;
  status?: UserStatus;
}>;

export type UserRoleAssignmentItem = Readonly<{
  role: Readonly<{ id: string; key: string; name: string }>;
  organizationUnit: Readonly<{ id: string; name: string }> | null;
}>;

export type UserItem = Readonly<{
  id: string;
  displayName: string;
  email: string;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  roleAssignments: readonly UserRoleAssignmentItem[];
}>;

export type UserUsage = Readonly<{
  used: number;
  limit: string | null;
}>;

export type UserPage = Readonly<{
  items: readonly UserItem[];
  page: number;
  pageSize: number;
  total: number;
  usage: UserUsage;
}>;

export type UserStatusUpdateResult = Readonly<{
  changed: boolean;
  user: UserItem;
}>;

export type UserRoleOptionItem = Readonly<{
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
}>;

export type UserScopeOptionItem = Readonly<{
  id: string;
  name: string;
  parentId: string | null;
  active: boolean;
}>;

export type UserManagementOptions = Readonly<{
  roles: readonly UserRoleOptionItem[];
  organizationUnits: readonly UserScopeOptionItem[];
}>;

export type RolePermissionItem = Readonly<{
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionKeys: readonly PermissionKey[];
}>;

export type PermissionCatalogItem = Readonly<{
  key: PermissionKey;
  description: string;
}>;

export type RoleManagementPage = Readonly<{
  permissions: readonly PermissionCatalogItem[];
  roles: readonly RolePermissionItem[];
}>;

export type UserMutationMetadata = Readonly<{
  actorUserId: string;
  requestId: string;
}>;

export type UserManagementManagerDatabase = Pick<
  Prisma.TransactionClient,
  | "auditLog"
  | "domainEventOutbox"
  | "organizationUnit"
  | "permission"
  | "role"
  | "rolePermission"
  | "tenant"
  | "tenantEntitlement"
  | "user"
  | "userPasswordResetToken"
  | "userRole"
  | "userSession"
> & {
  $transaction<Result>(
    callback: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result>;
};

export interface UserManagementManager {
  list(context: TenantContext, options: UserListOptions): Promise<UserPage>;
  create(
    context: TenantContext,
    input: UserCreateInput,
    metadata: UserMutationMetadata,
  ): Promise<UserItem>;
  updateStatus(
    context: TenantContext,
    userId: string,
    input: UserUpdateStatusInput,
    metadata: UserMutationMetadata,
  ): Promise<UserStatusUpdateResult>;
  replaceRoleAssignments(
    context: TenantContext,
    userId: string,
    assignments: readonly UserRoleAssignmentInput[],
    metadata: UserMutationMetadata,
  ): Promise<UserItem>;
  options(context: TenantContext): Promise<UserManagementOptions>;
  listRoles(context: TenantContext): Promise<RoleManagementPage>;
  updateRolePermissions(
    context: TenantContext,
    roleId: string,
    permissionKeys: readonly PermissionKey[],
    metadata: UserMutationMetadata,
  ): Promise<RolePermissionItem>;
}

export class UserNotFoundError extends Error {
  override readonly name = "UserNotFoundError";

  constructor() {
    super("Tenant-scoped user was not found");
  }
}

export class UserEmailConflictError extends Error {
  override readonly name = "UserEmailConflictError";

  constructor() {
    super("A user with the same email already exists in this workspace");
  }
}

export class UserEmailInvalidError extends Error {
  override readonly name = "UserEmailInvalidError";

  constructor() {
    super("User email must be normalized before reaching the manager");
  }
}

export class UserLimitReachedError extends Error {
  override readonly name = "UserLimitReachedError";

  constructor() {
    super("User limit reached");
  }
}

export class LastOwnerRequiredError extends Error {
  override readonly name = "LastOwnerRequiredError";

  constructor() {
    super("At least one active tenant-wide owner is required");
  }
}

export class DuplicateRoleAssignmentError extends Error {
  override readonly name = "DuplicateRoleAssignmentError";

  constructor() {
    super("Role assignments must be unique");
  }
}

export class UserRoleNotFoundError extends Error {
  override readonly name = "UserRoleNotFoundError";

  constructor() {
    super("Tenant-scoped role was not found");
  }
}

export class UserScopeUnitNotFoundError extends Error {
  override readonly name = "UserScopeUnitNotFoundError";

  constructor() {
    super("Tenant-scoped organization unit was not found");
  }
}

export class OwnerRoleReadOnlyError extends Error {
  override readonly name = "OwnerRoleReadOnlyError";

  constructor() {
    super("The system owner role permission matrix is read-only");
  }
}

export class RolePermissionScopeConflictError extends Error {
  override readonly name = "RolePermissionScopeConflictError";

  constructor() {
    super("A permission with existing scope constraints cannot be edited here");
  }
}

function effectiveUserLimit(
  entitlement: TenantEntitlement | null,
  now: Date,
): Prisma.Decimal | null {
  if (entitlement === null || !tenantEntitlementEffective(entitlement, now)) {
    return null;
  }
  return entitlement.limitValue;
}

function userItem(user: User, roleAssignments: readonly UserRoleAssignmentItem[]): UserItem {
  return {
    createdAt: user.createdAt,
    displayName: user.displayName,
    email: user.email,
    id: user.id,
    lastLoginAt: user.lastLoginAt,
    roleAssignments,
    status: user.status,
  };
}

function assignmentItems(assignments: readonly StoredAssignment[]): UserRoleAssignmentItem[] {
  return assignments.map((assignment) => ({
    organizationUnit:
      assignment.organizationUnit === null
        ? null
        : {
            id: assignment.organizationUnit.id,
            name: assignment.organizationUnit.name,
          },
    role: {
      id: assignment.role.id,
      key: assignment.role.key,
      name: assignment.role.name,
    },
  }));
}

type StoredAssignment = UserRole & {
  organizationUnit: { id: string; name: string } | null;
  role: { id: string; key: string; name: string };
};

function assignmentInputKey(assignment: UserRoleAssignmentInput): string {
  return `${assignment.roleId}:${assignment.organizationUnitId ?? ""}`;
}

async function lockTenantUsers(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${tenantId}::text || ':users'::text, 0::bigint))`;
}

async function lockUserRoleAssignments(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
): Promise<void> {
  await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${tenantId}::text || ':user-roles:'::text || ${userId}::text, 0::bigint))`;
}

async function countActiveUsers(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<number> {
  return transaction.user.count({ where: { status: "active", tenantId } });
}

async function assertUserLimit(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  now = new Date(),
): Promise<void> {
  const row = await transaction.tenantEntitlement.findUnique({
    where: { tenantId_entitlementKey: { entitlementKey: "limit.users", tenantId } },
  });
  const limit = effectiveUserLimit(row, now);
  if (limit === null) return;
  const used = await countActiveUsers(transaction, tenantId);
  const nextUsed = new Prisma.Decimal(used).plus(1);
  if (limit.lt(nextUsed)) {
    throw new UserLimitReachedError();
  }
}

async function countActiveTenantWideOwners(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<number> {
  const assignments = await transaction.userRole.findMany({
    distinct: ["userId"],
    select: { userId: true },
    where: {
      organizationUnitId: null,
      role: { isSystem: true, key: "owner" },
      tenantId,
      user: { status: "active" },
    },
  });
  return assignments.length;
}

async function isActiveTenantWideOwner(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const assignment = await transaction.userRole.findFirst({
    where: {
      organizationUnitId: null,
      role: { isSystem: true, key: "owner" },
      tenantId,
      userId,
    },
    select: { id: true },
  });
  return assignment !== null;
}

async function validateAssignments(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  assignments: readonly UserRoleAssignmentInput[],
): Promise<void> {
  const seen = new Set<string>();
  for (const assignment of assignments) {
    const key = assignmentInputKey(assignment);
    if (seen.has(key)) throw new DuplicateRoleAssignmentError();
    seen.add(key);
    const role = await transaction.role.findUnique({
      where: { id: assignment.roleId, tenantId },
      select: { id: true },
    });
    if (role === null) throw new UserRoleNotFoundError();
    if (assignment.organizationUnitId !== null) {
      const unit = await transaction.organizationUnit.findUnique({
        where: { id: assignment.organizationUnitId, tenantId },
        select: { id: true },
      });
      if (unit === null) throw new UserScopeUnitNotFoundError();
    }
  }
}

async function loadAssignments(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
): Promise<readonly StoredAssignment[]> {
  return transaction.userRole.findMany({
    include: {
      organizationUnit: { select: { id: true, name: true } },
      role: { select: { id: true, key: true, name: true } },
    },
    orderBy: [{ role: { name: "asc" } }, { id: "asc" }],
    where: { tenantId, userId },
  });
}

export function createUserManagementManager(
  database: UserManagementManagerDatabase,
): UserManagementManager {
  const list = async (context: TenantContext, options: UserListOptions): Promise<UserPage> => {
    const tenantContext = createTenantContext(context.tenantId);
    const where: Prisma.UserWhereInput = { tenantId: tenantContext.tenantId };
    if (options.status !== undefined) where.status = options.status;
    if (options.search !== undefined && options.search !== "") {
      where.OR = [
        { displayName: { contains: options.search, mode: "insensitive" } },
        { email: { contains: options.search, mode: "insensitive" } },
      ];
    }
    const [total, users, entitlement, activeUsed] = await Promise.all([
      database.user.count({ where }),
      database.user.findMany({
        include: {
          roleAssignments: {
            include: {
              organizationUnit: { select: { id: true, name: true } },
              role: { select: { id: true, key: true, name: true } },
            },
            orderBy: [{ role: { name: "asc" } }, { id: "asc" }],
          },
        },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
        where,
      }),
      database.tenantEntitlement.findUnique({
        where: {
          tenantId_entitlementKey: {
            entitlementKey: "limit.users",
            tenantId: tenantContext.tenantId,
          },
        },
      }),
      database.user.count({ where: { status: "active", tenantId: tenantContext.tenantId } }),
    ]);
    const limit = effectiveUserLimit(entitlement, new Date());
    return {
      items: users.map(({ roleAssignments, ...user }) =>
        userItem(user, assignmentItems(roleAssignments)),
      ),
      page: options.page,
      pageSize: options.pageSize,
      total,
      usage: { used: activeUsed, limit: limit === null ? null : limit.toFixed(4) },
    };
  };

  const create = async (
    context: TenantContext,
    input: UserCreateInput,
    metadata: UserMutationMetadata,
  ): Promise<UserItem> => {
    const tenantContext = createTenantContext(context.tenantId);
    if (input.email !== input.email.trim().toLocaleLowerCase("en-US")) {
      throw new UserEmailInvalidError();
    }
    return database.$transaction(async (transaction) => {
      await lockTenantUsers(transaction, tenantContext.tenantId);
      await assertUserLimit(transaction, tenantContext.tenantId);
      await validateAssignments(transaction, tenantContext.tenantId, input.roleAssignments);
      const existing = await transaction.user.findUnique({
        select: { id: true },
        where: {
          tenantId_email: { email: input.email, tenantId: tenantContext.tenantId },
        },
      });
      if (existing !== null) throw new UserEmailConflictError();
      const tenantDefaults = await transaction.tenant.findUnique({
        select: { defaultLocale: true, defaultTimezone: true },
        where: { id: tenantContext.tenantId },
      });
      if (tenantDefaults === null) throw new UserNotFoundError();
      const user = await transaction.user.create({
        data: {
          displayName: input.displayName,
          email: input.email,
          locale: tenantDefaults.defaultLocale,
          mfaState: "disabled",
          passwordHash: input.passwordHash,
          status: "active",
          tenantId: tenantContext.tenantId,
          timezone: tenantDefaults.defaultTimezone,
        },
      });
      for (const assignment of input.roleAssignments) {
        await transaction.userRole.create({
          data: {
            organizationUnitId: assignment.organizationUnitId,
            roleId: assignment.roleId,
            tenantId: tenantContext.tenantId,
            userId: user.id,
          },
        });
      }
      const stored = await loadAssignments(transaction, tenantContext.tenantId, user.id);
      const item = userItem(user, assignmentItems(stored));
      await transaction.auditLog.create({
        data: {
          action: "user.created",
          actorId: metadata.actorUserId,
          actorType: "tenant_user",
          afterSummary: { displayName: item.displayName, status: item.status },
          entityId: item.id,
          entityType: "User",
          requestId: metadata.requestId,
          tenantId: tenantContext.tenantId,
        },
      });
      await transaction.domainEventOutbox.create({
        data: {
          aggregateId: item.id,
          aggregateType: "User",
          eventType: "user.created",
          payload: { status: item.status, tenantId: tenantContext.tenantId, userId: item.id },
          tenantId: tenantContext.tenantId,
        },
      });
      return item;
    });
  };

  const updateStatus = async (
    context: TenantContext,
    userId: string,
    input: UserUpdateStatusInput,
    metadata: UserMutationMetadata,
  ): Promise<UserStatusUpdateResult> => {
    const tenantContext = createTenantContext(context.tenantId);
    return database.$transaction(async (transaction) => {
      await lockTenantUsers(transaction, tenantContext.tenantId);
      const user = await transaction.user.findUnique({
        where: { id: userId, tenantId: tenantContext.tenantId },
      });
      if (user === null) throw new UserNotFoundError();
      if (user.status === input.status) {
        const assignments = await loadAssignments(transaction, tenantContext.tenantId, user.id);
        return { changed: false, user: userItem(user, assignmentItems(assignments)) };
      }
      if (input.status === "disabled") {
        const owners = await countActiveTenantWideOwners(transaction, tenantContext.tenantId);
        const activeOwner =
          user.status === "active" &&
          (await isActiveTenantWideOwner(transaction, tenantContext.tenantId, user.id));
        if (owners - (activeOwner ? 1 : 0) < 1) {
          throw new LastOwnerRequiredError();
        }
        await transaction.userSession.updateMany({
          data: { revokedAt: new Date() },
          where: { revokedAt: null, tenantId: tenantContext.tenantId, userId: user.id },
        });
        await transaction.userPasswordResetToken.updateMany({
          data: { revokedAt: new Date() },
          where: {
            consumedAt: null,
            revokedAt: null,
            tenantId: tenantContext.tenantId,
            userId: user.id,
          },
        });
      } else {
        await assertUserLimit(transaction, tenantContext.tenantId);
      }
      const updated = await transaction.user.update({
        data: { status: input.status },
        where: { id: user.id, tenantId: tenantContext.tenantId },
      });
      const action = input.status === "disabled" ? "user.disabled" : "user.reactivated";
      await transaction.auditLog.create({
        data: {
          action,
          actorId: metadata.actorUserId,
          actorType: "tenant_user",
          afterSummary: { displayName: updated.displayName, status: updated.status },
          beforeSummary: { displayName: user.displayName, status: user.status },
          entityId: updated.id,
          entityType: "User",
          requestId: metadata.requestId,
          tenantId: tenantContext.tenantId,
        },
      });
      await transaction.domainEventOutbox.create({
        data: {
          aggregateId: updated.id,
          aggregateType: "User",
          eventType: action,
          payload: { status: updated.status, tenantId: tenantContext.tenantId, userId: updated.id },
          tenantId: tenantContext.tenantId,
        },
      });
      const assignments = await loadAssignments(transaction, tenantContext.tenantId, updated.id);
      return { changed: true, user: userItem(updated, assignmentItems(assignments)) };
    });
  };

  const replaceRoleAssignments = async (
    context: TenantContext,
    userId: string,
    assignments: readonly UserRoleAssignmentInput[],
    metadata: UserMutationMetadata,
  ): Promise<UserItem> => {
    const tenantContext = createTenantContext(context.tenantId);
    return database.$transaction(async (transaction) => {
      await lockUserRoleAssignments(transaction, tenantContext.tenantId, userId);
      await lockTenantUsers(transaction, tenantContext.tenantId);
      const user = await transaction.user.findUnique({
        where: { id: userId, tenantId: tenantContext.tenantId },
      });
      if (user === null) throw new UserNotFoundError();
      await validateAssignments(transaction, tenantContext.tenantId, assignments);
      const currentAssignments = await transaction.userRole.findMany({
        orderBy: [{ role: { name: "asc" } }, { id: "asc" }],
        select: { organizationUnitId: true, roleId: true },
        where: { tenantId: tenantContext.tenantId, userId },
      });
      const owners = await countActiveTenantWideOwners(transaction, tenantContext.tenantId);
      const activeOwner =
        user.status === "active" &&
        (await isActiveTenantWideOwner(transaction, tenantContext.tenantId, user.id));
      const ownerRoleIds = new Set(
        (
          await transaction.role.findMany({
            select: { id: true },
            where: { isSystem: true, key: "owner", tenantId: tenantContext.tenantId },
          })
        ).map(({ id }) => id),
      );
      const tenantWideOwnerAssignments =
        user.status === "active"
          ? assignments.filter(
              (assignment) =>
                assignment.organizationUnitId === null && ownerRoleIds.has(assignment.roleId),
            ).length
          : 0;
      if (owners - (activeOwner ? 1 : 0) + tenantWideOwnerAssignments < 1) {
        throw new LastOwnerRequiredError();
      }
      await transaction.userRole.deleteMany({
        where: { tenantId: tenantContext.tenantId, userId },
      });
      for (const assignment of assignments) {
        await transaction.userRole.create({
          data: {
            organizationUnitId: assignment.organizationUnitId,
            roleId: assignment.roleId,
            tenantId: tenantContext.tenantId,
            userId,
          },
        });
      }
      const stored = await loadAssignments(transaction, tenantContext.tenantId, user.id);
      const item = userItem(user, assignmentItems(stored));
      await transaction.auditLog.create({
        data: {
          action: "user.role_assignments.updated",
          actorId: metadata.actorUserId,
          actorType: "tenant_user",
          afterSummary: {
            roleAssignments: stored.map((assignment) => ({
              organizationUnitId: assignment.organizationUnitId,
              roleId: assignment.roleId,
            })),
          },
          beforeSummary: {
            roleAssignments: currentAssignments.map((assignment) => ({
              organizationUnitId: assignment.organizationUnitId,
              roleId: assignment.roleId,
            })),
          },
          entityId: user.id,
          entityType: "User",
          requestId: metadata.requestId,
          tenantId: tenantContext.tenantId,
        },
      });
      await transaction.domainEventOutbox.create({
        data: {
          aggregateId: user.id,
          aggregateType: "User",
          eventType: "user.role_assignments.updated",
          payload: {
            roleAssignments: stored.map((assignment) => ({
              organizationUnitId: assignment.organizationUnitId,
              roleId: assignment.roleId,
            })),
            tenantId: tenantContext.tenantId,
            userId: user.id,
          },
          tenantId: tenantContext.tenantId,
        },
      });
      return item;
    });
  };

  const options = async (context: TenantContext): Promise<UserManagementOptions> => {
    const tenantContext = createTenantContext(context.tenantId);
    const [roles, units] = await Promise.all([
      database.role.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, isSystem: true, key: true, name: true },
        where: { tenantId: tenantContext.tenantId },
      }),
      database.organizationUnit.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { active: true, id: true, name: true, parentId: true },
        where: { tenantId: tenantContext.tenantId },
      }),
    ]);
    return {
      organizationUnits: units.map((unit) => ({
        active: unit.active,
        id: unit.id,
        name: unit.name,
        parentId: unit.parentId,
      })),
      roles: roles.map((role) => ({
        id: role.id,
        isSystem: role.isSystem,
        key: role.key,
        name: role.name,
      })),
    };
  };

  const listRoles = async (context: TenantContext): Promise<RoleManagementPage> => {
    const tenantContext = createTenantContext(context.tenantId);
    const roles = await database.role.findMany({
      include: {
        permissions: {
          select: { permission: { select: { key: true } } },
          where: { scopeConstraints: { equals: Prisma.DbNull } },
        },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      where: { isSystem: true, tenantId: tenantContext.tenantId },
    });
    return {
      permissions: PERMISSION_CATALOG.map(({ description, key }) => ({ description, key })),
      roles: roles.map((role) => ({
        description: role.description,
        id: role.id,
        isSystem: role.isSystem,
        key: role.key,
        name: role.name,
        permissionKeys: role.permissions
          .map(({ permission }) => permission.key)
          .filter((key): key is PermissionKey => isPermissionKey(key)),
      })),
    };
  };

  const updateRolePermissions = async (
    context: TenantContext,
    roleId: string,
    permissionKeys: readonly PermissionKey[],
    metadata: UserMutationMetadata,
  ): Promise<RolePermissionItem> => {
    const tenantContext = createTenantContext(context.tenantId);
    const unique = [...new Set(permissionKeys)];
    return database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${tenantContext.tenantId}::text || ':role-permissions:'::text || ${roleId}::text, 0::bigint))`;
      const role = await transaction.role.findUnique({
        where: { id: roleId, isSystem: true, tenantId: tenantContext.tenantId },
      });
      if (role === null) throw new UserRoleNotFoundError();
      if (role.key === "owner" && role.isSystem) throw new OwnerRoleReadOnlyError();
      for (const key of unique) {
        if (!isPermissionKey(key)) throw new UnknownPermissionKeyError();
      }
      const beforeRows = await transaction.rolePermission.findMany({
        select: { permission: { select: { key: true } } },
        where: { roleId: role.id, scopeConstraints: { equals: Prisma.DbNull } },
      });
      const beforeKeys = beforeRows
        .map(({ permission }) => permission.key)
        .filter((key): key is PermissionKey => isPermissionKey(key));
      const existingRows = await transaction.rolePermission.findMany({
        select: { permission: { select: { key: true } }, scopeConstraints: true },
        where: { roleId: role.id },
      });
      if (
        existingRows.some(
          ({ permission, scopeConstraints }) =>
            unique.includes(permission.key as PermissionKey) && scopeConstraints !== null,
        )
      ) {
        throw new RolePermissionScopeConflictError();
      }
      const permissions = await transaction.permission.findMany({
        select: { id: true, key: true },
        where: { key: { in: unique } },
      });
      const permissionIdByKey = new Map(permissions.map(({ id, key }) => [key, id]));
      for (const key of unique) {
        const permissionId = permissionIdByKey.get(key);
        if (permissionId === undefined) throw new UnknownPermissionKeyError();
        const existing = await transaction.rolePermission.findUnique({
          select: { roleId: true },
          where: { roleId_permissionId: { permissionId, roleId: role.id } },
        });
        if (existing === null) {
          await transaction.rolePermission.create({
            data: { permissionId, roleId: role.id },
          });
        }
      }
      await transaction.rolePermission.deleteMany({
        where: {
          permission: { key: { notIn: unique } },
          roleId: role.id,
          scopeConstraints: { equals: Prisma.DbNull },
        },
      });
      const afterRows = await transaction.rolePermission.findMany({
        select: { permission: { select: { key: true } } },
        where: { roleId: role.id, scopeConstraints: { equals: Prisma.DbNull } },
      });
      const afterKeys = afterRows
        .map(({ permission }) => permission.key)
        .filter((key): key is PermissionKey => isPermissionKey(key))
        .sort();
      await transaction.auditLog.create({
        data: {
          action: "role.permissions.updated",
          actorId: metadata.actorUserId,
          actorType: "tenant_user",
          afterSummary: { permissionKeys: afterKeys },
          beforeSummary: { permissionKeys: [...beforeKeys].sort() },
          entityId: role.id,
          entityType: "Role",
          requestId: metadata.requestId,
          tenantId: tenantContext.tenantId,
        },
      });
      await transaction.domainEventOutbox.create({
        data: {
          aggregateId: role.id,
          aggregateType: "Role",
          eventType: "role.permissions.updated",
          payload: { permissionKeys: afterKeys, roleId: role.id, tenantId: tenantContext.tenantId },
          tenantId: tenantContext.tenantId,
        },
      });
      return {
        description: role.description,
        id: role.id,
        isSystem: role.isSystem,
        key: role.key,
        name: role.name,
        permissionKeys: afterKeys,
      };
    });
  };

  return Object.freeze({
    create,
    list,
    listRoles,
    options,
    replaceRoleAssignments,
    updateRolePermissions,
    updateStatus,
  });
}
