# ADR-0045 — E10-S04 Multi-Tenant RAG Engine, Vector Similarity Search & Context Retrieval Scope

- Status: Accepted
- Date: 2026-08-27
- Owners: Platform Engineering

## Context

La historia E10-S04 continúa la implementación de **Epic 10 (AI Gateway Foundation)** construyendo el motor de Generación Aumentada por Recuperación (RAG - *Retrieval-Augmented Generation*), el cálculo matemático puro de similitud de coseno, el formateador de bloques de contexto con citas delimitadas, el gestor de búsqueda semántica en base de datos y los endpoints REST de consulta de conocimiento y completado con contexto RAG integrado.

En estricto cumplimiento de ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0009 (Rules-First, AI-Optional), ADR-0010 (Modules & Entitlements) y ADR-0042 a ADR-0044:

1. **Motor Matemático de Similitud Vectorial (`services/ai-gateway/src/vector-math.ts`)**:
   - `cosineSimilarity`: Función pura y determinista que calcula el producto punto y las magnitudes euclidianas normalizadas entre dos vectores $\vec{a}$ y $\vec{b}$:
     $$\text{sim}(\vec{a}, \vec{b}) = \frac{\sum_{i=1}^n a_i b_i}{\sqrt{\sum_{i=1}^n a_i^2} \cdot \sqrt{\sum_{i=1}^n b_i^2}}$$
   - Incluye protección ante dimensiones vacías, longitud desigual y división por cero, acotando el resultado en $[-1.0, 1.0]$.
   - `rankChunksBySimilarity`: Ordena fragmentos recuperados en orden descendente de relevancia, filtrando por umbral mínimo `minScore` (predeterminado 0.70) y truncando a los mejores `topK` (predeterminado 3).
2. **Formateador de Contexto e Inyección de Citas (`services/ai-gateway/src/rag-context-builder.ts`)**:
   - `buildRagContextPrompt`: Genera un bloque estructurado en Markdown con delimitadores claros:
     ```markdown
     --- CONTEXTO DE LA BASE DE CONOCIMIENTO ---
     [Fuente: {documentTitle} | Fragmento #{chunkIndex} | Relevancia: {score}%]
     {content}
     --- FIN DEL CONTEXTO ---
     ```
   - Retorna cadena vacía cuando ningún fragmento supera el umbral de relevancia, previniendo contaminación de contexto o respuestas alucinadas.
   - `injectRagContextIntoMessages`: Concatena de forma segura el bloque de conocimiento en el mensaje de sistema (`role: "system"`) existente o antepone una directiva de sistema si no existía previamente.
3. **Gestor de Búsqueda Semántica Multi-inquilino (`packages/database/src/knowledge-search-manager.ts`)**:
   - `searchKnowledgeChunks`: Consulta fragmentos en PostgreSQL garantizando aislamiento absoluto mediante `where: { tenantId, document: { status: "INDEXED" } }`.
   - Recupera el título del documento padre y clasifica los fragmentos mediante `rankChunksBySimilarity`.
4. **Endpoints REST en API (`apps/api/src/knowledge-base.ts` y `apps/api/src/ai-gateway.ts`)**:
   - `POST /api/v1/ai/knowledge/documents/query`: Diagnóstico y consulta directa de conocimiento semántico (retorna 200 OK con fragmentos coincidentes y puntuaciones).
   - `POST /api/v1/ai/completions/rag`: Orquestación RAG completa de extremo a extremo:
     1. Extrae el texto de consulta de `queryText`, `prompt` o del último mensaje de usuario.
     2. Genera el embedding de consulta mediante `createEmbeddingProvider`.
     3. Busca fragmentos semánticos aislados en el inquilino activo.
     4. Formatea e inyecta el contexto en el prompt.
     5. Enruta la ejecución hacia `AiResilientRouter` con failover automático.
     6. Contabiliza el consumo total (tokens de embedding + tokens de completado) en `AiUsageLog`.
     7. Retorna 200 OK con respuesta, citas asociadas, modelo/proveedor empleado y métricas de latencia.
   - Protegidos por guards de sesión, contexto de inquilino, permisos RBAC (`ai.settings.manage`) y habilitación de módulo (`module.ai`).

## Decision

1. **Aislamiento Multi-inquilino en Recuperación RAG**:
   - Toda búsqueda vectorial está condicionada inmutablemente por el `tenantId` del contexto de sesión en la consulta SQL. Se valida mediante pruebas de integración A/B que las búsquedas del inquilino B jamás retornan contenido o fragmentos del inquilino A.
2. **Desacoplamiento Matemático y Portabilidad**:
   - La similitud vectorial se ejecuta a nivel de aplicación sobre los arrays numéricos almacenados, garantizando independencia total de complementos binarios propietarios o incompatibilidades de controladores en diferentes plataformas.
3. **Transparencia y Trazabilidad de Citas**:
   - Cada respuesta RAG incluye la lista explícita de citas utilizadas (`documentId`, `documentTitle`, `chunkIndex`, `score`), permitiendo al usuario final y a los operadores verificar la fuente exacta del conocimiento.

## Backlog Scope and Story Reconciliation

- E10-S04 (**Multi-Tenant RAG Engine, Vector Similarity Search & Knowledge Retrieval Pipeline**) queda implementada y verificada.
- La siguiente historia será E10-S05 (**Autonomous WhatsApp Agent, Triage Policy & Knowledge Directives**).
