# ADR-0063 — E14-S01 Appointment Services Foundation

**Status:** Accepted
**Date:** 2026-10-05

## Context

Epic 14 starts with a tenant-owned catalog of appointment services. A service
defines its name, optional description, duration, pre/post buffers, optional
price, currency, optional OrganizationUnit assignment, active state, and
settings. This story does not create appointments, resources, or availability
rules.

## Decision

- Add `AppointmentService` in PostgreSQL as `appointment_services`, with UUIDv7
  identity, required `tenant_id`, optional `organization_unit_id`, Decimal
  price (`NUMERIC(12,2)`), three-character currency code defaulting to `MXN`,
  zero-default buffers, and JSONB settings.
- Keep the tenant relationship cascading with tenant deletion. Enforce an
  OrganizationUnit assignment with the existing composite
  `(tenant_id, organization_unit_id)` foreign-key pattern and `ON DELETE
  RESTRICT`. A service can be deliberately detached by setting
  `organizationUnitId` to `null`; organization units are deactivated rather
  than physically deleted in the normal lifecycle.
- Validate positive duration, non-negative buffers and price, and same-tenant
  OrganizationUnit ownership in the database manager. Revalidate tenant
  operational status before mutations. All record reads and writes include the
  authenticated tenant ID; foreign-tenant or missing IDs have the same 404
  behavior.
- Persist create, update, and archive changes with their tenant AuditLog and
  DomainEventOutbox record in one transaction. Mutation metadata supplies the
  authenticated user ID and request ID explicitly; no ambient request context
  is introduced. Audit summaries contain only the service fields needed to
  explain the change.
- Archive is a soft deactivation (`active = false`). Listing supports tenant,
  active state, OrganizationUnit, case-insensitive name search, limit, and
  offset with a total count.
- Expose REST routes under `/api/v1/appointments/services`. Reads require
  `module.appointments` and `appointments.read`; mutations require
  `module.appointments` and `appointments.manage`, through the canonical tenant
  session, context, permission, and entitlement guards. Responses use the
  established `{ success: true, data }` envelope.
- The schema change is additive and append-only as migration
  `20261005180000_add_appointment_services_foundation`.

## Alternatives considered

- `ON DELETE SET NULL` on the composite OrganizationUnit relation was rejected:
  the relation contains required `tenant_id`, while Prisma referential actions
  apply to the relation's foreign-key fields. `RESTRICT` matches existing
  tenant-aware OrganizationUnit relations and preserves the tenant key.
- Physical service deletion was rejected because the catalog entry and its
  audit history should remain available; archive is `active = false`.
- Writing AuditLog or Outbox after the service transaction was rejected because
  it could leave an unaudited mutation or an event for a rolled-back mutation.

## Consequences

- `AppointmentService` is the only agenda entity introduced by E14-S01.
- `Resource`, `AvailabilityRule`, `Appointment`, appointment UI, and WhatsApp
  booking flows remain in their later backlog stories.
- Service mutation callers must provide a user identity and request ID for
  append-only audit records.
- A physical OrganizationUnit deletion is blocked while a service references
  it; explicit detachment is an application operation.

## Migration/rollback

The migration adds only `appointment_services`, its indexes, and tenant-aware
foreign keys. Validation replayed the pre-E14 Prisma schema into an isolated
PostgreSQL 18.4 database, applied the E14 SQL, and confirmed no difference from
the current Prisma schema. A full ordered replay from an empty database is
blocked by the UTF-8 BOM in the pre-existing migration
`20260827180000_add_ai_gateway_foundation`; that unrelated migration was left
unchanged. A rollback may drop the table only in an isolated database before
dependent data exists; applied shared-environment migrations remain append-only.

## Affected documents

`platform_docs/STATUS.md`, `platform_docs/CHANGELOG.md`, and
`platform_docs/docs/MANIFEST.md`.
