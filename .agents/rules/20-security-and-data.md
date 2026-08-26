---
trigger: model_decision
description: Usar cuando se toquen elementos de seguridad, contraseñas, o autenticación
---

# Security and data rules

Never log or persist unnecessarily:
- passwords;
- session/reset tokens;
- API keys;
- cookies;
- WhatsApp authentication material;
- full sensitive documents/messages;
- secret-bearing URLs.

API/UI responses are least-data.

UI permission/entitlement checks are UX only; backend revalidates.

For tenant-owned features always test A/B isolation and hostile tenant inputs.

For a new file/url/provider payload: validate shape, size, ownership and failure behavior.

Never use `eval` or execute free-form code/instructions from tenant or LLM.

Do not modify historical migrations after they have become baseline.
