# ADR-0031 — E08-S01 Rules Engine Foundation, Data Model & Catalog Management API Scope

- Status: Accepted
- Date: 2026-08-25
- Owners: Platform Engineering

## Context

La historia `E08-S01` inicia la Epic 08 (Rules Engine & Deterministic Automation) en la plataforma multi-inquilino. Conforme a las decisiones fundacionales de arquitectura (ADR-0006: Own Rules Engine, No n8n in Core, y ADR-0009: Rules First, AI Optional), la plataforma requiere un motor de reglas interno y determinista con almacenamiento persistente en PostgreSQL, validación exhaustiva de esquemas JSON, observabilidad atómica por inquilino (`AuditLog` y `DomainEventOutbox`) y gestión integral mediante un catálogo API REST tipado.

## Decision

1. **Modelo de Datos y Migración Prisma**:
   - Se añadió el modelo `Rule` en `packages/database/prisma/schema.prisma` y la migración SQL `20260825120000_add_rules_engine_foundation`.
   - Campos: `id` (UUIDv7), `tenantId` (UUID), `name` (VARCHAR 160), `description` (TEXT opcional), `triggerType` (VARCHAR 60), `priority` (INT, default 100), `status` (VARCHAR 20, default `draft`), `executionMode` (VARCHAR 30, default `first_match_stop`), `conditions` (JSONB, default `[]`), `actions` (JSONB, default `[]`), `cooldownSeconds` (INT, default 0), `channelAccountId` (UUID opcional), `organizationUnitId` (UUID opcional), `createdAt`, `updatedAt`.
   - Índices y llaves foráneas:
     - `@@unique([tenantId, id])`
     - `@@index([tenantId, status, triggerType, priority])`
     - `@@index([tenantId, channelAccountId])`
     - Relaciones compuestas `[tenantId, channelAccountId] -> ChannelAccount[tenantId, id]` y `[tenantId, organizationUnitId] -> OrganizationUnit[tenantId, id]`.

2. **Administrador de Catálogo (`RuleCatalogManager`)**:
   - Implementado en `packages/database/src/rule-catalog-manager.ts`.
   - Métodos expuestos: `createRule`, `updateRule`, `getRuleById`, `listRules`, `deleteRule`.
   - Validador estructurado para condiciones JSON (`field`, `operator`, `value`) y acciones JSON (`actionType`, `parameters`).
   - Verificación de estado operativo del tenant (`assertTenantOperational`) y de habilitación del módulo de automatización (`module.automation.basic`).
   - Emisión atómica y transaccional de auditoría (`AuditLog`) y eventos de dominio (`DomainEventOutbox` con tipos `rule.created`, `rule.updated`, `rule.deleted`).

3. **Controlador y Servicio API REST (`apps/api/src/rules.ts`)**:
   - `RulesController` bajo la ruta `/api/v1/rules`.
   - Métodos:
     - `POST /api/v1/rules`: Creación de regla (requiere permiso `rules.manage`).
     - `GET /api/v1/rules`: Listado filtrado por inquilino con ordenamiento `priority ASC, createdAt DESC, id DESC` (requiere `rules.read`).
     - `GET /api/v1/rules/:ruleId`: Detalle con 404 estricto ante accesos cruzados (requiere `rules.read`).
     - `PUT /api/v1/rules/:ruleId`: Actualización de regla (requiere `rules.manage`).
     - `DELETE /api/v1/rules/:ruleId`: Eliminación de regla (requiere `rules.manage`).
   - Cadena de guardias aplicada en orden determinista: `TenantUserSessionGuard` -> `TenantContextGuard` -> `TenantPermissionGuard` -> `TenantEntitlementGuard`.
   - Entitlement requerido a nivel controlador: `module.automation.basic`.

4. **Aislamiento Multi-inquilino**:
   - Aislamiento estricto verificado tanto a nivel de consultas SQL parametrizadas por `tenantId` como en las rutas REST (Tenant B recibe 404 Not Found ante cualquier ID perteneciente a Tenant A).

## Scope reconciliation and naming

- **Entitlement Key**: El prompt de implementación mencionó `module.rules.engine (o module.automation.basic)`. Conforme a la autoridad de `platform_docs/DATA_MODEL_ERD_MVP_BACKLOG.md` (líneas 378 y 2400), `SYSTEM_DESIGN.md` (línea 432) y `packages/database/src/entitlement-catalog.ts`, la clave canónica del módulo en el catálogo de entitlements es `module.automation.basic`. Se adopta `module.automation.basic` para todas las validaciones de base de datos y guardias de API.
- **RBAC Permissions**: Se utilizan las claves canónicas existentes `rules.read` y `rules.manage` definidas en `packages/rbac/src/index.ts`.

## Alternatives considered

- Usar un motor genérico externo (e.g. n8n en el núcleo): Rechazado según ADR-0006 por requisitos de latencia sub-50ms, multi-inquilino determinista y no dependencia de servicios externos para el core de automatización.
- Almacenar reglas en tablas separadas por tipo de acción/condición: Rechazado para el MVP; JSONB estructurado y validado con esquemas TypeScript estrictos proporciona la flexibilidad necesaria manteniendo la integridad referencial y el aislamiento de inquilino.

## Migration and verification

- Migración `20260825120000_add_rules_engine_foundation` ejecutada y validada en PostgreSQL.
- Pruebas de integración de base de datos (`packages/database/src/rule-catalog-manager.integration.ts` — 8 tests superados).
- Pruebas de integración de API REST (`apps/api/src/rules.integration.ts` — 8 tests superados).
- Verificación de Biome (0 errores, 0 warnings en 291 archivos).
- Verificación de TypeScript `typecheck` en los 18 paquetes y aplicaciones del monorepo (100% PASS).
