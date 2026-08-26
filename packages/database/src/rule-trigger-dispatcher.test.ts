import { describe, expect, it, vi } from "vitest";
import type { RuleExecutionContext } from "./rule-action-executor";
import * as ruleActionExecutor from "./rule-action-executor";
import {
  type DispatchableRule,
  dispatchRuleTriggers,
  type RuleTriggerDispatcherDatabase,
} from "./rule-trigger-dispatcher";
import { createTenantContext } from "./tenant-context";
import { TenantModuleEntitlementRequiredError } from "./tenant-entitlements";
import { TenantNotOperationalError } from "./tenant-operational";

describe("RuleTriggerDispatcher (unit)", () => {
  const tenantId = "01950000-0000-7000-8000-000000000001";
  const tenantContext = createTenantContext(tenantId);
  const now = new Date("2026-08-25T12:00:00.000Z");

  const baseContext: RuleExecutionContext = {
    channel: {
      channelAccountId: "01950000-0000-7000-8000-000000000010",
      providerType: "mock",
    },
    channelAccountId: "01950000-0000-7000-8000-000000000010",
    contact: {
      customAttributes: { tier: "gold" },
      name: "Juan Perez",
      phoneNumber: "+5215512345678",
      tags: ["vip", "lead"],
    },
    contactId: "01950000-0000-7000-8000-000000000020",
    conversation: {
      assignedUnitId: "01950000-0000-7000-8000-000000000040",
      assignedUserId: null,
      automationMode: "AUTO",
      status: "open",
      unreadCount: 1,
    },
    conversationId: "01950000-0000-7000-8000-000000000030",
    message: {
      direction: "inbound",
      mediaType: null,
      origin: "customer",
      textBody: "Hola quiero soporte para mi cuenta",
    },
    now,
  };

  function createMockDb(
    rules: DispatchableRule[],
    options?: {
      isOperational?: boolean;
      isEntitled?: boolean;
      conversation?: { automationMode: string } | null;
    },
  ): RuleTriggerDispatcherDatabase {
    const isOperational = options?.isOperational ?? true;
    const isEntitled = options?.isEntitled ?? true;

    return {
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({} as unknown)),
      conversation: {
        findFirst: vi.fn(async () => options?.conversation ?? { automationMode: "AUTO" }),
      },
      rule: {
        findMany: vi.fn(
          async ({
            where,
            orderBy,
          }: {
            where: { tenantId: string; status: string; triggerType: string };
            orderBy?: Array<{ priority?: "asc" | "desc"; createdAt?: "asc" | "desc" }>;
          }) => {
            let filtered = rules.filter(
              (r) =>
                r.tenantId === where.tenantId &&
                r.status === where.status &&
                r.triggerType === where.triggerType,
            );
            if (Array.isArray(orderBy)) {
              filtered = [...filtered].sort((a, b) => {
                if (a.priority !== b.priority) {
                  return a.priority - b.priority;
                }
                return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
              });
            }
            return filtered;
          },
        ),
      },
      tenant: {
        findUnique: vi.fn(async () => (isOperational ? { id: tenantId, status: "active" } : null)),
      },
      tenantEntitlement: {
        findUnique: vi.fn(
          async ({ where }: { where: { tenantId_entitlementKey: { entitlementKey: string } } }) =>
            isEntitled
              ? {
                  enabled: true,
                  endsAt: null,
                  entitlementKey: where.tenantId_entitlementKey.entitlementKey,
                  startsAt: null,
                  tenantId,
                }
              : null,
        ),
      },
    } as unknown as RuleTriggerDispatcherDatabase;
  }

  it("evaluates rules in priority order (ascending)", async () => {
    const ruleHighPriority: DispatchableRule = {
      actions: [{ actionType: "ADD_CONTACT_TAG", parameters: { tag: "priority-high" } }],
      channelAccountId: null,
      conditions: [{ field: "message.textBody", operator: "CONTAINS", value: "soporte" }],
      cooldownSeconds: 0,
      createdAt: new Date("2026-08-25T10:00:00Z"),
      description: null,
      executionMode: "evaluate_all",
      id: "rule-high",
      name: "High Priority Rule",
      organizationUnitId: null,
      priority: 10,
      status: "active",
      tenantId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date("2026-08-25T10:00:00Z"),
    };

    const ruleLowPriority: DispatchableRule = {
      actions: [{ actionType: "ADD_CONTACT_TAG", parameters: { tag: "priority-low" } }],
      channelAccountId: null,
      conditions: [{ field: "message.textBody", operator: "CONTAINS", value: "soporte" }],
      cooldownSeconds: 0,
      createdAt: new Date("2026-08-25T09:00:00Z"),
      description: null,
      executionMode: "evaluate_all",
      id: "rule-low",
      name: "Low Priority Rule",
      organizationUnitId: null,
      priority: 100,
      status: "active",
      tenantId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date("2026-08-25T09:00:00Z"),
    };

    const mockDb = createMockDb([ruleLowPriority, ruleHighPriority]);
    const executedRuleIds: string[] = [];

    vi.spyOn(ruleActionExecutor, "executeRuleActions").mockImplementation(async (_tenant, rule) => {
      executedRuleIds.push(rule.id);
      return {
        actionsApplied: ["ADD_CONTACT_TAG"],
        ruleId: rule.id,
        success: true,
        timestamp: now,
      };
    });

    const result = await dispatchRuleTriggers(
      tenantContext,
      "ON_MESSAGE_RECEIVED",
      baseContext,
      mockDb,
    );

    expect(result.rulesEvaluated).toBe(2);
    expect(result.rulesExecuted).toBe(2);
    expect(executedRuleIds).toEqual(["rule-high", "rule-low"]);
    expect(result.results.map((r) => r.ruleId)).toEqual(["rule-high", "rule-low"]);
  });

  it("halts further evaluation when a rule with first_match_stop matches", async () => {
    const rule1: DispatchableRule = {
      actions: [{ actionType: "SEND_MESSAGE", parameters: { text: "Primer mensaje" } }],
      channelAccountId: null,
      conditions: [{ field: "message.textBody", operator: "CONTAINS", value: "soporte" }],
      cooldownSeconds: 0,
      createdAt: new Date("2026-08-25T10:00:00Z"),
      description: null,
      executionMode: "first_match_stop",
      id: "rule-first-stop",
      name: "First Match Stop",
      organizationUnitId: null,
      priority: 10,
      status: "active",
      tenantId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date("2026-08-25T10:00:00Z"),
    };

    const rule2: DispatchableRule = {
      actions: [{ actionType: "SEND_MESSAGE", parameters: { text: "Segundo mensaje" } }],
      channelAccountId: null,
      conditions: [{ field: "message.textBody", operator: "CONTAINS", value: "soporte" }],
      cooldownSeconds: 0,
      createdAt: new Date("2026-08-25T09:00:00Z"),
      description: null,
      executionMode: "evaluate_all",
      id: "rule-second",
      name: "Second Rule",
      organizationUnitId: null,
      priority: 20,
      status: "active",
      tenantId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date("2026-08-25T09:00:00Z"),
    };

    const mockDb = createMockDb([rule1, rule2]);
    const executedRuleIds: string[] = [];

    vi.spyOn(ruleActionExecutor, "executeRuleActions").mockImplementation(async (_tenant, rule) => {
      executedRuleIds.push(rule.id);
      return {
        actionsApplied: ["SEND_MESSAGE"],
        ruleId: rule.id,
        success: true,
        timestamp: now,
      };
    });

    const result = await dispatchRuleTriggers(
      tenantContext,
      "ON_MESSAGE_RECEIVED",
      baseContext,
      mockDb,
    );

    expect(result.rulesEvaluated).toBe(1);
    expect(result.rulesExecuted).toBe(1);
    expect(executedRuleIds).toEqual(["rule-first-stop"]);
  });

  it("continues evaluating when rules have evaluate_all", async () => {
    const rule1: DispatchableRule = {
      actions: [{ actionType: "ADD_CONTACT_TAG", parameters: { tag: "tag1" } }],
      channelAccountId: null,
      conditions: [{ field: "message.textBody", operator: "CONTAINS", value: "soporte" }],
      cooldownSeconds: 0,
      createdAt: new Date("2026-08-25T10:00:00Z"),
      description: null,
      executionMode: "evaluate_all",
      id: "rule-eval-all-1",
      name: "Rule Eval All 1",
      organizationUnitId: null,
      priority: 10,
      status: "active",
      tenantId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date("2026-08-25T10:00:00Z"),
    };

    const rule2: DispatchableRule = {
      actions: [{ actionType: "ADD_CONTACT_TAG", parameters: { tag: "tag2" } }],
      channelAccountId: null,
      conditions: [{ field: "message.textBody", operator: "CONTAINS", value: "soporte" }],
      cooldownSeconds: 0,
      createdAt: new Date("2026-08-25T09:00:00Z"),
      description: null,
      executionMode: "evaluate_all",
      id: "rule-eval-all-2",
      name: "Rule Eval All 2",
      organizationUnitId: null,
      priority: 20,
      status: "active",
      tenantId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date("2026-08-25T09:00:00Z"),
    };

    const mockDb = createMockDb([rule1, rule2]);
    const executedRuleIds: string[] = [];

    vi.spyOn(ruleActionExecutor, "executeRuleActions").mockImplementation(async (_tenant, rule) => {
      executedRuleIds.push(rule.id);
      return {
        actionsApplied: ["ADD_CONTACT_TAG"],
        ruleId: rule.id,
        success: true,
        timestamp: now,
      };
    });

    const result = await dispatchRuleTriggers(
      tenantContext,
      "ON_MESSAGE_RECEIVED",
      baseContext,
      mockDb,
    );

    expect(result.rulesEvaluated).toBe(2);
    expect(result.rulesExecuted).toBe(2);
    expect(executedRuleIds).toEqual(["rule-eval-all-1", "rule-eval-all-2"]);
  });

  it("omits rules that are within cooldown window", async () => {
    const ruleInCooldown: DispatchableRule = {
      actions: [{ actionType: "SEND_MESSAGE", parameters: { text: "Auto-reply" } }],
      channelAccountId: null,
      conditions: [],
      cooldownSeconds: 300, // 5 minutes
      createdAt: new Date("2026-08-25T10:00:00Z"),
      description: null,
      executionMode: "evaluate_all",
      id: "rule-cooldown",
      lastExecutedAt: new Date("2026-08-25T11:58:00Z"), // Executed 2 minutes ago (in cooldown)
      name: "Cooldown Rule",
      organizationUnitId: null,
      priority: 10,
      status: "active",
      tenantId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date("2026-08-25T11:58:00Z"),
    };

    const ruleOutOfCooldown: DispatchableRule = {
      actions: [{ actionType: "SEND_MESSAGE", parameters: { text: "Auto-reply 2" } }],
      channelAccountId: null,
      conditions: [],
      cooldownSeconds: 60, // 1 minute
      createdAt: new Date("2026-08-25T10:00:00Z"),
      description: null,
      executionMode: "evaluate_all",
      id: "rule-ready",
      lastExecutedAt: new Date("2026-08-25T11:55:00Z"), // Executed 5 minutes ago (out of cooldown)
      name: "Ready Rule",
      organizationUnitId: null,
      priority: 20,
      status: "active",
      tenantId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date("2026-08-25T11:55:00Z"),
    };

    const mockDb = createMockDb([ruleInCooldown, ruleOutOfCooldown]);
    const executedRuleIds: string[] = [];

    vi.spyOn(ruleActionExecutor, "executeRuleActions").mockImplementation(async (_tenant, rule) => {
      executedRuleIds.push(rule.id);
      return {
        actionsApplied: ["SEND_MESSAGE"],
        ruleId: rule.id,
        success: true,
        timestamp: now,
      };
    });

    const result = await dispatchRuleTriggers(
      tenantContext,
      "ON_MESSAGE_RECEIVED",
      baseContext,
      mockDb,
    );

    expect(result.rulesEvaluated).toBe(1); // Only rule-ready was evaluated
    expect(result.rulesExecuted).toBe(1);
    expect(executedRuleIds).toEqual(["rule-ready"]);
  });

  it("omits rules with channelAccountId filter that does not match context channel", async () => {
    const ruleOtherChannel: DispatchableRule = {
      actions: [{ actionType: "SEND_MESSAGE", parameters: { text: "Reply" } }],
      channelAccountId: "01950000-0000-7000-8000-000000000099", // Different channel
      conditions: [],
      cooldownSeconds: 0,
      createdAt: new Date("2026-08-25T10:00:00Z"),
      description: null,
      executionMode: "evaluate_all",
      id: "rule-diff-channel",
      name: "Different Channel Rule",
      organizationUnitId: null,
      priority: 10,
      status: "active",
      tenantId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date("2026-08-25T10:00:00Z"),
    };

    const ruleMatchingChannel: DispatchableRule = {
      actions: [{ actionType: "SEND_MESSAGE", parameters: { text: "Reply" } }],
      channelAccountId: "01950000-0000-7000-8000-000000000010", // Matching channel
      conditions: [],
      cooldownSeconds: 0,
      createdAt: new Date("2026-08-25T10:00:00Z"),
      description: null,
      executionMode: "evaluate_all",
      id: "rule-match-channel",
      name: "Matching Channel Rule",
      organizationUnitId: null,
      priority: 20,
      status: "active",
      tenantId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date("2026-08-25T10:00:00Z"),
    };

    const mockDb = createMockDb([ruleOtherChannel, ruleMatchingChannel]);
    const executedRuleIds: string[] = [];

    vi.spyOn(ruleActionExecutor, "executeRuleActions").mockImplementation(async (_tenant, rule) => {
      executedRuleIds.push(rule.id);
      return {
        actionsApplied: ["SEND_MESSAGE"],
        ruleId: rule.id,
        success: true,
        timestamp: now,
      };
    });

    const result = await dispatchRuleTriggers(
      tenantContext,
      "ON_MESSAGE_RECEIVED",
      baseContext,
      mockDb,
    );

    expect(result.rulesEvaluated).toBe(1);
    expect(result.rulesExecuted).toBe(1);
    expect(executedRuleIds).toEqual(["rule-match-channel"]);
  });

  it("blocks automatic rules when conversation is in HUMAN mode unless forced", async () => {
    const ruleAutomatic: DispatchableRule = {
      actions: [{ actionType: "SEND_MESSAGE", parameters: { text: "Auto-reply" } }],
      channelAccountId: null,
      conditions: [],
      cooldownSeconds: 0,
      createdAt: new Date("2026-08-25T10:00:00Z"),
      description: null,
      executionMode: "evaluate_all",
      id: "rule-automatic",
      name: "Automatic Bot Rule",
      organizationUnitId: null,
      priority: 10,
      status: "active",
      tenantId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date("2026-08-25T10:00:00Z"),
    };

    const ruleForced: DispatchableRule = {
      actions: [{ actionType: "ADD_CONTACT_TAG", parameters: { tag: "audit-tag" } }],
      channelAccountId: null,
      conditions: [],
      cooldownSeconds: 0,
      createdAt: new Date("2026-08-25T10:00:00Z"),
      description: null,
      executionMode: "evaluate_all",
      forceEvaluation: true, // Explicitly forced
      id: "rule-forced",
      name: "Forced Audit Rule",
      organizationUnitId: null,
      priority: 20,
      status: "active",
      tenantId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date("2026-08-25T10:00:00Z"),
    };

    const humanContext: RuleExecutionContext = {
      ...baseContext,
      conversation: {
        ...baseContext.conversation,
        automationMode: "HUMAN",
      },
    };

    const mockDb = createMockDb([ruleAutomatic, ruleForced], {
      conversation: { automationMode: "HUMAN" },
    });
    const executedRuleIds: string[] = [];

    vi.spyOn(ruleActionExecutor, "executeRuleActions").mockImplementation(async (_tenant, rule) => {
      executedRuleIds.push(rule.id);
      return {
        actionsApplied: ["ADD_CONTACT_TAG"],
        ruleId: rule.id,
        success: true,
        timestamp: now,
      };
    });

    const result = await dispatchRuleTriggers(
      tenantContext,
      "ON_MESSAGE_RECEIVED",
      humanContext,
      mockDb,
    );

    expect(result.rulesEvaluated).toBe(1); // Only rule-forced was evaluated
    expect(result.rulesExecuted).toBe(1);
    expect(executedRuleIds).toEqual(["rule-forced"]);
  });

  it("blocks automatic rules when conversation is in MONITOR mode", async () => {
    const ruleAutomatic: DispatchableRule = {
      actions: [{ actionType: "SEND_MESSAGE", parameters: { text: "Auto-reply" } }],
      channelAccountId: null,
      conditions: [],
      cooldownSeconds: 0,
      createdAt: new Date("2026-08-25T10:00:00Z"),
      description: null,
      executionMode: "evaluate_all",
      id: "rule-automatic",
      name: "Automatic Bot Rule",
      organizationUnitId: null,
      priority: 10,
      status: "active",
      tenantId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date("2026-08-25T10:00:00Z"),
    };

    const monitorContext: RuleExecutionContext = {
      ...baseContext,
      conversation: {
        ...baseContext.conversation,
        automationMode: "MONITOR",
      },
    };

    const mockDb = createMockDb([ruleAutomatic], {
      conversation: { automationMode: "MONITOR" },
    });

    const result = await dispatchRuleTriggers(
      tenantContext,
      "ON_MESSAGE_RECEIVED",
      monitorContext,
      mockDb,
    );

    expect(result.rulesEvaluated).toBe(0);
    expect(result.rulesExecuted).toBe(0);
  });

  it("fails closed if tenant is not operational (e.g. suspended)", async () => {
    const mockDb = createMockDb([], { isOperational: false });

    await expect(
      dispatchRuleTriggers(tenantContext, "ON_MESSAGE_RECEIVED", baseContext, mockDb),
    ).rejects.toBeInstanceOf(TenantNotOperationalError);
  });

  it("fails closed if tenant is not entitled to module.automation.basic", async () => {
    const mockDb = createMockDb([], { isEntitled: false });

    await expect(
      dispatchRuleTriggers(tenantContext, "ON_MESSAGE_RECEIVED", baseContext, mockDb),
    ).rejects.toBeInstanceOf(TenantModuleEntitlementRequiredError);
  });
});
