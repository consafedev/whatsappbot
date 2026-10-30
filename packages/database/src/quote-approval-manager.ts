import { createHash } from "node:crypto";
import { Prisma, type Quote, type QuoteApproval } from "./generated/prisma/client";
import {
  QuoteCalculationValidationError,
  recalculateQuoteInTransaction,
} from "./quote-calculation";
import { quoteCommandLock, quoteTenantPolicyLock } from "./quote-command-locks";
import {
  QuoteAuthorizationError,
  QuoteCommandConflictError,
  type QuoteCommandOutcome,
  type QuoteMutationMetadata,
  QuoteNotFoundError,
  type QuoteRecordedOutcome,
  QuoteRevisionConflictError,
  QuoteValidationError,
} from "./quote-manager";
import { DEFAULT_QUOTE_POLICY, evaluateQuotePolicy, type QuotePolicyView } from "./quote-policy";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess, type TenantTransactionDatabase } from "./tenant-data-access";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

export type QuoteApprovalReason = string;
export type QuoteRejectionReason = string;

export type QuoteApprovalInput = Readonly<{ idempotencyKey: string }>;
export type QuoteDecisionInput = Readonly<{
  idempotencyKey: string;
  reasonCode: QuoteApprovalReason | QuoteRejectionReason;
  note?: string | null;
}>;

export type QuoteApprovalView = Readonly<{
  id: string;
  quoteId: string;
  status: string;
  quoteStatus: string;
  revision: number;
  sourceRevision: number;
  resultingRevision: number;
  policyRevision: number;
  policyHash: string;
  allowSelfApprovalSnapshot: boolean;
  requestActorUserId: string;
  decisionActorType: string | null;
  decisionActorUserId: string | null;
  requestReasonCodes: readonly string[];
  decisionReasonCode: string | null;
  decisionNote: string | null;
  requestedAt: string;
  decidedAt: string | null;
  isCurrent: boolean;
}>;

export type QuoteCancellationView = Readonly<{
  quoteId: string;
  number: string;
  status: string;
  revision: number;
}>;

type QuoteCancellationResult = "cancelled" | "already_cancelled";
type QuoteCancellationRecordedOutcome = QuoteRecordedOutcome &
  Readonly<{ result: QuoteCancellationResult }>;
type QuoteCancellationCommandOutcome = Omit<
  QuoteCommandOutcome<QuoteCancellationView>,
  "recordedOutcome"
> &
  Readonly<{ recordedOutcome: QuoteCancellationRecordedOutcome }>;

export type QuoteApprovalDatabase = TenantTransactionDatabase &
  Pick<
    Prisma.TransactionClient,
    | "quote"
    | "quoteItem"
    | "quoteApproval"
    | "quotePolicy"
    | "quoteCommandReceipt"
    | "quoteCommercialContributor"
    | "contact"
    | "user"
    | "tenantEntitlement"
    | "auditLog"
    | "domainEventOutbox"
  >;

type ApprovalCommand = "approval_request" | "approve" | "reject" | "cancel";
type LoadedQuote = NonNullable<
  Awaited<ReturnType<Prisma.TransactionClient["quote"]["findFirst"]>>
> & {
  items: Array<{
    id: string;
    position: number;
    source: string;
    productId: string | null;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    currency: string;
    taxRate: Prisma.Decimal | null;
    discountKind: string;
    discountValue: Prisma.Decimal;
    isExceptional: boolean;
    grossTotal: Prisma.Decimal | null;
    discountTotal: Prisma.Decimal | null;
    netTotal: Prisma.Decimal | null;
    taxTotal: Prisma.Decimal | null;
    lineTotal: Prisma.Decimal | null;
  }>;
  currentApproval: QuoteApproval | null;
};

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASON_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const SYSTEM_POLICY_APPROVAL_REASON = "policy_eligible" as const;

function fail(message: string): never {
  throw new QuoteValidationError(message);
}

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function normalizedKey(value: unknown): string {
  if (typeof value !== "string")
    return fail("idempotencyKey must contain 1 to 128 printable characters");
  const key = value.trim();
  if (
    key.length < 1 ||
    key.length > 128 ||
    [...key].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  )
    return fail("idempotencyKey must contain 1 to 128 printable characters");
  return key;
}

function normalizedId(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_V7.test(value)) return fail(`${field} must be a UUIDv7`);
  return value.toLowerCase();
}

function metadataValid(metadata: QuoteMutationMetadata): string {
  if (metadata === null || typeof metadata !== "object") return fail("metadata is required");
  const actorId = normalizedId(metadata.actorUserId, "actorUserId");
  if (
    typeof metadata.requestId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(metadata.requestId)
  )
    return fail("requestId must be 1 to 128 safe characters");
  return actorId;
}

function normalizeInput<T extends object>(input: unknown, allowedKeys: readonly string[]): T {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return fail("quote command input is required");
  if (Object.keys(input).some((key) => !allowedKeys.includes(key)))
    return fail("quote command input contains an unknown field");
  return input as T;
}

function normalizedDecision(input: unknown): Readonly<{
  idempotencyKey: string;
  reasonCode: string;
  note: string | null;
}> {
  const value = normalizeInput<{ idempotencyKey: unknown; reasonCode: unknown; note?: unknown }>(
    input,
    ["idempotencyKey", "reasonCode", "note"],
  );
  const key = normalizedKey(value.idempotencyKey);
  if (typeof value.reasonCode !== "string" || !REASON_CODE.test(value.reasonCode))
    return fail("reasonCode must be a lowercase reason code up to 64 characters");
  if (value.note !== undefined && value.note !== null && typeof value.note !== "string")
    return fail("note must be a string or null");
  const note = typeof value.note === "string" ? value.note.trim() : null;
  if (note !== null && note.length > 1000) return fail("note must not exceed 1000 characters");
  return { idempotencyKey: key, reasonCode: value.reasonCode, note };
}

async function lockQuote(transaction: Prisma.TransactionClient, tenantId: string, quoteId: string) {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "quotes" WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${quoteId}::uuid FOR UPDATE`,
  );
  if (rows.length === 0) throw new QuoteNotFoundError(quoteId);
  const quote = await transaction.quote.findFirst({
    where: { tenantId, id: quoteId },
    include: { items: { orderBy: { position: "asc" } }, currentApproval: true },
  });
  if (quote === null) throw new QuoteNotFoundError(quoteId);
  return quote as LoadedQuote;
}

async function lockUser(transaction: Prisma.TransactionClient, tenantId: string, actorId: string) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "tenant_user" WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${actorId}::uuid FOR UPDATE`,
  );
}

async function lockContact(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  contactId: string,
) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "contact" WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${contactId}::uuid FOR UPDATE`,
  );
}

async function revalidateAuthority(
  transaction: Prisma.TransactionClient,
  tenant: TenantContext,
  actorId: string,
  command: ApprovalCommand,
  contactId: string | null,
): Promise<void> {
  await assertTenantOperational(tenant, transaction);
  const actor = await transaction.user.findFirst({
    select: { id: true },
    where: { id: actorId, tenantId: tenant.tenantId, status: "active" },
  });
  if (actor === null)
    throw new QuoteValidationError("Authenticated actor is not active in this tenant");
  await assertTenantModuleEntitled(tenant, "module.quotes", transaction);
  if (contactId !== null) {
    await assertTenantModuleEntitled(tenant, "module.crm_lite", transaction);
  }
  const requiredPermission =
    command === "approve" || command === "reject" ? "quotes.approve" : "quotes.create";
  const effective = await createTenantDataAccess(tenant, transaction).permissions.resolveForUser(
    actorId,
  );
  if (!effective.has(requiredPermission))
    throw new QuoteAuthorizationError(`${requiredPermission} permission is required`);
  if (contactId !== null) {
    const contact = await transaction.contact.findFirst({
      select: { id: true },
      where: { tenantId: tenant.tenantId, id: contactId, status: "ACTIVE" },
    });
    if (contact === null)
      throw new QuoteValidationError("Contact must be active and belong to the tenant");
  }
}

async function currentPolicy(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<QuotePolicyView> {
  const row = await transaction.quotePolicy.findUnique({ where: { tenantId } });
  if (row === null) return DEFAULT_QUOTE_POLICY;
  return {
    autonomyLevel: row.autonomyLevel as QuotePolicyView["autonomyLevel"],
    maxAutoSendAmount: row.maxAutoSendAmount?.toString() ?? null,
    maxAutoSendCurrency: row.maxAutoSendCurrency?.trim() ?? null,
    maxDiscountPercent: row.maxDiscountPercent?.toString() ?? null,
    minMarginPercent: row.minMarginPercent?.toString() ?? null,
    requireStock: row.requireStock,
    newCustomerRequiresApproval: row.newCustomerRequiresApproval,
    exceptionalProductRequiresApproval: row.exceptionalProductRequiresApproval,
    allowSelfApproval: row.allowSelfApproval,
    revision: row.revision,
    contentHash: row.contentHash.trim(),
  };
}

function recordedOutcome(
  quote: Quote,
  approvalId?: string,
): QuoteRecordedOutcome & { approvalId?: string } {
  return {
    quoteId: quote.id,
    number: quote.number,
    status: quote.status,
    revision: quote.revision,
    ...(approvalId === undefined ? {} : { approvalId }),
  };
}

function approvalView(quote: LoadedQuote, approval: QuoteApproval): QuoteApprovalView {
  const reasons = Array.isArray(approval.requestReasonCodes) ? approval.requestReasonCodes : [];
  return {
    id: approval.id,
    quoteId: quote.id,
    status: approval.status,
    quoteStatus: quote.status,
    revision: quote.revision,
    sourceRevision: approval.sourceRevision,
    resultingRevision: approval.resultingRevision,
    policyRevision: approval.policyRevision,
    policyHash: approval.policyHash.trim(),
    allowSelfApprovalSnapshot: approval.allowSelfApprovalSnapshot,
    requestActorUserId: approval.requestActorUserId,
    decisionActorType: approval.decisionActorType,
    decisionActorUserId: approval.decisionActorUserId,
    requestReasonCodes: reasons.filter((reason): reason is string => typeof reason === "string"),
    decisionReasonCode: approval.decisionReasonCode,
    decisionNote: approval.decisionNote,
    requestedAt: approval.requestedAt.toISOString(),
    decidedAt: approval.decidedAt?.toISOString() ?? null,
    isCurrent: quote.currentApproval?.id === approval.id,
  };
}

async function currentApprovalView(
  transaction: Prisma.TransactionClient,
  quote: LoadedQuote,
  recordedApprovalId?: string,
): Promise<QuoteApprovalView> {
  const approval =
    quote.currentApproval ??
    (recordedApprovalId === undefined
      ? null
      : await transaction.quoteApproval.findFirst({
          where: { tenantId: quote.tenantId, quoteId: quote.id, id: recordedApprovalId },
        }));
  if (approval === null)
    throw new QuoteCommandConflictError("Quote has no approval history for this receipt");
  return approvalView(quote, approval);
}

function cancellationView(quote: Quote): QuoteCancellationView {
  return {
    quoteId: quote.id,
    number: quote.number,
    status: quote.status,
    revision: quote.revision,
  };
}

function receiptOutcome(
  value: Prisma.JsonValue,
): QuoteRecordedOutcome & { approvalId?: string; result?: unknown } {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new QuoteCommandConflictError("Quote receipt outcome is invalid");
  const candidate = value as unknown as QuoteRecordedOutcome & {
    approvalId?: string;
    result?: unknown;
  };
  if (
    typeof candidate.quoteId !== "string" ||
    typeof candidate.number !== "string" ||
    typeof candidate.status !== "string" ||
    !Number.isSafeInteger(candidate.revision)
  )
    throw new QuoteCommandConflictError("Quote receipt outcome is invalid");
  return candidate;
}

function cancellationRecordedOutcome(
  value: QuoteRecordedOutcome,
): QuoteCancellationRecordedOutcome {
  const candidate = value as QuoteRecordedOutcome & { result?: unknown };
  if (candidate.result !== "cancelled" && candidate.result !== "already_cancelled")
    throw new QuoteCommandConflictError("Quote cancellation receipt outcome is invalid");
  return candidate as QuoteCancellationRecordedOutcome;
}

async function replay<T>(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  quote: LoadedQuote,
  actorId: string,
  key: string,
  command: ApprovalCommand,
  requestHash: string,
  project: (quote: LoadedQuote, approvalId?: string) => Promise<T> | T,
): Promise<QuoteCommandOutcome<T> | null> {
  const receipt = await transaction.quoteCommandReceipt.findUnique({
    where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: key } },
  });
  if (receipt === null) return null;
  const commandType = command;
  if (
    receipt.resourceId !== quote.id ||
    receipt.quoteId !== quote.id ||
    receipt.actorUserId !== actorId ||
    receipt.commandType !== commandType ||
    receipt.requestHash !== requestHash
  )
    throw new QuoteCommandConflictError(
      "Idempotency key was already used by another quote command",
    );
  return {
    replayed: true,
    recordedOutcome: receiptOutcome(receipt.recordedOutcome),
    current: await project(quote, receiptOutcome(receipt.recordedOutcome).approvalId),
  };
}

async function storeReceipt(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  quote: Quote,
  actorId: string,
  key: string,
  command: ApprovalCommand,
  requestHash: string,
  approvalId?: string,
  recordedOutcomeOverride?: QuoteRecordedOutcome,
): Promise<void> {
  await transaction.quoteCommandReceipt.create({
    data: {
      tenantId,
      resourceId: quote.id,
      quoteId: quote.id,
      actorUserId: actorId,
      idempotencyKey: key,
      commandType: command,
      requestHash,
      recordedOutcome: (recordedOutcomeOverride ??
        recordedOutcome(quote, approvalId)) as Prisma.InputJsonValue,
    },
  });
}

function requestHash(
  command: ApprovalCommand,
  quoteId: string,
  expectedRevision: number,
  input: object,
) {
  return digest({ command, resourceId: quoteId, expectedRevision, input });
}

async function assertDeadline(quote: LoadedQuote, now: Date): Promise<void> {
  if (quote.validUntil !== null && now.getTime() >= quote.validUntil.getTime())
    throw new QuoteValidationError("Quote validity deadline has passed");
}

function policyIsCurrent(quote: LoadedQuote, policy: QuotePolicyView): boolean {
  return (
    quote.approvalPolicyRevision === policy.revision &&
    quote.approvalPolicyHash === policy.contentHash
  );
}

async function calculate(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  quoteId: string,
  revision: number,
) {
  try {
    return await recalculateQuoteInTransaction(transaction, tenantId, quoteId, revision);
  } catch (error) {
    if (error instanceof QuoteCalculationValidationError)
      throw new QuoteValidationError(error.message);
    throw error;
  }
}

async function fetchLoadedQuote(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  quoteId: string,
): Promise<LoadedQuote> {
  const quote = await transaction.quote.findFirst({
    where: { tenantId, id: quoteId },
    include: { items: { orderBy: { position: "asc" } }, currentApproval: true },
  });
  if (quote === null) throw new QuoteNotFoundError(quoteId);
  return quote as LoadedQuote;
}

function requiredCalculation(quote: LoadedQuote): void {
  if (
    quote.calculatedRevision !== quote.revision ||
    quote.calculationInputHash === null ||
    quote.subtotal === null ||
    quote.discountTotal === null ||
    quote.taxTotal === null ||
    quote.total === null ||
    quote.items.some((item) => item.taxRate === null)
  )
    throw new QuoteValidationError(
      "Quote must have complete current tax calculation before approval",
    );
}

async function evaluateRequest(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  quote: LoadedQuote,
  policy: QuotePolicyView,
  calculation: Awaited<ReturnType<typeof calculate>>,
): Promise<Readonly<{ decision: "AUTO_APPROVE" | "HUMAN_REVIEW"; reasons: readonly string[] }>> {
  const prior = await transaction.quote.findFirst({
    select: { id: true },
    where: {
      tenantId,
      contactId: quote.contactId,
      id: { not: quote.id },
      status: { in: ["sent", "accepted"] },
    },
  });
  const result = evaluateQuotePolicy(
    policy,
    {
      currency: quote.currency,
      total: calculation.total,
      lines: calculation.lines,
    },
    {
      stockAvailable: null,
      marginPercent: null,
      returningCustomer: prior !== null,
      exceptionalProduct: quote.items.some((item) => item.isExceptional),
    },
  );
  return result;
}

function assertEditable(quote: LoadedQuote): void {
  if (!["draft", "pending_approval", "rejected", "approved"].includes(quote.status))
    throw new QuoteValidationError("Quote is not eligible for an approval request");
}

async function writeAuditAndOutbox(
  transaction: Prisma.TransactionClient,
  tenant: TenantContext,
  quote: Quote,
  action: string,
  actorId: string | null,
  actorType: "tenant_user" | "system_policy",
  requestId: string,
  beforeStatus: string,
  eventType = action,
): Promise<void> {
  const access = createTenantDataAccess(tenant, transaction);
  await access.audit.append({
    action,
    actorId,
    actorType,
    beforeSummary: { revision: quote.revision - 1, status: beforeStatus },
    afterSummary: { revision: quote.revision, status: quote.status },
    entityId: quote.id,
    entityType: "Quote",
    organizationUnitId: quote.organizationUnitId,
    requestId,
  });
  await access.outbox.append({
    aggregateId: quote.id,
    aggregateType: "Quote",
    eventType,
    payload: { quoteId: quote.id, revision: quote.revision },
  });
}

export async function requestQuoteApproval(
  context: TenantContext,
  database: QuoteApprovalDatabase,
  quoteId: string,
  expectedRevision: number,
  input: QuoteApprovalInput,
  metadata: QuoteMutationMetadata,
): Promise<QuoteCommandOutcome<QuoteApprovalView>> {
  const tenant = createTenantContext(context.tenantId);
  const actualQuoteId = normalizedId(quoteId, "quoteId");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    fail("expectedRevision must be a positive safe integer");
  const normalized = normalizeInput<QuoteApprovalInput & { idempotencyKey: unknown }>(input, [
    "idempotencyKey",
  ]);
  const key = normalizedKey(normalized.idempotencyKey);
  const actorId = metadataValid(metadata);
  const command: ApprovalCommand = "approval_request";
  const commandHash = requestHash(command, actualQuoteId, expectedRevision, {});

  return database.$transaction(async (transaction) => {
    await quoteCommandLock(transaction, tenant.tenantId, key);
    await quoteTenantPolicyLock(transaction, tenant.tenantId);
    const quote = await lockQuote(transaction, tenant.tenantId, actualQuoteId);
    await lockContact(transaction, tenant.tenantId, quote.contactId);
    await lockUser(transaction, tenant.tenantId, actorId);
    await revalidateAuthority(transaction, tenant, actorId, command, quote.contactId);
    const replayed = await replay(
      transaction,
      tenant.tenantId,
      quote,
      actorId,
      key,
      command,
      commandHash,
      (row, approvalId) => currentApprovalView(transaction, row, approvalId),
    );
    if (replayed !== null) return replayed;
    if (quote.revision !== expectedRevision)
      throw new QuoteRevisionConflictError("Quote revision does not match expectedRevision");
    const policy = await currentPolicy(transaction, tenant.tenantId);
    if (quote.status === "pending_approval" && policyIsCurrent(quote, policy))
      throw new QuoteCommandConflictError("Quote already has a current pending approval");
    assertEditable(quote);
    const now = new Date();
    await assertDeadline(quote, now);
    const nextRevision = quote.revision + 1;
    const calculation = await calculate(transaction, tenant.tenantId, quote.id, nextRevision);
    const evaluation = await evaluateRequest(
      transaction,
      tenant.tenantId,
      quote,
      policy,
      calculation,
    );
    await transaction.quote.update({
      where: { tenantId_id: { tenantId: tenant.tenantId, id: quote.id } },
      data: {
        status: evaluation.decision === "AUTO_APPROVE" ? "approved" : "pending_approval",
        autonomyLevel: policy.autonomyLevel,
        approvalPolicyRevision: policy.revision,
        approvalPolicyHash: policy.contentHash,
      },
    });
    const approval = await transaction.quoteApproval.create({
      data: {
        tenantId: tenant.tenantId,
        quoteId: quote.id,
        sourceRevision: quote.revision,
        resultingRevision: nextRevision,
        policyRevision: policy.revision,
        policyHash: policy.contentHash,
        allowSelfApprovalSnapshot: policy.allowSelfApproval,
        requestActorUserId: actorId,
        status: evaluation.decision === "AUTO_APPROVE" ? "approved" : "pending",
        requestReasonCodes: [...evaluation.reasons],
        ...(evaluation.decision === "AUTO_APPROVE"
          ? {
              decisionActorType: "system_policy",
              decisionReasonCode: SYSTEM_POLICY_APPROVAL_REASON,
              decidedAt: now,
            }
          : {}),
      },
    });
    await transaction.quote.update({
      where: { tenantId_id: { tenantId: tenant.tenantId, id: quote.id } },
      data: { currentApprovalId: approval.id },
    });
    const currentQuote = await fetchLoadedQuote(transaction, tenant.tenantId, quote.id);
    const action =
      evaluation.decision === "AUTO_APPROVE" ? "quote.approved" : "quote.approval_requested";
    await writeAuditAndOutbox(
      transaction,
      tenant,
      currentQuote,
      action,
      evaluation.decision === "AUTO_APPROVE" ? null : actorId,
      evaluation.decision === "AUTO_APPROVE" ? "system_policy" : "tenant_user",
      metadata.requestId,
      quote.status,
      evaluation.decision === "AUTO_APPROVE" ? "quote.approved" : "quote.approval.requested",
    );
    await storeReceipt(
      transaction,
      tenant.tenantId,
      currentQuote,
      actorId,
      key,
      command,
      commandHash,
      approval.id,
    );
    return {
      replayed: false,
      recordedOutcome: recordedOutcome(currentQuote, approval.id),
      current: approvalView(currentQuote, approval),
    };
  });
}

async function decideQuoteApproval(
  context: TenantContext,
  database: QuoteApprovalDatabase,
  quoteId: string,
  expectedRevision: number,
  input: QuoteDecisionInput,
  metadata: QuoteMutationMetadata,
  decision: "approved" | "rejected",
): Promise<QuoteCommandOutcome<QuoteApprovalView>> {
  const tenant = createTenantContext(context.tenantId);
  const actualQuoteId = normalizedId(quoteId, "quoteId");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    fail("expectedRevision must be a positive safe integer");
  const normalized = normalizedDecision(input);
  const actorId = metadataValid(metadata);
  const command: ApprovalCommand = decision === "approved" ? "approve" : "reject";
  const commandHash = requestHash(command, actualQuoteId, expectedRevision, {
    reasonCode: normalized.reasonCode,
    note: normalized.note,
  });

  return database.$transaction(async (transaction) => {
    await quoteCommandLock(transaction, tenant.tenantId, normalized.idempotencyKey);
    await quoteTenantPolicyLock(transaction, tenant.tenantId);
    const quote = await lockQuote(transaction, tenant.tenantId, actualQuoteId);
    await lockContact(transaction, tenant.tenantId, quote.contactId);
    await lockUser(transaction, tenant.tenantId, actorId);
    await revalidateAuthority(transaction, tenant, actorId, command, quote.contactId);
    const replayed = await replay(
      transaction,
      tenant.tenantId,
      quote,
      actorId,
      normalized.idempotencyKey,
      command,
      commandHash,
      (row, approvalId) => currentApprovalView(transaction, row, approvalId),
    );
    if (replayed !== null) return replayed;
    const policy = await currentPolicy(transaction, tenant.tenantId);
    const now = new Date();
    if (decision === "approved") await assertDeadline(quote, now);
    if (quote.revision !== expectedRevision)
      throw new QuoteRevisionConflictError("Quote revision does not match expectedRevision");
    if (
      quote.status !== "pending_approval" ||
      quote.currentApproval === null ||
      quote.currentApproval.status !== "pending" ||
      !policyIsCurrent(quote, policy) ||
      quote.currentApproval.policyRevision !== policy.revision ||
      quote.currentApproval.policyHash.trim() !== policy.contentHash
    )
      throw new QuoteCommandConflictError("Quote approval is stale or no longer pending");
    if (decision === "approved" && !policy.allowSelfApproval) {
      const contribution = await transaction.quoteCommercialContributor.findUnique({
        where: {
          tenantId_quoteId_userId: {
            tenantId: tenant.tenantId,
            quoteId: quote.id,
            userId: actorId,
          },
        },
      });
      if (contribution !== null)
        throw new QuoteAuthorizationError("Quote contributors may not approve their own quote");
    }
    requiredCalculation(quote);
    const nextRevision = quote.revision + 1;
    await calculate(transaction, tenant.tenantId, quote.id, nextRevision);
    const currentApproval = await transaction.quoteApproval.update({
      where: { tenantId_id: { tenantId: tenant.tenantId, id: quote.currentApproval.id } },
      data: {
        status: decision,
        resultingRevision: nextRevision,
        decisionActorUserId: actorId,
        decisionActorType: "tenant_user",
        decisionReasonCode: normalized.reasonCode,
        decisionNote: normalized.note,
        decidedAt: now,
      },
    });
    await transaction.quote.update({
      where: { tenantId_id: { tenantId: tenant.tenantId, id: quote.id } },
      data: { status: decision },
    });
    const currentQuote = await fetchLoadedQuote(transaction, tenant.tenantId, quote.id);
    const action = decision === "approved" ? "quote.approved" : "quote.rejected";
    await writeAuditAndOutbox(
      transaction,
      tenant,
      currentQuote,
      action,
      actorId,
      "tenant_user",
      metadata.requestId,
      quote.status,
    );
    await storeReceipt(
      transaction,
      tenant.tenantId,
      currentQuote,
      actorId,
      normalized.idempotencyKey,
      command,
      commandHash,
      currentApproval.id,
    );
    return {
      replayed: false,
      recordedOutcome: recordedOutcome(currentQuote, currentApproval.id),
      current: approvalView(currentQuote, currentApproval),
    };
  });
}

export async function approveQuote(
  context: TenantContext,
  database: QuoteApprovalDatabase,
  quoteId: string,
  expectedRevision: number,
  input: QuoteDecisionInput,
  metadata: QuoteMutationMetadata,
): Promise<QuoteCommandOutcome<QuoteApprovalView>> {
  return decideQuoteApproval(
    context,
    database,
    quoteId,
    expectedRevision,
    input,
    metadata,
    "approved",
  );
}

export async function rejectQuote(
  context: TenantContext,
  database: QuoteApprovalDatabase,
  quoteId: string,
  expectedRevision: number,
  input: QuoteDecisionInput,
  metadata: QuoteMutationMetadata,
): Promise<QuoteCommandOutcome<QuoteApprovalView>> {
  return decideQuoteApproval(
    context,
    database,
    quoteId,
    expectedRevision,
    input,
    metadata,
    "rejected",
  );
}

export async function cancelQuote(
  context: TenantContext,
  database: QuoteApprovalDatabase,
  quoteId: string,
  expectedRevision: number,
  input: QuoteApprovalInput,
  metadata: QuoteMutationMetadata,
): Promise<QuoteCancellationCommandOutcome> {
  const tenant = createTenantContext(context.tenantId);
  const actualQuoteId = normalizedId(quoteId, "quoteId");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    fail("expectedRevision must be a positive safe integer");
  const normalized = normalizeInput<QuoteApprovalInput & { idempotencyKey: unknown }>(input, [
    "idempotencyKey",
  ]);
  const key = normalizedKey(normalized.idempotencyKey);
  const actorId = metadataValid(metadata);
  const command: ApprovalCommand = "cancel";
  const commandHash = requestHash(command, actualQuoteId, expectedRevision, {});

  return database.$transaction(async (transaction) => {
    await quoteCommandLock(transaction, tenant.tenantId, key);
    await quoteTenantPolicyLock(transaction, tenant.tenantId);
    const quote = await lockQuote(transaction, tenant.tenantId, actualQuoteId);
    await lockUser(transaction, tenant.tenantId, actorId);
    await revalidateAuthority(transaction, tenant, actorId, command, null);
    const replayed = await replay(
      transaction,
      tenant.tenantId,
      quote,
      actorId,
      key,
      command,
      commandHash,
      cancellationView,
    );
    if (replayed !== null)
      return {
        ...replayed,
        recordedOutcome: cancellationRecordedOutcome(replayed.recordedOutcome),
      };
    if (quote.revision !== expectedRevision)
      throw new QuoteRevisionConflictError("Quote revision does not match expectedRevision");
    if (quote.status === "cancelled") {
      const outcome = { ...recordedOutcome(quote), result: "already_cancelled" as const };
      await storeReceipt(
        transaction,
        tenant.tenantId,
        quote,
        actorId,
        key,
        command,
        commandHash,
        undefined,
        outcome,
      );
      return {
        replayed: false,
        recordedOutcome: outcome,
        current: cancellationView(quote),
      };
    }
    if (!["draft", "pending_approval", "approved", "rejected"].includes(quote.status))
      throw new QuoteValidationError("Only unsent quotes may be cancelled");
    const isCalculated =
      quote.calculatedRevision === quote.revision &&
      quote.calculationInputHash !== null &&
      quote.subtotal !== null &&
      quote.discountTotal !== null &&
      quote.taxTotal !== null &&
      quote.total !== null &&
      quote.items.every((item) => item.taxRate !== null);
    if (isCalculated) await calculate(transaction, tenant.tenantId, quote.id, quote.revision + 1);
    else {
      await transaction.quoteItem.updateMany({
        where: { tenantId: tenant.tenantId, quoteId: quote.id },
        data: {
          grossTotal: null,
          discountTotal: null,
          netTotal: null,
          taxTotal: null,
          lineTotal: null,
        },
      });
      await transaction.quote.update({
        where: { tenantId_id: { tenantId: tenant.tenantId, id: quote.id } },
        data: {
          revision: { increment: 1 },
          calculatedRevision: null,
          calculationInputHash: null,
          subtotal: null,
          discountTotal: null,
          taxTotal: null,
          total: null,
        },
      });
    }
    await transaction.quote.update({
      where: { tenantId_id: { tenantId: tenant.tenantId, id: quote.id } },
      data: { status: "cancelled" },
    });
    const currentQuote = await transaction.quote.findFirst({
      where: { tenantId: tenant.tenantId, id: quote.id },
    });
    if (currentQuote === null) throw new QuoteNotFoundError(quote.id);
    const outcome = { ...recordedOutcome(currentQuote), result: "cancelled" as const };
    await writeAuditAndOutbox(
      transaction,
      tenant,
      currentQuote,
      "quote.cancelled",
      actorId,
      "tenant_user",
      metadata.requestId,
      quote.status,
    );
    await storeReceipt(
      transaction,
      tenant.tenantId,
      currentQuote,
      actorId,
      key,
      command,
      commandHash,
      undefined,
      outcome,
    );
    return {
      replayed: false,
      recordedOutcome: outcome,
      current: cancellationView(currentQuote),
    };
  });
}
