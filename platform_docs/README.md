# Plataforma Multitenant de Automatización Empresarial

Plataforma SaaS configurable para automatizar atención y operaciones empresariales, con WhatsApp como primer canal y con capacidad para procesos, estados, citas, recordatorios, Action Requests, cotizaciones, documentos, portal de clientes, CRM ligero e IA opcional.

El producto está diseñado para múltiples industrias y para ejecutarse desde un único repositorio en modalidad SaaS compartida, instancia dedicada o infraestructura del cliente.

## Estado actual

**Fase:** Epic 00 — Repository Foundation implementado; validación runtime de Docker pendiente.  
**Prioridad:** mantener el límite de Epic 00 y continuar con E01-S01 sólo bajo una instrucción separada.

Consulta `STATUS.md` antes de comenzar cualquier trabajo.

## Lectura obligatoria para desarrolladores/IAs

1. `docs/INDEX.md`
2. `PRD.md`
3. `SYSTEM_DESIGN.md`
4. `DATA_MODEL_ERD_MVP_BACKLOG.md`
5. `.agents/skills/whatsapp-platform-engineering/SKILL.md`
6. `STATUS.md`
7. `CHANGELOG.md`
8. ADRs relevantes en `docs/adr/`

## Principios principales

- Un repositorio, un producto.
- Cero forks permanentes por cliente.
- PostgreSQL es fuente de verdad.
- Tenant isolation obligatorio.
- Módulos y límites controlados por entitlements.
- WhatsApp detrás de adapters.
- Reglas deterministas antes de IA.
- BullMQ en MVP detrás de `WorkflowOrchestrator`.
- Temporal preparado pero pospuesto.
- MVP comercial primero: tenant → WhatsApp → conversación → regla → respuesta → humano.

## Documentación

El mapa completo y la finalidad de cada documento están en [`docs/INDEX.md`](docs/INDEX.md).

## Implementación

La estructura y los comandos verificados del monorepo están documentados en el [`README.md` de la raíz](../README.md).

## Handoff

Toda sesión significativa debe terminar actualizando `STATUS.md` y los documentos afectados según `.agents/skills/whatsapp-platform-engineering/SKILL.md`.
