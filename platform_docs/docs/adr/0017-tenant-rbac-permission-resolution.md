# ADR-0017 — Tenant RBAC permission resolution

**Status:** Accepted
**Date:** 2026-08-13

## Context

E02-S05 necesita autorización granular después de autenticación y resolución de `TenantContext`, sin convertir nombres de roles en autoridad ni mezclar Platform Admin con identidad tenant. El modelo conceptual admite roles template globales y assignments por Organization Unit, pero todavía no existen provisioning de tenants ni políticas resource/OU-aware.

## Decision

- El catálogo global de permisos vive versionado en `packages/rbac` y deriva el tipo cerrado `PermissionKey` de una única lista canónica. Un sync explícito e idempotente inserta faltantes y actualiza descriptions sin borrar filas desconocidas.
- `Role` tenant-owned agrupa permisos. El nombre o key del role no autoriza por sí mismo; el guard evalúa el conjunto efectivo de `RolePermission`.
- `Role.tenant_id = NULL` representa únicamente un template global futuro. `UserRole` exige FKs compuestas de tenant hacia `User`, `Role` y, cuando existe, `OrganizationUnit`; por ello un template global o role de otro tenant no es asignable directamente.
- El resolver tenant-wide sólo considera assignments con `organization_unit_id IS NULL` y grants con `scope_constraints IS NULL`. OU scope y constraints no interpretadas fallan cerradas hasta existir una autorización resource-aware explícita.
- Permission keys desconocidas para la versión actual no se conceden aunque existan en PostgreSQL. El código es autoridad sobre permisos comprendidos por la aplicación.
- `@RequirePermissions(A, B)` usa semántica ALL. Ausencia de cualquier permiso produce 403 después de los guards de sesión y tenant; sesión inválida conserva 401.
- Los permisos se resuelven desde PostgreSQL en cada request protegida. No se copian a `UserSession`, no se usa caché Redis y una revocación se observa sin relogin.
- Platform Admin permanece fuera del Tenant RBAC.
- Las primitives RBAC tenant-safe no inventan actor ni generan Audit/Outbox automáticamente. Un application service autorizado debe componer mutation + `audit.append(...)` dentro de `withTenantTransaction`; eventos Outbox se añaden sólo cuando una historia futura los requiera.
- Owner, Administrator, Supervisor, Agent, Operator y Viewer quedan versionados como nombres/keys iniciales sin permission matrix. E03-S02 definirá y materializará el default role set cuando exista una fuente normativa para el mapping.

## Alternatives considered

- Autorizar por nombre de role: rechazado porque permite privilegios implícitos y dificulta auditoría.
- Asignar templates globales directamente: rechazado porque rompería la igualdad tenant de User/Role/UserRole.
- Interpretar JSON constraints genéricas: rechazado porque crearía un DSL/policy engine fuera de alcance.
- Embebir permisos en sesión o cachearlos en Redis: rechazado porque retrasaría revocaciones y añadiría invalidación prematura.
- Casbin, Oso, Cedar, deny rules o jerarquía de roles: rechazados para esta baseline allow-set mínima.

## Consequences

- Las autorizaciones tenant-wide se actualizan en la siguiente request sin renovar sesión.
- Assignments OU-scoped no autorizan endpoints genéricos hasta que exista un guard resource-aware.
- Provisioning futuro debe materializar roles tenant-owned antes de asignarlos.
- El catálogo debe sincronizarse explícitamente durante deploy/provisioning con `pnpm rbac:sync-permissions`.

## Migration/rollback

La séptima migration añade exclusivamente `role`, `permission`, `user_role` y `role_permission`, con UUIDv7, `TIMESTAMPTZ(3)`, FKs compuestas tenant-aware e índices de unicidad. En una base desechable el rollback técnico elimina esas tablas en orden inverso; migrations compartidas permanecen append-only.

## Affected documents

`SYSTEM_DESIGN.md`, `SECURITY.md`, `TESTING_STRATEGY.md`, `README.md`, `STATUS.md`, `CHANGELOG.md`, schema y migrations de `packages/database`.

## Next story

`E03-S01 — Tenant list`.
