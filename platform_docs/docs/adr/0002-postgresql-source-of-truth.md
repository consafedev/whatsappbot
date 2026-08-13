# ADR-0002 — PostgreSQL como fuente de verdad

**Status:** Accepted  
**Date:** 2026-08-12

## Context

El dominio es altamente relacional: tenants, usuarios, contactos, conversaciones, procesos, estados, citas, cotizaciones, documentos, permisos y auditoría.

## Decision

Usar PostgreSQL como base de datos principal y fuente de verdad de todo estado crítico. Redis/BullMQ quedan para queue, cache, scheduling y estado efímero.

## Alternatives considered

- Firestore/NoSQL como DB central: rechazado porque forzaría el modelo relacional y no aporta ventaja suficiente.
- Redis como estado de workflows: rechazado por pérdida de verdad ante fallos.

## Consequences

La aplicación debe poder reconstruir/reconciliar trabajo asíncrono desde PostgreSQL.

## Affected documents

PRD, SYSTEM_DESIGN, DATA_MODEL, backup/runbooks.
