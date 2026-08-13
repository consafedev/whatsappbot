# TESTING_STRATEGY.md — Estrategia de pruebas

**Versión:** 1.0  
**Fecha:** 2026-08-12

---

# 1. Objetivo

Proteger los riesgos reales del producto: aislamiento entre tenants, pérdida/duplicación de mensajes, estados inconsistentes, automatizaciones duplicadas, citas dobles, cotizaciones incorrectas, permisos indebidos, fallos de providers y recuperación tras reinicios.

No buscamos maximizar cobertura porcentual sin sentido; buscamos cobertura de invariantes y flujos comerciales.

---

# 2. Pirámide

## Unit

Rápidos, muchos, sin network real.

## Integration

PostgreSQL/Redis/adapters internos reales en entorno controlado.

## Contract

Misma suite contra cada provider adapter.

## E2E

Flujos críticos completos.

## Security/Recovery

Tenant escape, auth, restore, replay, duplicates.

---

# 3. Gates por PR

Obligatorios según stack real:

- lint;
- typecheck;
- unit tests;
- affected integration tests;
- migration checks si schema;
- no secrets scan;
- build.

Antes de merge a release branch/estable:

- full integration;
- isolation suite;
- contract tests relevantes;
- E2E critical path.

---

# 4. Tenant isolation suite P0

Crear Tenant A y B con datos equivalentes.

Probar que A no puede:

- leer contact B;
- leer conversation B;
- enviar message en ChannelAccount B;
- modificar process B;
- completar ActionRequest B;
- ver quote/document B;
- usar portal grant B;
- adivinar IDs;
- alterar tenant_id de request;
- aprovechar background job con ID B.

Añadir test por cada nuevo repository tenant-owned.

---

# 5. Entitlements

Probar:

- UI state no suficiente; API rechaza;
- module disabled preserva data;
- channel limit enforced under concurrency;
- worker rechecks entitlement para side effect;
- manual override expiry.

---

# 6. RBAC/scopes

Matriz mínima:

- owner/admin/supervisor/agent/viewer;
- Organization Unit A vs B;
- approve quote;
- channel manage;
- user manage;
- process transition;
- public timeline update.

---

# 7. Messaging contract tests

Cada adapter debe aprobar:

- connect lifecycle;
- normalize inbound text;
- normalize attachment;
- send outbound;
- provider id mapping;
- duplicate inbound handling;
- echo reconciliation;
- external human outbound classification cuando provider lo permite;
- disconnect;
- requires reauth;
- health normalization;
- malformed provider event.

No todos los providers soportan exactamente las mismas receipts; contract puede declarar capability flags.

---

# 8. Inbox E2E

Flujo:

1. inbound fixture/real sandbox;
2. contact created;
3. conversation created;
4. message visible;
5. rule response;
6. outbound persisted;
7. delivery updated;
8. human dashboard reply;
9. external-device echo fixture;
10. origin labels correct;
11. AUTO/HUMAN transition.

---

# 9. Rules Engine tests

- trigger matching;
- condition operators;
- multiple conditions;
- action execution order;
- disabled rule;
- invalid schema;
- missing entitlement;
- loop protection;
- max execution guard;
- idempotent re-delivery event;
- execution log.

---

# 10. Outbox/recovery

Simular:

- crash after DB commit before publish;
- publish twice;
- consumer crash after provider side effect before ack;
- Redis flush/restart;
- worker restart.

Resultado esperado: no perder estado y no duplicar side effects gracias a idempotencia/reconciliation.

---

# 11. Process Engine

- valid transition;
- invalid transition;
- required fields;
- unauthorized actor;
- definition version preserved;
- public/internal timeline;
- concurrent transitions;
- event emitted once logically.

---

# 12. Action Requests

- create;
- reminder;
- expire;
- complete from dashboard;
- complete from portal;
- complete from WhatsApp;
- duplicate completion;
- wrong recipient;
- upload validation;
- timeline/event.

---

# 13. Agenda

- timezone;
- business hours;
- exceptions;
- duration/buffer;
- double-book race;
- rebook;
- cancel;
- reminder idempotency;
- resource filtering.

---

# 14. Quote Engine

Golden cases:

- quantity;
- taxes;
- discounts;
- rounding;
- margin policy;
- approval threshold;
- autonomous-with-limits;
- snapshot immutability;
- send idempotency.

Nunca aprobar change que altere cálculo sin golden tests explícitos.

---

# 15. Document Engine

- all 10 themes render;
- logo size/aspect cases;
- special characters;
- long tables/pagination;
- reproducibility;
- no remote SSRF resource;
- template version stored;
- PDF exists/hash.

---

# 16. Portal

- valid grant;
- expired;
- revoked;
- wrong entity;
- internal timeline hidden;
- invisible document hidden;
- Action Request completes once;
- rate limit.

---

# 17. AI Gateway

Use fake providers in tests.

- task route selection;
- data classification reject;
- tenant AI disabled;
- provider down -> fallback;
- 429 -> eligible fallback;
- invalid structured output;
- redaction hook;
- no critical side effect direct from raw model output.

Real-provider tests are optional smoke tests and must not be required for deterministic CI.

---

# 18. Backup/restore

Before first paid client:

1. create representative DB/files;
2. backup;
3. verify encrypted artifact;
4. destroy isolated test environment;
5. restore;
6. run integrity checks;
7. boot application;
8. verify tenant/messages/process/files;
9. record drill result.

Repeat after material backup format changes.

---

# 19. Performance baseline MVP

Measure, not prematurely optimize:

- inbox list query;
- conversation pagination;
- inbound persist latency;
- rule dispatch latency;
- queue lag;
- document render time;
- QR worker memory per account;
- WPPConnect worker memory when added.

Create thresholds after first measurements.

---

# 20. Fixtures

Maintain deterministic fixtures:

- two tenants for isolation;
- legal process;
- workshop repair;
- dental appointment;
- distributor quote;
- channel/messages.

No production data in tests.

---

# 21. Bug regression rule

Todo bug relevante corregido debe agregar test que falle antes del fix cuando sea viable.

---

# 22. Release blocking failures

Bloquean release:

- isolation failure;
- unauthorized access;
- migration failure;
- data loss/duplicate critical side effect;
- quote calculation regression;
- backup/restore broken before paid production;
- provider adapter breaks current primary channel.
