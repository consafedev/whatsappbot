# ADR-0047 — E10-S06 AI Console, Knowledge Base Management & Agent Settings Web UI Scope

- Status: Accepted
- Date: 2026-09-02
- Owners: Platform Engineering

## Context

La historia E10-S06 culmina la entrega de **Epic 10 (AI Gateway & Knowledge Agent MVP Foundation)** proporcionando la interfaz gráfica de usuario en Next.js (`apps/web/app/app/ai/`) para la administración integral de las capacidades de inteligencia artificial del inquilino, la base de conocimiento vectorial y la telemetría de consumo.

En estricto cumplimiento de ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0009 (Rules-First, AI-Optional), ADR-0010 (Modules & Entitlements) y ADR-0042 a ADR-0046:

1. **Arquitectura del Cliente y View Model (`apps/web/app/app/ai/ai-view-model.ts`)**:
   - Modelado tipado de datos: `TenantAiAgentConfig`, `KnowledgeDocumentItem`, `KnowledgeDocumentDetail`, `KnowledgeChunkItem` y `AiUsageSummary`.
   - Clientes de consumo HTTP REST desacoplados:
     - `fetchAiAgentConfig`: Consulta de configuración del agente vía `GET /api/v1/ai/agent/config`.
     - `updateAiAgentConfig`: Actualización de directivas y modos vía `PUT /api/v1/ai/agent/config`.
     - `fetchKnowledgeDocuments`: Listado paginado vía `GET /api/v1/ai/knowledge/documents`.
     - `createKnowledgeDocument`: Ingesta e indexación vectorial vía `POST /api/v1/ai/knowledge/documents`.
     - `fetchKnowledgeDocumentDetail`: Detalle y visor de fragmentos vía `GET /api/v1/ai/knowledge/documents/:id`.
     - `deleteKnowledgeDocument`: Eliminación en cascada vía `DELETE /api/v1/ai/knowledge/documents/:id`.
     - `fetchAiUsageSummary`: Métricas agregadas de consumo vía `GET /api/v1/ai/usage/summary`.
   - Funciones auxiliares de formateo: `formatDocumentStatus`, `formatTokens`, `formatCostUsd`, `parseKeywordsInput` y `formatKeywordsOutput`.

2. **Componentes Visuales y Organización en Pestañas (`apps/web/app/app/ai/`)**:
   - **`ai-client.tsx` & `page.tsx`**: Contenedor orquestador en `/app/ai` protegido con validación defensiva de derecho de módulo (`module.ai`) y permiso RBAC (`ai.settings.manage`). Incluye sistema de alertas tipo toast y navegación entre tres pestañas principales:
     - **Pestaña 1: "Agente Autónomo" (`ai-agent-settings-tab.tsx`)**:
       - Toggle de activación general (`isEnabled`).
       - Selector visual de modos de coexistencia (`RULES_ONLY`, `HYBRID_RULES_AI`, `FULL_AI`).
       - Área de texto para directivas persistentes del sistema (`systemDirectives`).
       - Campo para clave de alias virtual (`virtualAliasKey`).
       - Slider de umbral de similitud mínima para citas RAG (`minConfidenceScore` entre 50% y 95%).
       - Editor de palabras clave de traspaso humano con etiquetas (*tags*) visuales (`humanHandoffKeywords`).
       - Mensaje configurable para horario inhábil (`outOfHoursReply`).
     - **Pestaña 2: "Base de Conocimiento" (`ai-knowledge-tab.tsx` & `knowledge-document-modal.tsx`)**:
       - Tabla interactiva con búsqueda por título, conteo de tokens y badges de estado (`INDEXED`, `PROCESSING`, `FAILED`).
       - Modal accesible para carga e indexación inmediata de documentos (`markdown`, `text`, `faq`).
       - Modal de inspección de fragmentos vectoriales (*chunks*) para auditar el particionado semántico del documento.
       - Cuadro de diálogo modal de confirmación antes de eliminar documentos y sus fragmentos en cascada.
     - **Pestaña 3: "Consumo y Costos" (`ai-usage-tab.tsx`)**:
       - Tarjetas de métricas de telemetría: Peticiones Totales, Tokens de Entrada (Prompt), Tokens de Salida (Completado), Consumo Total de Tokens, Costo Estimado en USD y Latencia Promedio (ms).

3. **Integración en Navegación (`apps/web/app/app/tenant-app-navigation.ts`)**:
   - Enlace `/app/ai` ("Inteligencia Artificial") añadido bajo el grupo de Configuración, condicionado estrictamente a la posesión del módulo `module.ai` y del permiso `ai.settings.manage`.

## Decision

1. **Gestión Documental Centralizada (Document as Unit of Management)**:
   - La unidad de administración para el usuario es el documento completo. La fragmentación (*chunking*) y la vectorización se ejecutan de manera automática y determinista en el backend, permitiendo visualización transparente de fragmentos pero evitando edición manual desfasada de vectores individuales.
2. **Defensa en Profundidad en UI**:
   - La interfaz no solo oculta los enlaces de navegación si el inquilino carece del módulo `module.ai` o si el usuario no tiene `ai.settings.manage`, sino que `AiClient` implementa pantallas de bloqueo amigables explicando el requerimiento ante accesos directos por URL.
3. **Cierre y Cumplimiento de Epic 10**:
   - Con la entrega verificada de E10-S06, todas las historias de Epic 10 (E10-S01 a E10-S06) quedan completadas, marcando **Epic 10 como COMPLETE**.

## Backlog Scope and Story Reconciliation

- E10-S06 (**AI Console, Knowledge Base Management & Agent Settings Web UI**) queda implementada y verificada.
- **Epic 10 (AI Gateway & Knowledge Agent MVP Foundation)** queda completamente finalizado y aprobado.
- La siguiente etapa del producto es Epic 11 (**Campaign Engine & Audience Broadcasts**).
