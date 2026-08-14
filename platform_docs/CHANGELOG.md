# Changelog

Todos los cambios relevantes del producto y de su documentación normativa se registran aquí.

Formato inspirado en Keep a Changelog. El producto utilizará Semantic Versioning cuando comience la implementación/release.

## [Unreleased]

### Added

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

### Fixed

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
