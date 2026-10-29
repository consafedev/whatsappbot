# E15 Catalog + Quote Implementation Plan

**Status:** Accepted design; execution tracked by story in STATUS.md and avance_orquestador.md

> **For agentic workers:** REQUIRED SUB-SKILL: The parent uses superpowers:subagent-driven-development; each story worker uses superpowers:executing-plans for its assigned story only. The parent owns shared docs, independent audit gates, commits, and pushes. No worker subagents or worker commits/pushes.

**Goal:** Implement E15-S01..S08 as a tenant-safe product catalog and deterministic quote lifecycle ending in an honest, durable PENDING_DOCUMENT send intent.

**Architecture:** PostgreSQL is authoritative. Small tenant-scoped database managers own invariants and commit audit/outbox with mutations; Nest controllers enforce current session, module and canonical permissions; the UI calls only those APIs. Pricing is a pure deterministic function. Approval, immutable versions, command receipts, and send intents share explicit tenant locking and idempotency rules.

**Tech Stack:** Existing Node 24, TypeScript, Nest, Prisma 7.9.1, PostgreSQL 18, Next 16, React 19 and Vitest 4.1.10. No dependency addition.

**Spec:** docs/superpowers/specs/2026-10-28-e15-catalog-quotes-design.md

## Global Constraints

- Use only existing module.catalog, module.quotes, module.crm_lite, module.messaging.basic, catalog.read, catalog.manage, quotes.read, quotes.create, quotes.approve, quotes.send, and tenant.settings.manage keys.
- Tenant-owned rows have required tenantId; validate every referenced ID within the authenticated tenant. A Product OU must match the Quote OU; a global Product is tenant-wide. Do not implement generic OU-aware RBAC.
- Catalog Product and AppointmentService remain separate. No inventory, protected cost, customer-organization subsystem, AI matching, Document Engine, PDF, provider I/O, worker, BullMQ import, or new external dependency.
- Money crosses HTTP/domain boundaries as decimal strings; never use JS floating point for commercial arithmetic or UI formatting. Product price and fixed discount use NUMERIC(19,4), tax rate NUMERIC(9,4) with API+SQL <=100, aggregate amounts NUMERIC(24,4); quantity has at most 3 decimals, rates at most 4, price bound 999999999.9999, fixed discount DB max 999999999999999.9999 and additionally <= rounded gross/currency precision, quantity bound 999999.999, line count 1–200.
- Tax is exclusive; use HALF_UP per line for gross, discount and tax at quote-snapshotted currency precision. Fixed discount is per line, shipping is explicitly untaxed, and unset tax rate blocks calculation.
- Autonomy defaults to 0/manual. Levels 2/3 require explicit max amount/currency and deterministic limits; no missing stock/margin fact can authorize automatic approval. No HTTP-supplied stock/margin/customer-history boolean is trusted.
- Every quote mutation has a tenant-scoped minimal typed idempotency receipt (<=16 KiB, never duplicate full item arrays). Lock order is command-key advisory → tenant-policy advisory → number advisory on create → Quote row → sorted Product/shared rows. Product CRUD never locks Quote. Quote number comes from indexed tenant MAX(numberSequence)+1 under lock, not a counter service. S02 takes the policy lock namespace but does not query/create QuotePolicy; only S04 adds the table/default resolver.
- validUntil null means no deadline; explicit instants require an offset. Sample time after blocking locks; now >= validUntil denies approval/version/send. No expiry timer.
- Preserve quote line price snapshots on unrelated metadata edits. Reselecting Product is the explicit refresh operation; changing product-bound commercial data requires an authorized conversion to manual.
- Approval records commercial contributors and uses separation of duties by default. Automatic approval actor is system_policy with null user ID. S05 owns the lifecycle matrix and quote-cancel endpoint; S08 owns pending-intent freeze enforcement by patching S02/S05 mutation paths only after the intent table exists. Do not implement generic ActionRequests.
- QuoteVersion is immutable and created only on final approval; S07 owns tenant-scoped version history/frozen preview. S08 stores a cancelable intent and outbox event; it does not set sentAt, emit quote.sent, or claim PDF/provider delivery.
- Use shared named constants for exact bounds; validate before writes, never silently truncate. Header + line inputs <=256 KiB UTF-8, approval snapshot <=768 KiB, version <=1 MiB, public branding <=64 KiB. API rejects unknown authority/totals/actor fields. Persist customer name/phone, OU name and authenticated salesperson display-name snapshots; never project unrestricted live CRM data into historical reads.
- Parent updates platform_docs/STATUS.md, CHANGELOG.md, relevant docs/manifest, and commits/pushes only the accepted story delta after its audit and gates. No next story starts before that gate.

## Review Focus

- Malformed, overflow and fractional amounts, including HALF_UP boundaries at 0-, 2-, 3-, and 4-digit currency precision: pin in quote-calculation.test.ts and API validation tests (S03).
- Cross-tenant Contact/Product/OU/Conversation/Channel IDs and global versus unit-bound Product selection: pin in DB/API A/B tests (S01, S02, S08).
- Stale policy/revision and creator/editor/approver separation, including concurrent approvals and amount/discount boundaries: pin in policy and approval DB tests (S04, S05).
- Idempotency replay after later edits/cancellation, same key with different actor/operation/resource/request, and current authorization before replay: pin in quote-manager and send-manager integration tests (S02, S05, S08).
- Pending document and canceled intent must never look sent or claim a PDF/provider effect: pin in send-intent API/UI tests and story review (S06, S08).

## Shared Story Gate

For every story, the implementer first adds the named failing test, runs it and records RED evidence, then implements the smallest passing change and runs GREEN/regression commands. The independent auditor reviews the full story diff, test assertions, tenant/permission boundaries, and spec coverage. Fix findings with a regression test and repeat the gate. The parent updates shared docs and manifest, stages only that story's approved files, commits and pushes the exact verified SHA, and records it before the next story. A skipped or misconfigured integration test is setup failure, not a pass.

For every story that changes schema, validate/generate Prisma, compare clean-schema SDL and ordered Git-HEAD baseline upgrade against the actual new SQL; parent applies locally and verifies new checksums before any prepared PostgreSQL suite. Applied SQL is immutable; fix only by a later migration. Preserve the known historical BOM clean-chain limitation honestly. Create focused database/API integration configurations and root/package test:integration:catalog-quotes scripts in S01; extend config includes later. Run PostgreSQL suites only against the parent-prepared disposable DB. Do not print, copy, stage, or manually inspect raw `.env` contents; authorized local configuration may load internally through the guarded helper.

---

### Task 1: E15-S01 — Product Catalog

**Files**

- Create packages/database/prisma/migrations/20261028180000_e15_product_catalog/migration.sql
- Modify packages/database/prisma/schema.prisma
- Create packages/database/src/catalog-manager.ts and catalog-manager.integration.ts
- Modify packages/database/src/index.ts and packages/database/package.json
- Create packages/database/vitest.catalog-quotes.config.mts
- Create apps/api/src/catalog.ts and catalog.integration.ts
- Modify apps/api/src/app.ts and apps/api/package.json
- Create apps/api/vitest.catalog-quotes.config.mts; modify root package.json

**Interfaces**

- CatalogProductView is a JSON-safe application projection: price and nullable taxRate are exact decimal strings; timestamps are ISO strings. Do not expose Prisma Decimal instances as domain/API money.
- createCatalogProduct(context: TenantContext, database: CatalogManagerDatabase, input: CatalogProductInput, metadata: CatalogMutationMetadata): Promise<CatalogProductView>
- getCatalogProductById(context: TenantContext, database: CatalogManagerDatabase, id: string): Promise<CatalogProductView | null>; controller maps null to 404.
- listCatalogProducts(context, database, filters: CatalogProductListFilters): Promise<CatalogProductListPage>
- updateCatalogProduct(context, database, id: string, patch: CatalogProductPatch, metadata): Promise<CatalogProductView>
- archiveCatalogProduct(context, database, id: string, metadata): Promise<CatalogProductView>
- Inputs use decimal strings, trusted tenant context, and optional tenant-owned OU; never accept tenantId. SKU original and normalized are each 1–64 UTF-16 units, no controls (validate expansion); normalize NFKC → trim → uppercase and enforce tenant uniqueness. Name 1–150, description <=2000, category <=120, unit 1–32, taxCode <=64. Price NUMERIC(19,4) <=999999999.9999; tax rate NUMERIC(9,4) but SQL and API both constrain 0..100. customValues null/object <=16KiB UTF-8/depth8, no root arrays/primitives or prototype instructions. Audit/outbox each real mutation in one transaction. Archive is idempotent and retains the row.
- API: GET/POST /api/v1/products, GET/PATCH /api/v1/products/:id, POST /api/v1/products/:id/archive, existing ApiResponse envelope, module.catalog and catalog.read/manage.

- [x] Step 1 — RED: Add integration cases normalizesSkuAndEnforcesTenantUniqueIndex, enforcesSkuNameDescriptionCategoryUnitTaxCodeBoundsAndNoControls, rejectsForeignOrganizationUnit, rejectsPriceOrRateSqlAndApiBoundsIncludingRateOver100, validatesCustomValuesObjectDepthUtf8AndPrototypeSafety, archiveRetainsProductAndIsIdempotent, apiRequiresCatalogModuleAndPermission, and apiHidesCrossTenantProduct. Assert Tenant A cannot observe or mutate Tenant B by ID.
- [x] Step 2 — Run RED: `node .superpowers/sdd/2026-10-28-e15-catalog-quotes/e15-local.cjs run api --prepared s01_red src/catalog.integration.ts`. Authenticated source-App POST `/api/v1/products` with valid catalog entitlement/manage permission expected201 and returned404 before route wiring; an earlier wrong-root test path was setup failure and was not counted.
- [x] Step 3 — Implement Product schema/migration and manager functions. Persist normalizedSku; constrain customValues to object JSON ≤16 KiB UTF-8; validate OU ownership; write AuditLog/Outbox in the same transaction. Add the guarded controller.
- [x] Step 4 — GREEN: DB/API focused script exit0: DB11/11 in1 file, API3/3 in1 file, zero skipped; Prisma7.9.1 validate/generate; clean-schema SDL and ordered Git-HEAD upgrade had no drift; parent applied migration37 locally and its Prisma checksum matched, with SQL unchanged. Root unit528/528 in58 files, root typecheck exit0 and Biome508 exit0 also passed. The initial compact customValues check returned500 against canonical SQL length validation; fixed to400 and covered by final focused tests. Twelve stale ignored generated JS artifacts were removed only from the generated directory; one lost test session without a saved log was not counted; initial helper ownership errors were fixed before migration gates passed.
- [x] Step 5 — Independent audit approved; shared docs updated; S01 published as `003d48a2bfa03cccad3b6cb5a5574aed5e66c524` to `origin/codex/e15-catalog-quotes` with identical remote SHA. `main` does not contain S01. S02 is reserved/ready for `e15_s02_luna` from the published feature base.

### Task 2: E15-S02 — Quote Drafts

**Files**

- Create packages/database/prisma/migrations/20261028190000_e15_quote_drafts/migration.sql
- Modify packages/database/prisma/schema.prisma, packages/database/src/index.ts, both focused configs
- Create packages/database/src/quote-manager.ts and quote-manager.integration.ts
- Create apps/api/src/quotes.ts and quotes.integration.ts; modify apps/api/src/app.ts

**Interfaces**

- createQuoteDraft(context: TenantContext, database: QuoteManagerDatabase, input: QuoteDraftInput, metadata: QuoteMutationMetadata): Promise<QuoteCommandOutcome<QuoteDraftView>>
- updateQuoteDraft(context, database, quoteId: string, expectedRevision: number, patch: QuoteDraftPatch, metadata): Promise<QuoteCommandOutcome<QuoteDraftView>>
- listQuotes(context, database, filters: QuoteListFilters): Promise<QuoteListPage>; getQuoteById(context, database, quoteId: string): Promise<QuoteDraftView>
- QuoteDraftInput has idempotencyKey, organizationUnitId, contactId, currency, 1–200 ordered lines, nullable strict-offset validUntil, optional terms/notes, and explicit shippingTotal defaulting to zero. Catalog line inputs provide productId, quantity, discount only; server copies SKU/description/unit/price/currency/tax. Manual lines explicitly use productId null and supply bounded snapshots. Snapshot Contact.name/phoneNumber, OrganizationUnit.name, and authenticated User.displayName using explicit projections during active same-tenant `module.crm_lite` selection; preserve them on unrelated edits. Do not read Contact.customAttributes or wholesale settings. No customer-organization input/FK until a real entity exists.
- QuoteDraftPatch separates metadata from line replacement/conversion. Quote terms <=8000, notes <=4000; line description 1–2000, SKU nullable <=64, unit 1–32, metadata null/object <=16 KiB UTF-8/depth8. Entire normalized commercial header + 1–200 lines <=256 KiB UTF-8 before writes; reject oversize/unknown fields, never truncate. Catalog Product price/SKU/tax values are server-derived; an explicit convert-to-manual operation is required before a user can change them, and the UI visibly labels manual provenance. expectedRevision is required. No client totals, tenant, actor, autonomy, stock, margin or contributor fields.
- Quote numbering is tenant-local Q-000001 through Q-9999999999. Quote mutation receipts and commercial contributors begin here so every subsequent mutation follows the settled concurrency boundary.
- API: GET/POST /api/v1/quotes, GET/PATCH /api/v1/quotes/:id; module.quotes and quote permissions apply. Selecting/resolving Contact also requires module.crm_lite and active same-tenant Contact; selecting a catalog line additionally requires module.catalog. Historical reads use owned snapshots, not live CRM joins.

- [ ] Step 1 — RED: Add tests createDraftIsTenantScopedAndAllocatesMonotoneTenantNumber, rejectsSequenceBeyondMaximumWithoutPublishingNumber, rejectsForeignContactProductAndOrganizationUnit, requiresCrmLiteForContactAndCatalogModuleOnlyForCatalogLines, snapshotsCustomerPhoneUnitAndCreatorDisplayFromTrustedSources, historicalReadDoesNotLiveJoinCRM, storesUncalculatedDraftWithoutPolicyTableOrClientTotals, rejectsUnknownAuthorityAndOversizedCommercialInput, rejectsArbitraryProductPriceOverrides, sameSkuSnapshotsDoNotChangeAfterProductMetadataEdit, reselectProductRefreshesSnapshot, metadataEditPreservesLinePrices, manualConversionIsVisibleAndMarksExceptional, sameKeyReplaysRecordedOutcomeAfterLaterEdit, sameKeyDifferentRequestOrActorConflicts, and API tenant/module/permission denials.
- [ ] Step 2 — Run RED: pnpm test:integration:catalog-quotes. Expected absent quote schema and API cases to fail.
- [ ] Step 3 — Implement Quote/QuoteItem, minimal QuoteCommandReceipt, QuoteCommercialContributor and owned display snapshots/constraints. S02 may take tenant-policy advisory namespace but must not query/create QuotePolicy or QuoteSendIntent; set autonomy snapshot 0 and expose no approval/send command or intent-freeze shim. Quote mutations take command-key then tenant-policy advisory locks; create takes number lock, inserts Quote, then locks needed Contact/Products in sorted order. Use optimistic revision. Product CRUD never locks Quote.
- [ ] Step 4 — GREEN: run DB validate/generate, compare clean-schema SDL and ordered Git-HEAD baseline upgrade with actual SQL, parent applies locally and verifies migration checksum, then focused integration, typecheck and lint. Expected A/B boundaries, snapshots, receipts and guards pass.
- [ ] Step 5 — Independent audit; parent docs/manifest and S02 commit/push before S03.

### Task 3: E15-S03 — Deterministic Calculation

**Files**

- Create packages/database/src/quote-calculation.ts and quote-calculation.test.ts
- Modify packages/database/src/quote-manager.ts, quote-manager.integration.ts, and DB focused config only if its include needs extension

**Interfaces**

- calculateQuote(input: QuoteCalculationInput): QuoteCalculationResult
- validateQuoteDecimal(value: string, field: QuoteDecimalField): string; canonicalize valid decimal strings or throw QuoteCalculationValidationError.
- recalculateQuoteInTransaction(transaction: Prisma.TransactionClient, tenantId: string, quoteId: string, nextRevision: number): Promise<QuoteCalculationResult>; reads stored quote/item inputs, calls the pure BigInt calculator, and persists canonical line/totals, freshly derived calculationInputHash, revision and calculatedRevision in the caller's existing transaction. It never opens a nested transaction and is reused by S05 authority transitions.
- Input uses quote-snapshotted currencyPrecision and ordered decimal-string lines: quantity, unitPrice, discountType/value, taxRate, and shippingTotal. Fixed discount storage cap is NUMERIC(19,4) capacity 999999999999999.9999 but it must also be <= rounded gross and have no excess quote-currency fractional digits. Result returns fixed decimal strings for line gross/discount/net/tax/lineTotal and subtotal/discountTotal/taxTotal/shippingTotal/total.
- Use exact integer/rational operations and HALF_UP. calculationInputHash is SHA-256 over canonical persisted currency/precision, shipping, and ordered line calculation inputs; equivalent normalized decimals hash identically. Each draft create/update recalculates in its transaction, stores line/quote totals and hash, increments revision and sets calculatedRevision=revision. No stale/HTTP totals may pass approval.

- [ ] Step 1 — RED: Add goldens quantityPriceDiscountAndExclusiveTaxGolden, halfUpBoundariesAtPrecisionZeroTwoThreeFour, fixedDiscountIsPerLine, shippingIsUntaxed, lineAndAggregateTotalsAreExact, calculationInputHashIsCanonicalAndChangesWithInputs, discountCeilingUsesExactCrossMultiplication, rejectsPositiveDiscountOnZeroGross, rejectsMissingTaxRateAndMixedCurrency, rejectsFixedDiscountStorageOverflowAndCurrencyExcess, handlesLargeAggregateBeyondNumberSafeIntegerWithoutNumericCoercion, and rejectsExponentNegativeExcessScaleOverflowAndMoreThan200Lines. Golden: 2.5 × 10.00, 10% discount, 8% tax, precision 2 → gross 25.00, discount 2.50, tax 1.80, line total 24.30.
- [ ] Step 2 — Run RED: pnpm exec vitest run packages/database/src/quote-calculation.test.ts. Expected missing calculation exports.
- [ ] Step 3 — Implement pure calculation and integrate every draft write. Preserve item snapshots on unrelated edits. Unset tax rate blocks calculation; explicit zero is an input. Save calculatedRevision and canonical calculationInputHash in the transaction.
- [ ] Step 4 — GREEN: targeted Vitest, pnpm test:integration:catalog-quotes, database validate/generate, typecheck, lint. Expected all Testing Strategy §14 goldens pass.
- [ ] Step 5 — Independent math/security audit; parent docs/manifest and S03 commit/push before S04.

### Task 4: E15-S04 — Quote Policy

**Files**

- Create packages/database/prisma/migrations/20261028200000_e15_quote_policy/migration.sql
- Modify packages/database/prisma/schema.prisma, database index, both focused configs
- Create packages/database/src/quote-policy.ts, quote-policy.test.ts, quote-policy-manager.ts, quote-policy-manager.integration.ts
- Modify packages/database/src/quote-manager.ts, apps/api/src/quotes.ts, quotes.integration.ts

**Interfaces**

- getQuotePolicy(context: TenantContext, database: QuotePolicyDatabase): Promise<QuotePolicyView>; read-only GET returns pure autonomy-0/manual default with revision0 and deterministic hash when row absent, without a write lock or mutation. S04 alone introduces QuotePolicy.
- updateQuotePolicy(context, database, input: QuotePolicyInput, metadata: QuoteMutationMetadata): Promise<QuoteCommandOutcome<QuotePolicyView>>; receipt + tenant policy lock before create/update.
- evaluateQuotePolicy(policy: QuotePolicyView, quote: CalculatedQuote, facts: TrustedQuotePolicyFacts): QuotePolicyEvaluation; return AUTO_APPROVE or HUMAN_REVIEW with stable reasons. TrustedQuotePolicyFacts is built only from DB reads.
- Fields: autonomy 0–3, nullable max amount/currency pair, nullable max discount, nullable minimum margin, stock/new-customer/exceptional-product triggers, self-approval opt-in, monotonic revision and content hash. Defaults include exceptionalProductRequiresApproval=true. Read requires quotes.read; write AND tenant.settings.manage + quotes.approve; module.quotes required.

- [ ] Step 1 — RED: Add defaultsToManualWithoutWriteOnReadAtRevisionZero, absentDefaultHashIsDeterministic, updateCreatesPolicyUnderSharedMutex, requiresBoundedAmountAndCurrencyForAutonomyTwoOrThree, comparesAmountInclusivelyAndCurrencyExactly, blocksAutomaticWhenStockOrProtectedMarginIsUnknown, usesTrustedHistoryAndExceptionalFacts, defaultsExceptionalItemsToHumanReview, appliesLineDiscountRatioWithIntegerComparison, noOpPolicyWriteRetainsRevisionAndHash, changeAndRevertDoesNotResurrectPriorHash, policyHashIncludesRevisionButNotActorOrTimestamp, policyWriteSerializesWithQuoteCommands, and API dual-permission tests.
- [ ] Step 2 — Run RED: pnpm exec vitest run packages/database/src/quote-policy.test.ts and pnpm test:integration:catalog-quotes. Expected missing evaluator/manager failures.
- [ ] Step 3 — Implement tenant-only policy and evaluator. Default autonomy 0, no automatic path, stock false, exceptional approval true, self-approval false, no ceilings. Policy GET is read-only. Writers and Quote commands share tenant advisory mutex. Hash canonical policy fields plus monotonic policy revision, excluding actor/timestamps; no-op writes retain revision/hash.
- [ ] Step 4 — GREEN: both targeted Vitest commands, DB validate/generate, compare clean-schema SDL and ordered Git-HEAD baseline upgrade with actual SQL, parent applies locally and verifies migration checksum, then focused DB/API suite, root typecheck/lint. Expected policy concurrency and hostile-input cases pass.
- [ ] Step 5 — Independent policy audit; parent docs/manifest and S04 commit/push before S05.

### Task 5: E15-S05 — Approval Workflow

**Files**

- Create packages/database/prisma/migrations/20261028210000_e15_quote_approvals/migration.sql
- Modify packages/database/prisma/schema.prisma, database index, both focused configs
- Create packages/database/src/quote-approval-manager.ts and quote-approval-manager.integration.ts
- Modify quote-manager.ts, apps/api/src/quotes.ts and quotes.integration.ts

**Interfaces**

- requestQuoteApproval(context, database, quoteId: string, expectedRevision: number, input: { idempotencyKey: string }, metadata): Promise<QuoteCommandOutcome<QuoteApprovalView>>; all command keys 1–128.
- approveQuote(context, database, quoteId: string, expectedRevision: number, input: { idempotencyKey: string; reasonCode: QuoteApprovalReason; note?: string | null }, metadata): Promise<QuoteCommandOutcome<QuoteApprovalView>>; reason/note <=1000.
- rejectQuote(context, database, quoteId: string, expectedRevision: number, input: { idempotencyKey: string; reasonCode: QuoteRejectionReason; note?: string | null }, metadata): Promise<QuoteCommandOutcome<QuoteApprovalView>>; reason/note <=1000.
- cancelQuote(context, database, quoteId: string, expectedRevision: number, input: { idempotencyKey: string }, metadata): Promise<QuoteCommandOutcome<QuoteCancellationView>>; S05 adds POST /api/v1/quotes/:id/cancel under quotes.create. Already-cancelled/new-key is an `already_cancelled` no-op without second business audit/outbox/revision; original key replays its stored result.
- QuoteApproval retains every request/decision and binds source/resulting revision, policy revision/hash, request actor, decision actor, reasons and timestamps. CommercialContributor relation is written on create/changed quote content. API actor is authenticated context, never body. S05 has no QuoteSendIntent table/query; S08 later patches S02/S05 mutation paths to freeze while any intent is pending.
- Lifecycle: create→draft/rev1; changed edit only unsent draft/pending_approval/approved/rejected with expectedRevision → draft/rev+1, clear current approval/version pointer but preserve history. Request allowed from draft/rejected/approved regardless previous binding or pending_approval only when stale; fresh-key duplicate of a current pending approval conflicts. Request increments/recalculates and clears prior current decision/version pointer while retaining history, then yields pending human review or a new eligible system_policy decision. Approve/reject only current pending_approval with matching revision/policy; both increment/recalculate and bind resulting revision. Changed policy requires fresh request. Cancellation only unsent draft/pending_approval/approved/rejected → cancelled/rev+1; no reopening. Sent/accepted/expired/cancelled terminal; expiry display is derived.
- After command/policy/Quote locks, every approval authority transition reuses S03 recalculateQuoteInTransaction on stored inputs and persists totals, fresh calculationInputHash, and calculatedRevision equal to resulting revision in the same transaction. Request/approve/version/send deny at now >= validUntil; reject/cancel remain allowed after expiry with normal guards. Policy change requires a fresh approval revision even with unchanged commercial content.
- API: POST /api/v1/quotes/:id/approval-request uses quotes.create; /approve and /reject use quotes.approve; all require module.quotes and current active Contact under module.crm_lite. POST /api/v1/quotes/:id/cancel uses quotes.create + module.quotes with current tenant/actor and owned Quote only; no CRM/contact/send eligibility or calculation completeness required.

- [ ] Step 1 — RED: Add lifecycleMatrixEnforcedForCreateEditRequestApproveRejectCancel, changedEditClearsCurrentApprovalButPreservesHistory, requestEligibleFromDraftRejectedApprovedAndStalePendingOnly, currentPendingFreshKeyConflicts, cancelAlreadyCancelledNewKeyIsNoopButReceiptReplayIsStable, cancelUncalculatedOrMissingTaxDoesNotFabricateTotals, quoteCancelDoesNotRequireCRMOrSendEligibility, rejectAndCancelAllowedAfterExpiryButApproveDenied, manualAndAssistedRequestPendingDecision, eachAuthorityTransitionIncrementsQuoteAndRecalculatesStoredInputsAndHash, approvalBindsResultingRevision, eligibleAutonomyUsesSystemPolicyActorWithoutUserId, contributorsCannotApproveByDefault, selfApprovalRequiresExplicitTenantOptIn, policyReauthorizationCreatesNewRevision, staleQuoteRevisionAndPolicyHashFail, decisionLocksAndRechecksDeadlineAfterWait, twoConcurrentApprovalsCreateOneDecision, approvalAuditAndOutboxRollbackTogether, and API permission/module tests. Pending-intent freeze regressions are implemented in S08 only.
- [ ] Step 2 — Run RED: pnpm test:integration:catalog-quotes. Expected missing approval contract tests.
- [ ] Step 3 — Implement narrow QuoteApproval transaction; do not create generic ActionRequests. Acquire command → policy → Quote → sorted related rows; reread quote, policy, contributors, contact and calculation; sample clock after locks. Increment Quote.revision and call the S03 transaction-aware canonical recalculator on stored inputs, persisting canonical totals, fresh calculationInputHash and calculatedRevision at that resulting revision. Quote cancellation uses tenant/current actor/module.quotes/quotes.create/owned Quote guards only. For a valid calculated cancellation, recalculate at next revision; for an uncalculated or missing-tax draft, preserve inputs and leave all computed totals/hash/calculatedRevision null. Autonomy0/1 requires human. Levels2/3 use only exact eligible results; system actor has null ID. Persist receipt, approval, audit/outbox atomically.
- [ ] Step 4 — GREEN: DB validate/generate, compare clean-schema SDL and ordered Git-HEAD baseline upgrade with actual SQL, parent applies locally and verifies migration checksum, then focused DB/API suite, typecheck, lint. Expected lifecycle, exactly-once decision, SoD and no-fake-actor tests pass.
- [ ] Step 5 — Independent SoD/concurrency audit; parent docs/manifest and S05 commit/push before S06.

### Task 6: E15-S06 — Catalog and Quote UI

**Files**

- Modify apps/web/app/app/tenant-app-navigation.ts
- Create apps/web/app/app/catalog/page.tsx, catalog-client.tsx, catalog-view-model.ts, catalog-view-model.test.ts, catalog.module.css
- Create apps/web/app/app/catalog/catalog-api.ts, catalog-list.tsx, catalog-editor.tsx; keep API, view model, list, and edit responsibilities separate.
- Create apps/web/app/app/quotes/page.tsx, quotes-client.tsx, quotes-api.ts, quotes-view-model.ts, quotes-view-model.test.ts, quote-list.tsx, quote-editor.tsx, quote-editor-model.ts, quote-editor-model.test.ts, quote-approval-panel.tsx, quote-policy-panel.tsx, quotes.module.css
- Reuse current API-fetch/UI patterns from appointments-client.tsx and navigation tests; reuse stableCommandKey and beginCommandIntent from appointment-command-key.ts. No new browser/test dependency.

**Interfaces**

- catalog-api.ts: loadCatalog(filters), saveProduct(input), archiveProduct(id); catalog list/editor components consume bounded view-model types.
- quotes-api.ts: loadQuotes(filters), saveQuoteDraft(id, expectedRevision, input), request/approve/reject, load/update policy; existing client orchestrates focused list/editor/approval/policy components.
- Use API envelope, exact decimal strings, exact module/permission state and recorded replay outcome distinct from latest Quote. S06 exposes live draft/calculation/approval/policy only; no frozen version preview/history and no send intent controls yet.

- [ ] Step 1 — RED: Add catalogGatesReadOnlyAndModuleStates, catalogErrorEmptyAndLoadedStates, quoteListAndEditorKeepExactDecimalStringsIncludingHugeTotals, quoteActionsFollowPermissionAndStatus, quoteEditorSerializesBoundedCatalogAndManualLinesWithoutTotalsOrActor, approvalAndPolicyPanelsReflectCurrentGuards, replayOutcomeIsLabeledSeparateFromCurrentQuote, and navigationDestinationsAreRealOnlyForEntitledReaders.
- [ ] Step 2 — Run RED: pnpm exec vitest run apps/web/app/app/catalog/catalog-view-model.test.ts apps/web/app/app/quotes/quotes-view-model.test.ts apps/web/app/app/quotes/quote-editor-model.test.ts apps/web/app/app/tenant-app-navigation.test.ts. Expected missing page/view-model behavior.
- [ ] Step 3 — Implement real pages against S01–S05 APIs, split API/model/list/editor/approval/policy responsibilities across focused files. Replace href:null; support list/create/edit/archive, catalog/manual line operations, calculations, approvals, policy. Render read-only/loading/empty/error/module states. Preserve command key across identical retry; start fresh key for a distinct intent. No version/send actions before S07/S08.
- [ ] Step 4 — GREEN: targeted Vitest, pnpm typecheck, pnpm lint, pnpm --filter @whatsapp-platform/web build. Parent verifies responsive desktop/tablet/mobile, keyboard/focus, readonly and module-disabled behavior in browser. No automated browser harness exists; record manual evidence honestly.
- [ ] Step 5 — Independent UX/API audit; parent docs/manifest and S06 commit/push before S07.

### Task 7: E15-S07 — Immutable Quote Version

**Files**

- Create packages/database/prisma/migrations/20261028220000_e15_quote_versions/migration.sql
- Modify packages/database/prisma/schema.prisma, database index, focused DB/API configs
- Create packages/database/src/quote-version-manager.ts and quote-version-manager.integration.ts
- Modify packages/database/src/quote-approval-manager.ts, apps/api/src/quotes.ts, quotes.integration.ts
- Create apps/web/app/app/quotes/quote-version-preview.tsx and quote-version-preview.test.ts; modify quotes-api.ts, quotes-client.tsx, quotes-view-model.ts and tests

**Interfaces**

- createQuoteVersionSnapshotInTransaction(context: TenantContext, transaction: Prisma.TransactionClient, quoteId: string, approvalId: string): Promise<QuoteVersion>; caller already holds command/policy/Quote locks and exact approval revision.
- getQuoteVersion(context: TenantContext, database: QuoteVersionReadDatabase, quoteId: string, version: number): Promise<QuoteVersionView>; tenant-scoped.
- API: GET /api/v1/quotes/:id/versions returns tenant-scoped version history; GET /api/v1/quotes/:id/versions/:version returns a bounded immutable snapshot view under module.quotes and quotes.read.
- Snapshot includes ordered lines and decimal inputs/results, quote identity/validity/terms and owned customer name/phone, OU name, salesperson display-name snapshots, source revision, commercial content hash, policy revision/hash, exact approval ID/decision evidence, validated public TenantTheme.config (<=64 KiB projection), and no typed FK for nonexistent template/document models. Approval evidence is <=768 KiB and version snapshot <=1 MiB UTF-8; reject before insert, never truncate. Before reusing any existing version, compare source revision, commercial hash, exact approval decision ID and policy binding; fresh approval evidence gets a new version. Snapshot/currentVersion bookkeeping does not increment Quote.revision. Preview renders only these frozen snapshot fields, never live joins. No E16 artifacts.

- [ ] Step 1 — RED: Add finalApprovalCreatesNextImmutableVersionAtomically, snapshotCarriesCalculationPolicyApprovalAndBrandingEvidence, snapshotCopiesCustomerPhoneUnitAndSalespersonDisplay, historicalPreviewDoesNotQueryLiveContactProductUserOrTheme, versionReuseRequiresSourceRevisionCommercialHashDecisionIdAndPolicy, changedPolicyNeverResurrectsOldApprovalVersion, catalogPolicyAndBrandingChangesDoNotMutateOldVersion, versionIsTenantScopedAndOrdered, previewRoutesRequireQuoteReadAndTenantOwnership, repeatedApprovalCommandReplaysOriginalVersionOutcome, and snapshotContainsNoPdfOrFabricatedTemplateOrMissingEntityFK.
- [ ] Step 2 — Run RED: pnpm test:integration:catalog-quotes. Expected QuoteVersion tests fail.
- [ ] Step 3 — Implement immutable tenant QuoteVersion and invoke inside final approval transaction. Unique tenant/quote/version. Increment only on a new valid final approval for new source revision/approval evidence. Store bounded commercial JSON without FK columns for absent E16 models. Implement explicit history/preview API and read-only UI component from snapshot only.
- [ ] Step 4 — GREEN: DB validate/generate, compare clean-schema SDL and ordered Git-HEAD baseline upgrade with actual SQL, parent applies locally and verifies migration checksum, then focused DB/API/UI suites, typecheck, lint. Verify old snapshots remain unchanged after live Contact/OU/User/Product/policy/theme changes.
- [ ] Step 5 — Independent snapshot audit; parent docs/manifest and S07 commit/push before S08.

### Task 8: E15-S08 — Durable Send Intent

**Files**

- Create packages/database/prisma/migrations/20261028230000_e15_quote_send_intents/migration.sql
- Modify packages/database/prisma/schema.prisma, database index, both focused configs
- Create packages/database/src/quote-send-manager.ts and quote-send-manager.integration.ts
- Modify packages/database/src/quote-manager.ts, quote-approval-manager.ts and their existing integration tests to add cross-story guards only after QuoteSendIntent exists; modify apps/api/src/quotes.ts and quotes.integration.ts; create apps/web/app/app/quotes/quote-send-intent-panel.tsx and quote-send-intent-panel.test.ts; modify quotes-api.ts, quotes-client.tsx, quotes-view-model.ts and tests

**Interfaces**

- requestQuoteSend(context: TenantContext, database: QuoteSendDatabase, input: QuoteSendRequestInput, metadata: QuoteMutationMetadata): Promise<QuoteCommandOutcome<QuoteSendIntentView>>. Input: Quote ID, approved QuoteVersion ID, Conversation ID, ChannelAccount ID, idempotency key; Contact is derived from Quote.
- cancelQuoteSend(context, database, quoteId: string, intentId: string, input: { idempotencyKey: string }, metadata): Promise<QuoteCommandOutcome<QuoteSendIntentView>>; cancellation requires active tenant/current user, quotes.send, module.quotes and tenant-owned Quote/Intent only. It deliberately does not require validity, unchanged policy, active Contact/Conversation/Channel, CRM/messaging/documents entitlements, or current send eligibility, so revocation cannot strand a pending request.
- Validate module.quotes + quotes.send + module.crm_lite + module.messaging.basic, active same-tenant Contact and trusted same-contact active Conversation/Channel, approved current Quote/version and approval/policy hash, current revision/calculation, deadline, and current authority after locks. Explicitly authenticated human request is permitted; no AUTO-only policy rule.
- QuoteSendIntent fields: tenant, quote/version, contact, conversation/channel, authenticated requester, idempotency key, canonical request hash, state, timestamps. States PENDING_DOCUMENT/CANCELLED. Add partial unique index for one active intent per tenant/version/channel. Append Audit+Outbox event quote.send_requested. No consumer/worker.

- [ ] Step 1 — RED: Add requiresAllEntitlementsActiveContactAndTrustedSameContactChannel, authenticatedHumanMayRequestWithoutAutonomyAutoGate, rejectsTenantOrContactMismatchWithoutExistenceLeak, onePendingIntentPerVersionChannel, multipleChannelsCanBePending, S08PatchAddsAnyIntentFreezeToS02AndS05Commands, cancelChannelAStillLeavesQuoteFrozenByPendingB, editAndReauthorizeDeniedUntilAllChannelsCancelled, currentPendingCountSeparateFromRecordedOutcome, cancellationWorksAfterCRMContactMessagingChannelPolicyAndExpiryRevocation, cancellationStillRequiresCurrentTenantQuotesSendAndOwnedResource, cancelAllUnfreezesWithoutRevisionBump, sameKeySameRequestReturnsOriginalOutcomeAfterCancel, sameKeyDifferentRequestOrActorConflicts, cancelledIntentCannotBeRetriedWithOldKey, sendIntentAuditAndOutboxRollbackTogether, pendingIntentNeverSetsQuoteSentOrEmitsQuoteSent, and intent-panel state/permission tests.
- [ ] Step 2 — Run RED: pnpm test:integration:catalog-quotes and targeted Quotes UI Vitest. Expected missing intent and UI state fail.
- [ ] Step 3 — Implement durable request/cancel and focused intent panel. Request acquires command-key → policy → Quote → sorted related locks; reread modules, permissions, active contact/resource ownership, approval/version/hash/calculation and time. Cancellation follows command/receipt → tenant-policy advisory → Quote → owned Intent lock order, but checks only current tenant/user, module.quotes, quotes.send, and owned Quote/Intent; do not read/require policy validity, Contact, Conversation, Channel or other entitlements. Insert intent, minimal immutable receipt, Audit and quote.send_requested outbox atomically. Patch S02 draft + S05 request/approve/reject/quote-cancel paths to deny on any pending intent; no earlier story queries the missing table. Mutation/read responses expose current pending-intent count separately from the immutable replay outcome. Send-intent create/cancel does not bump Quote.revision/currentVersion. Unfreeze source only when zero intents remain pending; fresh requests use a new key. Leave Quote approved, sentAt null; never emit quote.sent, call provider or create document artifacts. UI says “document pending” and offers cancel.
- [ ] Step 4 — GREEN: DB validate/generate, compare clean-schema SDL and ordered Git-HEAD baseline upgrade with actual SQL, parent applies locally and verifies migration checksum, then focused DB/API/UI suites, typecheck/lint. Expected exact replay/cancellation/partial uniqueness and no-delivery assertions pass.
- [ ] Step 5 — Independent scope/idempotency audit; parent docs/manifest and S08 commit/push before epic closure.

## Epic Closure Gate

- Run pnpm test, pnpm lint, pnpm typecheck, pnpm build, pnpm test:security:tenant-isolation, focused pnpm test:integration:catalog-quotes, DB migration validation/generation, and clean baseline + ordered upgrade against the parent-owned disposable PostgreSQL database. Record fresh counts, skipped tests, and setup failures.
- Independently audit the eight-story diff against the design, tests, tenant/permission boundaries and review-focus cases. Check no test claims provider/PDF delivery; no secrets or `.env` contents were printed, copied, staged, or manually inspected. Authorized local configuration may load internally through the guarded helper. Migrations are append-only, docs/manifest agree, and each story SHA was pushed before the next.
- Parent reports branch/remote/mainline state precisely. Passing gates or push does not imply main merge, production PDF, or real WhatsApp delivery.
