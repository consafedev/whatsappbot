# ADR-0040 — E09-S03 WhatsApp Channel Web UI Management & Live QR Pairing Modal Scope

- Status: Accepted
- Date: 2026-08-27
- Owners: Platform Engineering

## Context

La historia E09-S03 completa la interfaz de usuario web para la gestión integral de canales de WhatsApp (Epic 09 — Channel Management) conforme a ADR-0002 (PostgreSQL Source of Truth), ADR-0004 (Messaging Provider Abstraction), ADR-0038 (QR Pairing Lifecycle), ADR-0039 (Channel Health & Reconnection) y las referencias visuales de diseño canónicas (design-prototype/channels.html y design-prototype/add-whatsapp-qr.html).

Para dotar a los administradores y operadores de una experiencia fluida y reactiva en la administración de líneas WhatsApp, la plataforma requería:
1. **View Model Desacoplado de Canales (pps/web/app/app/channels/channels-view-model.ts)**:
   - Tipos e interfaces fuertemente tipadas: ChannelItem, ChannelHealthDiagnostic, QrPairingState, ChannelPairingInitiateResponse, ChannelDisconnectResponse, CreateChannelPayload, StatusBadgeDetails, QrTtlRemaining.
   - Clientes REST desacoplados con manejo estricto de errores (ChannelApiError): etchChannels, createChannel, initiateChannelPairing, etchChannelQr, disconnectChannel, etchChannelHealth.
   - Funciones puras y testeables: ormatChannelStatus, calculateQrTtlRemaining (cálculo de 30s TTL, temporizador regresivo mm:ss y bandera isExpired), ormatLatency, ormatSocketStatus y ormatRelativeTime.
2. **Componentes Visuales de Gestión de Canales (pps/web/app/app/channels/)**:
   - channel-qr-modal.tsx: Modal interactivo de vinculación con guía paso a paso, renderizado SVG nativo de código QR con esquinas y patrones de alineación procedurales, barra de expiración TTL de 30 segundos, sondeo periódico inteligente cada 2 segundos con cancelación inmediata al cerrar o detectar conexión exitosa, estado de expiración con botón de regeneración instantánea y pantalla de éxito.
   - channel-health-modal.tsx: Modal accesible de diagnóstico de salud en vivo con cuadrícula de 4 estadísticas de telemetría (latencia en ms, estado del socket, intentos de reconexión, último latido relativo y exacto), metadatos del canal y botón de refresco en tiempo real.
   - channel-create-modal.tsx: Modal de registro de nueva línea con validación de nombre, unidad organizativa y proveedor (Baileys), abriendo automáticamente el modal QR tras creación.
   - channels-list.tsx: Catálogo en cuadrícula responsiva con tarjetas de canal interactivas, badges de estado con indicadores de color, fila de metadatos de telemetría, accesos directos a Vincular / Escanear QR, Diagnóstico de Salud y diálogo accesible de confirmación de desconexión segura. Incluye skeletons y empty states.
   - channels-client.tsx: Orquestador principal que valida permisos (channels.read, channels.manage) y derecho de módulo (module.messaging.basic), gestiona estados globales, notificaciones toast y control de modales.
   - page.tsx: Ruta canónica Next.js /app/channels.
3. **Navegación de Workspace (pps/web/app/app/tenant-app-navigation.ts)**:
   - Actualización del enlace canónico channels hacia href: /app/channels, con control de acceso por module.messaging.basic y channels.read.
4. **Seguridad e Invariantes Multi-inquilino**:
   - Cero persistencia de tokens de sesión o secretos en LocalStorage o estado del cliente web.
   - Detención inmediata de tareas de polling al desmontar o cerrar modales.
   - Manejo transparente de respuestas HTTP 404 (aislamiento cruzado) y 409 (conflicto de conexión activa).

## Decision

1. **Desacoplamiento de Vista y Lógica de API**:
   - Toda la comunicación de red y transformación de datos de presentación reside en channels-view-model.ts, aislando los componentes React de la lógica de red y facilitando pruebas unitarias exhaustivas con 100% de cobertura.
2. **Sondeo de QR Resiliente y Cancelable**:
   - El sondeo de estado de QR en ChannelQrModal utiliza temporizadores de ciclo corto (2s) vinculados a referencias useRef y estados de montaje, previniendo fugas de memoria o peticiones huérfanas al navegar fuera de la vista.
3. **Diseño Visual Fiel y Accesible**:
   - Se respetan íntegramente las pautas de estilo y componentes definidos en el prototipo canónico (design-prototype/channels.html), con soporte accesible WAI-ARIA (diálogos modales, trampas de foco, etiquetas semánticas y alertas).

## Backlog Scope and Story Reconciliation

- E09-S03 (**WhatsApp Channel Web UI Management & Live QR Pairing Modal**) queda implementada y verificada.
- Las historias siguientes de Epic 09 abordarán:
  - E09-S04: Multi-device Channel Account Scalability and Auto-recovery.
