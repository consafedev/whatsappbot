# ADR-0030 — E07-S06 Inbox Web UI Frontend, 3-Column Console & Realtime Stream Client

- Status: Accepted
- Date: 2026-08-25
- Owners: Platform Engineering

## Context

El backlog histórico conciso en `platform_docs/DATA_MODEL_ERD_MVP_BACKLOG.md` identificaba la entrada `E07-S06 Human takeover policy [M]`, mientras que los ADR aceptados más recientes (ADR-0028, ADR-0029), el estado operativo `platform_docs/STATUS.md` y el prompt formal de esta historia establecieron la continuación como `E07-S06 — Inbox Web UI Frontend & Console Client`. Conforme a la jerarquía normativa del skill de ingeniería del proyecto (sección 2: ADR aprobado más reciente tiene precedencia), se implementa la consola web del Inbox conectada al backend API REST y al stream de eventos en tiempo real SSE (E07-S01 a E07-S05). El backlog histórico no se reescribe silenciosamente.

## Decision

- Implementar la consola web del Inbox en `apps/web/app/app/inbox/` bajo un patrón de View Model desacoplado (`inbox-view-model.ts`) y componentes modulares de presentación:
  1. `inbox-thread-list.tsx`: Panel lateral izquierdo con filtros de estado (`active`, `open`, `pending`, `closed`, `all`), selector de canal, buscador por texto/teléfono, lista de hilos con badges de no leídos, estados y paginación mediante cursor.
  2. `inbox-chat-view.tsx`: Panel central de conversación con header contextual, selector de estado con modal de motivo de cierre, timeline con scroll reactivo, distinción visual de burbujas entrantes/salientes y actores (Cliente, Humano · App, Humano · WhatsApp, BOT · Rule), preview seguro de multimedia HTTPS (`referrerPolicy="no-referrer"`), indicadores visuales de entrega (`queued`, `sent`, `delivered`, `read`, `failed`) y compositor de texto multilínea con modal para adjuntar enlaces HTTPS.
  3. `inbox-contact-panel.tsx`: Panel lateral derecho de contacto con perfil E.164, tags, metadatos del canal y selector desplegable para asignar Operador (`assignedUserId`) y Unidad Organizacional (`assignedUnitId`).
  4. `inbox-client.tsx`: Componente contenedor que orquesta el estado del View Model, la selección activa, las mutaciones REST y la suscripción en tiempo real vía `EventSource` a `GET /api/v1/inbox/events`.
  5. `page.tsx`: Entrypoint de la ruta `/app/inbox` forzada dinámica dentro de `TenantAppShell`.
- Conectar la navegación del workspace en `apps/web/app/app/tenant-app-navigation.ts` activando `href: "/app/inbox"` para el item `inbox` cuando los módulos efectivos incluyan `module.messaging.basic` y los permisos efectivos incluyan `conversations.read`.
- Manejo de SSE y reconciliación de estado:
  - El stream `GET /api/v1/inbox/events` se consume con credenciales de sesión incluidas (`withCredentials: true`).
  - La función pura `applyRealtimeEvent` actualiza el timeline activo sin duplicados (`messageId`), progresa los ticks de entrega (`inbox.delivery_status_updated`, `inbox.echo_reconciled`), actualiza el estado de la conversación y reordena la lista de hilos elevando las conversaciones activas al tope.
- Seguridad y Aislamiento de Tenancy:
  - El frontend no almacena ni manipula credenciales de canal ni tokens de proveedores.
  - Todas las peticiones HTTP y la conexión SSE utilizan cookies seguras de sesión de tenant resueltas exclusivamente en el servidor NestJS/PostgreSQL.
  - Las URLs multimedia se validan como HTTPS y se renderizan con `referrerPolicy="no-referrer"` y `rel="noopener noreferrer"`.
  - Se previenen vulnerabilidades XSS renderizando texto y captions mediante elementos JSX nativos escapados sin uso de `dangerouslySetInnerHTML`.

## Scope reconciliation and naming

- `E07-S06` en el backlog corto histórico figuraba como `Human takeover policy`. Dicho label no se altera; se implementa la consola frontend de Inbox requerida para completar el vertical slice vendible de Mensajería e Inbox (Epic 07).
- Las políticas de takeover por automatización / IA permanecen diferidas a las épicas de Rules Engine (Epic 08) e IA Gateway (Epic 09/10).

## Alternatives considered

- Utilizar WebSockets bidireccionales con Socket.io en el cliente: rechazado; el backend consolidado en E07-S05 utiliza Server-Sent Events nativos de HTTP/2 y mutaciones por endpoints REST estándar, lo que simplifica la reconexión y reduce la sobrecarga sin requerir dependencias pesadas de cliente.
- Manejo de estado con Redux o Zustand: rechazado; el View Model con funciones puras y un reducer testeable en TypeScript estándar es suficiente, rápido y no añade dependencias externas innecesarias al workspace `apps/web`.

## Migration and verification

No requiere migraciones de base de datos. La verificación incluye:
- Suite unitaria exhaustiva en `apps/web/app/app/inbox/inbox-view-model.test.ts` cubriendo API callers, reducer de eventos SSE, formateadores y deduplicación.
- Suite de navegación en `apps/web/app/app/tenant-app-navigation.test.ts` validando la exposición de la ruta `/app/inbox`.
- Typecheck estricto de TypeScript en `@whatsapp-platform/web` y monorepo.
- Linter de Biome con 0 errores.
- Compilación de producción de Next.js (`pnpm --filter @whatsapp-platform/web build`).
