# ADR-0006 — Rules Engine propio; n8n fuera del Core

**Status:** Accepted  
**Date:** 2026-08-12

## Context

La plataforma necesita automatizaciones multi-tenant. n8n puede ser útil como integración, pero introducirlo como motor central agrega dependencia operativa/licenciamiento y no debe definir el producto.

## Decision

Implementar Rules Engine propio basado en trigger + conditions + actions. No ejecutar código arbitrario del tenant. n8n podrá utilizarse en integraciones internas o casos concretos sólo si la licencia y arquitectura lo permiten, nunca como dependencia del Core.

## Consequences

MVP implementa un builder acotado y seguro, no un clon completo de n8n.

## Affected documents

PRD, SYSTEM_DESIGN, SKILL.
