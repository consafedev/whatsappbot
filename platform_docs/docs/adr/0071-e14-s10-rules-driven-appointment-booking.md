# ADR-0071 — Durable rules-driven appointment conversations

- Status: Accepted design; implementation tracked separately in STATUS.
- Date: 2026-10-27
- Scope: E14-S10; extends ADR-0068/0069/0070 without replacing their booking,
  capacity, idempotency, lifecycle or reminder invariants.

## Context

Appointment mutations currently attribute dashboard actions to an active tenant
user. A customer conversation must not fabricate that identity. Inbound message
persistence and subsequent rule execution are separate commits; the current
duplicate path skips ordinary rules, so memory-only dialogue state or replaying
current rules cannot provide safe booking recovery. Rule execution also updates
Rule.updatedAt, which therefore cannot identify a configuration version.

The product requires deterministic booking, cancellation and rebooking through
the existing services, with explicit customer confirmation. The transport still
uses the existing provider abstraction; a functioning real WhatsApp adapter is
a separate P0 prerequisite and is not supplied by this decision.

## Decision

### Durable routing and conversation state

PostgreSQL owns a per-canonical-customer-Message routing/effect ledger and
tenant-owned booking flows. New inbound Message persistence creates an
UNDECIDED placeholder in the same transaction as Message, conversation updates,
event status and outbox. It also preserves the actual new-conversation flag.
Duplicate persistence never creates a placeholder. An older message without a
ledger stays on the legacy path and cannot retroactively start a booking.

Routing is fixed before any generic action. An existing live flow consumes its
turn; otherwise applicable conversation-created rules have precedence on the
first turn, followed by message-received rules in deterministic priority,
creation time and ID order. The new start_appointment_booking action is
exclusive: it is the sole action of a first_match_stop ON_MESSAGE_RECEIVED rule
and can start only when that rule is the first applicable rule. Any earlier
matching legacy rule, including evaluate_all, wins LEGACY routing. Existing
legacy actions retain their behavior; a later booking action cannot steal the
turn or produce another response.

BOOKING routing, flow/turn advancement, appointment mutation, audit/outbox and
canonical outbound persistence commit atomically. A rollback leaves the
UNDECIDED placeholder and no booking effects. A completed receipt replays its
result without another appointment or reply. LEGACY routing commits before
ordinary actions, and only its first transition permits those actions. A crash
after that decision but before a legacy action can still lose that action;
this pre-existing legacy at-most-once gap is not claimed as repaired by S10.

Flows persist typed tenant-aware conversation/contact/channel, selected
service/resource/appointment references, exact proposed start, intent, phase,
version, confirmation token and expiry. One nonterminal flow per conversation
is enforced transactionally and by a partial unique index. Bounded menu/policy
snapshots are presentation/configuration records; final relationships and
authorization are revalidated from the domain. No arbitrary customer UUID or
free-form AI output becomes a mutation command.

Numbered offers persist their phase/version and exact IDs/start times. A later
reply resolves against that offered menu, then revalidates current eligibility;
it cannot silently select a newly shifted item at the same position. Migration35
adds this bounded presentation snapshot without changing applied migration34.

Create, cancel and rebook each require explicit confirmation bound to the
current flow/version/proposal. Changed, expired or superseded proposals cannot
be confirmed with an earlier token. Expiry is evaluated from persistent state
on each turn; no process timer holds business truth. Active expired/exited flows
consume the current turn rather than passing stale confirmation to another rule.

### Authority and common mutations

Rule configuration that creates, activates or changes booking authority requires
rules.manage plus appointments.manage and applicable modules/tenant scope.
Pure deactivation/deletion may reduce automation authority without granting
appointment mutation permission. Runtime requires the current operational
tenant, appointments/automation.basic/messaging.basic/crm_lite, active matching
rule/policy and a writable trusted customer conversation. Scheduling is required
when a reminder policy is used. AUTO is mandatory; ASSISTED needs approval and
HUMAN/MONITOR, takeover and pause do not grant an automatic booking bypass.

Configured service and resource IDs bound the automated lifecycle authority as
well as available destinations. CANCEL and REBOOK offer only the same contact's
appointments whose original service and resource are both in the rule policy.
Selection and final post-lock mutation revalidate that eligibility. Broader
dashboard lifecycle permissions remain a separate existing authority.

The canonical Message and its persisted event/conversation/contact/channel
lineage supply customer identity. HTTP bodies and custom rule-test context do
not supply an automation actor. The internal rule actor retains a null creator
user, fixed whatsapp_rule source, system audit attribution and tenant-aware
flow/rule provenance. Original dashboard metadata and guards remain compatible.

Transaction-bound create/cancel/rebook variants reuse the existing central
booking/lifecycle invariants; they do not open nested transactions. Canonical
outbound persistence receives the same transaction. No provider IO occurs before
commit, and QUEUED is not delivery evidence.

The outbound worker composes the reminder and booking guards immediately before
provider dispatch. Pending booking prompts require the current live matching
rule and nonexpired flow. Each emitted turn stores its explicit outbound purpose
and exact flow phase/version; queued prompts cannot survive a later transition.
Only a receipt explicitly marked as the terminal acknowledgment may use the
closed-flow exception. Migration36 adds these fields without rewriting applied
SQL34/35; older unbound booking replies fail closed at dispatch.
A completed mutation acknowledgment or customer-exit
acknowledgment may outlive its closed flow; current tenant, required modules,
contact/channel and AUTO/takeover/pause authority still apply. This guard does
not retract provider IO that was already authorized.

### Locks, policy changes and deletion

Acquire the canonical conversation advisory lock, then its row FOR UPDATE and
reread mode/takeover/pause. The row lock also serializes legacy rule mode writers
that do not take the advisory lock. Acquire the selected/current Rule FOR SHARE
before ledger/flow row updates, then preserve the existing appointment/key,
lifecycle-row, sorted-resource and service lock order. A final mutation guard
samples time and rechecks flow/proposal eligibility after blocking business
locks. Reentrant canonical outbound uses the same transaction and lock order.

Use a normalized authorization-definition snapshot/hash (action policy,
conditions, channel/unit scope, trigger and execution mode), excluding execution
metrics/name/description, to detect policy changes. Do not upgrade a shared Rule
lock to update execution metrics during booking; immutable turn/audit/outbox
records provide execution evidence.

Flows/receipts retain an immutable originating-rule identifier and a nullable
tenant-aware live-rule FK. Hard deletion explicitly locks Rule FOR UPDATE,
detaches live ledger/flow references and terminates live flows before deletion,
retaining history and receipts. A composite FK SET NULL must not null tenant_id.
The core delete hook owns detachment; the catalog owns the rule lock and delete.

## Alternatives considered

- In-memory chat state or generic rule replay: loses state or duplicates effects.
- Fake system user: misattributes customer automation and weakens authority.
- Independent booking SQL in the rule executor: duplicates critical invariants.
- Cascade-delete history or use Rule.updatedAt as policy version: loses receipts
  or invalidates proposals on ordinary execution.
- Recover all legacy rule effects: exceeds this story and is not required to
  make new booking turns atomic and recoverable.

## Migration, rollback and validation

Use append-only additive migration(s); retain existing applied SQL and historical
BOM limitation. Validate clean schema and upgrade from the published S09 schema,
FK isolation, active-flow uniqueness and deletion retention. Roll back runtime by
disabling booking rules; retain new data and existing appointments rather than
destructively removing history.

Real PostgreSQL tests must cover normalized inbound through explicit confirmation,
create/cancel/rebook, duplicate/restart and persistence gaps, competing turns,
out-of-order/expired tokens, rule/mode/deletion contention, tenant/contact denial,
authority/module revocation, and atomic rollback. Existing full suites and mock
outbound dispatch are required gates; no real handset proof is inferred.

## Affected documents

STATUS, CHANGELOG, SYSTEM_DESIGN, SECURITY, TESTING_STRATEGY, UI_FLOWS, E14 plan,
avance_orquestador and MANIFEST are updated with implementation/evidence as S10
progresses. PRD and backlog scope remain the agreed E14 booking capability.
