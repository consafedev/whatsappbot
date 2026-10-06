# ADR-0064 — E14-S02 Appointment Resources Foundation

**Status:** Accepted
**Date:** 2026-10-05

## Context

E14-S02 adds tenant-owned resources that appointments can use in later stories.
A resource may represent a practitioner, facility, room, equipment, or another
bookable capacity. This story establishes resource records and guarded
management endpoints; it does not calculate availability or create bookings.

## Decision

- Add `AppointmentResource` in PostgreSQL as `appointment_resources`, with
  UUIDv7 identity, required tenant ownership, optional OrganizationUnit and
  tenant User links, a resource type, a name, optional description, positive
  PostgreSQL `INTEGER` capacity (default 1), active state, JSON metadata, and
  UTC timestamps. The type defaults to `PRACTITIONER` and supports
  `PRACTITIONER`, `FACILITY`, `ROOM`, `EQUIPMENT`, and `OTHER`.
- Keep the tenant foreign key cascading with tenant deletion. Enforce optional
  OrganizationUnit and User links with composite `(tenant_id, id)` foreign
  keys and `ON DELETE RESTRICT`; each assignment must belong to the current
  tenant. A User assignment must also reference an active tenant user.
- Validate non-empty names of at most 150 characters and capacities in the
  inclusive range 1 through 2,147,483,647 before writing. Every resource query
  includes the authenticated `tenantId`; missing and foreign-tenant IDs share
  the same not-found behavior.
- Revalidate tenant operational status on mutations. Persist each create,
  update, and archive with tenant AuditLog and DomainEventOutbox entries in the
  same transaction. Mutation metadata carries the authenticated actor and
  request ID. Empty updates are rejected before writing.
- Archive is a soft deactivation (`active = false`). Lists are tenant-scoped,
  ordered by name ascending, and support type, active state, OrganizationUnit,
  User, case-insensitive name search, limit, offset, and total count.
- Expose `/api/v1/appointments/resources` CRUD/list routes behind
  `module.appointments` and the canonical tenant session, context, permission,
  and entitlement guards. Reads require `appointments.read`; mutations require
  `appointments.manage`. Responses use `{ success: true, data }`.
- Add the schema using append-only migration
  `20261006120000_add_appointment_resources_foundation`.

## Alternatives considered

- `ON DELETE SET NULL` was rejected for the composite OrganizationUnit and
  User relations because `tenant_id` is required. `RESTRICT` preserves tenant
  identity and matches existing relations; explicit unlinking sets the optional
  application field to `null`.
- Physical resource deletion was rejected to preserve the catalog and its
  audit history; archive changes `active` to false.
- Allowing inactive User assignments was rejected because practitioner
  resources must not silently remain assigned to disabled system users.

## Consequences

- E14-S02 provides resource records and tenant-safe management only.
  Availability rules, calendar exceptions, availability calculations,
  appointments, web UI, and WhatsApp booking flows remain in later stories.
- A physical OrganizationUnit or User deletion is blocked while a resource
  references it. Callers must explicitly clear the optional relation first.
- Capacity is bounded to PostgreSQL `INTEGER` so invalid values return a
  validation error instead of reaching Prisma/PostgreSQL as an internal error.

## Migration/rollback

The migration adds the resource enum, table, indexes, and tenant-aware foreign
keys. It is additive and contains no data rewrite. Rollback may drop the table
and enum only in an isolated environment before dependent data exists; applied
shared-environment migrations remain append-only.

## Affected documents

`platform_docs/STATUS.md`, `platform_docs/CHANGELOG.md`,
`platform_docs/DATA_MODEL_ERD_MVP_BACKLOG.md`, and
`platform_docs/docs/MANIFEST.md`.
