# Changelog

Todos los cambios relevantes del producto y de su documentación normativa se registran aquí.

Formato inspirado en Keep a Changelog. El producto utilizará Semantic Versioning cuando comience la implementación/release.

## [Unreleased]

### Added

- PORTAL-HUB-ROOT-ROUTE reemplaza el placeholder de `/` por un gateway responsive y accesible con enlaces canónicos a Consola de Operador (`/app/inbox`, badge `Principal / Milestone A`), Tenant Workspace (`/app`) y Platform Control (`/platform/tenants`).
- El gateway incorpora login real para identidades tenant y Platform mediante los endpoints existentes, cookies separadas, contraseña no persistida en navegador, normalización alineada al backend y destinos post-login limitados a una allowlist local. Las rutas protegidas redirigen al modo correcto cuando falta sesión; no se modificaron API, esquema ni migrations.
- Bootstrap operativo local: el entorno Compose verificado quedó con 1 Platform Admin activo, 0 tenants y 0 usuarios tenant. `pnpm platform-admin:create` leyó sus valores exclusivamente desde el `.env` ignorado por Git; PostgreSQL conserva Argon2id y login, `/platform/auth/me`, logout y revocación fueron verificados sin registrar email ni contraseña en documentación versionada.
- Reconciliación de alcance: PORTAL-HUB-ROOT-ROUTE es una tarea transversal, no una historia numerada; “Portal del Inquilino” significa Tenant Workspace y no implementa el Customer Portal de Epic 17. Conforme al backlog normativo, la siguiente historia sigue siendo `E08-S02 — Event dispatcher`, no “Rule Condition Evaluator & Predicate Execution Engine”.
- Corrección heredada: el formatter de Biome corrigió seis archivos de Inbox del commit base que impedían el gate global; fueron cambios mecánicos sin alterar lógica.
- Verificación PORTAL-HUB-ROOT-ROUTE: Vitest raíz 22 archivos/116 pruebas PASS; autenticación Nest/PostgreSQL 2 archivos/17 pruebas PASS (tenant 10/10, Platform 7/7); Biome 294 archivos sin errores; typecheck web, build de producción Next.js y QA visual desktop/móvil PASS. No requiere migration.
- E08-S01 implementa el modelo de datos, migración de esquema y API REST de administración de catálogo para el motor de reglas deterministas (Rules Engine) en `packages/database` y `apps/api`:
  - Modelo Prisma `Rule` en `packages/database/prisma/schema.prisma` y migración SQL `20260825120000_add_rules_engine_foundation`: IDs con UUIDv7, soporte multi-inquilino estricto, trigger types (`ON_MESSAGE_RECEIVED`, `ON_CONVERSATION_UNASSIGNED`, `ON_TAG_ADDED`, `ON_SCHEDULED_WINDOW`), execution modes (`first_match_stop`, `execute_all_matches`), estados (`draft`, `active`, `inactive`, `archived`), condiciones JSONB (`field`, `operator`, `value`), acciones JSONB (`actionType`, `parameters`), prioridad entera (1-10,000), cooldown y relaciones compuestas opcionales a `ChannelAccount` y `OrganizationUnit`.
  - `createRuleCatalogManager(...)` en `packages/database/src/rule-catalog-manager.ts` con CRUD completo, validación estructurada de esquemas de condiciones y acciones, revalidación de estado operativo del tenant, verificación del módulo `module.automation.basic` y emisión atómica de `AuditLog` y `DomainEventOutbox` (`rule.created`, `rule.updated`, `rule.deleted`).
  - Endpoints REST en `apps/api/src/rules.ts` (`POST /api/v1/rules`, `GET /api/v1/rules`, `GET /api/v1/rules/:ruleId`, `PUT /api/v1/rules/:ruleId`, `DELETE /api/v1/rules/:ruleId`), protegidos por los permisos `rules.read`/`rules.manage`, guardia de módulo `TenantEntitlementGuard` (`module.automation.basic`), DTOs fuertemente tipados y aislamiento cross-tenant 404 estricto.
  - Reconciliación documental E08-S01 en ADR-0031: el prompt mencionaba `module.rules.engine (o module.automation.basic)`; conforme a `DATA_MODEL_ERD_MVP_BACKLOG.md` y `SYSTEM_DESIGN.md`, la clave canónica de módulo es `module.automation.basic` y los permisos RBAC canónicos son `rules.read` y `rules.manage`.
  - Verificación E08-S01: 8 tests de integración de base de datos (`rule-catalog-manager.integration.ts`) y 8 tests de integración de API (`rules.integration.ts`) superados con 100% PASS; suite general Vitest (21 suites, 114 tests) PASS; Biome check en 291 archivos sin errores; TypeScript typecheck en 18 workspaces PASS.
- E07-S06 conecta el stream Server-Sent Events (`GET /api/v1/inbox/events`) en el cliente mediante `EventSource` con credenciales de sesión, aplicando reconciliación reactiva en memoria (`applyRealtimeEvent`) que inserta mensajes entrantes/salientes sin duplicados, progresa los estados de entrega en tiempo real, actualiza estados y reordena la lista de hilos elevando las conversaciones activas al tope.
- E07-S06 activa la ruta `/app/inbox` en la navegación lateral del workspace (`apps/web/app/app/tenant-app-navigation.ts`) protegida por el módulo `module.messaging.basic` y el permiso `conversations.read`.
- Reconciliación documental E07-S06 en ADR-0030: el backlog histórico conserva el rótulo `Human takeover policy`, pero ADR-0028/ADR-0029, `STATUS.md` y el prompt formal mandan la consola frontend del Inbox y el cliente de stream en tiempo real; se implementó el frontend completo de Inbox sin alterar silenciosamente el backlog.
- Verificación E07-S06: 21 suites unitarias en Vitest (113 pruebas, 20 en la suite de Inbox view model), typecheck de `@whatsapp-platform/web` y monorepo, 0 errores en Biome, y compilación de producción de Next.js (`pnpm --filter @whatsapp-platform/web build`) PASS. No requiere migration.

- E07-S05 agrega `GET /api/v1/inbox/events` como stream Server-Sent Events, protegido por `conversations.read`, `module.messaging.basic`, `module.crm_lite` y la cadena canónica de guards tenant. Incluye `Cache-Control` sin caché, conexión keep-alive y heartbeat `ping` cada 20 segundos.
- E07-S05 conecta el stream al `DomainEventOutbox` transaccional mediante un bridge live-only con cursor en memoria, sin reclamar ni mutar `publishedAt`, `attempts` o `lastError`. Publica por tenant los siete eventos `inbox.*` derivados de message received/sent, echo, external human, delivery status, conversation status y assignment.
- E07-S05 usa payloads SSE tipados y least-data: no expone `tenantId`, teléfonos, texto, URLs de media, provider IDs, credenciales ni payload raw; la cancelación limpia listeners y los eventos de Tenant A no alcanzan Tenant B. No agrega migration.
- Reconciliación documental E07-S05 en ADR-0029: el backlog todavía rotula E07-S05 como `Automation mode`, pero ADR-0028, `STATUS.md` y el prompt vigente mandan Realtime Push; se implementó SSE y se difirió automation mode sin reescribir silenciosamente el backlog. El prompt proponía `TenantAuthGuard`, pero la autoridad vigente conserva la cadena real de sesión/contexto/RBAC/entitlements.
- Verificación E07-S05: suite Inbox Docker 2 archivos/14 pruebas (12 integración API + 2 unitarias), `docker compose build api`, Prisma validate, migrate status (15 migrations up to date), Biome dirigido y `git diff --check` PASS contra PostgreSQL 18.4/Nest reales.

- E07-S04 agrega `PATCH /api/v1/inbox/conversations/:conversationId/status` y `/assignment`: lifecycle `new|open|pending|closed`, `closedAt`, asignación/desasignación de User/OrganizationUnit, detalle actualizado, 404 cross-tenant y 400 para transiciones o targets inválidos.
- E07-S04 usa `createInboxMutationManager(...)` con advisory lock tenant/channel/contact, actor activo, entitlements `module.messaging.basic` + `module.crm_lite`, AuditLog y DomainEventOutbox atómicos (`conversation.status_updated` y `conversation.assigned`). No agrega migration.
- E07-S04 protege ambas mutaciones con el permiso canónico `conversations.assign` y la cadena ordenada de guards tenant existente. La suite database dedicada pasa 5/5 y la suite API Inbox pasa 11/11 contra PostgreSQL/Nest reales; Prisma validate/migrate status (15 migrations up to date), TypeScript API/database, Biome (275 archivos), Vitest raíz (20 archivos/93 pruebas) y `git diff --check` PASS.
- Reconciliación documental E07-S04 en ADR-0028: el prompt proponía `conversations.manage`, `TenantAuthGuard` y `TenantAuditLog`, pero la autoridad manda `conversations.assign`, `TenantUserSessionGuard`/`TenantContextGuard`/`TenantPermissionGuard`/`TenantEntitlementGuard` y `AuditLog`/writer tenant-scoped. El backlog conserva el nombre corto “Assignment”; status se mantiene en scope por ADR-0027 y el prompt, sin cambiarlo silenciosamente. La siguiente story es E07-S05 Realtime Push.
- E07-S03 agrega `POST /api/v1/inbox/conversations/:conversationId/messages` para reply humano desde dashboard: body cerrado de texto/media, HTTPS público, sanitización, `201`, proyección least-data, idempotencia y validación de conversación/canal escribibles.
- E07-S03 reutiliza `createOutboundConversationMessageManager(...)` mediante un provider separado: crea `Message` outbound `human_app` y `OutboundMessage` en la transacción existente, actualiza timestamps y emite `message.queued`; registra `conversation.message_sent` en AuditLog sin cuerpo de mensaje.
- E07-S03 protege la mutación con `conversations.reply`, `module.messaging.basic` y `module.crm_lite`, deriva actor/tenant desde sesión/contexto y verifica RBAC, entitlements y 404 cross-tenant en la suite API 9/9; la regresión del manager outbound pasa 4/4.
- Verificación E07-S03: Prisma validate y migrate status (15 migrations up to date), TypeScript API/database, Biome (273 archivos), Vitest raíz (20 archivos/93 pruebas), `git diff --check`, Inbox API 9/9 y outbound conversation database 4/4 PASS contra PostgreSQL 18.4/Nest reales en Docker con source mounts.
- Reconciliación documental E07-S03 en ADR-0027: el prompt proponía `conversations.manage`/`contacts.write`, `TenantAuthGuard` y `TenantAuditLog`; la autoridad vigente manda `conversations.reply`, la cadena real de guards y `AuditLog`/writer tenant-scoped. No se inventaron permisos, aliases ni migraciones, y E07-S04 conserva status/assignment.
- E07-S01 con `createInboxQueryManager(...)` y `GET /api/v1/inbox/conversations`: listado tenant-scoped, filtros de estado/asignación/canal, búsqueda case-insensitive por contacto, orden estable con `NULLS LAST`, cursor base64url, `totalActive` y proyección least-data con `unread` derivado de timestamps existentes. No requiere migration.
- E07-S01 protege el endpoint con `conversations.read`, `module.messaging.basic` y `module.crm_lite`, deriva tenant desde sesión/contexto y prueba aislamiento A/B, RBAC, entitlement, tenant suspendido, filtros, búsqueda y cursor contra PostgreSQL/Nest reales.
- Reconciliación documental E07-S01 en ADR-0025: el prompt incluía detalle y `inbox.read`, pero el backlog/ADR/catálogo asignan detalle a E07-S02 y usan `conversations.read`; tampoco se inventaron read receipts, `unreadCount`, preview, WebSockets/SSE ni mutaciones. La cadena de guards se ordenó explícitamente porque el guard de entitlement a nivel de controlador rechazaba la sesión antes de resolver el contexto.
- E07-S02 extiende `createInboxQueryManager(...)` con detalle de conversación y timeline de `Message`, y agrega `GET /api/v1/inbox/conversations/:conversationId` más `/messages`. Las proyecciones son tenant-scoped y least-data; el detalle incluye contacto/canal/asignación y la timeline conserva actor, origen, delivery, timestamps, texto y `structuredPayload` para media.
- E07-S02 aplica cursor estricto `(createdAt,id)` con `before` descendente, `after` ascendente, `nextCursor`/`prevCursor`, límite 30/100, 404 genérico para hilos ausentes o cross-tenant y serialización ISO explícita. Requiere `conversations.read`, `module.messaging.basic` y `module.crm_lite`; no agrega migration ni mutaciones/realtime/UI.
- Reconciliación documental E07-S02 en ADR-0026: `displayName` canónico se mapea a `name` en el DTO solicitado; se reutiliza `ConversationNotFoundError`; `messageType` no se expone porque el DTO cerrado de la story enumera `structuredPayload` como superficie de media. No se renombraron columnas, permisos ni scope de historias posteriores.
- Verificación E07-S02: database 6/6 y API Nest/PostgreSQL 4/4, más Prisma validate, TypeScript API/database, Biome (264 archivos) y `git diff --check` PASS en contenedor reproducible.
- E06-S07 con `createDeliveryStatusManager(...)`: correlación tenant/canal/provider del `Message` canónico o su `OutboundMessage`, transiciones de entrega monotónicas, excepción explícita para `failed` desde `queued|sent`, CAS `PENDING -> PROCESSED` y Outbox idempotente `message.delivery_status_updated`. El dispatcher ya enruta `STATUS_UPDATE`/`DELIVERY_RECEIPT` y deja `PENDING` cuando la persistencia canónica aún no existe.
- E06-S07 actualiza `OutboundMessage` únicamente cuando la transición se acepta (`SENT/sentAt` o `FAILED/failedAt/lastError`), sanea errores y cubre flujo monotónico, out-of-order, fallos tardíos, duplicados y aislamiento A/B en suites dedicadas. No agrega tablas ni migrations, Inbox/API, WebSockets/SSE ni reglas/bots.
- E06-S07 corrige el reintento de un `fromMe` ya clasificado por E06-S06: un `OutboundEchoConflictError` se delega al fallback externo, que devuelve duplicado por `inboundEventId` o falla cerrado sin duplicar el Message.
- Reconciliación documental E06-S07 en ADR-0024: se usa `TenantContext` en lugar de `tenantId` raw; el `providerMessageId` objetivo se extrae de `normalizedData` y la clave de deduplicación del evento de recibo es explícita/determinística para no colapsar múltiples estados; `failed=-1` conserva la excepción `queued|sent -> failed`. La verificación PostgreSQL/typecheck queda pendiente por Docker Desktop y dependencias host incompletas.
- E06-S06 con `createExternalHumanMessageManager(...)`: los `fromMe` no correlacionados después del intento E06-S05 se persisten una sola vez como Message `outbound` de origen `human_external_device`, actor `external_human_unknown` y estado observado `sent`; se resuelve/crea Contact por destinatario, se actualiza la Conversation y se emite `message.external_human_detected` en Outbox transaccional.
- E06-S06 hace el fallback idempotente y tenant-safe, completa el `InboundMessageEvent`, conserva el reintento E06-S05 ante una carrera de correlación y cubre manager/dispatcher, aislamiento A/B, tenant suspendido y entitlement CRM Lite en la suite dedicada. La ejecución PostgreSQL/typecheck queda pendiente porque Docker Desktop no está disponible en esta sesión.
- Reconciliación documental E06-S06 en ADR-0023: el prompt pedía `actorType=external`, `lastMessagePreview`, tenant raw, resolución por sender y reabrir conversaciones cerradas; la autoridad del proyecto exige `external_human_unknown`, no añade preview/schema, deriva tenant desde `TenantContext`, usa `recipientPhone` y crea hilo nuevo tras `closed`. No se cambió silenciosamente el backlog ni se adelantó E06-S07.
- E06-S05 con `createOutboundEchoManager(...)` y `createInboundEventDispatcher(...)`: los echoes `fromMe` conocidos se correlacionan con el `Message` canónico de E06-S04 por tenant/canal/provider o por la cola `OutboundMessage`, completan el evento y emiten `message.echo_reconciled` en una transacción idempotente.
- E06-S05 deja `deliveryStatus`/`OutboundMessage.status` sin mutar y difiere `STATUS_UPDATE`/`DELIVERY_RECEIPT` a E06-S07. Los echoes no correlacionados quedan `PENDING` para E06-S06, sin crear mensajes especulativos.
- Tests E06-S05: outbound echo 5/5, regresión E06-S04 4/4 y E06-S03 5/5 contra PostgreSQL 18.4 real con source mounts; typecheck Docker/local, Biome y `git diff --check` PASS. No hay migration nueva; el build Docker nuevo quedó bloqueado por timeout de npm durante `pnpm install`.
- Reconciliación documental E06-S05: el prompt mezclaba E06-S06 (external human detection) y E06-S07 (delivery state), y pedía `external_device`/`external`; backlog/PRD/SYSTEM_DESIGN mandan. Se implementó sólo Echo reconciliation con valores canónicos y la decisión quedó en ADR-0022; el backlog no se reescribió silenciosamente.
- E06-S04 con migrations Prisma `20260820120000_add_outbound_message_correlation` y `20260820121000_align_outbound_message_fk_name`: `Message` outbound canónico enlazado tenant-aware a la cola `OutboundMessage`, `provider_timestamp` nullable para create-before-send, uniques de idempotencia/correlación e índices de timeline; la segunda migration corrige el nombre físico esperado por Prisma.
- `createOutboundConversationMessageManager(...)` crea `Message` y `OutboundMessage` en una misma transacción, deriva canal/contacto desde la Conversation del tenant, conserva actor/origen, actualiza timestamps y emite `message.queued`; no llama provider ni declara `message.sent` antes de confirmación.
- Tests E06-S04: outbound conversation database 4/4, regresión Conversation 5/5 e inbound Message 5/5 contra PostgreSQL 18.4 real; migration deploy/status, `prisma migrate diff` sin diferencias, database typecheck y Biome PASS. El CLI Prisma del host está incompleto y las comprobaciones Prisma se ejecutaron en Docker.
- Reconciliación documental E06-S04: el prompt adjunto incluía Inbox/listado/reply, el permiso no catalogado `conversations.manage`, `unreadCount`/preview y nombres/estados no canónicos; backlog/PRD/SYSTEM_DESIGN/ADR-0020 mandan. Esas piezas no se implementaron y quedan para Epic 07/E06-S05-E06-S07 según su alcance normativo; `conversations.read`/`conversations.reply` existentes no se alteraron y la decisión queda en ADR-0021.
- E06-S03 con `Message` tenant-owned y migration Prisma `20260820100000_add_messages_foundation`: UUIDv7, contenido normalizado, provider timestamp, referencias tenant-aware y FKs restrictivas; deduplicación por `(tenant_id, channel_account_id, provider_message_id)` e `inbound_event_id`.
- `createInboundMessageManager(...)` completa el pipeline inbound en una transacción: reutiliza el resolver de Conversation, persiste el mensaje, actualiza timestamps, cambia el evento `PENDING` a `PROCESSED` y escribe Outbox `message.received`; carreras y reintentos son idempotentes y tenant-safe.
- Tests E06-S03: persistencia inbound 5/5 y regresión Conversation 5/5 contra PostgreSQL 18.4 real; `db:validate`, `db:generate`, migration deploy, typecheck de database, Biome y aislamiento A/B verificados. Inbox/API y outbound permanecen en las historias normativas correspondientes.
- Reconciliación documental E06-S03: el prompt proponía `ConversationMessage`, `onDelete: Cascade`, `lastMessagePreview/unreadCount` y endpoints de Inbox/outbound; PRD/backlog/ADR-0019 mandan, por lo que se implementó `Message`, FKs `RESTRICT`, timestamps canónicos y sólo persistencia inbound.
- E06-S02 con `Conversation` tenant-owned y migration Prisma `20260819230000_add_conversations_foundation`: UUIDv7, lifecycle y automation modes canónicos, referencias tenant-aware a canal/contacto/asignación, índices de resolución y FKs restrictivas.
- `createConversationManager(...)` implementa resolución inbound tenant-safe: deriva canal y teléfono desde `InboundMessageEvent`, reutiliza/crea Contact en la misma transacción, reabre `new|pending` como `open`, crea hilo tras `closed`, aplica advisory lock tenant/canal/contacto y emite Audit + Outbox atómicos.
- Tests E06-S02: Vitest raíz 20 archivos/93 pruebas, Conversation resolver 5/5, regresión Contact 5/5 e Inbound 3/3 contra PostgreSQL 18.4 real; migration deploy/status, TypeScript/build de workspaces Docker, Biome y `git diff --check` verificados. La exportación/tag final de la nueva imagen Docker no terminó y no se marca runtime API como PASS.
- Reconciliación documental E06-S02: el prompt adjunto mezcla resolver, mensajes e Inbox/API y usa estados no canónicos; el backlog/PRD tienen precedencia. `ConversationMessage`, completion de inbound, Inbox/API y assignment/reply se difieren a E06-S03/Epic 07 y la decisión queda en ADR-0019.
- E06-S01 con `Contact` tenant-owned y migration Prisma `20260819200000_add_contacts_foundation`: identidad primaria por teléfono E.164 única por tenant, estado `ACTIVE|BLOCKED|ARCHIVED`, tags y custom attributes JSONB, con FK restrictiva e índices tenant-safe.
- Normalizador puro de teléfonos con separadores, formatos local/nacional/internacional, default explícito de México y conversión legacy `+521...` → `+52...`; `ContactManager` con find-or-create concurrente, CRUD/listado, block/archive, revalidación de tenant operativo, advisory lock y Audit + Outbox atómicos.
- API `POST/GET/PATCH/DELETE /api/v1/contacts` con permisos canónicos `contacts.read`/`contacts.write`, respuestas 201/409/400/404/403, DTO cerrado, 404 cross-tenant y sin aceptar tenant IDs del cliente; requiere entitlement `module.crm_lite` vía `@RequireEntitlements` + `TenantEntitlementGuard`.
- E06-S01 deja explícitamente `ContactPoint`/identidades omnicanal, Conversations/Messages, asociación de webhooks, CRM pipeline y UI para historias posteriores. La proyección `Contact.phoneNumber` es la decisión acotada de esta historia y no sustituye el modelo omnicanal futuro.
- Tests E06-S01: suite raíz 20 archivos/93 pruebas, database 5/5, API 3/3 y RBAC 11/11 contra PostgreSQL 18.4/Nest reales; migración, TypeScript, Biome y aislamiento verificados. La compilación Docker de workspaces pasó, pero la exportación/tag final de la nueva imagen no se reporta como PASS.
- E05-S03 con `OutboundMessage` tenant-owned y migration Prisma `20260819184530_add_outbound_messages_foundation`: idempotencia por tenant, estados operativos, lease/retry/DLQ, índices de cola y FKs restrictivas.
- Manager outbound tenant-safe con revalidación de tenant operativo, entitlement, canal y actor; transiciones persistidas con Outbox, deduplicación por idempotency key y error sanitizado.
- API `POST/GET /api/v1/channels/:channelId/messages` con respuesta `202`, payload cerrado, validación de teléfono/media y lectura de estado least-data; usa el permiso canónico `channels.manage`.
- Dispatcher detrás del `MessagingProvider` SPI y worker de polling PostgreSQL con retry/backoff, timeout, concurrencia 5, rate limit por canal de 5 mensajes/segundo y recuperación de leases; no se añadió BullMQ porque el fallback de polling está permitido y no existe la dependencia en el monorepo.
- Verificación E05-S03: suites dispatcher 3/3, database 4/4, API 3/3 y worker 1/1 contra PostgreSQL/Nest reales; regresión raíz 19 archivos/90 pruebas, migración/status, Biome, typecheck/build Docker y Compose runtime saludables.
- E05-S03 mantiene fuera de alcance providers WhatsApp reales, Contacts, Conversations, UI de envío y adapter BullMQ futuro.
- E05-S02 con normalización inbound pura para payloads genéricos/mock y Meta Cloud API, contexto confiable de tenant/canal, media, receipts, timestamps y fallback `UNKNOWN`; WPPConnect queda en el parser genérico y no se presenta como provider real implementado.
- `InboundMessageEvent` tenant-owned y migration Prisma `20260818110000_inbound_message_event_foundation`, con UUIDv7, JSONB raw/normalized, estados de procesamiento, índices tenant/channel/status, deduplicación por `(tenant_id, channel_account_id, provider_message_id)` y FKs restrictivas alineadas con la autoridad vigente del modelo.
- Manager de ingestión con revalidación de tenant operativo + `module.messaging.basic`, persistencia atómica de evento y Outbox `messaging.inbound.event_received`, deduplicación segura incluso ante carreras `P2002`, sin doble fila ni doble notificación.
- Webhooks públicos `GET/POST /api/v1/webhooks/whatsapp/:channelId` y `POST /api/v1/webhooks/whatsapp/mock/:channelId`, handshake Meta, HMAC raw-body, límite JSON de 256 KB, ACK rápido y resolución de tenant exclusivamente desde `ChannelAccount`; secretos sólo via ciphertext de credenciales.
- Tests E05-S02: normalizer 3/3, database 3/3 y API 4/4 contra PostgreSQL 18.4/Nest reales en Docker; sin Contacts, Conversations, UI ni provider WhatsApp real.
- Reconciliación documental registrada: el backlog histórico aún llama a E05-S02 “Baileys adapter”; esta historia siguió el prompt vigente y el STATUS operativo sin reescribir silenciosamente ese backlog.
- E05-S01 con `@whatsapp-platform/messaging`: `MessagingProvider`/DTOs agnósticos, estados de mensaje, normalización inbound, firma HMAC, health y `MockMessagingProvider` con inspección en memoria y fallos configurables; la factory falla cerrado para providers reales aún no implementados.
- `ChannelAccount` tenant-owned y migration Prisma `20260818090000_messaging_channel_account_foundation`, con phone único por tenant para canales activos, credenciales AES-256-GCM fuera de la proyección pública, configuración y health/lifecycle fields, FK compuesta tenant/OUnit e índices tenant/status.
- Manager tenant-safe para listar, crear, actualizar y archivar canales con `module.messaging.basic`, `limit.channel_accounts`, advisory lock PostgreSQL, validación de OU, Audit + Outbox atómicos y ausencia de secretos en responses, summaries y payloads.
- API `GET/POST/PATCH/DELETE /api/v1/channels` y `POST /api/v1/channels/:channelId/test-connection`, con aliases `/app/channels`, permisos `channels.read`/`channels.manage`, 404 cross-tenant, paginación/filtro de estado, Mock health y errores cerrados para providers no disponibles.
- Suite E05-S01: 7 pruebas unitarias de messaging, 4 database y 5 API de integración contra PostgreSQL 18.4/Nest reales; `MESSAGING_CREDENTIALS_KEY` opcional se trata como no configurada cuando Compose la inyecta vacía y la API bloquea cualquier credencial sin clave válida.

- E04-S01 con `/app` tenant-authenticated, bootstrap tenant-safe, shell reutilizable responsive, navegación centralizada module/permission-aware, Home honesta y logout funcional sin datos demo ni caché persistente.
- E04-S02 con `packages/themes` (`@whatsapp-platform/themes`): schema canónico estricto de branding (version 1, cinco presets + custom, light/dark, colores `#RRGGBB` con contraste ≥ 3.0, logo HTTPS público sin hosts internos), presets de tokens light/dark y resolver fail-soft hacia el default `corporate-blue`.
- `GET /app/theme` y `PATCH /app/theme` con `tenant.settings.manage`, restablecimiento por `{}`, validación fail-closed 400 y logo (incluido null) condicionado al módulo `module.white_label` (403 `ENTITLEMENT_REQUIRED`).
- Repository tenant-scoped que persiste `brandingConfig` y escribe Audit `tenant.theme.updated` + Outbox homónimo en una transacción, sin URL de logo en summaries/payloads y con `requestId` saneado.
- Bootstrap `/app/bootstrap` con `branding` resuelto (tokens display-only, sin `brandingConfig` raw), shell con variables CSS scoped `--tenant-*`, `globals.css` migrado a tokens y CSS de plataforma intacto.
- Editor productivo `/app/settings/theme` con preset, modo claro/oscuro, colores custom con preview y logo (con White label); refresca bootstrap sin reload y el logo usa `referrerPolicy="no-referrer"` fuera del pipeline de optimización de Next.
- Suites dedicadas `pnpm test:integration:theme-engine` (7 database + 9 API) y regresiones auth (12 archivos/75 pruebas), bootstrap (5) y seguridad (9 + 37) contra PostgreSQL 18.4/Nest reales.
- E04-S03 con `createOrganizationUnitManager(...)` tenant-safe en `packages/database`: list/create/update con árbol tenant-consistent, invariante de root estructural inmutable (rename sí), prohibición de ciclos, tope de profundidad `ORGANIZATION_UNIT_MAX_DEPTH = 10` (constante de código documentada) y enforcement del límite efectivo `limit.organization_units`.
- Concurrencia del límite vía advisory lock PostgreSQL por tenant (`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(...))`) dentro de cada transacción, con rechazo `Prisma.Decimal` exacto y `usage { used, limit }` en `list()`.
- Audit/outbox atómicos `organization_unit.created|updated` con summaries mínimos, actor `tenant_user`, rollback verificado si el outbox falla y sin cambio de schema (siete migrations intactas, sin migration 8).
- API `GET/POST/PATCH /app/organization-units` con `tenant.settings.manage`, DTO cerrado, respuestas least-data, 404 cross-tenant sin revelar existencia y errores 409 con códigos `ORGANIZATION_UNIT_ROOT_INVARIANT`/`ORGANIZATION_UNIT_CYCLE`/`ORGANIZATION_UNIT_DEPTH_EXCEEDED`/`ORGANIZATION_UNIT_LIMIT_REACHED`.
- UI productiva `/app/settings/organization-units` con árbol por niveles, creación/edición inline, conflictos en español y refetch tras mutaciones, más navegación secundaria de settings compartida (Apariencia/Organización).
- Suites dedicadas `pnpm test:integration:organization-units` (11 database + 12 API) y regresión completa (database 13/92, auth 13/90, rbac, platform-tenants, detail, provisioning, entitlements, tenant-status, bootstrap, theme-engine e isolation) contra PostgreSQL 18.4/Nest reales.
- Fix de invariantes E04-S03: el tope de profundidad en reparent valida la subárbol completa (`newDepth + subtreeHeight > 10` rechaza, altura en memoria con `visited` defensivo → `ORGANIZATION_UNIT_CYCLE` ante datos corruptos), el límite exacto 9 + 1 = 10 permite el descendiente más profundo en profundidad 10 y la movida rechazada preserva el subárbol sin Audit/Outbox.
- Límite fraccional: el manager compara el próximo conteo exacto (`limit.lt(used + 1)` con `Prisma.Decimal`, sin `Number`), rechazando `limit = 3.5` con `used = 3` → `ORGANIZATION_UNIT_LIMIT_REACHED`; la semántica efectiva reutiliza `tenantEntitlementEffective(...)` (helper hoja tenant-safe, sin ciclo de imports).
- Fix verificado con `pnpm test:integration:organization-units` (14 database + 15 API) y regresiones database (13 archivos/95), auth (13/93), isolation (9+37), bootstrap (6), theme-engine (7+11), entitlements (3+5), tenant-status (3+4) y rbac (11+11); sin cambio de schema (siete migrations, cero drift) y sin migration 8.
- E04-S04 con gestión de usuarios tenant-scoped: alta con email normalizado y contraseña Argon2id, activación/desactivación lógica, revocación transaccional de sesiones/tokens, límite exacto de asientos activos y protección del último Owner tenant-wide.
- API de usuarios y roles con asignaciones completas atómicas, validación cross-tenant de roles/OUs, opciones tenant-owned, catálogo canónico de 29 permisos, Owner read-only, preservación de `scopeConstraints` y Audit + Outbox atómicos; sin cambio de schema y con siete migrations intactas.
- UI real `/app/users` con navegación no vacía, permisos efectivos separados para usuarios/roles, alta, estado, asignaciones, roles integrados agrupados por catálogo y confirmación explícita para ampliaciones.
- E04-S04 verificado con 23 pruebas database y 12 API de user management, regresiones de Organization Units y tenant detail, Vitest raíz 16 archivos/76 pruebas, Biome, TypeScript y build Docker con `/app/users`.

- Agent Skill canónica en `.agents/skills/whatsapp-platform-engineering/SKILL.md`.
- `AGENTS.md` raíz con instrucciones breves para cualquier agente.
- Adaptador Antigravity en `.agents/agents.md`.
- Repository foundation de Epic 00 con monorepo pnpm para `apps/`, `services/` y `packages/`.
- Next.js web bootstrap, NestJS API con `GET /health`, workers arrancables y boundaries vacíos de epics futuros.
- Tooling compartido de TypeScript strict, Biome, Vitest, build y lockfile reproducible.
- `packages/config` con configuración tipada, validación, overrides, separación secret/non-secret y pruebas.
- Docker development baseline con PostgreSQL, Redis, API, web y workers.
- `.env.example`, ignores y Dockerfile de desarrollo sin secretos reales.
- E01-S01 con Prisma ORM 7.9.1 dentro de `packages/database`, Prisma Client generado y adapter PostgreSQL oficial.
- Migration inicial versionada para `PlatformDeployment`, `Tenant`, `TenantEntitlement`, `PlatformFeatureFlag` y `OrganizationUnit`.
- Scripts reproducibles de Prisma y suite de integración con nueve pruebas contra PostgreSQL real.
- ADR-0011 formaliza Prisma como ORM dentro del boundary de database.
- E01-S02 con defaults PostgreSQL `uuidv7()` para las cuatro PK UUID surrogate existentes y valor inicial de `updated_at`.
- Segunda migration append-only y pruebas de integración UUIDv7/timestamps contra PostgreSQL 18.4.
- ADR-0012 formaliza UUIDv7, `TIMESTAMPTZ(3)`, UTC y PostgreSQL 18 como baseline mínima.
- E01-S03 con `TenantContext` UUIDv7 explícito y repositories tenant-scoped para `TenantEntitlement` y `OrganizationUnit`.
- Suite de aislamiento con dos tenants, lecturas/updates cross-tenant, inyección de tenant, FK jerárquica y `TransactionClient` reales.
- E01-S04 con `DomainEventOutbox`, writer tenant-safe append-only y `withTenantTransaction` sobre el mismo `TransactionClient`.
- Tercera migration append-only y pruebas PostgreSQL de commit/rollback atómico, defaults UUIDv7, campos físicos y payload JSONB.
- ADR-0013 formaliza Transactional Outbox, persist-before-publish y side effects externos sólo después del commit.
- E01-S05 con `AuditLog`, writer tenant append-only y writer platform disponible sólo desde el subpath privilegiado.
- Cuarta migration append-only y pruebas PostgreSQL de tenant/platform audit, FK tenant-aware de OrganizationUnit y atomicidad domain + audit + Outbox.
- ADR-0014 separa AuditLog de Timeline y formaliza summaries sanitizados, tenant injection y el boundary platform.
- E02-S01 con identidad `PlatformAdmin` separada, passwords Argon2id, bootstrap explícito y sesiones opacas revocables almacenadas server-side.
- Quinta migration append-only para `platform_admin` y `platform_admin_session`, con UUIDv7, timestamps UTC, token hash `BYTEA` unique y FK restrictiva.
- Endpoints Platform Admin login/me/logout, cookie protegida por entorno, validación Origin/CORS, rate limiting y audit transaccional platform.
- ADR-0015 formaliza hashing, cookie, expiración absoluta/idle, revocación, bootstrap y límites de la historia.
- E02-S02 con `User`, `UserSession` y `UserPasswordResetToken` tenant-owned, separados físicamente de Platform Admin.
- Sexta migration append-only con email unique por tenant, FKs compuestas tenant/user, hashes `BYTEA` y timestamps UTC.
- Login tenant por slug pre-auth, `/auth/me`, logout idempotente, revoke-all propio y password reset single-use de 15 minutos.
- `PasswordResetDelivery` limita el raw reset token a un port explícito; delivery operativo permanece pendiente sin exponer tokens por HTTP/log.
- ADR-0016 formaliza identidad tenant, sesiones opacas, pre-auth por slug y recuperación de contraseña.
- E02-S03 conecta la sesión Tenant User autenticada con el `TenantContext` canónico mediante guards ordenados de Nest, request/decorators tipados y contexto inmutable.
- `TenantDataAccessFactory` conecta explícitamente el contexto autenticado con `createTenantDataAccess(...)` sobre el cliente singleton, sin Prisma request-scoped ni contexto ambiental.
- Suite vertical API/PostgreSQL para contextos A/B, fuentes de tenant hostiles, sesiones inválidas, acceso tenant-scoped real y requests concurrentes.
- E02-S04 con suite de seguridad dedicada `pnpm test:security:tenant-isolation`: matriz A/B de repositories, auth/context, IDs/FKs hostiles, atomicidad, concurrencia y boundary de imports privilegiados.
- Cobertura ejecutable para todas las superficies tenant-owned actuales; los modelos/endpoints posteriores quedan explícitamente diferidos hasta existir.
- E02-S05 con modelos `Role`, `Permission`, `UserRole` y `RolePermission`, FKs tenant-aware, catálogo canónico de 29 permisos y sync explícito idempotente.
- Resolver tenant-wide fail-closed, `@RequirePermissions`, `TenantPermissionGuard` y suite PostgreSQL/Nest para escalación, OU/constraints, ALL, 401/403 y revocación inmediata.
- ADR-0017 formaliza autorización granular por permission keys, templates globales no asignables y ausencia de snapshots/caché de permisos.
- E03-S01 con `GET /platform/tenants`, protegido sólo por sesión Platform Admin, query cross-tenant privilegiada y proyección administrativa least-data.
- Tenant list productiva en Next.js con búsqueda, filtro de estado, paginación, tabla responsive y estados loading/empty/error/loaded.
- Suite PostgreSQL/API/frontend para deployments, módulos efectivos, users reales, actividad observada, auth Platform y `channelCount = null` hasta existir `ChannelAccount`.
- E03-S02 con `POST /platform/tenants`, servicio de aplicación y repository privilegiado para provisionar Tenant, Owner, seis roles, grants Owner, root OU, entitlements, limits, Audit y Outbox en una transacción.
- Wizard productivo `/platform/tenants/new` con empresa, capacidades, Owner, revisión, errores seguros y retorno al listado con confirmación.
- Catálogo cerrado de 14 module entitlement keys y suites PostgreSQL/Nest/frontend que cubren commit, rollback real, login inmediato, RBAC, aislamiento, auth Platform y validación fail-closed.
- E03-S03 con endpoints Platform Admin read-only para detalle, users y audit del tenant, protegidos exclusivamente por sesión Platform y consultas privilegiadas fuera del facade tenant-safe.
- Detalle least-data con General, unidad raíz, 14 módulos efectivos, cinco limits Decimal, uso real/parcial, deployment seguro y estados explícitos no disponibles para canales y backup.
- Pantalla productiva `/platform/tenants/[tenantId]` con ocho tabs, enlace desde el listado, carga diferida/paginada de Users/Audit y estados loading/empty/401/404/error sin fixtures ni mutaciones futuras.
- Suites PostgreSQL 18.4/Nest para aislamiento A/B, auth Platform, temporalidad, Decimal, paginación y ausencia de hashes, JSON privado, metadata deployment o payload sensible de Audit.
- E03-S05 con transiciones Platform-only `active ↔ suspended`, writer privilegiado idempotente/concurrente, `suspendedAt`, Audit/Outbox transaccionales y respuesta administrativa mínima.
- Assertion reusable de tenant operacional para futuros workers/jobs, bloqueo PostgreSQL por request de sesión Tenant, sin revocar sesiones ni modificar entitlements, RBAC o datos al suspender.
- Controles de suspend/reactivate en Tenant Detail con confirmación, estados de error y refetch; suite PostgreSQL/Nest para sesión, login/reset, A/B, idempotencia, Platform Control y rollback.
- E03-S04 con catálogo canónico cerrado de 14 módulos/cinco limits, resolver tenant-safe read-only, assertion reusable, `@RequireEntitlements` y guard PostgreSQL por request con error 403 estable.
- Mutations Platform-only para modules, limits y config opaca, con validación cerrada, Decimal exacto, disable no destructivo y upsert + Audit + Outbox atómicos.
- Controles productivos en la tab Módulos y suite vertical PostgreSQL/Nest para vigencia, misma sesión, RBAC + entitlement, aislamiento, concurrencia y rollback.

### Changed

- El contrato de ingeniería dejó de vivir en `platform_docs/SKILL.md`; todas las referencias explícitas apuntan a la única copia canónica.
- El estado operativo y los comandos de inicio ahora reflejan la implementación real de Epic 00.
- Epic 00 queda validado de extremo a extremo en Docker Desktop/WSL2 con los seis servicios saludables y endpoints API/web accesibles desde el host.
- El datastore principal requiere PostgreSQL 18 o superior mientras se utilice `uuidv7()` nativo.
- El entrypoint raíz de `packages/database` expone sólo acceso tenant-aware; Prisma raw queda en el subpath privilegiado `@whatsapp-platform/database/platform`.
- El facade tenant-aware expone Outbox sólo para append; lectura/publicación permanece infraestructura privilegiada futura.
- Epic 01 — Database Foundation queda PASS / COMPLETE con las historias E01-S01 a E01-S05 verificadas.
- E02-S01 — Platform Admin auth queda PASS; Epic 02 permanece IN PROGRESS y no incluye Tenant User auth ni RBAC.
- E02-S02 — Tenant user auth queda PASS; Epic 02 permanece IN PROGRESS y E02-S03 sigue pendiente.
- E02-S03 — Tenant context middleware queda PASS; Epic 02 permanece IN PROGRESS y E02-S04 es la siguiente historia.
- E02-S04 — Tenant isolation tests queda PASS; Epic 02 permanece IN PROGRESS y E02-S05 es la siguiente historia.
- E02-S05 — RBAC base queda PASS; Epic 02 — Authentication and Tenancy queda PASS / COMPLETE.
- E03-S01 — Tenant list queda PASS; Epic 03 — Super Admin permanece IN PROGRESS.
- E03-S02 — Create tenant queda PASS; Epic 03 — Super Admin permanece IN PROGRESS.
- E03-S03 — Tenant detail queda PASS; Epic 03 — Super Admin permanece IN PROGRESS y E03-S04 es la siguiente historia.
- E03-S04 — Module activation queda PASS; Epic 03 — Super Admin permanece IN PROGRESS y E03-S05 es la siguiente historia.
- E03-S05 — Suspend/reactivate tenant queda PASS; Epic 03 — Super Admin queda PASS / COMPLETE y E04-S01 es la siguiente historia.
- E04-S01 — App shell queda PASS; Epic 04 — Tenant Dashboard Shell permanece IN PROGRESS y E04-S02 es la siguiente historia.
- E04-S02 — Theme Engine minimal queda PASS; Epic 04 — Tenant Dashboard Shell permanece IN PROGRESS y E04-S03 es la siguiente historia.

### Fixed

- E06-S01 (fix) — `ContactsController` ahora valida entitlement `module.crm_lite` vía `@RequireEntitlements` + `TenantEntitlementGuard`, alineándose con el patrón de otros controllers (outbound-messages, channel-accounts); integration test actualizado con `enabledModules: ["module.crm_lite"]`.
- E04-S02 (fix) — `/app/bootstrap` oculta `branding.logo` cuando `module.white_label` no está efectivo (desactivado, schedule o expirado), preserva el `brandingConfig` guardado y `GET /app/theme`, y restaura el logo al reactivar el módulo sin relogin ni re-upload; sin cambio de schema.
- Compose construye una sola vez la imagen compartida de aplicación y evita la colisión concurrente `image ... already exists`.
- El usuario runtime `node` reutiliza la caché preparada de Corepack/pnpm sin intentar descargas desde redes internas.
- `app-network` permite los bindings localhost de API/web mientras `data-network` conserva el aislamiento de PostgreSQL y Redis.

### Decided

- pnpm workspaces es el único package manager.
- Node.js 24 LTS, pnpm 11, Next.js 16, NestJS 11 y TypeScript 6 forman la baseline compatible de Foundation.
- El workflow CI se pospone hasta contar con evidencia del proveedor mediante remote o decisión documental.
- `tenant.slug` es globalmente único en la baseline y cada tenant tiene como máximo una fila efectiva por `entitlement_key`; vigencias complejas se posponen hasta existir un requisito real.
- Las PK internas surrogate usan UUIDv7 con tipo físico PostgreSQL UUID y generación default nativa mediante `uuidv7()`; claves naturales deliberadas como `PlatformFeatureFlag.key` se conservan.
- Los instantes persistentes usan `TIMESTAMPTZ(3)` con semántica UTC; Prisma mantiene `updated_at` y raw SQL debe mantenerlo explícitamente.

### Not yet implemented

- Module activation, suspend/reactivate, matriz de grants para roles distintos de Owner, MFA, delivery real de password reset, providers WhatsApp, contactos/conversaciones, Rules Engine, agenda, cotizaciones, documentos, IA funcional y backups reales.

## [0.0.0-preimplementation] - 2026-08-12

### Added

- PRD maestro, modelo de datos/ERD/backlog, System Design, estrategia de seguridad/pruebas/deployment, runbooks, roadmap, material de demo/venta y ADRs base.
- Baseline visual aprobada en `design-prototype/`.

### Decided

- Un repositorio y cero forks permanentes por tenant.
- SaaS shared, dedicated y customer-hosted sobre la misma base.
- PostgreSQL como fuente de verdad; Redis/BullMQ para ejecución.
- Mensajería por providers abstraídos, rules-first e IA opcional.

[Unreleased]: #
[0.0.0-preimplementation]: #
