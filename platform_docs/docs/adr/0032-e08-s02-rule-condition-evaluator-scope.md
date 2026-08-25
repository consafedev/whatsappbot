# ADR-0032 — E08-S02 Rule Condition Evaluator & Predicate Execution Engine Scope

- Status: Accepted
- Date: 2026-08-25
- Owners: Platform Engineering

## Context

La historia `E08-S02` continúa la construcción del motor de reglas determinista interno (Epic 08 — Rules Engine & Deterministic Automation) conforme a ADR-0006 (Own Rules Engine, No n8n in Core), ADR-0009 (Rules First, AI Optional) y ADR-0031 (Rules Engine Foundation Scope).

Para evaluar reglas frente a eventos de mensajería entrantes, transiciones de estado de conversaciones, asignaciones y metadatos de contactos, el sistema requiere un evaluador de predicados puro, determinista, en memoria (sin I/O de red ni mutaciones de base de datos) y fuertemente tipado. Además, el evaluador debe proteger el hilo de ejecución contra ataques de denegación de servicio por expresiones regulares (ReDoS) y soportar la resolución segura de propiedades anidadas y cálculo de cooldown/frecuencia de ejecución.

## Decision

1. **Contexto de Evaluación Tipado (`RuleEvaluationContext`)**:
   - Se definió la interfaz `RuleEvaluationContext` en `packages/database/src/rule-condition-evaluator.ts` que normaliza las entidades contextuales:
     - `message`: `textBody`, `mediaType`, `origin`, `direction`.
     - `contact`: `name`, `phoneNumber`, `tags`, `customAttributes`.
     - `conversation`: `status`, `assignedUserId`, `assignedUnitId`, `unreadCount`.
     - `channel`: `channelAccountId`, `providerType`.
     - `now`: `Date` de evaluación.

2. **Gramática de Predicados y Catálogo Exhaustivo de Operadores (`RuleOperator`)**:
   - Se formalizó el árbol de condiciones con `RuleCondition` (`field`, `operator`, `value`) y `RuleConditionGroup` (`logicalOperator: "AND" | "OR"`, `conditions: (RuleCondition | RuleConditionGroup)[]`).
   - Catálogo de operadores soportados:
     - **Texto / String**: `EQUALS`, `NOT_EQUALS`, `CONTAINS`, `NOT_CONTAINS`, `STARTS_WITH`, `ENDS_WITH`, `MATCHES_REGEX`, `IS_EMPTY`, `IS_NOT_EMPTY`.
     - **Numérico**: `GREATER_THAN`, `GREATER_THAN_OR_EQUAL`, `LESS_THAN`, `LESS_THAN_OR_EQUAL`, `NUMERIC_EQUALS`, `NUMERIC_NOT_EQUALS`.
     - **Listas / Arrays / Tags**: `IN`, `NOT_IN`, `CONTAINS_ANY`, `CONTAINS_ALL`, `ARRAY_EMPTY`, `ARRAY_NOT_EMPTY`.
     - **Existencia / Booleans / Nulos**: `IS_NULL`, `IS_NOT_NULL`, `EXISTS`, `IS_TRUE`, `IS_FALSE`.

3. **Resolución Segura de Propiedades Anidadas (`resolveContextPath`)**:
   - Soporte para notación por puntos (ej. `contact.customAttributes.planTier`, `conversation.unreadCount`).
   - Protección contra prototype pollution bloqueando segmentos prohibidos (`__proto__`, `constructor`, `prototype`).
   - Retorno seguro de `undefined` ante rutas inexistentes o intermediarios nulos sin lanzar excepciones no controladas.

4. **Evaluación de Árboles con Cortocircuito Lógico (`evaluateRuleConditions`)**:
   - Función pura y determinista en memoria.
   - Evaluación recursiva de grupos `AND` (cortocircuito al primer `false`) y `OR` (cortocircuito al primer `true`).
   - Si la lista o grupo de condiciones está vacío, retorna `true` (regla catch-all / comodín).

5. **Protección contra ReDoS y Seguridad de Ejecución**:
   - Longitud máxima del patrón de regex: 100 caracteres (`MAX_REGEX_PATTERN_LENGTH = 100`).
   - Longitud máxima del texto evaluado: 10,000 caracteres (`MAX_REGEX_INPUT_LENGTH = 10_000`).
   - Análisis estático previo de patrones para detectar y rechazar cuantificadores anidados y alternaciones superpuestas peligrosas (ej. `(a+)+$`, `(a*)*$`, `(a|a)+$`, `(x+x+)+y`).
   - Prohibición absoluta de `eval()` o `new Function()`.
   - Manejo seguro de sintaxis regex inválida retornando `false` sin emitir excepciones que expongan PII.

6. **Evaluador de Cooldown / Frecuencia (`isRuleInCooldown`)**:
   - `isRuleInCooldown(lastExecutedAt, cooldownSeconds, now)`:
     - Retorna `false` si `cooldownSeconds <= 0` o `lastExecutedAt === null`.
     - Retorna `true` si `(now - lastExecutedAt) < cooldownSeconds * 1000`.
     - Retorna `false` si el intervalo ha expirado.

## Backlog Scope and Story Naming Reconciliation

- En el backlog histórico (`platform_docs/DATA_MODEL_ERD_MVP_BACKLOG.md`), `E08-S02` aparecía rotulado como *Event dispatcher* y `E08-S04` como *Conditions base*.
- Para permitir la correcta composición modular y pruebas exhaustivas antes de acoplar el despachador de eventos y la ejecución de mutaciones, `E08-S02` implementa el evaluador de predicados puro en memoria (`Rule Condition Evaluator & Predicate Execution Engine`).
- La ejecución de acciones y mutaciones en base de datos se implementa en `E08-S03`, y el despachador/procesador de eventos de mensajería hacia el motor de reglas se conectará en `E08-S04`.
- Esta reconciliación mantiene la arquitectura limpia, desacoplada y 100% testeable sin adelantar mutaciones no autorizadas en esta story.

## Verification

- Suite de pruebas unitarias exhaustiva: `packages/database/src/rule-condition-evaluator.test.ts` (26 pruebas en PASS).
- Verificación ReDoS: patrones de backtracking catastrófico bloqueados y evaluados en < 1ms (< 50ms límite de seguridad).
- Regresiones de base de datos (`rule-catalog-manager.integration.ts` 8/8 PASS) y API REST (`rules.integration.ts` 8/8 PASS).
- Suite general Vitest (23 archivos, 142 pruebas PASS).
- Biome check: 296 archivos sin errores ni warnings.
- TypeScript typecheck en los 18 paquetes y aplicaciones del monorepo: 100% PASS.
