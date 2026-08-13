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

### Changed

- El contrato de ingeniería dejó de vivir en `platform_docs/SKILL.md`; todas las referencias explícitas apuntan a la única copia canónica.
- El estado operativo y los comandos de inicio ahora reflejan la implementación real de Epic 00.

### Decided

- pnpm workspaces es el único package manager.
- Node.js 24 LTS, pnpm 11, Next.js 16, NestJS 11 y TypeScript 6 forman la baseline compatible de Foundation.
- El workflow CI se pospone hasta contar con evidencia del proveedor mediante remote o decisión documental.

### Not yet implemented

- Epic 01 y todo schema funcional de base de datos.
- Tenancy, auth, Super Admin, providers WhatsApp, inbox, Rules Engine, agenda, cotizaciones, AI Gateway funcional y backups reales.
- Verificación runtime de Docker, bloqueada por el engine local no disponible durante esta ejecución.

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
