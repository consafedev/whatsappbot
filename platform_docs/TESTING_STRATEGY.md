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

## Matriz ejecutable actual (E02-S04)

La matriz dedicada se ejecuta con `pnpm test:security:tenant-isolation` contra PostgreSQL 18 con las migrations aplicadas. En la baseline actual cubre:

- `TenantEntitlement` y `OrganizationUnit`: reads tenant-scoped, mutation de entitlements sólo desde Platform, IDs ajenos, inputs hostiles, jerarquía y FK compuesta;
- `ChannelAccount`: list/create/update/archive y test de provider con Tenant A/B, 404 cross-tenant en read/PATCH/DELETE, phone activo duplicado, límite exacto, OU cross-tenant, ciphertext ausente de respuestas/Audit/Outbox y rollback atómico;
- `AuditLog` y `DomainEventOutbox`: tenant inyectado, separación A/B, atomicidad commit/rollback y acceso privilegiado no exportado por el facade tenant;
- `User`, `UserSession` y `UserPasswordResetToken`: mismo email en tenants distintos, credenciales/sesiones/reset cross-tenant, revocación, expiración y FKs compuestas;
- `/auth/me`, `/auth/logout` y `/auth/sessions/revoke-all`: el contexto deriva sólo de la sesión autenticada y no de body, query, header, route param ni cookie de plataforma;
- requests y transacciones concurrentes A/B sobre el mismo cliente sin contaminación de contexto;
- revisión arquitectónica de imports privilegiados para impedir Prisma raw en caminos tenant-owned.

`Message`, `Conversation`, `Process`, `ActionRequest`, `Quote`, `Document`, portal grants y jobs tenant-owned permanecen **DEFERRED** porque sus modelos/repositories/endpoints aún no existen. Cada superficie se incorpora a esta suite en la historia que la implemente; no se crean modelos anticipadamente sólo para satisfacer la matriz normativa.

---

# 5. Entitlements

Probar:

- UI state no suficiente; API rechaza;
- module disabled preserva data;
- channel limit enforced under concurrency;
- worker rechecks entitlement para side effect;
- manual override expiry.

## Matriz ejecutable actual (E03-S04)

`pnpm test:integration:entitlements` ejecuta tres pruebas database y cinco pruebas API contra PostgreSQL 18.4/Nest reales. Cubre:

- boundaries exactos `startsAt <= now` y `endsAt > now`, además de ausencia, disabled, scheduled y expired;
- resolver read-only y assertion reusable tenant-scoped, sin input `tenantId` controlado por caller;
- una misma sesión válida antes y después de disable/enable, con consulta PostgreSQL por request;
- Permission presente + módulo disabled, módulo enabled + Permission ausente y ambos presentes;
- múltiples requirements con semántica ALL y 403 `ENTITLEMENT_REQUIRED` estable;
- aislamiento A/B, body/query/header hostiles y rechazo de mutations desde identidad Tenant;
- catálogos cerrados, type-tests y rechazo 400 de keys desconocidas/DTOs abiertos;
- config object-only con replace total, 16 KiB/profundidad 10, fechas resultantes válidas y Decimal exacto mayor que `Number.MAX_SAFE_INTEGER`;
- unique `(tenant_id, entitlement_key)`, upsert concurrente y atomicidad entitlement + Audit + Outbox, incluido rollback forzado.

Los limits se administran en esta historia, pero su enforcement de usage queda en la historia propietaria de cada operación. Los workers futuros deben invocar `assertTenantModuleEntitled(...)` inmediatamente antes de una acción costosa o con side effects; no existe cache Redis ni snapshot de entitlement en sesión.

---

# 6. Tenant suspension lifecycle

`pnpm test:integration:tenant-status` ejecuta tres pruebas database y cuatro API contra PostgreSQL 18.4/Nest reales. Cubre:

- transiciones exclusivas `active → suspended` y `suspended → active`, estados no administrables 409, `suspendedAt` UTC, re-suspend posterior e idempotencia sin eventos duplicados;
- Tenant status + Audit + Outbox en una transacción y rollback cuando falla Outbox, incluida concurrencia sin una segunda transición real;
- misma cookie válida antes de suspensión, 401 durante suspensión y 200 tras reactivar sin crear ni revocar la sesión;
- login y password reset con respuestas públicas genéricas durante suspensión; sesiones expired, revoked o de User disabled no reviven;
- barrera status antes de RBAC/entitlement, request/body/query hostiles y aislamiento A/B;
- Platform list/detail/users/audit y mutations de entitlements disponibles mientras el tenant está suspended;
- snapshots de sessions, roles, permissions, entitlements, limits y config sin mutación durante suspend/reactivate.

Los workers/jobs futuros deben revalidar `assertTenantOperational(...)` justo antes de un side effect externo o costoso, y luego `assertTenantModuleEntitled(...)` si aplica. No confiarán en el estado capturado al encolar; E03-S05 no cancela jobs ni modifica providers.

---

# 7. RBAC/scopes

## App shell bootstrap (E04-S01)

`pnpm test:integration:tenant-app-bootstrap` usa PostgreSQL 18.4/Nest real para comprobar identidad derivada de sesión, respuesta least-data, módulos/permissions efectivos, cambios con misma sesión, logout, suspensión y estados inválidos. La navegación tiene pruebas puras para gating compuesto y ausencia de `href="#"`; su visibilidad es UX y no reemplaza guards API.

Matriz mínima:

- owner/admin/supervisor/agent/viewer;
- Organization Unit A vs B;
- approve quote;
- channel manage;
- user manage;
- process transition;
- public timeline update.

## Matriz ejecutable actual (E02-S05)

`pnpm test:integration:rbac` ejecuta la matriz RBAC sobre PostgreSQL 18:

- catálogo canónico exacto, sync repetible y preservación de permissions desconocidas;
- roles iguales en tenants distintos, key única dentro del tenant e inputs sin `tenantId`/`isSystem`;
- FKs User/Role/Organization Unit cross-tenant y templates globales no asignables;
- unión de múltiples roles, nombres Owner/Viewer no autoritativos y semántica ALL;
- assignments OU-scoped y grants constrained ignorados por el resolver tenant-wide;
- unknown permissions fail-closed y revoke efectivo en la siguiente request sin relogin;
- pipeline 401/403/200 y request tenant overrides hostiles.

La suite `pnpm test:security:tenant-isolation` incorpora además `Role`, `UserRole` y `RolePermission` a la matriz A/B. Resource/OU-aware authorization y la default permission matrix quedan diferidas hasta sus historias propietarias.

---

# 6.1 Platform tenant list (E03-S01)

`pnpm test:integration:platform-tenants` ejecuta una suite dedicada sobre PostgreSQL 18 y Nest real:

- sesiones Platform válidas, ausentes, revocadas y con admin disabled; una cookie Tenant User real nunca autoriza el control plane;
- proyección segura sin hashes, sessions, JSONB privado, base URL ni metadata de deployment;
- tres tenants con status, deployment/health, módulos efectivos por vigencia, conteo real de users y actividad observada;
- `lastActivityAt` toma el máximo entre `UserSession.lastSeenAt` y `AuditLog.occurredAt`, o `null` si no existe actividad;
- `channelCount` permanece `null` hasta que Messaging implemente `ChannelAccount`;
- búsqueda case-insensitive, filtro de status canónico, paginación estable y validación 400;
- estados web loaded/empty/error/401, labels explícitos de módulos y em dash para datos no disponibles;
- el query cross-tenant sólo se exporta desde `@whatsapp-platform/database/platform`.

La query usa dos operaciones Prisma de nivel superior por página (`count` y `findMany` con agregados/relations), sin operaciones por tenant ni caché Redis.

---

# 6.2 Atomic tenant provisioning (E03-S02)

`pnpm test:integration:tenant-provisioning` ejecuta suites dedicadas sobre PostgreSQL 18 y Nest real:

- commit de Tenant activo, Owner, seis roles system tenant-owned, 29 grants Owner, assignment tenant-wide, root OU, módulos, cinco limits, Audit y Outbox;
- rollback físico de todas esas filas ante un error PostgreSQL controlado durante la creación de roles, sin cleanup compensatorio;
- catálogo de permisos incompleto falla cerrado antes de crear Tenant; el sync sigue siendo prerequisite explícito, no trabajo oculto de cada request;
- mismo email Owner en tenants distintos, IDs/assignments/roots/entitlements aislados y permissions globales compartidas;
- Platform Admin válido, ausente, revocado y disabled; cookie Tenant User nunca autoriza provisioning;
- login Owner inmediato, `/auth/me`, resolución de los 29 permissions y acceso a un endpoint de prueba protegido;
- slug conflict, module key desconocida, limits inválidos, campos extra y deployment inexistente sin recursos parciales;
- response, Audit y Outbox sin password ni hash, y Argon2id verificable en el User persistido;
- E03-S01 sigue mostrando el tenant creado con status, users, módulos, activity, deployment y channels diferidos correctos;
- frontend cubre módulos default, mapping del request y feedback 401/409 sin almacenamiento browser de contraseña.

El hash Argon2id se calcula antes de abrir la transacción. Dentro de `BEGIN/COMMIT` sólo ocurre persistencia PostgreSQL; no hay HTTP, email, filesystem, BullMQ ni otros side effects.

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
