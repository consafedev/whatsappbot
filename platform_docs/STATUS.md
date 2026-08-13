# STATUS.md — Estado operativo actual del proyecto

**Actualizado:** 2026-08-13
**Versión de producto:** `0.0.0`  
**Estado:** E02-S01 — PASS; **Epic 02 — IN PROGRESS**.

## Current milestone

Authentication and Tenancy.

## Current epic

**Epic 02 — Authentication and Tenancy**

Estado por historia:

- E02-S01 — Platform Admin auth: **PASS**, documentada por ADR-0015.
- E02-S02 — Tenant user auth: **NOT STARTED**.
- E02-S03 — Tenant context middleware: **NOT STARTED**.
- E02-S04 — Tenant isolation tests: **NOT STARTED**.
- E02-S05 — RBAC base: **NOT STARTED**.

Epic anterior:

- E01-S01 — Prisma/schema baseline: **PASS**.
- E01-S02 — ID/timestamp conventions: **PASS**.
- E01-S03 — Tenant-aware repository utilities: **PASS**.
- E01-S04 — Outbox foundation: **PASS**.
- E01-S05 — Audit foundation: **PASS**.

## Completed

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

Ninguna historia de Epic 01 permanece en progreso.

## Blocked

Ningún bloqueo para E01-S05.

## Next story

`E02-S01 — Platform Admin auth`

No implementarla sin una instrucción separada.

## Last verified commands

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
- Tenant User auth, tenant context middleware, RBAC, MFA, password reset, gestión de sesiones, RLS, publisher/dispatcher Outbox, TimelineEvent y entidades posteriores permanecen fuera de alcance.
