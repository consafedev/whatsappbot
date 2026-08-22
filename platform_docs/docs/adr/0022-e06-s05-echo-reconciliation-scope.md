# ADR-0022 — E06-S05 echo reconciliation scope

- Status: Accepted
- Date: 2026-08-20
- Owners: Platform Engineering

## Context

The E06-S05 implementation prompt combined three backlog stories and used
non-canonical values. The project backlog defines E06-S05 as **Echo
reconciliation**, E06-S06 as **External human detection**, and E06-S07 as
**Delivery state**. The prompt also requested `external_device` and
`external` values, while the canonical model defines
`human_external_device` and `external_human_unknown`.

E06-S04 already persists one canonical outbound `Message` linked to one
`OutboundMessage` queue row. Provider echoes can therefore be correlated
without adding a table or guessing from phone/content when the provider id is
not known by the platform.

## Decision

- Implement `createOutboundEchoManager(...).reconcileOutboundEcho(...)` as the
  E06-S05 boundary.
- Validate the active tenant, `module.messaging.basic`, `module.crm_lite`, the
  tenant-owned source event, channel account, event type and provider message
  identity.
- Correlate first by `(tenant_id, channel_account_id, provider_message_id)` on
  the canonical `Message`; fall back to the same tenant/channel/provider id on
  `OutboundMessage` and its E06-S04 canonical relation.
- Update only the canonical provider identity/timestamp when needed, mark the
  source event `PROCESSED`, and append one atomic `message.echo_reconciled`
  Outbox event. Do not change `delivery_status` or `OutboundMessage.status`.
- Keep an unmatched `fromMe` echo pending within E06-S05 and raise a typed
  not-matched error so the dispatcher can hand it to E06-S06, which classifies
  and persists the external human message using the
  canonical `human_external_device` / `external_human_unknown` values.
- Route regular `MESSAGE_RECEIVED` events to E06-S03. Keep
  `STATUS_UPDATE`/`DELIVERY_RECEIPT` deferred to E06-S07 rather than creating
  a partial delivery-state implementation in this story.
- Use the existing schema from E06-S03/E06-S04; no migration is required.

## Alternatives considered

- Create a new `Message` for every `fromMe` event: rejected because a platform
  echo would duplicate the E06-S04 canonical timeline row.
- Match an unknown echo by recipient phone, timestamp or text: rejected
  because those fields are not a reliable provider correlation key and could
  attach data to the wrong outbound intent.
- Implement delivery transitions here: rejected because E06-S07 owns
  `sent|delivered|read|failed` and monotonic delivery semantics.
- Use the prompt's `external_device` / `external` names: rejected because the
  canonical model and backlog use `human_external_device` /
  `external_human_unknown`.

## Consequences

Known platform sends are reconciled idempotently and tenant-safely without a
second message. Unmatched external-human echoes are handed to E06-S06 for
durable classification instead of being silently discarded or misattributed.
Delivery receipts remain pending until E06-S07 supplies their owner.

## Migration/rollback

No migration. E06-S04 already provides the nullable provider timestamp,
provider identity unique key and tenant-aware `Message` to `OutboundMessage`
relation required by this story.

## Affected documents

`platform_docs/STATUS.md`, `platform_docs/CHANGELOG.md`, ADR-0023 and the
E06-S04 outbound scope ADR.
