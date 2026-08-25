# ADR-0027 — E07-S03 Inbox agent reply and outbound dispatch scope

- Status: Accepted
- Date: 2026-08-24
- Owners: Platform Engineering

## Context

E07-S03 is the Epic 07 story for replying from the dashboard Inbox. The
canonical database boundary already provides
`createOutboundConversationMessageManager(...)`, which creates the durable
canonical `Message` and operational `OutboundMessage` together before any
provider dispatch. The existing schema, tenant-aware relations, idempotency
unique and transactional Outbox are sufficient; this story does not need a
Prisma migration.

The implementation prompt names `conversations.manage` or `contacts.write`
as possible permissions and refers to `TenantAuthGuard` and
`TenantAuditLog`. The project documentation and code have a closed RBAC
catalog with `conversations.reply`, use the ordered
`TenantUserSessionGuard`/`TenantContextGuard`/`TenantPermissionGuard`/
`TenantEntitlementGuard` chain, and expose tenant audit through the
`AuditLog` model and `createTenantDataAccess(...).audit` writer. Those are the
authoritative names used here; no permission, guard or model alias was
invented.

## Decision

- Add `POST /api/v1/inbox/conversations/:conversationId/messages` to the
  existing Inbox controller. The endpoint requires the canonical
  `conversations.reply` permission and both
  `module.messaging.basic` and `module.crm_lite` entitlements.
- Wire a dedicated
  `OUTBOUND_CONVERSATION_MESSAGE_MANAGER` provider to the existing database
  manager instead of coupling the read-only Inbox query manager to mutation
  behavior.
- Derive tenant context and actor identity exclusively from the authenticated
  request. A conversation absent from that tenant, including a cross-tenant
  id, maps to the existing generic 404 contract.
- Accept only the closed request body fields `textBody`, `mediaUrl`, `caption`
  and `idempotencyKey`. Text and caption are normalized/trimmed, bounded and
  reject disallowed control characters. Media URLs must be public HTTPS URLs;
  private, loopback and local/internal hosts are rejected. At least a text
  body or media URL is required.
- Return HTTP 201 with only the requested message projection and
  `outboundMessageId`. The message is `outbound`, uses `human_app` and
  `tenant_user` for an authenticated human actor, and starts with
  `deliveryStatus = queued`; this does not claim provider delivery.
- Reuse the manager's tenant-scoped idempotency behavior. Repeating the same
  key and equivalent content returns the existing canonical message and
  queue row without a second `message.queued` event or audit record. A key
  reused for different content is a conflict.
- In the same domain transaction, record `conversation.message_sent` through
  the tenant audit writer with a body-free summary and append `message.queued`
  to the transactional DomainEventOutbox. The audit action records the
  authorized dashboard mutation; confirmed provider delivery remains owned by
  the delivery-status/provider flow.
- Map inactive conversations and inactive channels to HTTP 400. Conversation
  lifecycle changes, assignment, realtime transports, UI and provider calls
  remain outside this story.

## Scope reconciliation and naming

- The backlog and PRD define E07-S03 as **Reply from dashboard** protected by
  `conversations.reply`. The prompt's `conversations.manage` does not exist in
  the catalog, and `contacts.write` describes contact mutations rather than a
  conversation reply. The implementation therefore uses `conversations.reply`
  and records this correction rather than silently changing RBAC scope.
- The prompt's `TenantAuthGuard` is not a project guard. The implementation
  follows the established tenant session/context/permission/entitlement guard
  order used by E07-S01 and E07-S02.
- The prompt calls the audit surface `TenantAuditLog`; the project authority
  names the physical model `AuditLog` and its tenant-scoped writer. Only the
  project name is used in code, while the requested action string remains
  `conversation.message_sent`.
- The prompt requests HTTP 201 for this Inbox mutation. The unrelated
  channel-level E05-S03 endpoint remains HTTP 202; no existing route was
  renamed or changed.

## Security and tenant isolation

All Conversation, ChannelAccount, Message, OutboundMessage, audit and Outbox
operations remain tenant-scoped through `TenantContext` and composite tenant
predicates. The response excludes tenant ids, channel credentials and raw
request metadata. The actor id is never accepted from the body, and the
request id is accepted only from a bounded, sanitized header for audit
correlation.

## Alternatives considered

- Add `conversations.manage`: rejected because the RBAC catalog is closed and
  the backlog explicitly assigns `conversations.reply` to this story.
- Extend `InboxQueryManager`: rejected because it is the read boundary; a
  separate manager token keeps query and mutation responsibilities explicit.
- Add a Message/queue table or migration: rejected because E06-S04 already
  supplies the canonical create-before-send schema and transaction.
- Emit `message.sent` at API creation time: rejected because the provider has
  not delivered the message; this story emits only `message.queued`.

## Consequences

The dashboard can enqueue a tenant-safe text or media reply with durable
canonical timeline state, audit evidence and idempotent outbox intent. The
provider worker and later delivery reconciliation can consume the existing
`OutboundMessage` without coupling the API to a provider implementation.
The next Inbox story remains E07-S04 for conversation status management and
assignment.

## Migration/rollback

No migration. Rollback removes the POST route, reply provider wiring, request
validation, audit append and dedicated tests/ADR; the existing E06-S04 schema
and the canonical `conversations.reply` permission remain unchanged.

## Verification

The dedicated Inbox API suite passed 9/9 against PostgreSQL 18.4 and Nest,
covering text/media replies, closed-body validation, non-writable targets,
idempotency, audit/outbox, RBAC, entitlements and cross-tenant 404 behavior.
The outbound conversation database regression passed 4/4. Prisma validate,
15-migration status, database/API TypeScript checks, Biome over 273 files, the
root Vitest suite (20 files/93 tests) and `git diff --check` also passed in the
reproducible Docker workflow.

## Affected documents

`platform_docs/STATUS.md`, `platform_docs/CHANGELOG.md`,
`platform_docs/docs/MANIFEST.md`,
`platform_docs/docs/adr/0021-outbound-message-create-before-send-scope.md`,
`apps/api/src/inbox.ts`, `apps/api/src/app.ts`,
`apps/api/src/inbox.integration.ts` and
`packages/database/src/outbound-conversation-message-manager.ts`.
