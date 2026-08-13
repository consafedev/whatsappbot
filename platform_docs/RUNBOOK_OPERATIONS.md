# RUNBOOK_OPERATIONS.md — Operación e incidentes comunes

**Versión:** 1.0-draft  
**Fecha:** 2026-08-12

---

# 1. Objetivo

Permitir que una persona/IA opere el sistema bajo presión sin improvisar ni causar pérdida de datos.

Regla: primero identificar impacto y preservar datos; después restaurar servicio.

---

# 2. Severidad conceptual

## SEV-1

- posible fuga cross-tenant;
- pérdida/corrupción de datos;
- compromiso de credenciales críticas;
- producción completamente caída con clientes activos.

## SEV-2

- WhatsApp de múltiples clientes desconectado;
- queue crítica detenida;
- DB/Redis degraded severo;
- backups stale importantes.

## SEV-3

- un tenant/channel afectado;
- provider IA caído con core operativo;
- document renderer degradado.

---

# 3. Regla general de incidente

1. registrar hora/impacto;
2. obtener request/job/channel IDs;
3. no borrar logs/datos;
4. evitar restart repetitivo sin entender estado;
5. aplicar mitigación reversible;
6. verificar recuperación;
7. actualizar STATUS/incident notes;
8. crear regression test/ADR si aprendizaje estructural.

---

# 4. WhatsApp account disconnected

Síntomas:

- channel state disconnected/requires_reauth;
- inbound detenido;
- outbound falla.

Acciones:

1. verificar worker alive;
2. verificar network/provider status;
3. leer normalized last error;
4. determinar si reconnect automático es válido;
5. si requires_reauth, notificar Tenant Admin y mostrar QR/relink;
6. no borrar sesión manualmente sin causa;
7. verificar mensaje de prueba después de reconnect.

Histórico/inbox debe permanecer disponible.

---

# 5. Baileys worker crash loop

1. detener restart storm si consume recursos;
2. identificar account/session responsable;
3. inspeccionar error redacted;
4. aislar/deshabilitar ChannelAccount si un tenant derriba worker;
5. reiniciar worker limpio;
6. marcar account degraded;
7. no eliminar todas las sesiones;
8. registrar fixture/test si evento específico provocó crash.

---

# 6. Redis unavailable

1. API puede entrar degraded;
2. confirmar PostgreSQL sigue sano;
3. restaurar/reiniciar Redis;
4. iniciar workers;
5. ejecutar reconciliation de scheduled/outbox refs;
6. revisar failed/missing jobs;
7. verificar no hubo side effects duplicados.

No “recrear” estado de negocio desde memoria de Redis.

---

# 7. Queue backlog/stalled

Revisar:

- queue depth;
- oldest job;
- worker health;
- provider latency;
- repeat failure.

Acciones:

- escalar workers si safe;
- pausar job type problemático;
- no borrar queue masivamente;
- mover a failed/dead state controlado;
- reconciliar DB refs.

---

# 8. PostgreSQL unavailable

1. poner app en maintenance/degraded;
2. evitar writes alternativos que creen split brain;
3. revisar process/disk/connections;
4. restaurar servicio DB;
5. verificar integrity;
6. reanudar API/workers;
7. process outbox backlog;
8. smoke tests.

Si corrupción/pérdida, seguir backup restore runbook.

---

# 9. Disk nearly full

Prioridad alta porque afecta DB/backups.

1. verificar filesystem usage;
2. identificar growth: logs, backups temp, storage, DB, browser cache;
3. no borrar DB/storage al azar;
4. rotar logs/temporales seguros;
5. detener backup nuevo si no cabe;
6. ampliar disco/migrar si necesario;
7. alert threshold permanente.

---

# 10. Backup stale/failed

1. revisar último verified backup;
2. no eliminar current/previous;
3. revisar disk/network/Drive auth/encryption;
4. corregir;
5. ejecutar backup manual controlado;
6. verificar;
7. documentar gap.

---

# 11. AI provider unavailable

Expected behavior:

- AI gateway health degraded;
- eligible tasks fall back;
- deterministic operations continue.

Acciones:

- disable failing route/key;
- verify fallback;
- no cambiar reglas/core;
- notify only if user-visible degradation meaningful.

---

# 12. Document renderer failure

1. quote/process state remains persisted;
2. inspect render job error;
3. determine bad template/data vs service;
4. fix/retry idempotently;
5. no send duplicate document;
6. if template bad, disable/version it rather than edit historical generated record.

---

# 13. Suspected cross-tenant leak

SEV-1.

1. disable affected endpoint/feature if necessary;
2. preserve logs/audit;
3. identify tenants/resources/time window;
4. do not “fix and forget”;
5. reproduce with isolation test;
6. patch;
7. add regression test;
8. review similar repositories/endpoints;
9. assess notification/legal obligations with qualified advice as applicable.

---

# 14. Tenant suspended

Suspension should:

- block tenant user actions;
- stop/disable outbound automation according to policy;
- preserve data;
- keep Super Admin visibility;
- avoid deleting sessions/data automatically.

Reactivation revalidates entitlements/config.

---

# 15. Automation runaway/loop

1. disable offending rule globally for tenant;
2. stop queued jobs from rule safely using rule execution refs;
3. preserve execution logs;
4. calculate messages/actions sent;
5. fix loop guard/condition;
6. test duplicate/reentry;
7. only re-enable after verification.

---

# 16. Provider sends duplicate events

Expected: idempotency absorbs.

If duplicates visible:

1. capture external message IDs;
2. inspect normalization/idempotency key;
3. stop duplicate side effects if necessary;
4. patch;
5. add fixture/regression test.

---

# 17. Emergency module disable

Super Admin/feature flag may disable risky capability.

Rules:

- preserve data;
- communicate degraded state;
- audit change;
- do not use as permanent substitute for fix.

---

# 18. Post-incident

For significant incident:

- summary;
- impact;
- timeline;
- root cause;
- detection gap;
- fix;
- regression tests;
- docs/runbook changes;
- ADR if architecture changed.
