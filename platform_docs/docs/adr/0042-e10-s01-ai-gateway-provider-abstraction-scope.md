# ADR-0042 — E10-S01 AI Gateway Provider Abstraction, Key Pooling & Token Ledger Scope

- Status: Accepted
- Date: 2026-08-27
- Owners: Platform Engineering

## Context

La historia E10-S01 inicia la implementación de **Epic 10 (AI Gateway Foundation)** estableciendo una capa unificada y extensible de integración con modelos de lenguaje (LLMs), desacoplando las reglas de negocio de los SDKs propietarios y garantizando balanceo de claves, cifrado en reposo, soporte de LLMs locales y registro transaccional de costos y consumo de tokens.

En cumplimiento de ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0009 (Rules-First, AI-Optional), ADR-0010 (Modules & Entitlements) y ADR-0012 (UUIDv7):

1. **Esquema de Base de Datos y Migración (`packages/database/prisma/`)**:
   - `AiProviderConfig`: Configuración universal de proveedores (OpenAI, DeepSeek, Groq, Ollama, Google Gemini, Mock) a nivel de plataforma (`tenantId = null`) o por inquilino (`BYOK`), con `baseUrl`, `providerType`, `isEnabled`, `isDefault` y metadatos JSONB.
   - `AiKeyPool`: Bolsa de múltiples API keys por proveedor con `encryptedKey` (AES-256-GCM), `keyMask` seguro para visualización (ej. `sk-...1234`), estado (`"active" | "rate_limited" | "disabled"`), `rateLimitedUntil`, `priority` y conteo atómico `totalCalls`.
   - `AiUsageLog`: Registro transaccional de consumo con tokens de entrada (`prompt_tokens`), tokens de salida (`completion_tokens`), tokens totales (`total_tokens`), costo estimado en USD (`cost_estimated_usd`), latencia en milisegundos (`latency_ms`), propósito (`"test" | "smart_reply" | "triage" | "autonomous_agent"`) y estado de ejecución.
2. **Abstracción Universal y Adaptadores (`services/ai-gateway/src/`)**:
   - `AiProvider`: Interfaz desacoplada con `generateCompletion(request, credentials)` y `fetchAvailableModels(credentials)`.
   - `OpenAiCompatibleProvider`: Cliente HTTP universal para cualquier API estándar de OpenAI (`/v1/chat/completions` y `/v1/models`), permitiendo interoperabilidad inmediata con OpenAI oficial, DeepSeek, Groq, OpenRouter, vLLM y Ollama local mediante configuración de `baseUrl` y `apiKey`.
   - `GoogleGeminiProvider`: Adaptador para la API de Google Gemini (`:generateContent` y consulta de modelos).
   - `MockAiProvider`: Proveedor determinista offline para pruebas continuas y CI.
   - `KeyPoolSelector`: Algoritmo de rotación que selecciona la clave activa con mayor prioridad y menor conteo de llamadas (`totalCalls`), descartando automáticamente claves deshabilitadas o en período de enfriamiento por rate limit (`rateLimitedUntil`).
   - Criptografía segura: Encriptación simétrica AES-256-GCM en formato canónico del monorepo (`v1.iv.tag.ciphertext`) y enmascaramiento estricto (`maskApiKey`).
   - Timeout estricto de 15 segundos en todas las llamadas HTTP salientes a LLMs mediante `AbortSignal.timeout(15000)`.
3. **Gestor de Datos y Aislamiento Multi-inquilino (`packages/database/src/ai-gateway-manager.ts`)**:
   - `createAiProviderConfig` / `addKeyToPool` / `updateKeyStatus`: CRUD tipado con auditoría.
   - `resolveProviderAndKey`: Resuelve proveedores priorizando configuración BYOK del inquilino antes de recurrir a los proveedores compartidos de plataforma configurados por Super Admin.
   - `recordAiUsage`: Inserción transaccional de métricas con incremento atómico de llamadas en el pool de claves.
   - `getTenantAiUsageSummary`: Agregación de consumo de tokens y costos estrictamente aislada por `tenantId`.
4. **Endpoints REST de Diagnóstico (`apps/api/src/ai-gateway.ts`)**:
   - `GET /api/v1/ai/models/discover`: Descubrimiento en vivo de modelos disponibles en un proveedor.
   - `POST /api/v1/ai/completions/test`: Prueba rápida de generación con registro automático en el ledger.
   - `GET /api/v1/ai/usage/summary`: Resumen de consumo de tokens y costos del inquilino.
   - Protegidos por `TenantUserSessionGuard`, `TenantContextGuard`, `TenantPermissionGuard` (`ai.settings.manage`) y `TenantEntitlementGuard` (`module.ai`).

## Decision

1. **Abstracción Universal Basada en Protocolo OpenAI**:
   - La adopción del estándar `/v1/chat/completions` como interfaz común minimiza el código de integración y permite alternar entre modelos comerciales en la nube y modelos locales (Ollama/vLLM) sin modificar el núcleo de la plataforma.
2. **Pool de Claves Dinámico y Resiliente**:
   - Se implementa selección por prioridad y balanceo por menor uso, permitiendo a las empresas distribuir cuotas entre múltiples claves y gestionar límites de tarifa sin interrupción de servicio.
3. **Seguridad y Privacidad Estricta**:
   - Jamás se almacenan ni devuelven claves en texto plano. Todas las claves son cifradas con AES-256-GCM y enmascaradas para administración visual.

## Backlog Scope and Story Reconciliation

- E10-S01 (**AI Gateway Universal Provider Abstraction, Key Pooling & Token Usage Ledger**) queda implementada y verificada.
- La siguiente historia será E10-S02 (**Resilient Multi-Model Routing, Failover Cascade & Tenant Virtual Aliases**).
