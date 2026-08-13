# STATUS.md — Estado operativo actual del proyecto

**Actualizado:** 2026-08-12  
**Versión de producto:** `0.0.0`  
**Estado:** Epic 00 implementado; validación runtime de Docker pendiente por engine local no disponible.

## Current milestone

Repository Foundation.

## Current epic

**Epic 00 — Repository Foundation**

Estado por historia:

- E00-S01 — Monorepo bootstrap: completada.
- E00-S02 — Code quality gates: completada localmente; workflow CI pendiente de identificar proveedor.
- E00-S03 — Docker Compose development: implementación y validación estática completadas; arranque/health runtime pendiente.
- E00-S04 — Configuration package: completada con pruebas.

## Completed

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
- `.env.example`, `.gitignore`, `.dockerignore` y `Dockerfile.dev` sin secretos reales.
- Documentación operativa actualizada sin modificar `design-prototype/`.

## In progress

Ninguna historia adicional. No se inició Epic 01.

## Blocked

- `docker compose up --build -d` y la comprobación de health runtime no se ejecutaron: Docker Desktop se inició, pero el engine Linux no respondió; `docker info`/`docker version` agotaron su timeout.
- No se creó workflow CI: Git se inicializó localmente, pero no existe ningún remote ni otra evidencia para elegir GitHub Actions u otro proveedor. Los comandos de CI están disponibles en la raíz.

## Next story

`E01-S01 — Prisma/schema baseline`

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
- `docker info --format '{{json .ServerVersion}}'` — BLOCKED; engine Linux de Docker Desktop no disponible.
- `docker version --format '{{json .Server.Version}}'` — BLOCKED; timeout del engine.

## Known issues

- El comportamiento de los contenedores y sus health checks todavía requiere una ejecución con un engine Docker funcional.
- El proveedor CI permanece deliberadamente sin seleccionar hasta que exista un remote o una decisión documental explícita.
- Epic 01 y todo schema funcional siguen fuera de alcance y no están implementados.
