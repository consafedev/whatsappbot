# ADR-0014 — Append-only tenant and platform audit boundaries

**Status:** Accepted
**Date:** 2026-08-13

## Context

La plataforma necesita registrar quién cambió qué tanto dentro de un tenant como en el control plane. AuditLog es evidencia de control y no sustituye TimelineEvent, que explica la historia de negocio al usuario. Los identificadores auditados y actores pueden ser UUID internos, claves naturales o identidades no persistentes. Los summaries pueden contener datos sensibles si se construyen indiscriminadamente.

## Decision

- Persistir `audit_log` como registro lógicamente append-only: las APIs normales exponen únicamente `append`, sin update, delete, replace ni upsert.
- Separar AuditLog de TimelineEvent. E01-S05 no crea Timeline ni hace que AuditLog y Outbox se generen mutuamente.
- El writer tenant vive en el facade `TenantDataAccess`, deriva siempre `tenant_id` de `TenantContext` y funciona sobre Prisma Client o el mismo `TransactionClient` usado por `withTenantTransaction`.
- El writer platform sólo se exporta desde `@whatsapp-platform/database/platform`. Puede registrar eventos puros con `tenant_id = NULL` o eventos privilegiados relacionados con un tenant explícito.
- `actor_id` es texto nullable para actores no persistentes; `entity_id` es texto requerido para admitir UUIDs serializados y claves naturales. No se crean FKs polimórficas.
- Una FK compuesta protege la relación tenant/OrganizationUnit. Un audit puramente platform no puede asociar OrganizationUnit.
- `before_summary`, `after_summary` e `ip_metadata` son JSONB opcionales, explícitos y ya sanitizados por el caller. No se capturan modelos, headers ni request context automáticamente.
- `request_id` es requerido y debe propagarse explícitamente; no se introduce AsyncLocalStorage ni middleware en esta historia.

## Alternatives considered

- Una sola API que acepte `tenant_id`: rechazada porque permitiría al flujo tenant falsificar ownership o crear audit platform.
- Reutilizar TimelineEvent: rechazado porque su propósito y audiencia son distintos.
- UUID rígido para actor/entity: rechazado porque impediría actores no persistentes y claves naturales como `PlatformFeatureFlag.key`.
- Triggers o permisos DB append-only en esta baseline: pospuestos; la garantía actual corresponde al boundary de API y la infraestructura privilegiada conserva acceso operativo.
- Sanitizer universal: pospuesto; sin contratos de datos concretos sería incompleto o sobreconstruido.

## Consequences

- Domain mutation, AuditLog y Outbox pueden componerse en una sola transacción tenant-scoped.
- El código tenant no puede omitir ni sustituir `tenant_id`.
- El código privilegiado debe protegerse como control plane y suministrar summaries mínimos sin secretos.
- Retención, consulta avanzada, exportación y enforcement físico append-only quedan para historias futuras explícitas.

## Migration/rollback

La migration E01-S05 añade únicamente `audit_log`, sus índices, FKs y el check de OrganizationUnit platform. En una base todavía desechable, el rollback técnico elimina esa tabla; migrations compartidas permanecen append-only.

## Affected documents

`DATA_MODEL_ERD_MVP_BACKLOG.md`, `SECURITY.md`, `README.md`, `STATUS.md`, `CHANGELOG.md` y schema/migrations de `packages/database`.
