# ADR-0033 — E08-S03 Rule Action Execution Engine & Mutation Pipeline Scope

- Status: Accepted
- Date: 2026-08-25
- Owners: Platform Engineering

## Context

La historia `E08-S03` continúa la construcción del motor de reglas determinista interno (Epic 08 — Rules Engine & Deterministic Automation) conforme a ADR-0006 (Own Rules Engine, No n8n in Core), ADR-0009 (Rules First, AI Optional), ADR-0012 (UUIDv7 Primary Keys), ADR-0013 (Transactional Outbox Pattern), ADR-0031 (Rules Engine Foundation Scope) y ADR-0032 (Rule Condition Evaluator Scope).

Una vez que una regla activa evalúa sus condiciones satisfactoriamente (vía `evaluateRuleConditions` de `E08-S02`), el sistema debe ejecutar el pipeline de acciones configuradas (mutaciones en entidades del dominio como conversaciones, contactos, mensajes salientes y asignaciones). Esta ejecución debe cumplir estrictamente con:
1. Aislamiento multi-inquilino absoluto (Tenant A jamás puede mutar entidades de Tenant B).
2. Atomicidad transaccional completa (PostgreSQL `$transaction`: si una acción falla, se revierte todo el lote).
3. Verificación de invariantes y estados de ciclo de vida (ej. transiciones válidas de conversación, canales activos, pertenencia de usuarios y unidades organizacionales al inquilino).
4. Interpolación segura de plantillas de texto sin inyección de código ni dependencias inseguras (`{{variable.path}}`).
5. Generación de registros de auditoría (`AuditLog`) y eventos de dominio transaccionales (`DomainEventOutbox`).

## Decision

1. **Catálogo Canónico de 8 Tipos de Acciones (`RULE_ACTION_TYPES`)**:
   Se implementó el ejecutor de mutaciones en `packages/database/src/rule-action-executor.ts` soportando los 8 tipos canónicos (y sus alias snake_case):
   - `SEND_MESSAGE`: Crea un `Message` (`direction: "outbound"`, `origin: "automation"`, `actorType: "system"`, `deliveryStatus: "queued"`), un `OutboundMessage` (`status: "QUEUED"`, `messageType: "text" | "image"`, `content: { text, caption, mediaUrl }`), actualiza `Conversation.lastAutomationMessageAt`, `lastOutboundAt`, `lastMessageAt`, y emite el evento de outbox `message.queued`.
   - `ASSIGN_USER`: Valida que el usuario pertenezca al inquilino y se encuentre en estado `active`, actualiza `Conversation.assignedUserId`, y emite `conversation.assigned`.
   - `ASSIGN_ORGANIZATION_UNIT`: Valida que la unidad pertenezca al inquilino, actualiza `Conversation.assignedUnitId`, y emite `conversation.assigned`.
   - `CHANGE_CONVERSATION_STATUS`: Valida transiciones permitidas según la máquina de estados (`new -> open|closed`, `open -> pending|closed`, `pending -> open|closed`, `closed -> open`), actualiza `Conversation.status` y `closedAt`, y emite `conversation.status_updated`.
   - `ADD_CONTACT_TAG`: Agrega etiquetas a `Contact.tags` de manera idempotente (sin duplicados), actualiza el contacto y emite `contact.updated`.
   - `REMOVE_CONTACT_TAG`: Remueve etiquetas de `Contact.tags` de manera idempotente, actualiza el contacto y emite `contact.updated`.
   - `SET_CONTACT_CUSTOM_ATTRIBUTE`: Fusiona pares clave/valor en el campo JSONB `Contact.customAttributes`, actualiza el contacto y emite `contact.updated`.
   - `SET_AUTOMATION_MODE`: Actualiza `Conversation.automationMode` (`AUTO`, `HUMAN`, `ASSISTED`, `MONITOR`), y emite `conversation.automation_mode_updated`.

2. **Interpolador Seguro de Plantillas (`interpolateTemplate`)**:
   - Resuelve expresiones `{{variable.path}}` (con tolerancia a espacios en blanco dentro de las llaves) aprovechando `resolveContextPath` de `E08-S02`.
   - Reemplaza por cadena vacía `""` cuando el valor es `null`, `undefined` o la ruta no existe, sin arrojar excepciones.
   - Formatea objetos y arreglos como cadenas JSON.
   - Seguridad: Cero uso de `eval()`, `Function()` o motores de plantillas externos inseguros; protección estricta contra prototype pollution.

3. **Garantías de Transaccionalidad y Rollback Atómico**:
   - `executeRuleActions(tenantContext, rule, context, database, metadata)` ejecuta todas las acciones dentro de un único bloque `$transaction(async (tx) => ...)`.
   - Si cualquier acción arroja un error (ej. transición de estado inválida, usuario no encontrado, inquilino suspendido o error de I/O), la transacción completa de PostgreSQL se aborta y se revierte atómicamente, impidiendo estados inconsistentes o mensajes huérfanos.
   - La regla ejecutada actualiza `Rule.updatedAt = now` dentro de la misma transacción, y se registra un `auditLog` y `domainEventOutbox` con el evento `rule.executed`.

4. **Validación de Invariantes y Jerarquía de Errores Tipados**:
   - `RuleActionExecutionError`: Clase base.
   - `RuleActionConversationNotFoundError`: Conversación no existe o pertenece a otro inquilino.
   - `RuleActionConversationNotWritableError`: Conversación en estado inválido para escritura.
   - `RuleActionChannelInactiveError`: Canal desconectado o inactivo.
   - `RuleActionContactNotFoundError`: Contacto no encontrado para el inquilino.
   - `RuleActionUserNotFoundError`: Usuario no encontrado o inactivo en el inquilino.
   - `RuleActionOrganizationUnitNotFoundError`: Unidad organizacional inexistente o de otro inquilino.
   - `RuleActionInvalidStateTransitionError`: Violación del ciclo de vida de la conversación.

5. **Aislamiento Multi-Inquilino (Multi-Tenancy Isolation)**:
   - Todo query y mutación (`Conversation`, `Contact`, `Message`, `OutboundMessage`, `User`, `OrganizationUnit`, `Rule`, `AuditLog`, `DomainEventOutbox`) incluye obligatoriamente `where: { tenantId }` y `data: { tenantId }`.
   - Las aserciones `assertTenantOperational` y `assertTenantModuleEntitled(tenantContext, "module.automation.basic")` se validan dentro de la transacción.

## Backlog Scope and Story Naming Reconciliation

- En el backlog histórico (`platform_docs/DATA_MODEL_ERD_MVP_BACKLOG.md`), `E08-S03` figuraba como *Actions base*.
- Se consolidó el alcance formal de `E08-S03` bajo el nombre canónico **Rule Action Execution Engine & Mutation Pipeline**:
  - Implementa el motor de ejecución atómica de mutaciones y sus 8 acciones canónicas.
  - Implementa el interpolador seguro de plantillas.
  - El puente del despachador de eventos entrantes de webhook/mensajería hacia el motor se reserva para `E08-S04` (*Automation Triggers & Inbound Webhook Event Dispatcher Bridge*).
  - Las políticas de takeover humano y temporizadores de desconexión se reservan para `E08-S05` (*Human Takeover & Assignment Routing Policies*).
  - La interfaz de usuario frontend para configuración de reglas se reserva para `E08-S07` (*Rules Engine Management UI*).
