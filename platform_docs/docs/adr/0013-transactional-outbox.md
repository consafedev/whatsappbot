# ADR-0013 — Transactional Outbox persist-before-publish

**Status:** Accepted
**Date:** 2026-08-13

## Context

Los cambios de dominio que originan trabajo asíncrono no pueden depender de publicar a Redis, BullMQ o un provider externo dentro de la transacción de negocio. Si el commit PostgreSQL y la publicación fueran operaciones independientes, un fallo entre ambas podría dejar estado persistido sin el evento correspondiente o ejecutar un side effect para un cambio revertido.

## Decision

- Persistir cada evento tenant-owned en `domain_event_outbox` dentro de la misma transacción PostgreSQL que modifica el aggregate.
- Exponer al código tenant únicamente un writer append-only (`outbox.append`) y un boundary (`withTenantTransaction`) que construye el facade tenant-scoped sobre el mismo `Prisma.TransactionClient`.
- Derivar `tenant_id` exclusivamente de `TenantContext`; el caller no puede proporcionar IDs ni campos de publication bookkeeping.
- Confirmar primero el estado interno y el evento. Un publisher privilegiado futuro leerá eventos pendientes y sólo después del commit publicará a BullMQ/event bus.
- No ejecutar WhatsApp, HTTP, email, IA, uploads externos ni otros side effects irreversibles dentro de la transacción de dominio.
- Representar la publicación con `published_at`, `attempts` y `last_error`; no añadir una state machine de status en esta baseline.

## Alternatives considered

- Publicar antes del commit: rechazado porque un rollback dejaría un evento sobre estado inexistente.
- Commit y publicación directa secuencial sin Outbox: rechazado porque un crash entre ambos perdería el evento.
- Entregar el `Prisma.TransactionClient` raw al callback tenant: rechazado porque permitiría saltarse accidentalmente `TenantContext`.
- Añadir ahora publisher, polling, retries o BullMQ: rechazado por pertenecer a historias posteriores.

## Consequences

- `domain change + outbox event` hace commit o rollback como una sola unidad cuando se usa `withTenantTransaction`.
- El Outbox permanece como fuente persistente hasta que infraestructura privilegiada lo publique.
- Consumers y publisher futuros deberán ser idempotentes y gestionar reintentos sin mutar el payload original.
- La aplicación debe evitar side effects externos dentro del callback transaccional.

## Migration/rollback

La migration E01-S04 añade únicamente `domain_event_outbox`, sus índices y la FK a `tenant`. En una base todavía desechable, el rollback técnico elimina esa tabla; migrations ya compartidas permanecen append-only.

## Affected documents

`SYSTEM_DESIGN.md`, `DATA_MODEL_ERD_MVP_BACKLOG.md`, `README.md`, `STATUS.md`, `CHANGELOG.md` y schema/migrations de `packages/database`.
