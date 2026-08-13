import type {
  DomainEventInput,
  OrganizationUnitCreateData,
  OrganizationUnitUpdateData,
  TenantEntitlementCreateData,
  TenantEntitlementUpdateData,
} from "./tenant-data-access";

type Assert<T extends true> = T;
type Excludes<T, Key extends PropertyKey> = Key extends keyof T ? false : true;

export type TenantDataAccessInputAssertions = [
  Assert<Excludes<DomainEventInput, "id">>,
  Assert<Excludes<DomainEventInput, "tenantId">>,
  Assert<Excludes<DomainEventInput, "publishedAt">>,
  Assert<Excludes<DomainEventInput, "attempts">>,
  Assert<Excludes<DomainEventInput, "lastError">>,
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
