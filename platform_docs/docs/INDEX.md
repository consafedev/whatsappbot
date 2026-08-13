# docs/INDEX.md — Mapa operativo de documentación

**Proyecto:** Plataforma Multitenant de Automatización Empresarial  
**Versión:** 1.0  
**Fecha:** 2026-08-12  
**Objetivo:** permitir que una IA, desarrollador, operador o responsable de producto sepa exactamente qué documento leer, para qué sirve, cuándo usarlo, qué autoridad tiene y qué debe actualizar cuando realiza un cambio.

---

# 1. Regla principal

Este archivo es el **punto de entrada documental**.

Si llegaste al proyecto sin contexto previo, no empieces programando. Identifica primero el tipo de tarea y consulta los documentos correspondientes.

La documentación está diseñada para que el proyecto sobreviva a:

- pérdida de memoria conversacional;
- cambio de IA;
- cambio de desarrollador;
- pausas prolongadas;
- despliegues en otra infraestructura;
- crecimiento a múltiples clientes;
- cambios de providers externos.

---

# 2. Orden de lectura para alguien nuevo

## Lectura obligatoria inicial

1. `README.md`
2. `docs/INDEX.md`
3. `PRD.md`
4. `SYSTEM_DESIGN.md`
5. `DATA_MODEL_ERD_MVP_BACKLOG.md`
6. `.agents/skills/whatsapp-platform-engineering/SKILL.md`
7. `STATUS.md`
8. `CHANGELOG.md`
9. ADRs relevantes

## Después, según la tarea

- UI: `UI_FLOWS.md` + `DESIGN.md`
- Seguridad: `SECURITY.md`
- Tests: `TESTING_STRATEGY.md`
- Deploy: `DEPLOYMENT.md`
- Backup/restore: `RUNBOOK_BACKUP_RESTORE.md`
- Incidente/operación: `RUNBOOK_OPERATIONS.md`
- Prioridades futuras: `ROADMAP.md`
- Demo/venta: `DEMO_AND_SALES.md`

---

# 3. Jerarquía documental

Cuando exista conflicto:

1. ADR aprobado que modifique explícitamente una decisión previa.
2. `PRD.md` — producto, alcance y principios conceptuales.
3. `SYSTEM_DESIGN.md` — arquitectura técnica y runtime.
4. `DATA_MODEL_ERD_MVP_BACKLOG.md` — datos, backlog y orden de implementación.
5. `SECURITY.md` — controles específicos de seguridad.
6. `UI_FLOWS.md` — comportamiento UX.
7. `DESIGN.md` — sistema visual.
8. `STATUS.md` — realidad actual de implementación.
9. `CHANGELOG.md` — historial de cambios.
10. Código/tests — realidad ejecutable, que debe reconciliarse con documentación si difiere.

Una contradicción no se “resuelve” escogiendo silenciosamente la opción preferida del desarrollador.

---

# 4. Catálogo de documentos

## `README.md`

**Pregunta que responde:** ¿Qué es este repositorio y cómo empiezo?

**Usarlo cuando:**

- clonas/recibes el repositorio;
- quieres levantar el proyecto;
- quieres saber dónde están los documentos principales;
- necesitas comandos básicos.

**Debe contener:**

- resumen corto;
- estado actual;
- estructura principal;
- prerequisitos;
- quick start;
- links al resto de documentación.

**No debe convertirse en:** PRD, manual de arquitectura o changelog gigante.

**Actualizar cuando:** cambia el proceso de arranque, estructura raíz o entrypoints principales.

---

## `PRD.md`

**Pregunta que responde:** ¿Qué producto estamos construyendo, para quién, con qué capacidades y restricciones?

**Autoridad:** máxima para producto/alcance salvo ADR explícito.

**Usarlo cuando:**

- decides si una feature pertenece al producto;
- defines módulos;
- evalúas requerimientos de cliente;
- necesitas entender visión, ICP, pricing conceptual, deployment modes o principios no negociables.

**No usarlo para:** comandos concretos de deploy o implementación de un endpoint.

**Actualizar cuando:** cambia producto, alcance, módulos, principios o decisiones conceptuales.

---

## `SYSTEM_DESIGN.md`

**Pregunta que responde:** ¿Cómo está diseñado técnicamente el sistema y cómo colaboran sus componentes?

**Usarlo cuando:**

- implementas un servicio;
- agregas provider;
- cambias flujo de eventos;
- decides dónde vive el estado;
- trabajas tenancy, outbox, jobs, workers, storage, deployment, resiliencia.

**Debe definir:**

- topology;
- service boundaries;
- ports/adapters;
- transaction/outbox;
- idempotencia;
- deployment modes;
- resiliencia;
- observabilidad mínima.

**Actualizar cuando:** cambia arquitectura o boundary. Si el cambio es duradero/controvertido, crear ADR.

---

## `DATA_MODEL_ERD_MVP_BACKLOG.md`

**Pregunta que responde:** ¿Qué entidades existen y en qué orden construimos el MVP?

**Usarlo cuando:**

- haces migrations;
- diseñas repositories;
- implementas una historia;
- verificas dependencies entre epics;
- quieres saber qué entra en el vertical slice vendible.

**Actualizar cuando:** cambia el modelo conceptual o backlog acordado.

---

## `.agents/skills/whatsapp-platform-engineering/SKILL.md`

**Pregunta que responde:** ¿Cómo debe trabajar una IA/desarrollador en este proyecto sin romperlo?

**Autoridad:** contrato operativo para agentes.

**Usarlo cuando:** siempre antes de trabajo significativo.

**Contiene:**

- orden de lectura;
- reglas no negociables;
- no-alucinación;
- protocol before/during/after;
- Definition of Done;
- reglas por subsistema;
- cuándo crear ADR.

**Actualizar cuando:** aprendemos una regla operativa que toda IA futura debe obedecer.

---

## `STATUS.md`

**Pregunta que responde:** ¿Dónde nos quedamos exactamente?

**Usarlo cuando:**

- empieza una nueva sesión;
- cambia de IA/desarrollador;
- se retoma tras una pausa;
- se decide la siguiente tarea.

**Debe indicar:**

- versión/commit;
- milestone;
- done;
- in progress;
- blocked;
- known issues;
- next;
- verificaciones ejecutadas.

**Actualizar cuando:** termina una sesión significativa, historia o cambio de estado relevante.

**No es:** historial de releases; para eso existe `CHANGELOG.md`.

---

## `CHANGELOG.md`

**Pregunta que responde:** ¿Qué cambió a lo largo del tiempo?

**Usarlo cuando:**

- preparas release;
- investigas cuándo apareció una capacidad/regresión;
- comunicas cambios.

**Formato recomendado:** Keep a Changelog adaptado + SemVer.

**Actualizar cuando:** cambio user-visible, bug fix importante, seguridad, arquitectura/release.

---

## `ROADMAP.md`

**Pregunta que responde:** ¿Qué viene después y por qué?

**Usarlo cuando:** priorización de MVP/V1.5/V2/V3.

**No reemplaza:** backlog granular.

**Actualizar cuando:** cambia prioridad comercial/estratégica.

---

## `UI_FLOWS.md`

**Pregunta que responde:** ¿Qué puede hacer cada actor pantalla por pantalla y cómo fluye entre estados?

**Usarlo cuando:**

- diseñas UI;
- implementas frontend;
- generas prototipo en Open Design;
- escribes E2E de interacción.

**Debe contener:**

- sitemap;
- roles;
- pantallas;
- acciones;
- permisos;
- module gating;
- empty/loading/error/degraded states;
- responsive behavior funcional.

**Autoridad sobre comportamiento UX:** superior a `DESIGN.md`.

---

## `DESIGN.md`

**Pregunta que responde:** ¿Cómo debe verse y sentirse el producto?

**Usarlo cuando:**

- Open Design genera UI;
- frontend crea componentes;
- se valida consistencia visual;
- se define theming/branding.

**Debe contener:**

- design principles;
- tokens;
- typography;
- spacing;
- components;
- navigation patterns;
- 10 tenant themes;
- states;
- accessibility;
- responsive rules.

**No decide:** arquitectura backend ni permisos de negocio.

---

## `SECURITY.md`

**Pregunta que responde:** ¿Qué amenazas existen y qué controles son obligatorios?

**Usarlo cuando:**

- auth;
- RBAC;
- tenant isolation;
- secrets;
- uploads;
- portal;
- WhatsApp credentials;
- AI/privacy;
- webhooks;
- backup encryption.

**Actualizar cuando:** aparece nueva superficie de ataque o control.

---

## `TESTING_STRATEGY.md`

**Pregunta que responde:** ¿Qué debemos probar, en qué nivel y qué gates bloquean release?

**Usarlo cuando:**

- escribes tests;
- agregas módulo;
- preparas release;
- corriges regresión.

**Debe distinguir:** unit, integration, contract, E2E, security, restore drills.

---

## `DEPLOYMENT.md`

**Pregunta que responde:** ¿Cómo desplegamos de manera reproducible?

**Usarlo cuando:** staging/production/dedicated/customer-hosted.

**Debe incluir:**

- environments;
- config;
- secrets;
- Docker Compose;
- migrations;
- rollout;
- rollback;
- health verification.

---

## `RUNBOOK_BACKUP_RESTORE.md`

**Pregunta que responde:** ¿Cómo respaldar, verificar y restaurar el sistema bajo presión?

**Usarlo cuando:**

- backup scheduled;
- restore drill;
- pérdida de DB/host;
- migración de host.

**Debe ser ejecutable paso a paso**, no una descripción conceptual.

---

## `RUNBOOK_OPERATIONS.md`

**Pregunta que responde:** ¿Qué hacemos ante incidentes comunes?

**Casos:**

- WhatsApp disconnected;
- QR/reauth;
- queue stalled;
- Redis restart;
- DB disk full;
- worker crash;
- provider AI failure;
- document renderer failures;
- backup stale;
- tenant suspension;
- emergency disable module.

---

## `DEMO_AND_SALES.md`

**Pregunta que responde:** ¿Cómo demostramos y vendemos el producto sin improvisar?

**Usarlo cuando:**

- preparas demo;
- prospectas;
- haces discovery;
- eliges qué módulo priorizar para un lead.

**Debe contener:** escenarios demo, fixtures, pitch, valor, límites y CTA.

---

## `docs/adr/*.md`

**Pregunta que responde cada ADR:** ¿Por qué tomamos esta decisión técnica duradera?

**Usarlo cuando:** alguien propone reabrir una decisión estructural.

**Estados:** proposed / accepted / superseded / deprecated.

**Nunca borrar ADR viejo:** se marca superseded y se enlaza al nuevo.

---

## `docs/MANIFEST.md`

**Pregunta que responde:** ¿Qué archivos componen esta baseline documental y cuáles son sus hashes?

**Usarlo cuando:** copias, transfieres o verificas el paquete documental.

**Actualizar cuando:** cambia cualquier documento de la baseline que se quiera congelar/verificar.

---

# 5. Matriz rápida por tipo de tarea

| Tarea | Leer primero | Actualizar normalmente |
|---|---|---|
| Nueva feature | PRD, System Design, Backlog, Skill | Status, tests, Changelog si visible |
| Migration | Data Model, System Design, Security | Status, Changelog, ADR si estructural |
| WhatsApp | System Design, Skill, provider ADR | Status, tests, Runbook si operación cambia |
| UI | UI_FLOWS, DESIGN, PRD | Status, UI_FLOWS/DESIGN si cambia verdad |
| Auth/RBAC | Security, System Design, Data Model | Security, tests, Status |
| IA | PRD IA, System Design, Skill, Security | Status, AI policy docs si cambia |
| Backup | System Design, Backup Runbook | Runbook, Status, Changelog si release |
| Deploy | Deployment, Runbooks, Status | Status, Changelog |
| Bug | Status, Changelog, tests relacionados | Status, Changelog si relevante |
| Cliente pide custom | PRD, Skill, module/config model | PRD/ADR sólo si producto cambia |
| Reemplazar tecnología | ADRs, System Design | Nuevo ADR + documentos afectados |

---

# 6. Documentos que deben permanecer sincronizados

## Cambio de arquitectura

Actualizar:

- ADR;
- SYSTEM_DESIGN;
- DATA MODEL si aplica;
- PRD si cambia producto;
- CHANGELOG;
- STATUS.

## Cambio de feature/alcance

Actualizar:

- PRD;
- backlog;
- UI_FLOWS si visible;
- entitlements;
- STATUS;
- CHANGELOG.

## Cambio de UI

Actualizar:

- UI_FLOWS si comportamiento;
- DESIGN si visual;
- tests;
- STATUS.

## Cambio operacional

Actualizar:

- DEPLOYMENT/RUNBOOK;
- SYSTEM_DESIGN si topology;
- STATUS;
- ADR si estructural.

---

# 7. Documentos normativos vs vivos

## Normativos

Cambian con deliberación:

- PRD
- SYSTEM_DESIGN
- DATA_MODEL_ERD_MVP_BACKLOG
- SECURITY
- UI_FLOWS
- DESIGN
- ADRs

## Vivos/operativos

Cambian frecuentemente:

- STATUS
- CHANGELOG
- ROADMAP
- README
- runbooks

No usar un documento vivo para contradecir silenciosamente uno normativo.

---

# 8. Regla de handoff

Antes de entregar el proyecto a otra IA/desarrollador:

1. `STATUS.md` debe estar actualizado.
2. working tree debe conocerse/explicarse.
3. tests ejecutados deben listarse.
4. known failures deben declararse.
5. next story debe indicarse.
6. decisiones nuevas deben estar en docs/ADR.
7. no depender de “como vimos en el chat”.

---

# 9. Criterio de documentación suficiente

No buscamos documentación infinita. Buscamos que una persona competente pueda:

- entender el producto;
- levantarlo;
- saber dónde quedó;
- modificarlo sin romper principios;
- desplegarlo;
- recuperarlo;
- probarlo;
- vender/demostrar el MVP;
- justificar decisiones importantes.

Si una pieza de conocimiento necesaria sólo existe en la memoria de alguien, la documentación todavía no está completa.
