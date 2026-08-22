# ADR-0024 — E06-S07 delivery status reconciliation scope

- Status: Accepted
- Date: 2026-08-21
- Owners: Platform Engineering

## Context

E06-S07 owns provider delivery-state transitions for the canonical `Message`
created by E06-S04 and reconciled by E06-S05/E06-S06. The existing schema
already contains `Message.delivery_status`, the tenant-aware provider identity,
the optional `OutboundMessage` relation, and the `InboundMessageEvent` state;
the story therefore must not add a delivery-event table or a migration.

The implementation prompt contains three boundary ambiguities that must be
resolved against the project authority:

1. Tenant identity is requested as a raw `tenantId`, while the repository
   boundary requires a validated `TenantContext` and derives tenant filters
   from it.
2. A receipt's provider message identity is the target outbound message, but
   `InboundMessageEvent.providerMessageId` is also the existing event
   idempotency key. Reusing the target id for every receipt would collapse
   `sent`, `delivered`, `read` and `failed` notifications into one event.
3. The requested ranking assigns `failed = -1`, while also requiring a
   failure to transition `queued` or `sent`. A generic rank comparison alone
   would reject that required transition.

## Decision

- Expose `createDeliveryStatusManager(...).reconcileDeliveryStatus(...)` with
  a validated `TenantContext`, not a caller-trusted tenant string. Every read,
  update, CAS and Outbox write is tenant-scoped.
- Correlate first by `(tenant_id, channel_account_id, provider_message_id)` on
  the canonical `Message`; if its provider identity is not known yet, fall
  back to the same tuple on `OutboundMessage` and its tenant-aware canonical
  relation. A missing canonical Message raises
  `DeliveryStatusMessageNotFoundError` and leaves the source event `PENDING`.
- Accept only `STATUS_UPDATE` and `DELIVERY_RECEIPT` source events. The
  dispatcher reads the target `providerMessageId` and `statusUpdate` from
  `normalizedData`, with a narrow payload fallback for legacy normalized
  events.
- Preserve the E06-S05 echo-first order. If a retry finds the canonical
  external-human Message already created, the echo conflict is delegated to
  E06-S06, which returns its event-scoped duplicate or rejects a different
  provider-identity collision; the dispatcher does not create a second row.
- Keep the source event's provider id as the event deduplication identity for
  receipt ingestion. The normalizer/API use an explicit provider event id or a
  deterministic `receipt:<message>:<status>:<timestamp>` id for receipts,
  while `normalizedData.providerMessageId` remains the target Message id.
  This reuses the existing unique key and requires no migration.
- Use the rank map `{ queued: 0, sent: 1, delivered: 2, read: 3, failed: -1 }`.
  For `failed`, the explicit story rule is evaluated first: it is applied only
  from `queued` or `sent`; it is ignored after `delivered` or `read`. For all
  other incoming statuses, mutation requires `incomingRank > currentRank`.
  An ignored out-of-order receipt is still a successfully processed event.
- When a transition is applied and the canonical Message is linked to an
  `OutboundMessage`, `sent` sets `SENT/sentAt` and `failed` sets
  `FAILED/failedAt/lastError`. Error code has priority over error message;
  both are trimmed, control characters are replaced, and the stored value is
  capped at 500 characters.
- In one PostgreSQL transaction, claim the event with
  `PENDING -> PROCESSED` compare-and-set, mutate the canonical/queue rows,
  and append one `message.delivery_status_updated` Outbox event. A retry of
  the same processed event returns `duplicate: true` without another Outbox
  row. The Outbox payload includes the tenant id derived from `TenantContext`,
  not accepted from the caller.
- Do not add Inbox endpoints, WebSockets/SSE, rules/bot triggers, or a
  `message_delivery_event` table. Epic 07 and Epic 08 retain those boundaries.

## Alternatives considered

- Accept a raw tenant id: rejected because it would bypass the repository's
  authenticated tenant context and weaken cross-tenant fail-closed behavior.
- Compare `failed` only by rank: rejected because `failed = -1` would make the
  required `queued/sent -> failed` transition impossible.
- Store the target provider id as every receipt event's unique provider id:
  rejected because repeated status notifications would be deduplicated before
  the delivery manager could observe their progression.
- Add a delivery-history table: rejected because E06-S07's authoritative
  schema and backlog already provide the current state fields, and the story
  explicitly excludes migrations/tables.

## Consequences

Delivery state is monotonic for normal statuses, late failure receipts cannot
regress a delivered/read message, and missing outbound persistence remains
retryable. The current state is available on the canonical Message and the
operational OutboundMessage; historical receipt rows are not introduced in
this story.

## Migration/rollback

No migration. Rollback removes the manager, dispatcher route, receipt event-id
normalization adjustment, tests and documentation without changing the Prisma
schema or deleting existing messages/events.

## Verification

The normalizer unit suite and Biome static checks were executed in this
checkout. PostgreSQL integration suites and generated-Prisma typecheck were
attempted but remained blocked by the unavailable Docker Desktop engine and
the incomplete host workspace/generated Prisma dependencies; the release
status must not claim those gates as passed until rerun.

## Affected documents

`platform_docs/STATUS.md`, `platform_docs/CHANGELOG.md`, ADR-0022,
ADR-0023, `packages/messaging`, `packages/database` and the webhook ingestion
boundary.
