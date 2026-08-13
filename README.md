# WhatsApp Automation Platform

Multi-tenant B2B WhatsApp automation platform. **Epic 00 — Repository Foundation** is complete, and database work starts in Epic 01.

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

Prisma Client is generated during the database package build. It can also be generated explicitly after install:

```powershell
pnpm db:generate
```

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

## Database

Prisma schema and migrations live exclusively in `packages/database`. Configure `DATABASE_URL` through the existing environment configuration, then use:

```powershell
pnpm db:validate
pnpm db:generate
pnpm db:migrate:dev -- --name <migration-name>
pnpm db:migrate:deploy
pnpm test:integration:database
```

Database integration tests require a disposable PostgreSQL database with the committed migrations already applied. Do not use `prisma db push` as a replacement for migrations.

Tenant-owned access uses the safe root entrypoint: create a validated `TenantContext`, then call `createTenantDataAccess(context, client)` to obtain scoped repositories and the write-only `outbox.append(...)` API. Use `withTenantTransaction(context, client, callback)` when a domain write and its Outbox event must commit or roll back together; the callback receives the tenant-scoped facade, never raw Prisma. The raw Prisma client is intentionally available only through the privileged `@whatsapp-platform/database/platform` subpath for authorized platform code, migrations, and infrastructure tests.

## Repository map

```text
apps/           Executable application boundaries
services/       Independently separable service boundaries
packages/       Shared package boundaries and typed configuration
platform_docs/  Normative product and engineering documentation
design-prototype/  Approved visual reference only
```

Start significant work by reading [AGENTS.md](AGENTS.md), the canonical project skill at [.agents/skills/whatsapp-platform-engineering/SKILL.md](.agents/skills/whatsapp-platform-engineering/SKILL.md), the documentation map at [platform_docs/docs/INDEX.md](platform_docs/docs/INDEX.md), and the current state at [platform_docs/STATUS.md](platform_docs/STATUS.md).
