# ADR-0007 — Infraestructura inicial en servidor propio con Cloudflare Tunnel

**Status:** Accepted  
**Date:** 2026-08-12

## Context

Se dispone de servidor propio y se quiere evitar depender de free tiers de nube para la operación principal.

## Decision

Ejecutar MVP/primeros clientes en servidor propio con Docker Compose y publicar servicios web mediante Cloudflare Tunnel persistente. PostgreSQL y Redis no se exponen a Internet.

## Consequences

Reduce costo inicial, pero requiere buenos backups, monitoreo, capacidad de disco y runbooks.

## Affected documents

SYSTEM_DESIGN, DEPLOYMENT, SECURITY, RUNBOOK_OPERATIONS.
