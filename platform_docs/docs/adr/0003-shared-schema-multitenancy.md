# ADR-0003 — Multi-tenancy inicial con schema compartido y tenant_id

**Status:** Accepted  
**Date:** 2026-08-12

## Context

El SaaS inicial debe operar varios tenants de forma eficiente sin mantener una DB por cliente, conservando posibilidad de dedicated/customer-hosted.

## Decision

En shared SaaS, usar PostgreSQL con schema común y `tenant_id NOT NULL` en entidades tenant-owned. El tenant se deriva de contexto autenticado. Repositories y tests de aislamiento son obligatorios. RLS podrá añadirse como defensa adicional.

## Alternatives considered

- DB por tenant: mayor aislamiento, pero sobrecarga operativa prematura.
- Schema por tenant: complejidad de migraciones/operación.

## Consequences

Requiere disciplina estricta de queries, índices y pruebas negativas.

## Affected documents

SYSTEM_DESIGN, DATA_MODEL, SECURITY, TESTING_STRATEGY.
