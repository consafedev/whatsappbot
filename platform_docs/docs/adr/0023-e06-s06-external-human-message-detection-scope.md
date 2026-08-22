# ADR-0023 — E06-S06 external human message detection scope

- Status: Accepted
- Date: 2026-08-21
- Owners: Platform Engineering

## Context

E06-S05 deliberately left an unmatched provider `fromMe` event pending. The
backlog defines the next story, E06-S06, as **External human detection**;
E06-S07 owns delivery-state transitions. The E06-S06 prompt asks for a
canonical outbound `Message`, contact/conversation resolution, event
completion and an Outbox notification, but it also contains names and
semantics that do not exist in the project authority.

## Decision

- Add `createExternalHumanMessageManager(...)` with a validated `TenantContext`
  and an optional Prisma transaction. The manager revalidates operational
  tenant status, `module.messaging.basic` and `module.crm_lite`, validates the
  tenant-owned source event and provider identity, and completes the event by
  compare-and-set from `PENDING` to `PROCESSED`.
- Keep the dispatcher echo-first: E06-S05 remains responsible for known
  platform sends. Only an unmatched or already-processed-without-message
  external event reaches E06-S06. A provider identity that becomes a known
  platform echo during the fallback is retried through E06-S05.
- Resolve the Contact from the event `recipientPhone`, because an unmatched
  outbound device message is sent to the recipient. Reuse the existing
  tenant/channel/contact advisory lock and lifecycle resolver. Pending/new
  conversations reopen as `open`; a `closed` conversation starts a new thread,
  as defined by ADR-0019.
- Persist one canonical Message with `direction = outbound`,
  `origin = human_external_device`, `actor_type = external_human_unknown`,
  `actor_id = null`, `delivery_status = sent`, provider identity/timestamp,
  text/structured content, and the source `inboundEventId`. No
  `OutboundMessage` row is created for a device-originated send.
- Update only existing monotonic Conversation projections:
  `lastMessageAt`, `lastOutboundAt` and `lastHumanMessageAt`. Append one
  `message.external_human_detected` Outbox event without message content.
- Do not change automation mode or assign a human automatically. The current
  repository has no E06-S06 policy contract for takeover/assignment; that
  behavior remains a later policy/story concern.
- Use the existing E06-S03/E06-S04 schema. No migration is required.

## Prompt corrections required by project authority

- The prompt's `actorType = external` is replaced by the canonical
  `external_human_unknown` actor type from the PRD/backlog. The origin remains
  `human_external_device`.
- The prompt's `lastMessagePreview` is not implemented because the current
  Conversation model and backlog do not define that field. No speculative
  column or Inbox projection is added.
- The prompt's raw `tenantId` input is not trusted. Tenant identity is derived
  from the authenticated `TenantContext`, consistent with the tenant-data
  boundary.
- The prompt's request to route the outbound event through the inbound
  sender-phone resolver is corrected with a small outbound-specific resolver
  that uses `recipientPhone`; reusing the inbound sender would attach the
  message to the wrong contact.
- A closed conversation is not mutated back to open. The canonical lifecycle
  starts a new thread after `closed`, per ADR-0019.

## Alternatives considered

- Create a second platform echo Message: rejected because E06-S05 already
  correlates known provider identities to the E06-S04 canonical row.
- Store the event as a customer inbound message: rejected because `fromMe`
  identifies the connected account as the sender and the canonical origin is
  `human_external_device`.
- Add preview/unread fields or Inbox/API/WebSockets/SSE: rejected because
  those belong to later story boundaries and would introduce schema/surface
  area outside E06-S06.
- Implement delivery receipts or monotonic receipt transitions here: rejected
  because E06-S07 owns delivery state.

## Consequences

Unmatched device-originated sends become durable, tenant-scoped timeline
messages, are associated with the recipient's Contact and Conversation, and
can be consumed through the Outbox without duplicating platform sends.
Retries return the existing Message without a second row or notification.
Takeover policy and delivery receipts remain explicit follow-up work.

## Migration/rollback

No migration. The existing Message provider identity/inbound-event uniques and
Conversation timestamp fields are sufficient. Rollback removes the manager,
dispatcher fallback and its Outbox event behavior without changing the schema.

## Affected documents

`platform_docs/STATUS.md`, `platform_docs/CHANGELOG.md`, ADR-0022 and the
E06-S03/E06-S04 canonical model documentation.
