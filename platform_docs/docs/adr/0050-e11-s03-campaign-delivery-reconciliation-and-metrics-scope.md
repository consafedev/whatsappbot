# ADR-0050 — E11-S03 Campaign Delivery Reconciliation & Bulk Metrics Aggregation Scope

- Status: Accepted
- Date: 2026-09-03
- Owners: Platform Engineering

## Context

La historia E11-S03 avanza en **Epic 11 (Campaign Engine & Audience Broadcasts)**, implementando la reconciliación monótona de acuses de recibo de entrega (`DELIVERED`, `READ`, `FAILED`) para miembros de audiencia de campañas masivas, la actualización atómica de contadores en PostgreSQL, la agregación y cálculo de tasas cuantitativas de desempeño (`deliveryRate`, `readRate`, `failureRate`), y los endpoints REST de consulta de métricas y miembros paginados.

En estricto cumplimiento de ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0010 (Modules & Entitlements), ADR-0024 (Delivery Status Reconciliation), ADR-0048 (Campaigns Foundation) y ADR-0049 (Campaign Dispatcher):

1. **Reconciliador de Acuses de Recibo (`packages/database/src/campaign-delivery-reconciler.ts`)**:
   - `reconcileCampaignAudienceDeliveryStatus`:
     - Valida el inquilino operativo con `assertTenantOperational`.
     - Verifica la existencia y pertenencia del miembro a la campaña especificada mediante clave compuesta `tenantId_id`.
     - **Monotonicidad y tolerancia a eventos fuera de orden**:
       - Si el miembro ya se encuentra en estado `READ`, la llegada posterior de un evento `DELIVERED` no degrada el estado del miembro ni altera los contadores.
       - Si el evento entrante es `READ` y el miembro no había recibido previamente un evento `DELIVERED`, sella `readAt`, asigna `deliveredAt` e incrementa atómicamente `campaign.deliveredCount`.
       - Si el miembro ya había sido marcado como `DELIVERED`, la transición a `READ` únicamente actualiza `readAt` sin duplicar el incremento de `deliveredCount`.
       - Si el evento es `FAILED`, sella `errorMessage` y aplica el incremento atómico en `campaign.failedCount`.
       - Los acuses de recibo duplicados son idempotentes y no incrementan contadores repetidamente.
   - `reconcileCampaignDeliveryFromOutboundMessage`:
     - Permite que el subsistema de webhooks y el outbox dispatcher propaguen acuses de recibo hacia la campaña cuando `outboundMessage.content.metadata.source === "CAMPAIGN"`.

2. **Cálculo de Métricas y Consulta de Miembros (`packages/database/src/campaign-manager.ts`)**:
   - `getCampaignMetrics`:
     - Consulta la campaña e inspecciona en vivo los miembros de audiencia en la base de datos PostgreSQL.
     - Retorna métricas absolutas: `totalRecipients`, `sentCount`, `deliveredCount`, `readCount`, `failedCount`, `pendingCount`.
     - Calcula tasas porcentuales redondeadas a dos decimales:
       - `deliveryRate = (deliveredCount / sentCount) * 100` (o 0 si `sentCount = 0`).
       - `readRate = (readCount / deliveredCount) * 100` (o 0 si `deliveredCount = 0`).
       - `failureRate = (failedCount / sentCount) * 100` (o 0 si `sentCount = 0`).
   - `listCampaignAudienceMembers`:
     - Consulta paginada con `take` y `skip`, filtrado opcional por `status`, orden cronológico ascendente y relación con el contacto (`id`, `name`, `phoneNumber`, `email`).

3. **Endpoints REST en NestJS API Gateway (`apps/api/src/campaigns.ts`)**:
   - `GET /api/v1/campaigns/:id/metrics` (200 OK) — Consulta de métricas agregadas y tasas calculadas.
   - `GET /api/v1/campaigns/:id/audience` (200 OK) — Listado paginado de destinatarios con parámetros `status`, `limit`, `offset`.
   - Protegidos por `@RequireEntitlements("module.campaigns")` y `@campaignsAuthorized("campaigns.read")`.
   - Aislamiento A/B: Rechazo con 404 Not Found ante cualquier solicitud cross-tenant.

## Decision

1. **Monotonicidad Estricta en Membresías de Campaña**:
   - Para prevenir inconsistencias causadas por latencia de red o entregas desordenadas de webhooks de proveedores externos (e.g. Meta / WhatsApp Business API), el reconciliador garantiza que un miembro que alcanzó el estado `READ` jamás retroceda a `DELIVERED`.
2. **Cálculo Determinista de Métricas**:
   - Los contadores agregados en la tabla `campaign` (`sent_count`, `delivered_count`, `failed_count`) se actualizan mediante `{ increment: 1 }` en transacciones de PostgreSQL, y `readCount` y `pendingCount` se consultan directamente de los miembros para garantizar fidelidad del 100% sin condiciones de carrera.

## Backlog Scope and Story Reconciliation

- **E11-S03 (Campaign Delivery Status Reconciliation & Bulk Metrics Aggregation)** queda completada y verificada.
- Siguiente historia en ruta: **E11-S04 (Campaign Management Web UI: Creation Wizard & Audience Segmenter)**.