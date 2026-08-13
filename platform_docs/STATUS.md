# STATUS.md — Estado operativo actual del proyecto

**Actualizado:** 2026-08-12  
**Versión de producto:** `0.0.0`  
**Estado:** E01-S02 — PASS; **Epic 01 — IN PROGRESS**.

## Current milestone

Database Foundation.

## Current epic

**Epic 01 — Database Foundation**

Estado por historia:

- E01-S01 — Prisma/schema baseline: **PASS**.
- E01-S02 — ID/timestamp conventions: **PASS**.
- E01-S03 — Tenant-aware repository utilities: no iniciada.
- E01-S04 — Outbox foundation: no iniciada.
- E01-S05 — Audit foundation: no iniciada.

## Completed

- Epic 00 — Repository Foundation: **PASS / COMPLETE**.
- E01-S01 — Prisma/schema baseline: **PASS**.
- E01-S02 — ID/timestamp conventions: **PASS**, documentada por ADR-0012.
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

Epic 01 permanece en progreso. No se inició E01-S03.

## Blocked

Ningún bloqueo para E01-S02.

## Next story

`E01-S03 — Tenant-aware repository utilities`

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

## Known issues

- El proveedor CI permanece deliberadamente sin seleccionar hasta que exista un remote o una decisión documental explícita.
- Tenant-aware repositories, RLS, Outbox, AuditLog y todas las entidades de epics posteriores permanecen fuera de alcance.
