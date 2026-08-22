# ADR-0025 — E07-S01 inbox conversation query and API scope

- Status: Accepted
- Date: 2026-08-21
- Owners: Platform Engineering

## Context

E07-S01 owns the tenant-scoped Inbox conversation list: canonical lifecycle
filters, assignment/channel filters, contact search, deterministic cursor
pagination and the least-data row projection. The implementation prompt also
requested a conversation-detail manager and endpoint, and offered
`inbox.read` as an alternative permission. Those requests conflict with the
approved backlog and existing catalogs:

1. The backlog separates **E07-S01 Conversation list** from **E07-S02
   Conversation detail**. ADR-0019 and ADR-0020 also keep list/detail APIs
   deferred to Epic 07 stories rather than expanding the previous lifecycle
   stories.
2. The closed RBAC catalog contains `conversations.read` for this read
   operation. It does not contain `inbox.read`, and this story must not invent
   a second permission name.
3. The current `Conversation` projection has inbound, outbound and human
   message timestamps but no persisted read receipt, unread counter or
   `lastMessagePreview`. Adding those fields would require a migration and
   would move read-state ownership into a story that does not define it.
4. In the current Nest guard arrangement, a controller-level entitlement
   guard executes before a method-level session guard. Applying the entitlement
   guard only at controller level therefore fails authenticated Inbox requests
   closed with `401` before authentication has populated the request context.

## Decision

- Implement only `listInboxConversations(...)` and
  `GET /api/v1/inbox/conversations` in E07-S01. Do not add
  `getInboxConversationDetail(...)` or a detail endpoint; those remain the
  explicit next scope, E07-S02.
- Authorize the list with the existing `conversations.read` permission and
  both effective module entitlements: `module.messaging.basic` and
  `module.crm_lite`. Do not register, validate or accept `inbox.read`.
- Derive every database predicate from the authenticated `TenantContext` and
  require the tenant to be operational before checking both entitlements.
  The API route composes guards in this order:
  `TenantUserSessionGuard`, `TenantContextGuard`, `TenantPermissionGuard`, and
  `TenantEntitlementGuard`. Entitlement metadata remains on the controller;
  the explicit route-level order prevents the existing Nest execution order
  from rejecting a valid session before context resolution.
- Support canonical statuses `new`, `open`, `pending` and `closed`. The
  `active` query alias expands deterministically to `new|open|pending`; when no
  status is supplied, active statuses are selected. `totalActive` counts the
  active rows matching the tenant and non-status filters, independent of the
  current page cursor.
- Use `(lastMessageAt DESC NULLS LAST, id DESC)` as the sole ordering key. The
  opaque cursor is a base64url JSON value containing the last row's UUIDv7 and
  nullable `lastMessageAt`; the query resumes strictly after that tuple.
- Return only the list projection required by the Inbox row: contact,
  channel, assignment, lifecycle/timestamps, priority, subject and automation
  mode. Tenant identifiers are not returned.
- Derive the current `unread` boolean from the existing projection as
  `lastInboundAt != null` and either `lastHumanMessageAt == null` or
  `lastInboundAt > lastHumanMessageAt`. This is a conservative read model, not
  a persisted read receipt or a claim that E07-S01 implements message-read
  tracking. A future read-state story may replace it with an explicit source
  of truth.
- Add no Prisma migration, WebSockets/SSE, reply/mutation, assignment/status
  mutation or frontend work. Those remain in their documented stories.

## Alternatives considered

- Implement list and detail together because the prompt lists both: rejected;
  the approved backlog and ADR boundaries assign detail to E07-S02.
- Add `inbox.read`: rejected because the RBAC catalog is closed for this
  operation and `conversations.read` already expresses the authority.
- Persist `unread`/`unreadCount` or `lastMessagePreview`: rejected because the
  current schema does not own read state/preview and E07-S01 explicitly needs
  no migration.
- Keep the entitlement guard only at controller level: rejected after the
  real API integration test showed authenticated requests fail with `401`
  before session context is populated. The route-level ordered composition
  preserves fail-closed authorization without changing unrelated controllers.

## Consequences

E07-S01 exposes a deterministic, tenant-isolated read API using the existing
RBAC and entitlement vocabulary. Clients can page reliably and render a
derived unread indicator, while detail, durable read state, preview, realtime
updates and mutations remain explicit future work rather than implicit scope.

## Migration/rollback

No migration. Rollback removes the manager, route, tests and documentation;
the existing Conversation schema and canonical permissions remain unchanged.

## Verification

The dedicated database suite passed 4/4 against PostgreSQL 18.4. The
dedicated Nest API suite passed 3/3 against PostgreSQL 18.4 with real session,
RBAC, entitlement and tenant-isolation checks. Static, Prisma and broader
regression gates are recorded in `STATUS.md` only after their current checkout
results are available.

## Affected documents

`platform_docs/STATUS.md`, `platform_docs/CHANGELOG.md`, ADR-0019,
ADR-0020, ADR-0021, `packages/database`, `apps/api` and the Epic 07 Inbox
boundary.
