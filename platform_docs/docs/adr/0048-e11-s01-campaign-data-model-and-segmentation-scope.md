# ADR-0048 — E11-S01 Campaign Data Model, Audience Segmentation & Message Templates Scope

- Status: Accepted
- Date: 2026-09-02
- Owners: Platform Engineering

## Context

La historia E11-S01 inicia la construcción de **Epic 11 (Campaign Engine & Audience Broadcasts)**, estableciendo el modelo de datos relacional en PostgreSQL, el motor de segmentación de audiencia basado en etiquetas (*tags*), el motor determinista de interpolación de plantillas (*templates*) y los contratos de API REST para la gestión de campañas masivas multitenant.

Asimismo, como requerimiento operativo del entorno de desarrollo local, se migró el puerto web por defecto de `3000` a `3005` (`WEB_PORT=3005`, `PLATFORM_WEB_ORIGIN=http://localhost:3005`, `TENANT_WEB_ORIGIN=http://localhost:3005`) para evitar colisiones de puertos en la estación de trabajo.

En estricto cumplimiento de ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0010 (Modules & Entitlements), ADR-0012 (UUIDv7) y las reglas globales de ingeniería:

1. **Esquema de Base de Datos y Migración (`packages/database/prisma/`)**:
   - Se crearon tres modelos relacionales mapeados a tablas en snake_case con claves foráneas compuestas que garantizan aislamiento estricto a nivel de restricción de base de datos:
     - `MessageTemplate` (`message_template`): Plantillas de mensajes con soporte para categorías (`MARKETING`, `UTILITY`, `AUTHENTICATION`), texto con variables mustache `{{variable}}`, metadatos de medios opcionales (`media_url`, `media_type`) e índice por inquilino y categoría.
     - `Campaign` (`campaign`): Entidad orquestadora de difusión masiva vinculada a un canal de WhatsApp (`channelAccountId`), plantilla opcional (`templateId`), estado de ciclo de vida (`DRAFT`, `SCHEDULED`, `RUNNING`, `PAUSED`, `COMPLETED`, `FAILED`), límite de tasa (`rate_limit_per_minute` con valor base de 30 msgs/min), filtros de segmentación en JSONB (`audienceFilter`), contadores agregados (`total_recipients`, `sent_count`, `delivered_count`, `failed_count`) y marcas de tiempo de ejecución.
     - `CampaignAudienceMember` (`campaign_audience_member`): Registro individualizado de destinatario enlazado a un contacto activo (`contactId`) y campaña (`campaignId`). Cuenta con una restricción de unicidad estricta `campaign_audience_unique_recipient` sobre `(campaign_id, contact_id)` para prevenir duplicidad de envíos al mismo contacto.
   - Migración Prisma SQL desplegada: `20260902160000_add_campaigns_foundation`.

2. **Catálogo de Módulos y Permisos RBAC (`packages/rbac/`, `packages/database/`)**:
   - Nuevo módulo funcional registrado en `MODULE_ENTITLEMENT_KEYS`: `"module.campaigns"`.
   - Nuevos permisos granulares registrados en `PERMISSION_CATALOG`:
     - `"campaigns.read"`: Lectura de campañas, destinatarios y plantillas.
     - `"campaigns.manage"`: Creación, configuración y segmentación de campañas y plantillas.

3. **Motor de Sustitución de Variables (`packages/database/src/template-renderer.ts`)**:
   - Función pura `renderTemplate(templateText, variables)`: Reemplaza marcadores `{{clave}}` de forma tolerante a espacios y valores ausentes (los valores `null`/`undefined` se evalúan a cadena vacía sin provocar fallos en tiempo de ejecución).
   - Utilidad `extractTemplateVariables(templateText)`: Extrae y deduplica automáticamente las variables requeridas en una plantilla.

4. **Capa de Negocio y Segmentación (`packages/database/src/campaign-manager.ts`)**:
   - `createMessageTemplate`: Valida inquilino operativo e indexa las variables de la plantilla.
   - `listMessageTemplates`: Consulta filtrada por categoría y ordenada cronológicamente.
   - `createCampaign`: Valida pertenencia del `channelAccount` al inquilino (impidiendo referencias cruzadas A/B), resuelve el contenido de la plantilla y crea la campaña en estado inicial `DRAFT`.
   - `segmentAndPopulateAudience`: Filtra contactos activos del inquilino mediante etiquetas (*tags*) con el operador PostgreSQL `hasSome`, genera los miembros de audiencia en estado `PENDING` con sus variables contextuales (`nombre`, `telefono`, atributos personalizados) y actualiza el contador agregado `totalRecipients` de forma atómica e idempotente (`skipDuplicates: true`).
   - `getCampaignDetail` y `listCampaigns`: Consultas paginadas y de detalle con aislamiento estricto por inquilino.

5. **Controlador y Servicio REST NestJS (`apps/api/src/campaigns.ts`)**:
   - Endpoints registrados bajo `/api/v1/campaigns`:
     - `POST /api/v1/campaigns/templates` (201 Created) — Requiere `campaigns.manage`.
     - `GET /api/v1/campaigns/templates` (200 OK) — Requiere `campaigns.read`.
     - `POST /api/v1/campaigns` (201 Created) — Requiere `campaigns.manage`.
     - `POST /api/v1/campaigns/:id/audience/populate` (200 OK) — Requiere `campaigns.manage`.
     - `GET /api/v1/campaigns` (200 OK) — Requiere `campaigns.read`.
     - `GET /api/v1/campaigns/:id` (200 OK) — Requiere `campaigns.read`.
   - Defensa en profundidad: La clase controladora está decorada con `@RequireEntitlements("module.campaigns")`, bloqueando con 403 Forbidden a cualquier inquilino no autorizado, y cada endpoint exige los permisos RBAC correspondientes.

6. **Migración de Puerto Web**:
   - Puerto de la aplicación web configurado en `3005` en `.env`, `.env.example`, `packages/config/src/index.ts`, `apps/web/package.json` (`next dev -p 3005`), `compose.yaml` y en las suites de pruebas de integración de API.

## Decision

1. **Restricción Foránea Compuesta Inquilino-Canal e Inquilino-Contacto**:
   - Para imposibilitar cualquier fuga entre inquilinos (*tenant leakage*), las relaciones `campaign.channel_account_id` y `campaign_audience_member.contact_id` se vinculan mediante pares compuestos `(tenant_id, channel_account_id)` y `(tenant_id, contact_id)`.
2. **Idempotencia en la Población de Audiencias**:
   - Múltiples ejecuciones del endpoint `/audience/populate` no duplican destinatarios existentes gracias a la clave única `(campaign_id, contact_id)` y la cláusula `skipDuplicates: true`.
3. **Desacoplamiento de la Cola de Ejecución (E11-S02)**:
   - E11-S01 se limita al modelo relacional, segmentación y validación REST. El trabajador BullMQ, la orquestación asíncrona de lotes y el control estricto de tasa de envío (*rate limiting per minute*) quedan delimitados para E11-S02.

## Backlog Scope and Story Reconciliation

- **E11-S01 (Campaign Data Model, Audience Segmentation & Message Templates)** queda completada y verificada.
- Siguiente historia en ruta: **E11-S02 (Campaign Queue Worker, Throttling & Outbox Dispatcher)**.