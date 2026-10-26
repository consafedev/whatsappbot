# ADR-0068 — E14-S06 Transactional appointment booking

**Status:** Accepted
**Date:** 2026-10-26

## Context

S05 returns advisory availability. Persisted bookings need tenant-aware
references, durable occupancy and concurrency protection independent of UI,
queues and messaging providers. Service/resource configuration can change after
booking; a retry must not create duplicate reservations or side effects.

## Decision

- Add tenant-owned Appointment persistence with UUIDv7, tenant-aware contact,
  service, resource, OrganizationUnit and creator references, stable timestamps,
  status/confirmation, notes, source and tenant-scoped idempotency uniqueness.
  The conceptual resource relation remains nullable, while this MVP create
  command requires a concrete active resource. Process Engine integration is
  deferred until its model exists; no orphan process reference is introduced.
- Persist duration, before/after buffer, timezone and occupied-interval snapshots
  with the booking. Later service changes do not rewrite existing occupancy.
  New dashboard bookings are confirmed; lifecycle changes start in S07.
- Derive tenant/creator/source from trusted application context. HTTP cannot
  supply actor, tenant, source, status, duration, end time or buffers. Current
  dashboard command requires an active same-tenant user/contact and active
  compatible service/resource. S10 extends customer/rule provenance without
  inventing a human user.
- Serialize a tenant/idempotency key before looking up its receipt. Matching
  normalized immutable stored command fields return the same row without new
  audit/outbox, even if configuration or capacity changed afterward. Different
  payload reuse is a conflict. Recheck current authority before replay.
  UUID hex spelling case does not alter identity: compare canonical UUIDs and
  canonicalize tenant spelling in the lock namespace. Opaque idempotency keys
  remain case sensitive.
- Lock the tenant's resource row before availability read and insert. Lock the
  service for shared read so concurrent duration/buffer edits cannot disagree
  with the captured snapshot. Evaluate the same S05 domain calculation inside
  the transaction against persisted occupied intervals. Each booking consumes
  one capacity unit; peak concurrent overlap determines remaining capacity.
- Use a consistent lock order for later reuse: idempotency key, appointment
  row when lifecycle requires it, sorted resource IDs, shared service row.
  Keep transaction implementation reusable for S07 without nested transactions.
- Resource capacity decrease shares the resource lock and rejects a decrease
  below peak future committed occupancy. Equal-time event deltas are grouped
  for half-open intervals. This prevents capacity-edit/booking races and
  preserves already committed appointments; cancel/rebook excess first.
- Creation, AuditLog and Outbox commit together. Audit/outbox retain operational
  IDs/time/status metadata without duplicating contact PII or notes. Database
  checks protect positive intervals and nonnegative duration/buffer snapshots.
- Expose guarded create/list/detail under /api/v1/appointments, preserving
  module.appointments and appointments.manage/read. Static configuration and
  availability routes precede dynamic :id. ADR-0017's scoped-grant fail-closed
  behavior is preserved; this story does not redesign RBAC.

## Alternatives considered

UI validation alone cannot serialize writers. A count of all intersecting
appointments overstates occupancy when their occupied intervals do not overlap
each other; use peak occupancy. Recomputing old bookings from mutable service
settings destroys historical truth. A second booking path in controllers,
workers or provider SDKs would bypass the shared invariants.

## Consequences

Returned availability remains advisory; only the transactional command reserves
capacity. Unsafe resource capacity reduction is a conflict. Schema supports the
conceptual statuses, while cancellation/rebooking/reminders and channel flows
remain subsequent stories. Tenant-owned data is preserved on module disable.

## Migration/rollback

Append-only migration20261026120000_add_appointments_foundation creates the
table, enums, checks, scoped indexes and tenant-aware foreign keys. Validate
isolated clean schema and pre-story upgrade before development deployment.
Rollback requires confirming no reservations/history are needed before removing
the new data; shared migration history is not edited. No production deployment
is authorized by this development story.

## Affected documents

STATUS, CHANGELOG, SYSTEM_DESIGN agenda, backlog§16/§53, docs/MANIFEST,
avance_orquestador and the E14 implementation plan/spec.
