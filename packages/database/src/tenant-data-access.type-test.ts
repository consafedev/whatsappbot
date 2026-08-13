import type { AuditEntryInput, AuditWriter } from "./audit";
import type * as TenantSafeDatabase from "./index";
import type {
  DomainEventInput,
  OrganizationUnitCreateData,
  OrganizationUnitUpdateData,
  TenantDataAccess,
  TenantEntitlementCreateData,
  TenantEntitlementUpdateData,
} from "./tenant-data-access";

type Assert<T extends true> = T;
type Excludes<T, Key extends PropertyKey> = Key extends keyof T ? false : true;

export type TenantDataAccessInputAssertions = [
  Assert<Excludes<AuditEntryInput, "id">>,
  Assert<Excludes<AuditEntryInput, "tenantId">>,
  Assert<Excludes<AuditEntryInput, "occurredAt">>,
  Assert<Excludes<AuditWriter, "update">>,
  Assert<Excludes<AuditWriter, "delete">>,
  Assert<Excludes<AuditEntryInput, "tenant">>,
  Assert<Excludes<typeof TenantSafeDatabase, "createPlatformAuditWriter">>,
  Assert<Excludes<DomainEventInput, "id">>,
  Assert<Excludes<DomainEventInput, "tenantId">>,
  Assert<Excludes<DomainEventInput, "publishedAt">>,
  Assert<Excludes<DomainEventInput, "attempts">>,
  Assert<Excludes<DomainEventInput, "lastError">>,
  Assert<Excludes<DomainEventInput, "tenant">>,
  Assert<Excludes<TenantDataAccess["outbox"], "markPublished">>,
  Assert<Excludes<TenantDataAccess["outbox"], "recordFailure">>,
  Assert<Excludes<TenantDataAccess["outbox"], "listAllTenants">>,
  Assert<Excludes<TenantEntitlementCreateData, "tenantId">>,
  Assert<Excludes<TenantEntitlementCreateData, "tenant">>,
  Assert<Excludes<TenantEntitlementUpdateData, "id">>,
  Assert<Excludes<TenantEntitlementUpdateData, "tenantId">>,
  Assert<Excludes<TenantEntitlementUpdateData, "tenant">>,
  Assert<Excludes<OrganizationUnitCreateData, "tenantId">>,
  Assert<Excludes<OrganizationUnitCreateData, "tenant">>,
  Assert<Excludes<OrganizationUnitUpdateData, "id">>,
  Assert<Excludes<OrganizationUnitUpdateData, "tenantId">>,
  Assert<Excludes<OrganizationUnitUpdateData, "tenant">>,
];
