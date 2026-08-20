# ADR-0021 — E06-S04 outbound Message create-before-send scope

- Status: Accepted
- Date: 2026-08-20
- Owners: Platform Engineering

## Context

The E06-S04 implementation prompt mixes outbound persistence with Inbox
message listing, dashboard reply endpoints, `conversations.read` and a
non-catalogued `conversations.manage` permission, unread/preview projections
and a `message.sent` event. The backlog defines E06-S04 only as **Persist
outbound messages — Create-before-send**. Inbox queries, dashboard reply and
assignment belong to Epic 07, while provider delivery state is E06-S07.

E05-S03 already persists the operational `OutboundMessage` queue. E06-S04
must add the canonical `Message` timeline row without replacing that queue or
calling a provider before the database transaction commits. A message created
before dispatch does not have a provider timestamp or provider message id yet.

## Decision

- Link one canonical `Message` to one `OutboundMessage` using
  `(tenant_id, outbound_message_id)` and restrictive foreign keys. Existing
  E05-S03 queue rows remain valid without a canonical message until they are
  created through this flow.
- Make `Message.provider_timestamp` nullable. Inbound persistence still rejects
  an inbound row without its normalized provider timestamp; outbound creation
  leaves it null until a later provider/reconciliation story supplies it.
- Persist outbound messages with the canonical values `direction = outbound`,
  `origin = human_app` for a tenant user (or `automation` for system work),
  `actor_type = tenant_user|system`, and `delivery_status = queued`.
- Use a tenant-scoped idempotency key. The canonical Message and operational
  OutboundMessage are created and correlated in one transaction. Conversation
  outbound/human/automation timestamps and a `message.queued` Outbox event are
  updated in that same transaction.
- Serialize sends for the same tenant/channel/contact with the existing
  PostgreSQL advisory lock used by inbound conversation routing.
- Do not emit `message.sent` at create-before-send time: that event would claim
  provider delivery that has not happened. E06-S07/provider processing owns
  delivery transitions and any confirmed sent event.
- Do not add Inbox pagination, reply HTTP endpoints, WebSockets/SSE, UI,
  unread/preview fields, or change the RBAC catalog in E06-S04. The existing
  `conversations.read` and `conversations.reply` keys remain unchanged; the
  prompt's `conversations.manage` key is not invented.

## Alternatives considered

- Reuse only `OutboundMessage`: rejected because the canonical conversation
  timeline would not contain the outbound message before dispatch.
- Create `Message` after provider send: rejected because a provider failure or
  process crash would lose the durable intent and violate create-before-send.
- Add the requested Epic 07 API now: rejected because it would advance story
  scope and would require deciding whether the canonical `conversations.reply`
  key or a new write key should protect the endpoint.

## Consequences

The next echo/delivery stories can correlate provider events through both the
internal canonical Message id and the operational queue/provider id. A future
dashboard reply endpoint can call this manager and add transport-level audit
metadata at its application boundary. The existing channel-level E05-S03 API
continues to work, but it does not retroactively create conversation messages.

## Migration/rollback

Migrations `20260820120000_add_outbound_message_correlation` and
`20260820121000_align_outbound_message_fk_name` make
`provider_timestamp` nullable, add the tenant-aware outbound correlation
column and indexes/uniques, add the restrictive composite foreign key, and
align its physical name with Prisma. Rollback must first remove linked Message
rows/column and correlation indexes; it must not delete existing
`OutboundMessage` rows.

## Affected documents

`platform_docs/STATUS.md`, `platform_docs/CHANGELOG.md`,
`platform_docs/docs/adr/0020-inbound-message-persistence-scope.md`, and the
Prisma schema/migration.
