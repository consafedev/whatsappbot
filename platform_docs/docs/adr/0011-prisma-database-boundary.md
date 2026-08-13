# ADR-0011 — Prisma como ORM dentro del boundary de database

**Status:** Accepted
**Date:** 2026-08-12

## Context

Epic 01 requiere migrations versionadas y acceso tipado a PostgreSQL. El PRD identificaba Prisma como candidato inicial, pero reservaba la elección definitiva del ORM. La plataforma ya usa Node.js 24, TypeScript y pnpm workspaces, y dispone de `packages/database` como boundary sin implementación.

## Decision

Adoptar Prisma ORM 7 dentro de `packages/database` como único boundary inicial de acceso Prisma. Usar Prisma Migrate con PostgreSQL, el generador `prisma-client` con output explícito y el adapter oficial `@prisma/adapter-pg`. Las aplicaciones no instancian Prisma directamente.

La estrategia global de generación de IDs no se decide aquí. E01-S01 fija columnas PostgreSQL UUID sin default; E01-S02 decidirá UUID v7 vs ULID sin requerir cambio destructivo del tipo físico.

## Alternatives considered

- SQL/driver `pg` directo: viable, pero requeriría construir manualmente migrations y tipado que Prisma ya proporciona.
- Otro ORM: no existe evidencia de una ventaja concreta que justifique desviarse del candidato documental en esta baseline.
- Acoplar Prisma a `apps/api`: rechazado porque rompería el boundary compartido definido para persistencia.

## Consequences

- `packages/database` posee schema, migrations, Prisma Client y lifecycle de conexión.
- Prisma CLI y Client quedan fijados a la misma versión y el lockfile conserva instalaciones reproducibles.
- Cambiar de ORM después de aplicar migrations requerirá un ADR de reemplazo y un plan de compatibilidad.
- Los repositories tenant-aware, RLS, Outbox y AuditLog permanecen fuera de E01-S01.

## Migration/rollback

La migration inicial crea únicamente las tablas baseline de plataforma y tenancy. Antes de producción, rollback consiste en retirar esta baseline en una base todavía desechable; una vez compartida, las migrations serán append-only.

## Affected documents

`DATA_MODEL_ERD_MVP_BACKLOG.md`, `SYSTEM_DESIGN.md`, `STATUS.md`, `CHANGELOG.md`.
