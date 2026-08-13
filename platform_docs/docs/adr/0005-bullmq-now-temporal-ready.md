# ADR-0005 — BullMQ en MVP con arquitectura preparada para Temporal

**Status:** Accepted  
**Date:** 2026-08-12

## Context

El MVP necesita reminders, retries, delayed jobs y side effects, pero desplegar Temporal desde el inicio aumentaría complejidad operativa antes de validar ventas.

## Decision

Crear interfaz `WorkflowOrchestrator`; usar BullMQ + Redis como adapter MVP. PostgreSQL conserva referencias/estado crítico y existe reconciliación. Temporal se evaluará cuando los workflows durables de larga duración lo justifiquen.

## Alternatives considered

- Temporal desde V1: robusto pero prematuro.
- BullMQ importado directamente por todo el dominio: rechazado porque dificulta migración.

## Consequences

Hay que mantener boundary claro y jobs idempotentes.

## Affected documents

SYSTEM_DESIGN, SKILL, DATA_MODEL, ROADMAP.
