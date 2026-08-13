# DESIGN.md — Sistema visual y de interacción

**Versión:** 1.0-draft para Open Design  
**Fecha:** 2026-08-12  
**Fuente funcional:** `UI_FLOWS.md`  
**Propósito:** definir una identidad visual profesional, moderna, confiable y adaptable por tenant sin convertir cada cliente en un diseño distinto. Debe ser utilizable como referencia directa para Open Design y la implementación frontend.

---

# 0. Principio visual

La plataforma debe parecer **software empresarial moderno**, no un “chatbot genérico”, una interfaz futurista de IA ni una plantilla SaaS llamativa.

Sensaciones deseadas:

- confianza;
- control;
- claridad;
- trazabilidad;
- eficiencia;
- calidad B2B;
- neutralidad suficiente para múltiples industrias.

La IA, cuando exista, se presenta como capacidad asistiva y no domina la identidad visual.

---

# 1. Objetivos del sistema de diseño

1. Una misma UI base para todos los tenants.
2. Personalización mediante tokens/branding, no forks.
3. Consistencia entre Super Admin, tenant dashboard y portal.
4. Capacidad para 10 temas profesionales iniciales.
5. Accesibilidad y contraste controlados.
6. Interfaces densas cuando el contexto lo requiere, sin ruido visual.
7. Componentes reutilizables.
8. Estados operativos visibles: connected/degraded/pending/failed/human/auto.
9. Funcionar bien en desktop y ser usable en tablet/móvil.
10. Generar confianza suficiente para vender a empresas pequeñas y medianas.

---

# 2. Personalidad visual

Palabras guía:

```text
Professional
Calm
Precise
Operational
Modern
Trustworthy
Clean
Structured
```

Evitar:

- exceso de gradients;
- glassmorphism dominante;
- neón;
- hologramas;
- robots/mascotas IA;
- fondos excesivamente oscuros por defecto;
- animaciones decorativas constantes;
- iconografía infantil;
- dashboards llenos de tarjetas sin propósito;
- colores saturados en todas partes.

---

# 3. Base theme

Tema por defecto recomendado: **Professional Neutral / Corporate Blue**.

La implementación final debe usar tokens, no valores repetidos hardcoded.

Tokens conceptuales:

```text
--bg-canvas
--bg-surface
--bg-subtle
--bg-elevated
--text-primary
--text-secondary
--text-muted
--border-default
--border-strong
--brand-primary
--brand-primary-hover
--brand-on-primary
--success
--warning
--danger
--info
--focus-ring
```

Los valores concretos podrán ajustarse al prototipo, pero deben conservar contraste AA donde corresponda.

---

# 4. Color philosophy

## Neutrals

La mayoría de la interfaz usa neutrales para que los datos destaquen.

## Brand color

Se utiliza para:

- primary CTA;
- selected nav;
- focus/active accents;
- links;
- charts selectivamente.

No pintar paneles completos con el color del tenant de forma indiscriminada.

## Semantic colors

- Success: conectado, completado, saludable.
- Warning: atención, próximo a vencer, degraded.
- Danger: fallo, vencido, destructive.
- Info: automatización/estado informativo.

No usar semantic colors como decoration.

---

# 5. Typography

Objetivo: legibilidad en dashboards densos.

Preferir una sans-serif moderna y altamente legible disponible legalmente en web/app. La implementación debe definir font stack resiliente.

Escala conceptual:

```text
Display / 32–36
H1 / 28–32
H2 / 22–24
H3 / 18–20
Body / 14–16
Small / 12–13
Micro / 11–12 sólo metadata
```

Pesos:

- regular para body;
- medium para controls/labels;
- semibold para headings;
- bold con moderación.

No usar uppercase prolongado.

---

# 6. Spacing

Sistema basado en múltiplos consistentes, por ejemplo 4px/8px.

Densidades:

- comfortable default;
- compact para tables/inbox si el usuario lo prefiere futuro.

No reducir espacios hasta comprometer targets táctiles.

---

# 7. Radius y elevación

Radius moderado, no excesivamente “app consumer”.

Conceptual:

```text
sm 6
md 8
lg 12
```

Sombras sutiles sólo para:

- popovers;
- dialogs;
- floating panels.

Surfaces principales se separan más con border/background que con sombras fuertes.

---

# 8. Layout

## Dashboard desktop

- sidebar fija/collapsible;
- topbar discreta;
- content max-width flexible;
- páginas de datos aprovechan anchura;
- detail panes en inbox.

## Mobile

- navegación drawer/bottom actions sólo donde aporte;
- tables se convierten en cards/scroll controlado;
- primary actions accesibles.

---

# 9. Sidebar

Características:

- logo pequeño;
- tenant name;
- nav grouped cuando crezca;
- active state claro;
- icons simples;
- module-gated;
- bottom area para Settings/user/help.

No mostrar entradas deshabilitadas sólo para “vender” constantemente. Los upgrades pueden aparecer en settings/plan de forma controlada.

---

# 10. Topbar

Elementos posibles:

- breadcrumb/title;
- Organization Unit selector cuando aplica;
- global search futuro;
- notifications;
- user menu;
- service degradation indicator si crítico.

Evitar topbar llena de botones globales.

---

# 11. Cards

Cards deben tener un propósito:

- metric;
- status;
- actionable summary;
- grouped configuration.

No envolver cada bloque de texto en una tarjeta.

Metric card:

```text
Label
Primary value
Delta/context optional
```

---

# 12. Tables

Uso principal en:

- tenants;
- contacts;
- processes;
- quotes;
- users;
- rules;
- channels.

Requirements:

- sticky header cuando tabla larga;
- sort indicators claros;
- filters separados;
- row actions en menu;
- row click consistente;
- bulk actions sólo cuando realmente existan;
- pagination/infinite model definido por implementación.

---

# 13. Status badges

Badges pequeños con label textual.

Ejemplos:

```text
Connected
Degraded
Requires reauth
AUTO
HUMAN
Pending approval
Overdue
```

Nunca depender sólo de un punto de color.

---

# 14. Buttons

Variants:

- Primary;
- Secondary;
- Ghost;
- Danger;
- Link.

Reglas:

- una primary action dominante por zona;
- destructive nunca usa primary brand indistinguible;
- loading mantiene tamaño;
- disabled explica razón cuando no es obvia.

---

# 15. Forms

- label siempre visible;
- helper text sólo cuando aporta;
- validation inline;
- required explicit;
- groups con headings;
- advanced config colapsable;
- no placeholders como sustituto de labels.

For configuration builders, usar preview/readable summary.

---

# 16. Dialogs / Drawers

Dialog para:

- confirmaciones;
- forms cortos;
- destructive actions.

Drawer para:

- context detail;
- contact 360 resumido en Inbox;
- filters en móvil.

Pages completas para builders/editores complejos.

---

# 17. Inbox visual system

Debe ser una de las interfaces más pulidas del producto.

## Conversation list

- avatar inicial/simple;
- nombre;
- preview;
- time;
- unread;
- mode badge;
- channel indicator;
- assignment.

## Message bubbles

No replicar WhatsApp exactamente. Usar lenguaje visual propio.

Distinciones:

- customer inbound: surface neutral;
- human app outbound: brand-tinted subtle;
- human external: similar outbound + explicit label;
- bot rule: subtle automation label/icon;
- AI: subtle “AI” label, no gradient mágico;
- internal note: yellow/neutral note block, jamás confundible con mensaje enviado.

Metadata incluye actor y status cuando relevante.

---

# 18. Automation Mode control

Segmented control o compact menu con estado muy visible:

```text
AUTO
ASSISTED
HUMAN
MONITOR
```

AUTO no debe representarse como “verde = todo bien” únicamente; incluir texto.

Al cambiar, mostrar breve descripción/confirmation si impacta automatización activa.

---

# 19. QR Connection experience

Pantalla limpia y enfocada.

Layout:

```text
Step indicator
Title
Short instruction
QR card
Connection state
Troubleshooting/retry
Cancel
```

Estados visuales:

- generating;
- waiting;
- scanned;
- connecting;
- connected;
- expired;
- error.

No mostrar detalles técnicos crudos salvo sección diagnostic avanzada.

---

# 20. Process Board

Kanban sobrio.

Cada card:

- reference;
- contact/customer;
- status if needed;
- responsible;
- action required badge;
- last update.

No colorear cada columna de forma intensa.

---

# 21. Timeline

Vertical timeline con:

- timestamp;
- icon/type;
- title;
- description;
- actor;
- visibility badge internal/customer;
- document/action links.

Public vs internal debe ser inequívoco para el empleado.

---

# 22. Action Requests

Pendientes deben tener jerarquía visual alta.

Cards:

```text
Type icon
Required action
Recipient
Due date
Status
Primary CTA
```

Overdue usa danger semántico, sin parpadeos ni alarmismo.

---

# 23. Calendar

Diseño de agenda profesional:

- resource colors limitados/consistent;
- current time indicator;
- booked slots;
- availability subtle;
- appointment status icons/text.

No depender del color para status.

---

# 24. Quote editor

Debe sentirse como herramienta comercial seria.

Layout desktop:

```text
Main quote items/table
Right summary/policy panel
```

Mobile/tablet adapta panel debajo.

Policy warnings visibles pero no bloquean edición innecesariamente.

Document Preview en panel/modal/page.

---

# 25. Document themes — 10 presets iniciales

Todos deben usar el mismo schema de contenido y diferir principalmente en composición/token styling.

1. **Corporate Blue** — B2B general, azul sobrio.
2. **Professional Neutral** — gris/azul muy neutro.
3. **Medical Clean** — blanco, azul/teal moderado, alto aire.
4. **Legal Executive** — navy, charcoal, tipografía seria.
5. **Industrial Precision** — graphite, steel blue, tablas compactas.
6. **Education Modern** — azul medio/neutral, accesible y claro.
7. **Premium Minimal** — mucho espacio blanco, acento oscuro.
8. **Modern Dark Accent** — documento claro con encabezado oscuro, no PDF totalmente oscuro.
9. **Retail Professional** — algo más cálido pero corporativo.
10. **Service Modern** — adaptable a talleres/servicios, estructura muy legible.

No usar imagery decorativa dependiente del nicho. Logo y datos del tenant personalizan.

---

# 26. Tenant UI themes — presets iniciales

Mismos nombres conceptuales pueden reutilizarse, pero dashboard themes deben mantener contraste y componentes comunes.

El tema cambia tokens:

- brand primary;
- secondary accent;
- sidebar style;
- subtle backgrounds;
- optional radius density within safe range.

No cambia layout funcional.

---

# 27. White label

Cuando entitlement habilitado:

- logo;
- app/display name;
- favicon future;
- portal branding;
- custom domain future;
- brand color dentro de límites.

“Powered by” depende de plan comercial futuro; no bloquear arquitectura.

---

# 28. Super Admin visual differentiation

El Super Admin debe ser claramente plataforma/control interno.

Puede usar:

- neutral/darker sidebar;
- “Platform Control” label;
- tenant status emphasis.

No debe adoptar branding de un tenant al inspeccionarlo.

---

# 29. Customer Portal

Más simple que dashboard.

Principios:

- mobile-first;
- branded;
- muy poca navegación;
- status prominent;
- action required prominent;
- timeline readable;
- document download clear;
- no jargon interno.

---

# 30. Iconography

Usar una sola familia consistente de iconos lineales/modernos.

No mezclar múltiples packs.

Icons acompañan labels; no reemplazan texto en acciones no obvias.

---

# 31. Charts

Charts sólo donde aporten decisión.

MVP puede usar:

- line/bar simple;
- donut con moderación;
- no 3D;
- no gauges decorativos.

Dashboards operativos priorizan counts/lists antes que visualizaciones complejas.

---

# 32. Data density

Enterprise UX permite densidad razonable.

Lists/tables deben mostrar suficiente para actuar sin abrir cada row.

Evitar cards gigantes con poco contenido.

---

# 33. Responsive breakpoints

No imponer números exactos hasta implementación, pero garantizar:

- desktop >= experiencia completa;
- tablet = sidebar collapsible, split panels adaptados;
- mobile = single pane navigation, composer usable, portal excelente.

Inbox móvil puede alternar list/detail en vez de mostrar ambos.

---

# 34. Accessibility

Mínimo:

- WCAG AA contrast target;
- keyboard navigation;
- visible focus;
- screen-reader labels;
- semantic headings;
- form error association;
- not color-only states;
- reduced motion support;
- modal focus management.

---

# 35. Motion

Subtle, functional:

- menu/dialog transitions;
- QR state transition;
- toast enter/exit;
- list loading.

Evitar motion en background o dashboards que distraiga.

---

# 36. Toasts y alerts

Toast para confirmación efímera.

Banner/inline alert para:

- channel disconnected;
- backup issue;
- tenant limit;
- form blocking error;
- degraded service.

Error crítico persistente no puede depender de toast que desaparece.

---

# 37. Copy tone

UI en español inicialmente, preparada para i18n.

Tono:

- claro;
- profesional;
- directo;
- sin marketing dentro de operación;
- sin mensajes antropomórficos de IA.

Ejemplo bueno:

> WhatsApp requiere volver a vincularse. Los mensajes nuevos no se recibirán hasta completar la conexión.

Evitar:

> ¡Ups! Parece que nuestro pequeño robot perdió la conexión 🤖

---

# 38. Loading/empty/error visual grammar

## Loading

Skeletons/spinners sólo donde correspondan.

## Empty

Icon simple + title + explanation + CTA si autorizado.

## Error

Semantic alert + action/retry + reference si soporte.

## Permission

No mostrar error técnico 403. Explicar que no tiene permiso.

---

# 39. Module unavailable

Si URL directa intenta módulo sin entitlement:

Surface neutral:

```text
Esta función no está habilitada para tu organización.
Contacta al administrador de tu cuenta para revisar los módulos disponibles.
```

No convertir cada bloqueo en upsell agresivo.

---

# 40. Design tokens ownership

`packages/ui` debe exponer tokens/componentes base.

Tenant branding se aplica mediante CSS variables/theme provider.

No duplicar componente por theme.

No crear:

```text
ButtonMedical
ButtonLegal
ButtonIndustrial
```

Crear `Button` + theme tokens.

---

# 41. Components iniciales prioritarios

- AppShell
- Sidebar
- Topbar
- PageHeader
- Button
- Input/Textarea/Select
- Checkbox/Switch
- SegmentedControl
- Badge
- Alert
- Card
- MetricCard
- Table/DataTable
- Tabs
- Dialog
- Drawer
- DropdownMenu
- Tooltip
- Avatar
- EmptyState
- Skeleton
- Toast
- FileUpload
- Timeline
- MessageBubble
- ConversationListItem
- ChannelStatus
- QRPanel
- FilterBar
- Pagination
- FormField

---

# 42. Open Design — primera generación solicitada

Generar primero un conjunto consistente, no pantallas aisladas:

## Platform

- Super Admin Dashboard
- Tenant List
- Create Tenant Wizard
- Tenant Detail / Entitlements

## Tenant MVP

- Login
- Home
- Channels List
- Add WhatsApp / QR
- Inbox
- Conversation Detail
- Contacts List
- Contact Detail
- Rules List
- Rule Builder
- Users/Organization basic

## States

Para al menos Inbox y Channels generar:

- normal;
- empty;
- loading;
- disconnected/degraded;
- permission/limit state.

---

# 43. Open Design — segunda generación

Después de validar primera:

- Process Definitions
- Process Board/List
- Process Detail + Timeline
- Action Requests
- Agenda
- Quote List/Editor
- Document Template/Preview
- Portal Process Status
- Portal Action Request

---

# 44. Qué Open Design NO debe decidir

- endpoints;
- schema DB;
- roles reales;
- qué módulos existen;
- lógica de aprobación;
- provider architecture;
- precios del SaaS;
- data visibility;
- reglas de tenant isolation;
- estados de negocio no definidos.

Si una pantalla requiere algo no descrito, debe marcarse como pregunta/placeholder, no inventarse como feature.

---

# 45. Acceptance visual

Una pantalla se acepta si:

- cumple UI_FLOWS;
- usa componentes/tokens comunes;
- no inventa feature;
- soporta estados principales;
- es legible con datos reales/densos;
- funciona en responsive target;
- tiene contraste/accesibilidad razonable;
- branding cambia sin romper layout;
- parece producto B2B serio y vendible.

---

# 46. Objetivo comercial del diseño

La UI del Milestone A debe permitir que en una demo un prospecto entienda en menos de minutos:

1. su empresa puede tener su propia cuenta/usuarios;
2. puede conectar su propio WhatsApp;
3. las conversaciones quedan centralizadas;
4. automatización y humano conviven;
5. se sabe quién/origen respondió;
6. el sistema puede crecer por módulos.

No es necesario mostrar todos los módulos para vender el primer MVP.


