# ADR-0057 — E12-S05 Operational Alerting & Anomaly Triggers Scope

- Status: Accepted
- Date: 2026-09-10
- Owners: Backend Engineering, Frontend Engineering & Platform Architecture

## Context

Como historia final de **`Epic 12 — Reporting, Analytics & Operational Observability`**, la historia E12-S05 implementa el motor de detección de anomalías operativas, evaluación de umbrales en tiempo real, endpoint REST de alertas y su visualización en el tablero de reportes y observabilidad.

En estricto apego a ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0010 (Modules & Entitlements), ADR-0053 (Analytics Engine) y ADR-0056 (System Health Observability):

1. **Evaluación de Anomalías Determinista y Sin Estado Adicional**:
   - Se evalúa bajo demanda en tiempo de consulta sobre el inquilino autenticado en la sesión, sin requerir cron jobs pesados en segundo plano ni esquemas adicionales de almacenamiento persistente.
   - Utiliza la telemetría viva de infraestructura provista por `SystemObservabilityService` y las consultas acotadas por inquilino a `outboundMessage` y `channelAccount`.

2. **Reglas de Detección y Umbrales Operativos**:
   - **Alta Tasa de Fallo (`HIGH_FAILURE_RATE`)**:
     - Condición: Mínimo 10 mensajes enviados y tasa de error `(failedCount / sentCount) * 100 > 15%`.
     - Severidad: `warning` si > 15%, escala a `critical` si > 30%.
     - Remediación sugerida: Verificar mensajes salientes y estado de proveedores.
   - **Saturación de Outbox (`OUTBOX_BACKLOG`)**:
     - Condición: `pendingCount > 50` mensajes en espera o tiempo promedio de tránsito `averageTransitSeconds > 60s`.
     - Severidad: `warning`.
     - Remediación sugerida: Verificar worker de WhatsApp y rendimiento de despacho.
   - **Latencia de Base de Datos (`HIGH_LATENCY_DB`)**:
     - Condición: Latencia de PostgreSQL `> 300ms` (`warning`) o fallo de conexión a base de datos (`critical`).
     - Remediación sugerida: Revisar estado del servicio PostgreSQL y pool de conexiones activas.
   - **Latencia de Redis (`HIGH_LATENCY_REDIS`)**:
     - Condición: Latencia de ping a Redis `> 300ms` (`warning`) o fallo de conexión al socket (`critical`).
     - Remediación sugerida: Revisar contenedor o instancia de Redis y consumo de memoria.
   - **Canal Desconectado (`CHANNEL_DISCONNECTED`)**:
     - Condición: Existencia de canales de WhatsApp pertenecientes al inquilino en estado `disconnected`.
     - Severidad: `warning`.
     - Remediación sugerida: Revisar salud de canal y reconectar sesión en configuración.

3. **Endpoint REST en API Gateway (`apps/api/src/analytics.ts`)**:
   - `GET /api/v1/analytics/alerts`:
     - Gating: Requiere derecho `@RequireEntitlements("module.reports")` y permiso `@analyticsAuthorized("reports.read")`.
     - Envelope estándar:
       ```json
       {
         "success": true,
         "data": {
           "activeAlerts": [
             {
               "id": "alert-tenant-code",
               "code": "HIGH_FAILURE_RATE",
               "severity": "warning",
               "title": "Alta tasa de fallos en envíos",
               "message": "Tasa de fallos del 20% (2 fallidos de 10 enviados)...",
               "metricValue": "20%",
               "thresholdValue": "> 15%",
               "triggeredAt": "2026-09-10T..."
             }
           ],
           "summary": {
             "total": 1,
             "critical": 0,
             "warning": 1,
             "info": 0
           },
           "evaluatedAt": "2026-09-10T..."
         }
       }
       ```

4. **Visualizador de Alertas en Web UI (`apps/web/app/app/reports/`)**:
   - `reports-view-model.ts`: Tipos `OperationalAnomalyAlert`, `AlertsSummary`, `AlertsOverviewData` y cliente `fetchOperationalAlerts(apiBaseUrl)`.
   - `reports-alerts.tsx`:
     - Si `summary.total > 0`: Banner destacado con colorimetría según severidad (`rose` para critical, `amber` para warning), desglose de anomalías, valores medidos vs umbrales y consejos de remediación contextual.
     - Si `summary.total === 0`: Indicador verde sutil y tranquilizador ("Sin anomalías operativas detectadas").
   - `reports-client.tsx`:
     - Montaje del componente `ReportsAlerts` en la cabecera principal del tablero para visibilidad inmediata en cualquiera de las pestañas ("Métricas Operativas" o "Salud y Colas").
     - Sincronización del ciclo de recarga con el botón de actualización en vivo.

5. **Fuera de Alcance**:
   - Notificaciones push salientes (email, SMS, webhook externo) no forman parte de este commit y se reservan para el subsistema de integraciones y notificaciones externas.
   - Reglas arbitrarias configurables por usuario sin base en el modelo normativo.

## Consequences

- Cierra satisfactoriamente la **Epic 12 — Reporting, Analytics & Operational Observability**, proporcionando una visión completa de agregados de tráfico, series temporales, exportación CSV, telemetría de infraestructura y detección reactiva de anomalías.
- Mantiene cero dependencias de agentes pesados externos (APM) o sobrecarga en PostgreSQL.
- Provee a los operadores del inquilino advertencias tempranas antes de que una acumulación de cola o falla de canal degrade la atención de clientes.
