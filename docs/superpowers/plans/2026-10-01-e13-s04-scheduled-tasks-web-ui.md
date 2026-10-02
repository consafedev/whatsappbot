# E13-S04 Scheduled Tasks Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tenant-facing scheduled task console, with gated list/create/cancel/retry flows and no backend or database changes.

**Architecture:** Add a typed web view model that maps the existing `{success, data}` API envelope and `data.tasks` into UI-facing `items`. Mount a dynamic route inside the existing tenant shell; keep page orchestration, task table, and create modal in separate client components. Derive all gating from tenant bootstrap and retain API enforcement as authority.

**Tech Stack:** TypeScript, React 19, Next.js 16 App Router, Tailwind CSS, Vitest, pnpm workspaces, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-01-e13-s04-scheduled-tasks-web-ui-design.md`

## Global Constraints

- Base commit is `06288f911f0b123dbf3288d417569688d648ea1c`.
- Do not modify `apps/api`, `packages/database`, Prisma schema, migrations, or endpoint contracts.
- Keep Agenda's existing `appointments` placeholder; add `scheduled-tasks` as an independent nav item.
- Gate reads on `module.scheduling` + `scheduling.read`; gate every mutation on `scheduling.manage`.
- Every browser REST request includes `credentials: "include"`.
- Cron expressions are five-field UTC cron; do not imply a tenant-local timezone.
- No inline task editing, Temporal, new dependencies, arbitrary custom-action execution, or mock task data.
- Update ADR-0061, STATUS, CHANGELOG, and MANIFEST with exact document metadata.
- Final story commit message: `feat(scheduling): implement task scheduling web ui and management dashboard (E13-S04)`.

## Review Focus

- API list envelope malformed or missing `data.tasks`: view model must throw a typed invalid-response error rather than silently showing an empty list (Task 1 test).
- HTTP 400/403/404/409 and non-JSON failures: preserve status and safe message in `ScheduledTasksApiError` (Task 1 tests).
- Invalid or absent date strings: date helper must return its documented neutral fallback without throwing (Task 1 test).
- Entitlement/read/manage combinations: nav hides the route unless both read gates pass, and every mutation control is hidden or disabled without manage permission (Tasks 1–3 tests/verification).
- Recurring create without `scheduledFor`: send cron only and let the API derive its first occurrence; one-off input becomes an ISO timestamp (Task 1 body assertion and Task 3 workflow verification).

---

### Task 1: REST view model and pure helpers

**Files:**
- Create: `apps/web/app/app/scheduled-tasks/scheduled-tasks-view-model.ts`
- Test: `apps/web/app/app/scheduled-tasks/scheduled-tasks-view-model.test.ts`

**Interfaces:**
- Export `ScheduledTaskStatus`, `ScheduledTaskItem`, `ScheduledTasksResponse`, `CreateScheduledTaskInput`, `ScheduledTasksApiError`.
- Export `fetchScheduledTasks(apiBaseUrl, options?)`, `createScheduledTask(apiBaseUrl, input)`, `cancelScheduledTask(apiBaseUrl, id)`, and `retryScheduledTask(apiBaseUrl, id, runAt?)`.
- Export pure `formatTaskStatus(status)`, `formatTaskType(type)`, and `formatDateTime(dateStr?)` helpers.
- Export pure `canReadScheduledTasks(effectiveModules, effectivePermissions)` and `canManageScheduledTasks(effectivePermissions)` gates and have the client use these same functions.
- Normalize API `data.tasks` to `ScheduledTasksResponse.items`, preserving `total`, `limit`, and `offset`. Accept the API's serialized date strings and nullable optional fields.

- [ ] **Step 1: Write failing view-model tests** for each REST function, asserting URL/query, HTTP method, JSON headers/body where applicable, `credentials: "include"`, correct envelope normalization, and retry body omission/presence for `runAt`.
- [ ] **Step 2: Run the focused test to verify RED.** Run: `pnpm vitest run apps/web/app/app/scheduled-tasks/scheduled-tasks-view-model.test.ts`. Expected: failures because the module and exports do not exist.
- [ ] **Step 3: Add failing tests** for status labels/tones, known and unknown task type labels, safe `es-MX` date formatting, invalid/missing dates, invalid list envelopes, HTTP 400/403/404/409 error preservation including a non-JSON response, and module/read/manage permission combinations.
- [ ] **Step 4: Run the focused test to verify RED** for the newly added assertions.
- [ ] **Step 5: Implement the minimal typed clients and helpers** in `scheduled-tasks-view-model.ts`. Trim a trailing slash from `apiBaseUrl`; use the existing standard envelope; map the API `tasks` array to `items`; throw `ScheduledTasksApiError` on HTTP and invalid-envelope errors; implement the tested module/read/manage gate functions.
- [ ] **Step 6: Run the focused test file** and confirm all view-model tests pass.

### Task 2: Navigation registration

**Files:**
- Modify: `apps/web/app/app/tenant-app-navigation.ts`
- Test: `apps/web/app/app/tenant-app-navigation.test.ts`

**Interfaces:**
- Register `"module.scheduling": "Programación de Tareas"` in `TENANT_MODULE_LABELS`.
- Add navigation item `{ id: "scheduled-tasks", label: "Tareas Programadas", href: "/app/scheduled-tasks", requiredModule: "module.scheduling", requiredPermission: "scheduling.read" }` under Operación.
- Leave Agenda's existing id, label, null href, module, permission, and placeholder behavior unchanged.

- [ ] **Step 1: Add failing navigation tests** for module-only, permission-only, and both-gates access, exact route/id/label, and continued Agenda placeholder behavior.
- [ ] **Step 2: Run the focused navigation test to verify RED.** Run: `pnpm vitest run apps/web/app/app/tenant-app-navigation.test.ts`.
- [ ] **Step 3: Add the scheduling label and nav entry**, preserving the Agenda item verbatim.
- [ ] **Step 4: Run the focused navigation test** and confirm both new scheduling behavior and existing navigation assertions pass.

### Task 3: Task table, create modal, and client orchestration

**Files:**
- Create: `apps/web/app/app/scheduled-tasks/scheduled-tasks-client.tsx`
- Create: `apps/web/app/app/scheduled-tasks/scheduled-tasks-list.tsx`
- Create: `apps/web/app/app/scheduled-tasks/scheduled-task-create-modal.tsx`
- Create: `apps/web/app/app/scheduled-tasks/page.tsx`

**Interfaces:**
- `ScheduledTasksClient` accepts optional `apiBaseUrl`, following reports-client conventions; default to `process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001"` and remove trailing slash.
- Client uses `useTenantAppBootstrap()` for `effectiveModules` / `effectivePermissions`; it will not accept tenant identity from route or form data.
- `page.tsx` exports `dynamic = "force-dynamic"` and mounts `ScheduledTasksClient`.
- `ScheduledTasksList` receives a readonly task list, manage capability, pending task/action identity, and cancel/retry callbacks.
- `ScheduledTaskCreateModal` receives open state, manage capability, submitting state, close callback, and async create callback typed with `CreateScheduledTaskInput`.

- [ ] **Step 1: Implement client state and gating.** Use the tested view-model gate helpers; require both read gates before fetching and show module/access state if either is absent. Omit/disable create, cancel, and retry controls when manage permission is absent.
- [ ] **Step 2: Implement list loading and controls.** Fetch with `status`, `limit = 20`, and `offset`; provide status selector including Todos, local name search over the loaded page, server-total pagination, refresh, loading/empty/error states, and refresh after successful mutations.
- [ ] **Step 3: Implement the table.** Render name/type, cron or “Puntual”, scheduled/last run dates, retry counts, semantic status labels, escaped error text, and the contextual cancel (`PENDING`/`PROCESSING`) or retry (`FAILED`/`CANCELLED`) action. Prevent repeat action while the same task mutation is pending.
- [ ] **Step 4: Implement the accessible creation modal.** Add required name and task type, one-off versus recurring choice, local `datetime-local` to ISO conversion for one-off execution, UTC cron presets (`0 * * * *`, `0 0 * * *`, `0 9 * * 1`) plus custom expression, JSON object syntax validation, and non-negative integer `maxRetries` defaulting to 3. Show UTC meaning for cron, validation errors, submitting state, and API error feedback.
- [ ] **Step 5: Wire create/cancel/retry mutations** through the view-model clients. On success close the create modal if relevant and reload the current filter/page; on failure surface the API error and leave the list state usable.
- [ ] **Step 6: Run the focused view-model and navigation tests** after UI integration and run the web TypeScript check to catch component contract errors.

### Task 4: ADR and operational documentation

**Files:**
- Create: `platform_docs/docs/adr/0061-e13-s04-scheduled-tasks-web-ui-scope.md`
- Modify: `platform_docs/STATUS.md`
- Modify: `platform_docs/CHANGELOG.md`
- Modify: `platform_docs/docs/MANIFEST.md`

- [ ] **Step 1: Write ADR-0061** with accepted status, date, context, decision, alternatives, consequences, rollback, and affected documents. Record the client architecture, UTC cron presets, granular RBAC, normalized list response, and explicit no-backend/no-Temporal boundary.
- [ ] **Step 2: Update STATUS and CHANGELOG** to record E13-S04 scope and evidence without claiming unrun checks; set E13-S04 next story to E13-S05 after all verification passes.
- [ ] **Step 3: Update MANIFEST status and row** for ADR-0061 using measured exact bytes, whitespace-delimited word count, and SHA-256 after the ADR is final.
- [ ] **Step 4: Verify document metadata** by independently recomputing the ADR byte count, word count, and SHA-256, and confirm the MANIFEST row matches.

### Task 5: Full verification, Docker sync, review, and story commit

**Files:**
- Verify all files created or changed in Tasks 1–4; no additional scope.

- [ ] **Step 1: Run requested static and web gates.** Run `pnpm biome check .`, `pnpm vitest run apps/web`, `pnpm --filter @whatsapp-platform/web typecheck`, and `pnpm typecheck`; record exact results.
- [ ] **Step 2: Inspect the full diff** for E13-S04 scope, correct HTTP credentials, tenant bootstrap-only identity, mutation gates, unchanged Agenda placeholder, accurate docs, no secrets, and `git diff --check` cleanliness.
- [ ] **Step 3: Build and start requested services.** Run `docker compose build api web` followed by `docker compose up -d`; inspect service health and logs for actual completion.
- [ ] **Step 4: Verify route smoke response.** Use PowerShell `Invoke-WebRequest -UseBasicParsing http://localhost:3005/app/scheduled-tasks` and confirm HTTP 200. Because the tenant shell loads its bootstrap in the browser, if the initial HTML does not contain authenticated task data, verify the rendered console in an already authenticated browser session; do not create credentials or tenant data without an existing authorized fixture.
- [ ] **Step 5: Recompute the final ADR-0061 metadata and MANIFEST row** if any documentation edit changed the ADR bytes; rerun `git diff --check`.
- [ ] **Step 6: Stage only the E13-S04 allowlist** and commit with `feat(scheduling): implement task scheduling web ui and management dashboard (E13-S04)`.
- [ ] **Step 7: Record commit SHA, final tree state, exact gates, Docker health, HTTP smoke result, UI workflow verification, and next story E13-S05.** Stop after the E13-S04 closeout.
