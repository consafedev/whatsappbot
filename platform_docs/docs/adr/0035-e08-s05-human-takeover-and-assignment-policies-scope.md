# ADR-0035 — E08-S05 Human Takeover and Assignment Routing Policies Scope

- Status: Accepted
- Date: 2026-08-26
- Owners: Platform Engineering

## Context

La historia `E08-S05` continúa la construcción del motor de reglas determinista y la gobernanza de conversaciones (Epic 08 — Rules Engine & Deterministic Automation) conforme a ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0006 (Own Rules Engine, No n8n in Core), ADR-0009 (Rules First, AI Optional), ADR-0012 (UUIDv7 Primary Keys), ADR-0013 (Transactional Outbox Pattern), ADR-0031 (Rules Engine Foundation Scope), ADR-0032 (Rule Condition Evaluator Scope), ADR-0033 (Rule Action Execution Engine Scope) y ADR-0034 (Automation Triggers and Inbound Bridge Scope).

Una vez orquestada la evaluación y disparo determinista de reglas sobre mensajes entrantes (`E08-S04`), el sistema requería:
1. **Transición y Pausa de Automatización (Human Takeover)**:
   - Capacidad manual y automática de pausar las respuestas de bots/automatizaciones cuando un agente humano interviene en la conversación.
   - Modos soportados en la entidad `Conversation`: `AUTO`, `HUMAN`, `ASSISTED`, `MONITOR`.
   - Takeover automático cuando un operador envía un mensaje desde la bandeja del dashboard (`outbound-conversation-message-manager`) o cuando se detecta un mensaje humano escrito directamente desde un dispositivo móvil con WhatsApp Web/App (`external-human-message-manager`).
   - Almacenamiento no destructivo del momento y motivo de la pausa (`automationPausedAt`, `automationPausedReason`) dentro del campo `metadata` JSONB de `Conversation`.
   - Registro de auditoría (`AuditLog` con acción `conversation.automation_mode_updated`) y evento de dominio (`DomainEventOutbox` con tipo `conversation.automation_mode_updated`).
2. **Motor de Políticas de Asignación y Enrutamiento (Assignment Policies)**:
   - Algoritmos deterministas de auto-asignación:
     - `ROUND_ROBIN`: Rotación equitativa entre operadores activos elegibles.
     - `LEAST_BUSY`: Selección del operador con menor carga de conversaciones abiertas.
     - `STICKY_AGENT`: Fidelización con el último operador que atendió al mismo contacto.
   - Filtrado opcional por unidad organizacional (`assignedUnitId` / `organizationUnitId`).
   - Ejecución atómica y transaccional mediante `InboxMutationManager.assignConversation`.
3. **Exposición en API REST**:
   - `PATCH /api/v1/inbox/conversations/:conversationId/automation-mode` para cambio de modo con control RBAC (`conversations.assign`).
   - `POST /api/v1/inbox/conversations/:conversationId/auto-assign` para resolución y aplicación de políticas de enrutamiento con control RBAC (`conversations.assign`).
4. **Aislamiento Multi-Inquilino y Atomicidad**:
   - Bloqueo consultivo `lockConversationInTransaction(tx, tenantId, channelAccountId, contactId)` para evitar condiciones de carrera.
   - Falla cerrada (404/Forbidden) ante accesos cruzados entre inquilinos o falta de permisos/derechos de módulo.

## Decision

1. **Gestor de Takeover (`TakeoverManager`)**:
   - Implementado en `packages/database/src/takeover-manager.ts` con la función principal:
     ```typescript
     export async function setConversationAutomationMode(
       tenantContext: TenantContext,
       conversationId: string,
       actorId: string,
       mode: ConversationAutomationMode,
       reason?: string,
       requestId?: string,
       database?: TakeoverManagerDatabase,
     ): Promise<Conversation>
     ```
   - Al pasar a `HUMAN`, `ASSISTED` o `MONITOR`, registra `automationPausedAt = new Date().toISOString()` y `automationPausedReason = reason ?? "agent_takeover"` en el JSON de `metadata`.
   - Al regresar a `AUTO`, limpia `automationPausedAt = null` y `automationPausedReason = null`.
   - Emite registros en `AuditLog` y eventos en `DomainEventOutbox`.

2. **Gatillos Automáticos de Takeover**:
   - En `outbound-conversation-message-manager.ts`: Cuando un usuario operador autenticado (`actorUserId !== null`) envía un mensaje en una conversación que se encontraba en modo `AUTO`, se actualiza automáticamente el modo a `HUMAN` con motivo `agent_reply`.
   - En `external-human-message-manager.ts`: Cuando un mensaje entrante tiene origen de dispositivo humano externo (`origin === "human_external_device"`), se actualiza automáticamente el modo a `HUMAN` con motivo `external_human_reply`.

3. **Motor de Políticas de Asignación (`AssignmentPolicyEngine`)**:
   - Implementado en `packages/database/src/assignment-policy-engine.ts` con:
     ```typescript
     export async function resolveAssignmentByPolicy(
       tenantContext: TenantContext,
       conversationId: string,
       policy: AssignmentPolicy,
       options?: AssignmentPolicyOptions,
       database?: AssignmentPolicyEngineDatabase,
     ): Promise<AssignmentPolicyResult>
     ```
   - Políticas soportadas: `ROUND_ROBIN`, `LEAST_BUSY`, `STICKY_AGENT`.
   - Filtra operadores activos del inquilino y opcionalmente restringe a aquellos con asignación de rol en la unidad organizacional especificada (`options.unitId`).

4. **Integración en API REST**:
   - Endpoints agregados en `apps/api/src/inbox.ts` y registrados en `apps/api/src/app.ts`:
     - `PATCH /api/v1/inbox/conversations/:conversationId/automation-mode`
     - `POST /api/v1/inbox/conversations/:conversationId/auto-assign`
   - Protegidos con guardas `TenantUserSessionGuard`, `TenantContextGuard`, `TenantPermissionGuard` (permiso `conversations.assign`) y `TenantEntitlementGuard` (`module.messaging.basic`, `module.crm_lite`).

## Backlog Scope and Story Naming Reconciliation

- En el backlog histórico (`platform_docs/DATA_MODEL_ERD_MVP_BACKLOG.md`), `E08-S05` figuraba como *Human takeover y temporizadores de inactividad*.
- Se consolidó el alcance formal de `E08-S05` bajo el nombre canónico **Human Takeover and Assignment Routing Policies**:
  - Implementa el gestor de modo de automatización (`TakeoverManager`) con transiciones manuales y automáticas (reply de operador y mensaje externo WhatsApp).
  - Implementa el motor de políticas de auto-asignación (`AssignmentPolicyEngine`) con `ROUND_ROBIN`, `LEAST_BUSY`, `STICKY_AGENT` y filtrado por unidad organizacional.
  - Implementa los endpoints REST en `apps/api/src/inbox.ts` con validación RBAC y multi-inquilino.
  - Las plantillas externas y el bridge HSM se reservan para `E08-S06` (*Outbound Template Automation & HSM Bridge*).
  - La interfaz gráfica de usuario para el motor de reglas se reserva para `E08-S07` (*Rules Engine Management UI*).
