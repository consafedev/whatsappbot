# ADR-0046 — E10-S05 Autonomous WhatsApp Agent, Triage Policy & Knowledge Directives Scope

- Status: Accepted
- Date: 2026-09-02
- Owners: Platform Engineering

## Context

La historia E10-S05 continúa la implementación de **Epic 10 (AI Gateway Foundation)** conectando el motor RAG, el enrutador resiliente de modelos, la base de conocimiento y los mecanismos de traspaso y coexistencia con operadores humanos en un agente autónomo de WhatsApp integrado en la cadena de procesamiento de mensajes entrantes (*inbound pipeline*).

En estricto cumplimiento de ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0009 (Rules-First, AI-Optional), ADR-0010 (Modules & Entitlements), ADR-0035 (Human Takeover) y ADR-0042 a ADR-0045:

1. **Configuración del Agente Autónomo (`TenantAiAgentConfig`)**:
   - Modelo persistido en PostgreSQL con relación 1:1 con `Tenant`:
     - `automationMode`: Modos de automatización `"RULES_ONLY"`, `"HYBRID_RULES_AI"` (predeterminado), y `"FULL_AI"`.
     - `systemDirectives`: Instrucciones y directivas de comportamiento y tono de la IA.
     - `virtualAliasKey`: Alias virtual a invocar (predeterminado `"platform-smart"`).
     - `minConfidenceScore`: Umbral mínimo de similitud para considerar fragmentos del RAG (predeterminado `0.70`).
     - `humanHandoffKeywords`: Palabras clave en JSON array (`["humano", "asesor", "persona", "agente", "ayuda"]`) que gatillan traspaso a operador.
     - `outOfHoursReply`: Mensaje configurable para horarios inhábiles.
     - `isEnabled`: Flag booleano de activación explícita (predeterminado `false`).

2. **Orquestador del Agente de IA (`packages/database/src/ai-agent-dispatcher.ts`)**:
   - `processInboundAiTurn`:
     - Valida `assertTenantOperational` y el derecho de módulo `module.ai`.
     - Falla cerrada retornando `{ handled: false, reason: "disabled" | "rules_only" }` si el agente no está habilitado o está en modo solo reglas.
     - Coexistencia con Takeover Humano: Si la conversación se encuentra en `automationMode === "HUMAN"`, `status === "TAKEOVER"`, o con ventana de pausa activa (`humanTakeoverUntil > now`), la IA se abstiene de responder (`handled: false, reason: "human_takeover"`).
     - Detección de Intención de Traspaso (Human Handoff): Si el mensaje entrante contiene keywords de traspaso, conmuta la conversación a `HUMAN`, emite `conversation.takeover_requested` en `DomainEventOutbox`, y despacha un mensaje informativo al contacto sin generar respuesta de IA.
     - Generación de Respuesta con RAG:
       - Carga el historial conversacional reciente (últimos 6 mensajes).
       - Genera embedding de la consulta y recupera los fragmentos semánticos relevantes del inquilino mediante `searchKnowledgeChunks`.
       - Formatea e inyecta las citas en el prompt del sistema.
       - Enruta y ejecuta el completado con `AiResilientRouter`.
       - Encola mensaje saliente atómico en `outboundMessage` vía `OutboundConversationMessageManager`, marcado con `actorType: "AI_BOT"` y `metadata: { senderType: "AI_BOT", citations }`.
       - Registra el consumo de tokens y latencia en `AiUsageLog` con propósito `"autonomous_agent"`.

3. **Integración en Cadena Inbound (`packages/database/src/inbound-event-dispatcher.ts`)**:
   - Cadena de procesamiento:
     1. Ingesta y persistencia del mensaje del contacto.
     2. Disparo y evaluación de reglas deterministas (`rule-trigger-dispatcher`).
     3. Si las reglas deterministas no enviaron un mensaje (`SEND_MESSAGE`) y el inquilino cuenta con el agente de IA habilitado en modo `HYBRID_RULES_AI` o `FULL_AI`, se delega a `processInboundAiTurn`.

4. **Endpoints REST de Configuración (`apps/api/src/ai-agent-config.ts`)**:
   - `GET /api/v1/ai/agent/config`: Retorna la configuración del agente del inquilino.
   - `PUT /api/v1/ai/agent/config`: Actualiza los parámetros de configuración.
   - Protegidos por guards de sesión (`TenantUserSessionGuard`), contexto de inquilino (`TenantContextGuard`), permiso RBAC `ai.settings.manage` (`TenantPermissionGuard`) y módulo `module.ai` (`TenantEntitlementGuard`).

## Decision

1. **Jerarquía Coexistente Rules-First, AI-Optional**:
   - El motor de reglas determinista posee prioridad absoluta sobre el agente autónomo de IA. La IA solo interviene cuando las reglas no capturan el mensaje o no envían una respuesta directa.
2. **Prioridad Inviolable del Agente Humano**:
   - Ante cualquier solicitud explícita de hablar con una persona o intervención de un operador, la IA cede el control de forma inmediata y persistente.
3. **Aislamiento Multi-inquilino y Atribución AI_BOT**:
   - Todo mensaje generado por la automatización de IA se registra explícitamente con `actorType: "AI_BOT"` y `senderType: "AI_BOT"`, garantizando transparencia en la bandeja compartida de agentes y aislamiento estricto entre inquilinos.

## Backlog Scope and Story Reconciliation

- E10-S05 (**Autonomous WhatsApp Agent, Triage Policy & Knowledge Directives**) queda implementada y verificada.
- La siguiente historia será E10-S06 (**AI Console, Knowledge Base Management & Agent Settings Web UI**).
