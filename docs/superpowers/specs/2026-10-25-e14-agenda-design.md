# E14 — Agenda completion

Date: 2026-10-25. Authority: project skill, approved ADRs, PRD, SYSTEM_DESIGN
§20, backlog §16/§53, SECURITY, UI_FLOWS §30/31, TESTING_STRATEGY.
User explicitly authorized autonomous execution, one epic, per-story audits,
checks, documentation, commit and push. No design approval pause is required.

## Intent and scope

Complete the active Agenda epic from E14-S04 through E14-S10 using the existing
tenant API, PostgreSQL, audit/outbox, scheduler and messaging boundaries.
S01–S03 already exist at fb8639d. No real messaging transport, other vertical
module or dependency graph service is added in this epic. Existing backlog
Mermaid dependencies plus code search suffice; another graph tool has no
demonstrated benefit. This is continuation of the current milestone, not a
claim that P0 commercial gates (real Baileys and restore drill) are complete.

## Decisions and alternatives

Extend existing managers and guarded API; reuse existing web shell, rules and
scheduler. Reject a parallel agenda service and an additional queue/runtime:
they duplicate existing authority and increase operation cost. Business truth
stays in PostgreSQL. Caller-selected IDs never supply tenant authority.

- S04: tenant-owned exceptions, BLOCKED/EXTRA_AVAILABILITY, absolute ISO
  timestamps with explicit offset, half-open intervals [startsAt, endsAt),
  same-tenant active resource, optional reason <=255, CRUD with audit/outbox.
  Boundaries touching exactly do not overlap. Physical deletion is for
  configuration only, with transactional audit before removal.
- S05: pure deterministic slot calculation backed by tenant-scoped data.
  Resolve timezone from rule, resource unit, service unit, tenant default.
  Add nullable serviceId to rules with composite tenant FK, as ADR-0065
  deferred. Service/resource units must be compatible. Merge matching windows
  without adding capacities; capacity is bounded by resource capacity. Blocked
  exceptions override extra availability. Include service duration and buffers;
  subtract occupied intervals and respect capacity. Honor configured business
  hours. Correct verified shared-evaluator defects: overnight weekday denotes
  opening day and carries into the next morning, holidays apply even with an
  empty weekly schedule, and a holiday opening day cannot create a next-day
  carry. Preserve old callers' invalid-zone fallback; new query is strict.
  Bound request range/result size. DST gaps produce no invalid slot;
  ambiguous times resolve deterministically and return absolute timestamps.
- S06: persist Appointment with tenant-aware FKs, timezone/duration/buffer
  snapshots, source and idempotency key. Booking rechecks active tenant,
  entitlement, associations and availability inside a transaction protected by
  a resource-scoped PostgreSQL lock. Same idempotency key with different input
  is a conflict. Overlapping bookings cannot exceed capacity, even across
  different service durations. Every mutation writes audit and outbox.
- S07: cancellation is idempotent; rebook locks old/new resources in stable
  order, atomically supersedes old appointment and reserves replacement, with
  history retained and no capacity leak on rollback. Cancelled/rescheduled rows
  do not occupy capacity. Other terminal status changes remain explicit future
  work unless required by UI_FLOWS.
- S08: persist reminders through existing WorkflowOrchestrator/ScheduledTask
  contracts. Jobs contain tenant/entity identifiers. Recheck current appointment,
  module, channel/contact and status before enqueuing existing outbound flow.
  Cancellation/rebook invalidates old reminders. No direct provider calls and
  no in-memory business timers. Idempotent external send commands.
- S09: /app/appointments with day/week/list, explicit timezone, filters,
  create/detail/cancel/rebook, services/resources/rules/exceptions configuration
  needed to operate agenda; existing permission/module shell, real API data,
  loading/empty/error/permission/degraded states, keyboard and responsive layout.
- S10: rules-driven WhatsApp booking through the same application services.
  Contact/channel from trusted canonical message/conversation lineage; only
  AUTO grants automatic authority. Deterministic selection and explicit
  confirmation before create/cancel/rebook; lifecycle is limited to that
  contact and configured service/resource allowlists. Atomic UNDECIDED ledger,
  immutable routing/effect receipts, versioned menu offers and transaction-bound
  central mutations follow ADR-0071. Preserve earlier legacy rule matching and
  canonical context when selecting the first applicable action. Bind queued
  replies to purpose/phase/version and recheck current authority after blocking
  locks; obsolete prompts cannot use a terminal-ack exception. Persistent flow
  context and deduplicated events. No free-form AI commands. Test normalized inbound to
  outbound/appointment with supported mock infrastructure; real handset proof
  remains blocked by the separately missing real Baileys transport.

## Security and operational acceptance

Every tenant API uses session/context + appointments permission +
module.appointments. Tests include hostile tenant IDs, cross-tenant references,
suspended tenants, missing permissions, repeated scalar query parameters,
invalid dates/ranges, concurrent booking and transactional rollback.
No secret values in logs or documentation. Do not mutate shared migration
history. Validate additive migrations on clean schema and pre-story upgrade.
Existing historical migration failures must be recorded, never hidden.

## Orchestration handoff

platform_docs/avance_orquestador.md is the stable coordination document for
Codex, Antigravity or other developers. Record ownership, base branch/commit,
one active epic, story evidence, exact commits, push status, remaining scope
and blockers. Update per story and at epic close. STATUS/CHANGELOG/backlog and
MANIFEST remain synchronized. No claims based only on the external report.
