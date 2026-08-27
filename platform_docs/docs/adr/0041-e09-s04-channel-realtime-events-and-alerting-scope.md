# ADR-0041 — E09-S04 WhatsApp Channel Realtime Events Stream, Live QR Updates & Alerting Scope

- Status: Accepted
- Date: 2026-08-27
- Owners: Platform Engineering

## Context

La historia E09-S04 concluye la implementación de **Epic 09 (WhatsApp Channel Management)** dotando a la plataforma de un canal de eventos en tiempo real unidireccional vía Server-Sent Events (SSE), actualizando reactivamente los modales de código QR, estados de salud y emitiendo alertas inmediatas a los operadores sin requerir recargas de página o sobrecargar el servidor con sondeos continuos.

En cumplimiento de ADR-0002 (PostgreSQL Source of Truth), ADR-0004 (Messaging Provider Abstraction), ADR-0013 (Outbox Pattern), ADR-0029 (Inbox SSE Pattern), ADR-0038 (QR Pairing Lifecycle), ADR-0039 (Channel Health & Reconnection) y ADR-0040 (Channels Web UI Scope):

1. **Servicio SSE de Canales (`apps/api/src/channel-realtime.service.ts`)**:
   - `ChannelRealtimeService` / `ChannelRealtimeBroadcaster`: Mantiene registro en memoria de clientes SSE indexados por `tenantId` (aislamiento multi-inquilino estricto).
   - `broadcastToTenant(tenantId: string, event: ChannelRealtimeEvent)`: Emite eventos tipados a todos los escuchas del inquilino correspondiente (`channel.qr_generated`, `channel.connected`, `channel.disconnected`, `channel.reconnecting`, `channel.health_updated`).
   - `subscribeTenantChannelEvents(tenantId: string, heartbeatIntervalMs = 15_000)`: Retorna un `Observable<MessageEvent>` que emite el evento inicial `{ status: "connected" }`, propaga los eventos del canal y genera latidos automáticos `event: "ping"` cada 15 segundos.
   - `addClient(tenantId: string, res: ChannelRealtimeHttpResponse)`: Soporte directo de streaming HTTP con desuscripción y limpieza automática en eventos `close` y `finish`.
   - `ChannelRealtimeOutboxBridge`: Puente de sincronización `@Injectable()` que sondea la tabla `DomainEventOutbox` periódicamente (cada 250ms) y retransmite eventos de outbox de canales de forma asíncrona hacia el servicio en tiempo real.
2. **Endpoint SSE de Canales (`apps/api/src/tenant-channels.ts`)**:
   - `GET /api/v1/channels/events/stream`:
     - Protegido por guards de sesión (`TenantUserSessionGuard`), contexto de inquilino (`TenantContextGuard`), RBAC (`TenantAuthorized("channels.read")`) y habilitación de módulo (`RequireEntitlements("module.messaging.basic")`).
     - Configura cabeceras SSE estándar: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
     - Suscribe el flujo mediante `TenantChannelsService.events(context)`.
3. **Integración Frontend React / Next.js (`apps/web/app/app/channels/`)**:
   - `channels-view-model.ts`: Exporta `subscribeToChannelEvents(apiBaseUrl, onEvent, onError)` utilizando la API nativa del navegador `EventSource` con `withCredentials: true`, parseando eventos de forma segura y retornando función de limpieza.
   - `channel-qr-modal.tsx`: Escucha eventos SSE durante el emparejamiento; ante `channel.qr_generated` actualiza instantáneamente el código QR y su temporizador TTL de 30 segundos; ante `channel.connected` transiciona de inmediato a la pantalla de éxito cerrando el sondeo de respaldo.
   - `channels-client.tsx`: Mantiene suscripción SSE a nivel de vista para actualizar dinámicamente el listado de canales (estados, números de teléfono y badges de salud) y disparar notificaciones emergentes (toasts) ante reconexiones, desconexiones o conexiones exitosas.
4. **Seguridad e Invariantes Multi-inquilino**:
   - Filtrado estricto por `tenantId`: los clientes de un inquilino jamás reciben eventos o telemetría de otros inquilinos.
   - Los eventos SSE no transmiten secretos, credenciales crudas ni tokens encriptados.
   - Cierre limpio de sockets y limpieza de temporizadores al desmontar componentes o desconectar clientes.

## Decision

1. **Alineación con el Patrón SSE Establecido**:
   - Se utiliza el mismo patrón reactivo probado en `inbox-realtime.service.ts` (RxJS Observable + Outbox Bridge) garantizando consistencia arquitectónica en todo el backend NestJS.
2. **Resiliencia Híbrida en UI**:
   - La interfaz web prioriza las notificaciones push por SSE para una experiencia de usuario instantánea y fluida, manteniendo sondeos pasivos de respaldo en caso de desconexiones transitorias de red.

## Backlog Scope and Story Reconciliation

- E09-S04 (**WhatsApp Channel Realtime Events Stream, Live QR Updates & Alerting**) queda implementada y verificada.
- **Epic 09 (WhatsApp Channel Management)** queda **100% COMPLETADA** en todas sus historias (E09-S01 a E09-S04).
- Las siguientes historias del roadmap abordarán Epic 10 (AI Gateway & Automated Triage Integration).
