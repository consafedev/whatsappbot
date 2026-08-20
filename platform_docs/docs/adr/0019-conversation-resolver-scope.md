# ADR-0019 — E06-S02 Conversation resolver scope and canonical lifecycle

- Status: Accepted
- Date: 2026-08-19
- Owners: Platform Engineering

## Context

The implementation prompt for E06-S02 combines a Conversation entity, message
persistence, inbound processing state changes, Inbox queries, assignment and
outbound reply endpoints. The project backlog is authoritative for story
boundaries and separates these capabilities: E06-S02 is the Conversation
resolver, E06-S03 persists inbound messages, and Epic 07 owns Inbox queries,
reply and assignment.

The prompt also names `OPEN|PENDING|RESOLVED|SNOOZED` and `ConversationMessage`,
while the current PRD/backlog define Conversation lifecycle as
`new|open|pending|closed`, automation modes as `AUTO|ASSISTED|HUMAN|MONITOR`,
and Message as a later concept. Existing Prisma migrations use restrictive
foreign keys and the shared tenant schema, not cascade deletion.

## Decision

E06-S02 implements only the tenant-safe Conversation foundation and resolver:

- `Conversation` is persisted with the canonical PRD/backlog lifecycle,
  automation mode, assignment projections, channel/contact references,
  timestamps, metadata and UUIDv7 identity.
- Inbound routing resolves the sender from the tenant-scoped
  `InboundMessageEvent`, reuses or creates the tenant Contact in the same
  transaction, and reuses an active Conversation for the same tenant/channel/
  contact policy. A pending or new conversation is reopened as `open`; a
  closed conversation starts a new thread.
- A PostgreSQL transaction advisory lock serializes resolution for the
  tenant/channel/contact key. Audit and DomainEventOutbox entries are atomic
  with the conversation mutation.
- The resolver requires the effective `module.messaging.basic` and
  `module.crm_lite` entitlements, validates an active channel and operational
  tenant, and never trusts a caller-supplied tenant or cross-tenant relation.
- Foreign keys use tenant-aware composite references where the existing schema
  supports them and `ON DELETE RESTRICT` to preserve the repository's current
  source-of-truth and audit boundaries.

`ConversationMessage`, inbound event processing completion, message content
projection, Conversation list/detail/messages/status/assign/send APIs, UI,
WebSockets/SSE and bot/AI behavior remain deferred to E06-S03/Epic 07 or their
own documented stories. The inbound event intentionally remains `PENDING`.

## Consequences

The resolver is usable by a future inbound-message persistence service without
duplicating Contact or Conversation creation. It does not claim that a message
was stored or processed, so E06-S03 retains ownership of provider-message
deduplication, message rows and event completion. Inbox APIs are not invented
before their permissions and story boundaries exist.

The extra composite unique indexes on ChannelAccount and Contact are required
to make new Conversation foreign keys tenant-aware at the database boundary.

## Migration and rollback

Migration `20260819230000_add_conversations_foundation` adds the Conversation
table, its indexes and tenant-aware foreign keys, plus the composite unique
indexes required by those references. Rollback, if ever required, must first
remove Conversation rows and then remove the Conversation table and the two
new composite unique indexes; no existing Contact or ChannelAccount data is
deleted by the migration itself.
