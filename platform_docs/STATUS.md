# STATUS.md — Estado operativo actual del proyecto

**Actualizado:** 2026-08-12  
**Versión de producto:** `0.0.0`  
**Estado:** **Epic 00 — PASS / COMPLETE**.

## Current milestone

Repository Foundation.

## Current epic

**Epic 00 — Repository Foundation**

Estado por historia:

- E00-S01 — Monorepo bootstrap: completada.
- E00-S02 — Code quality gates: completada localmente; workflow CI pendiente de identificar proveedor.
- E00-S03 — Docker Compose development: **PASS**; build, arranque, health checks, endpoints y limpieza validados en Docker Desktop/WSL2.
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
- Imagen de aplicación construida una sola vez y reutilizada por API, web y workers, sin colisiones concurrentes de tags.
- Corepack/pnpm disponible para el usuario runtime `node` sin requerir acceso a red.
- Red `app-network` accesible desde el host para API/web; `data-network` permanece interna.
- Runtime Docker validado con los seis servicios `healthy`, API real en `127.0.0.1:3001/health` y web en `127.0.0.1:3000`.
- `.env.example`, `.gitignore`, `.dockerignore` y `Dockerfile.dev` sin secretos reales.
- Documentación operativa actualizada sin modificar `design-prototype/`.

## In progress

Ninguna historia adicional. No se inició Epic 01.

## Blocked

Ningún bloqueo para Epic 00.

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

## Known issues

- El proveedor CI permanece deliberadamente sin seleccionar hasta que exista un remote o una decisión documental explícita.
- Epic 01 y todo schema funcional siguen fuera de alcance y no están implementados.
