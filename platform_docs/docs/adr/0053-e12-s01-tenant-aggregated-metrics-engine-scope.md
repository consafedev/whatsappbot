# ADR-0053 — E12-S01 Tenant Aggregated Metrics Engine & Analytics API Scope

- Status: Accepted
- Date: 2026-09-10
- Owners: Platform Engineering & Backend Architecture

## Context

La historia E12-S01 inicia **Epic 12 (Reporting, Analytics & Operational Observability)** implementando el motor central de agregación de métricas operativas y series temporales a nivel de tenant, así como los endpoints REST correspondientes en el gateway API.

En estricto cumplimiento de ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy) y ADR-0010 (Modules & Entitlements):

1. **Motor de Métricas Agregadas (`packages/database/src/analytics-manager.ts`)**:
   - `getTenantOperationalOverview(database, params)`:      - Entrada: `{ tenantId, from, to }`.
     - Validaciones: `assertTenantOperational`, validación cronológica estricta (`from <= to`) y rechazo de formats no ISO válidos. En caso de fechas invertidas o inválidas arroja `AnalyticsDateRangeInvalidError`.
     - Agregaciones calculadas estrictamente acotadas por `tenantId`:
       - `inboundMessagesCount`: conteo de mensajes entrantes (`inboundMessageEvent` filtrado por evento + `message` con `direction: 'inbound'`).
       - `outboundMessagesCount`: conteo de mensajes salientes (`outboundMessage` + `message` con `direction: 'outbound'`).
       - `activeConversationsCount`: conteo de conversaciones con estado no cerrado (`status != 'closed'`) y actividad dentro del rango.
       - `closedConversationsCount`: conteo de conversaciones con estado cerrado (`status = 'closed'`) y cierre dentro del rango.
       - `aiTokenUsage`: desglose de tokens (`promptTokens`, `completionTokens`, `totalTokens`, `estimatedCostUsd`) obtenido de `aiUsageLog`.
       - `deliverySuccessRate`: porcentaje de mensajes salientes entregados o leídos dentro del rango (0–100, o 0 si no hay mensajes salientes).
   - `getTenantMessageTimeSeries(database, params)`:
     - Entrada: `{ tenantId, from, to, interval: 'day' | 'hour' }`.
     - Validaciones: `assertTenantOperational`, fechas cronológicas (`from <= to`), intervalo válido.
     - Agregación por buckets temporales (`YYYY-MM-DD` o `YYYY-MM-DDTHH:00:00.000Z`) con desglose de `inbound`, `outbound` y `total`.

2. **Gating de Seguridad, Entitlements y RBAC**:
   - Módulo: Se registra `"module.reports"` en `packages/database/src/entitlement-catalog.ts` (`MODULE_ENTITLEMENT_KEYS`).
   - Permisos RBAC:
     - Se utiliza `reports.read` para autorizar la lectura de analítica y métricas agregadas.
     - Se incorpora formalmente `reports.export` al catálogo canónico (`packages/rbac/src/index.ts`) para soportar futuras capacidades de exportación (E12-S03).
   - Aislamiento Multitenant: Todas las consultas a la base de datos están incondicionalmente filtradas por `tenantId`, garantizando cero fuga de datos analíticos entre tenants.

3. **Controlador y Servicio REST (`apps/api/src/analytics.ts`)**:
   - Endpoints:
     - `GET /api/v1/analytics/overview`: acepta query params `from` y `to` (ISO strings).
     - `GET /api/v1/analytics/time-series`: acepta query params `from`, `to`, `interval` (`day` o `hour`).
   - Decoradores de seguridad:
     - `@RequireEntitlements("module.reports")` valida el módulo contratado por el tenant.
     - `@analyticsAuthorized("reports.read")` valida la pertenencia al tenant y el permiso RBAC del usuario autenticado.
   - Manejo de Errores:
     - Fechas cronológicamente invertidas o parámetros no conformes resultan en `BadRequestException` (HTTP 400).
     - Falta de módulo o permisos resultan en `ForbiddenException` (HTTP 403).

## Decision

1. **Agregación en PostgreSQL sin Almacenes Analíticos Externos (MVP Scope)**:
   - Para el alcance de este MVP, las consultas agregadas se ejecutan directamente en PostgreSQL aprovechando índices compuestos existentes (`tenantId`, `createdAt`), preservando PostgreSQL como la única fuente de verdad y evitando complejidad operativa de almacenes analíticos externos o jobs batch de preagregación.
2. **Validación Preventiva de Rangos Temporales**:
   - Se rechaza en la capa de dominio (`analytics-manager.ts`) y en la capa de transporte (`analytics.ts`) cualquier rango temporal donde `from > to`, previniendo ejecuciones de consultas inconsistentes.
3. **Ampliación del Catálogo de Permisos**:
   - El catálogo RBAC cuenta con un total canónico de 34 permisos en el sistema (33 preexistentes más la adición de `reports.export`, complementando a `reports.read`), sincronizando la suite de pruebas RBAC y user-management.

## Backlog Scope and Story Reconciliation

- **E12-S01 (Tenant Aggregated Metrics Engine & Analytics API Endpoints)** queda completamente implementada, probada y verificada.
- Siguiente hito planificado: **E12-S02 (Analytics Web Dashboard UI)**.
