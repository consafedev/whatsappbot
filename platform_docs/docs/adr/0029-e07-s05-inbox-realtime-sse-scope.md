# ADR-0029 — E07-S05 Inbox realtime push through Server-Sent Events

- Status: Accepted
- Date: 2026-08-24
- Owners: Platform Engineering

## Context

E07-S05 tiene una discrepancia documental que no se resuelve cambiando
silenciosamente nombres o alcance. El backlog corto conserva `E07-S05
Automation mode` y enumera `AUTO|ASSISTED|HUMAN|MONITOR`, mientras que el
ADR-0028 aprobado más reciente, `STATUS.md` y el prompt de esta story
identifican E07-S05 como Inbox Realtime Push. La jerarquía del skill del
proyecto da precedencia al ADR aprobado más reciente que cambia explícitamente
la decisión; por eso esta story implementa realtime y no muta `automationMode`.
El backlog no se reescribe.

El prompt también propone `TenantAuthGuard`. El código y los ADR anteriores
usan la cadena real `TenantUserSessionGuard`, `TenantContextGuard`,
`TenantPermissionGuard` y `TenantEntitlementGuard`; no se inventa un alias ni
un guard paralelo.

## Decision

- Exponer `GET /api/v1/inbox/events` como Server-Sent Events. No se implementan
  WebSockets bidireccionales, rooms custom ni componentes de frontend en esta
  story.
- Proteger el stream con `conversations.read`, `module.messaging.basic` y
  `module.crm_lite`, además de la cadena ordenada de autenticación, contexto,
  RBAC y entitlement existente.
- Mantener PostgreSQL y `DomainEventOutbox` como fuente de verdad. Un bridge de
  lectura privilegiado dentro del API consulta únicamente los siete tipos de
  eventos de Inbox posteriores a un cursor en memoria y los entrega al
  `InboxRealtimeBroadcaster`. El bridge no escribe `publishedAt`, `attempts` ni
  `lastError`, porque no es el publisher durable del Outbox y no debe competir
  con el publisher futuro previsto por ADR-0013.
- El broadcaster mantiene listeners en memoria por `tenantId`, publica sólo a
  los listeners del tenant indicado y elimina el listener al cancelar el
  Observable. El heartbeat es un evento `ping` con `{}` cada 20 segundos.
- El stream transforma los eventos de Outbox a estos tipos SSE:
  `inbox.message_received`, `inbox.message_sent`,
  `inbox.echo_reconciled`, `inbox.external_human_detected`,
  `inbox.delivery_status_updated`, `inbox.conversation_status_updated` y
  `inbox.conversation_assigned`.
- La proyección pública incluye sólo IDs de aggregate/mensaje/conversación,
  estados, dirección, origen, asignación, actor y timestamps necesarios para
  refrescar Inbox. Omite `tenantId`, teléfonos, texto, URLs de media,
  `providerMessageId`, credenciales y cualquier payload raw.
- El cursor inicia en el último evento existente al levantar el API; por tanto
  el stream es live-only y no ofrece replay histórico. Los eventos confirmados
  después de ese punto se procesan en orden `(occurredAt, id)`. Un payload
  inválido se descarta de la proyección pública y no se fabrica una carga útil.
- No se requiere migration ni cambio de schema.

## Security and tenant isolation

El tenant del stream se deriva exclusivamente del `TenantContext` creado desde
la sesión autenticada. El broadcaster recibe el tenant como clave interna y
nunca mezcla listeners entre tenants. La autorización se revalida por request
desde PostgreSQL; la UI no es una frontera de seguridad.

## Alternatives considered

- Emitir directamente desde cada controller: rechazado porque no cubriría
  inbound, echo, detección de humano externo ni delivery status producidos por
  otros pipelines.
- Marcar el Outbox como publicado desde el bridge SSE: rechazado porque
  alteraría bookkeeping durable y competiría con el publisher futuro.
- Usar Redis Pub/Sub o BullMQ para este stream: diferido; el scope exige un bus
  en memoria y el bridge actual necesita conservar la atomicidad Outbox sin
  agregar un adapter de infraestructura no existente.
- Implementar `Automation mode` en esta story: diferido conforme al ADR-0028,
  `STATUS.md` y el alcance explícito de realtime de E07-S05.

## Verification

La suite dedicada cubre publicación y suscripción, aislamiento A/B, heartbeat y
limpieza de listeners. La suite API cubre headers SSE, guards de RBAC y
entitlement, entrega de un cambio de estado al tenant correcto y ausencia de
campos sensibles en el evento.
