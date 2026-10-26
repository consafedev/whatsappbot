# ADR-0067 — E14-S05 Availability calculation

**Status:** Accepted
**Date:** 2026-10-25

## Context

Agenda has tenant-owned services/resources, weekly rules and absolute exceptions.
SYSTEM_DESIGN §20 requires domain availability using duration, buffers, capacity,
timezones and occupied intervals. ADR-0065 deferred the PRD AvailabilityRule
service association; the actual current PRD section is §78 (older references
incorrectly name §79). This story resolves that deferral without booking storage.

## Decision

- Add nullable `serviceId` to weekly rules with a tenant-aware composite foreign
  key to AppointmentService and ON DELETE RESTRICT. Explicit null detaches it.
  A null rule applies to any service; a linked rule applies only to that service.
  Create/patch validates same-tenant active service. Preserve immutable resource.
- Serialize weekly-rule temporal patch/delete before reading the before-image,
  as exceptions do in S04, to avoid stale validation of concurrent boundaries.
- Amend ADR-0065's two-rule cross-midnight representation: allow `24:00` only
  as a weekly rule's end boundary. Starts remain `00:00` through `23:59`, and
  start must precede end. For example Monday22:00–24:00 plus Tuesday00:00–06:00
  is continuous; ending at23:59 would leave an unintended one-minute hole.
  This adds no schema or new overnight-rule format.
- A pure deterministic calculator produces minute-aligned absolute slots from
  weekly windows and absolute exceptions. Matching windows form a union and
  overlapping capacities use maximum, bounded by resource capacity; capacities
  never sum. EXTRA_AVAILABILITY opens resource capacity, BLOCKED wins. A service
  link filters applicability; it does not silently replace other matching rules.
- The full service-plus-buffers interval must be continuously available. Honor
  exact exception boundaries including seconds. Duration/buffers use elapsed
  minutes. Occupied interval boundaries determine peak simultaneous occupancy;
  counting all intersecting appointments as simultaneous is incorrect.
- Display timezone resolves resource unit, then service unit, then tenant. A
  rule timezone overrides its own evaluation. Evaluate UTC instants against
  local calendar rules so DST gaps do not fabricate times and repeated local
  minutes remain distinct absolute instants.
- Optional validated `businessHours` uses existing JSON configuration and
  existing BusinessHoursConfig/evaluator. Correct two verified evaluator defects:
  weekday denotes the opening day of an overnight period, which continues into
  the next local calendar morning; and holidays still apply when weekly
  schedules are empty (24/7). A current-date holiday closes the whole date;
  a prior opening-date holiday also suppresses its overnight carry. An isOpen:false
  weekday does not open a new period but does not cancel prior-day carry.
  Existing invalid-zone fallback remains for old evaluator callers; this query
  rejects invalid zones before evaluation. Effective precedence:
  resource.metadata, resource unit.settings, service.settings, service unit.settings,
  tenant.settings. The first configured value wins; invalid effective config
  fails closed instead of silently falling back. No extra restriction if absent.
  This key is newly defined here; no persisted BusinessHours model is claimed.
- Request bounds require explicit ISO offset and strict calendar validation,
  positive range up to seven elapsed days, duration up to seven days, individual
  buffers up to one day, default limit100/max500, stable UTC order and explicit
  nextFrom when truncated. At most1000 records per input set, 200000 minute-zone
  evaluations and 5000000 minute-rule comparisons; report excess with a smaller
  range recommendation, never ignore records silently.
- Query rechecks operational tenant and module.appointments. Service/resource
  must be active, same tenant, with compatible nonnull units and active linked
  units. GET /api/v1/appointments/availability requires appointments.read plus
  existing tenant session/context/permission/entitlement guards.
- The pure occupied-interval input prepares the calculation boundary; S06 adds
  actual appointment persistence/query and transactional booking. S05 does not
  claim database-backed booking occupancy before that model exists.

## Alternatives considered

UI-owned availability was rejected because callers could bypass it. Adding rule
capacities was rejected because overlaps would invent resource capacity. Naive
local-to-UTC offset arithmetic was rejected because DST makes it non-bijective.
Unbounded slot responses were rejected for operational cost; silent truncation
was rejected because it hides available results. A second scheduler/calendar
service was rejected because the existing domain and infrastructure suffice.

## Consequences

Callers must page with nextFrom and display the returned timezone explicitly.
Specific service rules coexist with generic windows according to explicit union
semantics. General business hours remain optional configuration, not a new
cross-module engine. Booking must later re-evaluate the same domain calculation
inside a resource-locked transaction; returned slots are not reservations.

## Migration/rollback

Additive migration `20261025180000_add_service_specific_availability_rules`
adds a nullable column, tenant-aware service uniqueness, index and foreign key.
Validate isolated clean schema and pre-story upgrade before development deploy.
Rollback requires detaching/removing service-specific rule data before dropping
the link and its supporting index. Historical migrations remain unchanged.

## Affected documents

PRD §78 reference, SYSTEM_DESIGN agenda, backlog §16/§53, STATUS, CHANGELOG,
docs/MANIFEST and avance_orquestador.
