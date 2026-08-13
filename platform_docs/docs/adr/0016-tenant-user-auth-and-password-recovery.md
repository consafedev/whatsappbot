# ADR-0016 — Tenant User authentication and password recovery

**Status:** Accepted
**Date:** 2026-08-13

## Context

E02-S02 necesita autenticar usuarios de tenant sin confundirlos con Platform Admin y antes de que E02-S03 introduzca resolución general de `TenantContext`. Login debe localizar el tenant de forma pre-session, mientras las sesiones y tokens de recuperación deben conservar aislamiento físico y no exponer credenciales reutilizables.

## Decision

- `User`, `UserSession` y `UserPasswordResetToken` son modelos tenant-owned separados de `PlatformAdmin` y sus sesiones. Todos llevan `tenant_id NOT NULL`.
- El email se normaliza con trim + lowercase y es único por `(tenant_id, email)`, no globalmente.
- El slug en `POST /auth/tenants/:tenantSlug/...` localiza el workspace únicamente antes de autenticar. No se acepta `tenantId` en body y el tenant autorizado posterior siempre procede de `UserSession.tenant_id`.
- Los lookups pre-auth y la creación interna de identidad se exponen sólo mediante el boundary privilegiado `@whatsapp-platform/database/platform`; el root tenant-safe no obtiene acceso pre-auth.
- Se reutilizan Argon2id y la política 15–128 de E02-S01. Sesión tenant usa token CSPRNG de 256 bits, persiste sólo SHA-256 en `BYTEA`, expira absolutamente en 12 horas y por inactividad en 2 horas, con touch máximo cada 5 minutos.
- La cookie es `__Host-tenant_session` Secure en producción y `tenant_session` en desarrollo/test; es HttpOnly, SameSite Strict, Path `/` y no usa Domain. No se usa JWT, localStorage ni sessionStorage.
- `UserSession` y `UserPasswordResetToken` usan FK compuesta `(tenant_id, user_id)` hacia `User(tenant_id, id)`, además de FK a Tenant.
- Recuperación usa token CSPRNG independiente de 256 bits, sólo SHA-256 persistido, TTL de 15 minutos, single-use y revocación del token anterior. Confirmación cambia password, consume el token y revoca todas las sesiones en una transacción; no hace auto-login.
- La URL se construye exclusivamente desde `TENANT_WEB_ORIGIN`. El raw token cruza el core sólo mediante `PasswordResetDelivery` después del commit y nunca se devuelve por HTTP ni se loguea.
- No existe infraestructura de correo actualmente. E02-S02 entrega el port y un adapter no configurado que falla de manera sanitizada manteniendo respuesta pública genérica; un adapter SMTP/provider real es dependencia operativa antes de habilitar recovery para usuarios reales.
- Login, reset request y reset confirm usan buckets process-local separados. La distribución del limiter es requisito antes de escalar API horizontalmente.
- Tenant/User disabled se revalidan tanto al login como en cada sesión. MFA permanece sólo como estado de modelo y no está implementado.

## Alternatives considered

- Cuenta común Platform/Tenant: rechazada por confusión de privilegios y scopes.
- Tenant ID en body o headers: rechazado porque es input no confiable.
- JWT/reset JWT: rechazado porque impide revocación server-side simple y duplica la estrategia ya decidida.
- Añadir SMTP/Notifications completo: pospuesto porque no existe infraestructura, credenciales ni decisión de proveedor; devolver tokens por HTTP/log fue rechazado por seguridad.

## Consequences

- La misma dirección puede autenticar identidades independientes en tenants distintos.
- Suspender tenant o deshabilitar user bloquea sesiones ya emitidas sin borrar historial.
- E02-S03 podrá construir `TenantContext` desde la identidad autenticada, pero esa integración no forma parte de E02-S02.
- Password recovery requiere configurar un adapter real antes de operación; las pruebas usan capture delivery sin exponer el token fuera del port.

## Migration/rollback

La sexta migration añade únicamente enums, `tenant_user`, `user_session`, `user_password_reset_token`, constraints e índices E02-S02. No modifica migrations 1–5. En una base desechable el rollback técnico elimina estos objetos; migrations compartidas permanecen append-only.

## Affected documents

`README.md`, `.env.example`, `SYSTEM_DESIGN.md`, `SECURITY.md`, `DATA_MODEL_ERD_MVP_BACKLOG.md`, `STATUS.md`, `CHANGELOG.md` y `docs/MANIFEST.md`.

## Next story

`E02-S03 — Tenant context middleware`.
