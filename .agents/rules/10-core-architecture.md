# Core architecture guardrails

- One repo, one product, one migration line; no permanent tenant forks.
- Never add `if tenant === customerX` in Core.
- PostgreSQL is source of truth for critical business state.
- Redis/queues may hold ephemeral operational state, not the only business copy.
- Tenant identity must come from authenticated context, never hostile request tenant IDs.
- Tenant-owned queries and relations must be tenant-safe.
- Relevant mutations use domain write + Audit + Outbox atomically.
- External irreversible side effects happen after DB commit.
- Repeated events/retries are normal; design idempotently.
- Provider SDK types must not leak into Core.
- AI is optional and cannot become authority for deterministic pricing/state transitions.
- Prefer configuration, entitlements, rules and extension points over client-specific code.
