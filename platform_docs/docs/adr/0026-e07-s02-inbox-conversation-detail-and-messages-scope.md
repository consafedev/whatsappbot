# ADR-0026 — E07-S02 Inbox conversation detail and message timeline scope

- Status: Accepted
- Date: 2026-08-22
- Owners: Platform Engineering

## Context

E07-S02 is the canonical Epic 07 story for opening a conversation from the
Inbox and reading its durable message timeline. The backlog assigns this story
conversation detail, messages, media, actor badges, timestamps and origin.
E07-S01 deliberately stopped at the list projection and API documented in
ADR-0025.

The implementation prompt asks for detail metadata, two REST read endpoints,
cursor pagination in both directions, tenant isolation and no schema change.
The existing Prisma schema already contains the tenant-scoped Conversation,
Message, Contact, ChannelAccount, User and OrganizationUnit relations required
for this read surface.

## Decision

- Extend `createInboxQueryManager(...)` with
  `getInboxConversationDetail(...)` and
  `listInboxConversationMessages(...)`.
- Revalidate the operational tenant and both Inbox module entitlements
  (`module.messaging.basic` and `module.crm_lite`) in each manager operation.
  The API also requires the existing `conversations.read` permission. No
  `inbox.read` permission is introduced.
- Expose `GET /api/v1/inbox/conversations/:conversationId` and
  `GET /api/v1/inbox/conversations/:conversationId/messages` using the same
  ordered guards as E07-S01: session, tenant context, permission, entitlement.
- Detail returns a closed projection of conversation lifecycle/timestamps,
  derived `unread`, contact metadata, channel metadata and assignment metadata.
  It does not select or return Conversation metadata, channel credentials,
  provider configuration or other private fields.
- Message results return only `id`, `conversationId`, `direction`, `origin`,
  `actorType`, `actorId`, `deliveryStatus`, `providerTimestamp`, `textBody`,
  `structuredPayload` and `createdAt`. `structuredPayload` is the existing
  canonical JSON field used for media-shaped content; attachment storage and
  media download remain outside this story.
- Cursor pagination uses the strict `(createdAt, id)` tuple. `before` (the
  default) returns historical messages in descending order, while `after`
  returns newer messages in ascending order. `nextCursor` continues in the
  requested direction; `prevCursor` is returned only when the first item has
  rows in the opposite direction. Limits default to 30 and are capped at 100.
- A conversation absent from the authenticated tenant is represented by the
  existing `ConversationNotFoundError`, which the API maps to 404 without
  revealing cross-tenant existence.
- No Prisma migration, mutation, outbound dispatch, realtime transport or UI
  is added.

## Scope reconciliation and naming

- The prompt names channel and assigned-user output properties `name`, while
  the canonical Prisma columns are `displayName`. The DTO maps
  `displayName` to `name`; the schema and existing names are not silently
  renamed.
- The prompt lists the closed `InboxMessageItem` fields without `messageType`.
  The API therefore keeps `messageType` out of the public DTO and exposes
  media-specific data through the canonical `structuredPayload` field. The
  database row remains unchanged.
- `ConversationNotFoundError` is reused from the existing outbound conversation
  application boundary instead of creating a second error with the same
  contract.

## Security and tenant isolation

Every Conversation and Message predicate includes the tenant derived from the
authenticated `TenantContext`. Detail and timeline lookups for another tenant
return the same 404 as an unknown conversation. Channel secrets are not part of
any Prisma select or HTTP response. RBAC and entitlements are checked before
the read reaches the manager.

## Alternatives considered

- Add a migration for preview, read receipts or media rows: rejected because
  E07-S02 is a read surface over the canonical existing model and the prompt
  explicitly forbids migrations. Durable read state and attachment storage
  require their own documented source of truth.
- Use offset pagination or provider timestamps alone: rejected because the
  canonical message index and required deterministic boundary are
  `(createdAt, id)`.
- Reuse `inbox.read` or add a new permission: rejected because the RBAC catalog
  is closed and ADR-0025 establishes `conversations.read` for Inbox reads.

## Consequences

The Inbox can load a tenant-safe detail header and deterministic timeline from
PostgreSQL without coupling the API to a provider or introducing a second
message model. UI media rendering can consume `structuredPayload`, while
attachment download, realtime updates and mutations remain explicit future
stories.

## Migration/rollback

No migration. Rollback removes the detail/timeline manager methods, routes,
tests and this ADR; Conversation, Message and permission schemas remain
unchanged.

## Verification

The dedicated database suite passed 6/6 and the Nest/API suite passed 4/4
against PostgreSQL 18.4 with real session, RBAC, entitlement and
cross-tenant checks. Prisma validation, TypeScript checks for database/API,
Biome over 264 files, the root Vitest suite (20 files/93 tests) and
`git diff --check` also passed in the reproducible container workflow.

## Affected documents

`platform_docs/STATUS.md`, `platform_docs/CHANGELOG.md`,
`platform_docs/docs/adr/0025-e07-s01-inbox-query-api-scope.md`,
`packages/database/src/inbox-query-manager.ts`,
`apps/api/src/inbox.ts` and their integration suites.
