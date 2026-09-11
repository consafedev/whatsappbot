# ADR-0056 — E12-S04 System Health, Latency & Worker Queue Observability Scope

- Status: Accepted
- Date: 2026-09-10
- Owners: Backend Engineering, Frontend Engineering & Platform Architecture

## Context

Continuando con la ejecución de la épica consolidada **`Epic 12 — Reporting, Analytics & Operational Observability`**, la historia E12-S04 implementa las capacidades de telemetría de salud de infraestructura en tiempo real, monitoreo de latencia y observabilidad de colas y procesos asíncronos para inquilinos y operadores de la plataforma.

En estricto apego a ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0005 (BullMQ Async Jobs), ADR-0010 (Modules & Entitlements) y ADR-0053 (Analytics Engine):

1. **Sondas de Infraestructura Nativas (Sin APM Pesados)**:
   - **PostgreSQL**: Sonda de latencia ejecutando consulta optimizada sobre la tabla de inquilinos (`tenant.findFirst`) o `$queryRawUnsafe("SELECT 1;")`, midiendo el tiempo de respuesta en milisegundos (`databaseLatencyMs`).
   - **Redis**: Sonda de latencia directa implementada mediante un socket TCP nativo Node.js (`node:net`) enviando comandos estándar RESP (`PING` / `+PONG` con soporte de autenticación `AUTH <password>`), midiendo el tiempo de ida y vuelta en milisegundos (`redisLatencyMs`) sin añadir clientes externos adicionales.
   - **Criterio de Salud Global**:
     - `healthy`: Ambos servicios responden con latencia menor a 500 ms y sin acumulación crítica de mensajes con error.
     - `degraded`: Uno o ambos servicios presentan latencias elevadas (> 500 ms) o existe un volumen anormal de fallos en outbox (> 20 mensajes).
     - `unhealthy`: Uno o ambos servicios de infraestructura no responden o arrojan error de conexión.

2. **Métricas de Colas y Outbox (Aislamiento Multitenant Estricto)**:
   - A diferencia de la latencia de infraestructura, las métricas de mensajes en cola y rendimiento de despacho se calculan con estricto aislamiento por inquilino (`where: { tenantId }`):
     - `pendingCount`: Total de mensajes salientes en estado `PENDING` esperando procesamiento en la tabla `outboundMessage`.
     - `failedCount`: Total de mensajes salientes en estado `FAILED` que requieran intervención o reintento.
     - `averageTransitSeconds`: Latencia media de tránsito de mensajes (diferencia en segundos entre `createdAt` y `sentAt`) para mensajes enviados en las últimas 24 horas (`sentAt >= now - 24h`).
   - Estado de workers: Reporta el estado operativo de los procesos asíncronos (`whatsappWorker` y `jobsWorker`) en función de la disponibilidad de la infraestructura subyacente.

3. **Endpoint REST en API Gateway (`apps/api/src/analytics.ts`)**:
   - `GET /api/v1/analytics/system-health`:
     - Gating de seguridad: Requiere derecho del inquilino `@RequireEntitlements("module.reports")` y permiso de usuario `@analyticsAuthorized("reports.read")`.
     - Envelope estándar:
       ```json
       {
         "success": true,
         "data": {
           "status": "healthy",
           "timestamp": "2026-09-10T...",
           "databaseLatencyMs": 4,
           "redisLatencyMs": 2,
           "outboxMetrics": {
             "pendingCount": 0,
             "failedCount": 0,
             "averageTransitSeconds": 1.2
           },
           "workerStatus": {
             "whatsappWorker": "active",
             "jobsWorker": "active"
           }
         }
       }
       ```

4. **Visualizador de Salud y Colas en Web UI (`apps/web/app/app/reports/`)**:
   - `reports-view-model.ts`: Tipos `SystemHealthData`, `OutboxHealthMetrics`, `WorkerStatusSummary` y cliente `fetchSystemHealth(apiBaseUrl)`.
   - `reports-system-health.tsx`: Componente visual interactivo con:
     - Banner de estado global con semáforos y mensajes descriptivos (Saludable, Degradado, Crítico).
     - Tarjetas métricas individuales con indicadores de semáforo (Verde: < 50ms / óptimo, Amarillo: 50-200ms / moderado, Rojo: > 200ms o error).
     - Monitores de mensajes pendientes y fallidos en outbox.
     - Indicador de latencia media de tránsito en las últimas 24 horas.
     - Resumen del estado de los workers de WhatsApp y BullMQ.
     - Botón de refresco manual de telemetría con spinner interactivo y marca de tiempo en formato `es-MX`.
   - `reports-client.tsx`: Navegación unificada por pestañas:
     - Pestaña 1: "Métricas Operativas" (KPIs agregados y gráfico temporal de tráfico).
     - Pestaña 2: "Salud y Colas" (Consola de telemetría de infraestructura y outbox).

## Decision

1. **Uso de Sondas Nativas sin Dependencias Externas de APM**:
   - Se descartó la instalación de paquetes pesados (Prometheus, Datadog, New Relic) para el MVP, privilegiando la telemetría nativa en PostgreSQL y sockets TCP puros contra Redis (`net.Socket`). Esto garantiza portabilidad, nulo impacto en el tamaño del bundle y latencias mínimas de introspección.
2. **Armonización Formal del Backlog y Épica 12**:
   - Se consolida formalmente el nombre de la épica en toda la documentación y backlog a **`Epic 12 — Reporting, Analytics & Operational Observability`**, integrando `E12-S04` como la historia dedicada a la observabilidad de salud y colas de despacho.
3. **Aislamiento Multitenant en Métricas de Mensajes**:
   - Ningún inquilino puede inspeccionar la profundidad de colas ni fallos de otros inquilinos; cada consulta al outbox está irrevocablemente acotada al `tenantId` verificado en la sesión.

## Consequences

- Los operadores e inquilinos disponen de visibilidad inmediata sobre la fluidez del motor de mensajería y la salud de sus canales sin necesidad de acceder a la consola del servidor.
- Las degradaciones de red o saturaciones de workers son detectadas tempranamente antes de impactar los SLAs del cliente.
- La suite de pruebas de integración y frontend valida tanto la precisión de las sondas como el rechazo estricto ante accesos no autorizados.
