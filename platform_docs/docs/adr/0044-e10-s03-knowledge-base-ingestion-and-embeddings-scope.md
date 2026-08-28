# ADR-0044 — E10-S03 Knowledge Base Ingestion, Chunking & Embeddings Scope

- Status: Accepted
- Date: 2026-08-27
- Owners: Platform Engineering

## Context

La historia E10-S03 continúa la implementación de **Epic 10 (AI Gateway Foundation)** estableciendo el pipeline de ingesta de documentos, particionado semántico recursivo (*text chunking*), generación de vectores de incrustación (*embeddings*) mediante adaptadores unificados (`MockEmbeddingProvider`, `OpenAiCompatibleEmbeddingProvider`, `GoogleGeminiEmbeddingProvider`) y persistencia estructurada de fragmentos en PostgreSQL.

En estricto cumplimiento de ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0009 (Rules-First, AI-Optional), ADR-0010 (Modules & Entitlements) y ADR-0042/ADR-0043:

1. **Esquema de Base de Datos y Migración Prisma (`packages/database/prisma/`)**:
   - `KnowledgeDocument`: Representa el documento fuente (formatos `text`, `markdown`, `faq`, `pdf_text`) con metadatos, conteo de caracteres/tokens y ciclo de vida de indexación (`PENDING`, `PROCESSING`, `INDEXED`, `FAILED`).
   - `KnowledgeChunk`: Representa cada fragmento de texto particionado con su índice correlativo (`chunkIndex`), embedding numérico (`embedding` almacenado como JSONB para portabilidad estándar y compatibilidad multi-entorno), `modelId` y llaves foráneas en cascada.
   - Migración Prisma `20260827200000_add_knowledge_base` con índices compuestos y claves únicas compuestas `[tenantId, id]` para aislamiento estricto.
2. **Particionador Semántico Recursivo (`services/ai-gateway/src/text-chunker.ts`)**:
   - `chunkText`: Algoritmo que respeta límites sintácticos naturales (párrafos `\n\n`, saltos de línea `\n`, terminaciones de oración `. `, `? `, `! `, y palabras) con solapamiento (*overlap*) configurable para preservar el contexto continuo entre fragmentos consecutivos.
   - `sanitizeText`: Limpieza obligatoria de caracteres nulos (`\0`) para evitar corrupción en PostgreSQL.
3. **Abstracción Universal de Embeddings (`services/ai-gateway/src/embeddings/`)**:
   - `AiEmbeddingProvider`: Interfaz desacoplada con método `generateEmbeddings`.
   - `MockEmbeddingProvider`: Generador determinista de vectores unitarios normalizados derivado de hash para ejecución reproducible en CI y entornos de prueba offline.
   - `OpenAiCompatibleEmbeddingProvider`: Adaptador universal `/v1/embeddings` (OpenAI, DeepSeek, Ollama) con timeout estricto de 15 segundos (`AbortSignal.timeout(15000)`).
   - `GoogleGeminiEmbeddingProvider`: Adaptador para Google Gemini API (`:batchEmbedContents`).
4. **Gestor de Base de Conocimiento (`packages/database/src/knowledge-base-manager.ts`)**:
   - `createKnowledgeDocument`: Inserción inicial del documento en estado `PENDING`.
   - `indexKnowledgeDocument`: Transición a `PROCESSING`, ejecución de `chunkText`, invocación del proveedor de embeddings y persistencia atómica en transacción `$transaction` con actualización final a `INDEXED` (o `FAILED` ante errores).
   - `getKnowledgeDocumentDetail`, `listKnowledgeDocuments`, `deleteKnowledgeDocument`: Consultas y eliminaciones con aislamiento estricto por `tenantId`.
5. **Endpoints REST en API (`apps/api/src/knowledge-base.ts`)**:
   - `POST /api/v1/ai/knowledge/documents`: Creación e indexación automática con retorno 201 Created.
   - `GET /api/v1/ai/knowledge/documents`: Listado paginado con contador de fragmentos por documento.
   - `GET /api/v1/ai/knowledge/documents/:documentId`: Detalle del documento y vista previa de sus fragmentos.
   - `DELETE /api/v1/ai/knowledge/documents/:documentId`: Eliminación en cascada de documento y sus fragmentos.
   - Protegidos por guards de sesión, contexto de inquilino, permisos RBAC (`ai.settings.manage`) y habilitación de módulo (`module.ai`).

## Decision

1. **Aislamiento Multi-inquilino en Base de Conocimiento**:
   - Toda operación de consulta, inserción, indexación o eliminación valida estrictamente `where: { tenantId }`, impidiendo cualquier fuga de datos o fragmentos entre inquilinos.
2. **Desacoplamiento del Motor de Embeddings**:
   - Los documentos y fragmentos pueden ser indexados mediante cualquier proveedor compatible, permitiendo alternar entre modelos locales, OpenAI o Google Gemini según la configuración del inquilino.
3. **Indexación Atómica y Resiliente**:
   - El reemplazo de fragmentos y la actualización de contadores y estados ocurren dentro de transacciones de base de datos, garantizando consistencia completa ante fallos de red o reinicios de proceso.

## Backlog Scope and Story Reconciliation

- E10-S03 (**Knowledge Base Document Ingestion, Chunking & Vector Embeddings**) queda implementada y verificada.
- La siguiente historia será E10-S04 (**Multi-Tenant RAG Engine, Vector Similarity Search & Knowledge Retrieval Pipeline**).
