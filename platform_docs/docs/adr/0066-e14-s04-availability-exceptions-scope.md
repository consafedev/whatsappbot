# ADR-0066 — E14-S04 Availability exceptions

**Status:** Accepted
**Date:** 2026-10-25

## Context

Agenda has services, resources and weekly availability rules (ADR-0063–0065).
E14-S04 supplies calendar exceptions before slot calculation in S05. The external
advance report proposes a model; implementation must follow repository
authority, actual commands and tenant boundaries instead of treating it as code.

## Decision

- Persist tenant-owned `AppointmentAvailabilityException` with UUIDv7 identity,
  active flag, resource, `BLOCKED` or `EXTRA_AVAILABILITY`, UTC timestamptz(3)
  start/end and optional reason up to 255 characters.
- Require explicit ISO timestamp offset in manager/API string inputs. Validate
  calendar components, offset bounds and `startsAt < endsAt`. Reject offset-free
  input rather than guessing server timezone. Display/slot interpretation remains
  the tenant/unit domain's responsibility in S05.
- Treat intervals as half-open `[startsAt, endsAt)`. List `from`/`to` filters
  return intersecting intervals: `endsAt > from`, `startsAt < to`. A touching
  boundary is not an overlap. Paginate with stable start/id ordering.
- Enforce composite `(tenant_id, resource_id)` FK to the same tenant's resource,
  cascading consistently with existing rule configuration. Require active
  resource on create. Never accept a caller-supplied tenant as authority.
- Configuration deletion is physical and retains transactional audit/outbox.
  Patch rejects unknown/undefined-only fields and validates the resulting full
  interval. Serialize update/delete on the scoped database row before reading
  its before-image so concurrent patches cannot invert the stored interval.
- Use existing session/context, `module.appointments`, `appointments.read` and
  `appointments.manage` guards and API envelopes under
  `/api/v1/appointments/exceptions`.
- Every mutation rechecks operational tenant and writes AuditLog/Outbox in the
  same transaction. No slot calculation, booking, reminders, web UI or WhatsApp
  flow is delivered by S04.

## Alternatives considered

Local timestamps without zone were rejected because exceptions describe absolute
instants. Inclusive interval endpoints were rejected because adjacent windows
would collide. A separate tenant resource FK was rejected because it could not
prevent cross-tenant associations. Overwriting overlapping exceptions or
resolving their precedence belongs to S05, where blocked intervals win.

## Consequences

S04 provides tenant-safe configuration, not available slots. Explicit-offset
inputs are stricter than JavaScript Date parsing. Row locking is necessary for
partial temporal patches even though validation is deterministic. Database
identifiers use explicit short index maps to avoid PostgreSQL identifier
truncation and Prisma schema drift.

## Migration/rollback

Append-only migration
`20261025120000_add_appointment_availability_exceptions_foundation` adds enum,
table, indexes and foreign keys. Validate against an isolated pre-story schema
upgrade and current clean schema before applying to development. Historical
shared migrations remain unmodified. Rollback requires confirmation no saved
exception configuration is needed before removing the new table/type.

## Affected documents

STATUS, CHANGELOG, backlog §16.4/§53, docs/MANIFEST and avance_orquestador.
