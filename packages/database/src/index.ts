export type { AuditEntryInput, AuditWriter } from "./audit";
export {
  isLimitEntitlementKey,
  isModuleEntitlementKey,
  LIMIT_ENTITLEMENT_KEYS,
  type LimitEntitlementKey,
  MODULE_ENTITLEMENT_KEYS,
  type ModuleEntitlementKey,
} from "./entitlement-catalog";
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
  createTenantAppBootstrap,
  type TenantAppBootstrap,
  type TenantAppBootstrapDatabase,
  TenantAppBootstrapNotFoundError,
} from "./tenant-app-bootstrap";
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
export {
  assertTenantModuleEntitled,
  createTenantEntitlementResolver,
  effectiveTenantEntitlementWhere,
  type TemporalEntitlement,
  type TenantEntitlementReadDatabase,
  type TenantEntitlementResolver,
  type TenantEntitlementStatus,
  TenantModuleEntitlementRequiredError,
  tenantEntitlementEffective,
  tenantEntitlementStatus,
} from "./tenant-entitlements";
export {
  assertTenantOperational,
  TenantNotOperationalError,
  type TenantOperationalReadDatabase,
  tenantIsOperational,
} from "./tenant-operational";
