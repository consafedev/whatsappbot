---
description: Adversarially audit and minimally fix the last completed story
---

# /audit-story

1. Read original story prompt/report.
2. Inspect commit diff.
3. Build requirement -> evidence matrix.
4. Audit scope, architecture, tenant, auth, entitlements, schema, concurrency, idempotency, transactions, secrets, provider boundaries, UI and test quality.
5. Reproduce any defect with test.
6. Apply smallest safe fix.
7. Re-run story + affected regressions.
8. New fix commit only if needed.
9. Report PASS / PASS AFTER FIX / BLOCKED.
10. Do not implement next story.