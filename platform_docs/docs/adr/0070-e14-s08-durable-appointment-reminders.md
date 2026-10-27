# ADR-0070 — E14-S08 Durable appointment reminders

**Status:** Accepted
**Date:** 2026-10-26

## Context

Agenda bookings and lifecycle are transactional. Reminder intent must survive
restart, Redis loss and duplicated work without sending stale notifications.
ScheduledTask, its BullMQ worker/reconciler and canonical outbound persistence
already exist. The workflows package previously declared only a boundary type;
the conceptual WorkflowOrchestrator was not an implemented interface.

Installed stack inspected: Prisma7.9.1 and BullMQ6.3.4. Technical references:
[BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs) and
[workers](https://docs.bullmq.io/guide/workers). No library upgrade or new
version-specific API is required by this decision.

## Decision

- Enrollment is explicit optional reminderPolicy with an owned same-contact
  conversation and 1–3 distinct offsetMinutes, each an integer1–10080. Normalize
  UUIDs and sort offsets. The server chooses content, actor and recipient;
  internal notes are excluded. Persist immutable normalized policy intent on
  the appointment and include it in receipt identity. No policy remains valid.
- Explicit enrollment requires appointments, scheduling, messaging.basic and
  crm_lite modules, matching the existing scheduler/send boundaries. Existing
  appointments.manage authorizes this bounded domain notification policy;
  read uses appointments.read. No generic messaging authority is inferred.
- Rebooking inherits the original policy. Cancel/rebook suppress old reminders
  and cancel pending/processing task references atomically with the lifecycle.
  Inherited unavailable capabilities/targets suppress replacement reminders
  instead of preventing an otherwise valid rebooking. Cancellation stays usable
  with disabled notification capabilities. Past-due offsets are retained as
  suppressed history, without an immediate catch-up message or fabricated task.
- AppointmentReminder has tenant-aware appointment/conversation/task/outbound
  references and unique tenant/appointment/offset, task and outbound links.
  Track notification generation and suppression separately from actual outbound
  delivery; QUEUED is not SENT. Nullable task links represent suppressed offsets.
  Current outbound provider confirmation remains the delivery evidence.
- Introduce the real narrow WorkflowOrchestrator surface schedule/cancel/
  getStatus. A transaction-bound PostgreSQL adapter stores intention in the
  existing ScheduledTask table; the existing reconciler/BullMQ worker supplies
  execution after commit. Stable task UUID equals its reminder UUID, with an
  explicit tenant-aware taskId FK. Scheduling the same identity is idempotent
  only for matching intent. No second runtime, Redis write inside the booking
  transaction, or new external dependency is introduced.
- Preserve immutable server-owned workflowRunAt separately from ScheduledTask's
  operational scheduledFor, which stale recovery/retry can move. Compare
  idempotent scheduling against the original intention, not its mutable retry
  occurrence. Existing generic tasks keep null; no unrelated fields or opaque
  payload values are repurposed. Due eligibility uses the reminder's original
  dueAt while current claimed occurrence checks use persisted task state.
- This concretizes only the required portion of the conceptual interface in
  PRD§25/System Design§17/backlog§15. Conceptual enqueue/retry/signal/startWorkflow
  methods are not claimed implemented and have no placeholder throwing methods.
  PostgreSQL owns schedule truth; BullMQ remains the execution adapter under
  ADR-0005. This split preserves atomic business intent before external enqueue.
- Reserve APPOINTMENT_REMINDER from generic ScheduledTask HTTP creation,
  cancellation and retry. Generic scheduler UI exposes it as domain managed;
  its history/read surfaces remain. The worker independently derives the child
  from the claimed persisted taskId and verifies type/tenant/time/linkage;
  copied payload IDs do not grant authority. Preserve the scheduling entitlement
  gate of ADR-0059; suppression-aware internal handling still checks it.
- Due execution and final dispatch authorization take conversation advisory lock
  first, then appointment/reminder locks. Recheck active tenant/modules, current
  appointment and reminder/time, active same contact, writable conversation,
  usable channel, current phone and automation/takeover policy. HUMAN/MONITOR
  and active takeover suppress. Automatic dispatch requires AUTO; ASSISTED
  requires human approval per PRD§19/System Design, so S08 suppresses it with
  an explicit reason rather than inventing an approval workflow or auto-sending.
  Dashboard lifecycle never acquires conversation
  locks after appointment/resource locks, avoiding inversion with S10.
- Reuse canonical outbound persistence inside the caller's transaction. Create
  one Message/OutboundMessage/inbox projection and reminder link with stable
  tenant-scoped key and system/automation attribution. No nested transaction,
  copied projection implementation or provider IO in the business transaction.
- Revalidate linked reminders after queueing, after rate limiting and before
  provider IO. Cancellation committed before authorization prevents dispatch.
  IO authorized before a concurrent cancellation can finish; never promise its
  retraction. Retries revalidate again. Do not hold a database transaction over
  network IO or claim exactly-once provider delivery without provider support.
- Handle PROCESSING-to-CANCELLED races without task resurrection. Task SUCCESS
  means its handler finished; child/outbound state separately establishes
  suppression, queueing, provider failure or provider-confirmed send. Preserve
  bounded recovery/retry and stable non-PII failure reasons.

## Alternatives considered

In-memory timers lose business intention on restart. Redis-only schedules
cannot participate in a booking transaction. Direct provider calls bypass
canonical messages, delivery tracking and takeover guards. UI-only protection
cannot prevent forged internal tasks. Checking only when queueing allows stale
pending messages to escape after cancellation. A general workflow framework or
Temporal runtime is unnecessary for this bounded story.

## Consequences

Reminder enrollment has explicit module dependencies. Suppressed offsets retain
traceable reasons. Generic scheduler actions cannot bypass agenda lifecycle.
Availability remains advisory until booking, and reminder authorization remains
distinct from external delivery confirmation. Real handset validation remains
blocked by the separately missing real Baileys transport; mock provider results
must be labeled as such.

## Migration/rollback

Append-only migration20261026210000_add_appointment_reminders adds policy/child
persistence and tenant-aware links. A separate append-only migration
20261026220000_add_scheduled_task_workflow_run_at preserves immutable workflow
schedule intention after retry/recovery; the already-applied first SQL is not
edited. Validate isolated clean schema and ordered pre-story
upgrade before local apply. Stop reminder producers/workers before rollback;
preserve booked appointments, history and pending delivery evidence. Never edit
already-applied migration history. No production deployment is part of S08.

## Affected documents

STATUS, CHANGELOG, SYSTEM_DESIGN agenda/workflows, backlog§15/§16/§53,
UI_FLOWS reminder policy, docs/MANIFEST, avance_orquestador and E14 plan/spec.
Accepted design is not a claim that tests, migration or dispatch have passed;
actual evidence and publication remain in the status/handoff records.
