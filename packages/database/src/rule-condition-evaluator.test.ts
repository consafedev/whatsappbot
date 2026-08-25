import { describe, expect, it } from "vitest";
import {
  evaluateRuleConditions,
  isRuleInCooldown,
  MAX_REGEX_INPUT_LENGTH,
  MAX_REGEX_PATTERN_LENGTH,
  type RuleCondition,
  type RuleConditionGroup,
  type RuleEvaluationContext,
  resolveContextPath,
} from "./rule-condition-evaluator";

describe("RuleConditionEvaluator", () => {
  const baseContext: RuleEvaluationContext = {
    channel: {
      channelAccountId: "019c0000-0000-7000-8000-000000000001",
      providerType: "mock",
    },
    contact: {
      customAttributes: {
        accountAgeYears: 3,
        isVip: true,
        planTier: "enterprise",
        preferredLanguage: "es",
        score: 95.5,
      },
      name: "Juan Pérez",
      phoneNumber: "+525511223344",
      tags: ["lead", "vip", "urgent"],
    },
    conversation: {
      assignedUnitId: "019c0000-0000-7000-8000-000000000002",
      assignedUserId: null,
      status: "open",
      unreadCount: 4,
    },
    message: {
      direction: "inbound",
      mediaType: "text",
      origin: "customer",
      textBody: "Hola, necesito soporte urgente con mi pedido #12345",
    },
    now: new Date("2026-08-25T12:00:00.000Z"),
  };

  describe("resolveContextPath", () => {
    it("safely retrieves top-level and nested properties", () => {
      expect(resolveContextPath(baseContext, "message.textBody")).toBe(
        "Hola, necesito soporte urgente con mi pedido #12345",
      );
      expect(resolveContextPath(baseContext, "contact.customAttributes.planTier")).toBe(
        "enterprise",
      );
      expect(resolveContextPath(baseContext, "conversation.unreadCount")).toBe(4);
      expect(resolveContextPath(baseContext, "contact.tags")).toEqual(["lead", "vip", "urgent"]);
    });

    it("returns undefined for non-existent paths without throwing", () => {
      expect(resolveContextPath(baseContext, "contact.address.city")).toBeUndefined();
      expect(resolveContextPath(baseContext, "nonExistent.field")).toBeUndefined();
      expect(resolveContextPath(null, "some.path")).toBeUndefined();
      expect(resolveContextPath(undefined, "some.path")).toBeUndefined();
      expect(resolveContextPath(baseContext, "")).toBeUndefined();
    });

    it("guards against prototype pollution attempts", () => {
      expect(resolveContextPath(baseContext, "__proto__.polluted")).toBeUndefined();
      expect(resolveContextPath(baseContext, "constructor.name")).toBeUndefined();
      expect(resolveContextPath(baseContext, "prototype.test")).toBeUndefined();
    });
  });

  describe("String & Text Operators", () => {
    it("evaluates EQUALS and NOT_EQUALS", () => {
      expect(
        evaluateRuleConditions(
          [{ field: "contact.customAttributes.planTier", operator: "EQUALS", value: "enterprise" }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "contact.customAttributes.planTier", operator: "EQUALS", value: "starter" }],
          baseContext,
        ),
      ).toBe(false);

      expect(
        evaluateRuleConditions(
          [
            {
              field: "contact.customAttributes.planTier",
              operator: "NOT_EQUALS",
              value: "starter",
            },
          ],
          baseContext,
        ),
      ).toBe(true);

      // Null handling
      expect(
        evaluateRuleConditions(
          [{ field: "conversation.assignedUserId", operator: "EQUALS", value: null }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "conversation.assignedUserId", operator: "NOT_EQUALS", value: "user-123" }],
          baseContext,
        ),
      ).toBe(true);
    });

    it("evaluates CONTAINS and NOT_CONTAINS", () => {
      expect(
        evaluateRuleConditions(
          [{ field: "message.textBody", operator: "CONTAINS", value: "soporte urgente" }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "message.textBody", operator: "CONTAINS", value: "facturación" }],
          baseContext,
        ),
      ).toBe(false);

      expect(
        evaluateRuleConditions(
          [{ field: "message.textBody", operator: "NOT_CONTAINS", value: "facturación" }],
          baseContext,
        ),
      ).toBe(true);

      // Missing field in context returns false for CONTAINS and true for NOT_CONTAINS
      expect(
        evaluateRuleConditions(
          [{ field: "message.nonExistent", operator: "CONTAINS", value: "test" }],
          baseContext,
        ),
      ).toBe(false);

      expect(
        evaluateRuleConditions(
          [{ field: "message.nonExistent", operator: "NOT_CONTAINS", value: "test" }],
          baseContext,
        ),
      ).toBe(true);
    });

    it("evaluates STARTS_WITH and ENDS_WITH", () => {
      expect(
        evaluateRuleConditions(
          [{ field: "message.textBody", operator: "STARTS_WITH", value: "Hola" }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "message.textBody", operator: "STARTS_WITH", value: "Buenas" }],
          baseContext,
        ),
      ).toBe(false);

      expect(
        evaluateRuleConditions(
          [{ field: "message.textBody", operator: "ENDS_WITH", value: "#12345" }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "message.textBody", operator: "ENDS_WITH", value: "final" }],
          baseContext,
        ),
      ).toBe(false);
    });

    it("evaluates IS_EMPTY and IS_NOT_EMPTY", () => {
      const emptyContext: RuleEvaluationContext = {
        contact: { customAttributes: {}, name: "   ", tags: [] },
        message: { textBody: "" },
      };

      expect(
        evaluateRuleConditions([{ field: "message.textBody", operator: "IS_EMPTY" }], emptyContext),
      ).toBe(true);

      expect(
        evaluateRuleConditions([{ field: "contact.name", operator: "IS_EMPTY" }], emptyContext),
      ).toBe(true);

      expect(
        evaluateRuleConditions([{ field: "contact.tags", operator: "IS_EMPTY" }], emptyContext),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "contact.customAttributes", operator: "IS_EMPTY" }],
          emptyContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "message.textBody", operator: "IS_NOT_EMPTY" }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions([{ field: "contact.tags", operator: "IS_NOT_EMPTY" }], baseContext),
      ).toBe(true);
    });

    it("evaluates MATCHES_REGEX with valid patterns", () => {
      expect(
        evaluateRuleConditions(
          [{ field: "message.textBody", operator: "MATCHES_REGEX", value: "pedido\\s+#\\d+" }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "contact.phoneNumber", operator: "MATCHES_REGEX", value: "^\\+52\\d{10}$" }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "contact.phoneNumber", operator: "MATCHES_REGEX", value: "^\\+1\\d{10}$" }],
          baseContext,
        ),
      ).toBe(false);
    });

    it("handles invalid or oversized regex patterns gracefully without throwing", () => {
      // Invalid regex syntax
      expect(
        evaluateRuleConditions(
          [{ field: "message.textBody", operator: "MATCHES_REGEX", value: "[a-z" }],
          baseContext,
        ),
      ).toBe(false);

      // Oversized pattern
      const longPattern = "a".repeat(MAX_REGEX_PATTERN_LENGTH + 1);
      expect(
        evaluateRuleConditions(
          [{ field: "message.textBody", operator: "MATCHES_REGEX", value: longPattern }],
          baseContext,
        ),
      ).toBe(false);

      // Oversized input text
      const oversizedContext: RuleEvaluationContext = {
        message: { textBody: "x".repeat(MAX_REGEX_INPUT_LENGTH + 1) },
      };
      expect(
        evaluateRuleConditions(
          [{ field: "message.textBody", operator: "MATCHES_REGEX", value: "x+" }],
          oversizedContext,
        ),
      ).toBe(false);
    });
  });

  describe("Numeric Operators", () => {
    it("evaluates GREATER_THAN, GREATER_THAN_OR_EQUAL, LESS_THAN, LESS_THAN_OR_EQUAL", () => {
      expect(
        evaluateRuleConditions(
          [{ field: "conversation.unreadCount", operator: "GREATER_THAN", value: 3 }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "conversation.unreadCount", operator: "GREATER_THAN", value: 4 }],
          baseContext,
        ),
      ).toBe(false);

      expect(
        evaluateRuleConditions(
          [{ field: "conversation.unreadCount", operator: "GREATER_THAN_OR_EQUAL", value: 4 }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "conversation.unreadCount", operator: "LESS_THAN", value: 10 }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "conversation.unreadCount", operator: "LESS_THAN_OR_EQUAL", value: 4 }],
          baseContext,
        ),
      ).toBe(true);
    });

    it("evaluates NUMERIC_EQUALS and NUMERIC_NOT_EQUALS with type coercion", () => {
      expect(
        evaluateRuleConditions(
          [{ field: "conversation.unreadCount", operator: "NUMERIC_EQUALS", value: "4" }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "contact.customAttributes.score", operator: "NUMERIC_EQUALS", value: 95.5 }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "contact.customAttributes.score", operator: "NUMERIC_NOT_EQUALS", value: 100 }],
          baseContext,
        ),
      ).toBe(true);

      // Non-numeric fields return false
      expect(
        evaluateRuleConditions(
          [{ field: "contact.name", operator: "NUMERIC_EQUALS", value: 4 }],
          baseContext,
        ),
      ).toBe(false);
    });
  });

  describe("Lists, Arrays & Tags Operators", () => {
    it("evaluates IN and NOT_IN", () => {
      expect(
        evaluateRuleConditions(
          [
            {
              field: "contact.customAttributes.planTier",
              operator: "IN",
              value: ["starter", "pro", "enterprise"],
            },
          ],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [
            {
              field: "contact.customAttributes.planTier",
              operator: "IN",
              value: ["free", "trial"],
            },
          ],
          baseContext,
        ),
      ).toBe(false);

      expect(
        evaluateRuleConditions(
          [
            {
              field: "contact.customAttributes.planTier",
              operator: "NOT_IN",
              value: ["free", "trial"],
            },
          ],
          baseContext,
        ),
      ).toBe(true);
    });

    it("evaluates CONTAINS_ANY and CONTAINS_ALL on arrays", () => {
      expect(
        evaluateRuleConditions(
          [{ field: "contact.tags", operator: "CONTAINS_ANY", value: ["vip", "partner"] }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "contact.tags", operator: "CONTAINS_ANY", value: ["blocked", "spam"] }],
          baseContext,
        ),
      ).toBe(false);

      expect(
        evaluateRuleConditions(
          [{ field: "contact.tags", operator: "CONTAINS_ALL", value: ["lead", "vip"] }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "contact.tags", operator: "CONTAINS_ALL", value: ["lead", "vip", "partner"] }],
          baseContext,
        ),
      ).toBe(false);
    });

    it("evaluates ARRAY_EMPTY and ARRAY_NOT_EMPTY", () => {
      expect(
        evaluateRuleConditions(
          [{ field: "contact.tags", operator: "ARRAY_NOT_EMPTY" }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions([{ field: "contact.tags", operator: "ARRAY_EMPTY" }], baseContext),
      ).toBe(false);

      const emptyTagsContext: RuleEvaluationContext = {
        contact: { tags: [] },
      };

      expect(
        evaluateRuleConditions(
          [{ field: "contact.tags", operator: "ARRAY_EMPTY" }],
          emptyTagsContext,
        ),
      ).toBe(true);
    });
  });

  describe("Existence, Nulls & Booleans", () => {
    it("evaluates IS_NULL, IS_NOT_NULL and EXISTS", () => {
      expect(
        evaluateRuleConditions(
          [{ field: "conversation.assignedUserId", operator: "IS_NULL" }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "conversation.assignedUnitId", operator: "IS_NOT_NULL" }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions([{ field: "contact.phoneNumber", operator: "EXISTS" }], baseContext),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "contact.nonExistent", operator: "IS_NULL" }],
          baseContext,
        ),
      ).toBe(true);
    });

    it("evaluates IS_TRUE and IS_FALSE", () => {
      expect(
        evaluateRuleConditions(
          [{ field: "contact.customAttributes.isVip", operator: "IS_TRUE" }],
          baseContext,
        ),
      ).toBe(true);

      expect(
        evaluateRuleConditions(
          [{ field: "contact.customAttributes.isVip", operator: "IS_FALSE" }],
          baseContext,
        ),
      ).toBe(false);

      const falseContext: RuleEvaluationContext = {
        contact: { customAttributes: { isVip: false } },
      };

      expect(
        evaluateRuleConditions(
          [{ field: "contact.customAttributes.isVip", operator: "IS_FALSE" }],
          falseContext,
        ),
      ).toBe(true);
    });
  });

  describe("Complex Condition Trees & Short-Circuiting", () => {
    it("returns true for empty conditions or empty groups (catch-all rules)", () => {
      expect(evaluateRuleConditions([], baseContext)).toBe(true);
      expect(evaluateRuleConditions(null, baseContext)).toBe(true);
      expect(evaluateRuleConditions(undefined, baseContext)).toBe(true);
      expect(evaluateRuleConditions({ conditions: [], logicalOperator: "AND" }, baseContext)).toBe(
        true,
      );
      expect(evaluateRuleConditions({ conditions: [], logicalOperator: "OR" }, baseContext)).toBe(
        true,
      );
    });

    it("evaluates nested AND / OR groups accurately with short-circuiting", () => {
      // (isVip == true OR planTier == "enterprise") AND textBody CONTAINS "urgente"
      const tree: RuleConditionGroup = {
        conditions: [
          {
            conditions: [
              { field: "contact.customAttributes.isVip", operator: "IS_TRUE" },
              { field: "contact.customAttributes.planTier", operator: "EQUALS", value: "starter" },
            ],
            logicalOperator: "OR",
          },
          {
            field: "message.textBody",
            operator: "CONTAINS",
            value: "urgente",
          },
        ],
        logicalOperator: "AND",
      };

      expect(evaluateRuleConditions(tree, baseContext)).toBe(true);

      // Same tree with failing second group
      const failingTree: RuleConditionGroup = {
        conditions: [
          {
            conditions: [
              { field: "contact.customAttributes.isVip", operator: "IS_FALSE" },
              { field: "contact.customAttributes.planTier", operator: "EQUALS", value: "starter" },
            ],
            logicalOperator: "OR",
          },
          {
            field: "message.textBody",
            operator: "CONTAINS",
            value: "urgente",
          },
        ],
        logicalOperator: "AND",
      };

      expect(evaluateRuleConditions(failingTree, baseContext)).toBe(false);
    });

    it("evaluates deeply nested 3-level tree", () => {
      const complexTree: RuleConditionGroup = {
        conditions: [
          {
            conditions: [
              {
                conditions: [
                  { field: "conversation.unreadCount", operator: "GREATER_THAN", value: 2 },
                  { field: "conversation.status", operator: "EQUALS", value: "open" },
                ],
                logicalOperator: "AND",
              },
              { field: "contact.tags", operator: "CONTAINS_ANY", value: ["blocked"] },
            ],
            logicalOperator: "OR",
          },
          { field: "message.origin", operator: "EQUALS", value: "customer" },
        ],
        logicalOperator: "AND",
      };

      expect(evaluateRuleConditions(complexTree, baseContext)).toBe(true);
    });
  });

  describe("Cooldown Evaluation (isRuleInCooldown)", () => {
    const fixedNow = new Date("2026-08-25T12:00:00.000Z");

    it("returns false when cooldownSeconds is 0 or negative", () => {
      const executedAt = new Date("2026-08-25T11:59:50.000Z"); // 10 seconds ago
      expect(isRuleInCooldown(executedAt, 0, fixedNow)).toBe(false);
      expect(isRuleInCooldown(executedAt, -5, fixedNow)).toBe(false);
    });

    it("returns false when lastExecutedAt is null or undefined", () => {
      expect(isRuleInCooldown(null, 60, fixedNow)).toBe(false);
      expect(isRuleInCooldown(undefined, 60, fixedNow)).toBe(false);
    });

    it("returns true when within cooldown period", () => {
      const executedAt = new Date("2026-08-25T11:59:30.000Z"); // 30 seconds ago
      expect(isRuleInCooldown(executedAt, 60, fixedNow)).toBe(true); // cooldown is 60s -> true
    });

    it("returns false when cooldown period has elapsed", () => {
      const executedAt = new Date("2026-08-25T11:58:00.000Z"); // 120 seconds ago
      expect(isRuleInCooldown(executedAt, 60, fixedNow)).toBe(false); // cooldown is 60s -> false
    });

    it("returns false when executed exactly at the boundary", () => {
      const executedAt = new Date("2026-08-25T11:59:00.000Z"); // 60 seconds ago
      expect(isRuleInCooldown(executedAt, 60, fixedNow)).toBe(false); // diffMs === 60000 -> false
    });

    it("handles future timestamps defensively", () => {
      const futureDate = new Date("2026-08-25T12:05:00.000Z");
      expect(isRuleInCooldown(futureDate, 60, fixedNow)).toBe(false);
    });
  });

  describe("ReDoS Security Verification", () => {
    it("safely blocks catastrophic backtracking patterns within sub-millisecond execution", () => {
      const maliciousPatterns = [
        "(a+)+$",
        "(a*)*$",
        "(a|a)+$",
        "([a-zA-Z]+)*$",
        "(x+x+)+y",
        "((a+)+)+",
      ];

      const attackPayload = `${"a".repeat(40)}X`;
      const attackContext: RuleEvaluationContext = {
        message: { textBody: attackPayload },
      };

      for (const pattern of maliciousPatterns) {
        const start = performance.now();
        const condition: RuleCondition = {
          field: "message.textBody",
          operator: "MATCHES_REGEX",
          value: pattern,
        };
        const result = evaluateRuleConditions([condition], attackContext);
        const duration = performance.now() - start;

        // Must reject pattern safely
        expect(result).toBe(false);
        // Must execute under 50ms (strictly blocking ReDoS)
        expect(duration).toBeLessThan(50);
      }
    });
  });
});
