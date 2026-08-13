# ADR-0012 — Convenciones UUIDv7 y timestamps UTC

**Status:** Accepted
**Date:** 2026-08-12

## Context

E01-S01 reservó la estrategia global de identificadores y creó las PK internas como columnas PostgreSQL `UUID` sin default. El proyecto necesita una convención transversal que permita inserts seguros desde la base de datos, evite secuencias enumerables y conserve un tipo físico nativo. También necesita fijar la semántica y precisión de los instantes persistidos para Node.js y PostgreSQL.

PostgreSQL 18 implementa `uuidv7()` nativamente conforme a RFC 9562 y permite inspeccionar su versión y timestamp. Prisma 7.9.1 puede representar funciones default nativas mediante `dbgenerated(...)`.

## Decision

- La PK surrogate interna canónica es UUID version 7 almacenada como PostgreSQL `UUID`.
- PostgreSQL genera el valor por default con `uuidv7()`. Prisma lo representa como `@default(dbgenerated("uuidv7()")) @db.Uuid`.
- La aplicación puede proporcionar explícitamente un UUIDv7 cuando necesite conocer el ID antes de persistir, pero no se añade una librería application-side hasta que exista esa necesidad.
- IDs externos de providers nunca sustituyen una PK interna.
- Claves naturales deliberadas permanecen válidas. `PlatformFeatureFlag.key` conserva su identidad técnica y no recibe UUID artificial.
- Los instantes del dominio se almacenan como PostgreSQL `TIMESTAMPTZ(3)` y representan UTC. Timezones de tenant/unidad sólo gobiernan presentación, calendario, horarios y reglas.
- `created_at` es `NOT NULL`, tiene default `now()` y precisión de milisegundos.
- `updated_at` es `NOT NULL`, tiene valor inicial `now()` y Prisma lo mantiene mediante `@updatedAt` en operaciones normales.
- Raw SQL que modifique entidades debe actualizar `updated_at` explícitamente. No se agregan triggers; sólo se reconsiderarán mediante otro ADR ante una necesidad real.
- Timestamps conceptualmente opcionales permanecen nullable y no se introduce soft delete universal.
- PostgreSQL 18 o superior es requisito mínimo mientras se utilice `uuidv7()` nativo.

## Alternatives considered

- ULID: rechazado para evitar almacenamiento textual y una segunda representación canónica.
- UUIDv4: válido para unicidad, pero rechazado como convención de nuevas PK porque no aporta orden temporal.
- Prisma `uuid(7)`: rechazado como default canónico porque la base también debe generar el ID cuando el insert no lo proporcione.
- `uuid-ossp`, `pgcrypto` o función custom: innecesarios con PostgreSQL 18.
- Trigger global para `updated_at`: pospuesto porque Prisma cubre las operaciones normales y el trigger añade complejidad prematura.

## Consequences

- `PlatformDeployment`, `Tenant`, `TenantEntitlement` y `OrganizationUnit` reciben defaults `uuidv7()` sin cambiar su tipo físico ni sus FKs.
- El schema conserva interoperabilidad con clientes que proporcionen un UUIDv7 explícito.
- Inserts directos y Prisma pueden omitir las PK UUID surrogate.
- PostgreSQL anterior a 18 no es compatible con migrations nuevas mientras esta decisión siga vigente.
- El orden UUIDv7 no se usa como sustituto de timestamps ni como garantía de orden total.

## Migration/rollback

Una segunda migration añade defaults `uuidv7()` a las cuatro PK UUID existentes y defaults `now()` a `updated_at`; no reescribe IDs, timestamps ni constraints existentes. El rollback técnico retira únicamente esos defaults, sin convertir datos ni editar la migration inicial.

## Affected documents

`SYSTEM_DESIGN.md`, `DEPLOYMENT.md`, `STATUS.md`, `CHANGELOG.md`, schema y migrations de `packages/database`.
