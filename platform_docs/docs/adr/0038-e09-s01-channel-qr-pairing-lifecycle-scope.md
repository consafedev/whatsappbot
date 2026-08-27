# ADR-0038 — E09-S01 WhatsApp Channel QR Pairing Lifecycle & Session API Scope

- Status: Accepted
- Date: 2026-08-26
- Owners: Platform Engineering

## Context

La historia `E09-S01` inicia la implementación de la épica de gestión de canales de comunicación (Epic 09 — Channel Management) conforme a ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0004 (Messaging Provider Abstraction & Baileys), ADR-0012 (UUIDv7 & Timestamp Conventions) y ADR-0013 (Transactional Outbox).

La plataforma requería un gestor determinista del ciclo de vida de emparejamiento por código QR para canales de WhatsApp, garantizando:
1. **Máquina de estados de conexión y emparejamiento QR**:
   - Estados canónicos: `DISCONNECTED -> CONNECTING -> QR_READY -> CONNECTED`.
   - Transición de inicio de emparejamiento (`initiateChannelPairing`): valida operatividad del inquilino y derecho al módulo `module.messaging.basic`, comprueba que no se encuentre ya conectado (`ChannelAlreadyConnectedError`), fija estado `CONNECTING`, emite evento `channel.pairing_requested` y registra auditoría `channel.pairing_initiated`.
   - Transición de rotación/generación de QR (`updateChannelQrCode`): actualiza estado a `QR_READY`, persiste el código QR en `settings.latestQrRaw` y fecha de generación `settings.qrGeneratedAt`, y emite evento `channel.qr_generated`.
   - Transición de confirmación de conexión (`confirmChannelConnected`): actualiza estado a `CONNECTED`, asigna `phoneNumber`, `phoneNumberUniqueKey` para unicidad activa, opcionalmente credenciales cifradas `credentialsCiphertext`, limpia el código QR temporal, fija `lastConnectedAt`, emite evento `channel.connected` y registra auditoría `channel.connected`.
   - Transición de desconexión manual (`disconnectChannel`): actualiza estado a `DISCONNECTED`, limpia el código QR, fija `lastDisconnectedAt` y motivo de desconexión `disconnectReason`, emite evento `channel.disconnected` y registra auditoría `channel.disconnected`.
2. **Endpoints REST Seguros en API (`apps/api/src/tenant-channels.ts`)**:
   - `POST /api/v1/channels/:channelAccountId/pair/initiate`: requiere `channels.manage`, responde 200 OK con `{ status: "CONNECTING", channelAccountId, ... }`.
   - `GET /api/v1/channels/:channelAccountId/pair/qr`: requiere `channels.read`, devuelve `{ status, qrRaw, qrGeneratedAt, isExpired }` con TTL estricto de 30 segundos (`30_000 ms`), devolviendo `qrRaw: null` e `isExpired: true` cuando el QR ha expirado. Jamás expone claves ni credenciales cifradas.
   - `POST /api/v1/channels/:channelAccountId/disconnect`: requiere `channels.manage`, responde 200 OK con `{ status: "DISCONNECTED", channelAccountId, ... }`.
3. **Aislamiento Multi-inquilino Estricto**:
   - Toda consulta y mutación filtra estrictamente por `where: { tenantId }`.
   - Intentos de lectura o mutación cruzada entre inquilinos (Tenant B hacia Tenant A) devuelven 404 estricto (`ChannelAccountNotFoundError`).

## Decision

1. **Gestor de Emparejamiento en `packages/database` (`channel-pairing-manager.ts`)**:
   - Se implementó `createChannelPairingManager` con funciones puras transaccionales y exportación canónica en `@whatsapp-platform/database`.
   - Mutaciones atómicas con emisión de eventos en `DomainEventOutbox` y registros en `AuditLog`.
2. **Exposición en API REST y Control de Acceso**:
   - Endpoints montados en `TenantChannelsController` protegidos con la cadena ordenada de guardas: `TenantUserSessionGuard`, `TenantContextGuard`, `TenantPermissionGuard` y `TenantEntitlementGuard` (`module.messaging.basic`).
   - Mapeo de errores de dominio a códigos HTTP apropiados: 404 para canal no encontrado / cross-tenant, 409 para `CHANNEL_ALREADY_CONNECTED`, 403 para `ENTITLEMENT_REQUIRED`.
3. **Seguridad de Credenciales y TTL de QR**:
   - Los datos sensibles de autenticación permanecen exclusivamente en `credentialsCiphertext` y nunca se exponen en las respuestas de endpoints públicos o de consulta de QR.
   - El TTL de los códigos QR se calcula en tiempo real con ventana de validez de 30 segundos.

## Backlog Scope and Story Reconciliation

- `E09-S01` (**WhatsApp Channel QR Pairing Lifecycle & Session API**) queda implementada y verificada contra PostgreSQL real.
- Las historias siguientes de Epic 09 abordarán:
  - `E09-S02`: Channel Health Checks & Connection Monitor Worker.
  - `E09-S03`: Channel Management Web UI & QR Pairing Modal.
