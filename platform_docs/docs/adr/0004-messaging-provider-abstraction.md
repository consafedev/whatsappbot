# ADR-0004 — Abstracción de proveedores de mensajería

**Status:** Accepted  
**Date:** 2026-08-12

## Context

El MVP prioriza WhatsApp por QR, pero no se quiere depender de una sola librería ni convertir WhatsApp en la fuente de verdad.

## Decision

Definir un `MessagingProvider` y modelo de mensaje normalizado. Implementar Baileys primero, WPPConnect después y Meta WhatsApp Business como provider oficial posterior. Sesiones de providers son independientes y no se presumen migrables/transparientemente intercambiables.

## Consequences

Tipos de SDKs externos no pueden filtrarse al dominio. Requiere contract tests comunes.

## Affected documents

PRD, SYSTEM_DESIGN, SKILL, DATA_MODEL.
