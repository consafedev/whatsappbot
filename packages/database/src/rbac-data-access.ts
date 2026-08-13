import { isPermissionKey, type PermissionKey } from "@whatsapp-platform/rbac";
import {
  type Permission,
  Prisma,
  type Role,
  type RolePermission,
  type UserRole,
} from "./generated/prisma/client";
import type { TenantContext } from "./tenant-context";

export type TenantRbacDatabase = Pick<
  Prisma.TransactionClient,
  "organizationUnit" | "permission" | "role" | "rolePermission" | "user" | "userRole"
>;

type JsonInput = Prisma.InputJsonValue;

export type CustomRoleCreateData = Readonly<{
  name: string;
  key: string;
  description?: string | null;
}>;

export type UserRoleAssignmentData = Readonly<{
  userId: string;
  roleId: string;
  organizationUnitId?: string | null;
}>;

export type RolePermissionGrantOptions = Readonly<{
  scopeConstraints?: JsonInput | null;
}>;

export interface TenantRoleRepository {
  list(): Promise<Role[]>;
  findById(id: string): Promise<Role | null>;
  findByKey(key: string): Promise<Role | null>;
  createCustom(data: CustomRoleCreateData): Promise<Role>;
}

export interface TenantRolePermissionRepository {
  grant(
    roleId: string,
    permissionKey: PermissionKey,
    options?: RolePermissionGrantOptions,
  ): Promise<RolePermission>;
  revoke(roleId: string, permissionKey: PermissionKey): Promise<boolean>;
}

export interface TenantUserRoleRepository {
  assign(data: UserRoleAssignmentData): Promise<UserRole>;
  revoke(data: UserRoleAssignmentData): Promise<boolean>;
}

export interface TenantPermissionResolver {
  resolveForUser(userId: string): Promise<ReadonlySet<PermissionKey>>;
}

export type TenantRbacDataAccess = Readonly<{
  roles: TenantRoleRepository;
  rolePermissions: TenantRolePermissionRepository;
  userRoles: TenantUserRoleRepository;
  permissions: TenantPermissionResolver;
}>;

export class TenantRbacRecordNotFoundError extends Error {
  constructor(resource: "OrganizationUnit" | "Permission" | "Role" | "User") {
    super(`Tenant-scoped ${resource} was not found`);
    this.name = "TenantRbacRecordNotFoundError";
  }
}

export class UnknownPermissionKeyError extends Error {
  constructor() {
    super("Permission key is not recognized by this application version");
    this.name = "UnknownPermissionKeyError";
  }
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

async function tenantRoleOrThrow(
  context: TenantContext,
  database: TenantRbacDatabase,
  roleId: string,
): Promise<Role> {
  const role = await database.role.findUnique({
    where: { id: roleId, tenantId: context.tenantId },
  });
  if (role === null) throw new TenantRbacRecordNotFoundError("Role");
  return role;
}

async function permissionOrThrow(
  database: TenantRbacDatabase,
  permissionKey: PermissionKey,
): Promise<Permission> {
  if (!isPermissionKey(permissionKey)) throw new UnknownPermissionKeyError();
  const permission = await database.permission.findUnique({ where: { key: permissionKey } });
  if (permission === null) throw new TenantRbacRecordNotFoundError("Permission");
  return permission;
}

function createRoleRepository(
  context: TenantContext,
  database: TenantRbacDatabase,
): TenantRoleRepository {
  return Object.freeze({
    list: () =>
      database.role.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
        where: { tenantId: context.tenantId },
      }),
    findById: (id: string) =>
      database.role.findUnique({ where: { id, tenantId: context.tenantId } }),
    findByKey: (key: string) =>
      database.role.findUnique({
        where: { tenantId_key: { key, tenantId: context.tenantId } },
      }),
    createCustom: (data: CustomRoleCreateData) => {
      const createData: Prisma.RoleUncheckedCreateInput = {
        isSystem: false,
        key: data.key,
        name: data.name,
        tenantId: context.tenantId,
      };
      if (data.description !== undefined) createData.description = data.description;
      return database.role.create({ data: createData });
    },
  });
}

function createRolePermissionRepository(
  context: TenantContext,
  database: TenantRbacDatabase,
): TenantRolePermissionRepository {
  return Object.freeze({
    grant: async (
      roleId: string,
      permissionKey: PermissionKey,
      options: RolePermissionGrantOptions = {},
    ) => {
      const [role, permission] = await Promise.all([
        tenantRoleOrThrow(context, database, roleId),
        permissionOrThrow(database, permissionKey),
      ]);
      const scopeConstraints =
        options.scopeConstraints === undefined || options.scopeConstraints === null
          ? Prisma.DbNull
          : options.scopeConstraints;
      return database.rolePermission.upsert({
        create: { permissionId: permission.id, roleId: role.id, scopeConstraints },
        update: { scopeConstraints },
        where: { roleId_permissionId: { permissionId: permission.id, roleId: role.id } },
      });
    },
    revoke: async (roleId: string, permissionKey: PermissionKey) => {
      const [role, permission] = await Promise.all([
        tenantRoleOrThrow(context, database, roleId),
        permissionOrThrow(database, permissionKey),
      ]);
      const result = await database.rolePermission.deleteMany({
        where: { permissionId: permission.id, roleId: role.id },
      });
      return result.count > 0;
    },
  });
}

async function validateAssignment(
  context: TenantContext,
  database: TenantRbacDatabase,
  data: UserRoleAssignmentData,
): Promise<void> {
  const [user, role, organizationUnit] = await Promise.all([
    database.user.findUnique({ where: { id: data.userId, tenantId: context.tenantId } }),
    database.role.findUnique({ where: { id: data.roleId, tenantId: context.tenantId } }),
    data.organizationUnitId === undefined || data.organizationUnitId === null
      ? Promise.resolve(null)
      : database.organizationUnit.findUnique({
          where: { id: data.organizationUnitId, tenantId: context.tenantId },
        }),
  ]);
  if (user === null) throw new TenantRbacRecordNotFoundError("User");
  if (role === null) throw new TenantRbacRecordNotFoundError("Role");
  if (data.organizationUnitId !== undefined && data.organizationUnitId !== null) {
    if (organizationUnit === null) throw new TenantRbacRecordNotFoundError("OrganizationUnit");
  }
}

function createUserRoleRepository(
  context: TenantContext,
  database: TenantRbacDatabase,
): TenantUserRoleRepository {
  return Object.freeze({
    assign: async (data: UserRoleAssignmentData) => {
      await validateAssignment(context, database, data);
      const organizationUnitId = data.organizationUnitId ?? null;
      const existing = await database.userRole.findFirst({
        where: {
          organizationUnitId,
          roleId: data.roleId,
          tenantId: context.tenantId,
          userId: data.userId,
        },
      });
      if (existing !== null) return existing;
      try {
        return await database.userRole.create({
          data: {
            organizationUnitId,
            roleId: data.roleId,
            tenantId: context.tenantId,
            userId: data.userId,
          },
        });
      } catch (error) {
        if (!isPrismaUniqueViolation(error)) throw error;
        const assignment = await database.userRole.findFirst({
          where: {
            organizationUnitId,
            roleId: data.roleId,
            tenantId: context.tenantId,
            userId: data.userId,
          },
        });
        if (assignment === null) throw error;
        return assignment;
      }
    },
    revoke: async (data: UserRoleAssignmentData) => {
      const result = await database.userRole.deleteMany({
        where: {
          organizationUnitId: data.organizationUnitId ?? null,
          roleId: data.roleId,
          tenantId: context.tenantId,
          userId: data.userId,
        },
      });
      return result.count > 0;
    },
  });
}

function createPermissionResolver(
  context: TenantContext,
  database: TenantRbacDatabase,
): TenantPermissionResolver {
  return Object.freeze({
    resolveForUser: async (userId: string) => {
      const user = await database.user.findUnique({
        select: { id: true },
        where: { id: userId, tenantId: context.tenantId },
      });
      if (user === null) return new Set<PermissionKey>();
      const assignments = await database.userRole.findMany({
        select: {
          role: {
            select: {
              permissions: {
                select: { permission: { select: { key: true } } },
                where: { scopeConstraints: { equals: Prisma.DbNull } },
              },
            },
          },
        },
        where: {
          organizationUnitId: null,
          role: { tenantId: context.tenantId },
          tenantId: context.tenantId,
          userId,
        },
      });
      const permissions = new Set<PermissionKey>();
      for (const assignment of assignments) {
        for (const grant of assignment.role.permissions) {
          if (isPermissionKey(grant.permission.key)) permissions.add(grant.permission.key);
        }
      }
      return permissions;
    },
  });
}

export function createTenantRbacDataAccess(
  context: TenantContext,
  database: TenantRbacDatabase,
): TenantRbacDataAccess {
  return Object.freeze({
    permissions: createPermissionResolver(context, database),
    rolePermissions: createRolePermissionRepository(context, database),
    roles: createRoleRepository(context, database),
    userRoles: createUserRoleRepository(context, database),
  });
}
