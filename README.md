# WhatsApp Automation Platform

Multi-tenant B2B WhatsApp automation platform. Epics 00, 01, and 02 are complete; Epic 03 is in progress with Platform tenant listing and atomic tenant provisioning available.

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

The API exposes the superficial bootstrap check at `GET /health`. An authenticated Platform Admin can query the paginated inventory with `GET /platform/tenants` and atomically provision a tenant with `POST /platform/tenants`. The productive web routes are `/platform/tenants` and `/platform/tenants/new`; both use `NEXT_PUBLIC_API_BASE_URL` from the environment.

`pnpm rbac:sync-permissions` is a deployment prerequisite before tenant provisioning. It synchronizes the 29 canonical permission rows; the create endpoint fails closed if that catalog is incomplete.

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
pnpm test:integration:rbac
pnpm test:integration:platform-tenants
pnpm test:integration:tenant-provisioning
pnpm test:security:tenant-isolation
```

Database integration tests require a disposable PostgreSQL database with the committed migrations already applied. Do not use `prisma db push` as a replacement for migrations.

The dedicated tenant-isolation security suite exercises the current tenant-owned database and authenticated API surfaces against PostgreSQL. Add each future tenant-owned repository or endpoint to this matrix when it is implemented.

After applying migrations, synchronize the code-versioned global permission catalog explicitly. The command is idempotent, updates canonical descriptions, preserves unknown rows for diagnosis, and never creates tenant roles or assignments:

```powershell
pnpm rbac:sync-permissions
```

Tenant authorization uses `PermissionKey` grants, not role names. Global role templates, OU-scoped assignments, and constrained grants do not authorize generic tenant-wide endpoints. Default role provisioning and its permission matrix remain deferred to E03-S02.

Tenant-owned access uses the safe root entrypoint: create a validated `TenantContext`, then call `createTenantDataAccess(context, client)` to obtain scoped repositories plus the append-only `audit.append(...)` and `outbox.append(...)` APIs. Use `withTenantTransaction(context, client, callback)` when domain, audit, and Outbox writes must commit or roll back together; the callback receives the tenant-scoped facade, never raw Prisma. Audit summaries and IP metadata must be explicit, minimal, and already sanitized by the caller.

The raw Prisma client and `createPlatformAuditWriter(...)` are intentionally available only through the privileged `@whatsapp-platform/database/platform` subpath for authorized platform/control-plane code, migrations, and infrastructure tests. Platform audit can use a nullable tenant; tenant code cannot.

## Platform Admin bootstrap

There is no self-registration and API startup never creates an administrator. To create one explicitly, set `DATABASE_URL` plus the `PLATFORM_ADMIN_BOOTSTRAP_*` variables documented in `.env.example`, then run:

```powershell
pnpm build
pnpm platform-admin:create
```

The password is read from `PLATFORM_ADMIN_BOOTSTRAP_PASSWORD`, must contain 15–128 Unicode characters, and is never printed. Remove the bootstrap variables from the process environment after use. Duplicate normalized emails fail without replacing the existing password.

## Tenant authentication

Tenant login resolves the workspace from the route slug and never accepts `tenantId` in the body:

```text
POST /auth/tenants/:tenantSlug/login
GET  /auth/me
POST /auth/logout
POST /auth/sessions/revoke-all
POST /auth/tenants/:tenantSlug/password-reset/request
POST /auth/tenants/:tenantSlug/password-reset/confirm
```

Set `TENANT_WEB_ORIGIN` to the trusted web origin used for CORS, Origin checks and reset links. Password reset delivery is intentionally a port in E02-S02; no SMTP/provider adapter exists yet, so recovery must not be enabled for real users until an operational delivery adapter is configured. Tokens are never returned by the API or logged.

## Repository map

```text
apps/           Executable application boundaries
services/       Independently separable service boundaries
packages/       Shared package boundaries and typed configuration
platform_docs/  Normative product and engineering documentation
design-prototype/  Approved visual reference only
```

Start significant work by reading [AGENTS.md](AGENTS.md), the canonical project skill at [.agents/skills/whatsapp-platform-engineering/SKILL.md](.agents/skills/whatsapp-platform-engineering/SKILL.md), the documentation map at [platform_docs/docs/INDEX.md](platform_docs/docs/INDEX.md), and the current state at [platform_docs/STATUS.md](platform_docs/STATUS.md).
