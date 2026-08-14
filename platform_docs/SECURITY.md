# SECURITY.md — Modelo de seguridad y controles obligatorios

**Versión:** 1.0-draft  
**Fecha:** 2026-08-12  
**Fuentes:** PRD, SYSTEM_DESIGN, SKILL, DATA_MODEL  
**Objetivo:** definir el baseline de seguridad necesario para operar una plataforma multitenant que procesa conversaciones, contactos, documentos, citas, expedientes y potencialmente información sensible.

---

# 1. Principios

1. Deny by default.
2. Least privilege.
3. Tenant isolation es requisito P0.
4. Entitlement no sustituye autorización.
5. UI no sustituye enforcement del servidor.
6. Secrets nunca en Git/logs.
7. PII mínima en logs.
8. Side effects críticos auditables.
9. Datos sensibles hacia IA sólo conforme a policy.
10. Backup cifrado y restore probado.
11. Providers externos se consideran boundaries no confiables.
12. Seguridad debe degradar funcionalidad antes que exponer datos.

---

# 2. Activos críticos

- datos PostgreSQL;
- credenciales de sesión/auth;
- WhatsApp session credentials;
- API keys IA/integraciones;
- documentos/attachments;
- portal access grants;
- backups;
- encryption keys;
- Cloudflare credentials;
- audit trail;
- entitlements/roles.

---

# 3. Trust boundaries

```text
Internet
  ↓
Cloudflare
  ↓
Web/API boundary
  ↓
Application boundary
  ↓
PostgreSQL / Redis / Storage

External providers:
WhatsApp / AI / Google / APIs
```

Todo input externo se valida.

---

# 4. Tenant isolation

Obligatorio:

- tenant derivado de sesión/contexto;
- repositories tenant-aware;
- foreign resources revalidated;
- negative isolation tests;
- unique indexes tenant-scoped;
- storage paths/metadata tenant-scoped;
- background jobs carry tenant context from trusted persisted command;
- never trust tenant_id from webhook/user payload without provider-account resolution.

Un ID válido de Tenant B suministrado por usuario Tenant A debe producir not found/forbidden seguro sin fuga de existencia según contexto.

---

# 5. Authentication

MVP:

- email/password;
- modern password hashing;
- minimum password policy;
- rate limiting;
- lock/cooldown strategy controlada;
- reset token single-use y expirable;
- session revocation;
- user/tenant disabled recheck;
- secure cookies if cookie sessions;
- CSRF protection según architecture.

Super Admin:

- política más estricta;
- MFA altamente recomendado antes de clientes pagados o inmediatamente después según implementación;
- posible Cloudflare Access adicional;
- audit de login/admin actions.

---

# 6. Authorization

Decisión:

```text
entitlement
+ permission
+ org-unit scope
+ resource ownership
+ domain policy
```

Ejemplos sensibles:

- quote approval;
- user/role management;
- channel connect/disconnect;
- tenant entitlement changes;
- document visibility;
- process public updates;
- AI credential/policy;
- portal grant creation.

Baseline Tenant RBAC E02-S05:

- autorización por `PermissionKey`, nunca por nombre de role;
- `UserRole` exige el mismo tenant para User, Role y Organization Unit mediante FKs compuestas;
- templates globales no son asignables directamente;
- el guard tenant-wide sólo cuenta assignments sin OU y grants sin constraints;
- permisos desconocidos fallan cerrados;
- múltiples requirements usan ALL;
- revocaciones se leen desde PostgreSQL en la siguiente request, sin snapshot en `UserSession` ni cache Redis;
- Platform Admin no utiliza Tenant RBAC.

Baseline Entitlements E03-S04:

- Permission y entitlement son controles independientes; cuando una operación exige ambos, cualquiera ausente produce deny;
- `TenantEntitlementGuard` usa exclusivamente el `TenantContext` autenticado, nunca `tenantId`, slug, body, query o headers del caller;
- la vigencia se lee desde PostgreSQL en cada request, sin snapshot en sesión/JWT/contexto ni cache Redis;
- sólo `PlatformAdminSessionGuard` protege mutations de entitlements; Tenant Owner/User no dispone de writer tenant-safe;
- unknown module/limit keys y DTO fields adicionales fallan cerrados;
- config overrides son objetos JSON opacos no secretos, con límites de tamaño/profundidad, reemplazo total y sin contenido completo en Audit/Outbox;
- disable conserva row/config/datos; no dispara borrados, desconexiones ni side effects externos;
- entitlement, Audit y Outbox se escriben atómicamente; futuros workers deben revalidar antes de acciones costosas o riesgosas.

Ver ADR-0017.

---

# 7. Secrets

Nunca guardar plaintext secrets en logs o repositorio.

Tenant-owned credentials in DB:

- application-level encryption;
- encryption key outside DB;
- key id/version metadata;
- future rotation support.

Environment/infrastructure secrets:

- root-owned/limited files or secret injection;
- `.env.example` sólo nombres/placeholders;
- `.env` gitignored.

---

# 8. Messaging credentials

WhatsApp session material es secreto de alta sensibilidad.

- cifrado at rest;
- no exponer en API;
- no mostrar en UI;
- no incluir raw en logs;
- disconnect/revoke flow;
- backup sólo cifrado;
- provider adapter controla serialization.

---

# 9. Input validation

Validar server-side:

- DTO schema;
- enums;
- lengths;
- numeric ranges;
- URLs;
- file sizes/types;
- rule schemas;
- template variables;
- webhook payloads.

Nunca ejecutar input del tenant como código.

---

# 10. Rules Engine

- allowlist actions;
- no eval;
- no arbitrary JS;
- validation at save/publish;
- runtime guards;
- execution limits;
- loop prevention;
- per-tenant quotas future;
- actions recheck entitlement/policy.

---

# 11. Files/uploads

Controls:

- auth/access check before upload;
- max file size;
- allowed/blocked MIME policy;
- MIME sniffing;
- internal random filename;
- original name metadata sanitized;
- hash;
- tenant-scoped storage;
- no execution;
- no public raw path;
- Content-Disposition safe;
- hook for malware scan future;
- image processing must protect against decompression bombs/resource exhaustion.

---

# 12. Document renderer

Potential SSRF/file-read surface.

Controls:

- templates controlled/validated;
- no arbitrary remote URLs from tenant in renderer MVP;
- asset allowlist/local storage;
- resource/time/memory limits;
- isolate process/container if needed;
- sanitize dynamic HTML/content;
- template variables escaped according to context.

---

# 13. Customer Portal

- high entropy grants;
- expiration;
- revocation;
- entity/scope restrictions;
- rate limiting;
- no internal DTO reuse;
- public projection only;
- timeline visibility explicit;
- documents require explicit grant/visibility;
- audit access/completion significant events.

Signed/public links should not contain sensitive raw IDs as the only protection.

---

# 14. Webhooks

Inbound:

- verify signature/secret when provider supports;
- timestamp/replay controls where possible;
- idempotency;
- body limits;
- fast ack;
- async processing.

Outbound:

- HTTPS;
- secret/HMAC future;
- redact logs;
- SSRF protection for tenant-configured endpoints: block private/link-local/metadata ranges unless explicit trusted configuration;
- connection/read timeouts;
- retry limits.

---

# 15. SSRF

Surfaces:

- webhooks;
- URL imports future;
- document assets;
- integrations.

Default deny access to:

- localhost;
- Docker internal hosts;
- RFC1918/private networks unless explicitly intended;
- link-local;
- cloud metadata endpoints;
- file:// and unsupported schemes.

---

# 16. AI privacy/security

Data classifications:

```text
PUBLIC
INTERNAL
PERSONAL
CONFIDENTIAL
SENSITIVE
```

Each route/provider declares permitted classifications.

Tenant can disable IA or restrict data classes.

Before AI call:

1. classify task/data;
2. evaluate tenant policy;
3. choose permitted route;
4. redact/pseudonymize when task permits;
5. log metadata, not unnecessary prompt content.

LLM output is untrusted input:

- parse structured output;
- validate schema;
- validate IDs against tenant;
- validate action allowlist;
- never execute shell/code returned by model.

---

# 17. API keys multi-provider

- encrypted;
- masked after creation;
- label/owner/provider metadata;
- health status no secret;
- revoke/disable;
- legitimate use only;
- audit add/change/delete;
- no automatic key cycling to bypass provider terms.

---

# 18. Rate limiting

At minimum:

- login/reset;
- public portal token attempts;
- public forms future;
- webhook endpoints where reasonable;
- expensive document render;
- AI execution;
- message send abuse.

Limits can be IP/user/tenant/account scoped according to endpoint.

---

# 19. Session security

- Secure/HttpOnly cookies if applicable;
- SameSite appropriate;
- session expiry;
- server-side revoke capability;
- logout invalidates session;
- password reset can revoke existing sessions per policy;
- tenant suspension invalidates/blocks use.

Baseline Platform Admin E02-S01:

- Argon2id `m=19456`, `t=2`, `p=1`, salt aleatorio de 16 bytes;
- token de sesión opaco aleatorio de 256 bits y sólo SHA-256 persistido;
- expiración absoluta de 8 horas, idle timeout de 30 minutos y revocación server-side;
- cookie `__Host-platform_session` Secure en producción, HttpOnly, SameSite Strict, Path `/` y sin Domain;
- Origin exacto y CORS explícito para mutaciones con cookie;
- login limitado a 10 intentos por email normalizado por minuto y respuestas genéricas para credenciales inválidas;
- auditoría transaccional de login exitoso y logout, sin secretos ni token raw.

Baseline Tenant User E02-S02:

- identidad y cookie separadas de Platform Admin; `tenant_id` deriva de sesión después del login;
- slug de ruta sólo para resolución pre-auth y nunca `tenantId` desde body;
- Argon2id y política 15–128 compartidos con Platform Admin;
- sesión opaca de 256 bits, sólo SHA-256 persistido, 12 horas absolutas y 2 horas idle;
- cookie `__Host-tenant_session` Secure en producción, HttpOnly, SameSite Strict, Path `/`, sin Domain;
- reset de 256 bits, sólo hash persistido, 15 minutos, single-use y revocación de sesiones al completar;
- URL de reset sólo desde `TENANT_WEB_ORIGIN`; el raw token sólo cruza `PasswordResetDelivery` y nunca HTTP/logs;
- delivery real pendiente de adapter operativo; no se habilita recuperación productiva hasta configurarlo;
- límites separados process-local para login, reset request y confirm; distribución requerida antes de horizontal scaling.

---

# 20. Browser security headers

Target baseline:

- CSP appropriate to frontend;
- HSTS at edge when stable;
- X-Content-Type-Options;
- Referrer-Policy;
- frame-ancestors/CSP;
- permissions policy;
- secure cookie flags.

Exact policy must be compatible with QR/provider flows without broad unsafe exceptions.

---

# 21. Database

- not exposed publicly;
- least privilege DB user;
- separate migration/admin role future;
- backups encrypted;
- parameterized ORM queries;
- no raw SQL interpolation;
- connection limits;
- migrations reviewed for destructive impact.

---

# 22. Redis

- internal network only;
- auth if supported/configured;
- no public port;
- not source of truth;
- data may contain job payloads: do not include unnecessary secrets/PII;
- eviction policy chosen consciously.

---

# 23. Cloudflare / edge

- Tunnel persistent;
- no direct origin exposure if avoidable;
- admin surface can be protected additionally;
- origin firewall restricts unnecessary inbound;
- do not assume Cloudflare replaces app auth.

---

# 24. Logging

Never log:

- passwords;
- reset tokens;
- cookies;
- API keys;
- auth material;
- full documents;
- full backup keys;
- full message bodies by default.

Use identifiers + normalized metadata.

Sensitive debug mode must be explicit/time-limited/redacted.

---

# 25. Audit

Audit records include:

- actor;
- tenant;
- action;
- resource;
- timestamp;
- relevant before/after summary where safe;
- request id;
- source.

Append-oriented; ordinary users cannot edit.

---

# 26. Backups

- encryption before leaving host;
- encryption private key/passphrase not stored in Drive beside backup;
- checksum;
- verify upload;
- two-copy rotation only after verification;
- restore drill;
- deletion/offboarding policy future.

---

# 27. Dependency/supply chain

Before release:

- lockfile committed;
- vulnerability scan;
- review critical advisories;
- no unmaintained package for security-critical work without reason;
- pin/controlled upgrades;
- provider adapters have contract tests.

---

# 28. Container security

Target:

- run non-root where feasible;
- minimal images;
- no Docker socket mounted into app containers;
- read-only filesystem where feasible;
- bounded resources for render/browser workers;
- secrets not baked into image;
- separate internal networks.

---

# 29. Security before first paid client

Blocking checklist:

- [ ] tenant isolation tests pass;
- [ ] auth rate limiting;
- [ ] secrets externalized;
- [ ] credential encryption;
- [ ] uploads constrained;
- [ ] DB/Redis non-public;
- [ ] audit sensitive actions;
- [ ] dependency scan;
- [ ] backup encrypted + verified;
- [ ] restore drill;
- [ ] portal grants secure if portal included;
- [ ] known limitations documented.

---

# 30. Incident classes

- suspected tenant data leak;
- credential compromise;
- WhatsApp session compromise;
- unauthorized admin access;
- malicious file;
- backup key compromise;
- dependency vulnerability critical.

`RUNBOOK_OPERATIONS.md` debe definir respuesta inicial. Incidentes de posible fuga de tenant tienen prioridad máxima.

---

# 31. Security review triggers

Revisión obligatoria al agregar:

- nuevo canal/provider;
- public portal/form;
- payment;
- signature;
- new file type;
- new AI provider/data policy;
- plugin system;
- SSO;
- on-prem remote management;
- external object storage;
- new webhooks/connectors.
