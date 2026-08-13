// shell.js — Inyecta sidebar + topbar reutilizable para pantallas de Tenant y de Platform.
// Module gating: los items del sidebar de tenant se filtran según entitlements habilitados.
// Uso: tras cargar body con <div data-shell="tenant|platform" data-active="home"></div>
'use strict';

(function () {
  function svg(path) {
    return '<svg class="nav-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  const ICONS = {
    home: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v11h14V10"/>'),
    inbox: svg('<path d="M4 4h16v11H10l-3 3v-3H4z"/>'),
    contacts: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>'),
    processes: svg('<rect x="3" y="4" width="6" height="7"/><rect x="14" y="4" width="7" height="7"/><rect x="9" y="14" width="6" height="6"/>'),
    actions: svg('<path d="M12 4v8l5 3"/><circle cx="12" cy="12" r="9"/>'),
    agenda: svg('<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 9h18M8 3v4M16 3v4"/>'),
    catalog: svg('<rect x="3" y="4" width="7" height="7"/><rect x="14" y="4" width="7" height="7"/><rect x="3" y="14" width="7" height="6"/><rect x="14" y="14" width="7" height="6"/>'),
    quotes: svg('<path d="M6 4h8l4 4v12H6z"/><path d="M9 12h6M9 16h4"/>'),
    docs: svg('<path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6"/>'),
    portal: svg('<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 9h16"/>'),
    automations: svg('<path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="4"/>'),
    channels: svg('<path d="M5 7c5-3 9-3 14 0M5 11c5-2 9-2 14 0M5 15c5-1 9-1 14 0"/>'),
    integrations: svg('<rect x="3" y="4" width="8" height="6"/><rect x="13" y="14" width="8" height="6"/><path d="M11 7h10v13M13 17H3V4"/>'),
    reports: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    users: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M17 11l2 2 4-4"/>'),
    settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.4.9a7 7 0 0 0-2.3-1.3L14 3h-4l-.2 2.4a7 7 0 0 0-2.3 1.3l-2.4-.9-2 3.4 2 1.5A7 7 0 0 0 5 12s.1.9.1 1.3l-2 1.5 2 3.4 2.4-.9a7 7 0 0 0 2.3 1.3L10 21h4l.2-2.4a7 7 0 0 0 2.3-1.3l2.4.9 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z"/>'),
    platform: svg('<path d="M2 7l10-4 10 4-10 4z"/><path d="M2 12l10 4 10-4M2 17l10 4 10-4"/>'),
    tenants: svg('<rect x="3" y="4" width="7" height="7"/><rect x="14" y="4" width="7" height="7"/><rect x="3" y="14" width="7" height="6"/><rect x="14" y="14" width="7" height="6"/>'),
    bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 2 8 2 8H4s2-1 2-8z"/><path d="M10 21a2 2 0 0 0 4 0"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
    logout: svg('<path d="M16 4h4v16h-4M10 12H3M7 8l-4 4 4 4"/>'),
    menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>')
  };

  // Tenant nav: cada item indica el entitlement requerido. Items sin `ent` son siempre visibles.
  // Los módulos deshabilitados NO aparecen en la navegación.
  const TENANT_NAV = [
    { group: 'Operación', items: [
      { id: 'home',       label: 'Inicio',                href: 'tenant-home.html' },
      { id: 'inbox',      label: 'Inbox',                 href: 'inbox.html', count: 5,  ent: 'messaging-basic' },
      { id: 'contacts',   label: 'Contactos',             href: 'contacts.html',           ent: 'crm-lite' },
      { id: 'processes',  label: 'Procesos',              href: '#',                       ent: 'processes' },
      { id: 'actions',    label: 'Acciones requeridas',   href: '#',                       ent: 'action-requests' },
      { id: 'agenda',     label: 'Agenda',                href: '#',                       ent: 'agenda' },
      { id: 'catalog',    label: 'Catálogo',               href: '#',                       ent: 'catalog' },
      { id: 'quotes',     label: 'Cotizaciones',           href: '#',                       ent: 'quotes' },
      { id: 'docs',       label: 'Documentos',             href: '#',                       ent: 'documents' },
      { id: 'portal',     label: 'Portal del cliente',     href: '#',                       ent: 'customer-portal' }
    ]},
    { group: 'Configuración', items: [
      { id: 'automations',   label: 'Automatizaciones',      href: 'rules.html' },
      { id: 'channels',      label: 'Canales',                href: 'channels.html',          ent: 'messaging-basic' },
      { id: 'integrations',  label: 'Integraciones',         href: '#',                       ent: 'integrations' },
      { id: 'reports',       label: 'Reportes' },
      { id: 'users',         label: 'Usuarios y organización', href: 'users-org.html' },
      { id: 'settings',      label: 'Configuración' }
    ]}
  ];

  const PLATFORM_NAV = [
    { group: 'Platform Control', items: [
      { id: 'sa-dashboard', label: 'Dashboard', href: 'super-admin-dashboard.html' },
      { id: 'sa-tenants', label: 'Tenants', href: 'super-admin-tenants.html' },
      { id: 'sa-create', label: 'Crear tenant', href: 'super-admin-create-tenant.html' },
      { id: 'sa-detail', label: 'Tenant detail', href: 'super-admin-tenant-detail.html' }
    ]}
  ];

  // Entitlements del tenant activo (Talleres Motor Norte). En demo, se fija del primer fixture.
  function getActiveEntitlements() {
    if (window.OD && window.OD.tenants && window.OD.tenants[0] && window.OD.tenants[0].entitlements) {
      return window.OD.tenants[0].entitlements;
    }
    return {};
  }

  function isEntitlementEnabled(ent, entitlements) {
    if (!ent) return true;
    var e = entitlements[ent];
    return !!e && e.enabled;
  }

  function navItem(item, active) {
    const isActive = item.id === active ? ' nav-item--active' : '';
    const icon = ICONS[item.id in ICONS ? item.id : 'docs'] || ICONS.docs;
    const count = item.count ? '<span class="nav-item__count">' + item.count + '</span>' : '';
    const body = icon + '<span>' + item.label + '</span>' + count;
    if (item.href && item.href !== '#') {
      return '<a class="nav-item' + isActive + '" href="' + item.href + '" data-od-id="' + item.id + '">' + body + '</a>';
    }
    return '<div class="nav-item nav-item--placeholder' + isActive + '" data-od-id="' + item.id + '" aria-disabled="true">' + body + '</div>';
  }

  function filterTenantNav(nav, entitlements) {
    return nav.map(function (g) {
      return {
        group: g.group,
        items: g.items.filter(function (i) { return isEntitlementEnabled(i.ent, entitlements); })
      };
    }).filter(function (g) { return g.items.length > 0; });
  }

  function buildShell(mode, active, topbarHtml) {
    const isPlatform = mode === 'platform';
    let nav = isPlatform ? PLATFORM_NAV : TENANT_NAV;
    if (!isPlatform) nav = filterTenantNav(nav, getActiveEntitlements());
    const brandTitle = isPlatform ? 'WhatsApp Bot · Platform Control' : 'Talleres Motor Norte';
    const brandSub = isPlatform ? 'Super Admin · interno' : 'Tenant Owner';
    const svgLogo = isPlatform
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 7l10-4 10 4-10 4z"/><path d="M2 12l10 4 10-4M2 17l10 4 10-4"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 7c5-3 9-3 14 0M5 11c5-2 9-2 14 0M5 15c5-1 9-1 14 0"/></svg>';
    const navHtml = nav.map(g => '<div class="nav-group"><div class="nav-group__label">' + g.group + '</div>' + g.items.map(i => navItem(i, active)).join('') + '</div>').join('');

    return '<aside class="sidebar' + (isPlatform ? ' sidebar--platform' : '') + '" data-od-id="sidebar">' +
      '<div class="sidebar__brand" data-od-id="brand">' + svgLogo + '<div class="tenant">' + brandTitle + '</div><div class="role">' + brandSub + '</div></div>' +
      '<nav class="sidebar__nav" data-od-id="nav">' + navHtml + '</nav>' +
      '<div class="sidebar__foot"><div class="sidebar__user" data-od-id="user-menu">' +
        '<div style="width:28px;height:28px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;">' + (isPlatform ? 'SA' : 'AN') + '</div>' +
        '<div style="min-width:0"><div style="font-size:12.5px;font-weight:500;line-height:1.2">' + (isPlatform ? 'Sergio Peña' : 'Ana López') + '</div><div class="t-micro">' + (isPlatform ? 'super.admin@platform.io' : 'ana.lopez@motor-norte.mx') + '</div></div>' +
      '</div></div></aside>' +
      '<div style="display:flex;flex-direction:column;min-height:100vh;flex:1"><header class="topbar" data-od-id="topbar">' + (topbarHtml || '') + '</header><main class="content" data-od-id="content"><div id="page-root"></div></main></div>';
  }

  window.ODShell = { buildShell, ICONS, filterTenantNav, getActiveEntitlements, isEntitlementEnabled };
  document.addEventListener('DOMContentLoaded', function () {
    const mount = document.querySelector('[data-shell]');
    if (!mount) return;
    const mode = mount.getAttribute('data-shell');
    const active = mount.getAttribute('data-active') || '';
    const topbarHtml = mount.getAttribute('data-topbar') || '';
    const payload = mount.querySelector('[data-shell-content]');
    const innerHTML = payload ? payload.innerHTML : '';
    const wrapper = document.createElement('div');
    wrapper.className = 'app' + (mode === 'platform' ? ' app--platform' : '');
    wrapper.setAttribute('data-od-id', 'app-shell');
    wrapper.innerHTML = buildShell(mode, active, topbarHtml);
    mount.replaceWith(wrapper);
    const content = wrapper.querySelector('#page-root');
    if (content && innerHTML.trim()) content.innerHTML = innerHTML;
  });
})();
