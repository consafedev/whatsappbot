# PRD Maestro — Plataforma Multitenant de Automatización Empresarial, Atención y Operaciones

**Versión:** 1.0-draft-cimentado  
**Fecha de corte de decisiones:** 2026-08-11  
**Estado:** Arquitectura conceptual y alcance funcional definidos; listo para convertirse en backlog técnico e iniciar implementación del MVP.  
**Propósito de este documento:** ser la fuente maestra de verdad del producto. Debe permitir que otra IA, un desarrollador nuevo, un proveedor distinto o el mismo equipo meses después pueda continuar el producto sin depender de memoria conversacional, decisiones implícitas ni contexto perdido.

---

## 0. Regla principal de continuidad

Este documento debe tratarse como el contrato conceptual del producto.

Si una futura decisión contradice este PRD, debe registrarse explícitamente en una sección de **Decisiones y cambios** indicando:

1. qué se modifica;
2. por qué;
3. impacto en arquitectura;
4. impacto en datos;
5. impacto en compatibilidad;
6. impacto en clientes existentes;
7. plan de migración;
8. versión de producto en la que entra el cambio.

No deben introducirse cambios silenciosos en arquitectura, dominios, naming, límites o comportamiento.

---

# 1. Resumen ejecutivo

El producto será una **plataforma SaaS multitenant de automatización empresarial, atención, operaciones y autoservicio**, con WhatsApp como primer canal prioritario, pero sin depender conceptualmente de WhatsApp.

La plataforma permitirá que una empresa configure uno o varios canales de WhatsApp, atienda conversaciones, automatice procesos, gestione citas, reservaciones, clientes, contactos, expedientes, pedidos, trámites, cotizaciones, documentos, estados, recordatorios, aprobaciones, acciones requeridas, catálogos y otros flujos operativos.

El objetivo no es construir un chatbot aislado ni un bot universal rígido. El objetivo es construir un **núcleo empresarial configurable y extensible** que pueda utilizarse en múltiples industrias mediante:

- módulos activables;
- plantillas por industria;
- campos personalizados;
- procesos configurables;
- estados configurables;
- reglas y automatizaciones;
- roles y permisos;
- branding;
- documentos personalizables;
- canales múltiples;
- integraciones;
- capacidades opcionales de IA.

La misma base de código deberá poder desplegarse de tres formas:

1. **SaaS multitenant en nuestra infraestructura**.
2. **Instancia dedicada administrada por nosotros**.
3. **Instancia en infraestructura del cliente**.

En los tres casos debe mantenerse:

- un solo repositorio;
- un solo producto;
- un esquema de versionado;
- migraciones controladas;
- imágenes Docker comunes;
- módulos configurables;
- extensiones mediante contratos estables;
- cero forks permanentes por cliente.

---

# 2. Visión de producto

## 2.1 Visión

Convertir WhatsApp y otros canales de comunicación en una interfaz natural hacia los procesos reales de una empresa.

El usuario final debe poder escribir o usar un portal para:

- agendar;
- cancelar;
- reprogramar;
- consultar servicios;
- consultar productos;
- consultar disponibilidad;
- solicitar cotización;
- autorizar una cotización;
- consultar pedido;
- consultar envío;
- consultar expediente;
- aportar documentación;
- conocer movimientos;
- recibir recordatorios;
- realizar acciones pendientes;
- dar seguimiento a trámites;
- ser transferido a una persona;
- obtener respuestas operativas.

El empleado debe poder realizar la misma operación desde un dashboard estructurado.

La información importante debe vivir **fuera de WhatsApp**, en nuestra plataforma y base de datos. WhatsApp será un canal, no la fuente de verdad.

## 2.2 Propuesta de valor central

La plataforma debe ayudar a una empresa a:

- responder más rápido;
- evitar preguntas repetitivas;
- reducir trabajo manual;
- reducir recaptura de datos;
- centralizar conversaciones y contexto;
- ofrecer autoservicio;
- mejorar trazabilidad;
- automatizar seguimientos;
- mantener control humano;
- reducir omisiones;
- estandarizar procesos;
- medir resultados;
- integrar departamentos;
- mantener a clientes informados sin depender de que una persona responda manualmente.

## 2.3 Principio comercial

No vender “IA” ni “un bot” como producto principal.

Vender:

- automatización de procesos;
- atención;
- autoservicio;
- trazabilidad;
- eficiencia;
- seguimiento;
- control;
- reducción de carga operativa;
- mejora de experiencia del cliente.

La IA será un componente opcional y auxiliar.

---

# 3. Objetivos

## 3.1 Objetivos del producto

1. Programar el núcleo una vez y reutilizarlo en muchos clientes.
2. Evitar mantener variantes de código por cliente.
3. Permitir personalización profunda sin forks.
4. Permitir múltiples industrias.
5. Permitir múltiples números/cuentas de WhatsApp por cliente.
6. Permitir múltiples sucursales y departamentos.
7. Permitir automatización determinista sin IA.
8. Permitir IA opcional multi-proveedor.
9. Permitir intervención humana sincronizada.
10. Permitir cotizaciones asistidas o autónomas.
11. Permitir portales de seguimiento.
12. Permitir flujos internos e interdepartamentales.
13. Permitir acciones requeridas a clientes o empleados.
14. Poder desplegarse en infraestructura propia o del cliente.
15. Mantener actualizaciones centralizadas.
16. Permitir monetización por módulos, conexiones, usuarios, sucursales y capacidades.

## 3.2 Objetivos operativos

- Onboarding de un nuevo tenant sin desarrollo.
- Alta de una nueva cuenta WhatsApp desde el dashboard del cliente.
- Activación o desactivación de módulos desde Super Admin.
- Creación de plantilla de industria reutilizable.
- Configuración de procesos/estados sin código.
- Auditoría completa de cambios relevantes.
- Backups automáticos cifrados.
- Recuperación de servicio sin depender de memoria volátil.
- Observabilidad suficiente para operar clientes de pago.

---

# 4. No objetivos

El producto NO debe convertirse inicialmente en:

- ERP completo;
- contabilidad completa;
- sistema hospitalario integral;
- expediente clínico electrónico completo;
- CRM empresarial equivalente a Salesforce;
- TMS completo;
- LMS completo;
- software jurídico vertical completo;
- plataforma de campañas masivas no solicitadas;
- sustituto total de sistemas existentes del cliente;
- builder visual estilo n8n desde el primer MVP;
- plataforma que dependa de un LLM para funcionar.

Debe integrarse con sistemas existentes cuando corresponda.

---

# 5. Principios arquitectónicos no negociables

## 5.1 Un repositorio

Debe existir un único repositorio fuente para el producto.

Prohibido como estrategia permanente:

- `cliente-a-branch`;
- `cliente-b-version`;
- copias manuales del repositorio;
- repositorios independientes derivados para cada cliente;
- lógica dispersa basada en nombres de clientes.

## 5.2 Prohibición de código condicional por tenant

No introducir:

```ts
if (tenant.slug === "cliente-x") {
  // comportamiento especial
}
```

Si una necesidad de un cliente puede generalizarse, se convierte en:

- módulo;
- feature flag;
- configuración;
- regla;
- plantilla;
- plugin;
- integración;
- custom field;
- política.

## 5.3 Fuente de verdad

**PostgreSQL es la fuente de verdad transaccional.**

Redis y BullMQ podrán:

- cachear;
- coordinar;
- encolar;
- programar;
- ejecutar.

Pero no deben ser la única ubicación del estado crítico.

## 5.4 IA opcional

El sistema debe seguir funcionando si:

- todos los proveedores IA fallan;
- el tenant deshabilita IA;
- no existe saldo;
- no existe API key;
- una política de privacidad prohíbe enviar información.

## 5.5 Canal abstraído

WhatsApp es el primer canal, pero las entidades centrales deben llamarse de forma genérica:

- `Channel`;
- `ChannelAccount`;
- `Conversation`;
- `Message`.

No `WhatsAppConversation` como entidad central.

## 5.6 Configuración por encima de personalización de código

Las diferencias entre clientes deben vivir en datos/configuración.

---

# 6. Modelo de despliegue

## 6.1 SaaS multitenant compartido

Nuestra infraestructura ejecuta la plataforma y múltiples tenants.

Ventajas:

- menor costo;
- actualización centralizada;
- operación sencilla;
- mejor margen;
- onboarding rápido.

## 6.2 Instancia dedicada

Mismas imágenes y repositorio, pero runtime/DB/Redis/storage dedicado al cliente.

Se puede ofrecer por:

- aislamiento;
- capacidad;
- SLA;
- requisitos de TI;
- seguridad;
- volumen.

## 6.3 Infraestructura del cliente

El producto puede desplegarse mediante Docker en:

- VPS;
- servidor físico;
- nube;
- red privada;
- infraestructura corporativa.

Debe mantenerse compatible con el mismo sistema de versiones.

## 6.4 Regla de distribución

Las tres modalidades usan:

- mismas imágenes;
- mismo esquema de migraciones;
- mismo mecanismo de configuración;
- mismo versionado;
- mismos contratos de módulos.

No mantener “una edición distinta” por cliente.

## 6.5 Control Plane y Data Plane

### Control Plane

Administración comercial/técnica central:

- tenant;
- licencia;
- módulos;
- límites;
- plan;
- versión;
- deployment;
- salud;
- consumo;
- canales;
- soporte;
- estado de backup;
- release channel.

### Data Plane

Donde viven y se ejecutan:

- PostgreSQL;
- Redis;
- workers;
- conversaciones;
- procesos;
- archivos;
- integraciones;
- jobs.

Una instalación on-premise podría operar incluso con conectividad limitada al Control Plane si el contrato lo requiere.

---

# 7. Multi-tenancy

## 7.1 Tenant

Representa la organización cliente contratante.

Campos conceptuales mínimos:

- `id`;
- `slug`;
- `legal_name`;
- `display_name`;
- `status`;
- `plan_id`;
- `timezone`;
- `locale`;
- `currency`;
- `country`;
- `branding_config`;
- `security_config`;
- `ai_policy`;
- `created_at`;
- `updated_at`.

## 7.2 Aislamiento

Toda tabla tenant-owned debe tener `tenant_id` o relación inequívoca hacia una entidad tenant-owned.

Nunca debe ser posible que:

- una consulta omita el tenant scope;
- un usuario vea datos de otro tenant;
- un job procese datos de otro tenant;
- una URL use IDs inseguros sin validar pertenencia.

## 7.3 Estrategia inicial de DB

MVP SaaS:

- una base PostgreSQL;
- esquema compartido;
- discriminación por `tenant_id`;
- controles estrictos a nivel aplicación;
- posibilidad futura de Row Level Security.

Dedicated:

- puede usar DB propia.

## 7.4 Feature flags y módulos

El Super Admin debe controlar por tenant:

- módulos activos;
- límites;
- capacidades;
- beta flags;
- integraciones;
- número máximo de canales;
- usuarios;
- unidades organizativas;
- almacenamiento;
- capacidades IA;
- portal;
- white label;
- API;
- webhooks.

Un tenant nunca podrá activar por sí mismo una capacidad comercial no contratada, salvo que el negocio decida habilitar autoservicio de upgrades.

---

# 8. Planes, módulos y entitlements

## 8.1 Objetivo

Permitir clientes desde un uso muy básico hasta automatización empresarial avanzada.

## 8.2 Ejemplos de combinaciones

### Cliente básico

- 1 WhatsApp;
- información básica;
- respuestas automáticas;
- inbox;
- contactos;
- takeover humano.

### Cliente comercial

- lo anterior;
- cotizaciones;
- catálogo;
- seguimiento.

### Cliente con agenda

- WhatsApp;
- citas;
- reservaciones;
- recordatorios;
- personal;
- horarios.

### Cliente avanzado

- procesos;
- reglas;
- cotizaciones;
- agenda;
- Action Requests;
- documentos;
- portal;
- interdepartamental;
- integraciones;
- IA opcional.

## 8.3 Entitlements

Entidades propuestas:

- `Plan`;
- `Module`;
- `Feature`;
- `TenantEntitlement`;
- `UsageLimit`;
- `UsageCounter`.

Ejemplos de límites:

- WhatsApp accounts;
- usuarios;
- departamentos/sucursales;
- storage;
- automatizaciones activas;
- ejecuciones;
- API requests;
- webhooks;
- plantillas;
- IA;
- dominios personalizados.

---

# 9. Organization Units: sucursales y departamentos

## 9.1 Concepto

No crear estructuras rígidas separadas para sucursal/departamento.

Crear `OrganizationUnit` jerárquica.

Ejemplo:

```text
Empresa
├── León
│   ├── Ventas
│   ├── Atención a clientes
│   └── Cobranza
├── Silao
│   ├── Ventas
│   └── Almacén
└── Querétaro
    ├── Ventas
    └── Servicio
```

## 9.2 Usos

Una `OrganizationUnit` podrá asociarse con:

- usuarios;
- roles;
- channel accounts;
- agendas;
- servicios;
- procesos;
- responsables;
- horarios;
- catálogos;
- ubicaciones;
- reglas;
- métricas.

## 9.3 Campos conceptuales

- `id`;
- `tenant_id`;
- `parent_id`;
- `type`;
- `name`;
- `code`;
- `timezone`;
- `address`;
- `active`;
- `metadata`.

---

# 10. Identidad, usuarios y permisos

## 10.1 Tipos de actores

- Platform Super Admin;
- Platform Support;
- Tenant Owner;
- Tenant Admin;
- Supervisor;
- Agent;
- Operator;
- Viewer;
- custom roles.

## 10.2 RBAC

No limitarse a `admin/user`.

Permisos granulares propuestos:

```text
contacts.read
contacts.write
contacts.export

conversations.read
conversations.reply
conversations.assign

appointments.read
appointments.write
appointments.manage_settings

quotes.read
quotes.create
quotes.approve
quotes.send

processes.read
processes.write
processes.transition

documents.read
documents.upload
documents.delete

rules.read
rules.manage

users.manage
roles.manage

channels.read
channels.manage

portal.manage
branding.manage
integrations.manage
billing.read
```

## 10.3 Scopes

Además del permiso, podrá existir scope:

- todo el tenant;
- organization unit;
- equipo;
- propio.

## 10.4 Auditoría

Cambios de permisos deben auditarse.

---

# 11. Super Admin

## 11.1 Objetivo

Panel exclusivo del propietario/operador de la plataforma.

## 11.2 Funciones MVP

- listar tenants;
- crear tenant;
- editar tenant;
- suspender/reactivar;
- ver plan;
- asignar plan;
- activar/desactivar módulos;
- establecer límites;
- ver usuarios administradores;
- ver conexiones;
- ver estado de servicios;
- ver versión desplegada;
- ver backups;
- ver consumo;
- ver errores operativos;
- entrar en modo soporte controlado, auditado y opcional;
- gestionar plantillas globales;
- gestionar proveedores globales;
- gestionar releases.

## 11.3 Configuración de módulos por tenant

Debe poder seleccionar:

```text
Core                [ON]
Inbox               [ON]
Automatización      [ON]
Automatización Pro  [OFF]
Agenda              [ON]
Cotizaciones        [OFF]
Catálogo            [OFF]
Portal              [ON]
Action Requests     [ON]
IA                   [OFF]
API                  [OFF]
Webhooks             [ON]
White Label          [OFF]
```

La UI del tenant no debe mostrar módulos no habilitados o debe mostrarlos sólo como upgrade si comercialmente se decide.

---

# 12. Dashboard del tenant

## 12.1 Pantallas CORE

- Inicio;
- Inbox;
- Contactos;
- Empresas/Clientes;
- Procesos;
- Timeline;
- Tareas/Acciones;
- Automatizaciones;
- Canales;
- Usuarios;
- Unidades organizativas;
- Reportes;
- Configuración.

## 12.2 Pantallas según módulos

- Agenda;
- Servicios;
- Cotizaciones;
- Catálogo;
- Pedidos;
- Documentos;
- Portal;
- Formularios;
- Integraciones;
- IA;
- Plantillas.

## 12.3 Personalización visual

Configuración:

- logo;
- logo dark;
- favicon;
- nombre;
- primary color;
- secondary color;
- accent color;
- sidebar;
- border radius;
- modo claro/oscuro;
- tipografía aprobada;
- dominio personalizado según plan.

---

# 13. Theme Engine

## 13.1 Presets iniciales

Crear aproximadamente 10 presets profesionales:

1. Corporate Blue;
2. Medical Clean;
3. Legal Executive;
4. Industrial;
5. Modern Dark;
6. Education;
7. Premium;
8. Minimal;
9. Retail;
10. Professional Neutral.

## 13.2 White label

Planes superiores podrán ofrecer:

- dominio del cliente;
- branding total;
- favicon;
- emails con marca;
- portal con marca.

---

# 14. Contactos, clientes y CRM ligero

## 14.1 Contact

Persona física.

Campos:

- nombre;
- apellidos;
- teléfonos;
- emails;
- preferred channel;
- language;
- tags;
- notes;
- custom fields;
- consent metadata;
- status.

## 14.2 Customer/Organization

Empresa u organización a la que pertenecen contactos.

Relaciones:

```text
Empresa ACME
├── Juan Pérez — Compras
├── Laura Díaz — Finanzas
└── Roberto López — Mantenimiento
```

## 14.3 Vista 360

Mostrar:

- conversaciones;
- cotizaciones;
- pedidos;
- procesos;
- expedientes;
- citas;
- archivos;
- notas;
- acciones;
- timeline;
- responsables.

## 14.4 Identidad omnicanal

Una misma persona puede tener:

- WhatsApp;
- email;
- portal;
- web chat futuro.

Debe ser un solo Contact.

---

# 15. Channel Engine

## 15.1 Entidades

- `ChannelProvider`;
- `ChannelAccount`;
- `Conversation`;
- `Message`;
- `Attachment`.

## 15.2 Futuros canales

Arquitectura preparada para:

- WhatsApp;
- web chat;
- email;
- Telegram;
- Instagram;
- Messenger;
- SMS.

No todos son MVP.

---

# 16. WhatsApp: múltiples cuentas por tenant

## 16.1 Gestión por cliente

El cliente debe poder:

- agregar cuenta;
- eliminar/desconectar;
- ver QR;
- re-vincular;
- ver estado;
- asignar a una unidad organizativa;
- elegir uso;
- definir nombre visible interno.

Ejemplo:

```text
Ventas León
+52...
Baileys
Connected

Atención
+52...
WPPConnect
Connected

Cobranza
+52...
Meta
Connected
```

## 16.2 Límites

Cantidad de cuentas controlada por entitlements.

Posible monetización:

- 1 incluida;
- paquetes de 3/5;
- conexión extra;
- Enterprise configurable.

Los precios concretos podrán ajustarse después de medir consumo y soporte.

## 16.3 Abstracción

Contrato conceptual:

```ts
interface MessagingProvider {
  connect(...)
  disconnect(...)
  getConnectionStatus(...)
  sendText(...)
  sendMedia(...)
  sendDocument(...)
  receiveEvents(...)
  syncHistory?(...)
}
```

---

# 17. Proveedores WhatsApp

## 17.1 Baileys

Proveedor inicial recomendado para MVP.

Requisitos:

- QR;
- persistencia de auth state en almacenamiento adecuado;
- reconexión;
- eventos;
- mensajes;
- media;
- worker aislable por cuenta.

Baileys documenta que su estado de autenticación de demo basado en archivos no debe utilizarse como estrategia de producción. Implementar persistencia propia en DB/almacenamiento cifrado.

## 17.2 WPPConnect

Segundo adapter.

Razón:

- implementación diferente basada en WhatsApp Web/browser;
- múltiples sesiones;
- alternativa operacional.

No asumir compatibilidad de sesión con Baileys.

## 17.3 Meta WhatsApp Business Platform

Adapter oficial para clientes que:

- requieran vía oficial;
- necesiten integración empresarial;
- acepten su modelo de onboarding/precios/restricciones.

## 17.4 Migración de proveedor

No prometer failover instantáneo entre implementaciones no oficiales.

Sesiones de Baileys/WPPConnect/Meta no se consideran intercambiables.

Se soportará:

- seleccionar proveedor;
- desconectar;
- migrar controladamente;
- re-vincular cuando sea necesario.

---

# 18. Sincronización humano/BOT

## 18.1 Respuesta humana desde teléfono

El empleado puede responder desde su aplicación WhatsApp normal/dispositivo vinculado.

La plataforma debe escuchar la conversación y registrar ese mensaje.

## 18.2 Respuesta humana desde dashboard

Empleado responde desde Inbox.

La plataforma envía vía provider y registra:

- usuario;
- hora;
- channel account;
- message id;
- origin.

## 18.3 Origen de mensaje

Campo conceptual `origin`:

- `customer`;
- `human_app`;
- `human_external_device`;
- `bot_rule`;
- `bot_ai`;
- `automation`;
- `integration`;
- `system`.

## 18.4 Actor

Cuando se conoce:

- `actor_user_id`;
- `actor_contact_id`;
- `actor_system_component`.

## 18.5 Distinción

La plataforma debe distinguir con seguridad:

- mensaje generado por nuestra aplicación;
- mensaje observado como enviado desde la cuenta, pero no iniciado por nuestra app.

No prometer identificación exacta del dispositivo físico si el proveedor no expone metadata confiable.

---

# 19. Conversation Automation Mode

Cada conversación debe tener un modo.

## AUTO

La plataforma puede responder y ejecutar automáticamente dentro de reglas.

## ASSISTED

Prepara acciones/respuestas y solicita aprobación humana.

## HUMAN

Automatización de respuesta pausada.

## MONITOR

Observa, registra, clasifica o genera métricas sin responder.

## 19.1 Human takeover

Cuando un humano interviene se puede configurar:

- pausar 15 min;
- pausar 30 min;
- pausar N minutos;
- pausar hasta cerrar;
- no pausar.

Configuración tenant/global.

---

# 20. Inbox

## 20.1 Estados sugeridos

- Nuevo;
- Bot atendiendo;
- Requiere humano;
- Asignado a mí;
- Pendiente;
- Snoozed;
- Cerrado.

## 20.2 Capacidades

- responder;
- adjuntar;
- asignar;
- etiquetar;
- notas internas;
- prioridad;
- respuestas rápidas;
- cerrar;
- takeover;
- volver a Auto;
- ver datos del contacto;
- ver procesos asociados;
- ver Action Requests;
- ver cotizaciones;
- ver timeline.

---

# 21. Process Engine — corazón del producto

## 21.1 Objetivo

Evitar crear módulos rígidos para cada industria.

Crear una primitiva configurable capaz de representar:

- pedido;
- expediente;
- trámite;
- reparación;
- inscripción;
- reclamación;
- proyecto;
- solicitud;
- servicio;
- embarque;
- orden;
- caso.

## 21.2 Process Definition

Define un tipo de proceso.

Campos conceptuales:

- `id`;
- `tenant_id`;
- `name`;
- `code`;
- `description`;
- `icon`;
- `color`;
- `organization_unit_scope`;
- `portal_visibility`;
- `active`.

## 21.3 Process Instance

Instancia real.

Ejemplo:

`Expediente 283/2026`.

Campos:

- `id`;
- `tenant_id`;
- `definition_id`;
- `reference_number`;
- `customer_id`;
- `primary_contact_id`;
- `status_id`;
- `owner_id`;
- `organization_unit_id`;
- `priority`;
- `opened_at`;
- `closed_at`;
- `due_at`;
- `custom_data`;
- `metadata`.

## 21.4 Custom fields

Tipos:

- text;
- long text;
- integer;
- decimal;
- money;
- date;
- datetime;
- time;
- boolean;
- select;
- multiselect;
- relation;
- contact;
- customer;
- user;
- file;
- image;
- URL;
- phone;
- email.

## 21.5 Estados

Configurable por Process Definition.

Ejemplo legal:

- Abierto;
- En revisión;
- Pendiente documentación;
- En trámite;
- Resolución;
- Cerrado.

Ejemplo taller:

- Recibido;
- Diagnóstico;
- Cotizado;
- Esperando autorización;
- Reparación;
- Listo;
- Entregado.

## 21.6 Transiciones

Pueden incluir:

- origen;
- destino;
- permisos;
- condiciones;
- requerimientos;
- automatizaciones;
- aprobación.

---

# 22. Timeline Engine

## 22.1 Objetivo

Trazabilidad universal.

Cada evento importante genera una entrada.

Ejemplos:

- mensaje recibido;
- cambio de estado;
- documento recibido;
- cita creada;
- cotización aprobada;
- nota añadida;
- usuario asignado;
- acción completada.

## 22.2 Visibilidad

Campo:

- `internal`;
- `customer`;
- `both`.

Esto permite publicar al cliente únicamente eventos seguros.

## 22.3 Inmutabilidad

Eventos de auditoría crítica no deben poder borrarse sin rastro.

Puede permitirse ocultamiento/redacción bajo políticas, conservando auditoría de la acción.

---

# 23. Action Request — primitiva CORE

## 23.1 Objetivo

Solicitar una acción a un cliente o actor interno y permitir que un workflow continúe al completarse.

## 23.2 Casos

- subir documento;
- confirmar cita;
- elegir fecha;
- proporcionar dato;
- aprobar;
- rechazar;
- autorizar reparación;
- aprobar cotización;
- firmar;
- pagar;
- aceptar términos;
- responder formulario.

## 23.3 Destinatarios

- contact/customer;
- user;
- role;
- team;
- organization unit;
- external.

## 23.4 Estados

- draft;
- pending;
- viewed;
- completed;
- rejected;
- expired;
- cancelled.

## 23.5 Campos

- tipo;
- título;
- descripción;
- destinatario;
- relación con proceso/cotización/cita;
- due date;
- public visibility;
- result payload;
- completion actor;
- completion channel;
- timestamps.

## 23.6 Canales de resolución

Una Action Request puede completarse desde:

- WhatsApp;
- portal;
- formulario;
- dashboard;
- integración.

---

# 24. Rules Engine

## 24.1 Objetivo

Automatización determinista y auditable.

Modelo:

**Trigger + Conditions + Actions**

## 24.2 Triggers MVP

- message_received;
- conversation_started;
- conversation_human_intervention;
- contact_created;
- appointment_created;
- appointment_updated;
- appointment_due;
- quote_created;
- quote_approved;
- quote_rejected;
- process_created;
- process_status_changed;
- document_received;
- action_request_created;
- action_request_completed;
- timer_due;
- webhook_received.

## 24.3 Condiciones

- igualdad;
- desigualdad;
- contiene;
- regex;
- existe/no existe;
- rango;
- fecha;
- importe;
- estado;
- role;
- organization unit;
- tag;
- channel;
- business hours;
- custom field.

## 24.4 Acciones

- send_message;
- send_template;
- create_task;
- create_action_request;
- create_process;
- transition_process;
- update_field;
- assign_user;
- add_tag;
- generate_document;
- create_quote;
- request_quote_approval;
- create_appointment;
- cancel_appointment;
- schedule_job;
- call_webhook;
- call_integration;
- notify_user;
- pause_bot;
- resume_bot;
- invoke_ai;
- write_timeline_event.

## 24.5 Builder

MVP:

formularios estructurados.

Futuro:

builder visual.

---

# 25. Workflow Orchestration

## 25.1 V1/MVP

- Redis;
- BullMQ;
- scheduler;
- workers.

## 25.2 Abstracción obligatoria

El dominio no debe depender directamente de BullMQ.

Crear:

```ts
interface WorkflowOrchestrator {
  startWorkflow(...)
  schedule(...)
  signal(...)
  cancel(...)
  retry(...)
  getStatus(...)
}
```

Implementación inicial:

`BullMQOrchestrator`.

Futura:

`TemporalOrchestrator`.

## 25.3 Temporal

No desplegar en MVP salvo que durante implementación aparezca un caso que realmente lo exija.

La arquitectura queda preparada para integrarlo.

Temporal es candidato para:

- workflows que viven días/semanas;
- señales externas;
- procesos durables;
- reintentos complejos;
- múltiples esperas;
- recuperación robusta.

## 25.4 Idempotencia

Jobs críticos deben tener idempotency keys.

Ejemplos:

- enviar cotización;
- crear pedido;
- enviar recordatorio;
- procesar pago.

---

# 26. Agenda, citas y reservaciones

## 26.1 Entidades

- Service;
- Resource/Staff;
- Schedule;
- AvailabilityRule;
- Exception;
- Appointment;
- AppointmentParticipant;
- Reminder.

## 26.2 Capacidades

- crear;
- confirmar;
- cancelar;
- reprogramar;
- elegir empleado;
- duración;
- buffer;
- capacidad;
- horarios;
- días inhábiles;
- excepciones;
- recordatorios;
- no-show;
- notas;
- integración futura Calendar.

## 26.3 Canales

La misma cita se puede gestionar desde:

- WhatsApp;
- dashboard;
- portal;
- formulario;
- integración.

---

# 27. Quote Engine

## 27.1 Objetivo

Permitir generación profesional, asistida o autónoma.

## 27.2 Entidades

- Quote;
- QuoteItem;
- QuoteTemplate;
- PricingRule;
- ApprovalPolicy.

## 27.3 Datos

- cliente;
- contacto;
- items;
- SKU;
- descripción;
- cantidad;
- precio;
- descuento;
- impuesto;
- subtotal;
- total;
- vigencia;
- términos;
- moneda;
- salesperson;
- status.

## 27.4 Autonomía

### Nivel 0 Manual
Captura y humano genera.

### Nivel 1 Asistido
Sistema genera borrador y humano aprueba.

### Nivel 2 Autónomo con límites
Sistema envía si todas las reglas de seguridad se cumplen.

### Nivel 3 Autónomo
Sólo para escenarios altamente deterministas y habilitados por tenant.

## 27.5 Reglas de aprobación

Ejemplos:

- importe máximo;
- margen mínimo;
- descuento máximo;
- cliente aprobado;
- stock;
- producto estándar;
- crédito;
- método de pago.

## 27.6 Regla crítica

La IA no decide precios finales.

Puede:

- entender petición;
- mapear producto;
- extraer cantidades;
- sugerir equivalencias.

El motor determinista calcula y valida.

---

# 28. Document Engine

## 28.1 Objetivo

No limitarse a cotizaciones.

Generar:

- cotización;
- orden de servicio;
- confirmación;
- reporte;
- presupuesto;
- ficha;
- resumen;
- comprobante;
- documento operativo.

## 28.2 Plantillas

Aproximadamente 10 temas iniciales profesionales.

Tecnología sugerida:

- HTML/CSS;
- variables;
- renderer PDF.

## 28.3 Personalización

Cliente puede cargar:

- logo;
- información fiscal;
- nombre;
- teléfono;
- email;
- dirección;
- colores;
- términos;
- firma;
- footer.

## 28.4 Versionado

Una cotización enviada conserva snapshot de contenido y plantilla para reproducibilidad.

---

# 29. Catálogo y productos

## 29.1 MVP básico

- Product;
- SKU;
- descripción;
- categoría;
- price;
- active;
- custom fields.

## 29.2 Futuro

- variantes;
- inventario;
- sucursal;
- equivalencias;
- listas de precios;
- cliente-specific pricing;
- disponibilidad;
- integración ERP.

No convertir V1 en ERP.

---

# 30. Customer Portal

## 30.1 Objetivo

Dar autoservicio sin obligar a preguntar por WhatsApp.

## 30.2 Casos

Abogado:

- expediente;
- movimientos;
- documentos;
- próxima audiencia;
- acciones pendientes.

Taller:

- vehículo;
- diagnóstico;
- cotización;
- autorización;
- fotos;
- estatus.

Logística:

- embarque;
- tracking;
- documentos;
- POD.

Escuela:

- inscripción;
- documentos;
- solicitudes;
- eventos.

## 30.3 Seguridad

- links firmados temporales para acciones simples;
- login para información persistente;
- MFA futuro según plan;
- scopes estrictos.

## 30.4 Branding

Reutilizar Theme Engine del tenant.

---

# 31. Formularios públicos/privados

## 31.1 Custom Forms

Tenant podrá definir formularios:

- alta;
- intake;
- documentos;
- solicitud;
- registro;
- cita.

## 31.2 Entrada

Form submission puede:

- crear Contact;
- crear Process;
- crear Action Request;
- generar evento;
- disparar Rule.

---

# 32. IA: principios

## 32.1 Filosofía

**Rules first. AI only where useful.**

## 32.2 Tiers

### Tier 0
Sin IA.

### Tier 1
Modelo ligero:

- intent;
- clasificación;
- extracción;
- normalización.

### Tier 2
Modelo intermedio:

- FAQ semántico;
- búsqueda;
- resumen;
- recomendación.

### Tier 3
Modelo superior:

- casos complejos;
- análisis;
- lenguaje avanzado.

## 32.3 Copilot humano

En modo HUMAN/ASSISTED:

- sugerir respuesta;
- resumir conversación;
- extraer datos;
- proponer siguiente acción.

Nunca auto-enviar en modo HUMAN.

---

# 33. AI Gateway y Auto Router

## 33.1 Objetivo

No acoplar la plataforma a un proveedor/modelo.

## 33.2 Proveedores previstos

- OpenCode Zen;
- NVIDIA;
- Poolside;
- proveedores compatibles con OpenAI API;
- proveedores futuros;
- modelos locales.

Los nombres/modelos específicos pueden cambiar con el tiempo y deben configurarse.

## 33.3 Multi-key

Cada provider puede almacenar múltiples credenciales autorizadas.

Campos:

- enabled;
- priority;
- health;
- rate-limit state;
- cooldown;
- last_error;
- cost metadata.

No usar key rotation para evadir términos o límites prohibidos del proveedor.

## 33.4 Routing

Inputs:

- task type;
- required quality;
- latency;
- cost;
- availability;
- quota;
- privacy class;
- model capability.

## 33.5 Fallback

Ante:

- timeout;
- 429 legítimo;
- 5xx;
- health failure;
- provider unavailable;

podrá usar siguiente provider/model permitido.

---

# 34. Privacidad IA

## 34.1 Data classification

- PUBLIC;
- INTERNAL;
- PERSONAL;
- CONFIDENTIAL;
- SENSITIVE.

## 34.2 Provider policy

Cada endpoint/model debe registrar:

- allowed classifications;
- retention policy;
- training policy;
- region;
- notes.

## 34.3 Tenant policy

Tenant podrá:

- desactivar IA;
- permitir sólo contenido no sensible;
- seleccionar providers;
- exigir redacción;
- restringir modelos.

## 34.4 Redacción

Cuando sea posible:

- eliminar nombres;
- reemplazar teléfonos;
- reemplazar emails;
- usar IDs internos;
- minimizar payload.

## 34.5 OpenCode Zen

Se considera provider útil.

No asumir que todos los endpoints gratuitos aceptan información sensible. Las políticas oficiales del endpoint/modelo tienen prioridad.

---

# 35. Integraciones

## 35.1 Integration Engine

Adapters para:

- Google;
- Microsoft;
- CRM;
- ERP;
- e-commerce;
- logística;
- pagos;
- correo;
- calendario.

## 35.2 REST API

Debe planearse desde V1 aunque el acceso comercial pueda activarse después.

## 35.3 Webhooks

Eventos salientes configurables.

Ejemplos:

- quote.approved;
- process.updated;
- appointment.created;
- document.received;
- action.completed.

## 35.4 n8n

No usar como motor central de automatización del producto.

Motivo:

- dependencia externa;
- licenciamiento comercial para ciertos usos multi-cliente/embed;
- no queremos que la lógica core dependa de un producto que no controlamos.

Puede usarse internamente o en casos aislados si legal/comercialmente conviene.

---

# 36. Infraestructura de producción inicial

## 36.1 Servidor propio

Infraestructura principal inicialmente en servidor propio.

No diseñar dependencia operativa de free tiers de Google.

## 36.2 Docker Compose

MVP:

- `web`;
- `api`;
- `worker-jobs`;
- `worker-whatsapp`;
- `postgres`;
- `redis`;
- `document-renderer`;
- `ai-gateway`;
- `cloudflared`;
- reverse proxy si aplica.

## 36.3 Cloudflare Tunnel

Publicación de servicios mediante `cloudflared`.

Beneficios:

- conexión saliente;
- evitar exposición directa de origen;
- no abrir servicios internos directamente a Internet.

## 36.4 PostgreSQL

Local/servidor propio como principal.

## 36.5 Redis

No exponer públicamente.

## 36.6 Base de datos

Nunca exponer PostgreSQL a Internet.

---

# 37. Backups

## 37.1 Estrategia

Backup asíncrono cifrado hacia Google Drive.

No Cloud Storage como dependencia principal.

## 37.2 Retención

Mantener únicamente:

- backup nuevo verificado;
- backup anterior verificado.

Al generar tercero, borrar el más viejo sólo después de validar el nuevo.

## 37.3 Proceso

1. crear backup local;
2. dump PostgreSQL;
3. incluir archivos/configuración definidos;
4. comprimir;
5. cifrar;
6. checksum;
7. subir a Drive;
8. verificar existencia/integridad;
9. marcar current;
10. current anterior pasa a previous;
11. eliminar el tercero;
12. registrar auditoría.

## 37.4 Herramientas candidatas

- `pg_dump`;
- `tar`;
- `zstd`;
- `age`;
- `rclone` para Drive.

## 37.5 Contenido

Backup puede incluir:

- DB;
- tenant files;
- logos;
- attachments;
- templates;
- configuración no secreta;
- manifest.

## 37.6 Escala futura

Si adjuntos crecen demasiado:

- separar DB/config backups;
- separar storage replication;
- evitar re-subir terabytes completos diariamente.

---

# 38. Storage de archivos

## 38.1 Inicial

Storage en servidor, aislado por tenant mediante rutas/IDs y permisos.

## 38.2 Tipos

- media;
- attachments;
- documents;
- logos;
- template assets;
- generated PDFs.

## 38.3 Requisitos

- IDs no predecibles;
- metadata en DB;
- permisos tenant-aware;
- antivirus/scan futuro;
- límites por plan;
- lifecycle futuro.

---

# 39. Seguridad

## 39.1 Principios

- least privilege;
- tenant isolation;
- secrets encrypted;
- auditability;
- no public DB;
- rate limiting;
- secure cookies/tokens;
- CSRF según arquitectura;
- validation;
- content-type checks.

## 39.2 Secrets

- no secrets en Git;
- provider keys cifradas;
- WhatsApp auth state protegido;
- rotación futura;
- acceso restringido.

## 39.3 Sesiones

- expiración;
- revocación;
- MFA futuro;
- device/session management.

## 39.4 Auditoría

Registrar:

- login relevante;
- cambios de rol;
- cambios de módulo;
- cambios de límites;
- cambios de procesos;
- cambios de reglas;
- cambios de integración;
- aprobación;
- envío de cotización;
- descarga de datos;
- acciones administrativas.

---

# 40. Observabilidad

## 40.1 Logs

Structured logs con:

- tenant_id;
- deployment_id;
- service;
- request_id;
- job_id;
- conversation_id cuando aplique.

## 40.2 Health checks

- API;
- DB;
- Redis;
- workers;
- channel connections;
- AI providers;
- backup;
- disk;
- storage.

## 40.3 Métricas

Producto:

- mensajes;
- conversaciones;
- primera respuesta;
- automatizaciones;
- intervención humana;
- citas;
- no-shows;
- cotizaciones;
- conversiones;
- procesos;
- SLA;
- IA;
- costos.

Infra:

- CPU;
- RAM;
- disk;
- queue depth;
- job failures;
- DB connections;
- worker restart.

---

# 41. Versionado y releases

## 41.1 SemVer

Usar Semantic Versioning cuando aplique.

## 41.2 Release channels

- stable;
- candidate;
- beta/dev interno.

## 41.3 Dedicated/on-premise

Cada deployment registra:

- deployment ID;
- current version;
- target version;
- last migration;
- health;
- release channel.

## 41.4 Migraciones

Migraciones DB:

- versionadas;
- reversibilidad evaluada;
- backup antes de migraciones riesgosas;
- compatibles con rolling strategy cuando sea necesario.

---

# 42. Monorepo propuesto

```text
/apps
  /web
  /api
  /worker-whatsapp
  /worker-jobs
  /document-renderer

/services
  /ai-gateway

/packages
  /database
  /auth
  /tenancy
  /rbac
  /events
  /workflows
  /processes
  /appointments
  /quotes
  /documents
  /catalog
  /crm
  /audit
  /notifications

  /messaging
    /core
    /baileys
    /wppconnect
    /meta

  /integrations
    /google
    /microsoft
    /webhooks

  /ui
  /themes
  /templates
```

No es obligación absoluta mantener exactamente estos nombres si durante implementación aparece una mejor separación, pero los límites de dominio sí deben respetarse.

---

# 43. Stack técnico de referencia

## Frontend

- Next.js;
- React;
- TypeScript.

## Backend

- NestJS;
- TypeScript.

## DB

- PostgreSQL.

## ORM

- Prisma como candidato inicial.

## Queue

- Redis;
- BullMQ.

## WhatsApp

- Baileys MVP;
- WPPConnect adapter;
- Meta adapter.

## Documents

- HTML/CSS → PDF.

## Deployment

- Docker;
- Docker Compose;
- Cloudflare Tunnel.

## AI

- gateway propio o LiteLLM como componente de infraestructura si demuestra conveniencia.

La dependencia al gateway debe estar detrás de nuestra interfaz.

---

# 44. Eventos de dominio iniciales

Lista de referencia:

```text
TenantCreated
TenantSuspended
TenantModuleEnabled
TenantModuleDisabled

UserCreated
UserRoleChanged

ChannelAccountCreated
ChannelAccountConnected
ChannelAccountDisconnected

ConversationCreated
MessageReceived
MessageSent
HumanInterventionDetected
ConversationModeChanged

ContactCreated
ContactUpdated
CustomerCreated

ProcessCreated
ProcessStatusChanged
ProcessAssigned
ProcessClosed

TimelineEventCreated

ActionRequestCreated
ActionRequestViewed
ActionRequestCompleted
ActionRequestRejected
ActionRequestExpired

AppointmentCreated
AppointmentConfirmed
AppointmentRescheduled
AppointmentCancelled
AppointmentCompleted
AppointmentNoShow

QuoteCreated
QuoteApprovalRequested
QuoteApproved
QuoteRejected
QuoteSent
QuoteAccepted
QuoteExpired

DocumentReceived
DocumentGenerated

RuleTriggered
AutomationExecuted
AutomationFailed
```

---

# 45. Pricing y modelo comercial inicial

Los precios son orientativos y deben validarse con mercado/primeros clientes.

## Implementación

Referencia previamente definida:

- piloto: ~12,000–25,000 MXN;
- implementación completa: ~30,000–70,000+ MXN;
- casos complejos/dedicated pueden superar esos rangos.

## Mensual

Posibles rangos iniciales:

- Starter: 1,500–3,000 MXN;
- Business: 3,000–7,000 MXN;
- Advanced: 6,000–12,000 MXN;
- Enterprise/Dedicated: 8,000–20,000+ MXN.

## Primeros casos

Puede aceptarse menor costo a cambio de:

- feedback;
- medición;
- caso de éxito;
- testimonio;
- acceso operativo controlado.

## Cobros adicionales

- WhatsApp extra;
- usuarios extra;
- sucursales;
- storage;
- custom domain;
- white label;
- integraciones;
- IA;
- dedicated hosting;
- soporte/SLA;
- desarrollos extraordinarios.

No llamar al mensual únicamente “hosting”.

Debe vender:

- licencia;
- plataforma;
- mantenimiento;
- actualizaciones;
- backup;
- operación;
- soporte según plan.

---

# 46. Plantillas por industria

Las plantillas NO deben crear código vertical independiente.

Deben preconfigurar primitivas.

## 46.1 Dentistas

- agenda;
- servicios;
- doctores;
- recordatorios;
- confirmaciones;
- contacto;
- seguimiento.

## 46.2 Médicos

- agenda;
- información;
- recordatorios;
- Action Requests;
- documentación según alcance permitido.

No sustituir expediente clínico regulado sin diseño específico.

## 46.3 Abogados

- Contact;
- Customer;
- Process = expediente;
- movimientos;
- documentos;
- Action Requests;
- portal;
- citas;
- timeline público/interno.

## 46.4 Contadores

- proceso = trámite/declaración;
- documentos;
- fechas;
- acciones requeridas;
- recordatorios;
- portal.

## 46.5 Escuelas

- alumnos/contactos;
- inscripción;
- documentación;
- citas/eventos;
- solicitudes;
- portal.

## 46.6 Talleres

- vehículo mediante custom fields/entidad futura;
- orden;
- diagnóstico;
- cotización;
- autorización;
- reparación;
- fotos;
- entrega.

## 46.7 Logística

- cotización;
- embarque;
- tracking;
- documentación;
- coordinación;
- POD;
- notificaciones.

## 46.8 Distribuidores/refacciones

- catálogo;
- SKU;
- equivalencias;
- cotización;
- pedido;
- estatus;
- seguimiento.

## 46.9 Maquinaria

- lead;
- calificación;
- cotización;
- instalación;
- servicio;
- garantía;
- refacciones.

## 46.10 Inmobiliarias

- leads;
- propiedades vía integración/futuro;
- citas;
- documentación;
- seguimiento.

## 46.11 Servicios técnicos

- ticket/proceso;
- cita;
- visita;
- orden;
- estatus;
- documentos.

## 46.12 Restaurantes/hoteles/estéticas

- reservas;
- citas;
- servicios;
- recordatorios;
- información.

---

# 47. Portal jurídico como caso de referencia de alto valor

El caso legal representa bien el producto.

Cliente puede:

- consultar expediente;
- ver estado;
- ver movimientos publicados;
- ver próxima audiencia;
- descargar documentos visibles;
- subir documentos requeridos;
- responder Action Requests.

Abogado puede:

- registrar movimiento;
- marcarlo internal/customer/both;
- asignar;
- adjuntar;
- solicitar acción;
- cambiar estado.

WhatsApp puede consultar la misma DB y responder exactamente la información pública.

La fuente de verdad es única:

```text
PostgreSQL
├── Dashboard
├── Portal
└── WhatsApp
```

---

# 48. Cotización como caso de referencia de autonomía

Flujo:

```text
Solicitud
↓
Identificación
↓
Recolección de datos
↓
Productos
↓
Precio/reglas
↓
Generación Quote
↓
Política de aprobación
├── Auto Send
└── Action Request → aprobador
↓
PDF
↓
WhatsApp/Portal/Email futuro
↓
Seguimiento
```

La IA puede ayudar a interpretar lenguaje, pero reglas deterministas controlan el resultado.

---

# 49. Flujos interdepartamentales

La plataforma debe poder automatizar entre unidades.

Ejemplo:

```text
Ventas crea cotización
↓
Monto > límite
↓
Aprobación Gerencia
↓
Aprobado
↓
Enviar a cliente
↓
Aceptado
↓
Crear solicitud a Almacén
↓
Preparación
↓
Logística
↓
Enviado
↓
Notificar cliente
```

Esto es una capacidad avanzada comercializable.

---

# 50. Módulos propuestos

## CORE obligatorio

- Tenancy;
- Auth;
- RBAC;
- Organization Units;
- Contacts;
- Customers;
- Channels;
- Conversations;
- Messages;
- Timeline;
- Audit;
- Basic Settings.

## Automatización básica

- respuestas;
- triggers;
- reglas simples;
- takeover.

## Automatización avanzada

- Process Engine;
- Rule Engine avanzado;
- Action Requests;
- interdepartamental;
- aprobaciones;
- SLA futuro.

## Agenda

- servicios;
- horarios;
- personal;
- citas;
- reservaciones;
- recordatorios.

## Cotizaciones

- quote engine;
- approvals;
- PDF;
- templates.

## Catálogo

- productos;
- SKU;
- precios.

## Portal

- customer portal;
- public timeline;
- actions.

## Documentos

- archivos;
- document engine;
- templates.

## IA

- router;
- providers;
- copilot;
- intent/extraction.

## Integraciones

- API;
- webhooks;
- conectores.

## White Label

- dominio;
- branding avanzado.

---

# 51. MVP

## 51.1 Core

- tenant;
- super admin;
- dashboard tenant;
- auth;
- RBAC básico granular;
- Organization Units;
- feature/module flags;
- branding básico;
- audit.

## 51.2 WhatsApp

- Baileys;
- agregar cuenta por cliente;
- QR;
- múltiples cuentas según límite;
- auth persistence;
- status;
- reconnect;
- send/receive;
- multimedia esencial;
- inbox;
- human takeover;
- mensaje origin.

## 51.3 CRM ligero

- Contacts;
- Customers;
- tags;
- notes;
- custom fields;
- timeline.

## 51.4 Process Engine

- definitions;
- instances;
- custom fields;
- statuses;
- transitions;
- timeline.

## 51.5 Action Requests

- crear;
- completar;
- cancelar;
- WhatsApp/dashboard;
- documento/info/approval básicos.

## 51.6 Rules

- trigger;
- conditions;
- actions;
- timers;
- BullMQ.

## 51.7 Agenda

- servicios;
- personal;
- horarios;
- citas;
- cancelación;
- reprogramación;
- recordatorios.

## 51.8 Quotes

- manual;
- assisted;
- approval;
- PDF;
- branding;
- 10 temas iniciales.

## 51.9 IA

- opcional;
- provider abstraction;
- simple router;
- fallback;
- intent/extraction;
- métricas mínimas.

## 51.10 Infra

- Docker Compose;
- PostgreSQL;
- Redis;
- cloudflared;
- backups Drive;
- health checks;
- logs.

---

# 52. V1.5

- WPPConnect;
- Google Calendar;
- custom forms;
- portal más completo;
- SLA;
- approvals avanzados;
- dashboards;
- API;
- webhooks;
- custom domain;
- white label;
- privacy firewall IA avanzado;
- catálogo mejorado;
- plantillas de industria iniciales.

---

# 53. V2

- Meta WhatsApp adapter completo;
- onboarding oficial;
- Microsoft;
- pagos;
- portal avanzado;
- CRM integrations;
- ERP integrations;
- inventario opcional;
- quote engine avanzado;
- workflow visual;
- dedicated deployments administrados desde Control Plane;
- Temporal si los workflows lo justifican.

---

# 54. V3

- marketplace de módulos;
- marketplace de plantillas;
- plugins;
- workflow builder completo;
- omnicanal;
- analítica avanzada;
- auto-configuración de industrias;
- extensiones de terceros bajo contratos;
- mayor automatización de provisioning.

---

# 55. Provisioning de tenant

Flujo esperado:

1. Super Admin crea tenant.
2. Asigna plan.
3. Define módulos.
4. Define límites.
5. Crea Tenant Owner.
6. Aplica plantilla opcional de industria.
7. Cliente inicia sesión.
8. Configura branding.
9. Configura units.
10. Invita usuarios.
11. Agrega WhatsApp.
12. Configura servicios/procesos.
13. Activa reglas.
14. Prueba.
15. Go live.

Objetivo futuro: gran parte del flujo autoservicio.

---

# 56. Offboarding de tenant

Debe existir procedimiento:

- suspender automatizaciones;
- desconectar canales;
- exportar datos permitido;
- revocar usuarios;
- backup final según contrato;
- aplicar política de retención;
- eliminar secretos;
- eliminar datos tras período pactado;
- registrar auditoría.

---

# 57. Pruebas

## 57.1 Unit tests

Motores:

- reglas;
- permisos;
- pricing;
- transitions;
- tenancy.

## 57.2 Integration tests

- DB;
- queues;
- providers;
- document renderer;
- API.

## 57.3 E2E

Flujos críticos:

- tenant;
- WhatsApp connect;
- message;
- appointment;
- quote;
- approval;
- action request;
- process status;
- portal.

## 57.4 Tenant isolation tests

Obligatorios.

Intentar explícitamente acceso cruzado.

## 57.5 Idempotency tests

Reejecución no debe duplicar acciones críticas.

---

# 58. Criterios de aceptación generales del MVP

El MVP no se considera comercialmente utilizable hasta que:

1. Super Admin pueda crear tenant.
2. Pueda activar/desactivar módulos.
3. Tenant pueda iniciar sesión.
4. Tenant pueda agregar WhatsApp por QR.
5. Pueda enviar/recibir mensajes.
6. Mensajes humanos/bot tengan origen.
7. Pueda responder desde dashboard.
8. Respuesta externa se sincronice.
9. Contactos se centralicen.
10. Pueda crear proceso configurable.
11. Pueda cambiar estado.
12. Se cree timeline.
13. Pueda crear Action Request.
14. Pueda completarse.
15. Rule pueda reaccionar.
16. Pueda agendar/reprogramar/cancelar.
17. Pueda generar cotización.
18. Pueda requerir aprobación.
19. Pueda generar PDF con branding.
20. Backup automático funcione y se verifique.
21. Tenant A no pueda acceder a Tenant B.
22. Reiniciar Redis/worker no corrompa estado crítico.
23. Fallo de IA no impida operación base.

---

# 59. Riesgos y mitigaciones

## WhatsApp no oficial

Riesgo:

- cambios upstream;
- bloqueos;
- pairing;
- incompatibilidades.

Mitigación:

- adapter;
- Baileys + WPPConnect;
- Meta como opción;
- health;
- versiones probadas;
- migración controlada.

## Complejidad multiindustria

Riesgo:

producto infinito.

Mitigación:

- primitives;
- templates;
- strict scope;
- no vertical forks.

## Seguridad multi-tenant

Riesgo crítico.

Mitigación:

- tenant scope;
- tests;
- policies;
- audit;
- diseño desde inicio.

## IA

Riesgo:

- costo;
- privacy;
- hallucinación;
- provider failure.

Mitigación:

- opcional;
- rules first;
- router;
- classification;
- deterministic writes.

## Servidor propio

Riesgo:

- hardware;
- red;
- energía;
- storage.

Mitigación:

- backups;
- health;
- UPS/redundancia futura;
- migración Docker sencilla;
- posibilidad de dedicated/cloud.

## Backups Drive

Riesgo:

- archivo corrupto;
- cuota;
- credenciales.

Mitigación:

- encryption;
- checksum;
- verify-before-delete;
- restore drills.

---

# 60. Reglas de diseño del producto

1. Si puede configurarse, no programarlo por tenant.
2. Si se repite en dos industrias, convertirlo en primitive.
3. Si puede ser Rule, no codificar un flujo duro.
4. Si una operación altera dinero/estado crítico, debe ser determinista y auditable.
5. La IA interpreta; el dominio decide.
6. Mensajes no son la fuente de verdad.
7. Toda acción importante crea audit/timeline cuando corresponda.
8. Todo módulo respeta tenant y permissions.
9. Todo job crítico es idempotente.
10. Todo provider está detrás de adapter.
11. Toda integración está detrás de connector.
12. Toda instalación usa release versionada.

---

# 61. Decisiones explícitamente descartadas

## Firestore como DB principal
Descartado. PostgreSQL.

## Dependencia de free tier Google
Descartada.

## Cloud Storage como backup principal
Descartado.

## n8n como motor principal
Descartado.

## Fork por cliente
Prohibido.

## Temporal en MVP
No desplegado inicialmente; arquitectura preparada.

## IA obligatoria
Descartada.

## WhatsApp como fuente de verdad
Descartado.

---

# 62. Decisiones pendientes/no bloqueantes

Estas decisiones no impiden iniciar MVP:

- reverse proxy exacto delante de apps internas;
- Prisma definitivo vs alternativa;
- librería exacta de PDF rendering;
- sistema exacto de secrets local;
- implementación exacta de auth;
- proveedor de email transaccional;
- herramienta exacta de observabilidad;
- si LiteLLM se usa desde V1 o se implementa gateway mínimo propio;
- frecuencia exacta del backup;
- límites comerciales finales;
- precios finales por conexión adicional;
- detalles finales de los 10 temas;
- política de retención por industria;
- cuándo activar Temporal.

Cualquier elección debe respetar los principios de este documento.

---

# 63. Estrategia comercial paralela

El desarrollo no debe detener prospección.

La plataforma encaja especialmente en empresas con:

- WhatsApp como canal comercial;
- clientes preguntando estatus;
- agendas manuales;
- cotización frecuente;
- documentos;
- múltiples departamentos;
- tareas repetitivas;
- procesos con estados;
- recordatorios;
- aprobaciones.

Prioridad comercial inicial:

- distribuidores;
- refacciones;
- logística;
- maquinaria;
- talleres;
- clínicas/dentistas;
- abogados;
- contadores;
- escuelas;
- servicios.

Estrategia:

- vender problema concreto;
- configurar MVP;
- cobrar implementación;
- medir;
- convertir mejora en módulo reutilizable;
- aumentar MRR.

---

# 64. Métricas de éxito del producto

Negocio:

- tenants activos;
- MRR;
- churn;
- ARPA;
- attach rate de módulos;
- conexiones WhatsApp;
- expansión por tenant.

Producto:

- automatizaciones ejecutadas;
- % resuelto sin humano;
- tiempo de primera respuesta;
- citas gestionadas;
- cotizaciones generadas;
- Action Requests completadas;
- procesos activos;
- usuarios activos.

Confiabilidad:

- uptime;
- reconnect rate;
- failed jobs;
- backup success;
- queue lag;
- error rate.

---

# 65. Fuentes técnicas verificadas al corte del PRD

Estas referencias son para validar decisiones tecnológicas que pueden cambiar con el tiempo. Deben revisarse antes de upgrades importantes.

1. **Baileys documentation — Introduction / auth state.** La documentación actual advierte no depender en producción de `useMultiFileAuthState` y recomienda implementar almacenamiento apropiado.
2. **WPPConnect documentation.** WPPConnect continúa ofreciendo librería Node/TypeScript, múltiples sesiones y automatización basada en WhatsApp Web.
3. **Cloudflare Tunnel documentation.** `cloudflared` establece conexiones salientes hacia Cloudflare y permite evitar exposición directa del origen.
4. **Temporal documentation.** Temporal es open source/MIT, autoalojable y orientado a durable execution con retries, timers, task queues y signals.
5. **n8n licensing/help.** Para hosting/gestión de workflows y credenciales de clientes o embed del producto existen requisitos comerciales específicos; por eso n8n no es dependencia core.
6. **OpenCode Zen documentation.** Las políticas de privacidad pueden variar por endpoint/modelo; algunos endpoints gratuitos no son apropiados para datos personales/confidenciales. El router debe respetar políticas del proveedor.

---

# 66. Glosario

**Tenant:** empresa cliente de nuestra plataforma.  
**Organization Unit:** nodo jerárquico que puede representar sucursal, departamento, equipo o unidad.  
**Channel Account:** cuenta concreta de un canal, por ejemplo un número de WhatsApp.  
**Conversation:** hilo lógico con un contacto.  
**Process Definition:** plantilla/configuración de un tipo de proceso.  
**Process Instance:** caso real de un proceso.  
**Timeline Event:** evento trazable.  
**Action Request:** acción que alguien debe completar.  
**Rule:** trigger + condition + action.  
**Entitlement:** capacidad o límite contratado.  
**Provider:** implementación externa bajo adapter.  
**Control Plane:** administración central de deployments/tenants.  
**Data Plane:** runtime y datos operativos.  
**Human Takeover:** pausa/control humano de conversación.  
**Assisted Mode:** sistema propone, humano aprueba.  
**Auto Mode:** sistema puede actuar según reglas.

---

# 67. Decisión final de arquitectura al corte 2026-08-11

La plataforma será:

- multitenant;
- modular;
- configuration-driven;
- multi-canal;
- multi-cuenta WhatsApp;
- multi-sucursal/departamento;
- rules-first;
- AI-optional;
- PostgreSQL-centered;
- event-driven;
- auditable;
- deployable por Docker;
- actualizable desde un solo repositorio;
- preparada para dedicated/on-premise;
- preparada para Temporal;
- preparada para Meta;
- preparada para IA multi-provider;
- preparada para múltiples industrias.

Su núcleo no será WhatsApp.

Su núcleo será la combinación de:

1. **Tenant**
2. **Organization Unit**
3. **Contact/Customer**
4. **Conversation**
5. **Process**
6. **Timeline**
7. **Action Request**
8. **Rule**
9. **Permissions**
10. **Modules/Entitlements**

Agenda, cotizaciones, catálogo, documentos, portal, IA y futuras capacidades se construyen alrededor de esas primitivas.

---

# 68. Próximo paso técnico recomendado

Con este PRD cimentado, la siguiente fase debe producir, en este orden:

1. modelo de datos lógico completo;
2. ERD;
3. contratos TypeScript de dominios;
4. esquema de módulos/feature flags;
5. API surface inicial;
6. eventos;
7. estructura monorepo;
8. backlog MVP por épicas;
9. criterios de aceptación por historia;
10. Docker Compose de desarrollo;
11. bootstrap de PostgreSQL/Redis;
12. tenancy/auth;
13. Super Admin;
14. tenant dashboard;
15. WhatsApp adapter Baileys;
16. Inbox;
17. Contact/CRM;
18. Process Engine;
19. Action Requests;
20. Rules;
21. Agenda;
22. Quotes/Documents;
23. IA opcional;
24. backup/observability;
25. hardening y pruebas de aislamiento.

---

# 69. Regla de mantenimiento de este PRD

Este archivo debe actualizarse cuando ocurra cualquiera de estos eventos:

- se aprueba un módulo nuevo;
- se modifica arquitectura;
- se cambia provider core;
- se cambia estrategia de deployment;
- se añade una restricción legal;
- se cambia una entidad core;
- se cambia pricing model;
- se cambia roadmap;
- se toma una decisión que afectaría a un desarrollador nuevo.

No debe usarse la memoria de una IA como sustituto de actualizar este archivo.

---


# 70. Matriz de módulos, dependencias y activación

El Super Admin debe controlar módulos por tenant. La activación debe ser declarativa y auditable.

## 70.1 Módulos lógicos

| Código | Módulo | Dependencias mínimas | Puede deshabilitarse |
|---|---|---|---|
| CORE | Core | Ninguna | No |
| INBOX | Inbox | CORE, CHANNELS | Sí |
| CHANNELS | Canales | CORE | Sí, salvo tenant sin mensajería |
| WA | WhatsApp | CHANNELS | Sí |
| CRM | Contactos/CRM Lite | CORE | Recomendado siempre activo |
| PROCESS | Process Engine | CORE, CRM | Sí |
| TIMELINE | Timeline | CORE | Conceptualmente CORE |
| ACTIONS | Action Requests | PROCESS o CORE | Sí |
| RULES_BASIC | Automatización básica | CORE | Sí |
| RULES_ADV | Automatización avanzada | RULES_BASIC, PROCESS | Sí |
| APPOINTMENTS | Agenda | CORE, CRM | Sí |
| QUOTES | Cotizaciones | CORE, CRM, DOCUMENTS | Sí |
| DOCUMENTS | Document Engine | CORE | Sí |
| CATALOG | Catálogo | CORE | Sí |
| PORTAL | Customer Portal | CORE, CRM | Sí |
| FORMS | Formularios | CORE | Sí |
| AI | IA | CORE | Sí |
| API | API externa | CORE | Sí |
| WEBHOOKS | Webhooks | CORE | Sí |
| WHITELABEL | White Label | CORE, THEME | Sí |
| INTEGRATIONS | Integraciones | CORE | Sí |

## 70.2 Estados de módulo

No limitarse a booleano.

Un módulo puede estar:

- `disabled`;
- `trial`;
- `enabled`;
- `read_only`;
- `suspended`;
- `deprecated`.

Esto permite:
- demos;
- migraciones;
- impagos;
- beta;
- downgrade sin pérdida inmediata de datos.

## 70.3 Regla de datos al deshabilitar

Deshabilitar un módulo NO elimina datos automáticamente.

Debe:
- ocultar/limitar UI;
- detener nuevas automatizaciones si corresponde;
- conservar datos;
- permitir exportación según política;
- permitir reactivación.

La eliminación es una operación separada y explícita.

---

# 71. Feature flags

Los módulos expresan capacidades comerciales grandes. Los feature flags expresan variaciones internas o rollout.

Ejemplos:

```text
whatsapp.wppconnect_enabled
whatsapp.meta_enabled
quotes.autonomous_mode
portal.public_timeline
ai.multi_provider
rules.visual_builder
process.custom_transitions
```

Los flags pueden tener scope:

- platform;
- tenant;
- deployment;
- user beta.

No usar feature flags como sustituto permanente de módulos/entitlements.

---

# 72. Contrato de extensiones y plugins

## 72.1 Objetivo

Permitir integraciones realmente específicas sin contaminar Core.

## 72.2 Regla

Una extensión no puede:

- acceder a DB directamente saltándose servicios;
- ignorar tenant scope;
- alterar tablas Core sin migración registrada;
- introducir `if tenant = X` en Core.

## 72.3 Contratos

Posibles contratos:

```ts
interface IntegrationConnector {}
interface MessagingProvider {}
interface AIProvider {}
interface DocumentTemplateProvider {}
interface WorkflowActionPlugin {}
interface WorkflowTriggerPlugin {}
```

## 72.4 Plugin cliente excepcional

Sólo si una necesidad no es generalizable.

Ruta conceptual:

```text
/packages/plugins/<plugin-name>
```

No nombrar necesariamente por cliente si puede convertirse en producto.

Debe:
- declarar compatibilidad de versión;
- declarar permisos;
- declarar configuración;
- incluir tests;
- no romper actualizaciones.

---

# 73. Modelo de datos conceptual — entidades CORE

Esta sección no sustituye el ERD futuro, pero fija las entidades mínimas.

## 73.1 PlatformDeployment

- id;
- mode: shared/dedicated/on_prem;
- version;
- release_channel;
- environment;
- status;
- last_seen_at;
- last_backup_at;
- metadata.

## 73.2 Tenant

- id;
- slug;
- display_name;
- legal_name;
- status;
- plan_id;
- timezone;
- locale;
- country;
- currency;
- created_at;
- updated_at.

## 73.3 TenantEntitlement

- tenant_id;
- feature/module key;
- state;
- limit_value;
- effective_from;
- effective_until;
- source;
- notes.

## 73.4 OrganizationUnit

- id;
- tenant_id;
- parent_id;
- type;
- name;
- code;
- timezone;
- active.

## 73.5 User

- id;
- tenant_id nullable para Platform Admin;
- email/login;
- display_name;
- status;
- locale;
- timezone;
- last_login_at.

## 73.6 Role

- id;
- tenant_id nullable si rol built-in;
- name;
- description;
- built_in.

## 73.7 Permission

- key;
- description.

## 73.8 UserRole / RolePermission

Relaciones.

## 73.9 Contact

- id;
- tenant_id;
- first_name;
- last_name;
- display_name;
- status;
- preferred_channel;
- language;
- assigned_user_id;
- custom_data.

## 73.10 ContactPoint

Para evitar columnas rígidas.

- id;
- contact_id;
- type: phone/email/etc.;
- value_normalized;
- value_display;
- verified;
- primary;
- metadata.

## 73.11 CustomerOrganization

- id;
- tenant_id;
- name;
- legal_name;
- tax_id;
- status;
- owner_user_id;
- custom_data.

## 73.12 CustomerContactRelation

- customer_id;
- contact_id;
- title;
- department;
- primary.

---

# 74. Modelo de datos — canales y conversaciones

## 74.1 ChannelAccount

- id;
- tenant_id;
- organization_unit_id;
- provider_key;
- channel_type;
- label;
- external_identifier;
- status;
- credentials_ref;
- auth_state_ref;
- last_connected_at;
- last_error;
- settings;
- active.

## 74.2 Conversation

- id;
- tenant_id;
- channel_account_id;
- contact_id;
- status;
- automation_mode;
- assigned_user_id;
- assigned_unit_id;
- priority;
- last_message_at;
- last_human_message_at;
- last_automation_message_at;
- metadata.

## 74.3 Message

- id;
- tenant_id;
- conversation_id;
- provider_message_id;
- direction;
- origin;
- actor_user_id nullable;
- text;
- message_type;
- reply_to_message_id;
- status;
- sent_at;
- received_at;
- provider_timestamp;
- metadata.

## 74.4 Attachment

- id;
- tenant_id;
- message_id nullable;
- document_id nullable;
- storage_key;
- mime_type;
- size;
- checksum;
- original_name;
- scan_status;
- created_at.

## 74.5 Deduplicación

`provider_message_id + channel_account_id` debe prevenir duplicados cuando el proveedor lo permita.

---

# 75. Modelo de datos — procesos

## 75.1 ProcessDefinition

- id;
- tenant_id;
- name;
- code;
- description;
- active;
- portal_enabled;
- config_version.

## 75.2 ProcessFieldDefinition

- id;
- definition_id;
- key;
- label;
- type;
- required;
- validation;
- default_value;
- visibility;
- order.

## 75.3 ProcessStatusDefinition

- id;
- definition_id;
- key;
- label;
- category;
- color;
- order;
- terminal;
- customer_visible_label.

## 75.4 ProcessTransitionDefinition

- id;
- definition_id;
- from_status_id;
- to_status_id;
- required_permission;
- conditions;
- requires_approval;
- active.

## 75.5 ProcessInstance

- id;
- tenant_id;
- definition_id;
- reference;
- customer_id;
- contact_id;
- organization_unit_id;
- owner_user_id;
- status_id;
- priority;
- due_at;
- opened_at;
- closed_at;
- custom_data.

## 75.6 ProcessRelation

Permite relacionar:
- pedido ↔ cotización;
- expediente ↔ cliente;
- orden ↔ cita;
- embarque ↔ pedido.

Campos:
- source_type/id;
- target_type/id;
- relation_type.

---

# 76. Modelo de datos — Timeline y Action Requests

## 76.1 TimelineEvent

- id;
- tenant_id;
- entity_type;
- entity_id;
- event_type;
- visibility;
- title;
- description;
- actor_type;
- actor_id;
- payload;
- occurred_at;
- created_at.

## 76.2 ActionRequest

- id;
- tenant_id;
- type;
- status;
- title;
- description;
- recipient_type;
- recipient_id;
- related_entity_type;
- related_entity_id;
- due_at;
- visibility;
- completion_channel;
- completion_actor_type;
- completion_actor_id;
- result_payload;
- created_at;
- completed_at.

## 76.3 ActionRequestItem

Para solicitudes compuestas:

```text
☑ INE
☑ CURP
☐ comprobante
```

Campos:
- key;
- label;
- type;
- required;
- status;
- result.

---

# 77. Modelo de datos — automatización

## 77.1 RuleDefinition

- id;
- tenant_id;
- name;
- active;
- version;
- trigger_type;
- trigger_config;
- conditions;
- actions;
- organization_unit_scope;
- priority;
- stop_processing;
- created_by;
- updated_at.

## 77.2 RuleExecution

- id;
- tenant_id;
- rule_id;
- trigger_event_id;
- status;
- started_at;
- completed_at;
- error;
- output_summary;
- idempotency_key.

## 77.3 ScheduledJobReference

Persistir referencia semántica además del job BullMQ:

- id;
- tenant_id;
- job_type;
- related_entity;
- scheduled_for;
- status;
- orchestrator;
- orchestrator_job_id;
- idempotency_key.

---

# 78. Modelo de datos — agenda

## Service

- id;
- tenant_id;
- unit_id;
- name;
- duration_minutes;
- buffer_before;
- buffer_after;
- price optional;
- active.

## Resource

Puede ser:
- persona;
- consultorio;
- equipo;
- mesa;
- capacidad.

## AvailabilityRule

- weekdays;
- start/end;
- valid date range;
- resource;
- service.

## Appointment

- id;
- tenant_id;
- service_id;
- resource_id;
- contact_id;
- start_at;
- end_at;
- status;
- source;
- notes;
- reminder_policy;
- created_by.

---

# 79. Modelo de datos — cotizaciones/documentos

## Quote

- id;
- tenant_id;
- number;
- customer_id;
- contact_id;
- unit_id;
- status;
- currency;
- subtotal;
- discount;
- tax;
- total;
- valid_until;
- approval_status;
- autonomous_decision;
- template_id;
- snapshot_id;
- created_by;
- approved_by;
- sent_at.

## QuoteItem

- product_id optional;
- sku;
- description snapshot;
- qty;
- unit;
- unit_price;
- discount;
- tax;
- line_total;
- cost optional protected;
- margin optional protected.

## DocumentTemplate

- id;
- tenant_id nullable para global;
- type;
- theme_key;
- version;
- html;
- css;
- variables_schema;
- active.

## GeneratedDocument

- id;
- tenant_id;
- type;
- template_version;
- source_entity;
- storage_key;
- checksum;
- generated_at.

---

# 80. Especificación de pantallas — Super Admin

## 80.1 Overview

Widgets:

- tenants activos;
- tenants suspendidos;
- conexiones WhatsApp;
- workers healthy/unhealthy;
- backups;
- queue errors;
- versión;
- MRR futuro.

## 80.2 Tenants

Tabla:

- tenant;
- plan;
- status;
- users;
- channel accounts;
- modules;
- deployment;
- version;
- last activity.

Acciones:

- abrir;
- editar;
- suspender;
- cambiar plan;
- administrar módulos;
- administrar límites.

## 80.3 Tenant Detail

Tabs:

### General
Identidad, contacto comercial, timezone, locale.

### Entitlements
Módulos, límites, fechas.

### Users
Owners/Admins.

### Channels
Estado y cantidad; no mostrar secrets.

### Deployment
Modo, versión, salud.

### Usage
Mensajes, storage, IA, jobs.

### Backup
Últimos respaldos y verificación.

### Audit
Acciones de plataforma sobre tenant.

## 80.4 Modules

Catálogo global:

- code;
- version;
- dependencies;
- availability;
- beta;
- deprecated.

## 80.5 Deployments

- instance;
- mode;
- version;
- status;
- last heartbeat;
- target release.

## 80.6 Platform Settings

- defaults;
- global providers;
- feature flags;
- templates;
- backup status;
- releases.

---

# 81. Especificación de pantallas — Tenant

## 81.1 Dashboard

Configurado según módulos.

Mostrar:
- pendientes;
- conversaciones;
- Action Requests;
- citas;
- procesos;
- cotizaciones;
- SLA futuro.

## 81.2 Inbox

Layout:

```text
[folders/list] [conversation] [context panel]
```

Panel contexto:
- Contact;
- Customer;
- mode;
- owner;
- tags;
- related processes;
- pending Action Requests;
- upcoming appointment;
- latest quote.

## 81.3 Contacts

- search;
- filter;
- create;
- merge future;
- 360 view;
- custom fields;
- export permission.

## 81.4 Processes

- definitions admin;
- instances;
- Kanban/list future;
- detail;
- status;
- fields;
- documents;
- timeline;
- actions.

## 81.5 Rules

- list;
- status;
- trigger;
- last execution;
- failures;
- create/edit;
- test.

## 81.6 Channels

- connected accounts;
- add;
- QR;
- provider;
- unit;
- health;
- disconnect.

## 81.7 Settings

- company;
- branding;
- users;
- roles;
- units;
- custom fields;
- modules view;
- security;
- AI policy;
- integrations.

---

# 82. Onboarding WhatsApp detallado

1. Tenant Admin abre Canales.
2. Sistema valida entitlement.
3. Pulsa `Agregar WhatsApp`.
4. Selecciona unidad/departamento.
5. Selecciona provider permitido.
6. Introduce label.
7. Backend crea `ChannelAccount` en estado `provisioning`.
8. Worker crea sesión.
9. UI muestra QR/código cuando corresponda.
10. Cliente vincula desde WhatsApp.
11. Worker reporta `connected`.
12. Credenciales/auth state se persisten cifradas.
13. Sistema hace health test.
14. Cuenta pasa a `active`.
15. Se registra Audit Event.

Si falla:
- mostrar error accionable;
- permitir reintentar;
- no dejar worker huérfano.

---

# 83. Política de workers WhatsApp

## 83.1 Unidad de aislamiento

Cada ChannelAccount debe poder reiniciarse independientemente.

No es obligatorio un contenedor por cuenta en MVP, pero la arquitectura no debe impedir:

- worker pool;
- sharding;
- asignación de sesión a worker.

## 83.2 Worker ownership

Guardar lease/ownership para evitar dos workers controlando la misma sesión simultáneamente.

## 83.3 Reconnect

Backoff.

No loop agresivo.

## 83.4 Health

Estados:

- provisioning;
- qr_required;
- connected;
- reconnecting;
- degraded;
- disconnected;
- auth_failed;
- suspended.

---

# 84. Sincronización y consistencia de mensajes

## 84.1 Regla de escritura

Guardar mensaje antes/después del envío según estrategia transaccional y registrar estados:

- queued;
- sending;
- sent;
- delivered;
- read;
- failed.

## 84.2 Echo de mensajes fromMe

Si un provider devuelve el mismo mensaje enviado por nuestra app:

- correlacionar por provider id/client id;
- no duplicar;
- actualizar estado.

## 84.3 Mensaje externo humano

Si llega `fromMe` pero no corresponde a un outbound conocido:

- origin = human_external_device;
- registrar;
- aplicar política de takeover.

---

# 85. Automatización de conversaciones

Antes de auto-responder:

1. tenant activo;
2. channel activo;
3. módulo activo;
4. conversación no HUMAN;
5. horario/política si aplica;
6. no existe bloqueo;
7. regla aplicable;
8. acción autorizada;
9. idempotencia.

Si no existe coincidencia segura:

- fallback configurable;
- solicitar aclaración;
- escalar;
- IA opcional.

---

# 86. Niveles de autonomía generales

No sólo cotizaciones.

## Level 0 — Manual

La plataforma registra y organiza.

## Level 1 — Suggest

Sugiere, nunca ejecuta cambios externos sin aprobación.

## Level 2 — Guarded Automation

Ejecuta bajo reglas/umbrales.

## Level 3 — Full Automation

Ejecuta flujo completo sólo dentro de capacidades expresamente habilitadas.

Autonomía puede configurarse por:

- módulo;
- action type;
- organization unit;
- proceso;
- importe;
- riesgo.

---

# 87. Aprobaciones

Una aprobación interna se modelará preferentemente como Action Request especializada.

Ejemplo:

```text
type = approval
recipient = role:commercial_manager
related = quote:Q293
```

Reglas:
- no auto-aprobar al mismo actor cuando segregation of duties esté activa;
- conservar actor/fecha;
- conservar snapshot de lo aprobado.

---

# 88. SLA y escalaciones — preparado desde modelo

Aunque no sea requisito completo del MVP, Process/Conversation deben permitir:

- due_at;
- SLA policy;
- escalation level;
- breached_at.

Reglas futuras:

```text
if conversation waiting > 30m → supervisor
if process status 3d → escalation
```

---

# 89. Search y consulta

Desde el MVP se debe considerar búsqueda por:

- nombre;
- teléfono;
- email;
- referencia;
- expediente;
- pedido;
- cotización;
- matrícula;
- custom fields indexables.

No depender de IA para buscar IDs deterministas.

---

# 90. Reglas sobre datos sensibles

## 90.1 Minimización

No enviar a proveedores externos información que la tarea no necesita.

## 90.2 Configurable, pero no contra términos

El propietario puede configurar providers permitidos, pero la plataforma debe respetar las restricciones oficiales del provider/modelo.

## 90.3 Logs

Nunca registrar API keys, auth state o documentos completos en logs.

## 90.4 Datos de salud/legal

El producto genérico puede soportar flujos de estos sectores, pero certificaciones/regulaciones específicas deben evaluarse antes de vender capacidades que impliquen obligaciones legales especiales.

---

# 91. AI Router — algoritmo conceptual

No fijar nombres de modelos en código de negocio.

Una tarea declara:

```text
task_type
minimum_capability
latency_class
cost_class
data_classification
structured_output_required
```

Router:

1. obtiene providers activos;
2. filtra por política;
3. filtra por capacidad;
4. filtra health/cooldown;
5. ordena por policy/score;
6. ejecuta;
7. valida salida;
8. fallback si corresponde;
9. registra usage.

Para extracción estructurada:
- JSON schema;
- validation;
- retry/fallback;
- nunca aplicar una mutación crítica con JSON inválido.

---

# 92. Uso de múltiples API keys

## 92.1 Pool

Una integración puede tener múltiples credentials.

## 92.2 Política

Sólo:
- balanceo legítimo;
- separación por tenant;
- cuentas autorizadas;
- failover permitido.

No:
- evasión de límites;
- abuso de trials;
- violación de TOS.

## 92.3 Health

Cada credential puede estar:
- healthy;
- cooling_down;
- disabled;
- invalid.

---

# 93. Backups — runbook preciso

## 93.1 Frecuencia

Pendiente de fijar. Recomendación operacional inicial: al menos diaria cuando haya clientes reales, y mayor frecuencia para DB si el RPO comercial lo exige.

## 93.2 Nombres

No depender de renombrado remoto como única fuente de orden.

Manifest contiene timestamp/ID.

## 93.3 Verify

La verificación mínima incluye:
- upload completed;
- remote size;
- checksum local/remoto cuando sea posible;
- decrypt test de manifest;
- registro en DB.

## 93.4 Restore drill

Periódicamente:
- descargar backup anterior/no productivo;
- descifrar;
- restaurar DB aislada;
- ejecutar smoke checks.

Un backup no probado no se considera garantía de recuperación.

---

# 94. Disaster Recovery

Escenario: falla el servidor principal.

Procedimiento objetivo:

1. obtener servidor reemplazo;
2. instalar Docker/cloudflared;
3. recuperar secrets fuera de backup cuando corresponda;
4. descargar backup Drive;
5. verificar checksum;
6. descifrar;
7. restaurar PostgreSQL/storage;
8. desplegar la misma release;
9. iniciar Redis/workers;
10. validar tenant isolation;
11. validar canales;
12. re-vincular únicamente las cuentas que lo requieran;
13. reanudar.

Objetivos RPO/RTO comerciales se definirán por plan cuando haya datos reales.

---

# 95. Dedicated/on-premise — mantenimiento sin forks

## 95.1 Artefactos

Distribuir:
- Docker images versionadas;
- compose/helm futuro si aplica;
- migration bundle;
- config schema.

## 95.2 Config

Separar:
- `.env`/secret manager;
- tenant configuration en DB;
- deployment config.

## 95.3 Upgrade

1. check compatibility;
2. backup;
3. pull target images;
4. migrations;
5. health;
6. rollback plan.

## 95.4 Customización

Custom config se conserva fuera de imagen.

Nunca editar manualmente código dentro del servidor del cliente.

---

# 96. Source control y CI/CD

Pipeline mínimo futuro:

- lint;
- types;
- unit;
- integration;
- tenant isolation tests;
- build;
- image scan;
- Docker image;
- tag;
- staging;
- migration check;
- release.

Branches:
- `main` protegida;
- feature branches;
- release tags.

No usar branches permanentes por cliente.

---

# 97. Configuración y schemas

Toda configuración compleja debe:

- tener schema;
- versionarse;
- validarse;
- migrarse.

Ejemplos:
- branding config;
- channel settings;
- provider settings;
- process fields;
- rule definitions;
- AI policy.

Evitar JSON arbitrario imposible de migrar.

---

# 98. Auditoría vs Timeline

No son lo mismo.

## Audit Log

Para seguridad/operación:
- quién cambió permiso;
- quién borró;
- quién configuró provider.

## Timeline

Para contexto de negocio:
- expediente cambió;
- documento recibido;
- llamada/cita.

Un evento puede generar ambos.

---

# 99. Eliminación y retención

No implementar hard-delete indiscriminado.

Definir:
- soft delete donde convenga;
- retention policy;
- purge job;
- audit.

Tenant deletion requiere proceso controlado.

---

# 100. Importación/exportación

Futuro temprano:

- CSV contacts;
- CSV products;
- export processes;
- export tenant data según plan.

Import:
- validate;
- preview;
- mapping;
- error report;
- idempotency.

---

# 101. Localización

Desde diseño:

- locale;
- timezone;
- currency.

Fechas se almacenan adecuadamente y se presentan en timezone tenant/unit/user.

No hardcodear `America/Mexico_City` en producto, aunque sea mercado inicial.

---

# 102. Numeración documental

Cotizaciones/procesos pueden requerir secuencias por:

- tenant;
- unit;
- año;
- tipo.

Ejemplo:
`Q-LEON-2026-000123`.

Debe ser configurable sin afectar IDs internos.

---

# 103. Notificaciones

Notification Engine desacoplado.

Targets:
- WhatsApp;
- in-app;
- email futuro;
- webhook.

Notification record:
- event;
- recipient;
- channel;
- status;
- attempts.

---

# 104. Business Hours

Entidad/config para:
- horarios;
- feriados;
- timezone;
- exceptions.

Uso:
- auto reply;
- SLA;
- agenda;
- escalación.

---

# 105. Respuestas rápidas y conocimiento básico

Automatización básica de WhatsApp necesita:

- FAQ;
- snippets;
- canned replies;
- menu opcional;
- reglas de palabras/frases;
- horarios;
- información de servicios/productos.

La IA puede mejorar búsqueda, pero no es necesaria.

---

# 106. Customer Action Required — UX

En dashboard:

```text
Acciones pendientes
- Cliente Juan: subir comprobante — vence mañana
- Gerencia: aprobar cotización Q-88
```

En portal:
- tarjeta destacada;
- CTA claro;
- estado;
- fecha límite.

En WhatsApp:
- mensaje;
- documento/botón/flujo según provider y capacidades;
- confirmación al completar.

---

# 107. Public Timeline — reglas

Nunca publicar automáticamente notas internas.

Cada Event Type debe declarar default visibility.

Recomendación:
- movimientos creados por automations sensibles → internal por defecto;
- movimientos explícitamente de cliente → customer/both según configuración.

---

# 108. Plantilla legal detallada

Preconfiguración sugerida:

Process Definition: Expediente.

Fields:
- número;
- materia;
- juzgado;
- contraparte;
- abogado responsable;
- fecha inicio;
- próxima fecha.

Statuses:
- Apertura;
- Recolección de documentos;
- En preparación;
- Presentado;
- En trámite;
- Pendiente;
- Resolución;
- Cerrado.

Action Requests:
- documento;
- firma;
- confirmación;
- pago futuro.

Portal:
- status;
- public timeline;
- public docs;
- actions;
- appointments.

---

# 109. Plantilla talleres detallada

Fields:
- vehículo;
- placa;
- VIN;
- marca;
- modelo;
- kilometraje.

Statuses:
- Recibido;
- Diagnóstico;
- Cotización;
- Esperando autorización;
- En reparación;
- Pruebas;
- Listo;
- Entregado.

Rules:
- al generar cotización → Action Request;
- al autorizar → notify technician;
- al quedar listo → notify customer.

---

# 110. Plantilla dental/médica básica

Core:
- Contact;
- appointments;
- services;
- reminders.

Evitar afirmar que sustituye EMR.

Flows:
- solicitar cita;
- elegir servicio;
- disponibilidad;
- confirmar;
- reminders;
- reschedule/cancel.

---

# 111. Plantilla distribución/refacciones

Core:
- contacts;
- companies;
- catalog;
- quote;
- process/pedido;
- statuses;
- WhatsApp.

Flow:
- solicitud;
- extracción de SKU/requisito;
- búsqueda;
- cotización;
- aprobación;
- seguimiento;
- pedido;
- envío.

---

# 112. Prospección alineada al producto

Cuando se busque prospecto para esta plataforma, detectar:

- WhatsApp público;
- catálogo;
- agenda;
- varias sucursales;
- múltiples departamentos;
- formularios;
- “consulta estatus”;
- atención repetitiva;
- documentación;
- cotización frecuente.

No decir al prospecto “tenemos todo”.

Elegir un dolor concreto y mostrar sólo módulos relevantes.

---

# 113. Política de alcance por cliente

Implementación se divide:

## Configuración estándar
No desarrollo:
- branding;
- fields;
- statuses;
- rules;
- templates.

## Integración
Connector existente.

## Extensión reutilizable
Feature nueva al producto.

## Excepción
Plugin aislado y cobrable.

Esto protege margen.

---

# 114. Pricing architecture

No hardcodear plan names en lógica.

Plan y entitlement están en DB/config.

Esto permite:
- cambiar precios;
- crear promos;
- grandfathering;
- custom enterprise.

Usage counters no deben bloquear operaciones críticas sin política clara; por ejemplo, al superar storage puede avisar antes de cortar.

---

# 115. Billing futuro

Entidades preparables:

- Subscription;
- Invoice reference;
- PlanAssignment;
- UsageRecord.

Pero el MVP puede cobrar fuera de la app.

No construir billing completo antes de tener ventas.

---

# 116. Modo soporte de plataforma

Super Admin no debe entrar silenciosamente a tenant.

Si se implementa impersonation:
- permiso especial;
- banner;
- audit;
- motivo;
- duración;
- opcionalmente aprobación del tenant en planes sensibles.

---

# 117. Seguridad de portal

Links públicos:
- tokens aleatorios;
- expiración;
- scope a una acción;
- revocables.

No usar IDs incrementales como autorización.

---

# 118. Carga de archivos

Validar:
- size;
- MIME;
- extensión;
- tenant quota.

Futuro:
- antivirus;
- content scanning.

Nombre original no se usa como path físico.

---

# 119. Estado de conversación vs estado de proceso

No mezclar.

Una conversación puede cerrarse mientras el proceso sigue abierto.

Un proceso puede tener varias conversaciones.

---

# 120. Estado del contacto vs cliente

No mezclar:
- lead/contact;
- customer organization;
- process status.

Debe existir relación clara.

---

# 121. Integridad transaccional

Operaciones críticas deben usar transacción DB o patrón outbox cuando eventos externos dependan de commits.

Ejemplo:

```text
Quote approved
DB commit
↓
outbox event
↓
worker sends WhatsApp
```

Evita estado “enviado” sin DB consistente.

El patrón Outbox se recomienda para eventos críticos desde etapas tempranas si el costo es razonable.

---

# 122. Event Bus

MVP puede usar eventos internos + outbox/queue.

Los módulos escuchan eventos de dominio.

No crear dependencias circulares entre módulos.

---

# 123. API conventions

Recomendación:

- version `/api/v1`;
- auth;
- tenant context;
- pagination;
- stable error format;
- idempotency keys para writes críticos;
- OpenAPI.

Ejemplo de recursos:
- `/contacts`;
- `/conversations`;
- `/processes`;
- `/appointments`;
- `/quotes`;
- `/action-requests`.

---

# 124. Webhooks

Cada webhook:
- secret;
- signature;
- retry;
- delivery log;
- disable after repeated failure configurable.

No mandar datos sensibles innecesarios.

---

# 125. Criterio para usar IA vs reglas

Usar regla si:
- condición puede expresarse;
- IDs;
- estados;
- fechas;
- importes;
- permisos.

Usar IA si:
- lenguaje ambiguo;
- texto libre;
- clasificación semántica;
- extracción no estructurada;
- resumen.

Nunca usar IA como sustituto de control de acceso.

---

# 126. Cuotas y costos IA

Registrar por request:
- provider;
- model;
- task;
- tenant;
- tokens/units si provider informa;
- latency;
- estimated cost;
- success.

Permite cobrar/limitar después.

---

# 127. UI de IA para tenant

Configuración:

- enabled;
- allow sensitive classes;
- allowed tasks;
- preferred strategy: low_cost/balanced/high_quality;
- copilot;
- auto response;
- providers disponibles si se expone.

No es necesario exponer todos los detalles técnicos en planes básicos.

---

# 128. Home dashboard por industria

El Home no debe ser idéntico.

Widgets dependen de módulos.

Dental:
- citas hoy;
- confirmaciones;
- no-shows.

Legal:
- expedientes;
- acciones requeridas;
- próximas fechas.

Industrial:
- solicitudes;
- quotes pending;
- orders statuses.

Esto se logra por widget configuration, no forks.

---

# 129. 10 temas documentales — requisitos

Cada tema debe:
- ser legible;
- imprimir correctamente;
- soportar 1+ páginas;
- tablas largas;
- logo horizontal/cuadrado;
- datos fiscales;
- terms;
- firma;
- moneda;
- impuestos.

No diseñar templates que sólo funcionen en demo de una página.

---

# 130. Accesibilidad y responsive

Dashboard:
- desktop prioritario;
- tablet compatible;
- mobile usable para Inbox/approvals.

Customer Portal:
- mobile-first, porque muchos enlaces llegan por WhatsApp.

---

# 131. Performance

Targets iniciales orientativos, no SLA contractual:
- páginas comunes responsivas;
- API típica < razonable sub-second cuando local;
- jobs no bloquean request;
- documentos se renderizan async si son pesados.

Definir métricas antes de optimización prematura.

---

# 132. Capacidad y escalamiento

Escalar por componentes:

- web/api replicas;
- job workers;
- WhatsApp workers;
- DB;
- Redis;
- storage.

No asumir “X clientes por servidor” antes de medir.

Métricas por ChannelAccount serán esenciales para sizing.

---

# 133. Migración futura de infraestructura

Docker permite mover de servidor propio a:
- VPS;
- cloud;
- dedicated.

La migración no debe requerir modificar código del producto.

---

# 134. Google AI Pro

No se considera dependencia de infraestructura.

No asumir que una suscripción de usuario final equivale a créditos/API de backend.

Puede aprovecharse como herramienta de desarrollo/productividad separada, pero la arquitectura comercial debe funcionar sin ella.

---

# 135. Status de decisiones al cierre

## Cerrado

- servidor propio;
- Cloudflare Tunnel;
- PostgreSQL;
- Redis/BullMQ;
- Drive cifrado 2 backups;
- n8n fuera Core;
- Temporal preparado/no MVP;
- multi-tenant;
- dedicated/on-prem;
- Organization Units;
- WhatsApp multi-account;
- Baileys/WPPConnect/Meta adapters;
- human sync;
- origin tracking;
- CRM Lite;
- Process Engine;
- Timeline;
- Action Requests;
- Rules;
- Agenda;
- Quote Engine;
- Document Engine;
- Portal;
- AI optional/router;
- module entitlements;
- Super Admin activation.

## Pendiente de implementación, no de concepto

- ERD físico;
- migrations;
- exact UI design;
- exact auth library;
- exact secrets store;
- final template CSS;
- exact backup cadence;
- final commercial packaging.

---

# 136. Definition of Done para una feature

Una feature no está “terminada” sólo porque funcione en happy path.

DoD:

1. tenant-scoped;
2. permission-checked;
3. validation;
4. errors;
5. audit si aplica;
6. timeline si aplica;
7. tests;
8. docs/config schema;
9. no secrets logs;
10. feature flag/module-aware;
11. migrations;
12. backup compatibility;
13. dedicated deployment compatible.

---

# 137. Handoff checklist para otro desarrollador/IA

Antes de modificar producto, el nuevo responsable debe leer:

1. secciones 1–5;
2. arquitectura deployment;
3. tenancy;
4. módulos;
5. Process/Rules/Actions;
6. WhatsApp abstraction;
7. AI principles;
8. backup/security;
9. roadmap;
10. decisiones descartadas.

Debe evitar:
- crear un fork;
- crear una vertical rígida;
- saltarse tenant_id;
- meter IA en writes deterministas;
- depender directamente de Baileys en dominio;
- depender directamente de BullMQ en dominio.

---

# 138. Registro de decisiones inicial

| ID | Decisión | Estado |
|---|---|---|
| ADR-001 | Un único repositorio/producto | Aprobada |
| ADR-002 | Multi-tenant como modalidad principal | Aprobada |
| ADR-003 | Dedicated/on-prem usan mismo release | Aprobada |
| ADR-004 | PostgreSQL source of truth | Aprobada |
| ADR-005 | Redis/BullMQ ejecución, no verdad crítica | Aprobada |
| ADR-006 | WhatsApp adapter abstraction | Aprobada |
| ADR-007 | Baileys provider inicial | Aprobada |
| ADR-008 | WPPConnect segundo provider | Aprobada |
| ADR-009 | Meta provider oficial futuro | Aprobada |
| ADR-010 | Process Engine genérico | Aprobada |
| ADR-011 | Rules Engine propio | Aprobada |
| ADR-012 | Action Request como primitive Core | Aprobada |
| ADR-013 | IA opcional y multi-provider | Aprobada |
| ADR-014 | n8n fuera del motor Core | Aprobada |
| ADR-015 | Temporal preparado, no MVP | Aprobada |
| ADR-016 | Backup Drive cifrado, retención 2 | Aprobada |
| ADR-017 | Infra principal en servidor propio | Aprobada |
| ADR-018 | Cloudflare Tunnel para exposición | Aprobada |
| ADR-019 | Super Admin administra módulos/entitlements | Aprobada |
| ADR-020 | Organization Units jerárquicas | Aprobada |
| ADR-021 | Human responses sincronizadas y clasificadas | Aprobada |
| ADR-022 | Quote autonomy controlada por reglas | Aprobada |
| ADR-023 | Customer Portal genérico | Aprobada |
| ADR-024 | Plantillas de industria son configuración | Aprobada |

---

# 139. Nota de actualización de tecnologías externas

Baileys, WPPConnect, Meta, OpenCode, modelos IA y políticas de terceros son dependencias externas que pueden cambiar.

Regla:
- no congelar decisiones comerciales sobre un endpoint/modelo específico;
- verificar documentación oficial antes de major upgrade;
- mantener adapters;
- documentar cambios en ADR.

---

# 140. Estado de este documento

Este PRD reúne las decisiones funcionales, arquitectónicas, operativas y comerciales tomadas hasta el corte indicado.

Es suficientemente específico para:
- iniciar diseño técnico;
- construir backlog;
- crear ERD;
- comenzar MVP;
- continuar con otro desarrollador;
- continuar con otra IA.

No pretende sustituir:
- ERD físico;
- OpenAPI;
- threat model;
- contratos legales;
- historias de usuario detalladas;
- manual de operación.

Esos artefactos deben derivarse de este PRD y referenciarlo.

---

**FIN DEL PRD MAESTRO — Versión 1.0-draft-cimentado**
