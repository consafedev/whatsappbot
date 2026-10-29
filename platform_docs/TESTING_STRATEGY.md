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
- `InboundMessageEvent`: tenant/canal derivados desde la cuenta de provider resuelta por `channelId`, persistencia raw+normalized, Outbox atómico, deduplicación por provider message id, canal inactivo/no-entitled y aislamiento A/B;
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

- commit de Tenant activo, Owner, seis roles system tenant-owned, 31 grants Owner, assignment tenant-wide, root OU, módulos, cinco limits, Audit y Outbox;
- rollback físico de todas esas filas ante un error PostgreSQL controlado durante la creación de roles, sin cleanup compensatorio;
- catálogo de permisos incompleto falla cerrado antes de crear Tenant; el sync sigue siendo prerequisite explícito, no trabajo oculto de cada request;
- mismo email Owner en tenants distintos, IDs/assignments/roots/entitlements aislados y permissions globales compartidas;
- Platform Admin válido, ausente, revocado y disabled; cookie Tenant User nunca autoriza provisioning;
- login Owner inmediato, `/auth/me`, resolución de los 31 permissions y acceso a un endpoint de prueba protegido;
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

## 7.1 Inbound webhook ingestion (E05-S02)

Las suites dedicadas ejecutan normalizer unitario (3 pruebas), database (3 pruebas) y API (4 pruebas) contra PostgreSQL 18.4/Nest reales. La matriz mínima cubre:

- texto genérico/mock, imagen Meta, delivery receipt y payload malformado con `UNKNOWN` explícito;
- handshake Meta correcto/incorrecto y rechazo de UUID inexistente o canal inactivo;
- HMAC sobre el raw body, límite JSON de 256 KB y ACK HTTP 200 sólo después de commit del evento + Outbox;
- duplicate provider message id sin segundo evento ni segundo Outbox, incluido el camino de carrera `P2002`;
- entitlement `module.messaging.basic`, tenant suspendido y cross-tenant channel ID fail-closed;
- mock route sólo fuera de producción, sin Contacts/Conversations y sin afirmar provider real no implementado.

## 7.2 Outbound queue, dispatcher and worker (E05-S03)

Las suites dedicadas cubren la cola tenant-owned, las transiciones persistidas y el worker contra PostgreSQL 18.4/Nest reales:

- dispatcher unitario: 3 pruebas para envío de texto/media mediante el `MessagingProvider` SPI, clasificación fail-closed de errores y backoff determinista;
- database: 4 pruebas para idempotencia `(tenant_id, idempotency_key)`, `PENDING → SENDING → SENT`, retry agotado a `DLQ` con Outbox y aislamiento cross-tenant en enqueue/read/mutate;
- API: 3 pruebas para `202 Accepted` + estado `PENDING`, validación de teléfono/payload y 404 cross-tenant sin revelar existencia;
- worker: 1 prueba de integración con provider flaky que verifica retry de error de red, backoff y posterior `SENT`, incluyendo Outbox de fallo y éxito;
- regresión: `pnpm vitest run` con 19 archivos/90 pruebas; `db:validate`, generación y deploy/status de migration, Biome, typecheck/build Docker y runtime Compose también forman parte de la verificación;
- el worker revalida tenant operativo, entitlement y canal antes del side effect, usa timeout, lease recovery, concurrencia máxima 5 y límite por canal de 5 mensajes/segundo. PostgreSQL es la fuente de verdad; el polling es el fallback actual porque no hay dependencia BullMQ.

## 7.3 Contact identity and phone normalization (E06-S01)

Las suites dedicadas cubren el modelo Contact y la API contra PostgreSQL 18.4/Nest reales:

- unit: normalización E.164, limpieza de separadores, formatos local/nacional/internacional, México `+521...` → `+52...` y rechazo de entradas inválidas;
- database: 5 pruebas para persistencia tenant-owned, tags/JSONB, Audit + Outbox atómicos, find-or-create concurrente, unique de teléfono, block/archive, aislamiento A/B y revalidación de tenant suspendido;
- API: 3 pruebas para POST 201, normalización, duplicate 409, listado por búsqueda/tag, PATCH, DELETE/archive, payload inválido 400 y IDs cross-tenant 404;
- RBAC: regresión de catálogo cerrado con exactamente 31 permisos canónicos, incluyendo `contacts.read` y `contacts.write`;
- no se prueba aún asociación a `ContactPoint`, Conversations/Messages, webhooks ni UI porque esas superficies pertenecen a historias posteriores. PostgreSQL es la fuente de verdad; no se usa Redis para identidad de contactos.

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

ADR-0072 fija los goldens E15: decimal strings/BigInt, HALF_UP por línea a
precisión persistida0/2/3/4, descuentos fijos y porcentuales antes de impuesto
exclusivo, envío explícito sin impuesto y sumas exactas. Ejemplo:2.5×10.00,10%
descuento,8% impuesto,precisión2 →25.00 gross,2.50 descuento,1.80 impuesto,24.30
total de línea. Cubrir overflow, límites UTF-8/profundidad/200 líneas y totales
mayores que MAX_SAFE_INTEGER, sin confiar en importes de UI.

Por historia: A/B+ownership, módulos/permisos actuales, rollback audit/outbox,
recibos tras cambios/cancelaciones, concurrencia/locks, autores/decisor, política
revertida y reloj tras espera. S07 prueba display congelado tras cambios vivos;
S08 prueba varios canales pendientes y cancelación tras revocación, sin PDF ni
quote.sent. Cada migration nueva valida esquema limpio y upgrade relevante
antes de apply local y PG aislado. Tests omitidos/configuración sin DB no pasan.

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


## E14-S09 authenticated agenda UI verification (2026-10-27)

Final gates: root Vitest516/516 (56 files), web production build and explicit
web TypeScript, global Biome496 files, diff check; independent source review
closed API-limit, association, async ownership, modal, reminder and timezone
findings. No S09 backend/schema change; S08 is the latest full DB/API/worker/
isolation gate, not a new S09 count.

Browser protocol uses a disposable schema-only PostgreSQL clone (including raw
SQL checks), real provisioning/RBAC/auth and mock channel infrastructure.
Credentials/session live outside Git and are removed after the owned DB is
dropped. Production-mode QA builds must set NODE_ENV=production and the actual
NEXT_PUBLIC_API_BASE_URL; do not reuse a stale session as authenticated proof.

Verified critical cases:

1. Actual login; service create/edit withJPY decimal price, resource, weekly
   end24:00 and local-time exception; manager without tenant.settings.manage
   preserves unit links, and owner preserves the currently inactive option/GBP.
2. Domain-available overnight reservation Sunday23:30→Monday00:30 appears in
   next week/day/list with its original interval and explicit offset.
3. Availability uses max500/cursor continuation; conversation lookup uses max50
   and exact selected-contact identity. Source review additionally verifies that
   display paging retains the selected slot; this is not claimed as a separate
   browser page-navigation case.
4. Intercept only the first POST response after its real server commit, abort
   delivery, retry the unchanged UI command and prove identical key/one row;
   rebook while calendar is UTC and snapshot is Mexico City, then cancel.
   Verify lineage, child/task cancellation and no external outbound.
5. Tab/Escape/focus restoration in nested cancellation; busy creation survives
   Escape. Readonly active-detail has no mutations; disabled module direct
   route makes no agenda API request.
6. Desktop1440/tablet768/mobile390, mobile configuration/form, reduced motion,
   no body overflow and visual screenshots. Distinguish successful UI operations
   from harness locator/setup failures and do not claim a real handset send.

## E14-S10 rules-driven appointment booking

Run the migration from the published S09 schema through migration 36 into a
disposable PostgreSQL database. Validate the generated client and execute
DB/API/worker checks only against an explicitly owned prepared database. Do not print or copy the root
environment file. A skipped integration test, missing database URL, stale
client, or wrong database target is setup failure, not a passing result.
Keep already-applied migrations 34/35 unchanged and verify the 36-step upgrade.

Required cases:

1. Validate bounded rule action shape, one-action/trigger/execution-mode
   restrictions, tenant-owned active services/resources, at least one
   compatible active service/resource pair, Organization Unit scope, and
   Appointments plus optional Scheduling entitlement for reminder offsets.
   Exercise API permission combinations: appointment configuration requires
   both `rules.manage` and `appointments.manage`; deactivation/deletion may
   reduce authority with `rules.manage` alone.
2. Send normalized customer inbound through the persisted UNDECIDED placeholder,
   first-applicable rule routing and the numbered offer. Confirm create,
   cancellation and rebooking with the current flow-version token and verify
   appointment state, immutable lineage, audit/outbox and reminder state;
   cancellation suppresses old pending reminders and rebooking applies the
   central replacement reminder policy. CANCEL/REBOOK menus must exclude the
   same contact's appointments unless both service and resource IDs are in the
   rule target allowlists; final mutation must recheck the same condition.
3. Verify duplicate delivery and restart recovery: stored BOOKING receipts do
   not repeat mutations/outbound effects; an UNDECIDED→LEGACY recovery executes
   legacy actions once using the stored new-conversation flag; a committed
   LEGACY turn and a pre-cutover Message without a ledger do not replay or book.
   Include equal-priority/equal-createdAt rule ordering, creation-rule
   precedence, earlier `evaluate_all` legacy rules and duplicate inbound versus
   outbound echo handling.
4. Verify menu choices remain bound to the persisted offer after availability
   changes; stale/invalid numbers and confirmation tokens, expired flows,
   repeated confirmation, `SALIR`, contact/scope denial, AUTO/mode/takeover/
   pause changes and entitlement revocation fail closed without a duplicate
   appointment. Check that each queued prompt/ack stores its outbound purpose
   and exact flow phase/version; superseded prompts are suppressed at the final
   worker guard, and only valid terminal confirmation/customer-exit
   acknowledgments can outlive flow closure. Older queued booking replies
   without that binding fail closed.
5. Assert transaction rollback leaves no partial appointment, reminder,
   audit/outbox or outbound effects. Confirm provider IO occurs after commit.
   A mock-provider queue/dispatch test is not proof of delivery to a real
   handset.

Record fresh per-run test counts and gate outcomes only after executing the
final commands against the recreated schema and built packages. Pending counts
must remain unreported; do not carry forward S09/S08 counts as S10 evidence.

Final parent evidence2026-10-28: root Vitest528/528 in58 files; full DB379/379
in54; full API227/227 in27; worker-jobs1/1; outbound-worker3/3; dedicated
isolation9/9 database +37/37 API; zero skipped. The large outbound booking case
includes live mock sends of each prompt, terminal/exit ACKs and suppressed stale/
expired offers after an observed Rule lock wait. Scoped security17/17 also
passed, including real fault rollback/retry. Workspace builds passed after
scoped type/import corrections; root/web/DB types, Biome502 and diff passed.
Migration34–36 clean-schema +ordered S09 upgrade, local deploy and all applied
checksums passed; this is not pristine replay of the known historical BOM chain.

Full integration execution uses the existing package configs:
`node <absolute-repo-path>/node_modules/vitest/vitest.mjs run --config vitest.integration.config.mts --maxWorkers=2 --hookTimeout=60000`
from each relevant package (replace the explicit path placeholder), and the existing
`vitest.outbound-worker.config.mts` / `vitest.tenant-isolation.config.mts` for
worker/isolation. The disposable schema-only dump retains raw SQL CHECKs/partial
indexes. Prepared and full-run owned databases were removed after verification.
