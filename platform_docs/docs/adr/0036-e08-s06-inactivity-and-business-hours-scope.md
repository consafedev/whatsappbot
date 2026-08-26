# ADR-0036 — E08-S06 Inactivity and Business Hours Scope

- Status: Accepted
- Date: 2026-08-26
- Owners: Platform Engineering

## Context

La historia `E08-S06` avanza en la construcción del motor de reglas determinista y la gobernanza temporal de conversaciones (Epic 08 — Rules Engine & Deterministic Automation) conforme a ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0006 (Own Rules Engine, No n8n in Core), ADR-0009 (Rules First, AI Optional), ADR-0012 (UUIDv7 Primary Keys), ADR-0013 (Transactional Outbox Pattern), ADR-0031 (Rules Engine Foundation Scope), ADR-0032 (Rule Condition Evaluator Scope), ADR-0033 (Rule Action Execution Engine Scope), ADR-0034 (Automation Triggers and Inbound Bridge Scope) y ADR-0035 (Human Takeover and Assignment Routing Policies Scope).

Para complementar la gestión de automatización y atención al cliente, la plataforma requería:
1. **Evaluador de Horarios de Atención (`BusinessHoursEvaluator`)**:
   - Capacidad determinista y pura para evaluar si una interacción ocurre dentro de la ventana de atención configurada para el canal o inquilino.
   - Esquema tipado de horarios por día de la semana (`DaySchedule` 0..6), ventana de apertura/cierre (`openTime`, `closeTime` en formato 24h `HH:mm`) y exclusión de feriados (`holidays` en formato `YYYY-MM-DD`).
   - Resolución de zona horaria por inquilino/canal (`timezone`) utilizando la API nativa de internacionalización `Intl.DateTimeFormat`, con degradación defensiva y fail-safe hacia `UTC` ante zonas inválidas o corruptas.
   - Soporte de trigger de automatización fuera de horario (`ON_OUT_OF_BUSINESS_HOURS`) en el catálogo de reglas e inyección contextual de `channel.isWithinBusinessHours` en `RuleEvaluationContext`.
2. **Gestor de Inactividad y Auto-Cierre (`InactivityManager`)**:
   - Monitoreo periódico y procesamiento por lote de conversaciones inactivas con aislamiento estricto por `tenantId`:
     1. **Auto-Cierre**: Conversaciones en estado `open` o `pending` cuyo `lastMessageAt` (o `createdAt` de respaldo) supere el umbral de `inactivityMinutes`.
        - Transición atómica a `status: "closed"`, fijando `closedAt` y almacenando el motivo en `metadata.closedReason = "inactivity_timeout"`.
        - Registro atómico de auditoría `AuditLog` (`conversation.auto_closed`) y evento en outbox `DomainEventOutbox` (`conversation.status_updated`).
     2. **Liberación de Takeover (Takeover Release)**: Conversaciones pausadas en `automationMode: "HUMAN"` cuyo tiempo inactivo supere `releaseTakeoverMinutes`.
        - Restitución a `automationMode: "AUTO"`, limpiando `automationPausedAt = null` y fijando `automationPausedReason = "inactivity_release"`.
        - Registro de auditoría `AuditLog` (`conversation.automation_mode_updated`) y evento outbox (`conversation.automation_mode_updated`).
3. **API REST / Worker Trigger Endpoint**:
   - `POST /api/v1/inbox/conversations/process-inactivity` con validación RBAC (`conversations.assign`), `TenantEntitlementGuard` (`module.messaging.basic`, `module.crm_lite`) y DTO fuertemente tipado.
4. **Aislamiento Multi-Inquilino y Atomicidad**:
   - Serialización de mutaciones mediante bloqueo consultivo PostgreSQL `lockConversationInTransaction` para evitar carreras entre el despachador de mensajes y el proceso de auto-cierre.

## Decision

1. **Evaluador de Horarios de Atención (`business-hours-evaluator.ts`)**:
   - Implementado como función pura en `packages/database/src/business-hours-evaluator.ts`:
     ```typescript
     export function isWithinBusinessHours(
       config: BusinessHoursConfig | null | undefined,
       now?: Date,
     ): boolean
     ```
   - Si `config` es nulo o `schedules` está vacío, retorna `true` (horario continuo 24/7).
   - Valida la pertenencia a la lista de feriados en la fecha local del inquilino antes de consultar el día de la semana.
   - Admite ventanas estándar diurnas (`openTime < closeTime`) y ventanas nocturnas cruzadas (`closeTime < openTime`).

2. **Gestor de Inactividad (`inactivity-manager.ts`)**:
   - Implementado en `packages/database/src/inactivity-manager.ts` con la función central `processInactivityTimeouts` y la fábrica `createInactivityManager`.
   - Garantiza aislamiento multi-inquilino estricto mediante filtrado obligatorio por `tenantId`.
   - Emite registros auditables y eventos outbox de forma transaccional.

3. **Integración en API REST**:
   - Endpoint expuesto en `apps/api/src/inbox.ts`:
     - `POST /api/v1/inbox/conversations/process-inactivity`
   - Requiere sesión de inquilino activa, permiso `conversations.assign` y derechos efectivos sobre `module.messaging.basic` y `module.crm_lite`.

## Backlog Scope and Story Naming Reconciliation

- En el backlog histórico (`platform_docs/DATA_MODEL_ERD_MVP_BACKLOG.md`), la gestión de horarios y temporizadores de inactividad se distribuye como parte de las capacidades deterministas de gobernanza de conversaciones de Epic 08.
- La historia `E08-S06` consolida formalmente el nombre canónico **Inactivity Timers, Auto-Close and Business Hours Schedules**:
  - Implementa el evaluador de horarios de atención con soporte de zonas horarias IANA, días feriados y turnos nocturnos.
  - Implementa el gestor de inactividad con auto-cierre y liberación de takeover.
  - Expone el endpoint de procesamiento periódico en la API REST de Inbox.
- La siguiente historia `E08-S07` implementará la consola de usuario frontend para la administración y configuración visual del motor de reglas (`Rules Engine Web UI Management & Console Client`).
