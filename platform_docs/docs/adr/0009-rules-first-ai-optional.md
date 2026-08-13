# ADR-0009 — Reglas deterministas primero; IA opcional detrás de gateway

**Status:** Accepted  
**Date:** 2026-08-12

## Context

Se quiere aprovechar múltiples proveedores/modelos de IA, incluidos económicos/gratuitos, sin convertirlos en punto único de fallo ni permitir decisiones críticas no deterministas.

## Decision

El sistema debe funcionar sin IA. La IA se accede mediante AI Gateway por task routes, con policy, clasificación de datos, routing y fallback. Precios, permisos, estados, transiciones y autorizaciones finales permanecen deterministas.

## Consequences

La IA puede mejorar UX/capacidad sin comprometer operación base. Cada output que cause side effects se valida estructuralmente.

## Affected documents

PRD, SYSTEM_DESIGN, SKILL, SECURITY.
