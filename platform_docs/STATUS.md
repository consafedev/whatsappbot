# STATUS.md — Estado operativo actual del proyecto

**Actualizado:** 2026-09-03
**Versión de producto:** `0.0.0`  
**Estado:** PORTAL-HUB-ROOT-ROUTE — PASS; Epic 10 — AI Gateway — PASS / COMPLETE; **Epic 11 — Campaign Engine & Audience Broadcasts — IN PROGRESS (E11-S01, E11-S02 PASS)**.

## Current milestone

Epic 11 — Campaign Engine & Audience Broadcasts.

## Current epic

**Epic 11 — Campaign Engine & Audience Broadcasts** — **IN PROGRESS** (ADR-0048, ADR-0049)

Estado por historia:

- E11-S02 — Campaign Execution Dispatcher, Rate Limiting & Outbox Delivery: **PASS** (ADR-0049).
  - Máquina de Estados y Ciclo de Vida (`packages/database/src/campaign-manager.ts`):
    - `startCampaign`: Transición desde `DRAFT` o `PAUSED` a `RUNNING`, validación de `totalRecipients > 0` y registro de `startedAt`.
    - `pauseCampaign`: Suspensión segura de campaña activa de `RUNNING` a `PAUSED`.
    - `cancelCampaign`: Cancelación definitiva a `CANCELLED` impidiendo despachos adicionales.
    - Validación de inquilino operativo mediante `assertTenantOperational`.
  - Motor de Despacho de Lotes (`packages/database/src/campaign-execution-dispatcher.ts`):
    - `dispatchCampaignBatch`: Procesamiento de miembros en estado `PENDING` acotado por `batchSize` o `rateLimitPerMinute` (default 30 msgs/min).
    - Interpolación de variables de plantilla determinista mediante `renderTemplate`.
    - Integración atómica con cola de salida (`outboundMessage`) en `$transaction` con clave de idempotencia `campaign:${campaign.id}:member:${member.id}`, metadatos de trazabilidad `{ source: "CAMPAIGN" }` y actualización de estado del miembro a `SENT` con `sentAt`.
    - Incremento atómico del contador acumulado `campaign.sentCount`.
    - Transición automática de la campaña a `COMPLETED` con marca `completedAt` al agotar los destinatarios pendientes.
  - Endpoints REST en NestJS API Gateway (`apps/api/src/campaigns.ts`):
    - `POST /api/v1/campaigns/:id/start` (200 OK) — Inicio / reanudación de campaña.
    - `POST /api/v1/campaigns/:id/pause` (200 OK) — Pausa de campaña en ejecución.
    - `POST /api/v1/campaigns/:id/cancel` (200 OK) — Cancelación de campaña.
    - `POST /api/v1/campaigns/:id/dispatch-batch` (200 OK) — Despacho de lote de miembros pendientes.
    - Protegidos por `@RequireEntitlements("module.campaigns")`, `TenantPermissionGuard` (`campaigns.manage`), `TenantContextGuard` y `TenantUserSessionGuard`.
    - Aislamiento A/B estricto con rechazo 404 ante accesos cruzados entre inquilinos.
  - Verificación: 8/8 pruebas de integración de base de datos PASS; 13/13 pruebas de integración de API PASS; monorepo typecheck y Biome en 0 errores.

- E11-S01 — Campaign Data Model, Audience Segmentation & Message Templates: **PASS** (ADR-0048).
  - Esquema Relacional y Migración Prisma (`packages/database/prisma/`):
    - Modelos `MessageTemplate`, `Campaign` y `CampaignAudienceMember` mapeados a `snake_case` con IDs UUIDv7.
    - Claves foráneas compuestas `[tenantId, channelAccountId]` y `[tenantId, contactId]` que garantizan aislamiento estricto por inquilino.
    - Restricción de unicidad estricta `campaign_audience_unique_recipient` (`(campaign_id, contact_id)`) para impedir duplicidad de destinatarios.
    - Migración SQL `20260902160000_add_campaigns_foundation` aplicada a PostgreSQL.
  - Catálogo de Módulos y Permisos RBAC (`packages/rbac/`, `packages/database/`):
    - Módulo funcional `module.campaigns` añadido a `MODULE_ENTITLEMENT_KEYS`.
    - Permisos granulares `campaigns.read` y `campaigns.manage` registrados en `PERMISSION_CATALOG`.
  - Motor de Interpolación de Plantillas (`packages/database/src/template-renderer.ts`):
    - Función pura `renderTemplate(templateText, variables)` para sustitución determinista de variables mustache `{{variable}}`.
    - `extractTemplateVariables(templateText)` para detección automática de variables.
  - Gestor de Campañas y Segmentación (`packages/database/src/campaign-manager.ts`):
    - `createMessageTemplate`, `listMessageTemplates`, `createCampaign`, `segmentAndPopulateAudience`, `getCampaignDetail`, `listCampaigns`.
    - Segmentación por etiquetas (*tags*) con operador `hasSome` de PostgreSQL y población atómica e idempotente (`skipDuplicates: true`).
  - Endpoints REST en NestJS API Gateway (`apps/api/src/campaigns.ts`):
    - `POST /api/v1/campaigns/templates` (201 Created) — `campaigns.manage`.
    - `GET /api/v1/campaigns/templates` (200 OK) — `campaigns.read`.
    - `POST /api/v1/campaigns` (201 Created) — `campaigns.manage`.
    - `POST /api/v1/campaigns/:id/audience/populate` (200 OK) — `campaigns.manage`.
    - `GET /api/v1/campaigns` (200 OK) — `campaigns.read`.
    - `GET /api/v1/campaigns/:id` (200 OK) — `campaigns.read`.
    - Protegidos por `@RequireEntitlements("module.campaigns")`, `TenantPermissionGuard`, `TenantContextGuard` y `TenantUserSessionGuard`.
  - Migración de Puerto Web:
    - Puerto web actualizado de 3000 a 3005 (`WEB_PORT=3005`, `PLATFORM_WEB_ORIGIN=http://localhost:3005`, `TENANT_WEB_ORIGIN=http://localhost:3005`).
  - Verificación: 8/8 pruebas unitarias en `template-renderer.test.ts` (100% PASS); 5/5 pruebas de integración en `campaign-manager.integration.ts` (100% PASS); 8/8 pruebas de integración en `campaigns.integration.ts` (100% PASS); monorepo typecheck y Biome en 0 errores.

Epics anteriores:

- **Epic 10 — AI Gateway Foundation & Intelligent Automation** — **PASS / COMPLETE** (ADR-0042, ADR-0043, ADR-0044, ADR-0045, ADR-0046, ADR-0047)

Estado por historia:

- E10-S01 — AI Gateway Universal Provider Abstraction, Key Pooling & Token Ledger: **PASS** (ADR-0042).
- E10-S02 — Resilient Multi-Model Routing, Failover Cascade & Tenant Virtual Aliases: **PASS** (ADR-0043).
- E10-S03 — Knowledge Base Document Ingestion, Chunking & Vector Embeddings: **PASS** (ADR-0044).
- E10-S04 — Multi-Tenant RAG Engine, Vector Similarity Search & Knowledge Retrieval Pipeline: **PASS** (ADR-0045).
- E10-S05 — Autonomous WhatsApp Agent, Triage Policy & Knowledge Directives: **PASS** (ADR-0046).
- E10-S06 — AI Console, Knowledge Base Management & Agent Settings Web UI: **PASS** (ADR-0047).

Epics anteriores:

- Epic 09 — Channel Management: **PASS / COMPLETE** (ADR-0038, ADR-0039, ADR-0040, ADR-0041).

- Epic 08 — Rules Engine & Deterministic Automation: **PASS / COMPLETE**.
  - E08-S01 — Rules Engine Foundation, Data Model & Catalog Management API: **PASS** (ADR-0031).
  - E08-S02 — Rule Condition Evaluator & Predicate Execution Engine: **PASS** (ADR-0032).
  - E08-S03 — Rule Action Execution Engine & Mutation Pipeline: **PASS** (ADR-0033).
  - E08-S04 — Automation Triggers & Inbound Event Dispatcher Bridge: **PASS** (ADR-0034).
  - E08-S05 — Human Takeover and Assignment Routing Policies: **PASS** (ADR-0035).
  - E08-S06 — Inactivity Timers, Auto-Close and Business Hours Schedules: **PASS** (ADR-0036).
  - E08-S07 — Rules Engine Web UI Management and Console Client: **PASS** (ADR-0037).

Tareas transversales:

- PORTAL-HUB-ROOT-ROUTE — Portal raíz, selección de superficie y acceso autenticado: **PASS**.

Epics anteriores:

- Epic 07 — Inbox: **PASS / COMPLETE**.
- Epic 04 — Tenant Dashboard Shell: **PASS / COMPLETE**.
- Epic 02 — Authentication and Tenancy: **PASS / COMPLETE**.

Historias anteriores:

- E07-S01 — Conversation list, filters and cursor pagination: **PASS**.
- E07-S02 — Conversation detail and bidirectional message timeline: **PASS**.
- E07-S03 — Reply from dashboard and outbound dispatch API: **PASS**.
- E07-S04 — Conversation status management and assignment API: **PASS**.
- E07-S05 — Inbox realtime push via Server-Sent Events: **PASS**.
- E07-S06 — Inbox Web UI Frontend & Console Client: **PASS**.
- E05-S01 — Messaging Provider SPI, channel management y Mock driver: **PASS**.
- E05-S02 — Inbound Webhook Ingestion & Normalizer Pipeline: **PASS**.
- E05-S03 — Outbound Messaging Queue, Dispatcher & Retry Worker: **PASS**.
- E06-S01 — Contact Entity, Phone Identity & Channel Binding: **PASS**.
- E06-S02 — Conversation Resolver, tenant-safe lifecycle and inbound routing: **PASS**.
- E06-S03 — Persist inbound messages and fulfill inbound events: **PASS**.
- E06-S04 — Persist outbound messages (create-before-send): **PASS**.
- E06-S05 — Echo reconciliation: **PASS**.
- E06-S06 — External human detection: **PASS**.
- E06-S07 — Delivery state: **PASS**.

Historias anteriores:

- E04-S01 — App shell: **PASS**.
- E04-S02 — Theme Engine minimal: **PASS**.
- E04-S03 — Organization Units management: **PASS**.
- E04-S04 — User management: **PASS**.

Epics base:

- Epic 02 — Authentication and Tenancy: **PASS / COMPLETE**.
- E01-S01 — Prisma/schema baseline: **PASS**.
- E01-S02 — ID/timestamp conventions: **PASS**.
- E01-S03 — Tenant-aware repository utilities: **PASS**.
- E01-S04 — Outbox foundation: **PASS**.
- E01-S05 — Audit foundation: **PASS**.

## Completed

- E10-S06 — AI Console, Knowledge Base Management & Agent Settings Web UI: **PASS** (ADR-0047).
  - Modelado y Clientes REST (`apps/web/app/app/ai/ai-view-model.ts`):
    - Tipado completo de configuración de agente, documentos y fragmentos vectoriales, y métricas de consumo de tokens.
    - Clientes HTTP para endpoints `/api/v1/ai/agent/config`, `/api/v1/ai/knowledge/documents` y `/api/v1/ai/usage/summary`.
    - Formateadores de estados de indexación, tokens, costos en USD y parseo bidireccional de keywords.
  - Componentes de Consola de IA (`apps/web/app/app/ai/`):
    - `ai-client.tsx` & `page.tsx`: Orquestador principal en `/app/ai` con protección de módulo `module.ai` y permiso `ai.settings.manage`, toasts accesibles y navegación por 3 pestañas.
    - `ai-agent-settings-tab.tsx`: Formulario de directivas, toggle de activación, selector de modos (`RULES_ONLY`, `HYBRID_RULES_AI`, `FULL_AI`), alias virtual, slider de confianza mínima, editor de palabras clave de traspaso humano y mensaje fuera de horario.
    - `ai-knowledge-tab.tsx` & `knowledge-document-modal.tsx`: Listado con búsqueda de documentos, modal de carga e indexación inmediata, visor modal de fragmentos vectorizados y diálogo de confirmación para eliminación en cascada.
    - `ai-usage-tab.tsx`: Tarjetas de telemetría de consumo de peticiones, tokens in/out, total de tokens, costo estimado USD y latencia promedio.
  - Integración en Navegación (`apps/web/app/app/tenant-app-navigation.ts`):
    - Enlace `/app/ai` ("Inteligencia Artificial") añadido y protegido por `module.ai` y `ai.settings.manage`.
  - Verificación: 13 pruebas unitarias en `ai-view-model.test.ts` (100% PASS); pruebas de navegación en `tenant-app-navigation.test.ts` (100% PASS); 289 pruebas unitarias de monorepo PASS; compilación de producción de Next.js (`next build`) exitosa; typecheck y lint en 0 errores.


- E10-S05 — Autonomous WhatsApp Agent, Triage Policy & Knowledge Directives: **PASS** (ADR-0046).
  - Configuración del Agente Autónomo (`packages/database/prisma/` & `@whatsapp-platform/database`):
    - Modelo `TenantAiAgentConfig` en migración `20260902140000_add_tenant_ai_agent_config` (`automationMode`, `systemDirectives`, `virtualAliasKey`, `minConfidenceScore`, `humanHandoffKeywords`, `outOfHoursReply`, `isEnabled`).
    - Gestor `ai-agent-config-manager.ts` (`getTenantAiAgentConfig`, `upsertTenantAiAgentConfig`).
  - Orquestador del Agente de IA (`packages/database/src/ai-agent-dispatcher.ts`):
    - `processInboundAiTurn`: Evaluación del turno entrante con guards operacionales y de módulo `module.ai`.
    - Coexistencia con Takeover Humano: Si la conversación está en `automationMode === "HUMAN"` o `humanTakeoverUntil > now`, la IA se abstiene de intervenir.
    - Detección de Handoff a Humano: Reconoce keywords configuradas (`"humano"`, `"asesor"`, `"agente"`), conmuta modo a `HUMAN`, emite `conversation.takeover_requested` en outbox y envía mensaje de aviso de traspaso sin respuesta de IA.
    - Generación RAG: Carga historial de mensajes (últimos 6), recupera fragmentos semánticos relevantes, inyecta citas en system prompt, enruta completion con `AiResilientRouter`, encola mensaje saliente atómico con `actorType: "AI_BOT"` y `metadata: { senderType: "AI_BOT", citations }`, y registra tokens en `AiUsageLog`.
  - Integración en Inbound Pipeline (`packages/database/src/inbound-event-dispatcher.ts`):
    - Flujo: Mensaje entrante -> Reglas deterministas -> Si las reglas no enviaron mensaje y el agente está habilitado en `HYBRID_RULES_AI` o `FULL_AI` -> `processInboundAiTurn`.
  - Endpoints REST en API Gateway (`apps/api/src/ai-agent-config.ts`):
    - `GET /api/v1/ai/agent/config`: Consulta de configuración del agente del inquilino.
    - `PUT /api/v1/ai/agent/config`: Actualización de directivas, umbrales y palabras clave de traspaso.
    - Protegidos por `TenantUserSessionGuard`, `TenantContextGuard`, `TenantPermissionGuard` (`ai.settings.manage`) y `TenantEntitlementGuard` (`module.ai`).
  - Verificación: 4 pruebas de integración en `ai-agent-dispatcher.integration.ts` (100% PASS); 5 pruebas de integración en `ai-agent-config.integration.ts` (100% PASS); 275/275 pruebas unitarias del monorepo PASS; typecheck y lint en 0 errores.


- E10-S04 — Multi-Tenant RAG Engine, Vector Similarity Search & Knowledge Retrieval Pipeline: **PASS** (ADR-0045).
  - Motor Matemático y Formateador RAG (`services/ai-gateway/src/`):
    - `cosineSimilarity` y `rankChunksBySimilarity` (`vector-math.ts`): Cálculo puro de similitud de coseno, producto punto y magnitudes euclidianas, filtrado por umbral `minScore` y ordenamiento top-K.
    - `buildRagContextPrompt` e `injectRagContextIntoMessages` (`rag-context-builder.ts`): Ensamblado de bloques Markdown delimitados con metadatos de cita (`documentTitle`, `chunkIndex`, `score` %) e inyección contextual en mensajes de sistema.
  - Gestor de Búsqueda Semántica en Base de Datos (`packages/database/src/knowledge-search-manager.ts`):
    - `searchKnowledgeChunks`: Búsqueda vectorial filtrando por `tenantId` y estado `INDEXED`, con aislamiento A/B estricto.
  - Endpoints REST en API Gateway (`apps/api/src/`):
    - `POST /api/v1/ai/knowledge/documents/query`: Búsqueda semántica directa de fragmentos y diagnóstico.
    - `POST /api/v1/ai/completions/rag`: Generación de respuestas con RAG integrado, extracción de consulta, búsqueda vectorial, inyección de contexto, enrutamiento resiliente y contabilidad de tokens en `AiUsageLog`.
    - Protegidos con `TenantUserSessionGuard`, `TenantContextGuard`, `TenantPermissionGuard` (`ai.settings.manage`) y `TenantEntitlementGuard` (`module.ai`).
  - Verificación: 6 pruebas unitarias en `vector-math.test.ts` (100% PASS); 5 pruebas unitarias en `rag-context-builder.test.ts` (100% PASS); 2 pruebas de integración en `knowledge-search-manager.integration.ts` (100% PASS); pruebas de integración en `knowledge-base.integration.ts` y `ai-gateway.integration.ts` (16/16 tests PASS).


- E10-S03 — Knowledge Base Document Ingestion, Chunking & Vector Embeddings: **PASS** (ADR-0044).
  - Particionado Semántico y Abstracción de Embeddings (`services/ai-gateway/src/`):
    - `chunkText` (`text-chunker.ts`): Particionador recursivo sensible a estructura (párrafos, saltos de línea, terminaciones de oración y palabras) con solapamiento (*overlap*) configurable y sanitización de caracteres nulos (`\0`).
    - Adaptadores `AiEmbeddingProvider` (`services/ai-gateway/src/embeddings/`): `MockEmbeddingProvider` (vectores normalizados deterministas basados en hash), `OpenAiCompatibleEmbeddingProvider` (cliente para `/v1/embeddings` con timeout estricto de 15s) y `GoogleGeminiEmbeddingProvider` (`:batchEmbedContents`).
    - Fábrica `createEmbeddingProvider` unificando resolución de proveedores.
  - Base de datos y migración Prisma (`packages/database/prisma/` & `@whatsapp-platform/database`):
    - Modelos `KnowledgeDocument` y `KnowledgeChunk` con claves compuestas `[tenantId, id]` para aislamiento estricto en migración `20260827200000_add_knowledge_base`.
    - Gestor `knowledge-base-manager.ts` (`createKnowledgeDocument`, `indexKnowledgeDocument` con `$transaction` atómica, `getKnowledgeDocumentDetail`, `listKnowledgeDocuments`, `deleteKnowledgeDocument`).
  - Endpoints REST en API (`apps/api/src/knowledge-base.ts`):
    - `POST /api/v1/ai/knowledge/documents`: Creación e indexación automática con retorno 201 Created.
    - `GET /api/v1/ai/knowledge/documents`: Listado paginado con contador de fragmentos por documento.
    - `GET /api/v1/ai/knowledge/documents/:documentId`: Detalle del documento y vista previa de sus fragmentos.
    - `DELETE /api/v1/ai/knowledge/documents/:documentId`: Eliminación en cascada de documento y fragmentos.
    - Protegidos por `TenantUserSessionGuard`, `TenantContextGuard`, `TenantPermissionGuard` (`ai.settings.manage`) y `TenantEntitlementGuard` (`module.ai`).
  - Verificación: 5 pruebas unitarias en `text-chunker.test.ts` (100% PASS); 7 pruebas unitarias en `embedding-providers.test.ts` (100% PASS); 5 pruebas de integración en `knowledge-base-manager.integration.ts` (100% PASS); 6 pruebas de integración en `knowledge-base.integration.ts` (100% PASS).


- E10-S02 — Resilient Multi-Model Routing, Failover Cascade & Tenant Virtual Aliases: **PASS** (ADR-0043).
  - Enrutador de Resiliencia y Cascada de Reintentos (`services/ai-gateway/src/resilient-router.ts`):
    - `AiResilientRouter`: Orquestador con conmutación por error en dos niveles (rotación de claves ante 429 rate limit con período de enfriamiento de 60s + conmutación a ruta secundaria `priority: 2` ante errores 500/timeout).
    - Registro de telemetría de intentos `AiRoutingAttempt` y error normalizado `AiAllProvidersFailedError`.
  - Base de datos y migración Prisma (`packages/database/prisma/` & `@whatsapp-platform/database`):
    - Modelos `AiVirtualAlias` y `AiModelRoute` en migración `20260827190000_add_ai_routing_and_aliases`.
    - Gestor `ai-routing-manager.ts` (`createVirtualAlias`, `updateVirtualAliasRoutes`, `resolveRoutesForAlias`, `listTenantAliases`, `seedDefaultPlatformAliases`).
    - Jerarquía de resolución: evalúa primero overrides específicos del inquilino antes del alias global predeterminado de plataforma (`platform-fast`, `platform-smart`, `platform-reasoning`).
  - Endpoints REST en API (`apps/api/src/ai-gateway.ts`):
    - `GET /api/v1/ai/aliases`: Listado de alias virtuales disponibles para el inquilino.
    - `POST /api/v1/ai/completions/route`: Completado inteligente con enrutamiento por alias y failover automático.
    - Protegidos con `TenantUserSessionGuard`, `TenantContextGuard`, `TenantPermissionGuard` y `TenantEntitlementGuard` (`module.ai`).
  - Verificación: 5 pruebas unitarias en `ai-resilient-router.test.ts` (100% PASS); 5 pruebas de integración en `ai-routing-manager.integration.ts` (100% PASS); 8 pruebas de integración en `ai-gateway.integration.ts` (100% PASS).


- E10-S01 — AI Gateway Universal Provider Abstraction, Key Pooling & Token Ledger: **PASS** (ADR-0042).
  - Abstracción Universal y Adaptadores (`services/ai-gateway/src/`):
    - `AiProvider`: Interfaz unificada con `generateCompletion` y `fetchAvailableModels`.
    - `OpenAiCompatibleProvider`: Cliente universal para cualquier endpoint compatible con OpenAI `/v1` (OpenAI, DeepSeek, Groq, OpenRouter, vLLM, Ollama) con timeout estricto de 15s (`AbortSignal.timeout(15000)`).
    - `GoogleGeminiProvider`: Adaptador para Google Gemini API (`:generateContent` y descubrimiento de modelos).
    - `MockAiProvider`: Adaptador determinista offline para pruebas continuas y CI.
    - `KeyPoolSelector`: Mecanismo de selección que prioriza claves activas con menor conteo de llamadas (`totalCalls`), respetando estados de deshabilitación y períodos de enfriamiento por rate limit (`rateLimitedUntil`).
    - Criptografía segura: Encriptación simétrica AES-256-GCM (`v1.iv.tag.ciphertext`) y enmascaramiento estricto (`maskApiKey`).
  - Base de datos y migración (`packages/database/prisma/` & `@whatsapp-platform/database`):
    - Migración `20260827180000_add_ai_gateway_foundation` creando `ai_provider_config`, `ai_key_pool` y `ai_usage_log`.
    - Gestor `ai-gateway-manager.ts` con funciones de aislamiento multi-inquilino (`createAiProviderConfig`, `addKeyToPool`, `updateKeyStatus`, `resolveProviderAndKey`, `recordAiUsage`, `getTenantAiUsageSummary`).
    - Resolución con fallback: prioriza clave BYOK del inquilino antes de recurrir a la clave compartida de plataforma configurada por Super Admin.
  - Endpoints REST en NestJS (`apps/api/src/ai-gateway.ts`):
    - `GET /api/v1/ai/models/discover`: Descubrimiento en vivo de modelos disponibles.
    - `POST /api/v1/ai/completions/test`: Generación rápida y registro transaccional en el ledger.
    - `GET /api/v1/ai/usage/summary`: Resumen de tokens y costos estimado.
    - Protegidos con `TenantUserSessionGuard`, `TenantContextGuard`, `TenantPermissionGuard` (`ai.settings.manage`) y `TenantEntitlementGuard` (`module.ai`).
  - Verificación: 16 pruebas unitarias en `ai-providers.test.ts` (100% PASS); 4 pruebas de integración en `ai-gateway-manager.integration.ts` (100% PASS); 5 pruebas de integración de API en `ai-gateway.integration.ts` (100% PASS).


- E09-S03 — WhatsApp Channel Web UI Management & Live QR Pairing Modal: **PASS** (ADR-0040).
  - View model desacoplado `channels-view-model.ts` (`apps/web/app/app/channels/`):
    - Tipos fuertemente tipados (`ChannelItem`, `ChannelHealthDiagnostic`, `QrPairingState`, `CreateChannelPayload`, `StatusBadgeDetails`, `QrTtlRemaining`).
    - Clientes REST desacoplados con manejo de errores `ChannelApiError` (`fetchChannels`, `createChannel`, `initiateChannelPairing`, `fetchChannelQr`, `disconnectChannel`, `fetchChannelHealth`).
    - Funciones puras y testeables (`formatChannelStatus`, `calculateQrTtlRemaining` para TTL de 30s con temporizador regresivo `mm:ss` y detección `isExpired`, `formatLatency`, `formatSocketStatus`, `formatRelativeTime`).
  - Componentes visuales responsivos y accesibles (`apps/web/app/app/channels/`):
    - `channel-qr-modal.tsx`: Modal interactivo de emparejamiento con guía paso a paso, renderizado procedural SVG de QR con esquinas y patrones de alineación, temporizador de cuenta regresiva de 30s con barra de progreso, sondeo periódico inteligente cada 2 segundos con cancelación inmediata al cerrar o conectar, estado de expiración con regeneración de QR y pantalla de confirmación exitosa.
    - `channel-health-modal.tsx`: Modal de diagnóstico con cuadrícula de 4 estadísticas operativas (latencia ms, estado del socket, intentos de reconexión, último latido relativo/exacto), metadatos del canal y refresco en vivo.
    - `channel-create-modal.tsx`: Modal de registro de nueva línea con validación de nombre, unidad organizativa y proveedor (Baileys), abriendo automáticamente el modal QR.
    - `channels-list.tsx`: Catálogo en cuadrícula responsiva con tarjetas de canal interactivas, badges de estado con indicadores de color, fila de metadatos de telemetría, accesos directos a "Vincular / Escanear QR", "Diagnóstico de Salud" y diálogo accesible de confirmación de desconexión segura. Incluye skeletons y empty states.
    - `channels-client.tsx`: Orquestador principal que valida permisos (`channels.read`, `channels.manage`) y derecho de módulo (`module.messaging.basic`), gestiona estados globales, notificaciones toast y control de modales.
    - `page.tsx`: Ruta canónica Next.js `/app/channels`.
  - Navegación de workspace (`apps/web/app/app/tenant-app-navigation.ts`):
    - Actualización del enlace canónico `channels` hacia `href: "/app/channels"`, con control de acceso por `module.messaging.basic` y `channels.read`.
  - Reconciliación documental E09-S03 en ADR-0040.
  - Verificación E09-S03: 20 pruebas unitarias en `channels-view-model.test.ts` (100% PASS); 7 pruebas de navegación en `tenant-app-navigation.test.ts` (100% PASS); suite general Vitest monorepo (29 archivos, 230 pruebas unitarias) 100% PASS; Biome check (0 errores en 332 archivos); TypeScript typecheck (18 workspaces) 100% PASS; Next.js production build (`/app/channels`) 100% PASS. No requiere migration.

- E09-S02 — Channel Health Checks, Keep-Alive & Reconnection Engine: **PASS** (ADR-0039).
  - Gestor de salud y monitor de canales `channel-health-manager.ts` (`@whatsapp-platform/database`):
    - `recordChannelHeartbeat`: valida operatividad del inquilino y persiste `lastHeartbeatAt`, `lastLatencyMs`, `socketStatus` (`"open" | "connecting" | "closed"`), restableciendo `isDegraded = false` y `healthStatus = "healthy"`.
    - `handleChannelConnectionFailure`:
      - Falla fatal (401 Logged Out, etc.): purga inmediata de `credentialsCiphertext = null` y `credentialsKeyVersion = null`, fija estado `DISCONNECTED`, emite outbox `channel.disconnected` y registra `AuditLog`.
      - Falla transitoria (503, pérdidas temporales): transiciona a `CONNECTING`, `healthStatus = "degraded"`, actualiza `reconnectAttempts` y `lastReconnectAttemptAt`, y emite outbox `channel.reconnecting`.
    - `checkStaleChannels`: detecta canales `CONNECTED` sin latidos en más de `staleThresholdSeconds` (default 90s) y los marca como `isDegraded = true` y `healthStatus = "degraded"`.
  - Abstracción de políticas de reconexión `channel-reconnection-policy.ts` (`@whatsapp-platform/messaging`):
    - `calculateBackoffDelay`: backoff exponencial con full-jitter determinista acotado a `maxMs`.
    - `isFatalDisconnectError`: clasificador determinista de desconexiones Baileys/WhatsApp (fatales 401, 403, 410, loggedOut, bad-mac vs transitorias 503, connectionLost, timedOut).
  - Endpoints REST en API (`apps/api/src/tenant-channels.ts`):
    - `GET /api/v1/channels/:channelAccountId/health` (200 OK con métricas diagnósticas `{ status, isHealthy, lastHeartbeatAt, lastLatencyMs, socketStatus, isDegraded, reconnectAttempts }`, sin exposición de secretos ni claves, requiere `channels.read`).
    - Aislamiento multi-inquilino estricto 404 ante consultas cross-tenant.
  - Reconciliación documental E09-S02 en ADR-0039.
  - Verificación E09-S02: 6 pruebas unitarias en `channel-reconnection-policy.test.ts` (100% PASS); 5 pruebas de integración PostgreSQL en `channel-health-manager.integration.ts` (100% PASS); 7 pruebas de integración de API en `tenant-channels.integration.ts` (100% PASS); suite general Vitest monorepo (28 archivos, 208 pruebas unitarias) 100% PASS; Biome check (0 errores en 324 archivos); TypeScript typecheck (18 workspaces) 100% PASS. No requiere migration.

- E09-S01 — WhatsApp Channel QR Pairing Lifecycle and Session API: **PASS** (ADR-0038).
  - Gestor de emparejamiento QR determinista `channel-pairing-manager.ts` (`@whatsapp-platform/database`):
    - Transiciones de estado completas: `DISCONNECTED -> CONNECTING -> QR_READY -> CONNECTED`.
    - `initiateChannelPairing`: revalida tenant operativo y `module.messaging.basic`, rechaza canales ya conectados (`ChannelAlreadyConnectedError`), fija estado `CONNECTING`, emite evento outbox `channel.pairing_requested` y registra `AuditLog` (`channel.pairing_initiated`).
    - `updateChannelQrCode`: fija estado `QR_READY`, persiste `latestQrRaw` y `qrGeneratedAt` en metadata, y emite evento outbox `channel.qr_generated`.
    - `confirmChannelConnected`: fija estado `CONNECTED`, actualiza `phoneNumber` y `phoneNumberUniqueKey` para unicidad activa, opcionalmente `credentialsCiphertext`, fija `lastConnectedAt`, limpia QR temporal, emite outbox `channel.connected` y registra `AuditLog` (`channel.connected`).
    - `disconnectChannel`: fija estado `DISCONNECTED`, limpia QR, fija `lastDisconnectedAt` y `disconnectReason`, emite outbox `channel.disconnected` y registra `AuditLog` (`channel.disconnected`).
  - Endpoints REST en API (`apps/api/src/tenant-channels.ts`):
    - `POST /api/v1/channels/:channelAccountId/pair/initiate` (200 OK con estado `CONNECTING`, requiere `channels.manage`).
    - `GET /api/v1/channels/:channelAccountId/pair/qr` (200 OK con `{ status, qrRaw, qrGeneratedAt, isExpired }` con TTL estricto de 30 segundos; nunca expone credenciales ni claves, requiere `channels.read`).
    - `POST /api/v1/channels/:channelAccountId/disconnect` (200 OK con estado `DISCONNECTED`, requiere `channels.manage`).
    - Aislamiento multi-inquilino estricto 404 ante intentos cross-tenant.
  - Reconciliación documental E09-S01 en ADR-0038.
  - Verificación E09-S01: 5 pruebas de integración PostgreSQL en `channel-pairing-manager.integration.ts` (100% PASS); 6 pruebas de integración de API en `tenant-channels.integration.ts` (100% PASS); suite general Vitest monorepo (27 archivos, 202 pruebas unitarias) 100% PASS; Biome check (0 errores en 320 archivos); TypeScript typecheck (18 workspaces) 100% PASS. No requiere migration.

- E08-S07 — Rules Engine Web UI Management and Console Client: **PASS** (ADR-0037).
  - View model desacoplado de cliente `rules-view-model.ts`:
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
  - Navegación de workspace (`tenant-app-navigation.ts`):
    - Enlace `/app/rules` habilitado para el ítem `automations` protegido por `module.automation.basic` y `rules.read`.
  - Estilos CSS completos en `apps/web/app/globals.css`.
  - Reconciliación documental E08-S07 en ADR-0037.
  - Verificación E08-S07: 21 pruebas unitarias en `rules-view-model.test.ts` (100% PASS); 6 pruebas de navegación en `tenant-app-navigation.test.ts` (100% PASS); suite completa monorepo Vitest (27 archivos, 203 pruebas) 100% PASS; TypeScript typecheck (0 errores); Biome check (0 errores en 6 archivos de rules).

- E08-S06 — Inactivity Timers, Auto-Close and Business Hours Schedules: **PASS** (ADR-0036).
  - Módulo `business-hours-evaluator.ts` con función pura `isWithinBusinessHours`:
    - Esquema fuertemente tipado: `DaySchedule` (0=Domingo..6=Sábado, `openTime`, `closeTime` 24h `HH:mm`) y `BusinessHoursConfig` (zona horaria, schedules, feriados en array `holidays` YYYY-MM-DD).
    - Resolución de zona horaria con `Intl.DateTimeFormat` y degradación segura a `UTC` ante zonas IANA no válidas.
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

- E08-S05 — Human Takeover and Assignment Routing Policies: **PASS** (ADR-0035).
  - Módulo `takeover-manager.ts` con función `setConversationAutomationMode` y fábrica `createTakeoverManager`:
    - Gestión de modos de automatización: `AUTO`, `HUMAN`, `ASSISTED`, `MONITOR`.
    - Bloqueo consultivo de PostgreSQL `lockConversationInTransaction(tx, tenantId, channelAccountId, contactId)` para evitar carreras y garantizar atomicidad.
    - Pausa y reanudación de automatización almacenando `automationPausedAt` y `automationPausedReason` en `metadata` JSONB de `Conversation`.
    - Registro de auditoría `AuditLog` (`conversation.automation_mode_updated`) y evento de dominio `DomainEventOutbox` (`conversation.automation_mode_updated`).
    - Takeover automático al enviar respuesta de agente desde el dashboard (`outbound-conversation-message-manager.ts` con motivo `agent_reply`).
    - Takeover automático al detectar mensaje humano externo desde app/web de WhatsApp (`external-human-message-manager.ts` con motivo `external_human_reply`).
  - Módulo `assignment-policy-engine.ts` con función `resolveAssignmentByPolicy` y fábrica `createAssignmentPolicyEngine`:
    - Algoritmos deterministas de auto-asignación: `ROUND_ROBIN`, `LEAST_BUSY` (conteo de conversaciones abiertas) y `STICKY_AGENT` (fidelización de contacto).
    - Filtrado opcional por unidad organizacional (`assignedUnitId` / `organizationUnitId`).
    - Mutación atómica transaccional vía `InboxMutationManager.assignConversation`.
  - Exposición en API REST (`inbox.ts`, `app.ts`):
    - `PATCH /api/v1/inbox/conversations/:conversationId/automation-mode` protegido con RBAC (`conversations.assign`), entitlement check y aislamiento multi-inquilino.
    - `POST /api/v1/inbox/conversations/:conversationId/auto-assign` protegido con RBAC (`conversations.assign`), entitlement check y aislamiento multi-inquilino.
  - Reconciliación documental E08-S05 en ADR-0035.
  - Verificación E08-S05: suite de integración `takeover-manager.integration.ts` (4/4 PASS), suite de integración `assignment-policy-engine.integration.ts` (5/5 PASS), suite de integración `inbox.integration.ts` (14/14 PASS), suite de reglas DB (5 archivos / 30 pruebas PASS), suite de reglas API (8/8 PASS), suite monorepo Vitest (25 archivos / 162 pruebas PASS), Biome format y lint (0 errores en 308 archivos), TypeScript typecheck (18 workspaces PASS). No requiere migration.

- E08-S04 — Automation Triggers & Inbound Event Dispatcher Bridge: **PASS** (ADR-0034).
  - Módulo `rule-trigger-dispatcher.ts` con función central `dispatchRuleTriggers`:
    - Evaluación de reglas activas ordenadas estrictamente por prioridad (`priority: "asc", createdAt: "desc"`).
    - Soporte completo de modos de ejecución: `first_match_stop` (detiene evaluación tras primera coincidencia) y `evaluate_all` (evalúa y ejecuta subsecuentes reglas coincidentes).
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

- PORTAL-HUB-ROOT-ROUTE — Portal raíz, selección de superficie y acceso autenticado: **PASS**.
  - `/` ofrece las tres superficies canónicas: Consola de Operador (`/app/inbox`), Tenant Workspace (`/app`) y Platform Control (`/platform/tenants`), con layout responsive y accesible alineado al sistema visual B2B.
  - El formulario usa los endpoints existentes `POST /auth/tenants/:tenantSlug/login` y `POST /platform/auth/login`; las identidades y cookies permanecen separadas, no se guarda contraseña en el navegador y los destinos posteriores al login están en allowlist local.
  - Las rutas protegidas tenant y Platform redirigen al modo de acceso correspondiente cuando la sesión no existe, sin aceptar identidad tenant desde query/body ni cambiar API, esquema o migrations.
  - Bootstrap local posterior verificado: el entorno Compose tiene 1 Platform Admin activo, 0 tenants y 0 usuarios tenant. `pnpm platform-admin:create` leyó las credenciales sólo desde el `.env` ignorado por Git, PostgreSQL conserva exclusivamente el hash Argon2id y la contraseña no se imprimió ni se agregó a documentación versionada. Login, `/platform/auth/me`, logout y revocación se verificaron con la cuenta real.
  - Reconciliación de alcance: esta tarea es transversal y no corresponde a una historia numerada del backlog; “Portal del Inquilino” se implementa como Tenant Workspace y no adelanta el Customer Portal de Epic 17. El siguiente nombre canónico es E08-S02 — Event dispatcher; el rótulo “Rule Condition Evaluator & Predicate Execution Engine” del prompt contradice `DATA_MODEL_ERD_MVP_BACKLOG.md` y no se adopta.
  - Se corrigió formato, sin cambios de lógica, en seis archivos existentes de Inbox que impedían el gate global de Biome en el commit base.
  - Verificación: suite raíz Vitest 22 archivos/116 pruebas PASS; autenticación Nest/PostgreSQL 2 archivos/17 pruebas PASS (tenant 10/10, Platform 7/7); Biome 294 archivos sin errores; typecheck web y build de producción Next.js PASS; QA visual desktop/móvil y redirecciones sin sesión verificadas en navegador real. No requiere migration.

- E08-S02 — Rule Condition Evaluator & Predicate Execution Engine: **PASS** (ADR-0032).
  - Evaluador de predicados y condiciones puramente en memoria, determinista y sin I/O implementado en `packages/database/src/rule-condition-evaluator.ts`.
  - Contexto de ejecución tipado `RuleEvaluationContext` (`message`, `contact`, `conversation`, `channel`, `now`).
  - Catálogo de operadores completo `RULE_OPERATORS` tipado: String (`EQUALS`, `NOT_EQUALS`, `CONTAINS`, `NOT_CONTAINS`, `STARTS_WITH`, `ENDS_WITH`, `MATCHES_REGEX`, `IS_EMPTY`, `IS_NOT_EMPTY`), Numéricos (`GREATER_THAN`, `GREATER_THAN_OR_EQUAL`, `LESS_THAN`, `LESS_THAN_OR_EQUAL`, `NUMERIC_EQUALS`, `NUMERIC_NOT_EQUALS`), Listas/Tags (`IN`, `NOT_IN`, `CONTAINS_ANY`, `CONTAINS_ALL`, `ARRAY_EMPTY`, `ARRAY_NOT_EMPTY`) y Existencia/Booleans/Nulls (`IS_NULL`, `IS_NOT_NULL`, `EXISTS`, `IS_TRUE`, `IS_FALSE`).
  - Resolución segura de paths anidados `resolveContextPath` con notación por puntos (ej. `contact.customAttributes.planTier`, `conversation.unreadCount`), protección contra prototype pollution (`__proto__`, `constructor`, `prototype`) y retorno fail-safe de `undefined` sin excepciones no controladas.
  - Evaluación recursiva de árboles lógicos `RuleConditionGroup` con cortocircuito para grupos `AND` y `OR`, y soporte de reglas catch-all (condiciones vacías retornan `true`).
  - Seguridad ReDoS: patrón máximo 100 caracteres (`MAX_REGEX_PATTERN_LENGTH`), texto evaluado máximo 10,000 caracteres (`MAX_REGEX_INPUT_LENGTH`), y detección estática previa de backtracking catastrófico (cuantificadores anidados y alternaciones superpuestas) ejecutando en < 1ms (< 50ms límite de seguridad).
  - Evaluador de cooldown/frecuencia `isRuleInCooldown(lastExecutedAt, cooldownSeconds, now)` con validación defensiva de intervalos y desvío de reloj.
  - Reconciliación explícita de backlog y nombres formalizada en ADR-0032: `E08-S02` establece el motor de evaluación de predicados puro en memoria antes de acoplar el despachador de eventos (E08-S04) y la ejecución de mutaciones (E08-S03).
  - Exportación de tipos y utilidades en `@whatsapp-platform/database` (`packages/database/src/index.ts`) y alineación retrocompatible en `validateConditions` de `packages/database/src/rule-catalog-manager.ts`.
  - Verificación: 26 pruebas unitarias dedicadas en `packages/database/src/rule-condition-evaluator.test.ts` (100% PASS); suite general Vitest monorepo (23 archivos, 142 pruebas PASS); regresiones de integración DB (8/8) y API REST (8/8) PASS; Biome check (0 errores en 296 archivos); TypeScript typecheck (18 workspaces) 100% PASS. No requiere migration.

- E08-S01 — Rules Engine Foundation, Data Model & Catalog Management API: **PASS** (ADR-0031).
  - Modelo Prisma `Rule` añadido con UUIDv7, soporte multi-inquilino estricto, trigger types (`ON_MESSAGE_RECEIVED`, `ON_CONVERSATION_UNASSIGNED`, `ON_TAG_ADDED`, `ON_SCHEDULED_WINDOW`), execution modes (`first_match_stop`, `execute_all_matches`), estados (`draft`, `active`, `inactive`, `archived`), condiciones JSONB (`field`, `operator`, `value`), acciones JSONB (`actionType`, `parameters`), prioridad entera (1-10,000), cooldown en segundos y relaciones opcionales compuestas a `ChannelAccount` y `OrganizationUnit`.
  - Migración SQL `packages/database/prisma/migrations/20260825120000_add_rules_engine_foundation/migration.sql` aplicada exitosamente en PostgreSQL 18.4.
  - `createRuleCatalogManager(...)` en `packages/database/src/rule-catalog-manager.ts` implementa CRUD completo, validación determinista de esquemas JSON de condiciones y acciones, revalidación de estado operativo del tenant, verificación de módulo `module.automation.basic` y emisión atómica de `AuditLog` y `DomainEventOutbox` (`rule.created`, `rule.updated`, `rule.deleted`).
  - Endpoints REST en `apps/api/src/rules.ts` (`POST /api/v1/rules`, `GET /api/v1/rules`, `GET /api/v1/rules/:ruleId`, `PUT /api/v1/rules/:ruleId`, `DELETE /api/v1/rules/:ruleId`) con guardias RBAC (`rules.read`, `rules.manage`), guardia de módulo `TenantEntitlementGuard` (`module.automation.basic`), aislamiento multi-inquilino 404 estricto y DTOs fuertemente tipados.
  - Verificación: 8 tests de integración de base de datos (`packages/database/src/rule-catalog-manager.integration.ts`) y 8 tests de integración de API REST (`apps/api/src/rules.integration.ts`) superados con 100% PASS; suite general Vitest (21 suites, 114 tests) intacta; Biome check (0 errores, 0 warnings en 291 archivos); TypeScript typecheck (18 workspaces) 100% PASS.

- E05-S01 — Messaging Provider SPI, WhatsApp Channel Management & Mock Driver: **PASS**; la instrucción adjunta pedía FastAPI/Alembic, pero la autoridad del repositorio exige NestJS/Prisma, por lo que la historia quedó implementada sobre esos boundaries canónicos sin crear un segundo stack Python.
- `packages/messaging` define el `MessagingProvider` agnóstico de Nest/FastAPI, DTOs de estado/salud/evento normalizado, verificación HMAC, `MockMessagingProvider` con inspección en memoria y fallos configurables (`network`, `rate_limit`, `invalid_number`); la factory sólo habilita `mock` y falla cerrado para providers reales aún no implementados.
- `ChannelAccount` tenant-owned se añadió mediante la migration Prisma `20260818090000_messaging_channel_account_foundation`, con UUIDv7, phone único por tenant sólo para registros activos, estado/provider/configuración, ciphertext y versión de clave separados de la proyección pública, FK compuesta tenant/OUnit e índices tenant/status.
- `createChannelAccountManager(...)` aplica `module.messaging.basic`, `limit.channel_accounts` con `Prisma.Decimal`, advisory lock transaccional por tenant, validación de OUs, CRUD/archive tenant-scoped y Audit + Outbox atómicos (`channel.created|updated|deleted`) sin credenciales en responses, summaries ni payloads.
- La API expone `GET/POST/PATCH/DELETE /api/v1/channels`, detalle y `test-connection`, además de aliases canónicos `/app/channels`; requiere `channels.read`/`channels.manage` y entitlement efectivo, devuelve 404 para IDs cross-tenant y cifra credenciales con AES-256-GCM usando `MESSAGING_CREDENTIALS_KEY` fuera de la base.
- Verificación E05-S01: Vitest raíz 17 archivos/84 pruebas; suite database 4/4 y API 5/5 contra PostgreSQL 18.4/Nest reales; migration aplicada, Biome/typecheck/build Docker API y health del contenedor PASS. Cobertura porcentual no medida.
- E05-S02 — `packages/messaging` amplía el DTO normalizado y añade normalización pura para payloads genéricos/mock y Meta Cloud API, con contexto confiable de `tenantId`/`channelId`, texto, media, receipts, timestamps y fallback `UNKNOWN`; WPPConnect queda cubierto por el parser genérico sin afirmar un transporte provider real.
- E05-S02 — `InboundMessageEvent` tenant-owned se añadió con la migration Prisma `20260818110000_inbound_message_event_foundation`, UUIDv7, JSONB raw/normalized, estado `PENDING|PROCESSED|DUPLICATE|FAILED`, índices tenant/channel/status, unique `(tenant_id, channel_account_id, provider_message_id)` y FKs restrictivas conforme al modelo vigente.
- E05-S02 — manager tenant-safe valida tenant operativo, entitlement `module.messaging.basic` y canal activo; persiste evento + Outbox `messaging.inbound.event_received` en la misma transaction y resuelve duplicados sin segunda fila ni segundo evento, incluyendo carreras `P2002` fuera de la transacción abortada.
- E05-S02 — API pública `GET/POST /api/v1/webhooks/whatsapp/:channelId` y `POST /api/v1/webhooks/whatsapp/mock/:channelId`: handshake Meta, HMAC sobre raw body, límite JSON de 256 KB, ACK HTTP 200, resolución de tenant sólo desde ChannelAccount y credenciales siempre cifradas; no se implementaron Contacts, Conversations, UI ni providers reales.
- Verificación E05-S02: normalizer 3/3, database 3/3 y API 4/4 contra PostgreSQL 18.4/Nest reales en Docker; `db:validate`, `db:generate`, typecheck, build host y Biome PASS. Cobertura porcentual no medida. La exportación final de la imagen Docker quedó sin completar por bloqueo de Docker Desktop; el contenedor de pruebas existente ejecutó la migración y las suites contra PostgreSQL real.
- Discrepancia documental explícita: el backlog histórico `DATA_MODEL_ERD_MVP_BACKLOG.md` todavía etiqueta E05-S02 como Baileys adapter y E05-S03 como ChannelAccount management. E05-S02 siguió el prompt vigente y este STATUS operativo para inbound webhooks; E05-S03 siguió el prompt vigente y este STATUS para la cola outbound. Baileys real y la etiqueta histórica del backlog no se reescribieron silenciosamente.
- E05-S03 — `OutboundMessage` tenant-owned y migration Prisma `20260819184530_add_outbound_messages_foundation`, con UUIDv7, unique `(tenant_id, idempotency_key)`, estados `PENDING|QUEUED|SENDING|SENT|FAILED|RETRYING|DLQ`, lease/retry fields, índices operativos y FKs restrictivas conforme a la autoridad documental.
- E05-S03 — manager tenant-safe que revalida tenant operativo, `module.messaging.basic`, canal activo y actor activo; aplica idempotencia, reclama mensajes con lease, persiste transiciones y escribe Outbox después de cada transición durable. El agotamiento de reintentos termina en `DLQ` y el error público queda saneado.
- E05-S03 — API `POST/GET /api/v1/channels/:channelId/messages`, con `202 Accepted`, estado least-data, validación de UUIDv7/E.164-ish, media HTTPS pública e idempotency key. Usa el permiso canónico existente `channels.manage`; no se inventó `messaging:write` ni `message:send` porque el catálogo cerrado no los contiene.
- E05-S03 — dispatcher detrás del `MessagingProvider` SPI y worker PostgreSQL polling (fallback permitido por el alcance, sin dependencia BullMQ inexistente), con revalidación de tenant/entitlement/canal, idempotencia por mensaje, timeout/network/rate-limit retry, backoff exponencial acotado, concurrencia 5, límite por canal de 5 mensajes/segundo y recuperación de leases vencidos.
- Verificación E05-S03: Vitest raíz 19 archivos/90 pruebas; dispatcher unitario 3/3, database 4/4, API 3/3 y worker 1/1 contra PostgreSQL 18.4/Nest reales en Docker; `db:validate`, `db:generate`, `db:migrate:deploy`, `prisma migrate status`, typecheck en contenedor, Biome y build Docker `api web worker-whatsapp` PASS. Compose dejó API, web, ambos workers, PostgreSQL y Redis saludables; `/health` y `/` respondieron HTTP 200. Cobertura porcentual no medida.
- Alcance E05-S03: no se implementaron providers WhatsApp reales, Contacts, Conversations, UI de envío ni un adaptador BullMQ; el polling actual mantiene PostgreSQL como fuente de verdad y deja el boundary de orquestación listo para un adapter futuro.

- E06-S01 — migration Prisma `20260819200000_add_contacts_foundation` con `Contact` tenant-owned, UUIDv7, estado `ACTIVE|BLOCKED|ARCHIVED`, tags/text[] y customAttributes/JSONB; FK a Tenant restrictiva, índices por tenant/status/name y unique `(tenant_id, phone_number)`.
- E06-S01 — `normalizePhoneNumber(...)` produce E.164, limpia separadores, admite internacional/nacional/local con default explícito `52` para México y normaliza la forma mexicana legacy `+521...` a `+52...`; la resolución regional por tenant queda para una historia posterior.
- E06-S01 — `createContactManager(...)` es tenant-safe, revalida tenant operativo también en lecturas, usa advisory lock por tenant para writes/find-or-create, soporta CRUD/listado/filtro, block/archive y escribe `AuditLog` + `DomainEventOutbox` atómicos (`contact.created|updated|archived`, `crm.contact.created|updated`).
- E06-S01 — API `POST/GET/PATCH/DELETE /api/v1/contacts` con `contacts.read`/`contacts.write`, DTO cerrado, 201/409/400/404/403, 404 cross-tenant y tenant derivado exclusivamente de la sesión. Requiere entitlement `module.crm_lite` vía `@RequireEntitlements` + `TenantEntitlementGuard`.
- E06-S01 — límite documental: el backlog conceptual conserva `ContactPoint` para identidades omnicanal futuras; esta historia implementa únicamente la proyección primaria solicitada `Contact.phoneNumber`. No se implementaron conversaciones, mensajes, asociación de webhooks, CRM pipeline ni UI.
- Verificación E06-S01: suite raíz 20 archivos/93 pruebas; phone/RBAC unitarios PASS; database Contact 5/5, API Contact 3/3 y regresión RBAC 11/11 contra PostgreSQL 18.4/Nest reales; migración aplicada, TypeScript, Biome y `git diff --check` PASS. La exportación final de una imagen Docker nueva no se marca como PASS: la compilación Docker llegó a compilar los workspaces, pero la etiqueta final no quedó disponible; no se afirma runtime de E06 sobre la imagen anterior.
- E06-S02 — migration Prisma `20260819230000_add_conversations_foundation` con `Conversation` UUIDv7, referencias tenant-aware a Tenant/ChannelAccount/Contact/User/OrganizationUnit, estados canónicos `new|open|pending|closed`, modos `AUTO|ASSISTED|HUMAN|MONITOR`, índices de resolución y FKs restrictivas. Los índices únicos compuestos nuevos de ChannelAccount y Contact sostienen las FKs tenant-aware.
- E06-S02 — `createConversationManager(...)` revalida tenant operativo, `module.messaging.basic` y `module.crm_lite`, deriva el canal desde el InboundMessageEvent tenant-scoped, resuelve/crea Contact en la misma transacción, reutiliza o reabre el hilo activo y crea uno nuevo tras `closed`.
- E06-S02 — resolución concurrente serializada por advisory lock tenant/channel/contact; Audit `conversation.created|conversation.state_changed` y Outbox homónimo atómicos. El evento inbound permanece `PENDING` deliberadamente; persistencia de mensajes, completion del evento, Inbox/API, UI y bots quedan diferidos conforme al backlog y ADR-0019.
- Verificación E06-S02: Vitest raíz 20 archivos/93 pruebas, suite Conversation resolver 5/5, regresión Contact 5/5 e Inbound 3/3 contra PostgreSQL 18.4 real en contenedor con el código fuente actual; `db:validate`, `db:generate`, `migrate deploy`, `migrate status`, TypeScript/build de workspaces Docker y Biome PASS. La exportación/tag final de la imagen Docker no terminó; no se afirma runtime de API con E06-S02.
- E06-S03 — migration Prisma `20260820100000_add_messages_foundation` con `Message` tenant-owned, UUIDv7, contrato normativo `direction/origin/actor_type`, contenido normalizado, timestamp del provider, referencias tenant-aware a Conversation/ChannelAccount/Contact/InboundMessageEvent y FKs restrictivas. La tabla deduplica por `(tenant_id, channel_account_id, provider_message_id)` y por `inbound_event_id`.
- E06-S03 — `createInboundMessageManager(...)` deriva tenant, canal, contacto y conversación exclusivamente del `InboundMessageEvent`; reutiliza el resolver dentro de la misma transacción, persiste el Message inbound, actualiza `last_message_at`/`last_inbound_at`, cambia `PENDING -> PROCESSED` y agrega `message.received` al Outbox atómico. Duplicados y carreras son idempotentes; no hay API Inbox ni outbound anticipados.
- Verificación E06-S03: suite inbound message 5/5 y regresión Conversation 5/5 contra PostgreSQL 18.4 real en Docker con source mounts; `db:validate`, `db:generate`, `db:migrate:deploy` (13 migrations, incluida `20260820100000_add_messages_foundation`), typecheck de `@whatsapp-platform/database`, Biome y `git diff --check` verificados. El build Docker compiló database/API/web/workers, pero la exportación final quedó interrumpida; no se marca una imagen/runtime API E06-S03 como PASS.
- E06-S04 — migration Prisma `20260820120000_add_outbound_message_correlation` enlaza el `Message` canónico con el `OutboundMessage` operativo mediante FK compuesta tenant-aware, idempotencia `(tenant_id, idempotency_key)` y `provider_timestamp` nullable para soportar create-before-send; los mensajes inbound continúan exigiendo timestamp de provider.
- E06-S04 — `createOutboundConversationMessageManager(...)` valida tenant operativo, `module.messaging.basic`, `module.crm_lite`, conversación activa, canal activo y actor activo; en una sola transacción crea/correlaciona `Message` + `OutboundMessage`, actualiza timestamps de Conversation y emite `message.queued`. Usa `direction=outbound`, `origin=human_app|automation`, `actor_type=tenant_user|system` y `delivery_status=queued` sin prometer envío provider.
- E06-S04 — idempotencia por tenant y advisory lock tenant/canal/contacto evitan duplicados bajo reintento/concurrencia; el test A/B devuelve not-found al tenant incorrecto. No se añadieron Inbox/listado/reply, `unreadCount`/preview, WebSockets/SSE ni cambios al catálogo RBAC: corresponden a Epic 07 según backlog/ADR-0021. `conversations.read`/`conversations.reply` permanecen como catálogo existente; no se inventó `conversations.manage`.
- Verificación E06-S04: suite outbound conversation database 4/4, regresión Conversation 5/5 e inbound Message 5/5 contra PostgreSQL 18.4 real en Docker; `db:validate`, `db:generate`, `db:migrate:deploy` (15 migrations, incluida la corrección `20260820121000_align_outbound_message_fk_name`), `prisma migrate status`, `prisma migrate diff` sin diferencias, database typecheck y Biome verificados. El CLI Prisma host sigue incompleto y se usó Docker; no se afirma runtime de una imagen Docker nueva.
- E06-S05 — `createOutboundEchoManager(...)` correlaciona un echo conocido por identidad tenant/canal/provider o por `OutboundMessage.providerMessageId` y su relación canónica; actualiza sólo `providerMessageId`/`providerTimestamp`, completa el evento `PROCESSED` y emite `message.echo_reconciled` de forma atómica e idempotente.
- E06-S05 — `createOutboundEchoManager(...)` deja el echo no correlacionado `PENDING` dentro de su boundary; el dispatcher lo entrega inmediatamente al fallback E06-S06 sin inventar un segundo Message de plataforma. `STATUS_UPDATE`/`DELIVERY_RECEIPT` permanecen diferidos a E06-S07; el reconciliador no muta `delivery_status` ni `OutboundMessage.status`.
- E06-S05 — no requiere migration: reutiliza las columnas, uniques e integración tenant-aware de E06-S04. La corrección de alcance y nombres (`human_external_device`/`external_human_unknown` en lugar de `external_device`/`external`) queda formalizada en ADR-0022; no se alteró silenciosamente el backlog normativo.
- Verificación E06-S05: suite outbound echo 5/5 contra PostgreSQL 18.4 real con source mount; regresión E06-S04 4/4 y E06-S03 5/5; database typecheck Docker, typecheck local, Biome y `git diff --check` PASS. El build Docker nuevo fue intentado pero quedó bloqueado por timeout de `pnpm install` contra npm; no se afirma una imagen nueva ni runtime API.
- E06-S06 — `createExternalHumanMessageManager(...)` detecta el fallback no correlacionado de E06-S05, valida tenant operativo y ambos entitlements, resuelve/crea Contact por `recipientPhone`, reutiliza el lifecycle/lock de Conversation, persiste el Message canónico `outbound/human_external_device/external_human_unknown/sent`, completa el evento y emite `message.external_human_detected` de forma idempotente.
- E06-S06 — el dispatcher conserva echo-first y reintenta E06-S05 si aparece una correlación concurrente; no crea `OutboundMessage`, no cambia automation/takeover, no agrega Inbox/API/WebSockets/SSE, no implementa receipts E06-S07 y no requiere migration. ADR-0023 documenta las correcciones de nombres, tenant context, recipient routing, closed lifecycle y ausencia de `lastMessagePreview`.
- E06-S06 — verificación estática dirigida: Biome y `git diff --check` PASS. La suite PostgreSQL, typecheck Prisma y regresiones no pudieron ejecutarse porque Docker Desktop no está disponible en esta sesión; el CLI Prisma host también falla por un módulo `prisma/build/index.js` ausente y Vitest host no resuelve `@whatsapp-platform/config`.
- E06-S07 — `createDeliveryStatusManager(...)` correlaciona por tenant/canal/provider con fallback a `OutboundMessage`, aplica ranking monotónico con la excepción documentada de `failed`, actualiza la cola sólo en transiciones aceptadas, completa el evento por CAS y emite un único `message.delivery_status_updated` por recibo procesado. El dispatcher conserva echo-first y delega al fallback externo los conflictos de reintentos ya clasificados; el normalizer/API separan identidad del evento de recibo y provider id objetivo para preservar deduplicación.
- E06-S07 — no requiere migration y no agrega Inbox/API, WebSockets/SSE ni reglas/bots. Biome y el normalizer unitario 3/3 PASS; la suite PostgreSQL no inició porque el host no resuelve `@whatsapp-platform/config`, y el typecheck host continúa bloqueado por dependencias/salidas Prisma incompletas. No se afirma PASS de integración, Prisma ni regresiones.

- E07-S01 — `createInboxQueryManager(...)` implementa el listado tenant-scoped con estados canónicos, alias `active`, filtros de asignación/canal, búsqueda case-insensitive por contacto, cursor base64url sobre `(lastMessageAt DESC NULLS LAST, id DESC)`, `totalActive` y proyección least-data con `unread` derivado de timestamps existentes.
- E07-S01 — la API expone `GET /api/v1/inbox/conversations`, exige `conversations.read`, `module.messaging.basic` y `module.crm_lite`, deriva tenant exclusivamente de sesión/contexto y mantiene la cadena de guards ordenada sesión → contexto → permiso → entitlement. No se implementó `inbox.read` ni detalle porque la autoridad documental asigna detalle a E07-S02.
- Verificación E07-S01 — suite database 4/4 y API Nest/PostgreSQL 3/3; `prisma validate`, TypeScript API/database, Biome (264 archivos), Vitest raíz (20 archivos/93 pruebas) y `git diff --check` PASS. No hubo migration; el host no tiene disponibles los binarios locales de Biome/TypeScript, por lo que esos dos checks se ejecutaron en contenedor reproducible.
- E07-S02 — `createInboxQueryManager(...)` ahora expone detalle tenant-scoped y timeline de `Message` con proyecciones cerradas: contacto, canal, asignación, actor/origen, delivery, timestamps y `structuredPayload` para contenido media-shaped. No selecciona metadata privada, credenciales, provider config ni agrega `messageType` al DTO REST cerrado definido por la story.
- E07-S02 — la API expone `GET /api/v1/inbox/conversations/:conversationId` y `GET /api/v1/inbox/conversations/:conversationId/messages`, exige `conversations.read` y ambas entitlements, convierte 404 cross-tenant/no encontrado, y serializa timestamps REST explícitamente como ISO.
- E07-S02 — cursor estricto `(createdAt,id)`: `before` histórico descendente, `after` progresivo ascendente, `nextCursor` direccional y `prevCursor` sólo cuando existe página en sentido contrario; límite default 30 y máximo 100. No hay migration, mutación, realtime ni UI.
- Verificación E07-S02 — suite database 6/6 y API Nest/PostgreSQL 4/4 con detalle, media, eco externo, paginación bidireccional, aislamiento A/B, RBAC/entitlements y 404 cross-tenant; `prisma validate`, TypeScript API/database, Biome (264 archivos) y `git diff --check` PASS. No hubo migration; checks reproducibles ejecutados en contenedor porque los binarios locales no están disponibles.
- E07-S04 — `createInboxMutationManager(...)` agrega status y assignment como un boundary de mutación dedicado, con advisory lock tenant/channel/contact, actor activo, entitlements `module.messaging.basic` + `module.crm_lite`, matriz `new|open|pending|closed`, `closedAt`, asignación tenant-safe de User/OrganizationUnit y AuditLog/DomainEventOutbox atómicos. No requiere migration.
- E07-S04 — la API expone `PATCH /api/v1/inbox/conversations/:conversationId/status` y `/assignment`, protege ambas rutas con `conversations.assign` y la cadena ordenada de guards existente, devuelve el detalle actualizado y mantiene `404` cross-tenant/`400` para transición o target inválido. La reconciliación de `conversations.manage`, `TenantAuthGuard`, `TenantAuditLog` y del rótulo corto “Assignment” está formalizada en ADR-0028.
- Verificación E07-S04 — suite database dedicada 5/5 y API Nest/PostgreSQL 11/11 contra PostgreSQL 18.4 real con source mounts; Prisma validate, migrate status (15 migrations up to date), TypeScript API/database, Biome (275 archivos), Vitest raíz (20 archivos/93 pruebas) y `git diff --check` PASS. No hubo migration.
- E07-S06 — `apps/web/app/app/inbox/` implementa la consola frontend web del Inbox con View Model desacoplado (`inbox-view-model.ts`), lista de hilos (`inbox-thread-list.tsx`), vista de chat y compositor (`inbox-chat-view.tsx`), panel de contacto y asignación (`inbox-contact-panel.tsx`) y orquestador cliente (`inbox-client.tsx`) dentro de `TenantAppShell` en la ruta `/app/inbox`.
- E07-S06 — consume `GET /api/v1/inbox/events` mediante `EventSource` con credenciales de sesión, aplicando reconciliación reactiva en memoria (`applyRealtimeEvent`) que inserta mensajes entrantes/salientes sin duplicados, progresa los estados de entrega en vivo (`queued -> sent -> delivered -> read/failed`), actualiza estado de conversación y reordena la lista de hilos elevando las conversaciones activas al tope.
- E07-S06 — activa la ruta `/app/inbox` en la navegación lateral del workspace (`apps/web/app/app/tenant-app-navigation.ts`) protegida por `module.messaging.basic` y `conversations.read`.
- Reconciliación documental E07-S06 en ADR-0030: el backlog histórico conserva el rótulo `Human takeover policy`, pero ADR-0028/ADR-0029, `STATUS.md` y el prompt formal mandan la consola frontend del Inbox y el cliente de stream en tiempo real; se implementó el frontend completo de Inbox sin alterar silenciosamente el backlog.
- Verificación E07-S06 — 21 suites unitarias en Vitest (113 pruebas, 20 en la suite de Inbox view model), typecheck de `@whatsapp-platform/web` y monorepo, 0 errores en Biome (278 archivos), y compilación de producción de Next.js (`pnpm --filter @whatsapp-platform/web build`) PASS con ruta `/app/inbox`. No requiere migration.

- E04-S01 — App shell: **PASS**; Epic 04 quedó **PASS / COMPLETE**.
- `/app` usa un layout Next.js reusable, sidebar desktop-first, drawer móvil accesible, identidad real del Tenant/User y logout por `POST /auth/logout`.
- `GET /app/bootstrap` está protegido por `TenantUserSessionGuard` y `TenantContextGuard`; deriva tenant/user solamente de la sesión, consulta módulos efectivos y permisos efectivos desde PostgreSQL y no expone config, settings, hashes, sesiones ni metadata privilegiada.
- La navegación centralizada usa módulos/permisos sólo como UX; APIs futuras conservan guards. Inicio es el único link existente y capacidades efectivas futuras aparecen como `Próximamente` no clicable, sin `href="#"` ni rutas vacías.
- No hay cache persistente de auth/permissions/entitlements, migration, schema change ni Theme Engine; `brandingConfig` no se interpreta y el modo es `platform_default`.
- E04-S02 — Theme Engine minimal: **PASS**; Epic 04 quedó **PASS / COMPLETE**.
- `packages/themes` (`@whatsapp-platform/themes`) con schema canónico estricto: `version: 1`, preset de cinco profesionales + `custom`, `colorMode` light/dark, colores `#RRGGBB` con contraste vs blanco ≥ 3.0, logo HTTPS público sin credenciales ni hosts internos (`localhost`, `.local`, `.internal`, RFC1918, loopback, `::1`), y `{}` o config inválida resuelve al default `corporate-blue` light.
- Presets light/dark explícitos con tokens derivados (`primary`, `primaryDark`, `onPrimary`, softs, accent y `accentText` con contraste ≥ 4.5) para display; `resolveTenantTheme(...)` es fail-soft y nunca falla el bootstrap ni el editor ante config dañada.
- `GET /app/theme` y `PATCH /app/theme` requieren `tenant.settings.manage`; PATCH con body `{}` restablece el default, body inválido devuelve 400 y la presencia de `logo` (incluido `null`) exige el módulo `module.white_label` con 403 `ENTITLEMENT_REQUIRED`.
- `createTenantThemeRepository(...)` valida, persiste `brandingConfig`, escribe Audit `tenant.theme.updated` y Outbox homónimo en una transacción; summaries/payloads contienen `preset`/`colorMode`/`logoKind` sin la URL del logo y `requestId` saneado desde `x-request-id`.
- `/app/bootstrap` expone `branding` resuelto (tokens display-only) sin el `brandingConfig` raw; el logo sólo se incluye cuando `module.white_label` está efectivo — si no (desactivado, schedule o expirado) `branding.logo` es `null` aunque la config guardada lo conserve, y reaparece al reactivar el módulo sin recargar config; el shell aplica variables CSS scoped `--tenant-*` en `.tenant-app-shell`, `globals.css` usa los tokens y el CSS de plataforma (`:root`) permanece intacto.
- Editor en `/app/settings/theme` con preset, modo claro/oscuro, colores custom con preview y logo (sólo con White label); guarda, restablece y refresca bootstrap sin reload. El logo se renderiza con `referrerPolicy="no-referrer"` y queda fuera del pipeline de optimización de Next.
- El logo remoto es honesto: no hay fetch server-side ni riesgo SSRF (la API sólo valida y persiste la URL HTTPS pública); el navegador hace una request normal al host del logo con el Referer suprimido. Upload/almacenamiento gestionado del logo queda como hardening futuro y no rediseña storage.
- Sin cambios de schema (siete migrations), sin migration 8 y sin ADR nuevo; `prisma.config.ts` sólo añade `shadowDatabaseUrl` desde `SHADOW_DATABASE_URL` (documentado en `.env.example`) para el diff de migrations.
- Suites E04-S02: `pnpm test:integration:theme-engine` (7 database + 11 API), regresión `pnpm test:integration:auth` (12 archivos/75 pruebas), `pnpm test:integration:tenant-app-bootstrap` (6) y `pnpm test:security:tenant-isolation` (9 + 37) contra PostgreSQL 18.4/Nest reales.
- E04-S03 — Organization Units management: **PASS**; Epic 04 quedó **PASS / COMPLETE**.
- `createOrganizationUnitManager(...)` en `packages/database` (tenant-safe, nunca por `/platform`): `list/create/update` con contexto de tenant obligatorio, árbol tenant-consistent, invariante de root estructural (parent null + type company inmutable en move/deactivate/retype, rename sí), prohibición de ciclos (self y descendientes), tope de profundidad `ORGANIZATION_UNIT_MAX_DEPTH = 10` como constante de código documentada para configurabilidad futura y resolución del límite efectivo `limit.organization_units`.
- Semántica del límite: efectivo sólo con fila `enabled` vigente (`startsAt <= now < endsAt`) y `limitValue != null`; el rechazo usa `Prisma.Decimal` sin conversión numérica; el recuento incluye root e inactivos; `list()` devuelve `usage: { used, limit }` con `limit` en string o `null`.
- Concurrencia: cada create/update es una transacción que toma un advisory lock PostgreSQL por tenant (`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${tenantId}::text, 0::bigint))`), sin locks globales ni cambios de framework; el límite se respeta exactamente bajo concurrencia (verificado con 8 creates paralelos, 4 aceptados/4 rechazados y `used = limit`).
- Auditoría/outbox atómicos: `organization_unit.created|updated`, actor `tenant_user`, summaries `{name,type,parentId,code,timezone,active}` sin datos sensibles, `entityId`/`organizationUnitId` = id de la unidad y outbox homónimo con payload mínimo; fallo del outbox revierte unidad y audit (rollback verificado).
- API `GET/POST/PATCH /app/organization-units` con `tenant.settings.manage`, 401/403 fail-closed, cabeceras hostiles ignoradas (el tenant deriva sólo de la sesión), respuestas least-data sin `tenantId`/settings/address, DTO cerrado con claves exactas (UUIDv7, name ≤120, code ≤40, timezone IANA ≤100, active booleano, PATCH vacío 400) y errores 400/404/409 con códigos `ORGANIZATION_UNIT_ROOT_INVARIANT`, `ORGANIZATION_UNIT_CYCLE`, `ORGANIZATION_UNIT_DEPTH_EXCEEDED` y `ORGANIZATION_UNIT_LIMIT_REACHED`.
- IDs de otros tenants devuelven 404 sin revelar existencia; `company` está reservado al root (400); sin delete ni endpoint privilegiado nuevo; el import de la API boundary sigue limitado a `@whatsapp-platform/database` (nunca `/platform`).
- UI real en `/app/settings/organization-units` (force-dynamic): árbol por niveles con root visible, creación/edición inline, mensajes de conflicto en español (ciclo, profundidad, límite, root inmutable), refetch tras mutaciones, accesibilidad (labels, `aria-expanded`) y navegación secundaria de settings compartida (Apariencia/Organización) sin tocar la navegación principal.
- Sin cambio de schema: siete migrations intactas, sin migration 8 y sin ADR nuevo; helpers de árbol/form puros con pruebas unitarias (6 + 7) y suites dedicadas `pnpm test:integration:organization-units` (11 database + 12 API) contra PostgreSQL 18.4/Nest reales.
- Fix de invariante de jerarquía: en el reparent el tope `ORGANIZATION_UNIT_MAX_DEPTH = 10` valida la subárbol movida completa (`newDepth + subtreeHeight > 10` rechaza, sin closure table/ltree/nested sets/materialized path/migration/servicio nuevo); la altura se computa en memoria desde el árbol del tenant con `visited` defensivo que convierte corrupción cíclica en `ORGANIZATION_UNIT_CYCLE`; el límite exacto 9 + 1 = 10 pasa con el descendiente más profundo en profundidad 10 (sin off-by-one).
- Movida rechazada preserva todo el subárbol (padres originales intactos) y no genera Audit `organization_unit.updated` ni Outbox para la unidad movida; los checks de ciclo existentes (self, descendiente, ancestro→descendiente, padre cross-tenant) siguen pasando porque ciclo y profundidad son invariantes distintos.
- Límites fraccionales: `PATCH /platform/tenants/:tenantId/entitlements/limits/...` acepta `"3.5"` (regex `decimalValue` con hasta 4 decimales) para `limit.organization_units`; el manager compara el próximo conteo exacto `limit.lt(used + 1)` con `Prisma.Decimal` (sin conversión a Number), rechazando `limit = 3.5` con `used = 3` → `ORGANIZATION_UNIT_LIMIT_REACHED` (API 409), en vez del `limit.lte(used)` anterior que permitía el 4.º.
- La semántica efectiva del límite reutiliza `tenantEntitlementEffective(...)` de `packages/database/src/tenant-entitlements.ts` (helper hoja tenant-safe, sin ciclo de imports con el manager): efectivo sólo con fila `enabled` vigente (`startsAt <= now < endsAt`) y `limitValue != null`.
- Fix verificado con 14 pruebas database + 15 API en `pnpm test:integration:organization-units`; regresiones `test:integration:database` (13 archivos/95), `test:integration:auth` (13/93, incluye org-units API), `test:security:tenant-isolation` (9+37), `test:integration:tenant-app-bootstrap` (6), `test:integration:theme-engine` (7+11), `test:integration:entitlements` (3+5), `test:integration:tenant-status` (3+4) y `test:integration:rbac` (11+11) contra PostgreSQL 18.4/Nest reales.
- E04-S04 — User management: **PASS**; **Epic 04 — Tenant Dashboard Shell — PASS / COMPLETE**.
- `createTenantUserManagementManager(...)` es tenant-scoped y fail-closed: usuarios, roles, OUs, sesiones y tokens se resuelven desde el contexto de sesión/tenant; IDs cross-tenant devuelven 404. La creación normaliza email y valida contraseña; `PlatformPasswordHasher` Argon2id se ejecuta fuera de la transacción y nunca se persiste plaintext.
- Límite `limit.users`: sólo cuenta usuarios activos, usa `Prisma.Decimal` exacto y advisory lock transaccional por tenant; crear/reactivar consume asiento y desactivar lo libera. Desactivar es lógico, revoca sesiones/tokens en la misma transacción y es idempotente; se conserva el último Owner tenant-wide activo y un Owner sólo OU no satisface esa invariante.
- Asignaciones de roles son reemplazo total atómico, rechazan duplicados semánticos y exigen roles/OUs del mismo tenant; cada mutación escribe Audit + Outbox en la misma transacción. Roles integrados exponen el catálogo canónico de 29 permisos, Owner es sólo lectura, se preservan `scopeConstraints` y no se añadió constructor de roles custom.
- API real: `GET/POST /app/users`, `PATCH /app/users/:userId/status`, `PUT /app/users/:userId/role-assignments`, `GET /app/users/options` y `GET/PUT /app/roles`, con permisos efectivos separados para usuarios y roles.
- UI real en `/app/users`, navegación con `href` no nulo y visibilidad por `tenant.users.manage` o `tenant.roles.manage`; incluye alta con contraseña inicial, activar/desactivar, reemplazo de asignaciones, grupos del catálogo canónico y confirmación explícita para ampliaciones de permisos.
- Sin cambio de schema ni migration: las siete migrations permanecen intactas. Verificación E04-S04: TypeScript directo y Biome PASS; Vitest raíz 16 archivos/76 pruebas; build Docker `api web` PASS con ruta Next `/app/users`; integración real database 23/23 y API 12/12 para user management, más regresiones Organization Units database 14/14, API 15/15, tenant detail database 5/5 y API 4/4 contra PostgreSQL 18.4/Nest reales.
- E03-S05 — Suspend/reactivate tenant: **PASS**; **Epic 03 — PASS / COMPLETE**.
- `POST /platform/tenants/:tenantId/suspend` y `/reactivate` usan exclusivamente `PlatformAdminSessionGuard`, UUID de route validado y body vacío; devuelven 200 con `{ tenant: { id, status, suspendedAt }, changed }`.
- Sólo se permiten `active → suspended` y `suspended → active`; provisioning, offboarding y archived devuelven 409. Reintentos al estado actual devuelven `changed: false`, preservan `suspendedAt` y no crean Audit/Outbox adicionales.
- `createPlatformTenantStatusWriter(...)` se exporta sólo desde `@whatsapp-platform/database/platform`; aplica update condicional, status/suspendedAt, Audit y Outbox en una transaction. No hay Prisma raw en controller ni writer tenant-safe.
- `TenantUserSessionGuard` ya revalida `Tenant.status === active` desde PostgreSQL en cada request antes de TenantContext, RBAC y Entitlement. Suspender bloquea sesión existente y login con 401 genérico; reactivar permite de nuevo la misma sesión válida sin recrearla ni revocar sesiones.
- `assertTenantOperational(...)` es la primitive tenant-safe reutilizable para workers/jobs futuros. Antes de side effect costoso deberán revalidar tenant active y entitlement aplicable; no se cancela job, desconecta provider ni se modifican módulos durante suspensión.
- Suspend/reactivate no muta User, Role, Permission, UserRole, UserSession, TenantEntitlement, config, limits, OUs, settings, branding ni deployment. Platform Control y mutations de entitlements continúan operativos sobre tenant suspended.
- Audit/Outbox usan `tenant.suspended` y `tenant.reactivated`, aggregate `Tenant`, actor Platform Admin y payload/summaries mínimos sin secretos.
- UI `/platform/tenants/[tenantId]` muestra acción Suspend/Reactivar sólo en estados administrables, confirmación explícita, errores 401/404/409 y refetch real de detail después de éxito.
- Suite dedicada `pnpm test:integration:tenant-status`: 2 archivos y 7 pruebas PostgreSQL 18.4/Nest para session same-cookie, login/reset, status spoofing, A/B, Platform control, idempotencia, `suspendedAt`, concurrencia y rollback atómico.
- E03-S05 no cambió `schema.prisma`, conserva siete migrations, no creó migration 8, no implementó E04-S01 y no requirió ADR.
- E03-S04 — Module activation: **PASS**; Epic 03 permanece **IN PROGRESS**.
- Catálogo canónico y tipado de exactamente 14 `ModuleEntitlementKey` y cinco `LimitEntitlementKey`, compartido por provisioning, detalle, administración y enforcement sin listas divergentes.
- La semántica efectiva única exige row existente, `enabled = true`, `startsAt <= now` y `endsAt > now`; ausencia, disabled, inicio futuro y expiración fallan cerrados.
- `createTenantEntitlementResolver(...)` expone sólo lectura tenant-scoped y `assertTenantModuleEntitled(...)` proporciona la revalidación reusable no-Nest para futuros services, jobs y workers; no existe mutation tenant-safe ni cache/snapshot en sesión.
- `@RequireEntitlements(...)` y `TenantEntitlementGuard` aplican ALL después de sesión/contexto y, cuando corresponde, RBAC; devuelven 403 `ENTITLEMENT_REQUIRED` desde PostgreSQL en cada request sin confiar en UI ni datos del request.
- `PATCH /platform/tenants/:tenantId/entitlements/modules/:moduleKey`, `PATCH /platform/tenants/:tenantId/entitlements/limits/:limitKey` y el GET diferido de config usan exclusivamente `PlatformAdminSessionGuard`, catálogos cerrados y DTOs fail-closed.
- Los overrides son `manual_override`; config es objeto JSON opaco con reemplazo total, máximo 16 KiB/profundidad 10 y sin secretos por contrato. Disable conserva row/config/datos y re-enable recupera la configuración.
- Cada mutation ejecuta upsert + Audit `tenant.entitlement.changed` + Outbox homónimo en una única transacción; summaries/payloads no contienen config completo. La unique existente `(tenant_id, entitlement_key)` evita duplicados concurrentes.
- Limits conservan exactitud `Decimal(20,4)` sin conversión innecesaria a Number; no se anticipó enforcement de uso de módulos futuros.
- `/platform/tenants/[tenantId]` permite administrar los 14 módulos y cinco limits, muestra estado efectivo/scheduled/expired/disabled, solicita confirmación al deshabilitar y carga config avanzada sólo al abrirla.
- Suite dedicada `pnpm test:integration:entitlements`: 2 archivos y 8 pruebas PostgreSQL 18.4/Nest, incluidos misma sesión disable→enable, Permission + Entitlement, ausente/futuro/expirado, A/B, input hostil, Decimal exacto, concurrencia y rollback atómico.
- E03-S04 no cambió `schema.prisma`, conserva siete migrations, no creó migration 8, no modificó prototype, no implementó E03-S05 y no requirió ADR.
- E03-S03 — Tenant detail: **PASS**; Epic 03 permanece **IN PROGRESS**.
- `GET /platform/tenants/:tenantId`, `/users` y `/audit` usan exclusivamente `PlatformAdminSessionGuard`; ausencia de sesión, cookie Tenant User, sesión revocada y Platform Admin disabled reciben 401, UUID inválido recibe 400 y UUID válido inexistente recibe 404.
- `createPlatformTenantDetailQueryService` es una consulta cross-tenant privilegiada exportada sólo desde `@whatsapp-platform/database/platform`; el controller no usa Prisma raw y el root tenant-safe no expone esta capacidad.
- El detalle devuelve identidad/configuración general segura, derivaciones de theme/branding, unidad raíz mínima, catálogo completo de 14 módulos, cinco limits Decimal serializados canónicamente, uso observado, deployment least-data y placeholders explícitos para canales/backup.
- La vigencia de entitlements comparte una única regla con E03-S01: enabled, `startsAt <= now` y `endsAt > now`; módulos ausentes se muestran disabled/no efectivos sin crear filas.
- Uso real disponible: conteos de Users y Organization Units. Channels, storage y AI usados permanecen `null`; nunca se inventa cero ni actividad/capacidad inexistente.
- Users y Audit son paginados (25 default, 100 máximo), tienen orden estable y filtro obligatorio por `tenantId`; roles incluyen sólo nombre/key y OU mínima, mientras Audit omite summaries e `ipMetadata`.
- `/platform/tenants/[tenantId]` implementa las ocho tabs General, Módulos, Usuarios, Canales, Deployment, Uso, Auditoría y Backup; usa APIs reales, carga diferida para Users/Audit y estados loading/empty/401/404/error sin fixtures ni mutaciones futuras.
- El listado E03-S01 enlaza el nombre del tenant al detalle; canales y backup se declaran honestamente no disponibles hasta sus historias propietarias.
- Suite dedicada `pnpm test:integration:platform-tenant-detail`: 2 archivos y 8 pruebas PostgreSQL 18.4/Nest, con aislamiento A/B, temporalidad, Decimal, auth, paginación, 404 y proyecciones sin campos sensibles.
- E03-S03 no cambió `schema.prisma`, conserva siete migrations, no creó migration 8, no modificó prototype, no implementó E03-S04/E03-S05 y no requirió ADR.
- E03-S02 — Create tenant: **PASS**; Epic 03 permanece **IN PROGRESS**.
- `POST /platform/tenants` devuelve 201 y usa exclusivamente identidad `PlatformAdminSessionGuard`; no acepta identidad tenant ni Platform sessions revocadas/disabled.
- `PlatformTenantProvisioningService` valida y normaliza input, reutiliza email/password policy Argon2id de Tenant auth y calcula el hash antes de abrir la transacción.
- `createPlatformTenantProvisioningRepository` se exporta sólo desde `@whatsapp-platform/database/platform` y persiste en un único transaction callback Tenant, Owner, roles, grants, assignment, root OU, entitlements, Audit y Outbox.
- Tenant nace `active`, con `brandingConfig = {}` como herencia del theme default y `settings = {}`; no existe worker/provisioning pendiente.
- Owner nace active/MFA disabled, queda asignado tenant-wide al role system `owner` y puede iniciar sesión inmediatamente; nunca se persiste o devuelve plaintext.
- Roles exactos: Owner, Administrator, Supervisor, Agent, Operator y Viewer, todos tenant-owned e `isSystem = true`; Owner recibe los 29 PermissionKey, los otros cinco comienzan deliberadamente con cero grants.
- `pnpm rbac:sync-permissions` es prerequisite operacional; provisioning verifica las 29 rows y falla cerrado con 503 si faltan, sin ejecutar sync por request.
- Root OU único: `company`, nombre del Tenant, sin parent/code/timezone y settings vacíos; timezone null hereda el default del Tenant.
- Catálogo cerrado de 14 módulos; sólo los seleccionados crean rows enabled/manual_override sin vigencia. Los cinco limits explícitos usan los valores administrativos del request en `Decimal(20,4)`.
- Deployment es opcional, nunca se selecciona implícitamente y un UUID inexistente devuelve 422.
- Audit `tenant.created` usa actor Platform Admin y summary mínimo; Outbox `tenant.created` queda unpublished/attempts 0. Ninguno contiene password/hash.
- `/platform/tenants/new` implementa wizard responsive Empresa/Capacidades/Owner/Confirmación, POST real, prevención de double submit, limpieza de password en error y redirect al listado con feedback.
- E03-S02 no cambió schema/migrations, no creó migration 8, no modificó prototype y no requirió ADR.
- E03-S01 — Tenant list: **PASS**; Epic 03 permanece **IN PROGRESS**.
- `GET /platform/tenants` usa exclusivamente `PlatformAdminSessionGuard`; cookies tenant, sesiones revocadas y Platform Admin disabled reciben 401.
- Query cross-tenant explícita disponible sólo desde `@whatsapp-platform/database/platform`; controller sin Prisma raw y root tenant-safe sin acceso Platform.
- Response least-data con identidad/status, deployment seguro, módulos efectivos, `userCount`, `channelCount: null` y `lastActivityAt`; excluye JSONB privados, hashes, sessions y audit payloads.
- Módulos se filtran por prefix `module.`, `enabled = true`, `startsAt <= now` y `endsAt > now`; limits y permission keys se excluyen.
- Actividad representa la última observación entre `UserSession.lastSeenAt` y `AuditLog.occurredAt`; no usa `Tenant.updatedAt` ni persiste una derivación.
- `channelCount` queda **NULL / DEFERRED UNTIL CHANNELACCOUNT**; la web muestra em dash y no inventa cero.
- Query estable y sin N+1: dos operaciones Prisma de nivel superior por página (`count` + `findMany` con agregados/relations), independientes del número de tenants.
- `/platform/tenants` en Next.js implementa tabla Platform Control responsive, búsqueda, status filter, paginación y estados loading/empty/error/loaded sin fixtures ni enlaces a historias futuras.
- E03-S01 no cambió `schema.prisma`, no creó migration 8 y no requirió ADR.
- Epic 02 — Authentication and Tenancy: **PASS / COMPLETE** con E02-S01 a E02-S05 verificadas.
- E02-S05 — RBAC base: **PASS**, documentada por ADR-0017.
- Séptima migration añade exclusivamente `Role`, `Permission`, `UserRole` y `RolePermission`, con UUIDv7, `TIMESTAMPTZ(3)`, FKs compuestas tenant-aware e índices de assignment.
- Catálogo global de 29 `PermissionKey` exactas en `packages/rbac`; `pnpm rbac:sync-permissions` inserta/actualiza de forma idempotente, no borra extras y no crea roles tenant.
- `TenantDataAccess` expone roles custom, grants/revokes, assignments/revokes y resolución efectiva sin Prisma inputs arbitrarios; tenant/isSystem nunca proceden del caller.
- `UserRole` no puede mezclar User, Role u Organization Unit de tenants distintos ni apuntar a templates globales; la DB y el boundary de aplicación lo rechazan.
- Resolver tenant-wide usa unión allow-set de roles válidos, ignora assignments OU-scoped, grants constrained y permission keys desconocidas, y consulta PostgreSQL por request.
- `@RequirePermissions` usa `PermissionKey`; `TenantPermissionGuard` se ejecuta después de sesión/contexto, requiere ALL, devuelve 403 sin permiso y conserva 401 para auth inválida.
- Owner/Viewer no son security boundaries: Owner sin grant falla y Viewer con grant pasa. Revocation se refleja en la misma sesión en la siguiente request.
- Default roles Owner, Administrator, Supervisor, Agent, Operator y Viewer quedan definidos sin permission matrix; provisioning/mapping se difiere explícitamente a E03-S02.
- E02-S04 — Tenant isolation tests: **PASS**; no requirió cambios de schema, migrations ni arquitectura productiva.
- Comando dedicado `pnpm test:security:tenant-isolation`: 5 archivos y 34 pruebas contra PostgreSQL 18.4 real (8 database; 26 API/auth/arquitectura).
- Matriz A/B exhaustiva para las superficies tenant-owned actuales: `TenantEntitlement`, `OrganizationUnit`, `AuditLog`, `DomainEventOutbox`, `User`, `UserSession`, `UserPasswordResetToken` y endpoints tenant autenticados existentes.
- IDs ajenos, inputs hostiles `tenantId`/`tenant`, FKs compuestas cross-tenant, mismo email en tenants distintos, sesiones/reset cross-tenant, revocación/expiración y fuentes de request hostiles fallan sin fuga ni mutación.
- Transacciones commit/rollback y operaciones concurrentes A/B sobre el mismo Prisma Client preservan el tenant correcto; el facade tenant no expone Prisma raw, publisher Outbox ni audit platform.
- Test arquitectónico fija los únicos imports privilegiados actuales en composition root, bootstrap/auth/infraestructura; ningún camino tenant-owned de aplicación obtiene Prisma raw.
- `Message`, `Conversation`, `Process`, `ActionRequest`, `Quote`, `Document`, portal grants y jobs tenant-owned quedan **DEFERRED** hasta que sus modelos y endpoints existan; no se anticipó Epic posterior.
- E02-S03 — Tenant context middleware: **PASS**; no requirió migration ni ADR nuevo.
- Pipeline Nest explícito `TenantUserSessionGuard` → `TenantContextGuard` → controller/service; guards ejecutados en ese orden y sin middleware pre-auth.
- `TenantSessionIdentity` expone `sessionId`, `userId` y `tenantId` persistidos; la request autenticada recibe `auth` y `tenantContext` como propiedades readonly/no reasignables.
- `TenantContextGuard` deriva contexto únicamente de `auth.tenantId`, reutiliza `createTenantContext(...)` y falla 401 sin identidad tenant válida.
- `@TenantAuthenticated()`, `@CurrentTenantContext()` y `@CurrentTenantIdentity()` ofrecen composición/extracción tipada sin headers, body, query, route tenant ID ni slug post-auth.
- `TenantDataAccessFactory` reutiliza el cliente singleton y conecta explícitamente `TenantContext` con `createTenantDataAccess(...)`; no crea Prisma request-scoped ni estado ambiental.
- Ocho pruebas verticales sobre Nest/PostgreSQL real cubren contextos A/B, body/query/headers/route hostiles, ausencia de sesión, cookie Platform, sesión revocada/expirada, user disabled, tenant suspended, read/write scoped y concurrencia A/B.
- E02-S02 — Tenant user auth: **PASS**, documentada por ADR-0016.
- `User`, `UserSession` y `UserPasswordResetToken` tenant-owned y separados de Platform Admin, con `tenant_id NOT NULL`.
- Email normalizado unique por tenant; misma dirección verificada en dos tenants con passwords distintos.
- Sexta migration append-only con UUIDv7, `TIMESTAMPTZ(3)`, token hashes `BYTEA` unique y FKs compuestas `(tenant_id, user_id)`.
- Login pre-auth por tenant slug, sesión opaca de 12 horas/2 horas idle y cookie tenant distinta de platform.
- `/auth/me`, logout idempotente y revoke-all limitado al user actual; status User/Tenant revalidado en cada request.
- Password reset CSPRNG de 256 bits, 15 minutos, single-use, revocación de tokens previos y de todas las sesiones al completar.
- `PasswordResetDelivery` recibe el reset link sólo después del commit; no existe todavía adapter operativo de correo.
- Origin exacto, CORS explícito y buckets process-local separados para login/reset request/reset confirm.
- Auditoría tenant transaccional para login, logout, revoke-all y password reset request/completed sin secrets.
- E02-S01 — Platform Admin auth: **PASS**, documentada por ADR-0015.
- `PlatformAdmin` y `PlatformAdminSession` permanecen separados de Tenant User y sin `tenant_id`.
- Quinta migration append-only con UUIDv7, `TIMESTAMPTZ(3)`, hash de token `BYTEA` unique, revocación y expiración.
- Password hashing Argon2id y bootstrap explícito `pnpm platform-admin:create`; ninguna credencial se crea al iniciar la aplicación.
- Sesiones opacas server-side de 256 bits, sólo SHA-256 persistido, expiración absoluta de 8 horas e idle timeout de 30 minutos.
- Cookie HttpOnly/SameSite Strict; `__Host-` + Secure en producción y nombre local separado en desarrollo/test.
- Endpoints `POST /platform/auth/login`, `GET /platform/auth/me` y `POST /platform/auth/logout`, con logout idempotente.
- Origin exacto, CORS sin wildcard, JSON estricto, respuesta genérica de credenciales y rate limiting de login sin sleeps.
- Login/logout auditados transaccionalmente con `tenant_id = NULL`, sin password, hash ni token raw.
- Suite de integración API/PostgreSQL real cubre migración física, login válido/inválido, admin disabled, expiración absoluta, inactividad, revocación, sesiones simultáneas, cookie, origen y audit.
- Epic 00 — Repository Foundation: **PASS / COMPLETE**.
- Epic 01 — Database Foundation: **PASS / COMPLETE**.
- E01-S01 — Prisma/schema baseline: **PASS**.
- E01-S02 — ID/timestamp conventions: **PASS**, documentada por ADR-0012.
- E01-S03 — Tenant-aware repository utilities: **PASS**.
- E01-S04 — Outbox foundation: **PASS**, documentada por ADR-0013.
- E01-S05 — Audit foundation: **PASS**, documentada por ADR-0014.
- `AuditLog` lógicamente append-only con UUIDv7, tenant nullable para plataforma, summaries/IP metadata JSONB y request ID obligatorio.
- `tenantData.audit.append(...)` deriva siempre tenant desde `TenantContext`; no acepta `tenantId`, `id` ni `occurredAt`.
- `createPlatformAuditWriter(...)` está disponible sólo en `@whatsapp-platform/database/platform` para audit puro o tenant-related privilegiado.
- FK compuesta `(tenant_id, organization_unit_id)` impide asociar OrganizationUnit cross-tenant; audit platform puro no admite OrganizationUnit.
- Domain mutation + AuditLog + Outbox comparten el mismo `TransactionClient` dentro de `withTenantTransaction`.
- Nueve pruebas Audit sobre PostgreSQL 18.4 cubren esquema físico, actores, JSONB, tenant/platform paths, aislamiento y atomicidad.
- Cuarta migration `20260813170000_append_only_audit_foundation`, append-only y sin cambios a las tres migrations históricas.
- `DomainEventOutbox` tenant-owned con UUIDv7 DB-side, payload JSONB y bookkeeping de publicación pendiente.
- `outbox.append(...)` inyecta `tenant_id` desde `TenantContext` y no expone IDs ni campos de publicación al caller.
- `withTenantTransaction(context, database, callback)` entrega el facade tenant-scoped sobre el mismo `TransactionClient`, sin Prisma raw.
- Commit y rollback atómicos verificados con domain write + Outbox; un insert Outbox inválido revierte también el domain write.
- Seis pruebas Outbox sobre PostgreSQL 18.4 cubren campos físicos, UUIDv7, payload, dos tenants y atomicidad en ambas direcciones.
- Tercera migration `20260813140000_transactional_outbox_foundation`, append-only y sin cambios a las dos migrations históricas.
- `TenantContext` obligatorio, inmutable y validado como UUIDv7 antes de construir acceso tenant-owned.
- `createTenantDataAccess(context, database)` expone únicamente repositories scoped de entitlements y organization units.
- Reads y updates por ID combinan `id` + `tenant_id` en la misma query; acceso cross-tenant se comporta como not found.
- Inputs planos de create/update no aceptan `tenantId`, relación `tenant` ni cambio de `id`; el tenant se inyecta internamente.
- Root `@whatsapp-platform/database` es el camino tenant-safe; `@whatsapp-platform/database/platform` es el escape hatch Prisma explícitamente privilegiado.
- Repositories, AuditLog y Outbox compatibles con Prisma Client normal y `TransactionClient`, sin UnitOfWork.
- Nueve pruebas tenant-aware sobre PostgreSQL real cubren dos tenants, aislamiento, updates, creación, jerarquía y transacción.
- Schema Prisma y las dos migrations permanecen sin cambios y sin drift.
- PK UUID surrogate canónicas como UUIDv7 con tipo físico PostgreSQL UUID y default nativo `uuidv7()`.
- `PlatformFeatureFlag.key` conserva su clave natural; la convención no fuerza UUID sobre identidades naturales deliberadas.
- Timestamps de instantes como `TIMESTAMPTZ(3)` UTC; `created_at` y `updated_at` tienen valor inicial `now()` y Prisma mantiene `updated_at` en operaciones normales.
- Segunda migration `20260813044133_uuidv7_timestamp_conventions` append-only, sin alterar la migration histórica E01-S01.
- PostgreSQL >= 18 declarado requisito mínimo mientras se use `uuidv7()` nativo.
- Doce tests de integración verifican generación DB-side, versión UUID 7, tipos físicos, nullability y actualización Prisma de `updated_at`.
- E01-S01 con Prisma ORM 7.9.1 dentro del boundary `packages/database` y ADR-0011.
- Baseline PostgreSQL versionada para `PlatformDeployment`, `Tenant`, `TenantEntitlement`, `PlatformFeatureFlag` y `OrganizationUnit`.
- Naming físico snake_case, JSONB limitado a configuración/metadata, TIMESTAMPTZ UTC, enums de dominio, FKs e índices baseline.
- `tenant_id NOT NULL` en `tenant_entitlement` y `organization_unit`; FK compuesta impide parent cross-tenant.
- Unique global de `tenant.slug` y unique `(tenant_id, entitlement_key)` con semántica mínima de una fila efectiva por key.
- `business_hours_id` permanece UUID nullable sin FK hasta el epic que introduzca Business Hours.
- Prisma Client reusable con adapter PostgreSQL y lifecycle compartido; sin acoplamiento a `apps/api`.
- Scripts root/package para validate, generate, migrate dev/deploy, Studio e integración DB.
- Migration `20260813040527_initial_platform_baseline` aplicada desde cero y verificada contra PostgreSQL 18.4 real.
- Nueve tests de integración DB para conexión, CRUD baseline, uniques, FKs, jerarquía tenant-consistent y vigencia.

- Agent Skill movida a `.agents/skills/whatsapp-platform-engineering/SKILL.md` con frontmatter estándar y rutas desde la raíz.
- `AGENTS.md` raíz y adaptador `.agents/agents.md` creados sin duplicar el contrato.
- Workspace pnpm con `apps/`, `services/` y `packages/`; pnpm 11.21.0 y Node 24 fijados.
- Next.js 16.3.0 mínimo en `apps/web`.
- NestJS 11.1.29 mínimo en `apps/api` con `GET /health`.
- Procesos mínimos arrancables `worker-jobs` y `worker-whatsapp`, sin BullMQ ni Baileys.
- Boundaries sin comportamiento futuro para document renderer, AI gateway, database, auth, tenancy, RBAC, events, workflows, messaging, processes y UI.
- TypeScript 6.0.3 estricto y configuración compartida.
- Biome, Vitest, scripts root y lockfile reproducible.
- `packages/config` con validación al boot, separación secret/non-secret, defaults seguros, overrides y errores explícitos.
- Compose de desarrollo con PostgreSQL 18.4, Redis 8.8.1, API, web y workers; health checks, named volumes, redes internas y puertos de datos limitados a localhost.
- Imagen de aplicación construida una sola vez y reutilizada por API, web y workers, sin colisiones concurrentes de tags.
- Corepack/pnpm disponible para el usuario runtime `node` sin requerir acceso a red.
- Red `app-network` accesible desde el host para API/web; `data-network` permanece interna.
- Runtime Docker validado con los seis servicios `healthy`, API real en `127.0.0.1:3001/health` y web en `127.0.0.1:3000`.
- `.env.example`, `.gitignore`, `.dockerignore` y `Dockerfile.dev` sin secretos reales.
- Documentación operativa actualizada sin modificar `design-prototype/`.

## In progress

PORTAL-HUB-ROOT-ROUTE está **PASS**. Epic 08 permanece **IN PROGRESS** después de E08-S01; esta tarea transversal no avanza ni renombra historias del epic.

## Blocked

No hay bloqueos para PORTAL-HUB-ROOT-ROUTE. Existe 1 Platform Admin activo para acceso manual en el entorno Compose actual; no hay tenants ni usuarios tenant. El bootstrap continúa siendo explícito y nunca se ejecuta al iniciar la aplicación.

## Next story

`E08-S02 — Event dispatcher`.

## Last verified commands

  - Platform Admin bootstrap local — `pnpm platform-admin:create` PASS; PostgreSQL confirma 1 admin activo con PHC Argon2id y 0 usuarios tenant; login real 200, `/platform/auth/me` 200 con identidad esperada, logout 204, acceso posterior 401 y 0 sesiones no revocadas. `.env` permanece ignorado por Git y no se registraron secretos en archivos versionados.
  - PORTAL-HUB-ROOT-ROUTE — `pnpm exec biome check .` PASS (294 archivos); `pnpm --filter @whatsapp-platform/web typecheck` PASS; `pnpm --filter @whatsapp-platform/web build` PASS con `/`, `/app`, `/app/inbox` y `/platform/tenants`; `pnpm vitest run` PASS (22 archivos/116 pruebas); suites de autenticación tenant/Platform PASS (2 archivos/17 pruebas) contra Nest/PostgreSQL reales; `git diff --check` PASS. No migration nueva.
  - E07-S06 — `docker compose exec api pnpm test` PASS (21 suites / 113 pruebas, incluidas 20 pruebas de View Model y Reducer de eventos SSE); `docker compose exec api pnpm lint` (Biome 0 errores en 278 archivos); `docker compose exec api pnpm --filter @whatsapp-platform/web typecheck` PASS; `docker compose exec -e NODE_ENV=production api pnpm --filter @whatsapp-platform/web build` PASS con ruta `/app/inbox`; `git diff --check` PASS. No migration nueva.
  - E07-S05 — `docker compose build api` PASS; `docker compose run ... pnpm --filter @whatsapp-platform/api test:integration:inbox` PASS (2 archivos/14 pruebas: 12 API + 2 unitarias) contra PostgreSQL 18.4/Nest reales; `prisma validate`, migrate status (15 migrations up to date), Biome dirigido sobre los archivos cambiados y `git diff --check` PASS. No migration nueva.
  - E07-S04 — suites dirigidas ejecutadas en Docker con source mounts mediante Vitest (database 5/5 y API Inbox 11/11) contra PostgreSQL 18.4/Nest reales; Prisma validate, migrate status (15 migrations up to date), TypeScript API/database, Biome (275 archivos), Vitest raíz (20 archivos/93 pruebas) y `git diff --check` PASS. No migration nueva.
  - E06-S06 — Biome dirigido y `git diff --check` PASS. `docker compose run ... tsc` quedó bloqueado porque no existe el pipe `dockerDesktopLinuxEngine`; `pnpm db:generate` host quedó bloqueado por `prisma/build/index.js` ausente; la suite Vitest host no inició por `@whatsapp-platform/config` no resoluble. No se afirma typecheck ni integración E06-S06.
  - E06-S07 — `pnpm exec biome check .` PASS (267 archivos), `pnpm exec vitest run packages/messaging/src/inbound-normalizer.test.ts` PASS (3/3), `git diff --check` PASS. `pnpm --filter @whatsapp-platform/database test:integration:delivery-status` no inició las pruebas porque Vitest no resolvió `@whatsapp-platform/config`; `tsc -p packages/database/tsconfig.json --noEmit` mantiene los errores previos de workspace/Prisma generado. No se afirma PostgreSQL, Prisma ni suite completa.
  - E06-S02 — PASS; Vitest raíz 20 archivos/93 pruebas, Conversation database 5/5, Contact regression 5/5 e Inbound regression 3/3 contra PostgreSQL 18.4 real en Docker con source mounts; `db:validate`, `db:generate`, `db:migrate:deploy` (`20260819230000_add_conversations_foundation`), `prisma migrate status` (12 migrations, up to date), TypeScript/build de workspaces Docker, Biome y `git diff --check` PASS. La exportación/tag final de la nueva imagen Docker no terminó y no se reporta runtime API E06-S02.
  - E06-S03 — PASS; inbound message database 5/5 y Conversation regression 5/5 contra PostgreSQL 18.4 real con source mounts; `db:validate`, `db:generate`, `db:migrate:deploy` (`20260820100000_add_messages_foundation`, 13 migrations), database typecheck, Biome y `git diff --check` PASS. El build Docker de workspaces compiló, pero la exportación final fue interrumpida y no se reporta runtime API E06-S03.
  - E06-S04 — PASS; outbound conversation database 4/4, Conversation regression 5/5 e inbound message regression 5/5 contra PostgreSQL 18.4 real con source mounts; `db:validate`, `db:generate`, `db:migrate:deploy` (`20260820120000_add_outbound_message_correlation` + `20260820121000_align_outbound_message_fk_name`, 15 migrations), `prisma migrate status`, `prisma migrate diff` sin diferencias, database typecheck y Biome PASS. El CLI Prisma host está incompleto; no se reporta imagen/runtime API nueva.
  - E06-S05 — PASS; outbound echo database 5/5, E06-S04 regression 4/4 e E06-S03 regression 5/5 contra PostgreSQL 18.4 real con source mounts; database typecheck Docker, typecheck local, Biome y `git diff --check` PASS. El build Docker nuevo quedó bloqueado durante `pnpm install` por timeout de npm; no se reporta imagen/runtime API nueva.
  - E06-S01 — PASS AFTER FIX; `pnpm vitest run` (20 archivos/93 pruebas), Contact database (5/5), Contact API (3/3), RBAC (11/11), `db:migrate:deploy` con `20260819200000_add_contacts_foundation`, Biome (247 files) y lint clean. Fix: entitlement `module.crm_lite` añadido a `ContactsController` via `@RequireEntitlements` + `TenantEntitlementGuard`; integration test actualizado con `enabledModules: ["module.crm_lite"]`.
  - E05-S03 — PASS; `pnpm vitest run` (19 archivos/90 pruebas), dispatcher (3/3), database (4/4), API (3/3) y worker (1/1) en Docker contra PostgreSQL real; migration deploy/status, Biome, typecheck en contenedor, build Docker `api web worker-whatsapp`, `docker compose ps`, API `/health` y web `/` verificados con HTTP 200.
  - E05-S02 — PASS; `pnpm --filter @whatsapp-platform/database test:integration:inbound-webhooks` (3/3), `pnpm --filter @whatsapp-platform/api test:integration:inbound-webhooks` (4/4), normalizer (3/3), migration deploy, Biome, typecheck y build host; las suites se ejecutaron contra PostgreSQL 18.4/Nest reales en Docker.
  - E05-S01 — PASS; `pnpm vitest run` (17 archivos/84 pruebas), `pnpm --filter @whatsapp-platform/database test:integration:channel-accounts` (4/4), `pnpm --filter @whatsapp-platform/api test:integration:channel-accounts` (5/5), migration deploy, Biome, typecheck y `docker compose build api`.
- E04-S04 regresiones — PASS; Organization Units database 14/14 y API 15/15, tenant detail database 5/5 y API 4/4.
- `tsc -p tsconfig.json --noEmit` / `biome check --formatter-enabled=true --linter-enabled=true .` — PASS; 207 archivos Biome y TypeScript strict.
- `vitest run` — PASS; 16 archivos y 76 pruebas unitarias.
- `docker compose build api web` / runtime — PASS; build completo con ruta Next `/app/users`, API `/health` 200, web `/app/users` 200 y seis servicios healthy.
- `pnpm test:integration:organization-units` — PASS; 14 pruebas database y 15 pruebas API contra PostgreSQL 18.4/Nest reales (E04-S03 Organization Units, incluye fix de subárbol y límite fraccional).
- Regresión completa E04-S03 — PASS; `test:integration:database` (13 archivos/95), `test:integration:auth` (13/93), `test:integration:rbac` (11+11), `test:integration:platform-tenants` (4+5), `test:integration:platform-tenant-detail` (4+4), `test:integration:tenant-provisioning` (4+6), `test:integration:entitlements` (3+5), `test:integration:tenant-status` (3+4), `test:integration:tenant-app-bootstrap` (6), `test:integration:theme-engine` (7+11) y `test:security:tenant-isolation` (9+37) contra PostgreSQL 18.4/Nest reales.
- `pnpm install --frozen-lockfile` / `pnpm rbac:sync-permissions` — PASS; instalación reproducible y 29 permisos sincronizados.
- `pnpm db:validate` / `pnpm db:generate` / `pnpm db:migrate:deploy` / `prisma migrate status` / `prisma migrate diff --exit-code` — PASS; siete migrations y cero drift, shadow DB vía `SHADOW_DATABASE_URL`.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm format:check` / `git diff --check` — PASS; 197 archivos Biome, 15 archivos y 73 pruebas unitarias, 18 workspaces y ruta Next `/app/settings/organization-units` compilada.
- `docker compose config --quiet` / `docker compose build api web` — PASS; imagen Linux con instalación frozen y build completo en el contenedor.
- Runtime Compose E04-S03 — PASS; PostgreSQL, Redis, API, web y workers healthy; API `/health` 200, web `/`, `/app` y `/app/settings/organization-units` 200.
- `pnpm test:integration:theme-engine` — PASS; 7 pruebas database y 9 pruebas API contra PostgreSQL 18.4/Nest reales (E04-S02 Theme Engine).
- `pnpm test:integration:auth` — PASS; 12 archivos y 75 pruebas API/auth, incluidas las regresiones E04-S01/E04-S02.
- `pnpm test:integration:tenant-app-bootstrap` / `pnpm test:security:tenant-isolation` — PASS; 5 pruebas bootstrap y 9 + 37 pruebas de aislamiento/arquitectura (boundary de imports privilegiados conservado).
- `pnpm install --frozen-lockfile` / `pnpm rbac:sync-permissions` — PASS; instalación reproducible y 29 permisos sincronizados.
- `pnpm db:validate` / `pnpm db:generate` / `pnpm db:migrate:deploy` / `prisma migrate status` / `prisma migrate diff --exit-code` — PASS; siete migrations y cero drift, shadow DB vía `SHADOW_DATABASE_URL`.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm format:check` / `git diff --check` — PASS; 184 archivos Biome, 13 archivos y 60 pruebas unitarias, 18 workspaces y ruta Next `/app/settings/theme` compilada.
- `docker compose config --quiet` / `docker compose build api web` — PASS; imagen Linux con instalación frozen y build completo en el contenedor.
- Runtime Compose E04-S02 — PASS; PostgreSQL, Redis, API y web healthy; API `/health` 200, web `/` y `/app` 200.
- `pnpm install --frozen-lockfile` / `pnpm db:validate` / `pnpm db:generate` / `pnpm db:migrate:deploy` / `prisma migrate status` / `prisma migrate diff --exit-code` — PASS; PostgreSQL 18.4 con siete migrations, sin pendientes ni drift.
- `pnpm format` / `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm format:check` — PASS; 153 archivos Biome y suite raíz 8 archivos/30 pruebas.
- `docker compose config --quiet` / `docker compose build api web` / `docker compose up -d` / `docker compose ps` / `GET http://127.0.0.1:3001/health` / `GET http://127.0.0.1:3000/` / `docker compose down` — PASS; postgres, redis, api, web, worker-jobs y worker-whatsapp `healthy`, API 200 `{\"service\":\"api\",\"status\":\"ok\"}`, web 200; volumes preservados.
- `pnpm test:integration:tenant-status` — PASS; 3 pruebas database y 4 pruebas API contra PostgreSQL 18.4/Nest reales.
- `pnpm test:integration:platform-tenants` / `pnpm test:integration:tenant-provisioning` / `pnpm test:integration:platform-tenant-detail` / `pnpm test:integration:entitlements` — PASS; regresiones E03-S01 a E03-S04.
- `pnpm test:integration:entitlements` — PASS; 3 pruebas database y 5 pruebas API contra PostgreSQL 18.4/Nest reales.
- `pnpm test:integration:platform-tenant-detail` / `pnpm test:integration:platform-tenants` / `pnpm test:integration:tenant-provisioning` — PASS; regresiones E03-S01 a E03-S03.
- `pnpm test:integration:database` — PASS; 10 archivos y 71 pruebas PostgreSQL.
- `pnpm test:integration:auth` — PASS; 9 archivos y 57 pruebas API/auth.
- `pnpm test:integration:rbac` — PASS; 11 pruebas database y 11 pruebas API.
- `pnpm test:security:tenant-isolation` — PASS; 9 pruebas database y 37 pruebas API/arquitectura.
- `pnpm install --frozen-lockfile` / `pnpm rbac:sync-permissions` — PASS; instalación reproducible y 29 permisos sincronizados.
- `pnpm db:validate` / `pnpm db:generate` / `pnpm db:migrate:deploy` / `prisma migrate status` / `prisma migrate diff --exit-code` — PASS contra PostgreSQL 18.4 limpio; siete migrations y cero drift.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm format:check` / `git diff --check` — PASS; 8 archivos y 30 pruebas unitarias/frontend.
- `docker compose config --quiet` / `docker compose build api web` — PASS; imagen Linux de API/web reconstruida.
- Runtime Compose E03-S04 — PASS; PostgreSQL, Redis, API y web healthy; API `/health` 200 y web tenant detail 200; `docker compose down` ejecutado sin borrar named volumes.
- `pnpm test:integration:platform-tenant-detail` — PASS; 2 archivos y 8 pruebas contra PostgreSQL 18.4/Nest reales.
- `pnpm test:integration:platform-tenants` / `pnpm test:integration:tenant-provisioning` — PASS; regresiones E03-S01/E03-S02.
- `pnpm test:integration:database` / `pnpm test:integration:auth` / `pnpm test:integration:rbac` / `pnpm test:security:tenant-isolation` — PASS.
- `pnpm db:validate` / `pnpm db:generate` / `pnpm db:migrate:deploy` / `prisma migrate status` / `prisma migrate diff --exit-code` — PASS contra PostgreSQL 18.4; siete migrations y cero drift.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm format:check` / `git diff --check` — PASS; 7 archivos y 27 pruebas unitarias, 16 workspaces y ruta Next `/platform/tenants/[tenantId]` compilada.
- `docker compose config --quiet` / `docker compose build api web` — PASS; layers, manifest e imagen `whatsapp-platform-dev:epic00` exportados y desempaquetados sin errores containerd.
- Runtime Compose — PASS; PostgreSQL, Redis, API, Web, worker-jobs y worker-whatsapp healthy; API `/health` 200, Web tenant detail 200 y API detail sin sesión 401.
- `pnpm test:integration:tenant-provisioning` — PASS; 2 archivos y 10 pruebas PostgreSQL/Nest dedicadas.
- `pnpm test:integration:platform-tenants` — PASS; 2 archivos y 9 pruebas de regresión E03-S01.
- `pnpm test:integration:database` — PASS; 8 archivos y 64 pruebas PostgreSQL.
- `pnpm test:integration:auth` — PASS; 7 archivos y 48 pruebas API/auth.
- `pnpm test:integration:rbac` — PASS; 2 archivos y 22 pruebas.
- `pnpm test:security:tenant-isolation` — PASS; 6 archivos y 46 pruebas.
- `pnpm test` — PASS; 6 archivos y 23 pruebas unitarias/frontend.
- `pnpm lint` / `pnpm typecheck` / `pnpm build` / `pnpm format:check` — PASS; 120 archivos y 16 workspaces, incluidas rutas Next dinámicas `/platform/tenants` y `/platform/tenants/new`.
- `pnpm install --frozen-lockfile` / `pnpm rbac:sync-permissions` / `pnpm db:validate` / `pnpm db:generate` — PASS; 29 permisos sincronizados.
- `pnpm db:migrate:deploy` / `prisma migrate status` / `prisma migrate diff --exit-code` — PASS contra PostgreSQL 18.4; siete migrations existentes y cero drift.
- Atomicidad E03-S02 — PASS; commit completo y rollback real por trigger PostgreSQL temporal retirado después de la prueba.
- `docker compose config --quiet` / `docker compose build api web` — PASS; imagen Linux reconstruida con instalación frozen y las dos rutas Platform.
- Runtime Compose E03-S02 — PASS; PostgreSQL, Redis, API y web healthy; API health 200, control plane sin sesión 401 y `/platform/tenants/new` 200.
- `pnpm rbac:sync-permissions` ejecutado dos veces — PASS; 29 permissions sincronizadas en cada ejecución, sin duplicados ni borrado de fila extra.
- `pnpm test:integration:rbac` — PASS; 2 archivos y 22 pruebas PostgreSQL/Nest dedicadas.
- `pnpm test:integration:database` — PASS; 6 archivos y 56 pruebas contra PostgreSQL 18.4.
- `pnpm test:integration:auth` — PASS; 5 archivos y 37 pruebas, incluidas 11 del guard RBAC.
- `pnpm test:security:tenant-isolation` — PASS; 6 archivos y 46 pruebas, incluidas superficies Role/UserRole/RolePermission.
- `pnpm db:migrate:deploy` desde PostgreSQL 18.4 limpio — PASS; migrations 1–7 aplicadas en orden.
- `prisma migrate status` / `prisma migrate diff --exit-code` — PASS; siete migrations y sin drift.
- Migration E02-S05 SHA-256 — `02f40cb66c2dcaead3083f84e88edbec73fa1c803a6be859b33d72e3ed88e4cf`; migrations históricas 1–6 permanecen intactas.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm format:check` — PASS; 100 archivos revisados, 16 workspaces compilados y 4 archivos/17 pruebas unitarias.
- `docker compose build api` — PASS; imagen Linux `whatsapp-platform-dev:epic00` construida con instalación frozen y build de los 16 workspaces.
- Runtime Compose aislado (`postgres`, `redis`, `api`) — PASS; PostgreSQL 18.4, Redis 8.8.1 y API `healthy`; `GET http://127.0.0.1:53001/health` respondió HTTP 200 con `{"service":"api","status":"ok"}`.
- Limpieza E02-S05 — PASS; cero tenants fixture, exactamente 29 permissions globales, contenedor PostgreSQL temporal retirado y `docker compose down` ejecutado sin borrar named volumes.
- `docker compose config --quiet` — PASS con variables efímeras de validación; no se creó `.env` ni se persistieron secretos.
- Schema/migrations — PASS; `schema.prisma` y las seis migrations permanecen sin cambios, `migrate status` actualizado y `migrate diff` sin drift.
- Limpieza E02-S04 — PASS; cero tenants/audits residuales y contenedor PostgreSQL temporal retirado sin crear named volumes.
- `git diff --check` y secret scan — PASS.
- Matriz E02-S04 — PASS; aislamiento A/B en repositories, auth/context, transacciones concurrentes, rollback, IDs/FKs cross-tenant e inputs hostiles.
- Static privileged-import review — PASS; imports raw limitados a composition root, bootstrap/auth/infraestructura y ningún camino tenant-owned de aplicación.
- Modelos futuros (`Message`, `Conversation`, `Process`, `ActionRequest`, `Quote`, `Document`, portal grants y jobs) — DEFERRED por inexistencia; deberán añadirse al implementar cada superficie.
- `pnpm install --frozen-lockfile` — PASS; 17 workspaces y lockfile reproducible para E02-S04.
- `pnpm db:validate` / `pnpm db:generate` — PASS; schema sin cambios y Prisma Client 7.9.1 generado.
- `pnpm db:migrate:deploy` desde PostgreSQL 18 limpio — PASS; las seis migrations existentes aplicadas, ninguna nueva.
- `prisma migrate status` / `prisma migrate diff --exit-code` — PASS; schema actualizado y sin drift.
- `pnpm test:integration:database` — PASS; 4 archivos, 36 pruebas PostgreSQL sin regresión.
- `pnpm test:integration:auth` — PASS; 3 archivos, 25 pruebas: 8 tenant-context, 10 Tenant User/reset y 7 Platform Admin.
- Pipeline E02-S03 — PASS; context A/B, request sources hostiles, no-session/platform-cookie, revocación/expiración/status, read/write scoped y concurrencia.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm format:check` — PASS.
- `docker compose config --quiet` — PASS con variables locales efímeras.
- `docker compose build api` — PASS; imagen Node 24/Alpine recompilada con E02-S03. El pipeline `/auth/me` + sesión real se verificó en la suite Nest/PostgreSQL.
- Schema/migrations — PASS; `schema.prisma` y migrations 1–6 sin cambios frente a `HEAD` de inicio.
- Static import review — PASS; imports privilegiados limitados a bootstrap/auth/infraestructura y fixtures; ningún endpoint tenant-owned nuevo usa Prisma raw.
- `git diff --check` y secret scan — PASS; contenedores temporales retirados y named volumes preservados.
- `pnpm install` — PASS; 17 workspaces, lockfile generado, pnpm 11.21.0.
- `pnpm lint` — PASS; 60 archivos, sin warnings después de corregir la configuración.
- `pnpm typecheck` — PASS; raíz y 16 workspaces.
- `pnpm test` — PASS; 1 archivo, 3 pruebas reales de configuración.
- `pnpm build` — PASS; 16 workspaces y build de producción Next.js.
- `pnpm format:check` — PASS; 60 archivos.
- `PYTHONUTF8=1 python .../quick_validate.py .agents/skills/whatsapp-platform-engineering` — PASS; `Skill is valid!`.
- `docker compose config --quiet` — PASS con variables locales efímeras.
- `docker version` — PASS; cliente/engine 29.2.1, Docker Desktop 4.62.0, server Linux `amd64`.
- `docker info` — PASS; engine `docker-desktop` sobre kernel WSL2 `6.6.87.2-microsoft-standard-WSL2`.
- `docker context ls` / `docker context show` — PASS; contexto activo `desktop-linux` sobre `dockerDesktopLinuxEngine`.
- `docker compose version` — PASS; Docker Compose v5.0.2.
- `docker compose up -d --build` — PASS después de corregir la colisión de imagen, la caché runtime de Corepack y la red de aplicación.
- `docker compose ps` — PASS; `postgres`, `redis`, `api`, `web`, `worker-jobs` y `worker-whatsapp` en estado `healthy`.
- `curl.exe --fail --silent --show-error http://127.0.0.1:3001/health` — PASS; `{"service":"api","status":"ok"}`.
- `curl.exe --fail --silent --show-error http://127.0.0.1:3000/` — PASS; HTTP 200.
- `docker run --rm --network none --entrypoint pnpm whatsapp-platform-dev:epic00 --version` — PASS; `11.21.0` sin red.
- `docker compose down` — PASS; contenedores/redes retirados y named volumes `postgres-data`/`redis-data` preservados.
- `pnpm install --frozen-lockfile` — PASS; 17 workspaces y lockfile reproducible.
- `pnpm db:validate` — PASS; Prisma schema válido.
- `pnpm db:generate` — PASS; Prisma Client 7.9.1 generado desde output explícito.
- `pnpm db:migrate:deploy` — PASS contra PostgreSQL 18.4 limpio; una migration aplicada.
- `prisma migrate status` — PASS; database schema up to date.
- `prisma migrate diff --from-config-datasource --to-schema ... --exit-code` — PASS; sin diferencias.
- Migration SHA-256 — `743bffcb89c6051759f5417269255c6c6d96359b0520418a2d9c7c7cb37196ab`, igual al checksum registrado por Prisma.
- `pnpm test:integration:database` — PASS; 1 archivo, 9 pruebas contra PostgreSQL real.
- `pnpm lint` — PASS; 63 archivos.
- `pnpm typecheck` — PASS; raíz y 16 workspaces, incluido generate de Prisma.
- `pnpm test` — PASS; 1 archivo, 4 pruebas unitarias de configuración.
- `pnpm build` — PASS; 16 workspaces, Next.js y package database con generate.
- `pnpm format:check` — PASS.
- `git diff --check` — PASS.
- `pnpm install --frozen-lockfile` — PASS; 17 workspaces, lockfile sin cambios de dependencias.
- `pnpm db:validate` / `pnpm db:generate` — PASS; modelos E02-S02 generados con Prisma 7.9.1.
- `pnpm db:migrate:deploy` desde PostgreSQL 18.4 limpio — PASS; migrations 1–6 aplicadas en orden.
- `prisma migrate status` — PASS; seis migrations, database schema up to date.
- `prisma migrate diff --from-config-datasource --to-schema ... --exit-code` — PASS; sin drift.
- Migration E02-S02 SHA-256 — `3859b064fe27b970cc64f5eae24fdda51d4dd06531bce2d70dbb9719edbbad4e`.
- Migrations históricas 1–5 — PASS; sin diferencias frente a `HEAD` inicial de la historia.
- `pnpm test:integration:database` — PASS; 4 archivos, 36 pruebas PostgreSQL sin regresión.
- `pnpm test:integration:auth` — PASS; 2 archivos, 17 pruebas: 10 tenant/reset y 7 Platform Admin regression.
- `pnpm lint` — PASS sin warnings; `pnpm typecheck` — PASS; `pnpm test` — PASS, 3 archivos/14 pruebas; `pnpm build` — PASS; `pnpm format:check` — PASS.
- `docker compose config --quiet` — PASS con variables locales efímeras.
- `docker compose build api` — PASS; build completo Node 24/Alpine con Prisma y Argon2.
- API Docker aislada — PASS; `/health` 200 y login tenant desconocido 401 contra PostgreSQL temporal por `host.docker.internal`.
- Limpieza E02-S02 — PASS; contenedores aislados de API/PostgreSQL retirados y named volumes preservados.
- `git diff --check` — PASS y secret scan sin hallazgos.
- Limpieza E02-S01 — PASS; PostgreSQL temporal y Compose retirados, named volumes preservados.
- `docker compose config --quiet` — PASS sin modificar la infraestructura versionada.
- `pnpm db:validate` — PASS con defaults `dbgenerated("uuidv7()")` y `TIMESTAMPTZ(3)`.
- `pnpm db:generate` — PASS; Prisma Client 7.9.1 generado.
- Migration limpia `20260813040527_initial_platform_baseline` seguida por `20260813044133_uuidv7_timestamp_conventions` — PASS en PostgreSQL 18.4 real.
- Migration E01-S02 SHA-256 — `d29a5f692606c6836e7b3999a3f0b40b6138246a51e5c40c5871c09415dd70d0`.
- `prisma migrate status` — PASS; dos migrations y schema actualizado.
- `prisma migrate diff --from-config-datasource --to-schema ... --exit-code` — PASS; sin diferencias.
- `pnpm test:integration:database` — PASS; 1 archivo, 12 pruebas contra PostgreSQL 18.4 real.
- Inspección `information_schema` — PASS; cuatro PK `uuid` con default `uuidv7()` y 14 timestamps `timestamp with time zone` precisión 3.
- `uuid_extract_version()` / `uuid_extract_timestamp()` — PASS; versión 7 y timestamp disponible.
- `pnpm db:validate` / `pnpm db:generate` — PASS; schema E01-S02 intacto.
- `prisma migrate status` — PASS; dos migrations, database schema up to date.
- `prisma migrate diff --from-config-datasource --to-schema ... --exit-code` — PASS; sin drift.
- `pnpm test:integration:database` — PASS; 2 archivos, 21 pruebas, incluidas 9 tenant-aware contra PostgreSQL 18.4 real.
- `pnpm test` — PASS; 2 archivos, 9 pruebas unitarias, incluida validación de `TenantContext`.
- Inspección de exports — PASS; root sin Prisma raw y subpath `/platform` explícitamente privilegiado.
- Limpieza de fixtures — PASS; cero tenants/entitlements E01-S03 residuales.
- `pnpm install --frozen-lockfile` — PASS; 17 workspaces, lockfile reproducible.
- `pnpm db:validate` / `pnpm db:generate` — PASS; `DomainEventOutbox` generado con Prisma 7.9.1.
- `pnpm db:migrate:deploy` desde PostgreSQL 18.4 limpio — PASS; migrations E01-S01, E01-S02 y E01-S04 aplicadas en orden.
- `prisma migrate status` — PASS; tres migrations, database schema up to date.
- `prisma migrate diff --from-config-datasource --to-schema ... --exit-code` — PASS; sin drift.
- Migration E01-S04 SHA-256 — `093b675c86909179c9707df1d1d92031313c3cb8042f5d0fe0b44c5fa117bfbd`.
- Migrations históricas E01-S01/E01-S02 — PASS; objetos Git del working tree coinciden con `HEAD`.
- `pnpm test:integration:database` — PASS; 3 archivos, 27 pruebas contra PostgreSQL 18.4, incluidas 6 de Outbox.
- Atomicidad Outbox — PASS; commit conjunto, rollback deliberado y rollback del dominio ante insert Outbox inválido.
- Campos físicos — PASS; UUIDv7, UUID/FK tenant NOT NULL, JSONB, `TIMESTAMPTZ(3)`, attempts 0 y campos nullable verificados.
- `pnpm lint` — PASS; 70 archivos.
- `pnpm typecheck` — PASS; raíz y 16 workspaces, incluido Prisma generate.
- `pnpm test` — PASS; 2 archivos, 9 pruebas unitarias.
- `pnpm build` — PASS; 16 workspaces y build Next.js de producción.
- `pnpm format:check` — PASS; 70 archivos.
- `docker compose config --quiet` — PASS con variables locales efímeras.
- `git diff --check` — PASS.
- Limpieza de fixtures/DB temporal — PASS; cero eventos/tenants E01-S04 residuales y contenedor temporal eliminado.
- `pnpm install --frozen-lockfile` — PASS; 17 workspaces, lockfile reproducible para E01-S05.
- `pnpm db:validate` / `pnpm db:generate` — PASS; `AuditLog` generado con Prisma 7.9.1.
- `pnpm db:migrate:deploy` desde PostgreSQL 18.4 limpio — PASS; migrations E01-S01 a E01-S05 aplicadas en orden.
- `prisma migrate status` — PASS; cuatro migrations, database schema up to date.
- `prisma migrate diff --from-config-datasource --to-schema ... --exit-code` — PASS; sin drift.
- Migration E01-S05 SHA-256 — `d6a4ea91628719e6272abefd5cc94e633c2ef106f7aecc996904ea8c1a33a375`.
- Migrations históricas E01-S01/E01-S02/E01-S04 — PASS; objetos Git del working tree coinciden con `HEAD`.
- `pnpm test:integration:database` — PASS; 4 archivos, 36 pruebas contra PostgreSQL 18.4, incluidas 9 de Audit.
- Atomicidad Audit — PASS; commit/rollback domain + Audit + Outbox y rollback de dominio ante Audit inválido.
- Seguridad Audit — PASS; tenant injection, writer platform privilegiado, FK OU tenant-aware, root sin writer platform y cero términos de secrets en fixtures.
- `pnpm lint` — PASS; 72 archivos, sin warnings.
- `pnpm typecheck` — PASS; raíz y 16 workspaces, incluido Prisma generate.
- `pnpm test` — PASS; 2 archivos, 9 pruebas unitarias.
- `pnpm build` — PASS; 16 workspaces y build Next.js de producción.
- `pnpm format:check` — PASS; 72 archivos.
- `docker compose config --quiet` — PASS con variables locales efímeras.
- `git diff --check` — PASS.
- Limpieza E01-S05 — PASS; cero audit/outbox/tenants residuales y contenedor PostgreSQL temporal eliminado.
- `pnpm install --frozen-lockfile` — PASS; Argon2 0.45.1 reproducible y build script autorizado explícitamente.
- `pnpm db:validate` / `pnpm db:generate` — PASS; modelos Platform Admin generados con Prisma 7.9.1.
- `pnpm db:migrate:deploy` desde PostgreSQL 18.4 limpio — PASS; cinco migrations aplicadas en orden.
- `prisma migrate status` — PASS; cinco migrations y database schema up to date.
- `prisma migrate diff --from-config-datasource --to-schema ... --exit-code` — PASS; sin drift.
- Migration E02-S01 SHA-256 — `59ccadb8795ff39df2c8ad40670e15e1623916a620129b7e087438b06e457ff7`.
- `pnpm test:integration:database` — PASS; 4 archivos, 36 pruebas PostgreSQL existentes sin regresión.
- `pnpm test:integration:auth` — PASS; 1 archivo, 7 pruebas de API/auth contra PostgreSQL 18.4 real.
- `pnpm platform-admin:create` — PASS; admin explícito creado, email normalizado y PHC Argon2id verificado sin imprimir password/hash.
- `docker compose build api` — la imagen fue renovada, aunque el cliente agotó su timeout sin emitir salida final; validación directa posterior ejecutó Argon2id dentro de Alpine sin red — PASS.
- API container — PASS; `whatsapp-platform-dev-api-1` healthy y `GET http://127.0.0.1:3001/health` respondió `{"service":"api","status":"ok"}`.
- Compose DB migration con el volumen histórico local — WARN/P1000 por credenciales antiguas del named volume; no se borró ni modificó el volumen. La migration limpia y la suite auth usaron PostgreSQL temporal aislado.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm format:check` — PASS.
- `git diff --check` — PASS.

## Known issues

- E06-S06/E06-S07 requieren reejecutar typecheck, suite PostgreSQL y regresiones cuando Docker Desktop vuelva a exponer `dockerDesktopLinuxEngine`; el checkout host conserva symlinks/workspace y Prisma incompletos.
- El proveedor CI permanece deliberadamente sin seleccionar hasta que exista un remote o una decisión documental explícita.
- El rate limiter E02-S01 es local a cada proceso; coordinación distribuida queda para una historia operativa futura si la topología escala horizontalmente.
- Los limiters E02-S02 también son locales a proceso y deben distribuirse antes de horizontal scaling.
- `PasswordResetDelivery` no tiene adapter SMTP/provider operativo; la API conserva respuesta genérica y nunca devuelve el token, pero recovery real debe permanecer deshabilitado hasta configurarlo.
- MFA, RLS, publisher/dispatcher Outbox, TimelineEvent y entidades posteriores permanecen fuera de alcance.
