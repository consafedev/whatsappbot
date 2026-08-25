import type { Prisma, Rule } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess, type TenantTransactionDatabase } from "./tenant-data-access";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

export const RULE_TRIGGER_TYPES = [
  "ON_MESSAGE_RECEIVED",
  "ON_CONVERSATION_CREATED",
  "ON_STATUS_CHANGED",
  "ON_CONVERSATION_UNASSIGNED",
] as const;
export type RuleTriggerType = (typeof RULE_TRIGGER_TYPES)[number];

export const RULE_STATUSES = ["draft", "active", "inactive"] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

export const RULE_EXECUTION_MODES = ["first_match_stop", "evaluate_all"] as const;
export type RuleExecutionMode = (typeof RULE_EXECUTION_MODES)[number];

export const RULE_CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "in",
  "not_in",
  "greater_than",
  "less_than",
  "is_empty",
  "is_not_empty",
  "exists",
] as const;
export type RuleConditionOperator = (typeof RULE_CONDITION_OPERATORS)[number];

export const RULE_ACTION_TYPES = [
  "send_message",
  "set_conversation_mode",
  "assign_user",
  "assign_unit",
  "change_status",
  "add_tag",
  "remove_tag",
] as const;
export type RuleActionType = (typeof RULE_ACTION_TYPES)[number];

export type RuleCondition = Readonly<{
  field: string;
  operator: string;
  value?: unknown;
}>;

export type RuleAction = Readonly<{
  actionType: string;
  parameters?: Record<string, unknown>;
}>;

export type RuleItem = Readonly<{
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  triggerType: string;
  priority: number;
  status: string;
  executionMode: string;
  conditions: readonly RuleCondition[];
  actions: readonly RuleAction[];
  cooldownSeconds: number;
  channelAccountId: string | null;
  organizationUnitId: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type CreateRuleInput = Readonly<{
  name: string;
  description?: string | null;
  triggerType: string;
  priority?: number;
  status?: string;
  executionMode?: string;
  conditions: readonly RuleCondition[];
  actions: readonly RuleAction[];
  cooldownSeconds?: number;
  channelAccountId?: string | null;
  organizationUnitId?: string | null;
}>;

export type UpdateRuleInput = Readonly<{
  name?: string;
  description?: string | null;
  triggerType?: string;
  priority?: number;
  status?: string;
  executionMode?: string;
  conditions?: readonly RuleCondition[];
  actions?: readonly RuleAction[];
  cooldownSeconds?: number;
  channelAccountId?: string | null;
  organizationUnitId?: string | null;
}>;

export type RuleListOptions = Readonly<{
  triggerType?: string;
  status?: string;
  channelAccountId?: string;
  organizationUnitId?: string;
}>;

export type RuleMutationMetadata = Readonly<{
  actorUserId?: string | null;
  requestId?: string;
}>;

export type RuleCatalogManagerDatabase = TenantTransactionDatabase &
  Pick<
    Prisma.TransactionClient,
    "rule" | "tenant" | "channelAccount" | "organizationUnit" | "tenantEntitlement"
  >;
export type RuleCatalogTransaction = Prisma.TransactionClient;

export class RuleNotFoundError extends Error {
  override readonly name = "RuleNotFoundError";

  constructor() {
    super("Rule was not found");
  }
}

export class RuleValidationError extends Error {
  override readonly name = "RuleValidationError";
}

export class RuleChannelAccountNotFoundError extends Error {
  override readonly name = "RuleChannelAccountNotFoundError";

  constructor() {
    super("Channel account was not found for this tenant");
  }
}

export class RuleOrganizationUnitNotFoundError extends Error {
  override readonly name = "RuleOrganizationUnitNotFoundError";

  constructor() {
    super("Organization unit was not found for this tenant");
  }
}

const DEFAULT_METADATA: Required<RuleMutationMetadata> = {
  actorUserId: null,
  requestId: "rule-catalog-manager",
};

const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new RuleValidationError(`Invalid ${field}`);
  const result = value.trim();
  if (result.length === 0 || result.length > maxLength) {
    throw new RuleValidationError(`Invalid ${field}`);
  }
  return result;
}

function optionalCleanString(
  value: unknown,
  field: string,
  maxLength: number,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  return cleanString(value, field, maxLength);
}

function parseTriggerType(value: unknown): string {
  if (typeof value !== "string") throw new RuleValidationError("Invalid rule trigger type");
  const result = value.trim();
  if (!RULE_TRIGGER_TYPES.includes(result as RuleTriggerType)) {
    throw new RuleValidationError(
      `Invalid trigger type: ${result}. Allowed: ${RULE_TRIGGER_TYPES.join(", ")}`,
    );
  }
  return result;
}

function parsePriority(value: unknown, fallback = 100): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10_000) {
    throw new RuleValidationError("Rule priority must be an integer between 1 and 10000");
  }
  return parsed;
}

function parseStatus(value: unknown, fallback = "draft"): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !RULE_STATUSES.includes(value as RuleStatus)) {
    throw new RuleValidationError(
      `Invalid status: ${String(value)}. Allowed: ${RULE_STATUSES.join(", ")}`,
    );
  }
  return value;
}

function parseExecutionMode(value: unknown, fallback = "first_match_stop"): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !RULE_EXECUTION_MODES.includes(value as RuleExecutionMode)) {
    throw new RuleValidationError(
      `Invalid executionMode: ${String(value)}. Allowed: ${RULE_EXECUTION_MODES.join(", ")}`,
    );
  }
  return value;
}

function parseCooldownSeconds(value: unknown, fallback = 0): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 86_400) {
    throw new RuleValidationError("Rule cooldownSeconds must be an integer between 0 and 86400");
  }
  return parsed;
}

function parseOptionalUuid(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || !UUIDV7_PATTERN.test(value.trim())) {
    throw new RuleValidationError(`Invalid ${field} UUID`);
  }
  return value.trim().toLowerCase();
}

export function validateConditions(value: unknown): readonly RuleCondition[] {
  if (!Array.isArray(value)) {
    throw new RuleValidationError("Rule conditions must be an array");
  }
  const result: RuleCondition[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new RuleValidationError(`Condition at index ${i} must be an object`);
    }
    const field = cleanString(
      (item as Record<string, unknown>).field,
      `conditions[${i}].field`,
      100,
    );
    const operator = cleanString(
      (item as Record<string, unknown>).operator,
      `conditions[${i}].operator`,
      50,
    );
    if (!RULE_CONDITION_OPERATORS.includes(operator as RuleConditionOperator)) {
      throw new RuleValidationError(
        `Invalid operator at conditions[${i}]: ${operator}. Allowed: ${RULE_CONDITION_OPERATORS.join(", ")}`,
      );
    }
    const condition: RuleCondition =
      (item as Record<string, unknown>).value !== undefined
        ? { field, operator, value: (item as Record<string, unknown>).value }
        : { field, operator };
    result.push(condition);
  }
  return result;
}

export function validateActions(value: unknown): readonly RuleAction[] {
  if (!Array.isArray(value)) {
    throw new RuleValidationError("Rule actions must be an array");
  }
  if (value.length === 0) {
    throw new RuleValidationError("Rule actions cannot be empty");
  }
  const result: RuleAction[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new RuleValidationError(`Action at index ${i} must be an object`);
    }
    const actionType = cleanString(
      (item as Record<string, unknown>).actionType,
      `actions[${i}].actionType`,
      50,
    );
    if (!RULE_ACTION_TYPES.includes(actionType as RuleActionType)) {
      throw new RuleValidationError(
        `Invalid actionType at actions[${i}]: ${actionType}. Allowed: ${RULE_ACTION_TYPES.join(", ")}`,
      );
    }
    const parameters = (item as Record<string, unknown>).parameters;
    if (
      parameters !== undefined &&
      (parameters === null || typeof parameters !== "object" || Array.isArray(parameters))
    ) {
      throw new RuleValidationError(`Action parameters at index ${i} must be an object`);
    }
    const action: RuleAction =
      parameters !== undefined
        ? { actionType, parameters: parameters as Record<string, unknown> }
        : { actionType };
    result.push(action);
  }
  return result;
}

function ruleItem(rule: Rule): RuleItem {
  return {
    actions: (Array.isArray(rule.actions) ? rule.actions : []) as unknown as readonly RuleAction[],
    channelAccountId: rule.channelAccountId,
    conditions: (Array.isArray(rule.conditions)
      ? rule.conditions
      : []) as unknown as readonly RuleCondition[],
    cooldownSeconds: rule.cooldownSeconds,
    createdAt: rule.createdAt,
    description: rule.description,
    executionMode: rule.executionMode,
    id: rule.id,
    name: rule.name,
    organizationUnitId: rule.organizationUnitId,
    priority: rule.priority,
    status: rule.status,
    tenantId: rule.tenantId,
    triggerType: rule.triggerType,
    updatedAt: rule.updatedAt,
  };
}

function summary(rule: RuleItem): Prisma.InputJsonValue {
  return {
    actionsCount: rule.actions.length,
    channelAccountId: rule.channelAccountId,
    conditionsCount: rule.conditions.length,
    cooldownSeconds: rule.cooldownSeconds,
    executionMode: rule.executionMode,
    name: rule.name,
    organizationUnitId: rule.organizationUnitId,
    priority: rule.priority,
    status: rule.status,
    triggerType: rule.triggerType,
  };
}

function requestMetadata(metadata?: RuleMutationMetadata): Required<RuleMutationMetadata> {
  return {
    actorUserId: metadata?.actorUserId ?? DEFAULT_METADATA.actorUserId,
    requestId: metadata?.requestId ?? DEFAULT_METADATA.requestId,
  };
}

async function validateRelations(
  context: TenantContext,
  channelAccountId: string | null | undefined,
  organizationUnitId: string | null | undefined,
  transaction: RuleCatalogTransaction,
): Promise<void> {
  if (channelAccountId) {
    const channel = await transaction.channelAccount.findFirst({
      select: { id: true },
      where: { id: channelAccountId, tenantId: context.tenantId },
    });
    if (channel === null) {
      throw new RuleChannelAccountNotFoundError();
    }
  }
  if (organizationUnitId) {
    const unit = await transaction.organizationUnit.findFirst({
      select: { id: true },
      where: { id: organizationUnitId, tenantId: context.tenantId },
    });
    if (unit === null) {
      throw new RuleOrganizationUnitNotFoundError();
    }
  }
}

async function appendMutation(
  context: TenantContext,
  transaction: Prisma.TransactionClient,
  metadata: Required<RuleMutationMetadata>,
  action: "rule.created" | "rule.updated" | "rule.deleted",
  before: RuleItem | null,
  after: RuleItem | null,
): Promise<void> {
  const access = createTenantDataAccess(context, transaction);
  const targetId = after?.id ?? before?.id ?? "";
  await access.audit.append({
    action,
    actorId: metadata.actorUserId,
    actorType: metadata.actorUserId === null ? "system" : "tenant_user",
    afterSummary: after === null ? null : summary(after),
    beforeSummary: before === null ? null : summary(before),
    entityId: targetId,
    entityType: "Rule",
    requestId: metadata.requestId,
  });
  await access.outbox.append({
    aggregateId: targetId,
    aggregateType: "Rule",
    eventType: action,
    payload: {
      action,
      ruleId: targetId,
      status: after?.status ?? before?.status,
      tenantId: context.tenantId,
      triggerType: after?.triggerType ?? before?.triggerType,
    },
  });
}

export function createRuleCatalogManager(database: RuleCatalogManagerDatabase) {
  const runInTransaction = <Result>(
    transaction: RuleCatalogTransaction | undefined,
    callback: (transaction: RuleCatalogTransaction) => Promise<Result>,
  ): Promise<Result> =>
    transaction === undefined ? database.$transaction(callback) : callback(transaction);

  const createRule = async (
    context: TenantContext,
    actorId: string,
    input: CreateRuleInput,
    metadata?: RuleMutationMetadata,
  ): Promise<RuleItem> => {
    const validatedContext = createTenantContext(context.tenantId);
    return runInTransaction(undefined, async (transaction) => {
      await assertTenantOperational(validatedContext, transaction);
      await assertTenantModuleEntitled(validatedContext, "module.automation.basic", transaction);

      const name = cleanString(input.name, "rule name", 160);
      const description = optionalCleanString(input.description, "rule description", 500);
      const triggerType = parseTriggerType(input.triggerType);
      const priority = parsePriority(input.priority);
      const status = parseStatus(input.status);
      const executionMode = parseExecutionMode(input.executionMode);
      const cooldownSeconds = parseCooldownSeconds(input.cooldownSeconds);
      const channelAccountId = parseOptionalUuid(input.channelAccountId, "channelAccountId");
      const organizationUnitId = parseOptionalUuid(input.organizationUnitId, "organizationUnitId");

      const conditions = validateConditions(input.conditions);
      const actions = validateActions(input.actions);

      await validateRelations(validatedContext, channelAccountId, organizationUnitId, transaction);

      const created = await transaction.rule.create({
        data: {
          actions: actions as unknown as Prisma.InputJsonValue,
          channelAccountId: channelAccountId ?? null,
          conditions: conditions as unknown as Prisma.InputJsonValue,
          cooldownSeconds,
          description: description ?? null,
          executionMode,
          name,
          organizationUnitId: organizationUnitId ?? null,
          priority,
          status,
          tenantId: validatedContext.tenantId,
          triggerType,
        },
      });

      const after = ruleItem(created);
      const mutationMeta = requestMetadata({
        ...metadata,
        actorUserId: metadata?.actorUserId ?? actorId,
      });

      await appendMutation(
        validatedContext,
        transaction,
        mutationMeta,
        "rule.created",
        null,
        after,
      );
      return after;
    });
  };

  const updateRule = async (
    context: TenantContext,
    ruleId: string,
    actorId: string,
    input: UpdateRuleInput,
    metadata?: RuleMutationMetadata,
  ): Promise<RuleItem> => {
    const validatedContext = createTenantContext(context.tenantId);
    const cleanedRuleId = parseOptionalUuid(ruleId, "rule id");
    if (!cleanedRuleId) throw new RuleNotFoundError();

    return runInTransaction(undefined, async (transaction) => {
      await assertTenantOperational(validatedContext, transaction);
      await assertTenantModuleEntitled(validatedContext, "module.automation.basic", transaction);

      const current = await transaction.rule.findFirst({
        where: { id: cleanedRuleId, tenantId: validatedContext.tenantId },
      });
      if (current === null) throw new RuleNotFoundError();

      const before = ruleItem(current);
      const updatePayload: Prisma.RuleUncheckedUpdateInput = {};

      if (input.name !== undefined) {
        updatePayload.name = cleanString(input.name, "rule name", 160);
      }
      if (input.description !== undefined) {
        updatePayload.description =
          optionalCleanString(input.description, "rule description", 500) ?? null;
      }
      if (input.triggerType !== undefined) {
        updatePayload.triggerType = parseTriggerType(input.triggerType);
      }
      if (input.priority !== undefined) {
        updatePayload.priority = parsePriority(input.priority);
      }
      if (input.status !== undefined) {
        updatePayload.status = parseStatus(input.status);
      }
      if (input.executionMode !== undefined) {
        updatePayload.executionMode = parseExecutionMode(input.executionMode);
      }
      if (input.cooldownSeconds !== undefined) {
        updatePayload.cooldownSeconds = parseCooldownSeconds(input.cooldownSeconds);
      }
      if (input.conditions !== undefined) {
        const validatedConditions = validateConditions(input.conditions);
        updatePayload.conditions = validatedConditions as unknown as Prisma.InputJsonValue;
      }
      if (input.actions !== undefined) {
        const validatedActions = validateActions(input.actions);
        updatePayload.actions = validatedActions as unknown as Prisma.InputJsonValue;
      }

      if (input.channelAccountId !== undefined) {
        const channelAccountId = parseOptionalUuid(input.channelAccountId, "channelAccountId");
        if (channelAccountId) {
          await validateRelations(validatedContext, channelAccountId, undefined, transaction);
        }
        updatePayload.channelAccountId = channelAccountId ?? null;
      }

      if (input.organizationUnitId !== undefined) {
        const organizationUnitId = parseOptionalUuid(
          input.organizationUnitId,
          "organizationUnitId",
        );
        if (organizationUnitId) {
          await validateRelations(validatedContext, undefined, organizationUnitId, transaction);
        }
        updatePayload.organizationUnitId = organizationUnitId ?? null;
      }

      if (Object.keys(updatePayload).length === 0) {
        throw new RuleValidationError("Rule update is empty");
      }

      const updated = await transaction.rule.update({
        data: updatePayload,
        where: { id: current.id },
      });

      const after = ruleItem(updated);
      const mutationMeta = requestMetadata({
        ...metadata,
        actorUserId: metadata?.actorUserId ?? actorId,
      });

      await appendMutation(
        validatedContext,
        transaction,
        mutationMeta,
        "rule.updated",
        before,
        after,
      );
      return after;
    });
  };

  const getRuleById = async (context: TenantContext, ruleId: string): Promise<RuleItem | null> => {
    const validatedContext = createTenantContext(context.tenantId);
    const cleanedRuleId = parseOptionalUuid(ruleId, "rule id");
    if (!cleanedRuleId) return null;

    await assertTenantOperational(validatedContext, database);
    const rule = await database.rule.findFirst({
      where: { id: cleanedRuleId, tenantId: validatedContext.tenantId },
    });
    return rule === null ? null : ruleItem(rule);
  };

  const listRules = async (
    context: TenantContext,
    options: RuleListOptions = {},
  ): Promise<readonly RuleItem[]> => {
    const validatedContext = createTenantContext(context.tenantId);
    await assertTenantOperational(validatedContext, database);

    const where: Prisma.RuleWhereInput = { tenantId: validatedContext.tenantId };
    if (options.triggerType !== undefined) {
      where.triggerType = parseTriggerType(options.triggerType);
    }
    if (options.status !== undefined) {
      where.status = parseStatus(options.status);
    }
    if (options.channelAccountId !== undefined) {
      const channelId = parseOptionalUuid(options.channelAccountId, "channelAccountId");
      if (channelId) where.channelAccountId = channelId;
    }
    if (options.organizationUnitId !== undefined) {
      const unitId = parseOptionalUuid(options.organizationUnitId, "organizationUnitId");
      if (unitId) where.organizationUnitId = unitId;
    }

    const rules = await database.rule.findMany({
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }, { id: "desc" }],
      where,
    });

    return rules.map(ruleItem);
  };

  const deleteRule = async (
    context: TenantContext,
    ruleId: string,
    actorId: string,
    metadata?: RuleMutationMetadata,
  ): Promise<void> => {
    const validatedContext = createTenantContext(context.tenantId);
    const cleanedRuleId = parseOptionalUuid(ruleId, "rule id");
    if (!cleanedRuleId) throw new RuleNotFoundError();

    return runInTransaction(undefined, async (transaction) => {
      await assertTenantOperational(validatedContext, transaction);
      await assertTenantModuleEntitled(validatedContext, "module.automation.basic", transaction);

      const current = await transaction.rule.findFirst({
        where: { id: cleanedRuleId, tenantId: validatedContext.tenantId },
      });
      if (current === null) throw new RuleNotFoundError();

      const before = ruleItem(current);
      await transaction.rule.delete({
        where: { id: current.id },
      });

      const mutationMeta = requestMetadata({
        ...metadata,
        actorUserId: metadata?.actorUserId ?? actorId,
      });

      await appendMutation(
        validatedContext,
        transaction,
        mutationMeta,
        "rule.deleted",
        before,
        null,
      );
    });
  };

  return Object.freeze({
    createRule,
    deleteRule,
    getRuleById,
    listRules,
    updateRule,
  });
}

export type RuleCatalogManager = ReturnType<typeof createRuleCatalogManager>;
