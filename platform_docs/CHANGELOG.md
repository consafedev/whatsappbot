# Changelog

Todos los cambios relevantes del producto y de su documentación normativa se registran aquí.

Formato inspirado en Keep a Changelog. El producto utilizará Semantic Versioning cuando comience la implementación/release.

## [Unreleased]

### Added

- E05-S03 con `OutboundMessage` tenant-owned y migration Prisma `20260819184530_add_outbound_messages_foundation`: idempotencia por tenant, estados operativos, lease/retry/DLQ, índices de cola y FKs restrictivas.
- Manager outbound tenant-safe con revalidación de tenant operativo, entitlement, canal y actor; transiciones persistidas con Outbox, deduplicación por idempotency key y error sanitizado.
- API `POST/GET /api/v1/channels/:channelId/messages` con respuesta `202`, payload cerrado, validación de teléfono/media y lectura de estado least-data; usa el permiso canónico `channels.manage`.
- Dispatcher detrás del `MessagingProvider` SPI y worker de polling PostgreSQL con retry/backoff, timeout, concurrencia 5, rate limit por canal de 5 mensajes/segundo y recuperación de leases; no se añadió BullMQ porque el fallback de polling está permitido y no existe la dependencia en el monorepo.
- Verificación E05-S03: suites dispatcher 3/3, database 4/4, API 3/3 y worker 1/1 contra PostgreSQL/Nest reales; regresión raíz 19 archivos/90 pruebas, migración/status, Biome, typecheck/build Docker y Compose runtime saludables.
- E05-S03 mantiene fuera de alcance providers WhatsApp reales, Contacts, Conversations, UI de envío y adapter BullMQ futuro.
- E05-S02 con normalización inbound pura para payloads genéricos/mock y Meta Cloud API, contexto confiable de tenant/canal, media, receipts, timestamps y fallback `UNKNOWN`; WPPConnect queda en el parser genérico y no se presenta como provider real implementado.
- `InboundMessageEvent` tenant-owned y migration Prisma `20260818110000_inbound_message_event_foundation`, con UUIDv7, JSONB raw/normalized, estados de procesamiento, índices tenant/channel/status, deduplicación por `(tenant_id, channel_account_id, provider_message_id)` y FKs restrictivas alineadas con la autoridad vigente del modelo.
- Manager de ingestión con revalidación de tenant operativo + `module.messaging.basic`, persistencia atómica de evento y Outbox `messaging.inbound.event_received`, deduplicación segura incluso ante carreras `P2002`, sin doble fila ni doble notificación.
- Webhooks públicos `GET/POST /api/v1/webhooks/whatsapp/:channelId` y `POST /api/v1/webhooks/whatsapp/mock/:channelId`, handshake Meta, HMAC raw-body, límite JSON de 256 KB, ACK rápido y resolución de tenant exclusivamente desde `ChannelAccount`; secretos sólo via ciphertext de credenciales.
- Tests E05-S02: normalizer 3/3, database 3/3 y API 4/4 contra PostgreSQL 18.4/Nest reales en Docker; sin Contacts, Conversations, UI ni provider WhatsApp real.
- Reconciliación documental registrada: el backlog histórico aún llama a E05-S02 “Baileys adapter”; esta historia siguió el prompt vigente y el STATUS operativo sin reescribir silenciosamente ese backlog.
- E05-S01 con `@whatsapp-platform/messaging`: `MessagingProvider`/DTOs agnósticos, estados de mensaje, normalización inbound, firma HMAC, health y `MockMessagingProvider` con inspección en memoria y fallos configurables; la factory falla cerrado para providers reales aún no implementados.
- `ChannelAccount` tenant-owned y migration Prisma `20260818090000_messaging_channel_account_foundation`, con phone único por tenant para canales activos, credenciales AES-256-GCM fuera de la proyección pública, configuración y health/lifecycle fields, FK compuesta tenant/OUnit e índices tenant/status.
- Manager tenant-safe para listar, crear, actualizar y archivar canales con `module.messaging.basic`, `limit.channel_accounts`, advisory lock PostgreSQL, validación de OU, Audit + Outbox atómicos y ausencia de secretos en responses, summaries y payloads.
- API `GET/POST/PATCH/DELETE /api/v1/channels` y `POST /api/v1/channels/:channelId/test-connection`, con aliases `/app/channels`, permisos `channels.read`/`channels.manage`, 404 cross-tenant, paginación/filtro de estado, Mock health y errores cerrados para providers no disponibles.
- Suite E05-S01: 7 pruebas unitarias de messaging, 4 database y 5 API de integración contra PostgreSQL 18.4/Nest reales; `MESSAGING_CREDENTIALS_KEY` opcional se trata como no configurada cuando Compose la inyecta vacía y la API bloquea cualquier credencial sin clave válida.

- E04-S01 con `/app` tenant-authenticated, bootstrap tenant-safe, shell reutilizable responsive, navegación centralizada module/permission-aware, Home honesta y logout funcional sin datos demo ni caché persistente.
- E04-S02 con `packages/themes` (`@whatsapp-platform/themes`): schema canónico estricto de branding (version 1, cinco presets + custom, light/dark, colores `#RRGGBB` con contraste ≥ 3.0, logo HTTPS público sin hosts internos), presets de tokens light/dark y resolver fail-soft hacia el default `corporate-blue`.
- `GET /app/theme` y `PATCH /app/theme` con `tenant.settings.manage`, restablecimiento por `{}`, validación fail-closed 400 y logo (incluido null) condicionado al módulo `module.white_label` (403 `ENTITLEMENT_REQUIRED`).
- Repository tenant-scoped que persiste `brandingConfig` y escribe Audit `tenant.theme.updated` + Outbox homónimo en una transacción, sin URL de logo en summaries/payloads y con `requestId` saneado.
- Bootstrap `/app/bootstrap` con `branding` resuelto (tokens display-only, sin `brandingConfig` raw), shell con variables CSS scoped `--tenant-*`, `globals.css` migrado a tokens y CSS de plataforma intacto.
- Editor productivo `/app/settings/theme` con preset, modo claro/oscuro, colores custom con preview y logo (con White label); refresca bootstrap sin reload y el logo usa `referrerPolicy="no-referrer"` fuera del pipeline de optimización de Next.
- Suites dedicadas `pnpm test:integration:theme-engine` (7 database + 9 API) y regresiones auth (12 archivos/75 pruebas), bootstrap (5) y seguridad (9 + 37) contra PostgreSQL 18.4/Nest reales.
- E04-S03 con `createOrganizationUnitManager(...)` tenant-safe en `packages/database`: list/create/update con árbol tenant-consistent, invariante de root estructural inmutable (rename sí), prohibición de ciclos, tope de profundidad `ORGANIZATION_UNIT_MAX_DEPTH = 10` (constante de código documentada) y enforcement del límite efectivo `limit.organization_units`.
- Concurrencia del límite vía advisory lock PostgreSQL por tenant (`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(...))`) dentro de cada transacción, con rechazo `Prisma.Decimal` exacto y `usage { used, limit }` en `list()`.
- Audit/outbox atómicos `organization_unit.created|updated` con summaries mínimos, actor `tenant_user`, rollback verificado si el outbox falla y sin cambio de schema (siete migrations intactas, sin migration 8).
- API `GET/POST/PATCH /app/organization-units` con `tenant.settings.manage`, DTO cerrado, respuestas least-data, 404 cross-tenant sin revelar existencia y errores 409 con códigos `ORGANIZATION_UNIT_ROOT_INVARIANT`/`ORGANIZATION_UNIT_CYCLE`/`ORGANIZATION_UNIT_DEPTH_EXCEEDED`/`ORGANIZATION_UNIT_LIMIT_REACHED`.
- UI productiva `/app/settings/organization-units` con árbol por niveles, creación/edición inline, conflictos en español y refetch tras mutaciones, más navegación secundaria de settings compartida (Apariencia/Organización).
- Suites dedicadas `pnpm test:integration:organization-units` (11 database + 12 API) y regresión completa (database 13/92, auth 13/90, rbac, platform-tenants, detail, provisioning, entitlements, tenant-status, bootstrap, theme-engine e isolation) contra PostgreSQL 18.4/Nest reales.
- Fix de invariantes E04-S03: el tope de profundidad en reparent valida la subárbol completa (`newDepth + subtreeHeight > 10` rechaza, altura en memoria con `visited` defensivo → `ORGANIZATION_UNIT_CYCLE` ante datos corruptos), el límite exacto 9 + 1 = 10 permite el descendiente más profundo en profundidad 10 y la movida rechazada preserva el subárbol sin Audit/Outbox.
- Límite fraccional: el manager compara el próximo conteo exacto (`limit.lt(used + 1)` con `Prisma.Decimal`, sin `Number`), rechazando `limit = 3.5` con `used = 3` → `ORGANIZATION_UNIT_LIMIT_REACHED`; la semántica efectiva reutiliza `tenantEntitlementEffective(...)` (helper hoja tenant-safe, sin ciclo de imports).
- Fix verificado con `pnpm test:integration:organization-units` (14 database + 15 API) y regresiones database (13 archivos/95), auth (13/93), isolation (9+37), bootstrap (6), theme-engine (7+11), entitlements (3+5), tenant-status (3+4) y rbac (11+11); sin cambio de schema (siete migrations, cero drift) y sin migration 8.
- E04-S04 con gestión de usuarios tenant-scoped: alta con email normalizado y contraseña Argon2id, activación/desactivación lógica, revocación transaccional de sesiones/tokens, límite exacto de asientos activos y protección del último Owner tenant-wide.
- API de usuarios y roles con asignaciones completas atómicas, validación cross-tenant de roles/OUs, opciones tenant-owned, catálogo canónico de 29 permisos, Owner read-only, preservación de `scopeConstraints` y Audit + Outbox atómicos; sin cambio de schema y con siete migrations intactas.
- UI real `/app/users` con navegación no vacía, permisos efectivos separados para usuarios/roles, alta, estado, asignaciones, roles integrados agrupados por catálogo y confirmación explícita para ampliaciones.
- E04-S04 verificado con 23 pruebas database y 12 API de user management, regresiones de Organization Units y tenant detail, Vitest raíz 16 archivos/76 pruebas, Biome, TypeScript y build Docker con `/app/users`.

- Agent Skill canónica en `.agents/skills/whatsapp-platform-engineering/SKILL.md`.
- `AGENTS.md` raíz con instrucciones breves para cualquier agente.
- Adaptador Antigravity en `.agents/agents.md`.
- Repository foundation de Epic 00 con monorepo pnpm para `apps/`, `services/` y `packages/`.
- Next.js web bootstrap, NestJS API con `GET /health`, workers arrancables y boundaries vacíos de epics futuros.
- Tooling compartido de TypeScript strict, Biome, Vitest, build y lockfile reproducible.
- `packages/config` con configuración tipada, validación, overrides, separación secret/non-secret y pruebas.
- Docker development baseline con PostgreSQL, Redis, API, web y workers.
- `.env.example`, ignores y Dockerfile de desarrollo sin secretos reales.
- E01-S01 con Prisma ORM 7.9.1 dentro de `packages/database`, Prisma Client generado y adapter PostgreSQL oficial.
- Migration inicial versionada para `PlatformDeployment`, `Tenant`, `TenantEntitlement`, `PlatformFeatureFlag` y `OrganizationUnit`.
- Scripts reproducibles de Prisma y suite de integración con nueve pruebas contra PostgreSQL real.
- ADR-0011 formaliza Prisma como ORM dentro del boundary de database.
- E01-S02 con defaults PostgreSQL `uuidv7()` para las cuatro PK UUID surrogate existentes y valor inicial de `updated_at`.
- Segunda migration append-only y pruebas de integración UUIDv7/timestamps contra PostgreSQL 18.4.
- ADR-0012 formaliza UUIDv7, `TIMESTAMPTZ(3)`, UTC y PostgreSQL 18 como baseline mínima.
- E01-S03 con `TenantContext` UUIDv7 explícito y repositories tenant-scoped para `TenantEntitlement` y `OrganizationUnit`.
- Suite de aislamiento con dos tenants, lecturas/updates cross-tenant, inyección de tenant, FK jerárquica y `TransactionClient` reales.
- E01-S04 con `DomainEventOutbox`, writer tenant-safe append-only y `withTenantTransaction` sobre el mismo `TransactionClient`.
- Tercera migration append-only y pruebas PostgreSQL de commit/rollback atómico, defaults UUIDv7, campos físicos y payload JSONB.
- ADR-0013 formaliza Transactional Outbox, persist-before-publish y side effects externos sólo después del commit.
- E01-S05 con `AuditLog`, writer tenant append-only y writer platform disponible sólo desde el subpath privilegiado.
- Cuarta migration append-only y pruebas PostgreSQL de tenant/platform audit, FK tenant-aware de OrganizationUnit y atomicidad domain + audit + Outbox.
- ADR-0014 separa AuditLog de Timeline y formaliza summaries sanitizados, tenant injection y el boundary platform.
- E02-S01 con identidad `PlatformAdmin` separada, passwords Argon2id, bootstrap explícito y sesiones opacas revocables almacenadas server-side.
- Quinta migration append-only para `platform_admin` y `platform_admin_session`, con UUIDv7, timestamps UTC, token hash `BYTEA` unique y FK restrictiva.
- Endpoints Platform Admin login/me/logout, cookie protegida por entorno, validación Origin/CORS, rate limiting y audit transaccional platform.
- ADR-0015 formaliza hashing, cookie, expiración absoluta/idle, revocación, bootstrap y límites de la historia.
- E02-S02 con `User`, `UserSession` y `UserPasswordResetToken` tenant-owned, separados físicamente de Platform Admin.
- Sexta migration append-only con email unique por tenant, FKs compuestas tenant/user, hashes `BYTEA` y timestamps UTC.
- Login tenant por slug pre-auth, `/auth/me`, logout idempotente, revoke-all propio y password reset single-use de 15 minutos.
- `PasswordResetDelivery` limita el raw reset token a un port explícito; delivery operativo permanece pendiente sin exponer tokens por HTTP/log.
- ADR-0016 formaliza identidad tenant, sesiones opacas, pre-auth por slug y recuperación de contraseña.
- E02-S03 conecta la sesión Tenant User autenticada con el `TenantContext` canónico mediante guards ordenados de Nest, request/decorators tipados y contexto inmutable.
- `TenantDataAccessFactory` conecta explícitamente el contexto autenticado con `createTenantDataAccess(...)` sobre el cliente singleton, sin Prisma request-scoped ni contexto ambiental.
- Suite vertical API/PostgreSQL para contextos A/B, fuentes de tenant hostiles, sesiones inválidas, acceso tenant-scoped real y requests concurrentes.
- E02-S04 con suite de seguridad dedicada `pnpm test:security:tenant-isolation`: matriz A/B de repositories, auth/context, IDs/FKs hostiles, atomicidad, concurrencia y boundary de imports privilegiados.
- Cobertura ejecutable para todas las superficies tenant-owned actuales; los modelos/endpoints posteriores quedan explícitamente diferidos hasta existir.
- E02-S05 con modelos `Role`, `Permission`, `UserRole` y `RolePermission`, FKs tenant-aware, catálogo canónico de 29 permisos y sync explícito idempotente.
- Resolver tenant-wide fail-closed, `@RequirePermissions`, `TenantPermissionGuard` y suite PostgreSQL/Nest para escalación, OU/constraints, ALL, 401/403 y revocación inmediata.
- ADR-0017 formaliza autorización granular por permission keys, templates globales no asignables y ausencia de snapshots/caché de permisos.
- E03-S01 con `GET /platform/tenants`, protegido sólo por sesión Platform Admin, query cross-tenant privilegiada y proyección administrativa least-data.
- Tenant list productiva en Next.js con búsqueda, filtro de estado, paginación, tabla responsive y estados loading/empty/error/loaded.
- Suite PostgreSQL/API/frontend para deployments, módulos efectivos, users reales, actividad observada, auth Platform y `channelCount = null` hasta existir `ChannelAccount`.
- E03-S02 con `POST /platform/tenants`, servicio de aplicación y repository privilegiado para provisionar Tenant, Owner, seis roles, grants Owner, root OU, entitlements, limits, Audit y Outbox en una transacción.
- Wizard productivo `/platform/tenants/new` con empresa, capacidades, Owner, revisión, errores seguros y retorno al listado con confirmación.
- Catálogo cerrado de 14 module entitlement keys y suites PostgreSQL/Nest/frontend que cubren commit, rollback real, login inmediato, RBAC, aislamiento, auth Platform y validación fail-closed.
- E03-S03 con endpoints Platform Admin read-only para detalle, users y audit del tenant, protegidos exclusivamente por sesión Platform y consultas privilegiadas fuera del facade tenant-safe.
- Detalle least-data con General, unidad raíz, 14 módulos efectivos, cinco limits Decimal, uso real/parcial, deployment seguro y estados explícitos no disponibles para canales y backup.
- Pantalla productiva `/platform/tenants/[tenantId]` con ocho tabs, enlace desde el listado, carga diferida/paginada de Users/Audit y estados loading/empty/401/404/error sin fixtures ni mutaciones futuras.
- Suites PostgreSQL 18.4/Nest para aislamiento A/B, auth Platform, temporalidad, Decimal, paginación y ausencia de hashes, JSON privado, metadata deployment o payload sensible de Audit.
- E03-S05 con transiciones Platform-only `active ↔ suspended`, writer privilegiado idempotente/concurrente, `suspendedAt`, Audit/Outbox transaccionales y respuesta administrativa mínima.
- Assertion reusable de tenant operacional para futuros workers/jobs, bloqueo PostgreSQL por request de sesión Tenant, sin revocar sesiones ni modificar entitlements, RBAC o datos al suspender.
- Controles de suspend/reactivate en Tenant Detail con confirmación, estados de error y refetch; suite PostgreSQL/Nest para sesión, login/reset, A/B, idempotencia, Platform Control y rollback.
- E03-S04 con catálogo canónico cerrado de 14 módulos/cinco limits, resolver tenant-safe read-only, assertion reusable, `@RequireEntitlements` y guard PostgreSQL por request con error 403 estable.
- Mutations Platform-only para modules, limits y config opaca, con validación cerrada, Decimal exacto, disable no destructivo y upsert + Audit + Outbox atómicos.
- Controles productivos en la tab Módulos y suite vertical PostgreSQL/Nest para vigencia, misma sesión, RBAC + entitlement, aislamiento, concurrencia y rollback.

### Changed

- El contrato de ingeniería dejó de vivir en `platform_docs/SKILL.md`; todas las referencias explícitas apuntan a la única copia canónica.
- El estado operativo y los comandos de inicio ahora reflejan la implementación real de Epic 00.
- Epic 00 queda validado de extremo a extremo en Docker Desktop/WSL2 con los seis servicios saludables y endpoints API/web accesibles desde el host.
- El datastore principal requiere PostgreSQL 18 o superior mientras se utilice `uuidv7()` nativo.
- El entrypoint raíz de `packages/database` expone sólo acceso tenant-aware; Prisma raw queda en el subpath privilegiado `@whatsapp-platform/database/platform`.
- El facade tenant-aware expone Outbox sólo para append; lectura/publicación permanece infraestructura privilegiada futura.
- Epic 01 — Database Foundation queda PASS / COMPLETE con las historias E01-S01 a E01-S05 verificadas.
- E02-S01 — Platform Admin auth queda PASS; Epic 02 permanece IN PROGRESS y no incluye Tenant User auth ni RBAC.
- E02-S02 — Tenant user auth queda PASS; Epic 02 permanece IN PROGRESS y E02-S03 sigue pendiente.
- E02-S03 — Tenant context middleware queda PASS; Epic 02 permanece IN PROGRESS y E02-S04 es la siguiente historia.
- E02-S04 — Tenant isolation tests queda PASS; Epic 02 permanece IN PROGRESS y E02-S05 es la siguiente historia.
- E02-S05 — RBAC base queda PASS; Epic 02 — Authentication and Tenancy queda PASS / COMPLETE.
- E03-S01 — Tenant list queda PASS; Epic 03 — Super Admin permanece IN PROGRESS.
- E03-S02 — Create tenant queda PASS; Epic 03 — Super Admin permanece IN PROGRESS.
- E03-S03 — Tenant detail queda PASS; Epic 03 — Super Admin permanece IN PROGRESS y E03-S04 es la siguiente historia.
- E03-S04 — Module activation queda PASS; Epic 03 — Super Admin permanece IN PROGRESS y E03-S05 es la siguiente historia.
- E03-S05 — Suspend/reactivate tenant queda PASS; Epic 03 — Super Admin queda PASS / COMPLETE y E04-S01 es la siguiente historia.
- E04-S01 — App shell queda PASS; Epic 04 — Tenant Dashboard Shell permanece IN PROGRESS y E04-S02 es la siguiente historia.
- E04-S02 — Theme Engine minimal queda PASS; Epic 04 — Tenant Dashboard Shell permanece IN PROGRESS y E04-S03 es la siguiente historia.

### Fixed

- E04-S02 (fix) — `/app/bootstrap` oculta `branding.logo` cuando `module.white_label` no está efectivo (desactivado, schedule o expirado), preserva el `brandingConfig` guardado y `GET /app/theme`, y restaura el logo al reactivar el módulo sin relogin ni re-upload; sin cambio de schema.
- Compose construye una sola vez la imagen compartida de aplicación y evita la colisión concurrente `image ... already exists`.
- El usuario runtime `node` reutiliza la caché preparada de Corepack/pnpm sin intentar descargas desde redes internas.
- `app-network` permite los bindings localhost de API/web mientras `data-network` conserva el aislamiento de PostgreSQL y Redis.

### Decided

- pnpm workspaces es el único package manager.
- Node.js 24 LTS, pnpm 11, Next.js 16, NestJS 11 y TypeScript 6 forman la baseline compatible de Foundation.
- El workflow CI se pospone hasta contar con evidencia del proveedor mediante remote o decisión documental.
- `tenant.slug` es globalmente único en la baseline y cada tenant tiene como máximo una fila efectiva por `entitlement_key`; vigencias complejas se posponen hasta existir un requisito real.
- Las PK internas surrogate usan UUIDv7 con tipo físico PostgreSQL UUID y generación default nativa mediante `uuidv7()`; claves naturales deliberadas como `PlatformFeatureFlag.key` se conservan.
- Los instantes persistentes usan `TIMESTAMPTZ(3)` con semántica UTC; Prisma mantiene `updated_at` y raw SQL debe mantenerlo explícitamente.

### Not yet implemented

- Module activation, suspend/reactivate, matriz de grants para roles distintos de Owner, MFA, delivery real de password reset, providers WhatsApp, contactos/conversaciones, Rules Engine, agenda, cotizaciones, documentos, IA funcional y backups reales.

## [0.0.0-preimplementation] - 2026-08-12

### Added

- PRD maestro, modelo de datos/ERD/backlog, System Design, estrategia de seguridad/pruebas/deployment, runbooks, roadmap, material de demo/venta y ADRs base.
- Baseline visual aprobada en `design-prototype/`.

### Decided

- Un repositorio y cero forks permanentes por tenant.
- SaaS shared, dedicated y customer-hosted sobre la misma base.
- PostgreSQL como fuente de verdad; Redis/BullMQ para ejecución.
- Mensajería por providers abstraídos, rules-first e IA opcional.

[Unreleased]: #
[0.0.0-preimplementation]: #
