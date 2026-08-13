# ADR-0010 — Módulos y límites administrados por Super Admin mediante entitlements

**Status:** Accepted  
**Date:** 2026-08-12

## Context

Cada cliente puede contratar combinaciones distintas: automatización básica, cotización, agenda, procesos avanzados, portal, IA, múltiples cuentas WhatsApp, etc.

## Decision

El Super Admin habilita/deshabilita módulos y límites por tenant mediante `tenant_entitlement`. El tenant sólo puede configurar/usar capacidades contratadas. La validación ocurre en UI, API y workers cuando aplique. Deshabilitar un módulo no elimina datos.

## Consequences

Permite pricing modular, upgrades y control de capacidad sin forks.

## Affected documents

PRD, SYSTEM_DESIGN, DATA_MODEL, UI_FLOWS.
