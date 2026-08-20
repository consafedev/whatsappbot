# ADR-0018 — Contact primary phone projection in E06-S01

**Status:** Accepted
**Date:** 2026-08-19

## Context

The MVP data-model backlog describes `Contact` as a tenant-global identity and
models omnichannel identifiers through a future `ContactPoint` concept. The
E06-S01 implementation prompt, however, requires a direct `phoneNumber` field,
a tenant-unique phone identity, E.164 normalization, and contact CRUD/API
behavior. The story does not include webhook association, conversations,
messages, or omnichannel identity management.

## Decision

E06-S01 stores one normalized primary phone projection directly on the
tenant-owned `Contact` row. The persisted value is E.164, and
`(tenant_id, phone_number)` is unique. The projection is sufficient for the
story's manual contact identity and find-or-create path; it is not a complete
replacement for `ContactPoint`.

`ContactPoint` remains the future boundary for additional phone numbers,
WhatsApp/provider identities, email identities, verification metadata, and
channel binding. A later story must define the migration/ownership rules before
moving those concerns into that model.

## Alternatives considered

- Create `ContactPoint` now: rejected because it expands E06-S01 into
  omnichannel identity and provider association work excluded by the story.
- Store an unnormalized phone string: rejected because duplicate identity,
  lookup, and future channel binding would not have a deterministic key.
- Store the phone only in a JSON/custom field: rejected because PostgreSQL
  cannot enforce the required tenant-scoped uniqueness and query contract as
  clearly as a typed column.

## Consequences

- Manual contact identity is deterministic and tenant-isolated now.
- A contact has one primary phone projection in this story; multiple points and
  provider/channel identity remain unavailable until a later migration.
- The normalizer's default country is explicitly Mexico (`52`) for the MVP;
  tenant/locale-specific resolution is a future boundary and must not be
  inferred from client input.

## Migration and rollback

The append-only migration is
`20260819200000_add_contacts_foundation`. Rollback is the repository's normal
forward migration/recovery process; no destructive down migration is introduced
by this ADR. A future `ContactPoint` migration must preserve the primary
projection or provide an explicit backfill/reconciliation plan before changing
the uniqueness contract.

## Affected documentation

- `platform_docs/DATA_MODEL_ERD_MVP_BACKLOG.md` remains the conceptual model
  authority for the future `ContactPoint` boundary.
- `platform_docs/STATUS.md` and `platform_docs/CHANGELOG.md` record the
  E06-S01 scope and the boundary explicitly.
