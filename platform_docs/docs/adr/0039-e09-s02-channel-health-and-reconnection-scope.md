# ADR-0039 — E09-S02 Channel Health Checks, Keep-Alive & Reconnection Engine Scope

- Status: Accepted
- Date: 2026-08-26
- Owners: Platform Engineering

## Context

La historia `E09-S02` continúa la implementación de la épica de gestión de canales de comunicación (Epic 09 — Channel Management) conforme a ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0004 (Messaging Provider Abstraction), ADR-0012 (UUIDv7 & Timestamp Conventions), ADR-0013 (Transactional Outbox) y ADR-0038 (Channel QR Pairing Lifecycle).

Para garantizar la estabilidad y resiliencia de las conexiones de WhatsApp por socket/proveedor (Baileys/Meta), la plataforma requería:
1. **Gestor de Salud y Keep-Alive en Base de Datos (`packages/database/src/channel-health-manager.ts`)**:
   - Registro periódico de latidos (`recordChannelHeartbeat`): valida operatividad del inquilino y persiste `lastHeartbeatAt`, `lastLatencyMs` y `socketStatus` (`"open" | "connecting" | "closed"`), restableciendo `isDegraded = false` y `healthStatus = "healthy"`.
   - Manejo de fallas de conexión (`handleChannelConnectionFailure`):
     - **Fallas fatales** (ej. `401 Logged Out`, `bad-mac`, expulsión de sesión): purga de inmediato las credenciales de sesión (`credentialsCiphertext = null`), transiciona el estado a `DISCONNECTED`, emite el evento `channel.disconnected` en outbox y registra auditoría en `AuditLog`.
     - **Fallas transitorias** (ej. `503`, pérdida momentánea de conexión de red): transiciona el estado a `CONNECTING` con `healthStatus = "degraded"`, actualiza `reconnectAttempts` y `lastReconnectAttemptAt`, y emite el evento `channel.reconnecting` en outbox.
   - Detección de canales obsoletos o degradados (`checkStaleChannels`): identifica canales con estado `CONNECTED` que no hayan reportado latidos dentro del umbral configurable (`staleThresholdSeconds`, por defecto 90 segundos) y los marca como `isDegraded = true`.
2. **Estrategia y Políticas de Reconexión en Abstracción de Proveedor (`packages/messaging/src/channel-reconnection-policy.ts`)**:
   - Algoritmo de retroceso exponencial con variación aleatoria (*exponential backoff with full-jitter*): `calculateBackoffDelay(attempt, baseMs, maxMs, randomFactor)`.
   - Clasificador determinista de errores Baileys / WhatsApp: `isFatalDisconnectError(statusCode, error)`.
3. **Endpoint REST de Diagnóstico de Salud (`apps/api/src/tenant-channels.ts`)**:
   - `GET /api/v1/channels/:channelAccountId/health`: protegido con `TenantUserSessionGuard`, `TenantContextGuard`, `TenantPermissionGuard` (`channels.read`) y `TenantEntitlementGuard` (`module.messaging.basic`), devolviendo métricas operativas (`status`, `isHealthy`, `lastHeartbeatAt`, `lastLatencyMs`, `socketStatus`, `isDegraded`, `reconnectAttempts`) sin exponer credenciales ni secretos.
4. **Aislamiento Multi-inquilino Estricto**:
   - Todas las consultas y mutaciones de salud filtran estrictamente por `tenantId`.
   - Intentos por parte de un inquilino ajeno de consultar la salud o reportar latidos en canales de otro inquilino retornan HTTP 404 (`ChannelAccountNotFoundError`).

## Decision

1. **Separación de Responsabilidades**:
   - El cálculo de backoff y clasificación de desconexión reside en `@whatsapp-platform/messaging` como política pura y testeable sin dependencias de base de datos.
   - La persistencia atómica de métricas, eventos de outbox y auditoría reside en `@whatsapp-platform/database` a través de `ChannelHealthManager`.
2. **Seguridad y Purga Inmediata ante 401**:
   - Ante errores fatales clasificados como desautenticación, la clave y ciphertext de credenciales son purgados de forma transaccional para impedir fugas o reintentos con estados inválidos.
3. **Diagnóstico REST y Monitoreo**:
   - El endpoint `/api/v1/channels/:channelAccountId/health` proporciona un contrato limpio para observabilidad y dashboards de salud sin exponer estructuras internas ni datos sensibles.

## Backlog Scope and Story Reconciliation

- `E09-S02` (**Channel Health Checks, Keep-Alive & Reconnection Engine**) queda implementada y verificada.
- Las historias siguientes de Epic 09 abordarán:
  - `E09-S03`: WhatsApp Channel Web UI Management & Live QR Pairing Modal.
  - `E09-S04`: Multi-device Channel Account Scalability and Auto-recovery.
