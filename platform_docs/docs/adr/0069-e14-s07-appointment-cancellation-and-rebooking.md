# ADR-0069 — E14-S07 Appointment cancellation and rebooking

**Status:** Accepted
**Date:** 2026-10-26

## Context

S06 reserves capacity transactionally. Cancellation must release it without
destroying history. Rebooking must reserve a replacement atomically, preserving
the original reservation when the destination is unavailable. Repeated requests
and competing operators cannot create multiple replacements or adopt another
command's idempotency receipt.

## Decision

- Use the central appointment manager for guarded dashboard cancel/rebook
  commands. Recheck active tenant, module and same-tenant active actor before
  any mutation or receipt replay. HTTP cannot choose tenant, actor, source,
  contact, service, status or derived duration/buffer/timezone values.
- REQUESTED/CONFIRMED may become CANCELLED; repeating cancellation returns the
  existing row without another audit/outbox. Other terminal states conflict.
  Cancellation remains possible when linked configuration/contact is inactive.
- Rebooking preserves the original service/contact/notes. An optional resource
  defaults to the current resource; current validated service configuration
  supplies the replacement's snapshots. Keep original snapshots unchanged.
  Atomically mark the original RESCHEDULED and create a CONFIRMED replacement.
  Unavailable destination or audit/outbox failure rolls back all those changes.
- Store a nullable tenant-aware rescheduledFromId self-reference on replacements
  with tenant/from uniqueness, allowing at most one direct successor. The
  existing read/list surfaces expose records and linkage; no deletion or fake
  Process Engine timeline is introduced.
- Rebook receipt identity includes the original appointment in addition to the
  immutable payload and actor/source. Plain creation expects a null parent, so
  neither command can adopt the other's receipt. Matching rebook retries are
  resolved before rejecting the original's RESCHEDULED status. Opaque keys
  remain case sensitive; UUIDs use their canonical identity.
- Lock order is tenant/key advisory lock, original appointment row, canonical
  sorted distinct resource rows, shared service row. Cancellation locks the
  original then its resource. Reuse the booking implementation in the same
  transaction, without nested transactions or copied availability logic.
- Cancelled/rescheduled history consumes no active capacity. Reminder lifecycle
  integration begins S08; S07 does not claim notification delivery or suppression.

## Alternatives considered

Editing the original time destroys its historical snapshots. Cancelling first
and booking in a second transaction can lose the original reservation. A
controller-only implementation bypasses the shared tenant/capacity invariants.
Comparing only time/resource for receipt replay confuses different command types.

## Consequences

Clients receive a replacement record with lineage after successful rebooking.
Concurrent commands must use the same locking discipline. Terminal lifecycle
actions such as completing/no-show remain future work per UI_FLOWS; this story
does not broaden that scope.

## Migration/rollback

Append-only migration20261026170000_add_appointment_rebooking_history adds the
nullable self-link, scoped uniqueness and composite foreign key. Validate clean
schema and upgrade before local apply. Existing rows retain null linkage.
Rollback requires preserving replacement history; never rewrite applied SQL.
No production deployment is part of this development story.

## Affected documents

STATUS, CHANGELOG, SYSTEM_DESIGN agenda, backlog§16/§53, docs/MANIFEST,
avance_orquestador and the E14 plan/spec. Actual checks and publication belong
to the status/handoff records, not inferred from this accepted design.
