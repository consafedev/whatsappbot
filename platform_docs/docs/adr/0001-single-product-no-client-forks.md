# ADR-0001 — Un solo producto y cero forks permanentes por cliente

**Status:** Accepted  
**Date:** 2026-08-12

## Context

La plataforma debe servir a múltiples clientes e industrias, incluyendo despliegues shared, dedicated y customer-hosted. Mantener una rama/copia por cliente generaría divergencia, bugs repetidos y costo de mantenimiento creciente.

## Decision

Mantener un único repositorio, un único producto, un esquema de versionado y migraciones comunes. Las diferencias por cliente se resuelven mediante configuración, entitlements, branding, industry templates, custom fields, rules, process definitions y extension points aprobados.

Queda prohibido introducir excepciones de cliente en Core mediante condicionales por tenant.

## Alternatives considered

- Fork por cliente: rechazado por mantenimiento.
- Copias independientes del repositorio: rechazado por divergencia.
- Producto completamente rígido: rechazado porque los nichos requieren configuración.

## Consequences

Positivas: upgrades comunes, menor deuda, escalamiento comercial.  
Negativas: exige invertir en configuración y boundaries genéricos desde temprano.

## Migration/rollback

No aplica todavía. Si en el futuro un cliente requiere lógica excepcional, crear plugin/connector aislado sin fork.

## Affected documents

PRD, SYSTEM_DESIGN, SKILL, DATA_MODEL.
