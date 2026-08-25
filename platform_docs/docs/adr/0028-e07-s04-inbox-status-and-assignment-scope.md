# ADR-0028 — E07-S04 Inbox conversation status and assignment scope

- Status: Accepted
- Date: 2026-08-24
- Owners: Platform Engineering

## Context

E07-S04 is the next Inbox mutation story after E07-S03. The short backlog
label names the story **Assignment** with user/unit targets, while ADR-0027
explicitly identifies the next scope as conversation status management and
assignment. This decision keeps both requested mutations together and does
not advance realtime transport, UI or automation work.

The implementation prompt proposes `conversations.manage`,
`TenantAuthGuard` and `TenantAuditLog`. The project authority has a closed
RBAC catalog containing `conversations.assign` but not `conversations.manage`,
uses the ordered tenant session/context/permission/entitlement guards, and
persists audit data through the `AuditLog` model and
`createTenantDataAccess(...).audit` writer.

## Decision

- Add `createInboxMutationManager(...)` as a dedicated database mutation
  boundary. It requires an operational tenant and the effective
  `module.messaging.basic` and `module.crm_lite` entitlements inside the
  transaction.
- `updateConversationStatus(...)` takes the tenant context and actor from the
  authenticated request, locks the tenant/channel/contact conversation key
  with `lockConversationInTransaction`, re-reads the row after the lock and
  applies only this lifecycle matrix:

  ```text
  new     -> open | closed
  open    -> pending | closed
  pending -> open | closed
  closed  -> open
  ```

  Identical or otherwise unsupported transitions fail with
  `InvalidConversationStateTransitionError`. Closing writes `closedAt`, and
  reopening or moving to another active status clears it. The mutation updates
  `updatedAt` explicitly.
- `assignConversation(...)` validates every supplied user as an active user
  in the authenticated tenant and every supplied unit as an active unit in
  that same tenant. `null` unassigns; an omitted field is preserved. At least
  one field must be supplied. The actor is also required to be an active
  tenant user.
- Each successful mutation writes its `AuditLog` entry and transactional
  `DomainEventOutbox` row in the same PostgreSQL transaction. The actions and
  event types are `conversation.status_updated` and
  `conversation.assigned`. Outbox payloads include the tenant derived from
  `TenantContext`, conversation, actor, resulting values and an ISO timestamp;
  status audit summaries also retain the optional reason without message
  content.
- Add `PATCH /api/v1/inbox/conversations/:conversationId/status` and
  `/assignment`. Both require `conversations.assign`, the existing ordered
  tenant guard chain and both Inbox entitlements, and return the existing
  `InboxConversationDetail` projection after the mutation. Missing or
  cross-tenant conversations remain generic `404`; invalid transitions and
  invalid assignment targets return `400`.
- The API accepts closed request bodies. Status accepts `open`, `pending` or
  `closed` plus an optional bounded, normalized reason. Assignment accepts at
  least one of `assignedUserId` or `assignedUnitId`, each as a UUIDv7 or
  `null`; actor and tenant are never accepted from the body.

## Scope reconciliation and naming

- `conversations.manage` is rejected because it is absent from the canonical
  permission catalog. `conversations.assign` is the existing granular
  permission for this story and protects both status and assignment routes;
  no new permission key was invented.
- `TenantAuthGuard` is rejected because it is not a project guard. The routes
  use `TenantUserSessionGuard`, `TenantContextGuard`, `TenantPermissionGuard`
  and `TenantEntitlementGuard` in the order already established by E07-S01 to
  E07-S03.
- `TenantAuditLog` is rejected as a code/model name. The implementation uses
  the existing tenant-scoped `AuditLog` writer and preserves the requested
  action/event vocabulary.
- The backlog's concise “Assignment” label is not rewritten. Status mutation
  remains in this story because the accepted ADR-0027 continuation scope and
  the supplied E07-S04 prompt both define it; this is recorded here rather
  than changed silently.

## Security and tenant isolation

All conversation, user, organization-unit, audit and outbox predicates derive
tenant identity from `TenantContext`. Advisory locking and a tenant-aware
composite conversation key serialize concurrent mutations. A user from another
tenant or a disabled user cannot be assigned, and a cross-tenant conversation
is indistinguishable from a missing resource at the API boundary.

## Alternatives considered

- Add `conversations.manage`: rejected because the catalog is closed and
  `conversations.assign` is the documented granular capability.
- Extend `InboxQueryManager`: rejected because query and mutation boundaries
  are intentionally separate after E07-S01/E07-S02.
- Add a status/assignment table or migration: rejected because the existing
  `Conversation` schema already owns `status`, `closedAt`, assignment FKs and
  `updatedAt`.
- Emit realtime events or build UI controls: rejected; those remain outside
  E07-S04 and are deferred to later Inbox stories.

## Migration and verification

No Prisma migration is required. The dedicated database suite covers the
lifecycle matrix, `closedAt`, assignment/unassignment, invalid targets,
AuditLog/Outbox and A/B isolation. The API suite covers both PATCH routes,
detail responses, cross-tenant `404`, invalid transition/target `400`, RBAC
and entitlement failure behavior.

The next expected story is E07-S05 (Inbox Realtime Push via WebSocket / SSE).
