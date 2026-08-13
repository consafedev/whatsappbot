# ADR-0015 — Platform Admin authentication and server-side sessions

**Status:** Accepted
**Date:** 2026-08-13

## Context

E02-S01 necesita autenticar operadores del control plane sin reutilizar identidad tenant ni introducir autorización, invitaciones, MFA o recuperación de contraseña. El navegador no debe conservar credenciales reutilizables fuera de una cookie protegida y una filtración de la base no debe exponer tokens de sesión activos.

## Decision

- `PlatformAdmin` y `PlatformAdminSession` son modelos separados de cualquier futuro Tenant User; no tienen `tenant_id`.
- Las contraseñas se almacenan como PHC Argon2id con `m=19456`, `t=2`, `p=1`, salt aleatorio de 16 bytes y hash de 32 bytes mediante `argon2` 0.45.1. Se eligió la librería mantenida porque el Argon2 nativo de Node 24 continúa marcado experimental.
- El bootstrap es explícito mediante `pnpm platform-admin:create`; usa variables de entorno, aplica la misma política de contraseña y nunca imprime la contraseña ni su hash.
- Cada login crea un token opaco aleatorio de 256 bits. El cliente recibe sólo el token en cookie; PostgreSQL conserva exclusivamente su SHA-256 en `BYTEA` con unique.
- La sesión dashboard no usa JWT, localStorage ni sessionStorage. Las futuras sesiones Tenant serán identidades y tablas separadas.
- La sesión tiene expiración absoluta de 8 horas e idle timeout de 30 minutos. `last_seen_at` se actualiza como máximo cada 5 minutos para limitar escrituras.
- La cookie se llama `__Host-platform_session` en producción y `platform_session` en desarrollo/test; siempre es HttpOnly, `SameSite=Strict`, `Path=/`, sin `Domain`, y usa `Secure` en producción.
- `POST /platform/auth/login` y `POST /platform/auth/logout` exigen coincidencia exacta del header `Origin` con `PLATFORM_WEB_ORIGIN`; CORS admite sólo ese origen con credenciales.
- Login se limita en memoria por email normalizado a 10 intentos por minuto. Es una protección baseline por proceso; un limiter distribuido queda fuera de esta historia.
- Login exitoso y logout se escriben en `AuditLog` dentro de la misma transacción que crea o revoca la sesión, con `tenant_id = NULL` y `request_id` explícito.
- Logout es idempotente: revoca una sesión activa si existe y siempre expira la cookie. `/me` es el endpoint protegido de verificación.
- `mfa_state` prepara evolución del modelo, pero MFA no está implementado ni se presenta como protección en E02-S01. Cloudflare Access futuro puede aportar defense-in-depth y no sustituye esta autenticación propia.

## Consequences

- Reiniciar una instancia API reinicia sus contadores de rate limiting, pero no invalida sesiones porque PostgreSQL es la fuente de verdad.
- El hash de token permite lookup directo sin conservar el bearer reutilizable.
- Deshabilitar un `PlatformAdmin` bloquea login y sesiones existentes al revalidar estado en cada request.
- Tenant auth, RBAC, MFA, password reset y gestión de sesiones permanecen fuera de E02-S01.

## Migration/rollback

La quinta migration añade únicamente enums, `platform_admin`, `platform_admin_session`, índices y FK restrictiva. No modifica migrations históricas. En una base desechable el rollback técnico elimina esos objetos; migrations compartidas permanecen append-only.

## Affected documents

`SYSTEM_DESIGN.md`, `SECURITY.md`, `DATA_MODEL_ERD_MVP_BACKLOG.md`, `STATUS.md` y `CHANGELOG.md`.

## Next story

`E02-S02 — Tenant user auth`.
