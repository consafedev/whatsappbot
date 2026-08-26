---
description: Produce a durable repository-based handoff for the next agent
---

# /handoff

Create a compact handoff containing:
- repo/branch/HEAD;
- working tree;
- completed story;
- exact files/behavior;
- schema/migration count;
- commands actually run;
- test counts;
- known failures/debt;
- docs changed;
- next story;
- explicit out-of-scope.

Update STATUS before handoff if code state changed.
Do not rely on chat-only context.