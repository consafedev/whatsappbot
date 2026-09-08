# ADR-0051 — E11-S04 Campaign Management Web UI & Creation Wizard Scope

- Status: Accepted
- Date: 2026-09-08
- Owners: Platform Engineering & Frontend Architecture

## Context

La historia E11-S04 expande **Epic 11 (Campaign Engine & Audience Broadcasts)** en el workspace frontend (`apps/web`), proporcionando la interfaz gráfica de usuario para la administración, visualización, segmentación y control del ciclo de vida de campañas de difusión masiva en WhatsApp.

En estricto cumplimiento de ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0010 (Modules & Entitlements), ADR-0048 (Campaigns Foundation), ADR-0049 (Campaign Dispatcher) y ADR-0050 (Delivery Reconciliation):

1. **Navegación y Entitlements de Inquilino (`apps/web/app/app/tenant-app-navigation.ts`)**:
   - Registro de `"module.campaigns": "Campañas"` en `TENANT_MODULE_LABELS` para consistencia en la consola del inquilino.
   - Habilitación de la ruta `/app/campaigns` en el grupo de operación, protegida estrictamente por `module.campaigns` y el permiso `campaigns.read`.

2. **Capa View Model y Clientes REST (`apps/web/app/app/campaigns/campaigns-view-model.ts`)**:
   - Definición de contratos TypeScript: `CampaignListItem`, `CampaignDetail`, `MessageTemplateItem`, `CampaignChannelItem`, `CreateCampaignInput`.
   - Utilidades de formateo:
     - `formatCampaignStatus`: Mapeo determinista de estados (`DRAFT`, `SCHEDULED`, `RUNNING`, `PAUSED`, `COMPLETED`, `CANCELLED`, `FAILED`) a etiquetas en español y distintivos cromáticos Tailwind.
     - `calculateProgress`: Cálculo porcentual seguro (`0` a `100`) sin división por cero ni números negativos.
     - `extractMustacheVariables`: Detector en tiempo real de sustituciones dinámicas (e.g. `{{nombre}}`, `{{empresa}}`).
   - Clientes REST hacia los endpoints NestJS:
     - `fetchCampaigns`, `fetchCampaignDetail`, `createCampaign`, `startCampaign`, `pauseCampaign`, `cancelCampaign`, `populateAudience`, `fetchMessageTemplates`, `createMessageTemplate`, `fetchChannelsForCampaigns`.

3. **Asistente Modal de 4 Pasos (`apps/web/app/app/campaigns/campaign-wizard-modal.tsx`)**:
   - **Paso 1: Configuración General**: Nombre de la campaña y selección de canal de WhatsApp activo.
   - **Paso 2: Mensaje y Plantilla**: Selector de plantilla guardada o redacción libre con visualización dinámica de variables mustache detectadas.
   - **Paso 3: Audiencia y Segmentación**: Filtro por etiquetas con badges interactivos y opción de segmentar/poblar audiencia de forma automática al crear.
   - **Paso 4: Tasa de Envío y Resumen**: Slider de velocidad (10 a 120 msgs/min, default 30) y resumen pre-confirmación.

4. **Componentes de Listado y Control (`apps/web/app/app/campaigns/`)**:
   - `campaigns-client.tsx`: Contenedor principal con filtros por estado, barra de búsqueda en tiempo real, gestión de toasts y control de accesos con alertas si el módulo o permisos no están contratados.
   - `campaigns-list.tsx`: Tabla responsiva con barra de progreso, conteos de entregados (`✓✓`), leídos (`👁`), fallidos (`✕`), y botones de acción contextuales según el estado (`Iniciar`, `Pausar`, `Reanudar`, `Cancelar`, `Poblar Audiencia`).

## Decision

1. **Gating Estricto por Permisos y Módulo**:
   - Se requiere `module.campaigns` y `campaigns.read` para renderizar la ruta.
   - Las operaciones de modificación (`start`, `pause`, `cancel`, `create`, `populate`) se ocultan a usuarios sin `campaigns.manage`.
2. **Sincronización de Puertos**:
   - La interfaz opera en el puerto `3005` y consume el API Gateway en `3001` mediante `NEXT_PUBLIC_API_BASE_URL`.

## Backlog Scope and Story Reconciliation

- **E11-S04 (Campaign Management Web UI: Creation Wizard & Audience Segmenter)** queda completada y verificada.
- Siguiente historia en ruta: **E11-S05 (Campaign Analytics Web UI: Delivery Rates & Funnel Metrics)**.
