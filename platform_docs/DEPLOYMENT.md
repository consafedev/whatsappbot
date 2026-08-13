# DEPLOYMENT.md — Estrategia y procedimiento de despliegue

**Versión:** 1.0-draft  
**Fecha:** 2026-08-12

---

# 1. Objetivo

Desplegar el mismo producto de forma reproducible en:

- desarrollo;
- staging;
- producción shared SaaS;
- producción dedicated;
- customer-hosted.

Nunca crear una variante de código por deployment.

---

# 2. Artefacto de release

Fuente única:

- commit Git identificado;
- versión SemVer;
- lockfile;
- migrations;
- imágenes Docker versionadas.

Tags de imagen recomendados:

```text
app-api:1.2.0
app-web:1.2.0
worker-jobs:1.2.0
worker-whatsapp:1.2.0
document-renderer:1.2.0
ai-gateway:1.2.0
```

Evitar `latest` como única referencia en producción.

---

# 3. Environments

## Development

- Docker Compose local;
- seed/demo data;
- fake providers cuando convenga;
- no production credentials.

## Staging

- topology similar a producción;
- datos ficticios;
- migrations reales;
- smoke tests;
- provider sandbox/test cuando exista.

## Production

- secrets propios;
- backups;
- health checks;
- logs;
- no demo fixtures.

---

# 4. Configuración

Usar variables/config externas por environment.

Categorías:

- app URLs;
- DB;
- Redis;
- auth;
- encryption;
- Cloudflare;
- storage;
- backup;
- provider configs;
- logging.

`.env.example` documenta nombres sin secretos.

---

# 5. Docker Compose inicial

Servicios conceptuales:

```text
cloudflared
reverse-proxy
web
api
postgres
redis
worker-jobs
worker-whatsapp
document-renderer
ai-gateway
backup-runner
```

Profiles pueden habilitar servicios opcionales en dev.

---

# 6. Volúmenes persistentes

Persistir fuera de lifecycle de contenedor:

- PostgreSQL data;
- file storage;
- backup temp/output controlado;
- WPPConnect browser/session data sólo si adapter lo requiere y de acuerdo con estrategia cifrada.

Redis puede persistir según configuración, pero no se confía como única verdad.

---

# 7. Networking

- edge/app network;
- internal data network;
- Postgres/Redis sin published ports en production;
- cloudflared conecta sólo al servicio/reverse proxy necesario.

---

# 8. Pre-deploy checklist

- [ ] commit/tag correcto;
- [ ] CI verde;
- [ ] CHANGELOG actualizado;
- [ ] STATUS actualizado/preparado;
- [ ] migrations revisadas;
- [ ] backup reciente verificado si upgrade productivo;
- [ ] disk space suficiente;
- [ ] secrets/config presentes;
- [ ] rollback impact entendido;
- [ ] provider compatibility revisada si adapter cambió.

---

# 9. Deploy sequence

Secuencia general:

1. crear backup si producción y release lo requiere;
2. pull/build imágenes target;
3. verificar config;
4. ejecutar migration step controlado;
5. iniciar/actualizar servicios stateless;
6. actualizar workers;
7. verificar health;
8. ejecutar smoke tests;
9. verificar channel accounts críticos;
10. registrar versión deployment;
11. actualizar STATUS.

La secuencia exacta puede variar si una migration requiere expand/contract.

---

# 10. Migraciones seguras

Preferir patrones backward-compatible:

1. expand schema;
2. deploy code compatible;
3. backfill async si aplica;
4. switch behavior;
5. contract/remove en release posterior.

Evitar renames/drop simultáneos con código que todavía depende del campo viejo.

---

# 11. Rollback

Rollback de código sólo es seguro si schema permanece compatible.

Si migration destructiva impide rollback:

- release requiere plan específico;
- backup obligatorio;
- ADR/migration notes.

Nunca hacer “down migration” automática en producción sin entender pérdida de datos.

---

# 12. Smoke tests post-deploy

Mínimos:

- web login page;
- API health;
- DB health;
- Redis/queue health;
- worker alive;
- storage write/read test controlado;
- Super Admin login test manual/automated secure;
- channel status read;
- outbound test sólo en cuenta de prueba cuando sea adecuado.

---

# 13. Cloudflare Tunnel

Production usa túnel persistente configurado fuera del repo/secrets apropiados.

Hostnames conceptuales:

```text
app.example.com
control.example.com
portal.example.com / custom tenant domains future
```

Pueden resolverse a una misma web app con routing por host/path.

---

# 14. Shared SaaS

Un deployment aloja múltiples tenants.

Upgrade:

- validar migration para todos;
- feature flags para rollout si feature riesgosa;
- entitlements siguen independientes.

---

# 15. Dedicated

Mismas imágenes/versiones.

Metadata registra:

- deployment id;
- tenant(s);
- current version;
- target version;
- release channel;
- health.

No aplicar custom patch fuera del release process.

---

# 16. Customer-hosted

Entregar:

- supported Compose definition;
- `.env.example`;
- prerequisites;
- backup requirements;
- upgrade procedure;
- supported versions policy futura;
- health verification.

La instancia puede operar sin depender del control plane para lógica esencial si el contrato/product strategy lo requiere.

---

# 17. Release channels

- `stable`: producción normal.
- `candidate`: validación previa/select customers.
- `beta`: features experimentales controladas.

Tenants no eligen arbitrariamente versiones incompatibles dentro de shared deployment.

---

# 18. Emergency disable

Debe poder deshabilitarse sin redeploy cuando sea posible:

- feature global riesgosa;
- tenant module;
- AI provider route;
- channel account;
- rule.

No usar feature flags para ocultar pérdida de datos.

---

# 19. Capacidad

Antes de agregar tenants nuevos observar:

- RAM;
- CPU;
- disk;
- DB connections;
- Redis memory;
- queue lag;
- WhatsApp worker memory/connections;
- backup duration/size.

Escalar por medición.
