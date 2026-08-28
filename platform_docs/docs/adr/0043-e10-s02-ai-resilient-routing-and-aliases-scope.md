# ADR-0043 — E10-S02 AI Resilient Routing, Failover Cascade & Virtual Aliases Scope

- Status: Accepted
- Date: 2026-08-27
- Owners: Platform Engineering

## Context

La historia E10-S02 expande la capa fundacional de **Epic 10 (AI Gateway Foundation)** implementando un motor de enrutamiento resiliente de modelos, cascada de failover entre rutas primarias y secundarias, gestión activa de límites de tarifa (HTTP 429) con rotación y períodos de enfriamiento de claves, y abstracción de alias virtuales (`platform-fast`, `platform-smart`, `platform-reasoning` y overrides por inquilino).

En cumplimiento de ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0009 (Rules-First, AI-Optional), ADR-0010 (Modules & Entitlements) y ADR-0042 (AI Gateway Foundation Scope):

1. **Esquema de Base de Datos y Migración (`packages/database/prisma/`)**:
   - `AiVirtualAlias`: Representa un alias abstracto (ej. `platform-fast`, `platform-smart`, `platform-reasoning` o alias personalizados del inquilino) con soporte de ámbito global (`tenant_id = null`) o específico por inquilino (`tenant_id = UUID`).
   - `AiModelRoute`: Define las rutas de ejecución asociadas a un alias virtual, vinculadas a un `AiProviderConfig` con `targetModelId`, `priority` (1 = primario, 2 = secundario/fallback), `timeoutMs`, `maxRetries` e `isEnabled`.
   - Migración Prisma `20260827190000_add_ai_routing_and_aliases` con índices únicos parciales para alias de plataforma y específicos de inquilino.
2. **Enrutador de Resiliencia y Cascada de Failover (`services/ai-gateway/src/resilient-router.ts`)**:
   - `AiResilientRouter`:
     - Resuelve y ordena las rutas activas por `priority ASC`.
     - Ejecuta la llamada al proveedor primario utilizando las claves activas provistas por `KeyPoolSelector`.
     - **Rotación de Claves ante Rate Limits (429)**: Si un proveedor responde con `AiRateLimitError`, la clave actual entra en período de enfriamiento (cooldown de 60s por defecto) y se reintenta inmediatamente con la siguiente clave disponible en la bolsa del mismo proveedor sin cambiar de ruta.
     - **Cascada de Failover ante Caídas (500/Timeout)**: Si se agotan las claves de la ruta primaria o se produce un error fatal/timeout de red (`AiTimeoutError`, `AiGatewayError`), el enrutador conmuta automáticamente a la ruta secundaria (`priority: 2`).
     - **Telemetría Transaccional**: Registra cada intento intermedio (`AiRoutingAttempt`) y el resultado final en `AiUsageLog`.
     - Lanza `AiAllProvidersFailedError` con el historial completo de intentos si todas las rutas de la cascada fallan.
3. **Gestor de Datos y Aislamiento Multi-inquilino (`packages/database/src/ai-routing-manager.ts`)**:
   - `createVirtualAlias` / `updateVirtualAliasRoutes`: CRUD atómico con validación de propiedad por inquilino.
   - `resolveRoutesForAlias`: Jerarquía de resolución que busca primero si el inquilino posee un override propio para `aliasKey`; si no existe, resuelve el alias global predeterminado de la plataforma (`tenantId: null`).
   - `seedDefaultPlatformAliases`: Inicializa de forma idempotente los alias globales de plataforma (`platform-fast`, `platform-smart`, `platform-reasoning`).
   - `listTenantAliases`: Lista los alias globales y personalizados disponibles para el inquilino activo.
4. **Endpoints REST en API Gateway (`apps/api/src/ai-gateway.ts`)**:
   - `GET /api/v1/ai/aliases`: Consulta el catálogo de alias virtuales disponibles para el inquilino.
   - `POST /api/v1/ai/completions/route`: Ejecuta un completado con resolución automática de alias y failover en cascada.
   - Protegidos por `TenantUserSessionGuard`, `TenantContextGuard`, `TenantPermissionGuard` (`ai.settings.manage`) y `TenantEntitlementGuard` (`module.ai`).

## Decision

1. **Desacoplamiento Mediante Alias Virtuales**:
   - Las aplicaciones y flujos de automatización nunca invocan nombres de modelos de proveedores directamente (ej. `gpt-4o` o `gemini-2.0-flash`), sino alias de intención (`platform-fast` para triage, `platform-smart` para agentes). Esto permite cambiar proveedores y modelos en caliente sin modificar código cliente ni reglas de negocio.
2. **Resiliencia de Dos Niveles (Key Rotation + Provider Failover)**:
   - El enrutador primero agota las claves disponibles en el proveedor primario ante cuotas (429) antes de conmutar al proveedor secundario, minimizando costos y maximizando la disponibilidad.
3. **Aislamiento Multi-inquilino Transparente**:
   - Los inquilinos pueden utilizar la infraestructura global de plataforma sin configuración adicional, o crear sus propios overrides de alias con proveedores BYOK conservando estricto aislamiento frente a otros inquilinos.

## Backlog Scope and Story Reconciliation

- E10-S02 (**Resilient Multi-Model Routing, Failover Cascade & Tenant Virtual Aliases**) queda implementada y verificada.
- La siguiente historia será E10-S03 (**Knowledge Base Document Ingestion, Chunking & Vector Embeddings**).
