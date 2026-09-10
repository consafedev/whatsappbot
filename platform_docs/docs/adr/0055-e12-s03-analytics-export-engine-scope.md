# ADR-0055 — E12-S03 Analytics Export Engine & CSV Download Scope

- Status: Accepted
- Date: 2026-09-10
- Owners: Backend Engineering, Frontend Engineering & Platform Architecture

## Context

Continuando con la ejecución de **Epic 12 (Reporting, Analytics & Operational Observability)** tras el motor backend E12-S01 y la interfaz interactiva E12-S02, la historia E12-S03 implementa las capacidades de exportación de analítica operacional en formato CSV para inquilinos autorizados.

En estricto apego a ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0010 (Modules & Entitlements), ADR-0014 (Audit Integrity) y ADR-0053 (Analytics Engine):

1. **Motor de Generación CSV Puro (`packages/database/src/analytics-export-manager.ts`)**:
   - `escapeCsvField(field)`: Escapado determinista y seguro según RFC 4180 (comillas dobles escapadas mediante duplicación `""`, envoltura en comillas si contiene comas, saltos de línea `\n` o comillas dobles, neutralización preventiva de inyección de fórmulas de hojas de cálculo).
   - `generateOperationalOverviewCsv(overview, options)`:
     - Genera archivo CSV estructurado con prefijo UTF-8 BOM (`\uFEFF`) para compatibilidad directa e inmediata con Microsoft Excel y hojas de cálculo en plataformas Windows y macOS.
     - Formatea metadatos de cabecera: rango de fechas ISO, identificador del tenant, separador CRLF (`\r\n`).
     - Desglosa métricas clave: Mensajes Entrantes, Mensajes Salientes, Total de Mensajes, Tasa de Entrega Exitosa (%), Conversaciones Activas, Conversaciones Cerradas, Total de Conversaciones, Prompt Tokens, Completion Tokens, Total Tokens IA, Costo Estimado IA (USD).
   - `generateTimeSeriesCsv(timeSeries, options)`:
     - Genera matriz temporal con cabeceras `Fecha/Hora,Mensajes Entrantes,Mensajes Salientes,Volumen Total`.
     - Itera cronológicamente los cubos temporales (`day` u `hour`), preservando el prefijo UTF-8 BOM (`\uFEFF`) y CRLF.

2. **Endpoint REST en API Gateway (`apps/api/src/analytics.ts`)**:
   - `GET /api/v1/analytics/export/csv`:
     - Parámetros query validados: `type` (`overview` o `time-series`), `from` (ISO date), `to` (ISO date), `interval` (`day` o `hour`).
     - Gating de seguridad y autorización:
       - Requiere derecho del inquilino `@RequireEntitlements("module.reports")`.
       - Requiere permiso de usuario `@analyticsAuthorized("reports.export")` (sub-privilegio de exportación independiente de solo lectura `reports.read`).
       - Valida que `from <= to`, retornando HTTP 400 Bad Request si el rango es inválido.
     - Headers HTTP de streaming y descarga:
       - `Content-Type: text/csv; charset=utf-8`
       - `Content-Disposition: attachment; filename="reporte-[type]-[from]-[to].csv"`
     - Respuesta directa con buffer/string en formato RFC 4180.

3. **Consumo y Descarga en UI Web (`apps/web/app/app/reports/`)**:
   - `reports-view-model.ts`:
     - Función `downloadAnalyticsCsv(apiBaseUrl, options)`: ejecuta petición autenticada (`GET`, `credentials: "include"`, `Accept: "text/csv"`), maneja respuestas de error transformándolas a `ReportsApiError` y retorna `Blob`.
   - `reports-client.tsx`:
     - Evaluación de permisos efectivos: `canExportReports = bootstrap.effectivePermissions.includes("reports.export")`.
     - Control visual en la barra de herramientas: Si el usuario cuenta con el permiso `reports.export`, se muestra el menú "Exportar CSV" que despliega opciones para exportar "Resumen Operativo" o "Serie Temporal". Si el usuario carece del permiso, el botón se muestra bloqueado/deshabilitado con icono de candado y tooltip explicativo.
     - Descarga client-side nativa: Genera objeto temporal `URL.createObjectURL(blob)`, emula click sobre tag `<a>` con atributo `download`, y libera la memoria con `URL.revokeObjectURL(url)`.
     - Manejo de estados de carga (`isExporting`) y banners de error contextuales (`reports-export-error`).

## Decision

1. **Implementación de Exportación sin Librerías Externas**:
   - Se implementó un formateador CSV puro en TypeScript (`packages/database`) cumpliendo la especificación RFC 4180 y soporte universal UTF-8 BOM, eliminando la sobrecarga de paquetes pesados como `csv-writer` o `fast-csv`.
2. **Exclusión Deliberada de Generación de PDF en MVP (Diferido a v2)**:
   - Siguiendo la disciplina de alcance del MVP, la generación de PDFs basados en motores de renderizado pesado (Puppeteer/Chromium) se difiere a la fase v2. El formato CSV provee trazabilidad completa, interoperabilidad con Excel/BI y bajo consumo de recursos en el Gateway.
3. **Separación Estricta de Permisos (`reports.read` vs `reports.export`)**:
   - Para salvaguardar la privacidad y exfiltración de datos masivos, la capacidad de exportar se desacopla de la simple visualización en pantalla mediante la clave de permiso RBAC `reports.export`.

## Backlog Scope and Story Reconciliation

- **E12-S03 (Export Engine: CSV Analytics Export & Download UI)** queda completamente implementada y verificada.
- Siguiente hito planificado: **E12-S04 (Operational Alerting & Anomaly Triggers)**.
