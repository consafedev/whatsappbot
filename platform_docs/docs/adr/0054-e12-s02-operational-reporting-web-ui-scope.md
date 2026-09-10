# ADR-0054 — E12-S02 Operational Reporting Web UI & Time-Series Visualizer Scope

- Status: Accepted
- Date: 2026-09-10
- Owners: Frontend Engineering & Platform Architecture

## Context

Continuando con la ejecución de **Epic 12 (Reporting, Analytics & Operational Observability)** tras el motor backend E12-S01, la historia E12-S02 implementa la interfaz web de usuario para la consola de reportes y analítica operativa del inquilino en `apps/web/app/app/reports/`.

En cumplimiento de ADR-0002 (PostgreSQL Source of Truth), ADR-0003 (Shared-Schema Multitenancy), ADR-0010 (Modules & Entitlements) y ADR-0053 (Analytics Engine Foundation):

1. **View Model y Clientes REST (`apps/web/app/app/reports/reports-view-model.ts`)**:
   - Modelado tipado estricto: `TenantOperationalOverview`, `AiTokenUsageSummary`, `MessageTimeSeriesBucket`, `MessageTimeSeriesData`, y `DatePresetKey`.
   - Fetchers REST (`fetchOperationalOverview`, `fetchMessageTimeSeries`):
     - Consumen `GET /api/v1/analytics/overview` y `GET /api/v1/analytics/time-series`.
     - Adjuntan credenciales de sesión (`credentials: "include"`) y headers JSON.
     - Mapean el envelope `{ success: true, data: ... }` con normalización defensiva.
     - Manejo exhaustivo de excepciones con `ReportsApiError` para HTTP 400 (parámetros inválidos) y 403 (módulo/permiso no disponible).
   - Funciones utilitarias puras:
     - `resolveDatePreset(preset, referenceDate?)`: Cálculo determinista de rangos de fecha para 7 días, 30 días, mes en curso o rango personalizado.
     - `formatNumber(value)`: Formateo numérico con separador de miles bajo locale `es-MX`.
     - `formatCurrencyUsd(amount)`: Formateo en dólares con 4 posiciones decimales para alta granularidad en consumo de tokens IA.

2. **Componentes del Tablero Operativo (`apps/web/app/app/reports/`)**:
   - `page.tsx`: Server component con `export const dynamic = "force-dynamic"` que monta `ReportsClient`.
   - `reports-client.tsx`: Componente orquestador conectado a `useTenantAppBootstrap()`:
     - Gating de seguridad y permisos: Si falta `module.reports` o `reports.read`, muestra un panel de acceso restringido / módulo no contratado impidiendo cualquier llamada a la API.
     - Validación client-side: Comprueba que `from <= to` antes de emitir peticiones, previniendo errores HTTP 400 y mostrando feedback visual contextual.
     - Selector interactivo de presets de fecha (`7d`, `30d`, `this_month`, `custom`), inputs de fecha individuales y botón de recarga en vivo con spinner.
   - `reports-kpi-cards.tsx`:
     - 4 tarjetas métricas consolidadas: Volumen de Mensajes (conteo y desglose inbound/outbound), Efectividad de Entrega (porcentaje y barra de progreso dinámica), Estado de Conversaciones (activas vs cerradas con tasa de resolución) y Consumo de IA (costo en USD y desglose de tokens).
     - Estados de carga animados (pulse skeletons).
   - `reports-time-series-chart.tsx`:
     - Visualizador interactivo de series temporales de tráfico construido íntegramente con SVG nativo y barras Tailwind CSS compuestas, eliminando la necesidad de dependencias pesadas externas.
     - Conmutador de intervalo temporal dinámico entre **Por Día** (`day`) y **Por Hora** (`hour`).
     - Barras agrupadas por período: Mensajes Entrantes (color esmeralda) vs. Mensajes Salientes (color azul/índigo).
     - Cuadro de detalle interactivo activado por hover o foco accesible con desglose por fecha, entrantes, salientes y volumen total.
     - Estado vacío descriptivo en ausencia de datos en el rango seleccionado.

3. **Navegación en Tenant App Shell (`apps/web/app/app/tenant-app-navigation.ts`)**:
   - Activación de la ruta `href: "/app/reports"` para el ítem `reports`.
   - Condicionado estrictamente a la presencia concurrente de `module.reports` y `reports.read`.
   - Inclusión de `"module.reports": "Reportes"` en `TENANT_MODULE_LABELS`.

## Decision

1. **Gráficos Ligeros Nativos (Cero Dependencias Externas)**:
   - Para mantener el bundle optimizado y garantizar compatibilidad universal con SSR en Next.js, se optó por un visualizador de barras y cuadrículas de referencia en SVG/CSS nativo con Tailwind, evitando librerías pesadas como Chart.js o Recharts.
2. **Validación Preventiva en Cliente**:
   - Para evitar peticiones fallidas al servidor, la interfaz valida `from <= to` localmente y bloquea la emisión de llamadas API si el rango es inválido, informando al usuario mediante un banner contextual con opción de restablecer el filtro.
3. **Desacoplamiento Estricto de la Exportación (E12-S03 Scope)**:
   - La exportación a CSV/PDF y la programación de reportes periódicos quedan estrictamente reservadas para la historia E12-S03.

## Backlog Scope and Story Reconciliation

- **E12-S02 (Operational Reporting Web UI & Time-Series Visualizer)** queda completamente implementada y verificada.
- Siguiente hito planificado: **E12-S03 (Export Engine: CSV/PDF Generation & Scheduled Reports Dispatcher)**.
