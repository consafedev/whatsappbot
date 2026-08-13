# WhatsApp Automation Platform

Multi-tenant B2B WhatsApp automation platform. The repository currently contains only **Epic 00 — Repository Foundation**; product domains begin in later epics.

`design-prototype/` is an approved visual reference. It is not production architecture and is not used as application source code.

## Requirements

- Node.js 24 LTS (`>=24 <25`; locally verified with `v24.13.0`).
- pnpm 11 (`pnpm@11.21.0` is pinned in `package.json`).
- Docker Desktop with a running Linux engine for the Compose development stack.

## Install

```powershell
pnpm install
```

The committed `pnpm-lock.yaml` is the reproducible dependency source. Do not add another package manager or lockfile.

## Quality gates

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

To apply formatting:

```powershell
pnpm format
```

## Development

Start the minimal Next.js bootstrap page:

```powershell
pnpm --filter @whatsapp-platform/web dev
```

The API and workers validate `DATABASE_URL` and `REDIS_URL` when they boot. Build first, provide a local environment, and start an individual process with its workspace script:

```powershell
pnpm build
pnpm --filter @whatsapp-platform/api start
pnpm --filter @whatsapp-platform/worker-jobs start
pnpm --filter @whatsapp-platform/worker-whatsapp start
```

The API exposes the superficial bootstrap check at `GET /health`.

## Docker Compose

Create a local `.env` from `.env.example`, replace every placeholder, and keep `.env` out of Git.

```powershell
Copy-Item .env.example .env
docker compose config
docker compose up --build -d
docker compose ps
docker compose down
```

The development stack contains `postgres`, `redis`, `api`, `web`, `worker-jobs`, and `worker-whatsapp`. PostgreSQL and Redis bind to localhost only. Application and data services use internal Docker networks.

## Repository map

```text
apps/           Executable application boundaries
services/       Independently separable service boundaries
packages/       Shared package boundaries and typed configuration
platform_docs/  Normative product and engineering documentation
design-prototype/  Approved visual reference only
```

Start significant work by reading [AGENTS.md](AGENTS.md), the canonical project skill at [.agents/skills/whatsapp-platform-engineering/SKILL.md](.agents/skills/whatsapp-platform-engineering/SKILL.md), the documentation map at [platform_docs/docs/INDEX.md](platform_docs/docs/INDEX.md), and the current state at [platform_docs/STATUS.md](platform_docs/STATUS.md).
