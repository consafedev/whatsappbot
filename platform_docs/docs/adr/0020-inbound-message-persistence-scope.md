# ADR-0020 — E06-S03 inbound Message persistence scope

- Status: Accepted
- Date: 2026-08-20
- Owners: Platform Engineering

## Context

E06-S03 persists inbound messages after E06-S02 resolves the tenant-scoped
Contact and Conversation. The implementation prompt called the entity
`ConversationMessage`, requested provider-specific sender fields, cascade
deletion, preview/unread projections, and Inbox/outbound endpoints. The
project authority defines the shared entity as `Message`, canonical fields as
`direction`, `origin`, `actor_type`, `text_body`, `structured_payload`,
`provider_timestamp`, and `delivery_status`, and assigns outbound persistence
to E06-S04 and Inbox APIs to Epic 07.

## Decision

- Persist the canonical `Message` model, not a parallel `ConversationMessage`
  model.
- Keep `tenant_id` mandatory and use tenant-aware composite foreign keys for
  Conversation, ChannelAccount, Contact, and InboundMessageEvent.
- Use `ON DELETE RESTRICT` consistently with the existing source-of-truth and
  audit boundaries; messages are historical records.
- Deduplicate provider messages by tenant/channel/provider ID and guarantee a
  single inbound message per inbound event.
- Resolve the Conversation and persist the Message, timestamp projections,
  `PENDING -> PROCESSED` event transition, and `message.received` Outbox row
  in one PostgreSQL transaction.
- Do not add Inbox list/detail/reply endpoints, unread/preview projections,
  outbound enqueueing, WebSockets/SSE, UI, or automation behavior in E06-S03.

## Consequences

Inbound webhook processing now has a durable message timeline row and an
atomic event for later rules/inbox consumers. Retries return the existing
message without another row or Outbox event. Inbox pagination and dashboard
reply remain future stories and must consume this canonical model. Outbound
create-before-send is defined separately in ADR-0021 and links the canonical
outbound Message to the existing queue.

## Migration/rollback

Migration `20260820100000_add_messages_foundation` adds the `message` table,
tenant-aware uniqueness/indexes, supporting composite unique indexes on the
existing Conversation and InboundMessageEvent tables, and restrictive foreign
keys. A rollback must remove Message rows/table and then remove only the
supporting composite indexes; it must not delete existing conversations or
inbound events.

## Affected documents

`platform_docs/PRD.md`, `platform_docs/DATA_MODEL_ERD_MVP_BACKLOG.md`,
`platform_docs/STATUS.md`, `platform_docs/CHANGELOG.md`,
`platform_docs/docs/adr/0019-conversation-resolver-scope.md`, and the Prisma
schema/migration.
