// app.js — datos demo y utilidades compartidas (fixtures ficticios, no producción)
// UI_FLOWS §53: dataset consistente para demo (taller, despacho, clínica, distribuidor)

(function () {
  'use strict';

  const POS_KEY = 'od-wabot-nav';
  function setNav(view) { try { localStorage.setItem(POS_KEY, view); } catch (e) {} }
  function getNav() { try { return localStorage.getItem(POS_KEY) || 'home'; } catch (e) { return 'home'; } }

  function el(id) { return document.getElementById(id); }
  function setBadge(node, text) { if (node) node.textContent = text; }

  // ===== Entitlements: 14 capacidades (§4 del spec) =====
  const CAPABILITIES = [
    { id: 'messaging-basic',      label: 'Messaging Basic',      desc: 'Inbox + conversaciones + Automation Mode.' },
    { id: 'automation-basic',     label: 'Automation Basic',      desc: 'Reglas declarativas por evento (NOT, THEN).' },
    { id: 'automation-advanced',  label: 'Automation Advanced',   desc: 'Reglas con ramas condicionales, pausas y timeouts.' },
    { id: 'crm-lite',              label: 'CRM Lite',              desc: 'Contactos + vista 360 + tags + timelines.' },
    { id: 'processes',             label: 'Processes',             desc: 'Board con pasos por proceso y asignación.' },
    { id: 'action-requests',       label: 'Action Requests',       desc: 'Cola de aprobaciones con SLA y vencimientos.' },
    { id: 'agenda',                label: 'Agenda',                desc: 'Calendario + citas + recordatorios automáticos.' },
    { id: 'catalog',               label: 'Catalog',              desc: 'Productos y servicios con precios y stock.' },
    { id: 'quotes',               label: 'Quotes',               desc: 'Editor de cotizaciones con preview y versiones.' },
    { id: 'documents',            label: 'Documents',             desc: 'Generación de documentos (PDF, DOCX) desde plantillas.' },
    { id: 'customer-portal',       label: 'Customer Portal',       desc: 'Portal del cliente con seguimiento de procesos.' },
    { id: 'ai',                    label: 'AI',                    desc: 'Asistencia de redacción y resúmenes con IA.' },
    { id: 'integrations',          label: 'Integrations',          desc: 'Webhooks y conectores con sistemas externos.' },
    { id: 'white-label',           label: 'White Label',           desc: 'Logo + nombre personalizado para planes superiores.' }
  ];

  // ===== Demo data (ficticios) =====
  const tenants = [
    {
      name: 'Talleres Motor Norte', slug: 'motor-norte',
      plan: 'Messaging Basic + Automation Basic + CRM Lite',
      channels: 2, channelsLimit: 3, users: 9, usersLimit: 15,
      status: 'active', health: 'healthy',
      deployment: 'Shared',
      ouLimit: 10, storageLimitGb: 10, aiBudgetUsd: 0,
      created: '2026-05-12', lastActivity: '12 min',
      entitlements: {
        'messaging-basic': { enabled: true, limit: 3, source: 'Plan', validity: 'Renueva 2026-12-01' },
        'automation-basic': { enabled: true, limit: null, source: 'Plan', validity: 'Renueva 2026-12-01' },
        'automation-advanced': { enabled: false, limit: null, source: '—', validity: '—' },
        'crm-lite': { enabled: true, limit: null, source: 'Plan', validity: 'Renueva 2026-12-01' },
        'processes': { enabled: false, limit: null, source: '—', validity: '—' },
        'action-requests': { enabled: false, limit: null, source: '—', validity: '—' },
        'agenda': { enabled: false, limit: null, source: '—', validity: '—' },
        'catalog': { enabled: false, limit: null, source: '—', validity: '—' },
        'quotes': { enabled: false, limit: null, source: '—', validity: '—' },
        'documents': { enabled: false, limit: null, source: '—', validity: '—' },
        'customer-portal': { enabled: false, limit: null, source: '—', validity: '—' },
        'ai': { enabled: false, limit: null, source: '—', validity: '—' },
        'integrations': { enabled: false, limit: null, source: '—', validity: '—' },
        'white-label': { enabled: false, limit: null, source: '—', validity: '—' }
      },
      owner: { name: 'Ana López', email: 'ana.lopez@motor-norte.mx', role: 'Tenant Owner' }
    },
    {
      name: 'Bufete Álvarez & Peña', slug: 'bufete-alvarez',
      plan: 'Documents + Processes + Action Requests + Customer Portal',
      channels: 1, channelsLimit: 3, users: 6, usersLimit: 10,
      status: 'active', health: 'degraded',
      deployment: 'Shared',
      ouLimit: 8, storageLimitGb: 20, aiBudgetUsd: 0,
      created: '2026-06-02', lastActivity: '1 h',
      entitlements: {
        'messaging-basic': { enabled: false, limit: null, source: '—', validity: '—' },
        'automation-basic': { enabled: false, limit: null, source: '—', validity: '—' },
        'automation-advanced': { enabled: false, limit: null, source: '—', validity: '—' },
        'crm-lite': { enabled: false, limit: null, source: '—', validity: '—' },
        'processes': { enabled: true, limit: null, source: 'Plan', validity: 'Renueva 2026-12-01' },
        'action-requests': { enabled: true, limit: null, source: 'Plan', validity: 'Renueva 2026-12-01' },
        'agenda': { enabled: false, limit: null, source: '—', validity: '—' },
        'catalog': { enabled: false, limit: null, source: '—', validity: '—' },
        'quotes': { enabled: false, limit: null, source: '—', validity: '—' },
        'documents': { enabled: true, limit: null, source: 'Plan', validity: 'Renueva 2026-12-01' },
        'customer-portal': { enabled: true, limit: null, source: 'Plan', validity: 'Renueva 2026-12-01' },
        'ai': { enabled: false, limit: null, source: '—', validity: '—' },
        'integrations': { enabled: false, limit: null, source: '—', validity: '—' },
        'white-label': { enabled: false, limit: null, source: '—', validity: '—' }
      },
      owner: { name: 'Roberto Álvarez', email: 'roberto.alvarez@bufete-alvarez.mx', role: 'Tenant Owner' }
    },
    {
      name: 'Clínica Integral Valle', slug: 'clinica-valle',
      plan: 'Messaging Basic + Agenda',
      channels: 3, channelsLimit: 3, users: 19, usersLimit: 25,
      status: 'active', health: 'healthy',
      deployment: 'Shared',
      ouLimit: 12, storageLimitGb: 15, aiBudgetUsd: 0,
      created: '2026-03-21', lastActivity: '4 min',
      entitlements: {
        'messaging-basic': { enabled: true, limit: 3, source: 'Plan', validity: 'Renueva 2026-12-01' },
        'automation-basic': { enabled: false, limit: null, source: '—', validity: '—' },
        'automation-advanced': { enabled: false, limit: null, source: '—', validity: '—' },
        'crm-lite': { enabled: false, limit: null, source: '—', validity: '—' },
        'processes': { enabled: false, limit: null, source: '—', validity: '—' },
        'action-requests': { enabled: false, limit: null, source: '—', validity: '—' },
        'agenda': { enabled: true, limit: null, source: 'Plan', validity: 'Renueva 2026-12-01' },
        'catalog': { enabled: false, limit: null, source: '—', validity: '—' },
        'quotes': { enabled: false, limit: null, source: '—', validity: '—' },
        'documents': { enabled: false, limit: null, source: '—', validity: '—' },
        'customer-portal': { enabled: false, limit: null, source: '—', validity: '—' },
        'ai': { enabled: false, limit: null, source: '—', validity: '—' },
        'integrations': { enabled: false, limit: null, source: '—', validity: '—' },
        'white-label': { enabled: false, limit: null, source: '—', validity: '—' }
      },
      owner: { name: 'Dra. Elena Valle', email: 'elena.valle@clinica-valle.mx', role: 'Tenant Owner' }
    },
    {
      name: 'Distribuidora FERCOMEX', slug: 'fercomex',
      plan: 'Messaging Basic + CRM Lite + Catalog + Quotes',
      channels: 1, channelsLimit: 5, users: 12, usersLimit: 20,
      status: 'suspended', health: 'healthy',
      deployment: 'Shared',
      ouLimit: 10, storageLimitGb: 10, aiBudgetUsd: 0,
      created: '2026-01-15', lastActivity: '5 d',
      entitlements: {
        'messaging-basic': { enabled: true, limit: 5, source: 'Plan', validity: 'Suspendido por impago' },
        'automation-basic': { enabled: false, limit: null, source: '—', validity: '—' },
        'automation-advanced': { enabled: false, limit: null, source: '—', validity: '—' },
        'crm-lite': { enabled: true, limit: null, source: 'Plan', validity: 'Suspendido por impago' },
        'processes': { enabled: false, limit: null, source: '—', validity: '—' },
        'action-requests': { enabled: false, limit: null, source: '—', validity: '—' },
        'agenda': { enabled: false, limit: null, source: '—', validity: '—' },
        'catalog': { enabled: true, limit: null, source: 'Plan', validity: 'Suspendido por impago' },
        'quotes': { enabled: true, limit: null, source: 'Plan', validity: 'Suspendido por impago' },
        'documents': { enabled: false, limit: null, source: '—', validity: '—' },
        'customer-portal': { enabled: false, limit: null, source: '—', validity: '—' },
        'ai': { enabled: false, limit: null, source: '—', validity: '—' },
        'integrations': { enabled: false, limit: null, source: '—', validity: '—' },
        'white-label': { enabled: false, limit: null, source: '—', validity: '—' }
      },
      owner: { name: 'Manuel Ferreyra', email: 'manuel.ferreyra@fercomex.mx', role: 'Tenant Owner' }
    },
    {
      name: 'Servicios Atlas QA', slug: 'atlas-qa',
      plan: 'Messaging Basic',
      channels: 1, channelsLimit: 2, users: 4, usersLimit: 5,
      status: 'provisioning', health: 'healthy',
      deployment: 'Shared',
      ouLimit: 5, storageLimitGb: 5, aiBudgetUsd: 0,
      created: '2026-08-09', lastActivity: 'just now',
      entitlements: {
        'messaging-basic': { enabled: true, limit: 2, source: 'Plan', validity: 'Trial 30 días' },
        'automation-basic': { enabled: false, limit: null, source: '—', validity: '—' },
        'automation-advanced': { enabled: false, limit: null, source: '—', validity: '—' },
        'crm-lite': { enabled: false, limit: null, source: '—', validity: '—' },
        'processes': { enabled: false, limit: null, source: '—', validity: '—' },
        'action-requests': { enabled: false, limit: null, source: '—', validity: '—' },
        'agenda': { enabled: false, limit: null, source: '—', validity: '—' },
        'catalog': { enabled: false, limit: null, source: '—', validity: '—' },
        'quotes': { enabled: false, limit: null, source: '—', validity: '—' },
        'documents': { enabled: false, limit: null, source: '—', validity: '—' },
        'customer-portal': { enabled: false, limit: null, source: '—', validity: '—' },
        'ai': { enabled: false, limit: null, source: '—', validity: '—' },
        'integrations': { enabled: false, limit: null, source: '—', validity: '—' },
        'white-label': { enabled: false, limit: null, source: '—', validity: '—' }
      },
      owner: { name: 'Sergio Peña', email: 'sergio.pena@atlas-qa.mx', role: 'Tenant Owner' }
    }
  ];

  const channels = [
    { name: 'Ventas — Línea principal', channel: 'WhatsApp', provider: 'Baileys', phone: '+52 477 123 4567', unit: 'León · Ventas', state: 'connected', health: 'healthy', lastConnected: '12 min', lastInbound: '3 min', lastOutbound: '5 min' },
    { name: 'Soporte — Mesa de ayuda',   channel: 'WhatsApp', provider: 'Baileys', phone: '+52 477 987 6543', unit: 'León · Atención', state: 'degraded', health: 'requires-reauth', lastConnected: '2 h', lastInbound: '15 min', lastOutbound: '—' },
    { name: 'Querétaro — Atención',      channel: 'WhatsApp', provider: 'Baileys', phone: '+52 442 555 7788', unit: 'Querétaro · Ventas', state: 'connected', health: 'healthy', lastConnected: '4 h', lastInbound: '40 min', lastOutbound: '38 min' }
  ];

  const conversations = [
    { name: 'María Salcedo', phone: '+52 477 220 1188', preview: 'Buen día, ¿queda confirmada mi cita del jueves?', time: '09:42', unread: 2, mode: 'HUMAN', channel: 0, assignee: 'Ana López', tag: 'Requiere humano', channelAccount: 'Ventas — Línea principal' },
    { name: 'José Miranda',  phone: '+52 442 410 7766', preview: 'BOT: ¿Con qué tipo de servicio te puedo apoyar? 1. Cita 2. Cotización', time: '09:38', unread: 0, mode: 'AUTO', channel: 1, assignee: '—', tag: 'Menú bot', channelAccount: 'Soporte — Mesa de ayuda' },
    { name: 'Comercial PyME', phone: '+52 477 555 3102', preview: 'Envío la póliza firmada apenas la tenga.', time: '09:21', unread: 1, mode: 'ASSISTED', channel: 0, assignee: 'Luis Treviño', tag: 'Cotización', channelAccount: 'Ventas — Línea principal' },
    { name: 'Fernando Ruiz', phone: '+52 55 1345 2204', preview: 'Ok, perfecto. Lo reviso y aviso.', time: '09:05', unread: 0, mode: 'AUTO', channel: 1, assignee: '—', tag: 'Cerrada', channelAccount: 'Soporte — Mesa de ayuda' },
    { name: 'Hardware del Bajío', phone: '+52 472 710 9933', preview: '¿Tienen en stock el filtro ACE-22?', time: '08:51', unread: 1, mode: 'HUMAN', channel: 0, assignee: 'Ana López', tag: 'Inbound', channelAccount: 'Ventas — Línea principal' },
    { name: 'Patricia Núñez', phone: '+52 442 612 0040', preview: 'BOT: Tu cotización COT-2026-0114 fue enviada hoy.', time: '08:30', unread: 0, mode: 'AUTO', channel: 1, assignee: '—', tag: 'Notificación', channelAccount: 'Querétaro — Atención' }
  ];

  const contacts = [
    { name: 'María Salcedo', phone: '+52 477 220 1188', email: 'maria.salcedo@example.com', org: 'Salcedo Asociados', tags: 'Cotización', lastActivity: 'hoy', activeProcesses: 1 },
    { name: 'Fernando Ruiz', phone: '+52 55 1345 2204', email: 'fernando.ruiz@example.com', org: '—', tags: 'Cliente recurrente', lastActivity: 'hoy', activeProcesses: 0 },
    { name: 'Hardware del Bajío', phone: '+52 472 710 9933', email: 'compras@hardwarebajío.mx', org: 'Hardware del Bajío', tags: 'Distribuidor', lastActivity: 'hoy', activeProcesses: 2 },
    { name: 'José Miranda', phone: '+52 442 410 7766', email: '—', org: '—', tags: 'Soporte', lastActivity: '1 d', activeProcesses: 0 },
    { name: 'Patricia Núñez', phone: '+52 442 612 0040', email: 'patricia.nunez@example.com', org: '—', tags: 'Cotización', lastActivity: '1 h', activeProcesses: 1 }
  ];

  const rules = [
    { name: 'Asignar nueva conversación a Ventas', trigger: 'Inbound nuevo sin asignar', module: 'Messaging', enabled: true, last: 'hace 3 min', success: 1842, failure: 2, version: 3 },
    { name: 'Menú de bienvenida por horario', trigger: 'Conversación iniciada', module: 'Messaging', enabled: true, last: 'hace 12 min', success: 4005, failure: 11, version: 2 },
    { name: 'Escalar a humano por palabra clave', trigger: 'Inbound contiene "urgente/supervisor"', module: 'Messaging', enabled: false, last: 'hace 4 d', success: 56, failure: 3, version: 1 }
  ];

  // Infraestructura: datos consistentes (no stal-stable, no us-east-1, no "7 retenciones", no Portal CDN)
  const platformInfo = {
    version: '0.1.0-demo',
    commit: 'a91f2c3',
    deployedAt: '2026-08-08',
    deployments: { shared: { healthy: true }, dedicated: { healthy: true }, onpremise: { healthy: true }, staging: { healthy: true } },
    backupLastVerified: '03:00',
    backupRetentions: 2,
    storageUsedGb: 412,
    storageTotalGb: 680
  };

  window.OD = Object.assign(window.OD || {}, {
    setNav, getNav, el, setBadge,
    tenants, channels, conversations, contacts, rules,
    CAPABILITIES, platformInfo
  });
})();
