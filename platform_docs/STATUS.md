# STATUS.md — Estado operativo actual del proyecto

**Actualizado:** 2026-08-14
**Versión de producto:** `0.0.0`  
**Estado:** E04-S02 — PASS; **Epic 04 — Tenant Dashboard Shell — IN PROGRESS**.

## Current milestone

Tenant Dashboard Shell.

## Current epic

**Epic 04 — Tenant Dashboard Shell**

Estado por historia:

- E04-S01 — App shell: **PASS**.
- E04-S02 — Theme Engine minimal: **PASS**.

Epic anterior:

- Epic 02 — Authentication and Tenancy: **PASS / COMPLETE**.
- E01-S01 — Prisma/schema baseline: **PASS**.
- E01-S02 — ID/timestamp conventions: **PASS**.
- E01-S03 — Tenant-aware repository utilities: **PASS**.
- E01-S04 — Outbox foundation: **PASS**.
- E01-S05 — Audit foundation: **PASS**.

## Completed

- E04-S01 — App shell: **PASS**; Epic 04 permanece **IN PROGRESS**.
- `/app` usa un layout Next.js reusable, sidebar desktop-first, drawer móvil accesible, identidad real del Tenant/User y logout por `POST /auth/logout`.
- `GET /app/bootstrap` está protegido por `TenantUserSessionGuard` y `TenantContextGuard`; deriva tenant/user solamente de la sesión, consulta módulos efectivos y permisos efectivos desde PostgreSQL y no expone config, settings, hashes, sesiones ni metadata privilegiada.
- La navegación centralizada usa módulos/permisos sólo como UX; APIs futuras conservan guards. Inicio es el único link existente y capacidades efectivas futuras aparecen como `Próximamente` no clicable, sin `href="#"` ni rutas vacías.
- No hay cache persistente de auth/permissions/entitlements, migration, schema change ni Theme Engine; `brandingConfig` no se interpreta y el modo es `platform_default`.
- E04-S02 — Theme Engine minimal: **PASS**; Epic 04 permanece **IN PROGRESS**.
- `packages/themes` (`@whatsapp-platform/themes`) con schema canónico estricto: `version: 1`, preset de cinco profesionales + `custom`, `colorMode` light/dark, colores `#RRGGBB` con contraste vs blanco ≥ 3.0, logo HTTPS público sin credenciales ni hosts internos (`localhost`, `.local`, `.internal`, RFC1918, loopback, `::1`), y `{}` o config inválida resuelve al default `corporate-blue` light.
- Presets light/dark explícitos con tokens derivados (`primary`, `primaryDark`, `onPrimary`, softs, accent y `accentText` con contraste ≥ 4.5) para display; `resolveTenantTheme(...)` es fail-soft y nunca falla el bootstrap ni el editor ante config dañada.
- `GET /app/theme` y `PATCH /app/theme` requieren `tenant.settings.manage`; PATCH con body `{}` restablece el default, body inválido devuelve 400 y la presencia de `logo` (incluido `null`) exige el módulo `module.white_label` con 403 `ENTITLEMENT_REQUIRED`.
- `createTenantThemeRepository(...)` valida, persiste `brandingConfig`, escribe Audit `tenant.theme.updated` y Outbox homónimo en una transacción; summaries/payloads contienen `preset`/`colorMode`/`logoKind` sin la URL del logo y `requestId` saneado desde `x-request-id`.
- `/app/bootstrap` expone `branding` resuelto (tokens display-only) sin el `brandingConfig` raw; el shell aplica variables CSS scoped `--tenant-*` en `.tenant-app-shell`, `globals.css` usa los tokens y el CSS de plataforma (`:root`) permanece intacto.
- Editor en `/app/settings/theme` con preset, modo claro/oscuro, colores custom con preview y logo (sólo con White label); guarda, restablece y refresca bootstrap sin reload. El logo se renderiza con `referrerPolicy="no-referrer"` y queda fuera del pipeline de optimización de Next.
- Sin cambios de schema (siete migrations), sin migration 8 y sin ADR nuevo; `prisma.config.ts` sólo añade `shadowDatabaseUrl` desde `SHADOW_DATABASE_URL` para el diff de migrations.
- Suites E04-S02: `pnpm test:integration:theme-engine` (7 database + 9 API), regresión `pnpm test:integration:auth` (12 archivos/75 pruebas), `pnpm test:integration:tenant-app-bootstrap` (5) y `pnpm test:security:tenant-isolation` (9 + 37) contra PostgreSQL 18.4/Nest reales.
- E03-S05 — Suspend/reactivate tenant: **PASS**; **Epic 03 — PASS / COMPLETE**.
- `POST /platform/tenants/:tenantId/suspend` y `/reactivate` usan exclusivamente `PlatformAdminSessionGuard`, UUID de route validado y body vacío; devuelven 200 con `{ tenant: { id, status, suspendedAt }, changed }`.
- Sólo se permiten `active → suspended` y `suspended → active`; provisioning, offboarding y archived devuelven 409. Reintentos al estado actual devuelven `changed: false`, preservan `suspendedAt` y no crean Audit/Outbox adicionales.
- `createPlatformTenantStatusWriter(...)` se exporta sólo desde `@whatsapp-platform/database/platform`; aplica update condicional, status/suspendedAt, Audit y Outbox en una transaction. No hay Prisma raw en controller ni writer tenant-safe.
- `TenantUserSessionGuard` ya revalida `Tenant.status === active` desde PostgreSQL en cada request antes de TenantContext, RBAC y Entitlement. Suspender bloquea sesión existente y login con 401 genérico; reactivar permite de nuevo la misma sesión válida sin recrearla ni revocar sesiones.
- `assertTenantOperational(...)` es la primitive tenant-safe reutilizable para workers/jobs futuros. Antes de side effect costoso deberán revalidar tenant active y entitlement aplicable; no se cancela job, desconecta provider ni se modifican módulos durante suspensión.
- Suspend/reactivate no muta User, Role, Permission, UserRole, UserSession, TenantEntitlement, config, limits, OUs, settings, branding ni deployment. Platform Control y mutations de entitlements continúan operativos sobre tenant suspended.
- Audit/Outbox usan `tenant.suspended` y `tenant.reactivated`, aggregate `Tenant`, actor Platform Admin y payload/summaries mínimos sin secretos.
- UI `/platform/tenants/[tenantId]` muestra acción Suspend/Reactivar sólo en estados administrables, confirmación explícita, errores 401/404/409 y refetch real de detail después de éxito.
- Suite dedicada `pnpm test:integration:tenant-status`: 2 archivos y 7 pruebas PostgreSQL 18.4/Nest para session same-cookie, login/reset, status spoofing, A/B, Platform control, idempotencia, `suspendedAt`, concurrencia y rollback atómico.
- E03-S05 no cambió `schema.prisma`, conserva siete migrations, no creó migration 8, no implementó E04-S01 y no requirió ADR.
- E03-S04 — Module activation: **PASS**; Epic 03 permanece **IN PROGRESS**.
- Catálogo canónico y tipado de exactamente 14 `ModuleEntitlementKey` y cinco `LimitEntitlementKey`, compartido por provisioning, detalle, administración y enforcement sin listas divergentes.
- La semántica efectiva única exige row existente, `enabled = true`, `startsAt <= now` y `endsAt > now`; ausencia, disabled, inicio futuro y expiración fallan cerrados.
- `createTenantEntitlementResolver(...)` expone sólo lectura tenant-scoped y `assertTenantModuleEntitled(...)` proporciona la revalidación reusable no-Nest para futuros services, jobs y workers; no existe mutation tenant-safe ni cache/snapshot en sesión.
- `@RequireEntitlements(...)` y `TenantEntitlementGuard` aplican ALL después de sesión/contexto y, cuando corresponde, RBAC; devuelven 403 `ENTITLEMENT_REQUIRED` desde PostgreSQL en cada request sin confiar en UI ni datos del request.
- `PATCH /platform/tenants/:tenantId/entitlements/modules/:moduleKey`, `PATCH /platform/tenants/:tenantId/entitlements/limits/:limitKey` y el GET diferido de config usan exclusivamente `PlatformAdminSessionGuard`, catálogos cerrados y DTOs fail-closed.
- Los overrides son `manual_override`; config es objeto JSON opaco con reemplazo total, máximo 16 KiB/profundidad 10 y sin secretos por contrato. Disable conserva row/config/datos y re-enable recupera la configuración.
- Cada mutation ejecuta upsert + Audit `tenant.entitlement.changed` + Outbox homónimo en una única transacción; summaries/payloads no contienen config completo. La unique existente `(tenant_id, entitlement_key)` evita duplicados concurrentes.
- Limits conservan exactitud `Decimal(20,4)` sin conversión innecesaria a Number; no se anticipó enforcement de uso de módulos futuros.
- `/platform/tenants/[tenantId]` permite administrar los 14 módulos y cinco limits, muestra estado efectivo/scheduled/expired/disabled, solicita confirmación al deshabilitar y carga config avanzada sólo al abrirla.
- Suite dedicada `pnpm test:integration:entitlements`: 2 archivos y 8 pruebas PostgreSQL 18.4/Nest, incluidos misma sesión disable→enable, Permission + Entitlement, ausente/futuro/expirado, A/B, input hostil, Decimal exacto, concurrencia y rollback atómico.
- E03-S04 no cambió `schema.prisma`, conserva siete migrations, no creó migration 8, no modificó prototype, no implementó E03-S05 y no requirió ADR.
- E03-S03 — Tenant detail: **PASS**; Epic 03 permanece **IN PROGRESS**.
- `GET /platform/tenants/:tenantId`, `/users` y `/audit` usan exclusivamente `PlatformAdminSessionGuard`; ausencia de sesión, cookie Tenant User, sesión revocada y Platform Admin disabled reciben 401, UUID inválido recibe 400 y UUID válido inexistente recibe 404.
- `createPlatformTenantDetailQueryService` es una consulta cross-tenant privilegiada exportada sólo desde `@whatsapp-platform/database/platform`; el controller no usa Prisma raw y el root tenant-safe no expone esta capacidad.
- El detalle devuelve identidad/configuración general segura, derivaciones de theme/branding, unidad raíz mínima, catálogo completo de 14 módulos, cinco limits Decimal serializados canónicamente, uso observado, deployment least-data y placeholders explícitos para canales/backup.
- La vigencia de entitlements comparte una única regla con E03-S01: enabled, `startsAt <= now` y `endsAt > now`; módulos ausentes se muestran disabled/no efectivos sin crear filas.
- Uso real disponible: conteos de Users y Organization Units. Channels, storage y AI usados permanecen `null`; nunca se inventa cero ni actividad/capacidad inexistente.
- Users y Audit son paginados (25 default, 100 máximo), tienen orden estable y filtro obligatorio por `tenantId`; roles incluyen sólo nombre/key y OU mínima, mientras Audit omite summaries e `ipMetadata`.
- `/platform/tenants/[tenantId]` implementa las ocho tabs General, Módulos, Usuarios, Canales, Deployment, Uso, Auditoría y Backup; usa APIs reales, carga diferida para Users/Audit y estados loading/empty/401/404/error sin fixtures ni mutaciones futuras.
- El listado E03-S01 enlaza el nombre del tenant al detalle; canales y backup se declaran honestamente no disponibles hasta sus historias propietarias.
- Suite dedicada `pnpm test:integration:platform-tenant-detail`: 2 archivos y 8 pruebas PostgreSQL 18.4/Nest, con aislamiento A/B, temporalidad, Decimal, auth, paginación, 404 y proyecciones sin campos sensibles.
- E03-S03 no cambió `schema.prisma`, conserva siete migrations, no creó migration 8, no modificó prototype, no implementó E03-S04/E03-S05 y no requirió ADR.
- E03-S02 — Create tenant: **PASS**; Epic 03 permanece **IN PROGRESS**.
- `POST /platform/tenants` devuelve 201 y usa exclusivamente identidad `PlatformAdminSessionGuard`; no acepta identidad tenant ni Platform sessions revocadas/disabled.
- `PlatformTenantProvisioningService` valida y normaliza input, reutiliza email/password policy Argon2id de Tenant auth y calcula el hash antes de abrir la transacción.
- `createPlatformTenantProvisioningRepository` se exporta sólo desde `@whatsapp-platform/database/platform` y persiste en un único transaction callback Tenant, Owner, roles, grants, assignment, root OU, entitlements, Audit y Outbox.
- Tenant nace `active`, con `brandingConfig = {}` como herencia del theme default y `settings = {}`; no existe worker/provisioning pendiente.
- Owner nace active/MFA disabled, queda asignado tenant-wide al role system `owner` y puede iniciar sesión inmediatamente; nunca se persiste o devuelve plaintext.
- Roles exactos: Owner, Administrator, Supervisor, Agent, Operator y Viewer, todos tenant-owned e `isSystem = true`; Owner recibe los 29 PermissionKey, los otros cinco comienzan deliberadamente con cero grants.
- `pnpm rbac:sync-permissions` es prerequisite operacional; provisioning verifica las 29 rows y falla cerrado con 503 si faltan, sin ejecutar sync por request.
- Root OU único: `company`, nombre del Tenant, sin parent/code/timezone y settings vacíos; timezone null hereda el default del Tenant.
- Catálogo cerrado de 14 módulos; sólo los seleccionados crean rows enabled/manual_override sin vigencia. Los cinco limits explícitos usan los valores administrativos del request en `Decimal(20,4)`.
- Deployment es opcional, nunca se selecciona implícitamente y un UUID inexistente devuelve 422.
- Audit `tenant.created` usa actor Platform Admin y summary mínimo; Outbox `tenant.created` queda unpublished/attempts 0. Ninguno contiene password/hash.
- `/platform/tenants/new` implementa wizard responsive Empresa/Capacidades/Owner/Confirmación, POST real, prevención de double submit, limpieza de password en error y redirect al listado con feedback.
- E03-S02 no cambió schema/migrations, no creó migration 8, no modificó prototype y no requirió ADR.
- E03-S01 — Tenant list: **PASS**; Epic 03 permanece **IN PROGRESS**.
- `GET /platform/tenants` usa exclusivamente `PlatformAdminSessionGuard`; cookies tenant, sesiones revocadas y Platform Admin disabled reciben 401.
- Query cross-tenant explícita disponible sólo desde `@whatsapp-platform/database/platform`; controller sin Prisma raw y root tenant-safe sin acceso Platform.
- Response least-data con identidad/status, deployment seguro, módulos efectivos, `userCount`, `channelCount: null` y `lastActivityAt`; excluye JSONB privados, hashes, sessions y audit payloads.
- Módulos se filtran por prefix `module.`, `enabled = true`, `startsAt <= now` y `endsAt > now`; limits y permission keys se excluyen.
- Actividad representa la última observación entre `UserSession.lastSeenAt` y `AuditLog.occurredAt`; no usa `Tenant.updatedAt` ni persiste una derivación.
- `channelCount` queda **NULL / DEFERRED UNTIL CHANNELACCOUNT**; la web muestra em dash y no inventa cero.
- Query estable y sin N+1: dos operaciones Prisma de nivel superior por página (`count` + `findMany` con agregados/relations), independientes del número de tenants.
- `/platform/tenants` en Next.js implementa tabla Platform Control responsive, búsqueda, status filter, paginación y estados loading/empty/error/loaded sin fixtures ni enlaces a historias futuras.
- E03-S01 no cambió `schema.prisma`, no creó migration 8 y no requirió ADR.
- Epic 02 — Authentication and Tenancy: **PASS / COMPLETE** con E02-S01 a E02-S05 verificadas.
- E02-S05 — RBAC base: **PASS**, documentada por ADR-0017.
- Séptima migration añade exclusivamente `Role`, `Permission`, `UserRole` y `RolePermission`, con UUIDv7, `TIMESTAMPTZ(3)`, FKs compuestas tenant-aware e índices de assignment.
- Catálogo global de 29 `PermissionKey` exactas en `packages/rbac`; `pnpm rbac:sync-permissions` inserta/actualiza de forma idempotente, no borra extras y no crea roles tenant.
- `TenantDataAccess` expone roles custom, grants/revokes, assignments/revokes y resolución efectiva sin Prisma inputs arbitrarios; tenant/isSystem nunca proceden del caller.
- `UserRole` no puede mezclar User, Role u Organization Unit de tenants distintos ni apuntar a templates globales; la DB y el boundary de aplicación lo rechazan.
- Resolver tenant-wide usa unión allow-set de roles válidos, ignora assignments OU-scoped, grants constrained y permission keys desconocidas, y consulta PostgreSQL por request.
- `@RequirePermissions` usa `PermissionKey`; `TenantPermissionGuard` se ejecuta después de sesión/contexto, requiere ALL, devuelve 403 sin permiso y conserva 401 para auth inválida.
- Owner/Viewer no son security boundaries: Owner sin grant falla y Viewer con grant pasa. Revocation se refleja en la misma sesión en la siguiente request.
- Default roles Owner, Administrator, Supervisor, Agent, Operator y Viewer quedan definidos sin permission matrix; provisioning/mapping se difiere explícitamente a E03-S02.
- E02-S04 — Tenant isolation tests: **PASS**; no requirió cambios de schema, migrations ni arquitectura productiva.
- Comando dedicado `pnpm test:security:tenant-isolation`: 5 archivos y 34 pruebas contra PostgreSQL 18.4 real (8 database; 26 API/auth/arquitectura).
- Matriz A/B exhaustiva para las superficies tenant-owned actuales: `TenantEntitlement`, `OrganizationUnit`, `AuditLog`, `DomainEventOutbox`, `User`, `UserSession`, `UserPasswordResetToken` y endpoints tenant autenticados existentes.
- IDs ajenos, inputs hostiles `tenantId`/`tenant`, FKs compuestas cross-tenant, mismo email en tenants distintos, sesiones/reset cross-tenant, revocación/expiración y fuentes de request hostiles fallan sin fuga ni mutación.
- Transacciones commit/rollback y operaciones concurrentes A/B sobre el mismo Prisma Client preservan el tenant correcto; el facade tenant no expone Prisma raw, publisher Outbox ni audit platform.
- Test arquitectónico fija los únicos imports privilegiados actuales en composition root, bootstrap/auth/infraestructura; ningún camino tenant-owned de aplicación obtiene Prisma raw.
- `Message`, `Conversation`, `Process`, `ActionRequest`, `Quote`, `Document`, portal grants y jobs tenant-owned quedan **DEFERRED** hasta que sus modelos y endpoints existan; no se anticipó Epic posterior.
- E02-S03 — Tenant context middleware: **PASS**; no requirió migration ni ADR nuevo.
- Pipeline Nest explícito `TenantUserSessionGuard` → `TenantContextGuard` → controller/service; guards ejecutados en ese orden y sin middleware pre-auth.
- `TenantSessionIdentity` expone `sessionId`, `userId` y `tenantId` persistidos; la request autenticada recibe `auth` y `tenantContext` como propiedades readonly/no reasignables.
- `TenantContextGuard` deriva contexto únicamente de `auth.tenantId`, reutiliza `createTenantContext(...)` y falla 401 sin identidad tenant válida.
- `@TenantAuthenticated()`, `@CurrentTenantContext()` y `@CurrentTenantIdentity()` ofrecen composición/extracción tipada sin headers, body, query, route tenant ID ni slug post-auth.
- `TenantDataAccessFactory` reutiliza el cliente singleton y conecta explícitamente `TenantContext` con `createTenantDataAccess(...)`; no crea Prisma request-scoped ni estado ambiental.
- Ocho pruebas verticales sobre Nest/PostgreSQL real cubren contextos A/B, body/query/headers/route hostiles, ausencia de sesión, cookie Platform, sesión revocada/expirada, user disabled, tenant suspended, read/write scoped y concurrencia A/B.
- E02-S02 — Tenant user auth: **PASS**, documentada por ADR-0016.
- `User`, `UserSession` y `UserPasswordResetToken` tenant-owned y separados de Platform Admin, con `tenant_id NOT NULL`.
- Email normalizado unique por tenant; misma dirección verificada en dos tenants con passwords distintos.
- Sexta migration append-only con UUIDv7, `TIMESTAMPTZ(3)`, token hashes `BYTEA` unique y FKs compuestas `(tenant_id, user_id)`.
- Login pre-auth por tenant slug, sesión opaca de 12 horas/2 horas idle y cookie tenant distinta de platform.
- `/auth/me`, logout idempotente y revoke-all limitado al user actual; status User/Tenant revalidado en cada request.
- Password reset CSPRNG de 256 bits, 15 minutos, single-use, revocación de tokens previos y de todas las sesiones al completar.
- `PasswordResetDelivery` recibe el reset link sólo después del commit; no existe todavía adapter operativo de correo.
- Origin exacto, CORS explícito y buckets process-local separados para login/reset request/reset confirm.
- Auditoría tenant transaccional para login, logout, revoke-all y password reset request/completed sin secrets.
- E02-S01 — Platform Admin auth: **PASS**, documentada por ADR-0015.
- `PlatformAdmin` y `PlatformAdminSession` permanecen separados de Tenant User y sin `tenant_id`.
- Quinta migration append-only con UUIDv7, `TIMESTAMPTZ(3)`, hash de token `BYTEA` unique, revocación y expiración.
- Password hashing Argon2id y bootstrap explícito `pnpm platform-admin:create`; ninguna credencial se crea al iniciar la aplicación.
- Sesiones opacas server-side de 256 bits, sólo SHA-256 persistido, expiración absoluta de 8 horas e idle timeout de 30 minutos.
- Cookie HttpOnly/SameSite Strict; `__Host-` + Secure en producción y nombre local separado en desarrollo/test.
- Endpoints `POST /platform/auth/login`, `GET /platform/auth/me` y `POST /platform/auth/logout`, con logout idempotente.
- Origin exacto, CORS sin wildcard, JSON estricto, respuesta genérica de credenciales y rate limiting de login sin sleeps.
- Login/logout auditados transaccionalmente con `tenant_id = NULL`, sin password, hash ni token raw.
- Suite de integración API/PostgreSQL real cubre migración física, login válido/inválido, admin disabled, expiración absoluta, inactividad, revocación, sesiones simultáneas, cookie, origen y audit.
- Epic 00 — Repository Foundation: **PASS / COMPLETE**.
- Epic 01 — Database Foundation: **PASS / COMPLETE**.
- E01-S01 — Prisma/schema baseline: **PASS**.
- E01-S02 — ID/timestamp conventions: **PASS**, documentada por ADR-0012.
- E01-S03 — Tenant-aware repository utilities: **PASS**.
- E01-S04 — Outbox foundation: **PASS**, documentada por ADR-0013.
- E01-S05 — Audit foundation: **PASS**, documentada por ADR-0014.
- `AuditLog` lógicamente append-only con UUIDv7, tenant nullable para plataforma, summaries/IP metadata JSONB y request ID obligatorio.
- `tenantData.audit.append(...)` deriva siempre tenant desde `TenantContext`; no acepta `tenantId`, `id` ni `occurredAt`.
- `createPlatformAuditWriter(...)` está disponible sólo en `@whatsapp-platform/database/platform` para audit puro o tenant-related privilegiado.
- FK compuesta `(tenant_id, organization_unit_id)` impide asociar OrganizationUnit cross-tenant; audit platform puro no admite OrganizationUnit.
- Domain mutation + AuditLog + Outbox comparten el mismo `TransactionClient` dentro de `withTenantTransaction`.
- Nueve pruebas Audit sobre PostgreSQL 18.4 cubren esquema físico, actores, JSONB, tenant/platform paths, aislamiento y atomicidad.
- Cuarta migration `20260813170000_append_only_audit_foundation`, append-only y sin cambios a las tres migrations históricas.
- `DomainEventOutbox` tenant-owned con UUIDv7 DB-side, payload JSONB y bookkeeping de publicación pendiente.
- `outbox.append(...)` inyecta `tenant_id` desde `TenantContext` y no expone IDs ni campos de publicación al caller.
- `withTenantTransaction(context, database, callback)` entrega el facade tenant-scoped sobre el mismo `TransactionClient`, sin Prisma raw.
- Commit y rollback atómicos verificados con domain write + Outbox; un insert Outbox inválido revierte también el domain write.
- Seis pruebas Outbox sobre PostgreSQL 18.4 cubren campos físicos, UUIDv7, payload, dos tenants y atomicidad en ambas direcciones.
- Tercera migration `20260813140000_transactional_outbox_foundation`, append-only y sin cambios a las dos migrations históricas.
- `TenantContext` obligatorio, inmutable y validado como UUIDv7 antes de construir acceso tenant-owned.
- `createTenantDataAccess(context, database)` expone únicamente repositories scoped de entitlements y organization units.
- Reads y updates por ID combinan `id` + `tenant_id` en la misma query; acceso cross-tenant se comporta como not found.
- Inputs planos de create/update no aceptan `tenantId`, relación `tenant` ni cambio de `id`; el tenant se inyecta internamente.
- Root `@whatsapp-platform/database` es el camino tenant-safe; `@whatsapp-platform/database/platform` es el escape hatch Prisma explícitamente privilegiado.
- Repositories, AuditLog y Outbox compatibles con Prisma Client normal y `TransactionClient`, sin UnitOfWork.
- Nueve pruebas tenant-aware sobre PostgreSQL real cubren dos tenants, aislamiento, updates, creación, jerarquía y transacción.
- Schema Prisma y las dos migrations permanecen sin cambios y sin drift.
- PK UUID surrogate canónicas como UUIDv7 con tipo físico PostgreSQL UUID y default nativo `uuidv7()`.
- `PlatformFeatureFlag.key` conserva su clave natural; la convención no fuerza UUID sobre identidades naturales deliberadas.
- Timestamps de instantes como `TIMESTAMPTZ(3)` UTC; `created_at` y `updated_at` tienen valor inicial `now()` y Prisma mantiene `updated_at` en operaciones normales.
- Segunda migration `20260813044133_uuidv7_timestamp_conventions` append-only, sin alterar la migration histórica E01-S01.
- PostgreSQL >= 18 declarado requisito mínimo mientras se use `uuidv7()` nativo.
- Doce tests de integración verifican generación DB-side, versión UUID 7, tipos físicos, nullability y actualización Prisma de `updated_at`.
- E01-S01 con Prisma ORM 7.9.1 dentro del boundary `packages/database` y ADR-0011.
- Baseline PostgreSQL versionada para `PlatformDeployment`, `Tenant`, `TenantEntitlement`, `PlatformFeatureFlag` y `OrganizationUnit`.
- Naming físico snake_case, JSONB limitado a configuración/metadata, TIMESTAMPTZ UTC, enums de dominio, FKs e índices baseline.
- `tenant_id NOT NULL` en `tenant_entitlement` y `organization_unit`; FK compuesta impide parent cross-tenant.
- Unique global de `tenant.slug` y unique `(tenant_id, entitlement_key)` con semántica mínima de una fila efectiva por key.
- `business_hours_id` permanece UUID nullable sin FK hasta el epic que introduzca Business Hours.
- Prisma Client reusable con adapter PostgreSQL y lifecycle compartido; sin acoplamiento a `apps/api`.
- Scripts root/package para validate, generate, migrate dev/deploy, Studio e integración DB.
- Migration `20260813040527_initial_platform_baseline` aplicada desde cero y verificada contra PostgreSQL 18.4 real.
- Nueve tests de integración DB para conexión, CRUD baseline, uniques, FKs, jerarquía tenant-consistent y vigencia.

- Agent Skill movida a `.agents/skills/whatsapp-platform-engineering/SKILL.md` con frontmatter estándar y rutas desde la raíz.
- `AGENTS.md` raíz y adaptador `.agents/agents.md` creados sin duplicar el contrato.
- Workspace pnpm con `apps/`, `services/` y `packages/`; pnpm 11.21.0 y Node 24 fijados.
- Next.js 16.3.0 mínimo en `apps/web`.
- NestJS 11.1.29 mínimo en `apps/api` con `GET /health`.
- Procesos mínimos arrancables `worker-jobs` y `worker-whatsapp`, sin BullMQ ni Baileys.
- Boundaries sin comportamiento futuro para document renderer, AI gateway, database, auth, tenancy, RBAC, events, workflows, messaging, processes y UI.
- TypeScript 6.0.3 estricto y configuración compartida.
- Biome, Vitest, scripts root y lockfile reproducible.
- `packages/config` con validación al boot, separación secret/non-secret, defaults seguros, overrides y errores explícitos.
- Compose de desarrollo con PostgreSQL 18.4, Redis 8.8.1, API, web y workers; health checks, named volumes, redes internas y puertos de datos limitados a localhost.
- Imagen de aplicación construida una sola vez y reutilizada por API, web y workers, sin colisiones concurrentes de tags.
- Corepack/pnpm disponible para el usuario runtime `node` sin requerir acceso a red.
- Red `app-network` accesible desde el host para API/web; `data-network` permanece interna.
- Runtime Docker validado con los seis servicios `healthy`, API real en `127.0.0.1:3001/health` y web en `127.0.0.1:3000`.
- `.env.example`, `.gitignore`, `.dockerignore` y `Dockerfile.dev` sin secretos reales.
- Documentación operativa actualizada sin modificar `design-prototype/`.

## In progress

Epic 04 — Tenant Dashboard Shell continúa con E04-S03 pendiente.

## Blocked

Ningún bloqueo de código para E04-S02. Password recovery requiere un adapter de delivery antes de habilitarse operativamente.

## Next story

`E04-S03 — Organization Units management`

No implementarla sin una instrucción separada.

## Last verified commands

- `pnpm test:integration:theme-engine` — PASS; 7 pruebas database y 9 pruebas API contra PostgreSQL 18.4/Nest reales (E04-S02 Theme Engine).
- `pnpm test:integration:auth` — PASS; 12 archivos y 75 pruebas API/auth, incluidas las regresiones E04-S01/E04-S02.
- `pnpm test:integration:tenant-app-bootstrap` / `pnpm test:security:tenant-isolation` — PASS; 5 pruebas bootstrap y 9 + 37 pruebas de aislamiento/arquitectura (boundary de imports privilegiados conservado).
- `pnpm install --frozen-lockfile` / `pnpm rbac:sync-permissions` — PASS; instalación reproducible y 29 permisos sincronizados.
- `pnpm db:validate` / `pnpm db:generate` / `pnpm db:migrate:deploy` / `prisma migrate status` / `prisma migrate diff --exit-code` — PASS; siete migrations y cero drift, shadow DB vía `SHADOW_DATABASE_URL`.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm format:check` / `git diff --check` — PASS; 184 archivos Biome, 13 archivos y 60 pruebas unitarias, 18 workspaces y ruta Next `/app/settings/theme` compilada.
- `docker compose config --quiet` / `docker compose build api web` — PASS; imagen Linux con instalación frozen y build completo en el contenedor.
- Runtime Compose E04-S02 — PASS; PostgreSQL, Redis, API y web healthy; API `/health` 200, web `/` y `/app` 200.
- `pnpm install --frozen-lockfile` / `pnpm db:validate` / `pnpm db:generate` / `pnpm db:migrate:deploy` / `prisma migrate status` / `prisma migrate diff --exit-code` — PASS; PostgreSQL 18.4 con siete migrations, sin pendientes ni drift.
- `pnpm format` / `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm format:check` — PASS; 153 archivos Biome y suite raíz 8 archivos/30 pruebas.
- `docker compose config --quiet` / `docker compose build api web` / `docker compose up -d` / `docker compose ps` / `GET http://127.0.0.1:3001/health` / `GET http://127.0.0.1:3000/` / `docker compose down` — PASS; postgres, redis, api, web, worker-jobs y worker-whatsapp `healthy`, API 200 `{\"service\":\"api\",\"status\":\"ok\"}`, web 200; volumes preservados.
- `pnpm test:integration:tenant-status` — PASS; 3 pruebas database y 4 pruebas API contra PostgreSQL 18.4/Nest reales.
- `pnpm test:integration:platform-tenants` / `pnpm test:integration:tenant-provisioning` / `pnpm test:integration:platform-tenant-detail` / `pnpm test:integration:entitlements` — PASS; regresiones E03-S01 a E03-S04.
- `pnpm test:integration:entitlements` — PASS; 3 pruebas database y 5 pruebas API contra PostgreSQL 18.4/Nest reales.
- `pnpm test:integration:platform-tenant-detail` / `pnpm test:integration:platform-tenants` / `pnpm test:integration:tenant-provisioning` — PASS; regresiones E03-S01 a E03-S03.
- `pnpm test:integration:database` — PASS; 10 archivos y 71 pruebas PostgreSQL.
- `pnpm test:integration:auth` — PASS; 9 archivos y 57 pruebas API/auth.
- `pnpm test:integration:rbac` — PASS; 11 pruebas database y 11 pruebas API.
- `pnpm test:security:tenant-isolation` — PASS; 9 pruebas database y 37 pruebas API/arquitectura.
- `pnpm install --frozen-lockfile` / `pnpm rbac:sync-permissions` — PASS; instalación reproducible y 29 permisos sincronizados.
- `pnpm db:validate` / `pnpm db:generate` / `pnpm db:migrate:deploy` / `prisma migrate status` / `prisma migrate diff --exit-code` — PASS contra PostgreSQL 18.4 limpio; siete migrations y cero drift.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm format:check` / `git diff --check` — PASS; 8 archivos y 30 pruebas unitarias/frontend.
- `docker compose config --quiet` / `docker compose build api web` — PASS; imagen Linux de API/web reconstruida.
- Runtime Compose E03-S04 — PASS; PostgreSQL, Redis, API y web healthy; API `/health` 200 y web tenant detail 200; `docker compose down` ejecutado sin borrar named volumes.
- `pnpm test:integration:platform-tenant-detail` — PASS; 2 archivos y 8 pruebas contra PostgreSQL 18.4/Nest reales.
- `pnpm test:integration:platform-tenants` / `pnpm test:integration:tenant-provisioning` — PASS; regresiones E03-S01/E03-S02.
- `pnpm test:integration:database` / `pnpm test:integration:auth` / `pnpm test:integration:rbac` / `pnpm test:security:tenant-isolation` — PASS.
- `pnpm db:validate` / `pnpm db:generate` / `pnpm db:migrate:deploy` / `prisma migrate status` / `prisma migrate diff --exit-code` — PASS contra PostgreSQL 18.4; siete migrations y cero drift.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm format:check` / `git diff --check` — PASS; 7 archivos y 27 pruebas unitarias, 16 workspaces y ruta Next `/platform/tenants/[tenantId]` compilada.
- `docker compose config --quiet` / `docker compose build api web` — PASS; layers, manifest e imagen `whatsapp-platform-dev:epic00` exportados y desempaquetados sin errores containerd.
- Runtime Compose — PASS; PostgreSQL, Redis, API, Web, worker-jobs y worker-whatsapp healthy; API `/health` 200, Web tenant detail 200 y API detail sin sesión 401.
- `pnpm test:integration:tenant-provisioning` — PASS; 2 archivos y 10 pruebas PostgreSQL/Nest dedicadas.
- `pnpm test:integration:platform-tenants` — PASS; 2 archivos y 9 pruebas de regresión E03-S01.
- `pnpm test:integration:database` — PASS; 8 archivos y 64 pruebas PostgreSQL.
- `pnpm test:integration:auth` — PASS; 7 archivos y 48 pruebas API/auth.
- `pnpm test:integration:rbac` — PASS; 2 archivos y 22 pruebas.
- `pnpm test:security:tenant-isolation` — PASS; 6 archivos y 46 pruebas.
- `pnpm test` — PASS; 6 archivos y 23 pruebas unitarias/frontend.
- `pnpm lint` / `pnpm typecheck` / `pnpm build` / `pnpm format:check` — PASS; 120 archivos y 16 workspaces, incluidas rutas Next dinámicas `/platform/tenants` y `/platform/tenants/new`.
- `pnpm install --frozen-lockfile` / `pnpm rbac:sync-permissions` / `pnpm db:validate` / `pnpm db:generate` — PASS; 29 permisos sincronizados.
- `pnpm db:migrate:deploy` / `prisma migrate status` / `prisma migrate diff --exit-code` — PASS contra PostgreSQL 18.4; siete migrations existentes y cero drift.
- Atomicidad E03-S02 — PASS; commit completo y rollback real por trigger PostgreSQL temporal retirado después de la prueba.
- `docker compose config --quiet` / `docker compose build api web` — PASS; imagen Linux reconstruida con instalación frozen y las dos rutas Platform.
- Runtime Compose E03-S02 — PASS; PostgreSQL, Redis, API y web healthy; API health 200, control plane sin sesión 401 y `/platform/tenants/new` 200.
- `pnpm rbac:sync-permissions` ejecutado dos veces — PASS; 29 permissions sincronizadas en cada ejecución, sin duplicados ni borrado de fila extra.
- `pnpm test:integration:rbac` — PASS; 2 archivos y 22 pruebas PostgreSQL/Nest dedicadas.
- `pnpm test:integration:database` — PASS; 6 archivos y 56 pruebas contra PostgreSQL 18.4.
- `pnpm test:integration:auth` — PASS; 5 archivos y 37 pruebas, incluidas 11 del guard RBAC.
- `pnpm test:security:tenant-isolation` — PASS; 6 archivos y 46 pruebas, incluidas superficies Role/UserRole/RolePermission.
- `pnpm db:migrate:deploy` desde PostgreSQL 18.4 limpio — PASS; migrations 1–7 aplicadas en orden.
- `prisma migrate status` / `prisma migrate diff --exit-code` — PASS; siete migrations y sin drift.
- Migration E02-S05 SHA-256 — `02f40cb66c2dcaead3083f84e88edbec73fa1c803a6be859b33d72e3ed88e4cf`; migrations históricas 1–6 permanecen intactas.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm format:check` — PASS; 100 archivos revisados, 16 workspaces compilados y 4 archivos/17 pruebas unitarias.
- `docker compose build api` — PASS; imagen Linux `whatsapp-platform-dev:epic00` construida con instalación frozen y build de los 16 workspaces.
- Runtime Compose aislado (`postgres`, `redis`, `api`) — PASS; PostgreSQL 18.4, Redis 8.8.1 y API `healthy`; `GET http://127.0.0.1:53001/health` respondió HTTP 200 con `{"service":"api","status":"ok"}`.
- Limpieza E02-S05 — PASS; cero tenants fixture, exactamente 29 permissions globales, contenedor PostgreSQL temporal retirado y `docker compose down` ejecutado sin borrar named volumes.
- `docker compose config --quiet` — PASS con variables efímeras de validación; no se creó `.env` ni se persistieron secretos.
- Schema/migrations — PASS; `schema.prisma` y las seis migrations permanecen sin cambios, `migrate status` actualizado y `migrate diff` sin drift.
- Limpieza E02-S04 — PASS; cero tenants/audits residuales y contenedor PostgreSQL temporal retirado sin crear named volumes.
- `git diff --check` y secret scan — PASS.
- Matriz E02-S04 — PASS; aislamiento A/B en repositories, auth/context, transacciones concurrentes, rollback, IDs/FKs cross-tenant e inputs hostiles.
- Static privileged-import review — PASS; imports raw limitados a composition root, bootstrap/auth/infraestructura y ningún camino tenant-owned de aplicación.
- Modelos futuros (`Message`, `Conversation`, `Process`, `ActionRequest`, `Quote`, `Document`, portal grants y jobs) — DEFERRED por inexistencia; deberán añadirse al implementar cada superficie.
- `pnpm install --frozen-lockfile` — PASS; 17 workspaces y lockfile reproducible para E02-S04.
- `pnpm db:validate` / `pnpm db:generate` — PASS; schema sin cambios y Prisma Client 7.9.1 generado.
- `pnpm db:migrate:deploy` desde PostgreSQL 18 limpio — PASS; las seis migrations existentes aplicadas, ninguna nueva.
- `prisma migrate status` / `prisma migrate diff --exit-code` — PASS; schema actualizado y sin drift.
- `pnpm test:integration:database` — PASS; 4 archivos, 36 pruebas PostgreSQL sin regresión.
- `pnpm test:integration:auth` — PASS; 3 archivos, 25 pruebas: 8 tenant-context, 10 Tenant User/reset y 7 Platform Admin.
- Pipeline E02-S03 — PASS; context A/B, request sources hostiles, no-session/platform-cookie, revocación/expiración/status, read/write scoped y concurrencia.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm format:check` — PASS.
- `docker compose config --quiet` — PASS con variables locales efímeras.
- `docker compose build api` — PASS; imagen Node 24/Alpine recompilada con E02-S03. El pipeline `/auth/me` + sesión real se verificó en la suite Nest/PostgreSQL.
- Schema/migrations — PASS; `schema.prisma` y migrations 1–6 sin cambios frente a `HEAD` de inicio.
- Static import review — PASS; imports privilegiados limitados a bootstrap/auth/infraestructura y fixtures; ningún endpoint tenant-owned nuevo usa Prisma raw.
- `git diff --check` y secret scan — PASS; contenedores temporales retirados y named volumes preservados.
- `pnpm install` — PASS; 17 workspaces, lockfile generado, pnpm 11.21.0.
- `pnpm lint` — PASS; 60 archivos, sin warnings después de corregir la configuración.
- `pnpm typecheck` — PASS; raíz y 16 workspaces.
- `pnpm test` — PASS; 1 archivo, 3 pruebas reales de configuración.
- `pnpm build` — PASS; 16 workspaces y build de producción Next.js.
- `pnpm format:check` — PASS; 60 archivos.
- `PYTHONUTF8=1 python .../quick_validate.py .agents/skills/whatsapp-platform-engineering` — PASS; `Skill is valid!`.
- `docker compose config --quiet` — PASS con variables locales efímeras.
- `docker version` — PASS; cliente/engine 29.2.1, Docker Desktop 4.62.0, server Linux `amd64`.
- `docker info` — PASS; engine `docker-desktop` sobre kernel WSL2 `6.6.87.2-microsoft-standard-WSL2`.
- `docker context ls` / `docker context show` — PASS; contexto activo `desktop-linux` sobre `dockerDesktopLinuxEngine`.
- `docker compose version` — PASS; Docker Compose v5.0.2.
- `docker compose up -d --build` — PASS después de corregir la colisión de imagen, la caché runtime de Corepack y la red de aplicación.
- `docker compose ps` — PASS; `postgres`, `redis`, `api`, `web`, `worker-jobs` y `worker-whatsapp` en estado `healthy`.
- `curl.exe --fail --silent --show-error http://127.0.0.1:3001/health` — PASS; `{"service":"api","status":"ok"}`.
- `curl.exe --fail --silent --show-error http://127.0.0.1:3000/` — PASS; HTTP 200.
- `docker run --rm --network none --entrypoint pnpm whatsapp-platform-dev:epic00 --version` — PASS; `11.21.0` sin red.
- `docker compose down` — PASS; contenedores/redes retirados y named volumes `postgres-data`/`redis-data` preservados.
- `pnpm install --frozen-lockfile` — PASS; 17 workspaces y lockfile reproducible.
- `pnpm db:validate` — PASS; Prisma schema válido.
- `pnpm db:generate` — PASS; Prisma Client 7.9.1 generado desde output explícito.
- `pnpm db:migrate:deploy` — PASS contra PostgreSQL 18.4 limpio; una migration aplicada.
- `prisma migrate status` — PASS; database schema up to date.
- `prisma migrate diff --from-config-datasource --to-schema ... --exit-code` — PASS; sin diferencias.
- Migration SHA-256 — `743bffcb89c6051759f5417269255c6c6d96359b0520418a2d9c7c7cb37196ab`, igual al checksum registrado por Prisma.
- `pnpm test:integration:database` — PASS; 1 archivo, 9 pruebas contra PostgreSQL real.
- `pnpm lint` — PASS; 63 archivos.
- `pnpm typecheck` — PASS; raíz y 16 workspaces, incluido generate de Prisma.
- `pnpm test` — PASS; 1 archivo, 4 pruebas unitarias de configuración.
- `pnpm build` — PASS; 16 workspaces, Next.js y package database con generate.
- `pnpm format:check` — PASS.
- `git diff --check` — PASS.
- `pnpm install --frozen-lockfile` — PASS; 17 workspaces, lockfile sin cambios de dependencias.
- `pnpm db:validate` / `pnpm db:generate` — PASS; modelos E02-S02 generados con Prisma 7.9.1.
- `pnpm db:migrate:deploy` desde PostgreSQL 18.4 limpio — PASS; migrations 1–6 aplicadas en orden.
- `prisma migrate status` — PASS; seis migrations, database schema up to date.
- `prisma migrate diff --from-config-datasource --to-schema ... --exit-code` — PASS; sin drift.
- Migration E02-S02 SHA-256 — `3859b064fe27b970cc64f5eae24fdda51d4dd06531bce2d70dbb9719edbbad4e`.
- Migrations históricas 1–5 — PASS; sin diferencias frente a `HEAD` inicial de la historia.
- `pnpm test:integration:database` — PASS; 4 archivos, 36 pruebas PostgreSQL sin regresión.
- `pnpm test:integration:auth` — PASS; 2 archivos, 17 pruebas: 10 tenant/reset y 7 Platform Admin regression.
- `pnpm lint` — PASS sin warnings; `pnpm typecheck` — PASS; `pnpm test` — PASS, 3 archivos/14 pruebas; `pnpm build` — PASS; `pnpm format:check` — PASS.
- `docker compose config --quiet` — PASS con variables locales efímeras.
- `docker compose build api` — PASS; build completo Node 24/Alpine con Prisma y Argon2.
- API Docker aislada — PASS; `/health` 200 y login tenant desconocido 401 contra PostgreSQL temporal por `host.docker.internal`.
- Limpieza E02-S02 — PASS; contenedores aislados de API/PostgreSQL retirados y named volumes preservados.
- `git diff --check` — PASS y secret scan sin hallazgos.
- Limpieza E02-S01 — PASS; PostgreSQL temporal y Compose retirados, named volumes preservados.
- `docker compose config --quiet` — PASS sin modificar la infraestructura versionada.
- `pnpm db:validate` — PASS con defaults `dbgenerated("uuidv7()")` y `TIMESTAMPTZ(3)`.
- `pnpm db:generate` — PASS; Prisma Client 7.9.1 generado.
- Migration limpia `20260813040527_initial_platform_baseline` seguida por `20260813044133_uuidv7_timestamp_conventions` — PASS en PostgreSQL 18.4 real.
- Migration E01-S02 SHA-256 — `d29a5f692606c6836e7b3999a3f0b40b6138246a51e5c40c5871c09415dd70d0`.
- `prisma migrate status` — PASS; dos migrations y schema actualizado.
- `prisma migrate diff --from-config-datasource --to-schema ... --exit-code` — PASS; sin diferencias.
- `pnpm test:integration:database` — PASS; 1 archivo, 12 pruebas contra PostgreSQL 18.4 real.
- Inspección `information_schema` — PASS; cuatro PK `uuid` con default `uuidv7()` y 14 timestamps `timestamp with time zone` precisión 3.
- `uuid_extract_version()` / `uuid_extract_timestamp()` — PASS; versión 7 y timestamp disponible.
- `pnpm db:validate` / `pnpm db:generate` — PASS; schema E01-S02 intacto.
- `prisma migrate status` — PASS; dos migrations, database schema up to date.
- `prisma migrate diff --from-config-datasource --to-schema ... --exit-code` — PASS; sin drift.
- `pnpm test:integration:database` — PASS; 2 archivos, 21 pruebas, incluidas 9 tenant-aware contra PostgreSQL 18.4 real.
- `pnpm test` — PASS; 2 archivos, 9 pruebas unitarias, incluida validación de `TenantContext`.
- Inspección de exports — PASS; root sin Prisma raw y subpath `/platform` explícitamente privilegiado.
- Limpieza de fixtures — PASS; cero tenants/entitlements E01-S03 residuales.
- `pnpm install --frozen-lockfile` — PASS; 17 workspaces, lockfile reproducible.
- `pnpm db:validate` / `pnpm db:generate` — PASS; `DomainEventOutbox` generado con Prisma 7.9.1.
- `pnpm db:migrate:deploy` desde PostgreSQL 18.4 limpio — PASS; migrations E01-S01, E01-S02 y E01-S04 aplicadas en orden.
- `prisma migrate status` — PASS; tres migrations, database schema up to date.
- `prisma migrate diff --from-config-datasource --to-schema ... --exit-code` — PASS; sin drift.
- Migration E01-S04 SHA-256 — `093b675c86909179c9707df1d1d92031313c3cb8042f5d0fe0b44c5fa117bfbd`.
- Migrations históricas E01-S01/E01-S02 — PASS; objetos Git del working tree coinciden con `HEAD`.
- `pnpm test:integration:database` — PASS; 3 archivos, 27 pruebas contra PostgreSQL 18.4, incluidas 6 de Outbox.
- Atomicidad Outbox — PASS; commit conjunto, rollback deliberado y rollback del dominio ante insert Outbox inválido.
- Campos físicos — PASS; UUIDv7, UUID/FK tenant NOT NULL, JSONB, `TIMESTAMPTZ(3)`, attempts 0 y campos nullable verificados.
- `pnpm lint` — PASS; 70 archivos.
- `pnpm typecheck` — PASS; raíz y 16 workspaces, incluido Prisma generate.
- `pnpm test` — PASS; 2 archivos, 9 pruebas unitarias.
- `pnpm build` — PASS; 16 workspaces y build Next.js de producción.
- `pnpm format:check` — PASS; 70 archivos.
- `docker compose config --quiet` — PASS con variables locales efímeras.
- `git diff --check` — PASS.
- Limpieza de fixtures/DB temporal — PASS; cero eventos/tenants E01-S04 residuales y contenedor temporal eliminado.
- `pnpm install --frozen-lockfile` — PASS; 17 workspaces, lockfile reproducible para E01-S05.
- `pnpm db:validate` / `pnpm db:generate` — PASS; `AuditLog` generado con Prisma 7.9.1.
- `pnpm db:migrate:deploy` desde PostgreSQL 18.4 limpio — PASS; migrations E01-S01 a E01-S05 aplicadas en orden.
- `prisma migrate status` — PASS; cuatro migrations, database schema up to date.
- `prisma migrate diff --from-config-datasource --to-schema ... --exit-code` — PASS; sin drift.
- Migration E01-S05 SHA-256 — `d6a4ea91628719e6272abefd5cc94e633c2ef106f7aecc996904ea8c1a33a375`.
- Migrations históricas E01-S01/E01-S02/E01-S04 — PASS; objetos Git del working tree coinciden con `HEAD`.
- `pnpm test:integration:database` — PASS; 4 archivos, 36 pruebas contra PostgreSQL 18.4, incluidas 9 de Audit.
- Atomicidad Audit — PASS; commit/rollback domain + Audit + Outbox y rollback de dominio ante Audit inválido.
- Seguridad Audit — PASS; tenant injection, writer platform privilegiado, FK OU tenant-aware, root sin writer platform y cero términos de secrets en fixtures.
- `pnpm lint` — PASS; 72 archivos, sin warnings.
- `pnpm typecheck` — PASS; raíz y 16 workspaces, incluido Prisma generate.
- `pnpm test` — PASS; 2 archivos, 9 pruebas unitarias.
- `pnpm build` — PASS; 16 workspaces y build Next.js de producción.
- `pnpm format:check` — PASS; 72 archivos.
- `docker compose config --quiet` — PASS con variables locales efímeras.
- `git diff --check` — PASS.
- Limpieza E01-S05 — PASS; cero audit/outbox/tenants residuales y contenedor PostgreSQL temporal eliminado.
- `pnpm install --frozen-lockfile` — PASS; Argon2 0.45.1 reproducible y build script autorizado explícitamente.
- `pnpm db:validate` / `pnpm db:generate` — PASS; modelos Platform Admin generados con Prisma 7.9.1.
- `pnpm db:migrate:deploy` desde PostgreSQL 18.4 limpio — PASS; cinco migrations aplicadas en orden.
- `prisma migrate status` — PASS; cinco migrations y database schema up to date.
- `prisma migrate diff --from-config-datasource --to-schema ... --exit-code` — PASS; sin drift.
- Migration E02-S01 SHA-256 — `59ccadb8795ff39df2c8ad40670e15e1623916a620129b7e087438b06e457ff7`.
- `pnpm test:integration:database` — PASS; 4 archivos, 36 pruebas PostgreSQL existentes sin regresión.
- `pnpm test:integration:auth` — PASS; 1 archivo, 7 pruebas de API/auth contra PostgreSQL 18.4 real.
- `pnpm platform-admin:create` — PASS; admin explícito creado, email normalizado y PHC Argon2id verificado sin imprimir password/hash.
- `docker compose build api` — la imagen fue renovada, aunque el cliente agotó su timeout sin emitir salida final; validación directa posterior ejecutó Argon2id dentro de Alpine sin red — PASS.
- API container — PASS; `whatsapp-platform-dev-api-1` healthy y `GET http://127.0.0.1:3001/health` respondió `{"service":"api","status":"ok"}`.
- Compose DB migration con el volumen histórico local — WARN/P1000 por credenciales antiguas del named volume; no se borró ni modificó el volumen. La migration limpia y la suite auth usaron PostgreSQL temporal aislado.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm format:check` — PASS.
- `git diff --check` — PASS.

## Known issues

- El proveedor CI permanece deliberadamente sin seleccionar hasta que exista un remote o una decisión documental explícita.
- El rate limiter E02-S01 es local a cada proceso; coordinación distribuida queda para una historia operativa futura si la topología escala horizontalmente.
- Los limiters E02-S02 también son locales a proceso y deben distribuirse antes de horizontal scaling.
- `PasswordResetDelivery` no tiene adapter SMTP/provider operativo; la API conserva respuesta genérica y nunca devuelve el token, pero recovery real debe permanecer deshabilitado hasta configurarlo.
- MFA, RLS, publisher/dispatcher Outbox, TimelineEvent y entidades posteriores permanecen fuera de alcance.
