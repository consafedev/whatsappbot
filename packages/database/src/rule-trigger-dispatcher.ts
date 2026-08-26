import type { Rule } from "./generated/prisma/client";
import {
  executeRuleActions,
  type RuleActionExecutorDatabase,
  type RuleExecutionContext,
  type RuleExecutionResult,
} from "./rule-action-executor";
import type { RuleItem, RuleMutationMetadata, RuleTriggerType } from "./rule-catalog-manager";
import {
  evaluateRuleConditions,
  isRuleInCooldown,
  type RuleCondition,
  type RuleConditionGroup,
} from "./rule-condition-evaluator";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

export type RuleTriggerDispatcherDatabase = RuleActionExecutorDatabase;

export interface RuleTriggerDispatchResult {
  triggerType: RuleTriggerType | string;
  rulesEvaluated: number;
  rulesExecuted: number;
  results: RuleExecutionResult[];
}

export type DispatchableRule = (Rule | RuleItem) & {
  lastExecutedAt?: Date | string | null;
  forceEvaluation?: boolean;
  ignoreConversationMode?: boolean;
};

/**
 * Dispatches rule triggers for a given tenant, evaluating active rules in order of priority.
 * Enforces tenant isolation, module entitlement, conversation automation mode guardrails,
 * channel filters, cooldown windows, and first_match_stop short-circuiting.
 */
export async function dispatchRuleTriggers(
  tenantContext: TenantContext,
  triggerType: RuleTriggerType,
  context: RuleExecutionContext,
  database: RuleTriggerDispatcherDatabase,
  metadata?: RuleMutationMetadata,
): Promise<RuleTriggerDispatchResult> {
  const validatedTenant = createTenantContext(tenantContext.tenantId);
  const tenantId = validatedTenant.tenantId;
  const now = context.now ?? new Date();

  await assertTenantOperational(validatedTenant, database);
  await assertTenantModuleEntitled(validatedTenant, "module.automation.basic", database);

  // Check conversation automation mode
  let conversationMode = context.conversation?.automationMode;
  if (!conversationMode && context.conversationId) {
    const conv = await database.conversation.findFirst({
      select: { automationMode: true },
      where: { id: context.conversationId, tenantId },
    });
    if (conv) {
      conversationMode = conv.automationMode;
    }
  }

  const isHumanOrMonitor = conversationMode === "HUMAN" || conversationMode === "MONITOR";

  const rawRules = await database.rule.findMany({
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    where: {
      status: "active",
      tenantId,
      triggerType,
    },
  });
  const rules = rawRules as DispatchableRule[];

  let rulesEvaluated = 0;
  let rulesExecuted = 0;
  const results: RuleExecutionResult[] = [];

  for (const rule of rules) {
    // 1. Human / Monitor mode check: skip automatic rule unless explicitly forced
    if (isHumanOrMonitor && !rule.forceEvaluation && !rule.ignoreConversationMode) {
      continue;
    }

    // 2. Channel filter
    if (rule.channelAccountId) {
      const contextChannelId = context.channelAccountId ?? context.channel?.channelAccountId;
      if (contextChannelId && rule.channelAccountId !== contextChannelId) {
        continue;
      }
      if (!contextChannelId) {
        continue;
      }
    }

    // 3. Organization Unit filter (if rule specifies organizationUnitId)
    if (rule.organizationUnitId) {
      const contextUnitId = context.conversation?.assignedUnitId;
      if (contextUnitId && rule.organizationUnitId !== contextUnitId) {
        continue;
      }
    }

    // 4. Cooldown check
    const lastExecutedAt =
      rule.lastExecutedAt !== undefined
        ? rule.lastExecutedAt
        : rule.updatedAt && rule.createdAt && rule.updatedAt.getTime() > rule.createdAt.getTime()
          ? rule.updatedAt
          : null;

    if (isRuleInCooldown(lastExecutedAt, rule.cooldownSeconds, now)) {
      continue;
    }

    // 5. Evaluate conditions
    rulesEvaluated++;
    const matches = evaluateRuleConditions(
      rule.conditions as unknown as RuleCondition[] | RuleConditionGroup,
      context,
    );

    if (matches) {
      const executionResult = await executeRuleActions(
        validatedTenant,
        rule,
        context,
        database,
        metadata,
      );
      rulesExecuted++;
      results.push(executionResult);

      if (rule.executionMode === "first_match_stop") {
        break;
      }
    }
  }

  return {
    results,
    rulesEvaluated,
    rulesExecuted,
    triggerType,
  };
}
