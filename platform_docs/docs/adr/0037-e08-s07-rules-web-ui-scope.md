# ADR-0037 — E08-S07 Rules Engine Web UI Management and Console Client Scope

- Status: Accepted
- Date: 2026-08-26
- Owners: Platform Engineering

## Context

La historia `E08-S07` concluye la construcción del motor de reglas deterministas y gobernanza de automatización (Epic 08 — Rules Engine & Deterministic Automation) conforme a ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0006 (Own Rules Engine, No n8n in Core), ADR-0009 (Rules First, AI Optional), ADR-0031 (Rules Engine Foundation Scope), ADR-0032 (Rule Condition Evaluator Scope), ADR-0033 (Rule Action Execution Engine Scope), ADR-0034 (Automation Triggers and Inbound Bridge Scope), ADR-0035 (Human Takeover and Assignment Routing Policies Scope) y ADR-0036 (Inactivity and Business Hours Scope).

Para completar la experiencia operativa de los administradores y operadores de inquilino (`tenant`), la plataforma requería:
1. **View Model Desacoplado de Reglas (`rules-view-model.ts`)**:
   - Tipos TypeScript rigurosos para la representación de reglas (`RuleItem`), estado del formulario de regla (`RuleFormData`), filtros de catálogo (`RuleListFilter`) y payloads de mutación (`CreateRulePayload`, `UpdateRulePayload`).
   - Métodos asíncronos para interactuar con la API REST (`fetchRules`, `fetchRuleDetail`, `createRule`, `updateRule`, `deleteRule`, `toggleRuleStatus`).
   - Transformadores bidireccionales (`ruleToFormData`, `formDataToCreatePayload`, `formDataToUpdatePayload`) con análisis tipado de operadores unarios y binarios (números, listas, booleanos, comprobaciones nulas o vacías).
   - Generador de oraciones en lenguaje natural (`generateRuleSentencePreview`) para previsualización inmediata de la semántica de la regla ("CUÁNDO ... ENTONCES ...").
2. **Componentes Visuales de Consola (`apps/web/app/app/rules/`)**:
   - `RulesList` (`rules-list.tsx`): Filtros por disparador (`triggerType`), chips de estado (`active`, `inactive`, `draft`, `all`), búsqueda textual, tabla/tarjetas de reglas con etiquetas de prioridad (`P100`), modos de ejecución (`first_match_stop`, `evaluate_all`), interruptor rápido de activación/pausa y confirmación de eliminación accesible.
   - `RuleFormModal` (`rule-form-modal.tsx`): Modal/drawer lateral con formulario de configuración general, constructor dinámico de condiciones ("Disparador y condiciones"), constructor dinámico de acciones de respuesta con botones para inserción de variables (`{{contact.name}}`, etc.), y panel lateral con resumen y previsualización de oraciones en tiempo real.
   - `RulesClient` (`rules-client.tsx`): Orquestador cliente de React que verifica `module.automation.basic` y los permisos `rules.read` y `rules.manage`, carga opciones de canales, unidades organizacionales y agentes, y gestiona notificaciones accesibles.
   - `TenantRulesPage` (`page.tsx`): Punto de entrada Next.js bajo la ruta canónica `/app/rules`.
3. **Navegación de Workspace (`tenant-app-navigation.ts`)**:
   - Habilitar el ítem de navegación `automations` vinculando a `/app/rules` condicionado por `module.automation.basic` y `rules.read`.

## Decision

1. **View Model Desacoplado y Tipado**:
   - Se implementó `apps/web/app/app/rules/rules-view-model.ts` de forma agnóstica a componentes de UI, con validaciones puras y pruebas unitarias exhaustivas con Vitest (`rules-view-model.test.ts`).
2. **Interfaz de Usuario Reactiva y Accesible**:
   - Componentes creados en `apps/web/app/app/rules/` con total adherencia a estándares de accesibilidad WCAG (asociación explícita de etiquetas, soporte de escape y roles ARIA).
   - Estilos CSS integrados en `apps/web/app/globals.css` respetando el sistema de diseño (`--tenant-primary`, `--tenant-surface`, `--tenant-border`).
3. **Control de Acceso y Entitlements**:
   - Si el inquilino carece de `module.automation.basic` o el usuario carece de `rules.read`, la vista bloquea el acceso con mensajes explicativos claros.
   - Las operaciones de mutación (`createRule`, `updateRule`, `deleteRule`, `toggleRuleStatus`) están restringidas a usuarios con el permiso `rules.manage`.

## Backlog Scope and Story Reconciliation

- Con la implementación de `E08-S07` (**Rules Engine Web UI Management & Console Client**), todas las 7 historias de **Epic 08 (Rules Engine & Deterministic Automation)** han sido completadas con éxito, cubriendo desde el modelo de datos PostgreSQL y motor de evaluación determinista hasta la consola web completa para administración de automatizaciones.
