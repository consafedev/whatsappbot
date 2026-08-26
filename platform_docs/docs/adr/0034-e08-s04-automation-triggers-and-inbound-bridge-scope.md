# ADR-0034 — E08-S04 Automation Triggers & Inbound Event Dispatcher Bridge Scope

- Status: Accepted
- Date: 2026-08-25
- Owners: Platform Engineering

## Context

La historia `E08-S04` continúa la construcción del motor de reglas determinista interno (Epic 08 — Rules Engine & Deterministic Automation) conforme a ADR-0006 (Own Rules Engine, No n8n in Core), ADR-0009 (Rules First, AI Optional), ADR-0012 (UUIDv7 Primary Keys), ADR-0013 (Transactional Outbox Pattern), ADR-0031 (Rules Engine Foundation Scope), ADR-0032 (Rule Condition Evaluator Scope) y ADR-0033 (Rule Action Execution Engine Scope).

Una vez que disponemos del catálogo de reglas (`E08-S01`), el evaluador de condiciones (`E08-S02`) y el ejecutor de acciones (`E08-S03`), el sistema requería un orquestador determinista de triggers y un puente de integración directo desde el flujo de ingesta de eventos de mensajería entrante (`inbound-event-dispatcher`).

Los requerimientos fundamentales para este componente son:
1. **Orden Determinista de Prioridad**: Evaluación de reglas activas ordenadas estrictamente por `priority ASC, createdAt DESC`.
2. **Modos de Ejecución**: Soporte para `first_match_stop` (detiene la evaluación tras la primera regla coincidente) y `evaluate_all` (continúa evaluando y ejecutando subsecuentes reglas coincidentes).
3. **Ventanas de Cooldown**: Descarte de reglas cuya última ejecución haya ocurrido dentro del tiempo configurado en `cooldownSeconds`.
4. **Filtros de Canal y Unidad Organizacional**: Aplicación precisa de reglas según la cuenta de canal (`channelAccountId`) o unidad asignada (`organizationUnitId`).
5. **Guardas de Modo de Automatización (`HUMAN` / `MONITOR`)**: Cuando una conversación se encuentra en modo `HUMAN` o `MONITOR`, los bots y automatizaciones no deben interferir ni enviar respuestas automáticas, a menos que la regla tenga habilitada la bandera `forceEvaluation` o `ignoreConversationMode`.
6. **Puente con Despachador de Eventos Entrantes**: Disparo automático de triggers `ON_CONVERSATION_CREATED` (si la conversación es nueva) y `ON_MESSAGE_RECEIVED` al recibir un mensaje del cliente, degradando con gracia si el inquilino no tiene contratado `module.automation.basic`.
7. **Aislamiento Multi-Inquilino y Atomicidad**: Validación de inquilino operativo y derecho al módulo en cada despacho, asegurando que un mensaje del Tenant A jamás dispare ni afecte reglas de Tenant B.

## Decision

1. **Despachador Central de Triggers (`RuleTriggerDispatcher`)**:
   Se implementó `packages/database/src/rule-trigger-dispatcher.ts` con la función principal:
   ```typescript
   export async function dispatchRuleTriggers(
     tenantContext: TenantContext,
     triggerType: RuleTriggerType,
     context: RuleExecutionContext,
     database: RuleTriggerDispatcherDatabase,
     metadata?: RuleMutationMetadata,
   ): Promise<RuleTriggerDispatchResult>
   ```
   - Recupera las reglas con `status: "active"`, `tenantId`, `triggerType` ordenadas por `priority: "asc", createdAt: "desc"`.
   - Evalúa filtros de canal, unidad organizacional y cooldown.
   - Si la conversación está en modo `HUMAN` o `MONITOR`, salta las reglas que no fuercen la evaluación.
   - Evalúa las condiciones vía `evaluateRuleConditions`.
   - Ejecuta las acciones vía `executeRuleActions` dentro de su transacción atómica.
   - Si la regla coincidente tiene `executionMode: "first_match_stop"`, concluye el bucle de inmediato.

2. **Puente en el Despachador Inbound (`InboundEventDispatcher`)**:
   En `packages/database/src/inbound-event-dispatcher.ts`:
   - Al procesar un evento de mensaje entrante de cliente (`MESSAGE_RECEIVED` y `fromMe: false`), se construye el `RuleExecutionContext` tipado (con metadatos de canal, contacto, conversación y mensaje).
   - Si la conversación es nueva (`isNewConversation: true`), se invoca primero `dispatchRuleTriggers(tenant, "ON_CONVERSATION_CREATED", context, ...)`.
   - Seguidamente se invoca `dispatchRuleTriggers(tenant, "ON_MESSAGE_RECEIVED", context, ...)`.
   - Captura y silencia con elegancia `TenantModuleEntitlementRequiredError` para inquilinos que no tengan activo `module.automation.basic`, garantizando que la ingesta del mensaje y la conversación continúen operando con normalidad.

3. **Trazabilidad en Resultados de Ingesta**:
   - `InboundEventDispatchResult` (en su variante `kind: "inbound"`) expone opcionalmente `ruleDispatchResults: RuleTriggerDispatchResult[]` con el detalle de reglas evaluadas, reglas ejecutadas y resultados de las mutaciones aplicadas.

4. **Identificación de Nuevas Conversaciones y Normalización de Teléfonos**:
   - `conversation-manager.ts` (`resolveConversationForContactInTransaction`) retorna `isNew: true` únicamente cuando se crea un nuevo registro en la tabla `conversation`.
   - `inbound-message-manager.ts` propaga `isNewConversation: boolean` en `InboundMessagePersistResult`.
   - La normalización canónica E.164 (`normalizePhoneNumber`) garantiza la correspondencia exacta de contactos y conversaciones existentes sin colisiones de formato.

## Backlog Scope and Story Naming Reconciliation

- En el backlog histórico (`platform_docs/DATA_MODEL_ERD_MVP_BACKLOG.md`), `E08-S04` figuraba como *Triggers de inbound*.
- Se consolidó el alcance formal de `E08-S04` bajo el nombre canónico **Automation Triggers & Inbound Event Dispatcher Bridge**:
  - Implementa el motor central despachador de triggers de reglas deterministas con prioridad, cooldown, guardas de modo de automatización y short-circuiting.
  - Implementa el puente directo de despacho en el ciclo de vida de eventos entrantes de webhook/mensajería.
  - Las políticas de takeover humano y temporizadores de inactividad se reservan para `E08-S05` (*Human Takeover & Assignment Routing Policies*).
  - La sincronización con plantillas externas de WhatsApp Cloud API se reserva para `E08-S06` (*Outbound Template Automation & HSM Bridge*).
  - La interfaz gráfica de usuario para gestión y prueba de reglas se reserva para `E08-S07` (*Rules Engine Management UI*).
