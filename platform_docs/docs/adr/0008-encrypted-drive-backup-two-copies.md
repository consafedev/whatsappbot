# ADR-0008 — Backups cifrados asíncronos en Google Drive con dos copias

**Status:** Accepted  
**Date:** 2026-08-12

## Context

Se necesita copia offsite flexible aprovechando almacenamiento disponible en Google Drive, sin depender de Cloud Storage/free tiers.

## Decision

Generar backup completo local, comprimir, cifrar, calcular checksum, subir asíncronamente a Google Drive y verificar. Conservar dos backups remotos confirmados: `current` y `previous`. El tercero sólo se elimina después de verificar el nuevo.

## Consequences

El backup completo puede crecer con attachments; la estrategia se reevaluará al aumentar volumen. Restore drill obligatorio antes de cliente pagado.

## Affected documents

SYSTEM_DESIGN, DATA_MODEL, RUNBOOK_BACKUP_RESTORE, SECURITY.
