import { createHash } from "node:crypto";
import type { Prisma } from "./generated/prisma/client";
import { quoteCommandLock, quoteTenantPolicyLock } from "./quote-command-locks";
import {
  QuoteAuthorizationError,
  QuoteCommandConflictError,
  QuoteRevisionConflictError,
  QuoteValidationError,
} from "./quote-manager";
import {
  DEFAULT_QUOTE_POLICY,
  DEFAULT_QUOTE_POLICY_CONFIGURATION,
  type QuoteMutationMetadata,
  type QuotePolicyConfiguration,
  type QuotePolicyInput,
  type QuotePolicyView,
  quotePolicyContentHash,
} from "./quote-policy";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess, type TenantTransactionDatabase } from "./tenant-data-access";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

export type QuotePolicyDatabase = TenantTransactionDatabase &
  Pick<
    Prisma.TransactionClient,
    | "quotePolicy"
    | "quoteCommandReceipt"
    | "user"
    | "tenantEntitlement"
    | "tenant"
    | "auditLog"
    | "domainEventOutbox"
  >;

export type QuotePolicyRecordedOutcome = Readonly<{
  tenantId: string;
  policy: QuotePolicyView;
}>;

export type QuotePolicyCommandOutcome = Readonly<{
  replayed: boolean;
  recordedOutcome: QuotePolicyRecordedOutcome;
  current: QuotePolicyView;
}>;

type QuotePolicyRow = Readonly<{
  autonomyLevel: number;
  maxAutoSendAmount: Prisma.Decimal | null;
  maxAutoSendCurrency: string | null;
  maxDiscountPercent: Prisma.Decimal | null;
  minMarginPercent: Prisma.Decimal | null;
  requireStock: boolean;
  newCustomerRequiresApproval: boolean;
  exceptionalProductRequiresApproval: boolean;
  allowSelfApproval: boolean;
  revision: number;
  contentHash: string;
}>;

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_INPUT_KEYS = [
  "idempotencyKey",
  "expectedRevision",
  "autonomyLevel",
  "maxAutoSendAmount",
  "maxAutoSendCurrency",
  "maxDiscountPercent",
  "minMarginPercent",
  "requireStock",
  "newCustomerRequiresApproval",
  "exceptionalProductRequiresApproval",
  "allowSelfApproval",
] as const;
const DEFAULT_AUTONOMY_FIELDS: Readonly<
  Omit<
    QuotePolicyConfiguration,
    | "autonomyLevel"
    | "maxAutoSendAmount"
    | "maxAutoSendCurrency"
    | "maxDiscountPercent"
    | "minMarginPercent"
  >
> = {
  requireStock: DEFAULT_QUOTE_POLICY_CONFIGURATION.requireStock,
  newCustomerRequiresApproval: DEFAULT_QUOTE_POLICY_CONFIGURATION.newCustomerRequiresApproval,
  exceptionalProductRequiresApproval:
    DEFAULT_QUOTE_POLICY_CONFIGURATION.exceptionalProductRequiresApproval,
  allowSelfApproval: DEFAULT_QUOTE_POLICY_CONFIGURATION.allowSelfApproval,
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function fail(message: string): never {
  throw new QuoteValidationError(message);
}

function normalizeDecimal(value: unknown, field: string, maxIntegerDigits: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value))
    return fail(`${field} must be a non-negative decimal string or null`);
  const [whole = "", fraction = ""] = value.split(".");
  if (whole.length > maxIntegerDigits || fraction.length > 4)
    return fail(`${field} exceeds its storage precision`);
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction.length === 0
    ? normalizedWhole
    : `${normalizedWhole}.${normalizedFraction}`;
}

function validatePercent(value: string | null, field: string): void {
  if (value === null) return;
  const [whole = "0"] = value.split(".");
  if (BigInt(whole) > 100n || (BigInt(whole) === 100n && /[1-9]/.test(value.split(".")[1] ?? "")))
    fail(`${field} must not exceed 100`);
}

function normalizeInput(input: QuotePolicyInput): Readonly<{
  idempotencyKey: string;
  expectedRevision: number;
  configuration: QuotePolicyConfiguration;
}> {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return fail("quote policy input is required");
  if (Object.keys(input).some((key) => !(ALLOWED_INPUT_KEYS as readonly string[]).includes(key)))
    return fail("quote policy input contains an unknown field");
  if (typeof input.idempotencyKey !== "string") return fail("idempotencyKey is required");
  const key = input.idempotencyKey.trim();
  if (
    key.length < 1 ||
    key.length > 128 ||
    [...key].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  )
    return fail("idempotencyKey must contain 1 to 128 printable characters");
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
    return fail("expectedRevision must be a non-negative safe integer");
  if (![0, 1, 2, 3].includes(input.autonomyLevel))
    return fail("autonomyLevel must be an integer from 0 to 3");
  for (const field of [
    "requireStock",
    "newCustomerRequiresApproval",
    "exceptionalProductRequiresApproval",
    "allowSelfApproval",
  ] as const) {
    if (input[field] !== undefined && typeof input[field] !== "boolean")
      fail(`${field} must be a boolean`);
  }
  const maxAutoSendAmount = normalizeDecimal(input.maxAutoSendAmount, "maxAutoSendAmount", 20);
  const maxDiscountPercent = normalizeDecimal(input.maxDiscountPercent, "maxDiscountPercent", 3);
  const minMarginPercent = normalizeDecimal(input.minMarginPercent, "minMarginPercent", 3);
  validatePercent(maxDiscountPercent, "maxDiscountPercent");
  validatePercent(minMarginPercent, "minMarginPercent");
  const currency = input.maxAutoSendCurrency;
  if (
    currency !== undefined &&
    currency !== null &&
    (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))
  )
    return fail("maxAutoSendCurrency must be an uppercase three-letter currency or null");
  const maxAutoSendCurrency = currency ?? null;
  if ((maxAutoSendAmount === null) !== (maxAutoSendCurrency === null))
    return fail("maxAutoSendAmount and maxAutoSendCurrency must be set together");
  const configuration: QuotePolicyConfiguration = {
    autonomyLevel: input.autonomyLevel,
    maxAutoSendAmount,
    maxAutoSendCurrency,
    maxDiscountPercent,
    minMarginPercent,
    requireStock: input.requireStock ?? DEFAULT_AUTONOMY_FIELDS.requireStock,
    newCustomerRequiresApproval:
      input.newCustomerRequiresApproval ?? DEFAULT_AUTONOMY_FIELDS.newCustomerRequiresApproval,
    exceptionalProductRequiresApproval:
      input.exceptionalProductRequiresApproval ??
      DEFAULT_AUTONOMY_FIELDS.exceptionalProductRequiresApproval,
    allowSelfApproval: input.allowSelfApproval ?? DEFAULT_AUTONOMY_FIELDS.allowSelfApproval,
  };
  for (const [field, value] of Object.entries(configuration)) {
    if (
      field !== "autonomyLevel" &&
      typeof value !== "string" &&
      value !== null &&
      typeof value !== "boolean"
    )
      fail(`${field} has an invalid type`);
  }
  if (configuration.autonomyLevel >= 2 && maxAutoSendAmount === null)
    fail("autonomyLevel values 2 and 3 require maxAutoSendAmount and maxAutoSendCurrency");
  return { idempotencyKey: key, expectedRevision: input.expectedRevision, configuration };
}

function viewFromRow(row: QuotePolicyRow | null): QuotePolicyView {
  if (row === null) return DEFAULT_QUOTE_POLICY;
  const configuration: QuotePolicyConfiguration = {
    autonomyLevel: row.autonomyLevel as QuotePolicyConfiguration["autonomyLevel"],
    maxAutoSendAmount: row.maxAutoSendAmount?.toString() ?? null,
    maxAutoSendCurrency: row.maxAutoSendCurrency?.trim() ?? null,
    maxDiscountPercent: row.maxDiscountPercent?.toString() ?? null,
    minMarginPercent: row.minMarginPercent?.toString() ?? null,
    requireStock: row.requireStock,
    newCustomerRequiresApproval: row.newCustomerRequiresApproval,
    exceptionalProductRequiresApproval: row.exceptionalProductRequiresApproval,
    allowSelfApproval: row.allowSelfApproval,
  };
  return {
    ...configuration,
    revision: row.revision,
    contentHash: row.contentHash.trim(),
  };
}

async function readPolicy(
  transaction: Pick<Prisma.TransactionClient, "quotePolicy">,
  tenantId: string,
): Promise<QuotePolicyView> {
  const row = await transaction.quotePolicy.findUnique({ where: { tenantId } });
  return viewFromRow(row);
}

export async function getQuotePolicy(
  context: TenantContext,
  database: QuotePolicyDatabase,
): Promise<QuotePolicyView> {
  const tenant = createTenantContext(context.tenantId);
  await assertTenantOperational(tenant, database as Prisma.TransactionClient);
  await assertTenantModuleEntitled(tenant, "module.quotes", database as Prisma.TransactionClient);
  return readPolicy(database, tenant.tenantId);
}

async function assertWriteAuthority(
  transaction: Prisma.TransactionClient,
  tenant: TenantContext,
  actorUserId: string,
): Promise<void> {
  await assertTenantOperational(tenant, transaction);
  const actor = await transaction.user.findFirst({
    select: { id: true },
    where: { id: actorUserId, tenantId: tenant.tenantId, status: "active" },
  });
  if (actor === null)
    throw new QuoteValidationError("Authenticated actor is not active in this tenant");
  await assertTenantModuleEntitled(tenant, "module.quotes", transaction);
  const effective = await createTenantDataAccess(tenant, transaction).permissions.resolveForUser(
    actorUserId,
  );
  if (!effective.has("tenant.settings.manage") || !effective.has("quotes.approve"))
    throw new QuoteAuthorizationError(
      "tenant.settings.manage and quotes.approve permissions are required",
    );
}

function storedOutcome(value: Prisma.JsonValue): QuotePolicyRecordedOutcome {
  if (value === null || Array.isArray(value) || typeof value !== "object")
    throw new QuoteCommandConflictError("Policy receipt outcome is invalid");
  const outcome = value as unknown as QuotePolicyRecordedOutcome;
  if (
    typeof outcome.tenantId !== "string" ||
    outcome.policy === null ||
    typeof outcome.policy !== "object" ||
    !Number.isSafeInteger(outcome.policy.revision) ||
    typeof outcome.policy.contentHash !== "string"
  )
    throw new QuoteCommandConflictError("Policy receipt outcome is invalid");
  return outcome;
}

function policyView(configuration: QuotePolicyConfiguration, revision: number): QuotePolicyView {
  return {
    ...configuration,
    revision,
    contentHash: quotePolicyContentHash(configuration, revision),
  };
}

async function persistPolicy(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  policy: QuotePolicyView,
  existed: boolean,
): Promise<void> {
  const configuration = {
    autonomyLevel: policy.autonomyLevel,
    maxAutoSendAmount: policy.maxAutoSendAmount,
    maxAutoSendCurrency: policy.maxAutoSendCurrency,
    maxDiscountPercent: policy.maxDiscountPercent,
    minMarginPercent: policy.minMarginPercent,
    requireStock: policy.requireStock,
    newCustomerRequiresApproval: policy.newCustomerRequiresApproval,
    exceptionalProductRequiresApproval: policy.exceptionalProductRequiresApproval,
    allowSelfApproval: policy.allowSelfApproval,
    revision: policy.revision,
    contentHash: policy.contentHash,
  };
  if (!existed) {
    await transaction.quotePolicy.create({ data: { tenantId, ...configuration } });
    return;
  }
  await transaction.quotePolicy.update({ where: { tenantId }, data: configuration });
}

function receiptJson(outcome: QuotePolicyRecordedOutcome): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(outcome)) as Prisma.InputJsonValue;
}

export async function updateQuotePolicy(
  context: TenantContext,
  database: QuotePolicyDatabase,
  input: QuotePolicyInput,
  metadata: QuoteMutationMetadata,
): Promise<QuotePolicyCommandOutcome> {
  const tenant = createTenantContext(context.tenantId);
  const normalized = normalizeInput(input);
  if (typeof metadata !== "object" || metadata === null || !UUID_V7.test(metadata.actorUserId))
    fail("actorUserId must be a UUIDv7");
  if (
    typeof metadata.requestId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(metadata.requestId)
  )
    fail("requestId must be 1 to 128 safe characters");
  const actorUserId = metadata.actorUserId.toLowerCase();
  const requestHash = createHash("sha256")
    .update(
      canonical({
        commandType: "policy_update",
        resourceId: tenant.tenantId,
        expectedRevision: normalized.expectedRevision,
        configuration: normalized.configuration,
      }),
      "utf8",
    )
    .digest("hex");

  return database.$transaction(async (transaction) => {
    await quoteCommandLock(transaction, tenant.tenantId, normalized.idempotencyKey);
    await quoteTenantPolicyLock(transaction, tenant.tenantId);
    await assertWriteAuthority(transaction, tenant, actorUserId);
    const existingReceipt = await transaction.quoteCommandReceipt.findUnique({
      where: {
        tenantId_idempotencyKey: {
          tenantId: tenant.tenantId,
          idempotencyKey: normalized.idempotencyKey,
        },
      },
    });
    const current = await readPolicy(transaction, tenant.tenantId);
    if (existingReceipt !== null) {
      if (
        existingReceipt.resourceId !== tenant.tenantId ||
        existingReceipt.quoteId !== null ||
        existingReceipt.actorUserId !== actorUserId ||
        existingReceipt.commandType !== "policy_update" ||
        existingReceipt.requestHash !== requestHash
      )
        throw new QuoteCommandConflictError("Idempotency key is already used by another command");
      const recordedOutcome = storedOutcome(existingReceipt.recordedOutcome);
      if (recordedOutcome.tenantId !== tenant.tenantId)
        throw new QuoteCommandConflictError("Policy receipt belongs to another tenant");
      return { replayed: true, recordedOutcome, current };
    }
    if (current.revision !== normalized.expectedRevision)
      throw new QuoteRevisionConflictError("Policy revision does not match expectedRevision");

    const sameConfiguration =
      canonical(current) ===
      canonical({
        ...normalized.configuration,
        revision: current.revision,
        contentHash: current.contentHash,
      });
    if (sameConfiguration) {
      const recordedOutcome: QuotePolicyRecordedOutcome = {
        tenantId: tenant.tenantId,
        policy: current,
      };
      await transaction.quoteCommandReceipt.create({
        data: {
          tenantId: tenant.tenantId,
          resourceId: tenant.tenantId,
          quoteId: null,
          actorUserId,
          idempotencyKey: normalized.idempotencyKey,
          commandType: "policy_update",
          requestHash,
          recordedOutcome: receiptJson(recordedOutcome),
        },
      });
      return { replayed: false, recordedOutcome, current };
    }

    const nextPolicy = policyView(normalized.configuration, current.revision + 1);
    await persistPolicy(transaction, tenant.tenantId, nextPolicy, current.revision > 0);
    const recordedOutcome: QuotePolicyRecordedOutcome = {
      tenantId: tenant.tenantId,
      policy: nextPolicy,
    };
    await createTenantDataAccess(tenant, transaction).audit.append({
      action: "quote.policy_updated",
      actorId: actorUserId,
      actorType: "tenant_user",
      afterSummary: { tenantId: tenant.tenantId, revision: nextPolicy.revision },
      entityId: tenant.tenantId,
      entityType: "QuotePolicy",
      requestId: metadata.requestId,
    });
    await createTenantDataAccess(tenant, transaction).outbox.append({
      aggregateId: tenant.tenantId,
      aggregateType: "Tenant",
      eventType: "quote.policy_updated",
      payload: { tenantId: tenant.tenantId, policyRevision: nextPolicy.revision },
    });
    await transaction.quoteCommandReceipt.create({
      data: {
        tenantId: tenant.tenantId,
        resourceId: tenant.tenantId,
        quoteId: null,
        actorUserId,
        idempotencyKey: normalized.idempotencyKey,
        commandType: "policy_update",
        requestHash,
        recordedOutcome: receiptJson(recordedOutcome),
      },
    });
    return { replayed: false, recordedOutcome, current: nextPolicy };
  });
}
