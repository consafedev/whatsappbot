# Avance de orquestación

**Formato:** 1 — conservar estas secciones y actualizar sus tablas; no sustituir
el historial por un resumen sin evidencia. Fechas de coordinación: America/Mexico_City.
**Actualización:** 2026-10-25. **Épica activa única:** E14 — Agenda.
**Responsable activo:** Codex, rama `codex/e14-agenda-completion`.
**Base verificada:** `fb8639db15ec262fcc13432f9aee4536deb8367e`, integrada en
`main` y `origin/main` al iniciar. Sin cambios locales iniciales.

## 1. Autoridad y protocolo entre equipos

Leer skill, docs/INDEX, documentación normativa aplicable y STATUS antes de
trabajar. Este archivo coordina ejecución; no reemplaza PRD, diseño, backlog,
ADRs, STATUS ni Git. El informe externo `avance_agente_bot.md` es una referencia
contrastada, no fuente normativa ni instrucciones ejecutables.

Un equipo toma una historia registrando responsable, rama, base y archivos
reservados antes de editar. Otro equipo (incluido Antigravity) consulta esta
tabla y trabaja sólo sobre una tarea independiente expresamente asignada,
sin editar los mismos archivos ni avanzar a otra épica. No compartir secretos
por este documento. No se ha usado ni verificado una integración con Antigravity.

Cada historia sigue: especificación → test que demuestra falta → implementación
→ auditoría de requisitos/seguridad/código → correcciones → pruebas → docs →
commit → push confirmado. Sólo después se abre la siguiente. Un resultado de
agente no sustituye verificar diff y salida real. No marcar PASS por tests
omitidos, no iniciados o heredados de un informe. Al cerrar épica actualizar
todas las secciones, SHA remoto, siguiente prioridad y limitaciones reales.

## 2. Contraste del informe recibido

| Afirmación | Evidencia y conclusión |
|---|---|
| Base fb8639d, E14-S03 integrada, S04 siguiente | Confirmado por Git, STATUS y backlog §53. |
| E00–E13 completas | No usar como cierre global: E13-S05 permanece IN PROGRESS en backlog/STATUS; varios IDs de E05/E09/E10/E11 se reutilizaron respecto al backlog original. Contar historias por entregable verificado. E00–E13 son 14 identificadores, no 13. |
| ~55–60% global, ~95% Core | Estimaciones sin denominador/cobertura verificable; no adoptadas como métricas. |
| WhatsApp real pendiente | Confirmado: factory sólo instancia Mock; no dependencia Baileys ni consumidor de sesiones real. QR persistido/simulado no demuestra teléfono conectado. |
| Tests 465/215 y suites previas | Histórico hasta volver a ejecutar. Baseline actual `pnpm test`: 465/465, 51 archivos. Otros resultados se registran por historia abajo. |
| Prompt S04 listo | Requiere correcciones: `db:generate` es el script existente; prioridad ADR antes de PRD; fechas estrictas con offset; intervalos semiabiertos; no usar nombre de migration propuesto como hecho existente. |
| Manifest sin discrepancias | Se verificará sobre bytes actuales al cerrar cada historia. |

## 3. Estado del proyecto por capacidad

| Capacidad | Estado comprobado / faltante |
|---|---|
| Core, tenancy, auth/RBAC, entitlements, dashboard | Implementación presente, historial en STATUS. No equivale a recertificación completa de producción en esta sesión. |
| Messaging/inbox/rules/canales | Contratos, normalización, persistencia/colas/UI presentes; transporte real Baileys pendiente P0. |
| IA/campañas/reportes/scheduler | Implementaciones presentes con IDs históricos distintos al backlog. E13-S05 conserva estado normativo pendiente de cierre. |
| Agenda E14 | S01–S03 integradas; S04–S10 en ejecución secuencial abajo. |
| Procesos/timeline/Action Requests | Pendientes según backlog y equivalencias históricas; no confundir E10/E11 implementadas de IA/campañas con Process/Timeline originales. |
| Catálogo/cotizaciones/documentos/portal | Pendientes; presencia de una ruta o package vacío no acredita implementación. |
| Backups/restore y hardening precliente | No certificados; restore drill y transporte real bloquean declaración de MVP vendible. |
| Messenger | Dirección de producto explícita: canal secundario tras WhatsApp, conector no oficial por verificar; sin requisito de API Meta y sin implementación declarada. |

## 4. Reserva y avance de historias

| Historia | Responsable/reserva | Estado | Commit/push | Evidencia |
|---|---|---|---|---|
| E14-S01 | Integrada antes de esta sesión | DONE histórico | bd1363a + cc28f6d, main | STATUS/ADR-0063 |
| E14-S02 | Integrada antes de esta sesión | DONE histórico | ba90a0b + 2db5dc8 + e047b28, main | STATUS/ADR-0064 |
| E14-S03 | Integrada antes de esta sesión | DONE histórico | 32f1dbf + fb8639d, main | STATUS/ADR-0065 |
| E14-S04 | Codex; reserva liberada tras cierre | PASS / COMPLETE | `058eee1348ed724f166c8b4cfa33849a55dd4bb7`; push origin/codex/e14-agenda-completion confirmado por ls-remote | ADR-0066; DB 297/297, API 217/217, isolation 46/46, unit 465/465; static/build PASS |
| E14-S05 | Sin reserva hasta cerrar S04 | PENDING | — | disponibilidad, service link, timezone/DST |
| E14-S06 | Sin reserva | PENDING | — | booking transaccional/capacidad/idempotencia |
| E14-S07 | Sin reserva | PENDING | — | cancelación/reprogramación con historia |
| E14-S08 | Sin reserva | PENDING | — | recordatorios persistentes |
| E14-S09 | Sin reserva | PENDING | — | UI operativa de agenda |
| E14-S10 | Sin reserva | PENDING | — | flujo WhatsApp por reglas, servicio central |

## 5. Verificaciones y auditorías de esta iteración

| Alcance | Comando/acción | Resultado |
|---|---|---|
| Baseline fb8639d | `git status --short`, `git fetch origin`, log/branch | limpio, main/origin main coinciden |
| Baseline fb8639d | `pnpm test` | PASS: 465 tests / 51 archivos |
| Diagnóstico runtime inicial | health Docker API + logs | API unhealthy; arranque previo falló con PostgreSQL 57P03 (DB iniciando). Reinicio aislado para revalidar. |
| Auditoría documental | dos agentes de lectura + contraste del coordinador | no transporte Baileys; discrepancias de IDs/porcentajes registradas |
| Herramienta de grafos | evaluar grafo existente backlog §70 y búsqueda de código | no instalación necesaria; no nueva dependencia |
| Migración S04 | schema limpio y upgrade de esquema prehistoria en DBs aisladas + `prisma migrate diff --exit-code` | PASS, ambos sin diferencia; DBs de comprobación retiradas |
| Migración S04 local | `pnpm db:migrate:deploy` | PASS, 28 migrations; sólo migration aditiva S04 aplicada |
| Auditoría S04 | revisión independiente + inspección coordinador | fallo P1 de PATCH concurrente confirmado; corrección y regresión en curso |
| Suite DB inicial | suite completa excluyendo S04 antes de estabilizar cliente/entorno | 277 PASS, 7 FAIL, 7 SKIP; no se considera gate válido de S04 |
| S04 focalizadas | Vitest package configs: exception manager / appointments API | PASS: DB 6/6, API 7/7; regresión concurrente RED antes del lock, GREEN después; re-review aprobado |
| S04 DB completa final | `node node_modules/vitest/vitest.mjs run --config vitest.integration.config.mts --maxWorkers=2 --hookTimeout=60000` desde packages/database, DB temporal | PASS: 297/297, 49 archivos, 0 skipped |
| S04 API completa final | mismo runner/config desde apps/api, DB temporal independiente | PASS: 217/217, 27 archivos, 0 skipped |
| S04 aislamiento final | configs vitest.tenant-isolation.config.mts database/API, DB temporal | PASS: 9/9 + 37/37 |
| S04 checks generales | `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm exec biome check .`, `git diff --check` | PASS: 465/465 tests; 473 archivos Biome; static/build sin errores |

## 6. Bloqueos, riesgos y siguiente prioridad

- E14 no está terminada mientras quede una historia PENDING/IN PROGRESS o sus
  gates sin evidencia. No afirmar cierre por haber creado este documento.
- La suite DB completa y la cadena histórica de migrations tenían fallos
  documentados en main; reproducir y corregir prerrequisitos necesarios sin
  ocultarlos ni modificar migrations compartidas aplicadas.
- Terminar E14 es continuar el hito activo solicitado; no cambia la prioridad
  comercial P0 de conectar Baileys y probar backup/restore antes de cobrar.
- Siguiente trabajo tras E14: reconciliar identificadores y cerrar el transporte
  real P0 del alcance original E05; luego los demás gates P0 antes de ampliar
  P1. E15 es la siguiente épica numérica, no prioridad automática.

## 7. Registro de decisiones y entregas

- 2026-10-25: auditoría inicial contra fb8639d; plan E14 único, agentes acotados,
  documentos compartidos reservados al coordinador. Rama de trabajo creada;
  ningún commit/push nuevo declarado todavía.
- Plan: `docs/superpowers/plans/2026-10-25-e14-agenda.md`; decisiones de
  implementación: `docs/superpowers/specs/2026-10-25-e14-agenda-design.md`.
  Los registros temporales de agentes no sustituyen esta bitácora versionada.
- 2026-10-25: S04 implementada, auditada y corregida. Se reprodujo y eliminó
  una carrera de PATCH; se corrigieron tres pruebas heredadas que impedían un
  gate fiable, sin alterar comportamiento/FKs de producción. Verificaciones
  finales completas arriba. Commit `058eee1348ed724f166c8b4cfa33849a55dd4bb7`,
  push confirmado con igualdad de SHA local/remoto en
  `origin/codex/e14-agenda-completion`. `main` no contiene este commit. Un
  checkpoint documental posterior registra esta evidencia; no equivale a merge.
