# ADR-0049 — E11-S02 Campaign Execution Dispatcher, Rate Limiting & Outbox Delivery Scope

- Status: Accepted
- Date: 2026-09-03
- Owners: Platform Engineering

## Context

La historia E11-S02 continúa la construcción de **Epic 11 (Campaign Engine & Audience Broadcasts)**, implementando el control del ciclo de vida y máquina de estados de las campañas, el motor de despacho de lotes (*batch dispatcher*) con limitación de tasa (*rate limiting*) y la integración transaccional con la cola de salida (*outbox delivery*) hacia los canales de mensajería.

En estricto cumplimiento de ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0010 (Modules & Entitlements), ADR-0013 (Transactional Outbox) y ADR-0048 (Campaigns Foundation):

1. **Máquina de Estados y Ciclo de Vida (`packages/database/src/campaign-manager.ts`)**:
   - `startCampaign`:
     - Valida inquilino operativo con `assertTenantOperational`.
     - Permite inicio únicamente desde estados `DRAFT` o `PAUSED`.
     - Exige que `totalRecipients > 0` (lanzando `CampaignEmptyAudienceError` si no hay destinatarios segmentados).
     - Transiciona la campaña a `status: "RUNNING"` y registra la marca temporal `startedAt` (preservándola si es una reanudación).
   - `pauseCampaign`:
     - Valida que la campaña esté en estado `RUNNING` (lanzando `CampaignInvalidStatusTransitionError` en caso contrario).
     - Transiciona a `status: "PAUSED"` suspendiendo el procesamiento de nuevos lotes.
   - `cancelCampaign`:
     - Valida que la campaña no se encuentre en un estado terminal (`COMPLETED` o `CANCELLED`).
     - Transiciona a `status: "CANCELLED"` impidiendo cualquier despacho posterior.

2. **Despachador de Lotes y Generación de Outbox (`packages/database/src/campaign-execution-dispatcher.ts`)**:
   - `dispatchCampaignBatch`:
     - Exige que la campaña esté en estado `RUNNING`.
     - Determina el tamaño de lote efectivo respetando `batchSize` explícito o el límite configurado en la campaña (`rateLimitPerMinute`, con valor por defecto de 30 msgs/min).
     - Obtiene los siguientes miembros en estado `PENDING` ordenados cronológicamente por creación.
     - Para cada miembro en el lote:
       1. Interpola el contenido final del mensaje llamando a la función pura `renderTemplate(campaign.messageContent, member.variables)`.
       2. Genera una clave de idempotencia determinista `campaign:${campaign.id}:member:${member.id}` para evitar duplicación ante reintentos.
       3. Inserta atómicamente dentro de una transacción `$transaction` el registro en `outboundMessage` en estado `PENDING` con metadatos `{ campaignId, campaignAudienceMemberId, source: "CAMPAIGN" }`.
       4. Actualiza `campaignAudienceMember` a `status: "SENT"` y `sentAt: new Date()`.
     - Incrementa atómicamente el contador acumulado `campaign.sentCount`.
     - Verifica si restan miembros en `PENDING`. Cuando ya no quedan destinatarios pendientes, transiciona automáticamente la campaña a `status: "COMPLETED"` con marca `completedAt: new Date()`.
     - Retorna el resumen `{ processedCount, remainingPending, isCompleted }`.

3. **Endpoints REST de Ejecución en API Gateway (`apps/api/src/campaigns.ts`)**:
   - `POST /api/v1/campaigns/:id/start` (200 OK) — Inicia o reanuda la campaña.
   - `POST /api/v1/campaigns/:id/pause` (200 OK) — Pausa una campaña en ejecución.
   - `POST /api/v1/campaigns/:id/cancel` (200 OK) — Cancela una campaña.
   - `POST /api/v1/campaigns/:id/dispatch-batch` (200 OK) — Despacha un lote de destinatarios pendientes.
   - Seguridad y aislamiento:
     - Protegidos con `@RequireEntitlements("module.campaigns")`, bloqueando con 403 Forbidden a inquilinos sin derecho al módulo.
     - Permiso granular exigido: `campaigns.manage`.
     - Rechazo estricto con 404 Not Found ante cualquier intento de acceso o despacho cruzado entre inquilinos (*tenant leakage*).

## Decision

1. **Idempotencia en Mensajes Salientes**:
   - Cada mensaje generado en `outbound_message` utiliza la clave única `campaign:${campaign.id}:member:${member.id}` vinculada al `tenant_id`, lo que imposibilita la creación de mensajes duplicados en el outbox incluso en escenarios de ejecución concurrente de trabajadores.
2. **Trazabilidad de Campaña en el Outbox**:
   - Todo mensaje creado por el despachador incluye metadatos estructurales `{ campaignId, campaignAudienceMemberId, source: "CAMPAIGN" }`, permitiendo que el subsistema de envío por WhatsApp y la posterior conciliación de webhooks reconozcan el origen del mensaje.
3. **Transición Automática a Finalizada**:
   - La campaña transiciona a `COMPLETED` en el momento exacto en que un despacho agota los destinatarios en estado `PENDING`, sellando `completedAt` sin requerir cron jobs adicionales para el cierre.

## Backlog Scope and Story Reconciliation

- **E11-S02 (Campaign Execution Dispatcher, Rate Limiting & Outbox Delivery)** queda completada y verificada.
- Siguiente historia en ruta: **E11-S03 (Campaign Delivery Status Reconciliation & Bulk Metrics Aggregation)**.