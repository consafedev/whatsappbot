# ADR-0052 — E11-S05 Campaign Performance Analytics Dashboard & Conversion Funnel UI Scope

- Status: Accepted
- Date: 2026-09-09
- Owners: Platform Engineering & Frontend Architecture

## Context

La historia E11-S05 culmina **Epic 11 (Campaign Engine & Audience Broadcasts)** en el workspace frontend (`apps/web`), proporcionando el dashboard de analítica de rendimiento, métricas operativas clave y el embudo escalonado de conversión para campañas de WhatsApp bajo la ruta dinámica `/app/campaigns/[id]`.

En estricto cumplimiento de ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0010 (Modules & Entitlements), ADR-0048 (Campaigns Foundation), ADR-0049 (Campaign Dispatcher), ADR-0050 (Delivery Reconciliation & Metrics) y ADR-0051 (Campaigns Web UI):

1. **Ampliación del View Model (`apps/web/app/app/campaigns/campaigns-view-model.ts`)**:
   - Modelos tipados:
     - `CampaignMetrics`: `campaignId`, `totalRecipients`, `sentCount`, `deliveredCount`, `readCount`, `failedCount`, `pendingCount`, `deliveryRate`, `readRate`, `failureRate`.
     - `CampaignAudienceMemberItem`: `id`, `contactId`, `contactName`, `phoneNumber`, `email`, `status`, `sentAt`, `deliveredAt`, `readAt`, `errorMessage`.
     - `CampaignAudienceResponse`: `members`, `total`, `limit`, `offset`.
   - Utilidades matemáticas y badges:
     - `formatAudienceMemberStatus`: Mapeo a etiquetas en español (`PENDING` -> En cola, `SENT` -> Enviado, `DELIVERED` -> Entregado, `READ` -> Leído, `FAILED` -> Fallido) con distintivos de color Tailwind.
     - `calculateFunnelStepPercentage`: Cálculo robusto del porcentaje de retención entre pasos consecutivos sin división por cero ni números no finitos.
   - Clientes REST:
     - `fetchCampaignMetrics(apiBaseUrl, campaignId)`: Consulta `GET /api/v1/campaigns/:id/metrics` desempaquetando `{ success: true, data }`.
     - `fetchCampaignAudience(apiBaseUrl, campaignId, query)`: Consulta `GET /api/v1/campaigns/:id/audience` con soporte para filtros de estado, paginación (`limit`, `offset`) y normalización segura de la relación de contacto.

2. **Tarjetas de Indicadores Clave (KPI Cards - `apps/web/app/app/campaigns/[id]/campaign-kpi-cards.tsx`)**:
   - Audiencia Total (`totalRecipients` y conteo de pendientes en cola).
   - Tasa de Entrega (`deliveryRate` % y relación entregados/enviados).
   - Tasa de Lectura (`readRate` % y destinatarios leídos con doble check azul).
   - Tasa de Fallo (`failureRate` % y total de envíos fallidos).
   - Estados de carga tipo *skeleton*.

3. **Embudo de Conversión Escalonado (`apps/web/app/app/campaigns/[id]/campaign-funnel-view.tsx`)**:
   - 4 etapas visuales de retención con barras de progreso animadas:
     1. Audiencia Total (100%).
     2. Mensajes Despachados (% respecto al total).
     3. Entregas Confirmadas (% respecto a enviados).
     4. Lecturas Registradas (% respecto a entregados).
   - Resumen lateral de mensajes pendientes y fallidos.

4. **Desglose Detallado de Audiencia (`apps/web/app/app/campaigns/[id]/campaign-audience-table.tsx`)**:
   - Selector interactivo de filtros de estado (`ALL`, `PENDING`, `SENT`, `DELIVERED`, `READ`, `FAILED`).
   - Columnas: Destinatario (nombre y correo), Teléfono, Estado, Línea de tiempo (`sentAt`, `deliveredAt`, `readAt`) y detalles de error.
   - Paginación dinámica (límite 50 elementos, botones Anterior y Siguiente).

5. **Contenedor Principal y Enrutamiento Dinámico (`apps/web/app/app/campaigns/[id]/`)**:
   - `campaign-analytics-client.tsx`: Contenedor principal con verificación de entitlements (`module.campaigns`) y permisos (`campaigns.read`), cabecera con badge de estado de la campaña y botón de actualización en vivo.
   - `page.tsx`: Server component dinámico (`force-dynamic`) compatible con Next.js 15/16 (`await params`).
   - Actualización en `campaigns-list.tsx` para permitir acceso al dashboard tanto al hacer clic en el nombre de la campaña como mediante el botón de acción "Métricas".

## Decision

1. **Gating Estricto por Permisos y Módulo**:
   - Se requiere `module.campaigns` y `campaigns.read` para acceder y visualizar las métricas y la audiencia de la campaña.
2. **Normalización Defensiva en el View Model**:
   - Se normaliza la relación anidada de contacto (`contact.name`, `contact.phoneNumber`, `contact.email`) a nivel de miembro de audiencia para proteger la renderización ante contactos incompletos o desvinculados.
3. **Consistencia de Infraestructura**:
   - Consumo de API en puerto 3001 a través de `NEXT_PUBLIC_API_BASE_URL` y exposición web en puerto 3005.

## Backlog Scope and Story Reconciliation

- **E11-S05 (Campaign Performance Analytics Dashboard & Conversion Funnel UI)** queda completamente implementada, probada y verificada.
- Con esta historia concluye **Epic 11 (Campaign Engine & Audience Broadcasts)** en su totalidad (E11-S01 a E11-S05).
- Siguiente hito planificado: **Epic 12 (Reporting, Analytics & Operational Observability)**.
