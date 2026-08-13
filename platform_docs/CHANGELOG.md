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

### Changed

- El contrato de ingeniería dejó de vivir en `platform_docs/SKILL.md`; todas las referencias explícitas apuntan a la única copia canónica.
- El estado operativo y los comandos de inicio ahora reflejan la implementación real de Epic 00.
- Epic 00 queda validado de extremo a extremo en Docker Desktop/WSL2 con los seis servicios saludables y endpoints API/web accesibles desde el host.
- El datastore principal requiere PostgreSQL 18 o superior mientras se utilice `uuidv7()` nativo.
- El entrypoint raíz de `packages/database` expone sólo acceso tenant-aware; Prisma raw queda en el subpath privilegiado `@whatsapp-platform/database/platform`.
- El facade tenant-aware expone Outbox sólo para append; lectura/publicación permanece infraestructura privilegiada futura.
- Epic 01 — Database Foundation queda PASS / COMPLETE con las historias E01-S01 a E01-S05 verificadas.

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

- Auth, Super Admin, providers WhatsApp, contactos/conversaciones, Rules Engine, agenda, cotizaciones, documentos, IA funcional y backups reales.

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
