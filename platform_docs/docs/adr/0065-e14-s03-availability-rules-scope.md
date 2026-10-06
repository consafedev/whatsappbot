# ADR-0065 — E14-S03 Appointment Availability Rules Foundation

**Status:** Accepted
**Date:** 2026-10-05

## Context

E14-S03 adds tenant-owned weekly availability rules for appointment resources.
The story provides persistence and guarded management endpoints so later
stories can calculate available slots. It does not calculate availability,
apply calendar exceptions, or create appointments.

## Decision

- Add `AppointmentAvailabilityRule` as `appointment_availability_rules` with
  UUIDv7 identity, required tenant and resource IDs, weekday, local start/end
  times, optional inclusive date bounds, optional IANA timezone, positive
  PostgreSQL `INTEGER` capacity, active state, and UTC timestamps.
- Store weekdays as integers `0` through `6`, where `0` is Sunday and `6` is
  Saturday. Store local times as strict `HH:mm`; a rule must start before it
  ends on the same day. Cross-midnight schedules require two rules.
- Store optional date bounds as PostgreSQL `DATE`. A start date cannot be after
  an end date. A rule may have no bounds, either bound, or both. Validate an
  optional timezone as an IANA zone before writing.
- Require capacity from `1` through `2,147,483,647`. At creation, require the
  linked `AppointmentResource` to be active and owned by the same tenant.
- Enforce `(tenant_id, resource_id)` against
  `appointment_resources(tenant_id, id)` with a cascading composite foreign
  key. Add a unique `(tenant_id, id)` key to `appointment_resources` so
  PostgreSQL can enforce this tenant-aware reference; keep its existing UUID
  primary key.
- Include the authenticated `tenantId` in every read and mutation. Revalidate
  tenant operational status before mutations. Persist AuditLog and Outbox
  records atomically with create, update, and delete, using the authenticated
  actor and request ID.
- Expose create, detail, list, update, and delete under
  `/api/v1/appointments/availability-rules`, guarded by
  `module.appointments`, tenant session/context and canonical permissions:
  `appointments.read` for reads and `appointments.manage` for mutations.
- Creating a rule never overwrites another rule. Updates and deletes target
  only the requested rule ID. Overlapping rules remain independent; this story
  defines no precedence or conflict resolution. E14-S05 defines how rules are
  consumed for availability calculations.
- Delete the requested rule physically and record its before-summary and
  deletion event in the same transaction. This is a configuration record;
  appointments and historical bookings are outside this story.
- Add the schema with append-only migration
  `20261006180000_add_appointment_availability_rules_foundation`.
- Register the conflict with the PRD §79 `AvailabilityRule` field list: the
  PRD lists a `service` link, while this story binds rules to a tenant resource
  only. The link is deferred to E14-S05 as an additive nullable `service_id`
  with a tenant-aware foreign key, to be added only if slot calculation requires
  per-service rules.

## Alternatives considered

- A single rule spanning midnight was rejected because it complicates weekday
  attribution and later slot calculations; callers represent that schedule
  with two rules.
- Automatic replacement or merging of overlapping rules was rejected because
  no precedence policy is established in this story.
- A standalone resource foreign key was rejected because it would not enforce
  that the resource and rule share the same tenant.

## Consequences

- E14-S03 supplies storage and tenant-safe management only. Availability
  calculation, calendar exceptions, appointment lifecycle, UI, and WhatsApp
  booking flows remain out of scope.
- The composite foreign key requires a tenant-aware unique key on the resource
  table in addition to its primary key.
- Overlap semantics remain deliberately unspecified until E14-S05 consumes
  these rules.
- The PRD §79 `service` field is deferred, not dropped: E14-S05 must resolve
  the registered conflict with an additive migration or an explicit PRD update.

## Migration/rollback

The additive migration creates the composite resource key, rule table, indexes,
and tenant-aware foreign keys. Rollback may remove the rule table and its
indexes, and the resource composite index only after confirming no dependent
schema or data requires it. Applied shared-environment migrations remain
append-only.

## Affected documents

`platform_docs/STATUS.md`, `platform_docs/CHANGELOG.md`,
`platform_docs/DATA_MODEL_ERD_MVP_BACKLOG.md`, and
`platform_docs/docs/MANIFEST.md`.
