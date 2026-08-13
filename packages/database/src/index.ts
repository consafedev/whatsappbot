export type { AuditEntryInput, AuditWriter } from "./audit";
export type {
  AuditLog,
  DomainEventOutbox,
  OrganizationUnit,
  Permission,
  Role,
  RolePermission,
  TenantEntitlement,
  UserRole,
} from "./generated/prisma/client";
export * from "./generated/prisma/enums";
export {
  TenantRbacRecordNotFoundError,
  UnknownPermissionKeyError,
} from "./rbac-data-access";
export {
  createTenantContext,
  type TenantContext,
  type TenantId,
} from "./tenant-context";
export {
  type CustomRoleCreateData,
  createTenantDataAccess,
  type DomainEventInput,
  type OrganizationUnitCreateData,
  type OrganizationUnitRepository,
  type OrganizationUnitUpdateData,
  type RolePermissionGrantOptions,
  type TenantDataAccess,
  type TenantDataAccessDatabase,
  type TenantEntitlementCreateData,
  type TenantEntitlementRepository,
  type TenantEntitlementUpdateData,
  type TenantOutboxWriter,
  type TenantPermissionResolver,
  type TenantRolePermissionRepository,
  type TenantRoleRepository,
  TenantScopedRecordNotFoundError,
  type TenantTransactionDatabase,
  type TenantUserRoleRepository,
  type UserRoleAssignmentData,
  withTenantTransaction,
} from "./tenant-data-access";
