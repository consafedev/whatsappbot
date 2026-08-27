---
name: whatsapp-platform-engineering
description: >
  Project engineering contract for the multi-tenant WhatsApp automation
  platform. Use for any planning, implementation, refactor, review, testing,
  migration, security, deployment, architecture, database, messaging,
  frontend, backend, or documentation work in this repository. Read the
  applicable platform_docs sources before changing code. Preserve tenant
  isolation, module entitlements, provider abstractions, PostgreSQL as source
  of truth, deterministic business rules, and the sellable MVP scope.
---

# SKILL.md — Contrato de trabajo para IAs y desarrolladores

**Proyecto:** Plataforma Multitenant de Automatización Empresarial  
**Versión:** 1.0  
**Fecha:** 2026-08-12  
**Objetivo:** conseguir que cualquier IA, agente autónomo o desarrollador pueda continuar el proyecto con alta calidad, sin depender de memoria previa, sin inventar arquitectura y sin introducir desviaciones silenciosas.

---

# 0. Instrucción principal

Si estás trabajando en este repositorio, **debes leer este archivo antes de modificar código**.

Este archivo no describe el producto completo. Describe **cómo debes trabajar sobre él**.

No sustituyas la documentación por tu memoria, conocimientos previos o preferencias personales.

---

# 1. Orden obligatorio de lectura

Antes de una tarea significativa, lee los documentos aplicables en este orden:

1. `platform_docs/docs/INDEX.md` — mapa y jerarquía documental.
2. `platform_docs/PRD.md` — qué producto existe y qué no se debe cambiar silenciosamente.
3. `platform_docs/SYSTEM_DESIGN.md` — arquitectura y boundaries.
4. `platform_docs/DATA_MODEL_ERD_MVP_BACKLOG.md` — datos, entidades, epics, historias y prioridades.
5. `platform_docs/STATUS.md` — estado real actual del repositorio.
6. `platform_docs/CHANGELOG.md` — cambios ya introducidos.
7. ADRs relevantes en `platform_docs/docs/adr/`.
8. `platform_docs/UI_FLOWS.md` / `platform_docs/DESIGN.md` si la tarea toca interfaz.
9. `platform_docs/SECURITY.md` si toca auth, permisos, secrets, uploads, portal, IA o datos sensibles.
10. `platform_docs/TESTING_STRATEGY.md` si crea/modifica comportamiento.
11. Runbooks si toca deployment, backup, restore u operación.

No es obligatorio leer cada documento completo en cada cambio trivial, pero sí es obligatorio consultar la fuente normativa del área modificada.

---

# 2. Jerarquía de autoridad

Si dos documentos parecen contradecirse:

1. ADR aprobado más reciente que cambie explícitamente la decisión.
2. `platform_docs/PRD.md` para alcance/visión/producto.
3. `platform_docs/SYSTEM_DESIGN.md` para arquitectura/runtime/boundaries.
4. `platform_docs/DATA_MODEL_ERD_MVP_BACKLOG.md` para modelado/backlog.
5. `platform_docs/SECURITY.md` para controles de seguridad específicos.
6. `platform_docs/UI_FLOWS.md` para comportamiento de interacción.
7. `platform_docs/DESIGN.md` para apariencia/sistema visual.
8. `platform_docs/STATUS.md` para implementación presente.
9. Código y tests reflejan la implementación, pero no pueden invalidar silenciosamente documentación normativa.

Si la contradicción no se puede resolver, **no inventes una respuesta**. Registra el conflicto y propón el cambio documental/ADR necesario antes de alterar arquitectura.

---

# 3. Reglas no negociables del producto

1. **Un repositorio, un producto, un sistema de versiones.**
2. Prohibidos forks permanentes por cliente.
3. Prohibido `if tenant === "cliente-especifico"` en Core.
4. Personalización debe resolverse primero mediante configuración, entitlements, templates, custom fields, rules o extension points.
5. PostgreSQL es la fuente de verdad de estado crítico.
6. Redis/BullMQ no son fuente de verdad.
7. Todo dato tenant-owned debe estar aislado por tenant.
8. No confiar en `tenant_id` enviado arbitrariamente por cliente HTTP.
9. Entitlements se validan en UI, API y workers cuando corresponda.
10. WhatsApp es un canal; el Core no depende de Baileys/WPPConnect/Meta.
11. Providers externos van detrás de interfaces/adapters.
12. Reglas deterministas gobiernan estados, precios, permisos y side effects críticos.
13. IA es opcional y debe fallar de forma degradable.
14. IA no calcula de forma libre precio/impuestos/descuentos/márgenes/autorizaciones.
15. Workflows usan `WorkflowOrchestrator`; BullMQ es adapter MVP.
16. No importar BullMQ directamente por todo el dominio.
17. Temporal queda preparado, no es runtime MVP salvo ADR explícito.
18. Side effects externos deben ocurrir después de commit de negocio, preferentemente mediante outbox/job.
19. Operaciones con riesgo de duplicación deben ser idempotentes.
20. Acciones administrativas sensibles deben auditarse.
21. Desactivar un módulo no borra datos.
22. Dedicated/customer-hosted ejecutan el mismo producto, no una variante.
23. El primer MVP debe ser **funcional y vendible**, no un prototipo de UI vacío.

---

# 4. Regla de no alucinación

Nunca afirmes que existe algo sin verificarlo.

Antes de usar/modificar:

- archivo;
- clase;
- endpoint;
- tabla;
- migration;
- env var;
- package;
- provider method;
- UI route;
- test fixture;
- schema field;
- script;

**búscalo en el repositorio o en la documentación oficial correspondiente**.

Si no existe, dilo explícitamente y créalo sólo si la tarea lo requiere y respeta el diseño.

Nunca inventes:

- nombres de API;
- parámetros;
- capacidades de librerías;
- métodos de SDK;
- límites de providers;
- estados de DB;
- resultados de tests no ejecutados;
- commits no creados;
- migraciones no verificadas.

---

# 5. Regla de fuentes técnicas

Cuando una tarea dependa de comportamiento de una librería o servicio que puede cambiar (Baileys, WPPConnect, Meta API, Prisma, Next.js, NestJS, BullMQ, Cloudflare, proveedores IA, etc.):

1. revisa versión instalada;
2. revisa documentación oficial de esa versión o la versión objetivo;
3. no copies snippets desactualizados sin validar;
4. documenta cualquier cambio de versión que afecte arquitectura/compatibilidad;
5. actualiza lockfile y tests.

No se introduce una dependencia nueva sólo porque la IA la conoce o la prefiere.

---

# 6. Protocolo ANTES de programar

Para cada tarea:

## 6.1 Entender alcance

Identifica:

- historia/epic relacionada;
- módulo;
- entitlement;
- actor/roles;
- datos modificados;
- Organization Unit scope;
- side effects;
- eventos;
- fallos esperables;
- tests necesarios.

## 6.2 Inspeccionar implementación real

Busca:

- código existente;
- schema Prisma/migrations;
- tests;
- interfaces;
- adapters;
- TODOs;
- STATUS actual.

No diseñes desde cero si ya existe una pieza.

## 6.3 Confirmar boundaries

Pregúntate:

- ¿pertenece a Core o módulo?
- ¿es reusable o cliente-específico?
- ¿requiere configuración en vez de código?
- ¿requiere ADR?
- ¿rompe compatibilidad?

## 6.4 Definir aceptación

Extrae criterios del backlog/PRD. Si faltan detalles pequeños, elige la opción más conservadora compatible y documenta el supuesto. No bloquees trabajo por preguntas que el repositorio pueda resolver.

---

# 7. Protocolo DURANTE la programación

## 7.1 Mantener cambios acotados

No mezclar refactors generales con una feature salvo necesidad demostrable.

## 7.2 Respetar capas

- controllers: transporte/validación;
- application services: casos de uso;
- domain: invariantes;
- repositories: persistencia;
- adapters: providers externos;
- workers: side effects/background;
- UI: presentación/interacción.

## 7.3 Tenant isolation

Cada repository/query tenant-owned debe estar tenant-scoped.

Incluye tests negativos: Tenant A no puede leer/modificar Tenant B aunque conozca IDs.

## 7.4 Autorización

No asumir que autenticación = autorización.

Aplicar:

```text
active tenant
+ entitlement
+ permission
+ organization-unit scope
+ resource policy
```

## 7.5 Side effects

Evita:

```text
DB write
send WhatsApp dentro de la misma request antes de commit
```

Prefiere:

```text
transaction DB + outbox
commit
worker
provider
```

## 7.6 Idempotencia

Si un evento puede repetirse, tratar repetición como caso normal.

## 7.7 Seguridad

Nunca loggear secrets ni PII innecesaria.

## 7.8 No introducir deuda oculta

Si se toma un atajo consciente para acelerar MVP:

- debe ser seguro;
- debe quedar en `platform_docs/STATUS.md` como deuda conocida;
- indicar condición de eliminación;
- no disfrazarlo como solución definitiva.

---

# 8. Reglas específicas de WhatsApp/Messaging

1. Usar `MessagingProvider`/contratos del Core.
2. Baileys es adapter inicial; tipos de Baileys no deben filtrarse al dominio.
3. WPPConnect y Meta deben poder añadirse sin cambiar conversaciones/procesos.
4. Cada ChannelAccount tiene lifecycle independiente.
5. Una sesión de un provider no se presume portable a otro provider.
6. Outbound desde dashboard debe conservar `actor_user_id`.
7. Outbound automático conserva rule/AI execution refs.
8. Echo reconciliation debe evitar mensajes duplicados.
9. `fromMe`/equivalente sólo prueba outbound desde la cuenta; no atribuyas a una persona específica si el provider no lo demuestra.
10. Si outbound aparece desde dispositivo externo y no corresponde a envío de plataforma, clasificarlo como humano externo según contrato normalizado.
11. Human takeover debe respetar modo AUTO/ASSISTED/HUMAN/MONITOR.
12. No prometer envío si provider no confirmó el estado correspondiente.

---

# 9. Reglas específicas de IA

1. Siempre buscar primero solución sin IA.
2. Llamar AI Gateway por `task`, no por modelo hardcoded desde módulos.
3. Aplicar tenant AI policy.
4. Aplicar data classification.
5. Respetar route/model allowed classifications.
6. Aplicar redaction hooks cuando corresponda.
7. Fallar hacia siguiente provider/model sólo en errores clasificados como fallback-eligible.
8. No rotar claves para evadir términos, cuotas o restricciones del proveedor.
9. Registrar execution metadata/costo estimado sin guardar contenido sensible innecesario.
10. Output de IA que cause side effect debe validarse y transformarse a comando estructurado.
11. Nunca ejecutar instrucciones libres devueltas por un LLM.

---

# 10. Reglas específicas de Rules Engine

1. Regla = trigger + conditions + actions + policy/version.
2. Actions usan allowlist.
3. Prohibido `eval` o JavaScript arbitrario del tenant en MVP.
4. Loop protection obligatorio.
5. Execution log obligatorio para acciones relevantes.
6. Action debe invocar application service/job, no SDK externo directamente.
7. Validar entitlement/permission contextual de la automatización.

---

# 11. Reglas específicas de Process Engine

1. Nunca actualizar status de `process_instance` directamente desde controller.
2. Toda transición usa servicio central.
3. Validar transición permitida e invariantes.
4. Crear timeline event coherente.
5. Generar domain event/outbox.
6. Definiciones publicadas se versionan.
7. Instancias conservan versión semántica.
8. Visibilidad internal/customer/both es explícita.

---

# 12. Reglas específicas de Action Requests

1. Resolución por WhatsApp, portal o dashboard termina en el mismo application service.
2. Completion idempotente.
3. Verificar destinatario/scope.
4. Cambios producen timeline/evento.
5. Expiration/reminders usan orchestrator.
6. Un ActionRequest completado no se completa dos veces silenciosamente.

---

# 13. Reglas específicas de Agenda

1. Usar timezone del tenant/unidad.
2. Evitar double booking transaccionalmente.
3. Recordatorios persistentes, no `setTimeout` en proceso.
4. Reprogramación conserva auditoría.
5. Availability es cálculo de dominio, no lógica de UI.

---

# 14. Reglas específicas de Cotizaciones

1. Calculation service determinista.
2. Snapshot/version antes de enviar.
3. IA no determina importes finales libremente.
4. Approval policy se aplica siempre.
5. Nivel de autonomía pertenece a policy/configuración del tenant.
6. Documento generado conserva template/branding version.
7. `send quote` debe ser idempotente.

---

# 15. Reglas de base de datos y migraciones

1. Código/schema en inglés.
2. `tenant_id NOT NULL` en entidades tenant-owned.
3. Índices/uniques deben considerar tenant.
4. No usar JSONB para evitar relaciones centrales.
5. Migrations append-only después de aplicarse en ambiente compartido.
6. Toda migration debe probarse sobre DB limpia y upgrade desde baseline relevante.
7. No ejecutar migración destructiva en producción sin backup y plan explícito.
8. Cambios de retención/borrado requieren revisión de seguridad/privacidad.

---

# 16. Reglas de UI

Cuando existan `platform_docs/UI_FLOWS.md` y `platform_docs/DESIGN.md`:

1. comportamiento viene de UI_FLOWS;
2. apariencia/componentes vienen de DESIGN;
3. UI no inventa acciones no soportadas por API;
4. módulos deshabilitados respetan entitlements;
5. permisos se reflejan pero API vuelve a validar;
6. states loading/empty/error/permission/degraded deben existir;
7. responsive según DESIGN;
8. no crear mock data permanente para ocultar backend faltante.

---

# 17. Definition of Done por tarea

Una tarea no está terminada sólo porque “funciona en mi máquina”.

Debe cumplirse cuando aplique:

- [ ] comportamiento implementado;
- [ ] tipos correctos;
- [ ] lint pasa;
- [ ] typecheck pasa;
- [ ] unit tests pasan;
- [ ] integration tests pasan;
- [ ] tenant isolation probado;
- [ ] autorización probada;
- [ ] idempotencia probada si aplica;
- [ ] errores/retries considerados;
- [ ] migration validada si aplica;
- [ ] logs sin secretos;
- [ ] audit añadido si aplica;
- [ ] docs actualizadas;
- [ ] `platform_docs/STATUS.md` actualizado;
- [ ] `platform_docs/CHANGELOG.md` actualizado cuando el cambio es user-visible/release-relevant;
- [ ] ADR creado/actualizado si cambió decisión arquitectónica;
- [ ] commit claro creado cuando el flujo de trabajo lo requiera.

No marques tests como ejecutados si no fueron ejecutados.

---

# 18. Definition of Done del vertical slice vendible

Prioridad económica P0.

Antes de ampliar módulos, debe existir:

- [ ] Super Admin crea tenant;
- [ ] Super Admin activa módulos/límites;
- [ ] Tenant Admin inicia sesión;
- [ ] Tenant conecta WhatsApp por QR;
- [ ] llega mensaje real;
- [ ] contacto se crea/resuelve;
- [ ] conversación se persiste;
- [ ] inbox muestra mensaje;
- [ ] regla puede responder;
- [ ] outbound se persiste/reconcilia;
- [ ] humano responde desde dashboard;
- [ ] outbound humano desde WhatsApp se sincroniza;
- [ ] origen se distingue;
- [ ] AUTO/HUMAN funciona;
- [ ] tenant isolation test pasa;
- [ ] restart no destruye estado crítico;
- [ ] backup/restore probado antes de primer cliente pagado.

No se permite postergar indefinidamente este milestone por desarrollar funcionalidades P1/P2.

---

# 19. Cuándo crear un ADR

Crear ADR si se propone cambiar o decidir algo con impacto duradero, por ejemplo:

- DB principal;
- estrategia multi-tenant;
- ORM;
- framework principal;
- queue/orchestrator;
- provider abstraction;
- authentication architecture;
- storage architecture;
- backup strategy;
- deployment topology;
- event/outbox strategy;
- versioning;
- plugin architecture;
- Temporal runtime;
- object storage externo;
- cambio de provider principal.

No crear ADR para decisiones triviales de implementación local.

---

# 20. Formato mínimo ADR

```text
Title
Status
Date
Context
Decision
Alternatives considered
Consequences
Migration/rollback
Affected documents
```

---

# 21. Protocolo DESPUÉS de programar

1. Ejecutar checks relevantes.
2. Revisar diff completo.
3. Confirmar que no se agregaron secrets.
4. Confirmar tenant isolation.
5. Confirmar que no se filtraron tipos específicos de provider.
6. Actualizar `platform_docs/STATUS.md`.
7. Actualizar `platform_docs/CHANGELOG.md` si corresponde.
8. Actualizar backlog/checkboxes si se mantiene tracking allí.
9. Crear/actualizar ADR si hubo decisión.
10. Documentar known issues, no ocultarlos.
11. Crear commit con mensaje comprensible.

---

# 22. Formato recomendado de STATUS al terminar

```text
Done
- E05-S01 Messaging contracts
- E05-S03 ChannelAccount CRUD

Verified
- pnpm lint
- pnpm typecheck
- pnpm test ...

Known issues
- QR reconnect after forced logout not yet handled

Next
- E05-S02 Baileys adapter: connection lifecycle

Last commit
- <hash> <message>
```

---

# 23. Manejo de incertidumbre

Si falta información:

1. inspecciona código/documentos;
2. inspecciona tests/migrations;
3. consulta documentación oficial cuando dependa de tecnología externa;
4. elige default conservador si no afecta arquitectura;
5. documenta supuesto;
6. pregunta sólo cuando la decisión sea realmente de producto/negocio y no pueda deducirse sin riesgo.

Nunca rellenes huecos con “probablemente existe”.

---

# 24. Prioridad de trabajo

Salvo instrucción explícita distinta:

1. bloqueadores del vertical slice vendible;
2. bugs de seguridad/tenant isolation/data loss;
3. estabilidad de WhatsApp/inbox/rules;
4. backup/restore antes del primer cliente pagado;
5. siguiente módulo ligado al prospecto con mayor probabilidad de compra;
6. mejoras P1;
7. sofisticación P2/P3.

La prioridad del proyecto es **conseguir clientes e ingresos sin sacrificar fundamentos que causarían pérdida de datos o mantenimiento imposible**.

---

# 25. Política de “cliente pide personalización”

Antes de escribir código específico:

1. ¿se puede resolver con custom field?
2. ¿process definition?
3. ¿rule?
4. ¿document template?
5. ¿industry template?
6. ¿entitlement/config?
7. ¿connector/plugin reusable?

Sólo si ninguna aplica, proponer extension point aislado.

Nunca parchear Core con una excepción oculta.

---

# 26. Política de refactor

Refactor permitido cuando:

- elimina duplicación real;
- corrige boundary incorrecto;
- es requisito para historia actual;
- reduce riesgo inmediato.

Evitar reescrituras “porque otra arquitectura parece más elegante” sin necesidad comercial/técnica.

---

# 27. Política de dependencias

Antes de instalar package:

- comprobar que ya no exista solución en stack;
- comprobar mantenimiento/licencia;
- comprobar compatibilidad;
- evaluar impacto bundle/runtime;
- preferir dependencia directa y madura;
- documentar librerías críticas en System Design/ADR si se vuelven estructurales.

No instalar paquetes para utilidades triviales.

---

# 28. Política de seguridad ante archivos

Uploads deben:

- validar autorización;
- imponer límite;
- detectar MIME;
- renombrarse internamente;
- almacenarse tenant-scoped;
- registrar hash/metadata;
- nunca ejecutarse;
- no estar públicamente accesibles por path;
- permitir hook de malware scanning futuro.

---

# 29. Política de observabilidad

Toda operación background importante debe ser rastreable a:

- tenant;
- entity;
- job/event;
- resultado;
- error normalizado.

Si un usuario reporta “no se envió”, debe ser posible saber:

- si se creó job;
- si se ejecutó;
- qué provider se usó;
- provider response/status;
- retries;
- estado final.

---

# 30. Política de documentación

Actualizar documentación en el mismo cambio cuando la implementación cambie su verdad.

No dejar documentación “para después” si eso provoca que otra IA implemente contra un estado falso.

Documentos normativos no deben contener datos secretos.

---

# 31. Criterio de éxito de este SKILL

Este archivo cumple su función si una IA nueva puede:

- saber qué leer;
- saber qué no cambiar;
- encontrar la fuente correcta;
- implementar sin inventar;
- validar aislamiento y seguridad;
- dejar un estado claro para la siguiente IA;
- priorizar el MVP que puede venderse;
- evitar convertir el producto en variantes por cliente.

---

# 32. Metodología de desarrollo durante la vida del proyecto

Antes de cada cambio, la IA debe:

- Investigar el estado actual del repositorio y la documentación;
- Entender el alcance de la tarea y los criterios de aceptación;
- Planificar la implementacion respectiva a cada historia/epic;
- Implementar cambios respetando las reglas de aislamiento, autorización y seguridad;
- Validar que los cambios cumplen con los criterios de aceptación y no rompen la funcionalidad existente;
- Auditar y documentar los cambios realizados, incluyendo la actualización de STATUS.md, CHANGELOG.md y la creación de ADRs si es necesario;
- En caso de encontrar errores, problemas o deuda técnica, planear y corregirlos de manera prioritaria, siguiendo la política de prioridad de trabajo establecida.
- Una vez aplicados los cambios y correcciónes, volver a ejecutar la auditoría y validación para asegurar que el sistema sigue cumpliendo con los criterios de aceptación y no se han introducido nuevos problemas y que los fixes corrigieron cualquier problema encontrado.
- Aplicar la metodología de desarrollo de manera iterativa, asegurando que cada cambio realizado sea revisado y validado antes de pasar a la siguiente tarea o historia/epic.
- Una vez completada la taréa, y hasta que no se encuentren problemas o errores, documentar el estado final del sistema y cualquier cambio realizado en la documentación correspondiente, asegurando que la siguiente IA pueda continuar el trabajo sin problemas.