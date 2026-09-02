# Changelog

Todos los cambios relevantes del producto y de su documentación normativa se registran aquí.

Formato inspirado en Keep a Changelog. El producto utilizará Semantic Versioning cuando comience la implementación/release.

## [Unreleased]

### Added

- E10-S05 implementa el agente autónomo de WhatsApp, políticas de triaje, directivas de conocimiento y traspaso a operadores humanos (`Autonomous WhatsApp Agent, Triage Policy & Knowledge Directives`) en `packages/database` y `apps/api`:
  - Configuración del Agente Autónomo (`packages/database/prisma/` & `@whatsapp-platform/database`):
    - Modelo `TenantAiAgentConfig` en migración `20260902140000_add_tenant_ai_agent_config` (`automationMode`, `systemDirectives`, `virtualAliasKey`, `minConfidenceScore`, `humanHandoffKeywords`, `outOfHoursReply`, `isEnabled`).
    - Gestor `ai-agent-config-manager.ts` (`getTenantAiAgentConfig`, `upsertTenantAiAgentConfig`).
  - Orquestador del Agente de IA (`packages/database/src/ai-agent-dispatcher.ts`):
    - `processInboundAiTurn`: Evaluación del turno entrante con validación operacional y derecho `module.ai`.
    - Coexistencia con Takeover Humano: Si la conversación está en `automationMode === "HUMAN"` o con pausa activa, la IA se abstiene de intervenir.
    - Detección de Handoff a Humano: Identifica keywords configuradas (`"humano"`, `"asesor"`, `"agente"`), conmuta la conversación a `HUMAN`, emite `conversation.takeover_requested` en outbox y envía mensaje de aviso de traspaso sin respuesta de IA.
    - Generación RAG: Carga historial de mensajes (últimos 6), recupera fragmentos semánticos relevantes, inyecta citas en system prompt, enruta completion con `AiResilientRouter`, encola mensaje saliente atómico con `actorType: "AI_BOT"` y `metadata: { senderType: "AI_BOT", citations }`, y registra tokens en `AiUsageLog`.
  - Integración en Inbound Pipeline (`packages/database/src/inbound-event-dispatcher.ts`):
    - Flujo: Mensaje entrante -> Reglas deterministas -> Si las reglas no enviaron mensaje y el agente está habilitado en `HYBRID_RULES_AI` o `FULL_AI` -> `processInboundAiTurn`.
  - Endpoints REST en API Gateway (`apps/api/src/ai-agent-config.ts`):
    - `GET /api/v1/ai/agent/config`: Consulta de configuración del agente del inquilino.
    - `PUT /api/v1/ai/agent/config`: Actualización de directivas, umbrales y palabras clave de traspaso.
    - Protegidos por `TenantUserSessionGuard`, `TenantContextGuard`, `TenantPermissionGuard` (`ai.settings.manage`) y `TenantEntitlementGuard` (`module.ai`).
  - Documentación normativa en ADR-0046.
  - Verificación E10-S05: 4 pruebas de integración en `ai-agent-dispatcher.integration.ts` (100% PASS); 5 pruebas de integración en `ai-agent-config.integration.ts` (100% PASS); 275 pruebas unitarias del monorepo PASS; typecheck y lint en 0 errores.


- E10-S04 implementa el motor de Generación Aumentada por Recuperación (RAG), cálculo de similitud de coseno, inyección contextual con citas estructuradas y endpoints de consulta semántica (`Multi-Tenant RAG Engine, Vector Similarity Search & Knowledge Retrieval Pipeline`) en `services/ai-gateway`, `packages/database` y `apps/api`:
  - Motor Matemático y Formateador RAG (`services/ai-gateway/src/`):
    - `cosineSimilarity` y `rankChunksBySimilarity` (`vector-math.ts`): Cálculo puro de producto punto y magnitudes euclidianas normalizadas, filtrado por umbral `minScore` y ordenamiento top-K.
    - `buildRagContextPrompt` e `injectRagContextIntoMessages` (`rag-context-builder.ts`): Formateo de bloques delimitados de contexto con metadatos de cita (`documentTitle`, `chunkIndex`, `score` %) e inyección en mensajes de sistema.
  - Gestor de Búsqueda Semántica en Base de Datos (`packages/database/src/knowledge-search-manager.ts`):
    - `searchKnowledgeChunks`: Recuperación vectorial condicionada por `tenantId` y estado `INDEXED`, garantizando aislamiento A/B estricto.
  - Endpoints REST en API (`apps/api/src/`):
    - `POST /api/v1/ai/knowledge/documents/query`: Consulta semántica directa para diagnóstico.
    - `POST /api/v1/ai/completions/rag`: Orquestación RAG completa con embedding de consulta, búsqueda vectorial, inyección de citas, completado resiliente y registro de tokens en `AiUsageLog`.
    - Protegidos por `TenantUserSessionGuard`, `TenantContextGuard`, `TenantPermissionGuard` (`ai.settings.manage`) y `TenantEntitlementGuard` (`module.ai`).
  - Documentación normativa en ADR-0045.
  - Verificación E10-S04: 6 pruebas unitarias en `vector-math.test.ts` (100% PASS); 5 pruebas unitarias en `rag-context-builder.test.ts` (100% PASS); 2 pruebas de integración en `knowledge-search-manager.integration.ts` (100% PASS); 16 pruebas de integración en `knowledge-base.integration.ts` y `ai-gateway.integration.ts` (100% PASS).


- E10-S03 implementa la ingesta de documentos de base de conocimiento, particionado semántico recursivo, adaptadores de embedding y persistencia vectorial (`Knowledge Base Document Ingestion, Chunking & Vector Embeddings`) en `services/ai-gateway`, `packages/database` y `apps/api`:
  - Particionado Semántico y Abstracción de Embeddings (`services/ai-gateway/src/`):
    - `chunkText` (`text-chunker.ts`): Particionador recursivo sensible a estructura (párrafos, saltos de línea, terminaciones de oración y palabras) con solapamiento (*overlap*) configurable y sanitización de caracteres nulos (`\0`).
    - Adaptadores `AiEmbeddingProvider` (`services/ai-gateway/src/embeddings/`): `MockEmbeddingProvider` (vectores normalizados deterministas basados en hash), `OpenAiCompatibleEmbeddingProvider` (cliente para `/v1/embeddings` con timeout estricto de 15s) y `GoogleGeminiEmbeddingProvider` (`:batchEmbedContents`).
    - Fábrica `createEmbeddingProvider` unificando resolución de proveedores.
  - Base de datos y migración Prisma (`packages/database/prisma/` & `@whatsapp-platform/database`):
    - Migración `20260827200000_add_knowledge_base` creando las tablas `knowledge_document` y `knowledge_chunk` con claves compuestas `[tenantId, id]` para aislamiento estricto.
    - Gestor `knowledge-base-manager.ts` (`createKnowledgeDocument`, `indexKnowledgeDocument` con `$transaction` atómica, `getKnowledgeDocumentDetail`, `listKnowledgeDocuments`, `deleteKnowledgeDocument`).
  - Endpoints REST en API (`apps/api/src/knowledge-base.ts`):
    - `POST /api/v1/ai/knowledge/documents`: Creación e indexación automática con retorno 201 Created.
    - `GET /api/v1/ai/knowledge/documents`: Listado paginado con contador de fragmentos por documento.
    - `GET /api/v1/ai/knowledge/documents/:documentId`: Detalle del documento y vista previa de sus fragmentos.
    - `DELETE /api/v1/ai/knowledge/documents/:documentId`: Eliminación en cascada de documento y fragmentos.
    - Protegidos por `TenantUserSessionGuard`, `TenantContextGuard`, `TenantPermissionGuard` (`ai.settings.manage`) y `TenantEntitlementGuard` (`module.ai`).
  - Documentación normativa en ADR-0044.
  - Verificación E10-S03: 5 pruebas unitarias en `text-chunker.test.ts` (100% PASS); 7 pruebas unitarias en `embedding-providers.test.ts` (100% PASS); 5 pruebas de integración en `knowledge-base-manager.integration.ts` (100% PASS); 6 pruebas de integración en `knowledge-base.integration.ts` (100% PASS).


- E10-S02 implementa el motor de enrutamiento resiliente de modelos, cascada de failover entre rutas primarias y secundarias, gestión de límites de tarifa (429) con rotación y períodos de enfriamiento de claves y catálogo de alias virtuales (`Resilient Multi-Model Routing, Failover Cascade & Tenant Virtual Aliases`) en `services/ai-gateway`, `packages/database` y `apps/api`:
  - Enrutador de Resiliencia y Cascada de Failover (`services/ai-gateway/src/resilient-router.ts`):
    - `AiResilientRouter`: Ejecuta solicitudes ordenando rutas por `priority ASC` (1 = primario, 2 = secundario/fallback).
    - Rotación dinámica de API key ante error 429 con cooldown automático (60s) reintentando con la siguiente clave disponible en la bolsa sin conmutar de proveedor.
    - Conmutación automática a ruta secundaria ante errores de servidor (500), caídas de red o timeouts (`AiTimeoutError`).
    - Registro de cada intento intermedio `AiRoutingAttempt` y error normalizado `AiAllProvidersFailedError`.
  - Base de datos y migración Prisma (`packages/database/prisma/` & `@whatsapp-platform/database`):
    - Migración `20260827190000_add_ai_routing_and_aliases` creando las tablas `ai_virtual_alias` y `ai_model_route`.
    - Gestor `ai-routing-manager.ts` con funciones `createVirtualAlias`, `updateVirtualAliasRoutes`, `resolveRoutesForAlias`, `listTenantAliases` y `seedDefaultPlatformAliases`.
    - Sembrado automático de alias globales de plataforma: `platform-fast`, `platform-smart` y `platform-reasoning`.
    - Jerarquía de resolución: evalúa primero overrides del inquilino antes de los alias globales compartidos de plataforma.
  - Endpoints REST en NestJS (`apps/api/src/ai-gateway.ts`):
    - `GET /api/v1/ai/aliases`: Consulta de catálogo de alias disponibles para el inquilino.
    - `POST /api/v1/ai/completions/route`: Ejecución de completado con resolución automática de alias y failover en cascada.
    - Protegidos por `TenantUserSessionGuard`, `TenantContextGuard`, `TenantPermissionGuard` (`ai.settings.manage`) y `TenantEntitlementGuard` (`module.ai`).
  - Documentación normativa en ADR-0043.
  - Verificación E10-S02: 5 pruebas unitarias en `ai-resilient-router.test.ts` (100% PASS); 5 pruebas de integración en `ai-routing-manager.integration.ts` (100% PASS); 8 pruebas de integración de API en `ai-gateway.integration.ts` (100% PASS); suite general Vitest monorepo (31 archivos, 252 pruebas) 100% PASS; Biome check (0 errores); TypeScript typecheck (18 workspaces) 100% PASS.


- E10-S01 implementa la capa fundacional del AI Gateway, abstracción universal de proveedores de modelos de lenguaje, pooling dinámico de claves con balanceo y registro transaccional de consumo de tokens (`AI Gateway Universal Provider Abstraction, Key Pooling & Token Usage Ledger`) en `services/ai-gateway`, `packages/database` y `apps/api`:
  - Abstracción desacoplada de proveedores (`services/ai-gateway/src/`):
    - Interfaz `AiProvider` con soporte unificado de `generateCompletion` y `fetchAvailableModels`.
    - `OpenAiCompatibleProvider`: Adaptador HTTP universal para cualquier API compatible con OpenAI `/v1` (OpenAI oficial, DeepSeek, Groq, OpenRouter, vLLM, Ollama local) con timeout estricto de 15 segundos (`AbortSignal.timeout(15000)`).
    - `GoogleGeminiProvider`: Adaptador para la API de Google Gemini (`:generateContent` y consulta de modelos).
    - `MockAiProvider`: Adaptador determinista offline para ejecución en pruebas y entornos de CI.
    - `KeyPoolSelector`: Algoritmo de selección que prioriza claves activas con menor conteo de llamadas (`totalCalls`), respetando estados deshabilitados y períodos de enfriamiento por rate limit (`rateLimitedUntil`).
    - Criptografía AES-256-GCM (`v1.iv.tag.ciphertext`) para almacenamiento seguro de API keys y enmascaramiento estricto (`maskApiKey`).
  - Base de datos y migración Prisma (`packages/database/prisma/` & `@whatsapp-platform/database`):
    - Migración `20260827180000_add_ai_gateway_foundation` creando las tablas `ai_provider_config`, `ai_key_pool` y `ai_usage_log`.
    - Gestor `ai-gateway-manager.ts` con funciones de gestión multi-inquilino (`createAiProviderConfig`, `addKeyToPool`, `updateKeyStatus`, `resolveProviderAndKey`, `recordAiUsage`, `getTenantAiUsageSummary`).
    - Jerarquía de resolución: evalúa primero la clave BYOK configurada para el inquilino antes de recurrir a la clave compartida de plataforma configurada por Super Admin.
  - Endpoints REST en NestJS (`apps/api/src/ai-gateway.ts`):
    - `GET /api/v1/ai/models/discover`: Descubrimiento en vivo de modelos disponibles.
    - `POST /api/v1/ai/completions/test`: Prueba rápida de generación con registro automático en el ledger.
    - `GET /api/v1/ai/usage/summary`: Resumen agregado de consumo de tokens y costos en USD.
    - Protegidos por `TenantUserSessionGuard`, `TenantContextGuard`, `TenantPermissionGuard` (`ai.settings.manage`) y `TenantEntitlementGuard` (`module.ai`).
  - Documentación normativa en ADR-0042.
  - Verificación E10-S01: 16 pruebas unitarias en `ai-providers.test.ts` (100% PASS); 4 pruebas de integración en `ai-gateway-manager.integration.ts` (100% PASS); 5 pruebas de integración de API en `ai-gateway.integration.ts` (100% PASS); suite general Vitest monorepo (30 archivos, 247 pruebas) 100% PASS; Biome check (0 errores); TypeScript typecheck (18 workspaces) 100% PASS.


- E09-S04 implementa el flujo de eventos en tiempo real vía Server-Sent Events (SSE), sincronización reactiva de códigos QR y sistema de alertas en vivo de canales (`WhatsApp Channel Realtime Events Stream, Live QR Updates & Alerting`) en `apps/api` y `apps/web`:
  - Servicio SSE de canales `ChannelRealtimeService` y `ChannelRealtimeBroadcaster` en `apps/api/src/channel-realtime.service.ts`:
    - Almacenamiento en memoria de escuchas RxJS y clientes directos indexados por `tenantId` con aislamiento multi-inquilino estricto.
    - Método `broadcastToTenant(tenantId, event)` / `publishTenantChannelEvent(tenantId, event)` para eventos `channel.qr_generated`, `channel.connected`, `channel.disconnected`, `channel.reconnecting` y `channel.health_updated`.
    - Método `subscribeTenantChannelEvents(tenantId, heartbeatIntervalMs = 15_000)` con evento inicial `{ status: "connected" }` y latidos `event: "ping"` cada 15 segundos.
    - Método `addClient(tenantId, res)` con desuscripción y limpieza automática en eventos HTTP `close` y `finish`.
    - Componente puente `ChannelRealtimeOutboxBridge` (`apps/api/src/channel-realtime.service.ts`) con sondeo periódico cada 250ms a la tabla `DomainEventOutbox` para retransmitir eventos de outbox de canales de forma asíncrona.
  - Endpoint SSE de canales en `apps/api/src/tenant-channels.ts`:
    - `GET /api/v1/channels/events/stream` con cabeceras `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`, protegido por `TenantUserSessionGuard`, `TenantContextGuard`, `channels.read` y `module.messaging.basic`.
  - Integración en frontend React / Next.js (`apps/web/app/app/channels/`):
    - `channels-view-model.ts`: función de suscripción `subscribeToChannelEvents` mediante `EventSource` con `withCredentials: true`.
    - `channel-qr-modal.tsx`: actualización instantánea del código QR y su temporizador TTL de 30 segundos ante `channel.qr_generated` y transición inmediata a estado conectado exitoso ante `channel.connected`.
    - `channels-client.tsx`: suscripción de fondo a eventos SSE para actualizar el catálogo de canales y desplegar alertas toast inmediatas en reconexiones, desconexiones y conexiones exitosas.
  - Reconciliación documental E09-S04 en ADR-0041 y cierre de **Epic 09 (WhatsApp Channel Management)** al 100%.
  - Verificación E09-S04: 16 pruebas en `tenant-channels.integration.ts` y `channel-realtime.service.test.ts` (100% PASS); 21 pruebas en `channels-view-model.test.ts` (100% PASS); suite general Vitest monorepo (29 archivos, 231 pruebas) 100% PASS; Biome check (0 errores en 334 archivos); TypeScript typecheck (18 workspaces) 100% PASS; Next.js production build (`/app/channels`) 100% PASS. No requiere migration.

- E09-S03 implementa la consola web y componentes de interfaz de usuario para la gestión de canales de WhatsApp y el modal de emparejamiento QR en tiempo real (`WhatsApp Channel Web UI Management & Live QR Pairing Modal`) en `apps/web`:
  - View model desacoplado de cliente `channels-view-model.ts` en `apps/web/app/app/channels/`:
    - Tipos fuertemente tipados (`ChannelItem`, `ChannelHealthDiagnostic`, `QrPairingState`, `CreateChannelPayload`, `StatusBadgeDetails`, `QrTtlRemaining`).
    - Clientes REST desacoplados con manejo de errores `ChannelApiError` (`fetchChannels`, `createChannel`, `initiateChannelPairing`, `fetchChannelQr`, `disconnectChannel`, `fetchChannelHealth`).
    - Funciones puras y testeables (`formatChannelStatus`, `calculateQrTtlRemaining` para TTL de 30s con temporizador regresivo `mm:ss` y detección `isExpired`, `formatLatency`, `formatSocketStatus`, `formatRelativeTime`).
  - Componentes de interfaz de usuario de consola (`apps/web/app/app/channels/`):
    - `ChannelQrModal` (`channel-qr-modal.tsx`): Modal interactivo de emparejamiento con guía paso a paso, renderizado procedural SVG de QR con esquinas y patrones de alineación, temporizador de cuenta regresiva de 30s con barra de progreso, sondeo periódico inteligente cada 2 segundos con cancelación inmediata al cerrar o conectar, estado de expiración con regeneración de QR y pantalla de confirmación exitosa.
    - `ChannelHealthModal` (`channel-health-modal.tsx`): Modal de diagnóstico con cuadrícula de 4 estadísticas operativas (latencia ms, estado del socket, intentos de reconexión, último latido relativo/exacto), metadatos del canal y refresco en vivo.
    - `ChannelCreateModal` (`channel-create-modal.tsx`): Modal de registro de nueva línea con validación de nombre, unidad organizativa y proveedor (Baileys), abriendo automáticamente el modal QR.
    - `ChannelsList` (`channels-list.tsx`): Catálogo en cuadrícula responsiva con tarjetas de canal interactivas, badges de estado con indicadores de color, fila de metadatos de telemetría, accesos directos a "Vincular / Escanear QR", "Diagnóstico de Salud" y diálogo accesible de confirmación de desconexión segura. Incluye skeletons y empty states.
    - `ChannelsClient` (`channels-client.tsx`): Orquestador principal que valida permisos (`channels.read`, `channels.manage`) y derecho de módulo (`module.messaging.basic`), gestiona estados globales, notificaciones toast y control de modales.
    - `ChannelsPage` (`page.tsx`): Ruta canónica Next.js `/app/channels`.
  - Navegación de workspace (`apps/web/app/app/tenant-app-navigation.ts`):
    - Enlace canónico `/app/channels` habilitado para el ítem `channels` protegido por `module.messaging.basic` y `channels.read`.
  - Estilos CSS completos en `apps/web/app/globals.css`.
  - Reconciliación documental E09-S03 en ADR-0040.
  - Verificación E09-S03: 20 pruebas unitarias en `channels-view-model.test.ts` (100% PASS); 7 pruebas de navegación en `tenant-app-navigation.test.ts` (100% PASS); suite general Vitest monorepo (29 archivos, 230 pruebas unitarias) 100% PASS; Biome check (0 errores en 332 archivos); TypeScript typecheck (18 workspaces) 100% PASS; Next.js production build (`/app/channels`) 100% PASS. No requiere migration.

- E09-S02 implementa el monitor y gestor de salud de canales, política de reconexión con retroceso exponencial y endpoint de diagnóstico (`Channel Health Checks, Keep-Alive & Reconnection Engine`) en `packages/database`, `packages/messaging` y `apps/api`:
  - Gestor de salud y monitor `channel-health-manager.ts` en `packages/database`:
    - `recordChannelHeartbeat`: valida operatividad del tenant y persiste `lastHeartbeatAt`, `lastLatencyMs`, `socketStatus` (`"open" | "connecting" | "closed"`), restableciendo `isDegraded = false` y `healthStatus = "healthy"`.
    - `handleChannelConnectionFailure`:
      - Falla fatal (401 Logged Out, etc.): purga inmediata de `credentialsCiphertext = null` y `credentialsKeyVersion = null`, fija estado `DISCONNECTED`, emite evento outbox `channel.disconnected` y registra auditoría en `AuditLog`.
      - Falla transitoria (503, pérdidas de conexión): transiciona a `CONNECTING`, `healthStatus = "degraded"`, actualiza `reconnectAttempts` y `lastReconnectAttemptAt`, y emite evento outbox `channel.reconnecting`.
    - `checkStaleChannels`: detecta canales `CONNECTED` sin latidos en más de `staleThresholdSeconds` (default 90s) y los marca como `isDegraded = true` y `healthStatus = "degraded"`.
  - Abstracción de reconexión `channel-reconnection-policy.ts` en `packages/messaging`:
    - `calculateBackoffDelay`: backoff exponencial con full-jitter determinista acotado a `maxMs`.
    - `isFatalDisconnectError`: clasificador determinista de desconexiones Baileys/WhatsApp (fatales 401, 403, 410, loggedOut, bad-mac vs transitorias 503, connectionLost, timedOut).
  - Endpoints REST en `apps/api/src/tenant-channels.ts`:
    - `GET /api/v1/channels/:channelAccountId/health` (200 OK con métricas diagnósticas `{ status, isHealthy, lastHeartbeatAt, lastLatencyMs, socketStatus, isDegraded, reconnectAttempts }`, sin exposición de secretos ni claves, requiere `channels.read`).
    - Aislamiento multi-inquilino estricto 404 ante consultas cross-tenant.
  - Reconciliación documental E09-S02 en ADR-0039.
  - Verificación E09-S02: 6 pruebas unitarias en `channel-reconnection-policy.test.ts` (100% PASS); 5 pruebas de integración PostgreSQL en `channel-health-manager.integration.ts` (100% PASS); 7 pruebas de integración de API en `tenant-channels.integration.ts` (100% PASS); suite general Vitest monorepo (28 archivos, 208 pruebas unitarias) 100% PASS; Biome check (0 errores en 324 archivos); TypeScript typecheck (18 workspaces) 100% PASS. No requiere migration.

- E09-S01 implementa el gestor de ciclo de vida de emparejamiento QR para WhatsApp y los endpoints REST de sesión (`WhatsApp Channel QR Pairing Lifecycle and Session API`) en `packages/database` y `apps/api`:
  - Gestor de emparejamiento `channel-pairing-manager.ts` en `packages/database`:
    - Transiciones de estado deterministas: `DISCONNECTED -> CONNECTING -> QR_READY -> CONNECTED`.
    - `initiateChannelPairing`: revalida tenant operativo y `module.messaging.basic`, comprueba que no se encuentre ya conectado (`ChannelAlreadyConnectedError`), actualiza a `CONNECTING`, emite outbox `channel.pairing_requested` y registra auditoría `channel.pairing_initiated`.
    - `updateChannelQrCode`: actualiza a `QR_READY`, persiste el código QR en `settings.latestQrRaw` y fecha de generación `settings.qrGeneratedAt`, y emite outbox `channel.qr_generated`.
    - `confirmChannelConnected`: actualiza a `CONNECTED`, asigna `phoneNumber`, `phoneNumberUniqueKey` para unicidad activa, opcionalmente `credentialsCiphertext`, limpia el código QR, fija `lastConnectedAt`, emite outbox `channel.connected` y registra auditoría `channel.connected`.
    - `disconnectChannel`: actualiza a `DISCONNECTED`, limpia el código QR, fija `lastDisconnectedAt` y `disconnectReason`, emite outbox `channel.disconnected` y registra auditoría `channel.disconnected`.
  - Endpoints REST en `apps/api/src/tenant-channels.ts`:
    - `POST /api/v1/channels/:channelAccountId/pair/initiate` (200 OK con estado `CONNECTING`, requiere `channels.manage`).
    - `GET /api/v1/channels/:channelAccountId/pair/qr` (200 OK con `{ status, qrRaw, qrGeneratedAt, isExpired }` con TTL estricto de 30 segundos; sin exposición de claves ni credenciales cifradas, requiere `channels.read`).
    - `POST /api/v1/channels/:channelAccountId/disconnect` (200 OK con estado `DISCONNECTED`, requiere `channels.manage`).
    - Aislamiento multi-inquilino estricto 404 ante accesos o mutaciones cross-tenant.
  - Reconciliación documental E09-S01 en ADR-0038.
  - Verificación: 5 pruebas de integración PostgreSQL en `channel-pairing-manager.integration.ts` (100% PASS); 6 pruebas de integración de API en `tenant-channels.integration.ts` (100% PASS); suite general Vitest monorepo (27 archivos, 202 pruebas unitarias) 100% PASS; Biome check (0 errores en 320 archivos); TypeScript typecheck (18 workspaces) 100% PASS. No requiere migration.

- E08-S07 implementa la consola web y cliente frontend para la gestión del motor de reglas y automatizaciones (`Rules Engine Web UI Management & Console Client`) en `apps/web`:
  - View model desacoplado de cliente `apps/web/app/app/rules/rules-view-model.ts`:
    - Tipos completos para reglas (`RuleItem`, `RuleConditionForm`, `RuleActionForm`, `RuleFormData`, `RuleListFilter`).
    - Métodos de API REST tipados (`fetchRules`, `fetchRuleDetail`, `createRule`, `updateRule`, `deleteRule`, `toggleRuleStatus`).
    - Conversión bidireccional y parsing de operadores (`ruleToFormData`, `formDataToCreatePayload`, `formDataToUpdatePayload`).
    - Generador de oraciones en lenguaje natural en tiempo real (`generateRuleSentencePreview`).
    - Formatters y helpers de estado (`triggerLabel`, `operatorLabel`, `actionTypeLabel`, `executionModeLabel`, `statusBadgeDetails`).
  - Componentes de interfaz de usuario de consola (`apps/web/app/app/rules/`):
    - `RulesList` (`rules-list.tsx`): Tabla y filtros interactivos por disparador y estado, búsqueda en vivo, interruptor rápido de activación/pausa, badges de prioridad/lógica y confirmación de borrado accesible.
    - `RuleFormModal` (`rule-form-modal.tsx`): Modal/drawer lateral con formulario de configuración general, constructor dinámico de condiciones ("cuándo") y constructor dinámico de acciones ("qué hacer") con chips de variables (`{{contact.name}}`), panel lateral de resumen y vista previa de oraciones.
    - `RulesClient` (`rules-client.tsx`): Orquestador cliente con guards de módulo (`module.automation.basic`), permisos (`rules.read`, `rules.manage`), carga de opciones de canales, unidades y usuarios, y alertas accesibles.
    - `TenantRulesPage` (`page.tsx`): Ruta `/app/rules` montada en el App Shell de inquilino.
  - Navegación de workspace (`apps/web/app/app/tenant-app-navigation.ts`):
    - Enlace `/app/rules` habilitado para el ítem `automations` protegido por `module.automation.basic` y `rules.read`.
  - Estilos CSS completos en `apps/web/app/globals.css`.
  - Reconciliación documental E08-S07 en ADR-0037.
  - Verificación E08-S07: 21 pruebas unitarias en `rules-view-model.test.ts` (100% PASS); 6 pruebas de navegación en `tenant-app-navigation.test.ts` (100% PASS); suite completa monorepo Vitest (27 archivos, 203 pruebas) 100% PASS; TypeScript typecheck (0 errores); Biome check (0 errores en 6 archivos de rules).

- E08-S06 implementa el evaluador de horarios de atención (`Business Hours Evaluator`), el gestor de inactividad con auto-cierre y liberación de takeover (`Inactivity Manager`) y sus endpoints REST en `packages/database` y `apps/api`:
  - Módulo `business-hours-evaluator.ts` con función pura `isWithinBusinessHours`:
    - Esquema tipado: `DaySchedule` (0=Domingo..6=Sábado, `openTime`, `closeTime` 24h `HH:mm`) y `BusinessHoursConfig` (zona horaria, schedules, feriados en array `holidays` YYYY-MM-DD).
    - Resolución de zona horaria con `Intl.DateTimeFormat` y degradación segura a `UTC` ante zonas IANA inválidas.
    - Soporte para ventanas continuas 24/7 (configuración vacía/nula), ventanas diurnas y turnos nocturnos (`closeTime < openTime`).
    - Soporte del trigger `ON_OUT_OF_BUSINESS_HOURS` en `RULE_TRIGGER_TYPES` y contexto `isWithinBusinessHours` en `RuleEvaluationContext`.
  - Módulo `inactivity-manager.ts` con función `processInactivityTimeouts` y fábrica `createInactivityManager`:
    - Auto-cierre transaccional de conversaciones inactivas (`open` o `pending`) superando `inactivityMinutes`, fijando `status: "closed"`, `closedAt: now` y `metadata.closedReason`.
    - Liberación de takeover (`HUMAN -> AUTO`) al superar `releaseTakeoverMinutes`, reseteando `automationPausedAt: null` y registrando `automationPausedReason: "inactivity_release"`.
    - Registro de auditoría `AuditLog` (`conversation.auto_closed`, `conversation.automation_mode_updated`) y eventos de outbox `DomainEventOutbox` (`conversation.status_updated`, `conversation.automation_mode_updated`).
    - Bloqueo consultivo PostgreSQL `lockConversationInTransaction` y aislamiento multi-inquilino estricto por `tenantId`.
  - Exposición en API REST (`inbox.ts`, `app.ts`):
    - `POST /api/v1/inbox/conversations/process-inactivity` protegido con RBAC (`conversations.assign`), `TenantEntitlementGuard` (`module.messaging.basic`, `module.crm_lite`) y DTO validado.
  - Reconciliación documental E08-S06 en ADR-0036.
  - Verificación E08-S06: suite unitaria `business-hours-evaluator.test.ts` (14 pruebas 100% PASS), suite de integración `inactivity-manager.integration.ts` (3 pruebas PASS), extensión de integración `inbox.integration.ts` (3 pruebas PASS). No requiere migration.

- E08-S05 implementa el gestor de pausa y takeover humano (`Human Takeover`) y el motor de políticas de enrutamiento y asignación (`Assignment Routing Policies`) en `packages/database` y `apps/api`:
  - Módulo `takeover-manager.ts` con función `setConversationAutomationMode` y fábrica `createTakeoverManager`:
    - Modos soportados: `AUTO`, `HUMAN`, `ASSISTED`, `MONITOR`.
    - Bloqueo consultivo de PostgreSQL `lockConversationInTransaction` para garantizar transaccionalidad sin condiciones de carrera.
    - Pausa no destructiva guardando `automationPausedAt` y `automationPausedReason` en el campo `metadata` JSONB de `Conversation` (y reseteo a null al volver a `AUTO`).
    - Emisión transaccional de registros `AuditLog` (`conversation.automation_mode_updated`) y eventos `DomainEventOutbox` (`conversation.automation_mode_updated`).
    - Auto-takeover a `HUMAN` cuando un agente humano responde desde el dashboard (`outbound-conversation-message-manager.ts` con motivo `agent_reply`).
    - Auto-takeover a `HUMAN` cuando se detecta un mensaje humano escrito externamente en la app/web de WhatsApp (`external-human-message-manager.ts` con motivo `external_human_reply`).
  - Módulo `assignment-policy-engine.ts` con función `resolveAssignmentByPolicy` y fábrica `createAssignmentPolicyEngine`:
    - Algoritmos deterministas de auto-asignación: `ROUND_ROBIN` (rotación equitativa), `LEAST_BUSY` (conteo de conversaciones abiertas) y `STICKY_AGENT` (fidelización con el último agente que atendió al contacto).
    - Soporte de filtrado opcional por unidad organizacional (`assignedUnitId` / `organizationUnitId`).
    - Asignación atómica mediante `InboxMutationManager.assignConversation`.
  - Endpoints REST en `apps/api/src/inbox.ts` registrados en `apps/api/src/app.ts`:
    - `PATCH /api/v1/inbox/conversations/:conversationId/automation-mode` protegido con RBAC (`conversations.assign`), entitlement check y aislamiento multi-inquilino.
    - `POST /api/v1/inbox/conversations/:conversationId/auto-assign` protegido con RBAC (`conversations.assign`), entitlement check y aislamiento multi-inquilino.
  - Reconciliación documental E08-S05 en ADR-0035.
  - Verificación E08-S05: suite de integración `takeover-manager.integration.ts` (4/4 PASS), suite de integración `assignment-policy-engine.integration.ts` (5/5 PASS), suite de integración `inbox.integration.ts` (14/14 PASS), suite de reglas DB (5 archivos / 30 pruebas PASS), suite de reglas API (8/8 PASS), suite monorepo Vitest (25 archivos / 162 pruebas PASS), Biome format y lint (0 errores en 308 archivos), TypeScript typecheck (18 workspaces PASS). No requiere migration.

- E08-S04 implementa el despachador central de triggers y el puente con el despachador de eventos entrantes (`Automation Triggers & Inbound Event Dispatcher Bridge`) para el motor de reglas en `packages/database`:
  - Módulo `rule-trigger-dispatcher.ts` con función central `dispatchRuleTriggers(tenantContext, triggerType, context, database, metadata)`:
    - Evaluación de reglas activas ordenadas estrictamente por prioridad (`priority: "asc", createdAt: "desc"`).
    - Soporte completo de modos de ejecución: `first_match_stop` (detiene evaluación tras primera regla coincidente) y `evaluate_all` (evalúa todas las reglas coincidentes).
    - Descarte automático de reglas en cooldown mediante `isRuleInCooldown`.
    - Filtros por canal (`channelAccountId`) y unidad organizacional (`organizationUnitId`).
    - Guardas de modo de automatización: cuando la conversación está en modo `HUMAN` o `MONITOR`, omite la ejecución de reglas automáticas a menos que tengan activas las banderas `forceEvaluation` o `ignoreConversationMode`.
    - Verificación fail-closed de estado operativo (`assertTenantOperational`) y derecho al módulo (`assertTenantModuleEntitled("module.automation.basic")`).
    - Evaluación determinista de condiciones vía `evaluateRuleConditions` y ejecución atómica transaccional de mutaciones vía `executeRuleActions`.
  - Integración en el puente de ingesta de eventos de mensajería (`inbound-event-dispatcher.ts`):
    - Detección de nuevas conversaciones (`isNewConversation`) y disparo ordenado del trigger `ON_CONVERSATION_CREATED`.
    - Disparo de triggers de mensaje entrante `ON_MESSAGE_RECEIVED` al procesar mensajes entrantes de clientes (`fromMe: false`).
    - Manejo degradado elegante (silencioso) para inquilinos sin suscripción al módulo `module.automation.basic`.
    - Exposición opcional de `ruleDispatchResults: RuleTriggerDispatchResult[]` en `InboundEventDispatchResult` para observabilidad del ciclo de vida.
  - Reconciliación documental E08-S04 en ADR-0034 formalizando el diseño del despachador de triggers, el orden de prioridad, las guardas de modo de conversación y la integración de eventos.
  - Verificación E08-S04: 9 pruebas unitarias en `rule-trigger-dispatcher.test.ts` (100% PASS); 5 pruebas de integración contra PostgreSQL real en `rule-trigger-dispatcher.integration.ts` (100% PASS); suite de integración de catálogo DB (8/8) PASS; suite de integración de ejecutor de acciones (8/8) PASS; suite de integración de reglas en API REST (8/8) PASS; suite general Vitest monorepo (25 archivos, 162 pruebas) 100% PASS; Biome check (0 errores, 0 advertencias en 302 archivos); TypeScript typecheck (18 workspaces) 100% PASS. No requiere migration de base de datos.

- E08-S03 implementa el motor de ejecución de acciones y mutaciones atómicas (`Rule Action Execution Engine & Mutation Pipeline`) para el motor de reglas en `packages/database`:
  - Módulo `rule-action-executor.ts` con catálogo exhaustivo de 8 tipos de acciones canónicas (`RULE_ACTION_TYPES`): `SEND_MESSAGE`, `ASSIGN_USER`, `ASSIGN_ORGANIZATION_UNIT`, `CHANGE_CONVERSATION_STATUS`, `ADD_CONTACT_TAG`, `REMOVE_CONTACT_TAG`, `SET_CONTACT_CUSTOM_ATTRIBUTE`, `SET_AUTOMATION_MODE`.
  - Interpolador seguro de plantillas `interpolateTemplate(template, context)`: resuelve variables `{{path.to.var}}` tolerando espacios en blanco, reemplaza nulos/indefinidos por cadena vacía `""` sin arrojar excepciones, formatea objetos como JSON y opera con cero dependencias inseguras (`eval`/`Function`) protegido contra prototype pollution.
  - Ejecución atómica en PostgreSQL (`executeRuleActions`) dentro de un único bloque `$transaction`: reversión inmediata (rollback completo) ante cualquier fallo, actualización de `Rule.updatedAt`, generación de registros de auditoría (`AuditLog`) y eventos de dominio transaccionales (`DomainEventOutbox`).
  - Validación estricta de invariantes de dominio: verificación de estado operativo (`assertTenantOperational`), validación de módulo (`module.automation.basic`), estados activos de usuarios y canales, pertenencia tenant y cumplimiento de la máquina de estados de conversaciones.
  - Jerarquía de errores tipados (`RuleActionExecutionError`, `RuleActionConversationNotFoundError`, `RuleActionConversationNotWritableError`, `RuleActionChannelInactiveError`, `RuleActionContactNotFoundError`, `RuleActionUserNotFoundError`, `RuleActionOrganizationUnitNotFoundError`, `RuleActionInvalidStateTransitionError`).
  - Reconciliación documental E08-S03 en ADR-0033 formalizando el catálogo de acciones, aislamiento transaccional y delimitación respecto a E08-S04 (triggers/webhook bridge) y E08-S05 (human takeover).
  - Verificación E08-S03: 11 tests unitarios en `rule-action-executor.test.ts` (100% PASS); 8 tests de integración en `rule-action-executor.integration.ts` (100% PASS); suite de integración de catálogo DB (8/8) PASS; suite de integración de API REST (8/8) PASS; suite general Vitest monorepo (24 test files, 153 tests) 100% PASS; Biome check (0 errores, 0 advertencias en 299 archivos); TypeScript typecheck (18 workspaces) 100% PASS. No requiere migration de base de datos.

- E08-S02 implementa el evaluador de predicados y condiciones puramente en memoria y determinista para el motor de reglas (Rules Engine) en `packages/database`:
  - Módulo `rule-condition-evaluator.ts` con interfaz de contexto tipada `RuleEvaluationContext` (`message`, `contact`, `conversation`, `channel`, `now`).
  - Catálogo exhaustivo de operadores `RULE_OPERATORS` tipado: String (`EQUALS`, `NOT_EQUALS`, `CONTAINS`, `NOT_CONTAINS`, `STARTS_WITH`, `ENDS_WITH`, `MATCHES_REGEX`, `IS_EMPTY`, `IS_NOT_EMPTY`), Numéricos (`GREATER_THAN`, `GREATER_THAN_OR_EQUAL`, `LESS_THAN`, `LESS_THAN_OR_EQUAL`, `NUMERIC_EQUALS`, `NUMERIC_NOT_EQUALS`), Listas/Tags (`IN`, `NOT_IN`, `CONTAINS_ANY`, `CONTAINS_ALL`, `ARRAY_EMPTY`, `ARRAY_NOT_EMPTY`) y Existencia/Booleans/Nulls (`IS_NULL`, `IS_NOT_NULL`, `EXISTS`, `IS_TRUE`, `IS_FALSE`).
  - Resolución segura de propiedades anidadas `resolveContextPath` con notación por puntos (ej. `contact.customAttributes.planTier`, `conversation.unreadCount`), protección contra prototype pollution y retorno fail-safe de `undefined` sin excepciones no controladas.
  - Evaluación recursiva de árboles de condiciones `RuleConditionGroup` con cortocircuito lógico para grupos `AND` y `OR`, y soporte de reglas catch-all (condiciones vacías retornan `true`).
  - Protección estricta contra ReDoS: límites de tamaño (`MAX_REGEX_PATTERN_LENGTH = 100`, `MAX_REGEX_INPUT_LENGTH = 10_000`) y detección estática previa de cuantificadores anidados o alternaciones superpuestas peligrosas.
  - Evaluador de cooldown/frecuencia `isRuleInCooldown(lastExecutedAt, cooldownSeconds, now)`.
  - Reconciliación documental E08-S02 en ADR-0032 formalizando la gramática de predicados, tipos soportados, seguridad ReDoS y la secuencia de construcción del motor de reglas previo al despachador de eventos (E08-S04) y ejecutor de mutaciones (E08-S03).
  - Verificación E08-S02: 26 pruebas unitarias dedicadas en `rule-condition-evaluator.test.ts` (100% PASS); 142 pruebas en 23 suites Vitest PASS; regresiones de integración DB (8/8) y API REST (8/8) PASS; Biome check (0 errores en 296 archivos); TypeScript typecheck (18 workspaces) 100% PASS. No requiere migration.

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
