# Verification discipline

A task is not PASS because code compiles.

When applicable verify:
- lint;
- typecheck;
- unit;
- integration with real PostgreSQL;
- tenant isolation;
- auth/RBAC/entitlement;
- concurrency;
- idempotency;
- forced rollback;
- migration status/drift;
- build;
- Docker/runtime smoke;
- secret scan;
- docs;
- git diff/show checks.

Never write “PASS” for a command not executed.

Do not weaken an existing test unless the normative requirement changed and that change is documented.
