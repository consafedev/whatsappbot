# ROADMAP.md — Ruta de producto orientada a ingresos

**Versión:** 1.0  
**Fecha:** 2026-08-12  
**Regla:** el roadmap expresa orden estratégico; las historias concretas viven en `DATA_MODEL_ERD_MVP_BACKLOG.md`.

---

# 1. Objetivo económico

Llegar al primer cliente pagado lo antes posible con un MVP realmente operativo, sin esperar a completar todos los módulos posibles.

El producto crece por vertical slices reutilizables ligados a necesidades comerciales reales.

---

# 2. Fase 0 — Cimentación

**Estado:** documentación avanzada.

Entregables:

- PRD;
- Data Model/ERD/Backlog;
- System Design;
- Skill;
- Index;
- ADRs;
- UI Flows;
- Design;
- Security;
- Testing;
- Deployment;
- Runbooks;
- Demo/Sales.

Exit criteria:

- otra IA/desarrollador puede continuar sin conversación original;
- Open Design puede producir UI sin inventar producto;
- backlog del vertical slice es claro.

---

# 3. Fase 1 — Milestone A: MVP vendible de automatización WhatsApp

**Prioridad:** P0 máxima.

Objetivo comercial:

> Conecta el WhatsApp del negocio, centraliza conversaciones, automatiza respuestas/acciones básicas y permite intervención humana desde la plataforma o WhatsApp.

Incluye:

- monorepo/base;
- auth;
- tenancy;
- Super Admin;
- entitlements;
- tenant shell;
- Organization Units base;
- Baileys;
- multi ChannelAccount;
- contacts/conversations/messages;
- inbox;
- human reply;
- external human sync;
- AUTO/HUMAN;
- Rules Engine básico;
- audit/logging/health.

Puede venderse a negocios con atención repetitiva aunque todavía no tengan Process/Agenda/Quote.

Exit criteria técnico:

Definition of Sellable MVP en System Design + tests P0 relevantes.

---

# 4. Fase 1.1 — Production hardening antes de primer cliente pagado

No necesita retrasar demos, pero sí producción pagada.

- security hardening;
- credential encryption;
- rate limit;
- backup Drive;
- two-copy rotation;
- restore drill;
- deployment reproducible;
- tenant isolation suite;
- operational runbooks.

---

# 5. Fase 2 — Milestone B: Process/Status Automation

Objetivo comercial:

> Tus clientes pueden consultar el estatus real de su pedido, expediente, reparación, trámite o servicio sin llamar constantemente.

Incluye:

- CRM Lite básico;
- Process Definitions;
- custom fields;
- statuses/transitions;
- process instances;
- Timeline internal/customer;
- WhatsApp status query flows;
- Process dashboard.

Nichos fuertes:

- abogados;
- contadores;
- talleres;
- logística;
- servicios técnicos;
- trámites;
- escuelas;
- manufactura/proyectos.

---

# 6. Fase 2.1 — Action Requests

Objetivo comercial:

> El sistema no sólo informa: solicita documentos, aprobaciones o datos y continúa el proceso automáticamente.

Incluye:

- upload_document;
- approve/reject;
- confirm;
- provide_information;
- reminders;
- expiration;
- internal/customer recipients;
- WhatsApp/dashboard completion.

Alta diferenciación comercial.

---

# 7. Fase 3 — Milestone C: Agenda y reservaciones

Objetivo comercial:

> Agendar, confirmar, reprogramar y recordar citas por WhatsApp con control humano.

Incluye:

- services;
- resources;
- availability;
- exceptions;
- booking;
- cancel/rebook;
- reminders;
- calendar UI;
- WhatsApp flow.

Nichos:

- dentistas;
- médicos;
- psicólogos;
- veterinarias;
- salones/spa;
- despachos;
- consultores;
- escuelas/tutorías;
- servicios técnicos con visitas.

---

# 8. Fase 4 — Milestone D: Catálogo + Cotización + Document Engine

Objetivo comercial:

> Convertir una solicitud de WhatsApp en una cotización profesional, calculada por reglas y aprobada o enviada automáticamente según política.

Incluye:

- catalog basic;
- quote draft;
- deterministic calculation;
- policy/autonomy levels;
- approval;
- quote snapshots;
- document renderer;
- logo/branding;
- 10 themes;
- send + timeline.

Nichos:

- distribuidores;
- refacciones;
- maquinaria;
- MRO;
- servicios;
- talleres;
- B2B general.

---

# 9. Fase 5 — Milestone E: Customer Portal

Objetivo comercial:

> El cliente puede entrar a un portal con la marca de la empresa para consultar estatus, movimientos, documentos y acciones pendientes.

Incluye:

- secure grants;
- branded shell;
- process status;
- public timeline;
- Action Requests;
- documents;
- account auth futuro.

Nichos especialmente valiosos:

- legal;
- contabilidad;
- logística;
- talleres;
- escuelas;
- proyectos/servicios.

---

# 10. IA — Track paralelo

No bloquea milestones deterministas.

Secuencia:

1. AI Provider contract.
2. OpenAI-compatible adapter.
3. provider/key management.
4. task routes.
5. health/fallback.
6. data classification/policy.
7. intent/entity extraction.
8. copilot suggestion.
9. semantic/catalog/FAQ capabilities según demanda.

IA se activa sólo donde genera valor medible.

---

# 11. Providers WhatsApp — evolución

1. Baileys — MVP.
2. WPPConnect — resiliencia/opción técnica adicional.
3. Meta — clientes que requieren API oficial.

No implementar 2/3 antes de tener razón comercial o estabilidad necesaria.

---

# 12. V1.5

Después de primeros clientes:

- advanced Rules Engine;
- Google Calendar integration;
- forms;
- richer reports;
- SLA/escalations;
- approvals generalized;
- white label/custom domain;
- WPPConnect;
- improved AI copilot;
- better CRM fields/search;
- improved onboarding/templates.

---

# 13. V2

- Meta adapter/onboarding;
- persistent customer portal accounts;
- Microsoft integrations;
- payments connectors;
- catalog/inventory integrations;
- CRM/ERP connectors;
- advanced quote workflows;
- richer automation builder;
- deployment/control-plane improvements;
- dedicated/customer-hosted management.

---

# 14. V3

Sólo después de product-market evidence:

- omnichannel;
- Temporal runtime si workflows lo justifican;
- plugin/marketplace;
- industry solution packs avanzados;
- advanced analytics;
- enterprise SSO;
- managed object storage/distributed infra;
- sophisticated billing/metering.

---

# 15. Regla para priorizar el siguiente módulo

Después de Milestone A:

```text
¿Existe prospecto real cercano a compra?
  Sí -> priorizar el módulo que desbloquea su caso si es reusable.
  No -> seguir Process/Status + Action Requests como horizontal de alto valor.
```

Nunca construir un módulo grande sólo porque “sería bueno tenerlo”.

---

# 16. Señales para adelantar Temporal

Reevaluar si:

- workflows duran semanas/meses;
- hay muchas señales/esperas externas;
- BullMQ reconciliation se vuelve compleja;
- customers demand strong workflow durability;
- incidentes muestran límites reales.

Crear ADR antes de introducir runtime.

---

# 17. Señales para mover infraestructura

No migrar por moda. Evaluar cuando:

- servidor cerca de capacidad sostenida;
- SLA/redundancia pagada lo exige;
- DB requiere HA;
- backups/restore ya no cumplen objetivos;
- dedicated tenant financia infraestructura;
- operación manual consume tiempo comercial.

---

# 18. Regla de revenue-first responsable

Podemos vender pilotos tempranos, pero no comprometer:

- aislamiento;
- backups;
- autorización;
- transparencia de limitaciones;
- datos.

Sí podemos posponer:

- UI sofisticada secundaria;
- analytics avanzados;
- múltiples providers;
- Temporal;
- omnichannel;
- marketplace.
