export const RULE_OPERATORS = [
  // String / Text
  "EQUALS",
  "NOT_EQUALS",
  "CONTAINS",
  "NOT_CONTAINS",
  "STARTS_WITH",
  "ENDS_WITH",
  "MATCHES_REGEX",
  "IS_EMPTY",
  "IS_NOT_EMPTY",
  // Numeric
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
  "NUMERIC_EQUALS",
  "NUMERIC_NOT_EQUALS",
  // Lists / Arrays / Tags
  "IN",
  "NOT_IN",
  "CONTAINS_ANY",
  "CONTAINS_ALL",
  "ARRAY_EMPTY",
  "ARRAY_NOT_EMPTY",
  // Existence / Booleans / Nulls
  "IS_NULL",
  "IS_NOT_NULL",
  "IS_TRUE",
  "IS_FALSE",
] as const;

export type RuleOperator = (typeof RULE_OPERATORS)[number];

import type { BusinessHoursConfig } from "./business-hours-evaluator";

export interface RuleEvaluationContext {
  message?: {
    textBody?: string | null;
    mediaType?: string | null;
    origin?: string;
    direction?: string;
  };
  contact?: {
    name?: string | null;
    phoneNumber?: string;
    tags?: string[];
    customAttributes?: Record<string, unknown>;
  };
  conversation?: {
    status?: string;
    automationMode?: string;
    assignedUserId?: string | null;
    assignedUnitId?: string | null;
    unreadCount?: number;
  };
  channel?: {
    channelAccountId?: string;
    providerType?: string;
    isWithinBusinessHours?: boolean;
    businessHours?: BusinessHoursConfig | null;
  };
  now?: Date;
  [key: string]: unknown;
}

export interface RuleCondition {
  field: string;
  operator: RuleOperator | string;
  value?: unknown;
}

export interface RuleConditionGroup {
  logicalOperator: "AND" | "OR";
  conditions: (RuleCondition | RuleConditionGroup)[];
}

const FORBIDDEN_PROPERTIES = new Set(["__proto__", "constructor", "prototype"]);

export const MAX_REGEX_PATTERN_LENGTH = 100;
export const MAX_REGEX_INPUT_LENGTH = 10_000;

// Static pattern detection for dangerous backtracking in regexes (nested quantifiers, overlapping groups)
const DANGEROUS_NESTED_QUANTIFIER_REGEX =
  /\([^)]*(\+|\*|\{[0-9]+,?[0-9]*\})[^)]*\)(\+|\*|\{[0-9]+,?[0-9]*\})/i;
const DANGEROUS_OVERLAPPING_ALTERNATION_REGEX = /\((.+)\|(\1)\)(\+|\*|\{)/i;

/**
 * Safely resolves nested properties using dot-notation (e.g. `contact.customAttributes.planTier`).
 * Guards against prototype pollution and returns `undefined` for non-existent paths without throwing.
 */
export function resolveContextPath(context: unknown, path: string): unknown {
  if (context === null || context === undefined || typeof context !== "object" || !path) {
    return undefined;
  }
  const segments = path.trim().split(".");
  let current: unknown = context;

  for (const segment of segments) {
    if (!segment || FORBIDDEN_PROPERTIES.has(segment)) {
      return undefined;
    }
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function isSafeRegex(pattern: string): boolean {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH || pattern.length === 0) {
    return false;
  }
  if (
    DANGEROUS_NESTED_QUANTIFIER_REGEX.test(pattern) ||
    DANGEROUS_OVERLAPPING_ALTERNATION_REGEX.test(pattern)
  ) {
    return false;
  }
  return true;
}

function evaluateRegex(actualValue: unknown, patternValue: unknown): boolean {
  if (typeof patternValue !== "string" || actualValue === null || actualValue === undefined) {
    return false;
  }
  if (!isSafeRegex(patternValue)) {
    return false;
  }
  const text = String(actualValue);
  if (text.length > MAX_REGEX_INPUT_LENGTH) {
    return false;
  }

  try {
    const regex = new RegExp(patternValue, "i");
    return regex.test(text);
  } catch {
    return false;
  }
}

function evaluateCondition(condition: RuleCondition, context: RuleEvaluationContext): boolean {
  const actualValue = resolveContextPath(context, condition.field);
  const operatorRaw = String(condition.operator ?? "")
    .trim()
    .toUpperCase();
  const expectedValue = condition.value;

  switch (operatorRaw) {
    // String / Text operators
    case "EQUALS": {
      if (actualValue === null || actualValue === undefined) {
        return expectedValue === null || expectedValue === undefined;
      }
      return String(actualValue) === String(expectedValue);
    }
    case "NOT_EQUALS": {
      if (actualValue === null || actualValue === undefined) {
        return expectedValue !== null && expectedValue !== undefined;
      }
      return String(actualValue) !== String(expectedValue);
    }
    case "CONTAINS": {
      if (actualValue === null || actualValue === undefined) return false;
      return String(actualValue).includes(String(expectedValue));
    }
    case "NOT_CONTAINS": {
      if (actualValue === null || actualValue === undefined) return true;
      return !String(actualValue).includes(String(expectedValue));
    }
    case "STARTS_WITH": {
      if (actualValue === null || actualValue === undefined) return false;
      return String(actualValue).startsWith(String(expectedValue));
    }
    case "ENDS_WITH": {
      if (actualValue === null || actualValue === undefined) return false;
      return String(actualValue).endsWith(String(expectedValue));
    }
    case "MATCHES_REGEX": {
      return evaluateRegex(actualValue, expectedValue);
    }
    case "IS_EMPTY": {
      if (actualValue === null || actualValue === undefined) return true;
      if (typeof actualValue === "string") return actualValue.trim().length === 0;
      if (Array.isArray(actualValue)) return actualValue.length === 0;
      if (typeof actualValue === "object") return Object.keys(actualValue).length === 0;
      return false;
    }
    case "IS_NOT_EMPTY": {
      if (actualValue === null || actualValue === undefined) return false;
      if (typeof actualValue === "string") return actualValue.trim().length > 0;
      if (Array.isArray(actualValue)) return actualValue.length > 0;
      if (typeof actualValue === "object") return Object.keys(actualValue).length > 0;
      return true;
    }

    // Numeric operators
    case "GREATER_THAN": {
      const act = parseNumber(actualValue);
      const exp = parseNumber(expectedValue);
      if (act === null || exp === null) return false;
      return act > exp;
    }
    case "GREATER_THAN_OR_EQUAL": {
      const act = parseNumber(actualValue);
      const exp = parseNumber(expectedValue);
      if (act === null || exp === null) return false;
      return act >= exp;
    }
    case "LESS_THAN": {
      const act = parseNumber(actualValue);
      const exp = parseNumber(expectedValue);
      if (act === null || exp === null) return false;
      return act < exp;
    }
    case "LESS_THAN_OR_EQUAL": {
      const act = parseNumber(actualValue);
      const exp = parseNumber(expectedValue);
      if (act === null || exp === null) return false;
      return act <= exp;
    }
    case "NUMERIC_EQUALS": {
      const act = parseNumber(actualValue);
      const exp = parseNumber(expectedValue);
      if (act === null || exp === null) return false;
      return act === exp;
    }
    case "NUMERIC_NOT_EQUALS": {
      const act = parseNumber(actualValue);
      const exp = parseNumber(expectedValue);
      if (act === null || exp === null) return false;
      return act !== exp;
    }

    // Lists / Arrays / Tags operators
    case "IN": {
      if (actualValue === null || actualValue === undefined) return false;
      if (!Array.isArray(expectedValue)) return false;
      const actualStr = String(actualValue);
      return expectedValue.some((item) => item === actualValue || String(item) === actualStr);
    }
    case "NOT_IN": {
      if (actualValue === null || actualValue === undefined) return true;
      if (!Array.isArray(expectedValue)) return true;
      const actualStr = String(actualValue);
      return !expectedValue.some((item) => item === actualValue || String(item) === actualStr);
    }
    case "CONTAINS_ANY": {
      if (!Array.isArray(actualValue)) return false;
      const targets = Array.isArray(expectedValue) ? expectedValue : [expectedValue];
      if (targets.length === 0) return false;
      return targets.some((target) => {
        const targetStr = String(target);
        return actualValue.some((act) => act === target || String(act) === targetStr);
      });
    }
    case "CONTAINS_ALL": {
      if (!Array.isArray(actualValue)) return false;
      const targets = Array.isArray(expectedValue) ? expectedValue : [expectedValue];
      if (targets.length === 0) return true;
      return targets.every((target) => {
        const targetStr = String(target);
        return actualValue.some((act) => act === target || String(act) === targetStr);
      });
    }
    case "ARRAY_EMPTY": {
      if (actualValue === null || actualValue === undefined) return true;
      return Array.isArray(actualValue) && actualValue.length === 0;
    }
    case "ARRAY_NOT_EMPTY": {
      return Array.isArray(actualValue) && actualValue.length > 0;
    }

    // Existence / Booleans / Nulls operators
    case "IS_NULL": {
      return actualValue === null || actualValue === undefined;
    }
    case "IS_NOT_NULL":
    case "EXISTS": {
      return actualValue !== null && actualValue !== undefined;
    }
    case "IS_TRUE": {
      return (
        actualValue === true ||
        (typeof actualValue === "string" && actualValue.toLowerCase() === "true") ||
        actualValue === 1
      );
    }
    case "IS_FALSE": {
      return (
        actualValue === false ||
        (typeof actualValue === "string" && actualValue.toLowerCase() === "false") ||
        actualValue === 0
      );
    }

    default:
      return false;
  }
}

function isRuleConditionGroup(item: unknown): item is RuleConditionGroup {
  return (
    typeof item === "object" &&
    item !== null &&
    "logicalOperator" in item &&
    Array.isArray((item as RuleConditionGroup).conditions)
  );
}

/**
 * Pure and deterministic condition evaluator.
 * Evaluates condition trees (single conditions, flat arrays, or nested AND/OR groups)
 * against a given RuleEvaluationContext with short-circuiting.
 *
 * An empty condition list or group returns `true` (catch-all rule).
 */
export function evaluateRuleConditions(
  conditionTree:
    | RuleConditionGroup
    | readonly (RuleCondition | RuleConditionGroup)[]
    | RuleCondition[]
    | RuleCondition
    | null
    | undefined,
  context: RuleEvaluationContext,
): boolean {
  if (conditionTree === null || conditionTree === undefined) {
    return true;
  }

  // Handle single RuleCondition
  if (
    typeof conditionTree === "object" &&
    "field" in conditionTree &&
    "operator" in conditionTree
  ) {
    return evaluateCondition(conditionTree as RuleCondition, context);
  }

  // Handle RuleConditionGroup
  if (isRuleConditionGroup(conditionTree)) {
    const { logicalOperator, conditions } = conditionTree;
    if (!conditions || conditions.length === 0) {
      return true;
    }

    if (logicalOperator === "OR") {
      for (const cond of conditions) {
        if (evaluateRuleConditions(cond, context)) {
          return true; // Short-circuit OR
        }
      }
      return false;
    }

    // Default AND
    for (const cond of conditions) {
      if (!evaluateRuleConditions(cond, context)) {
        return false; // Short-circuit AND
      }
    }
    return true;
  }

  // Handle array of conditions (evaluated with default AND logic)
  if (Array.isArray(conditionTree)) {
    if (conditionTree.length === 0) {
      return true;
    }
    for (const cond of conditionTree) {
      if (!evaluateRuleConditions(cond, context)) {
        return false; // Short-circuit AND
      }
    }
    return true;
  }

  return true;
}

/**
 * Evaluates whether a rule is currently within its cooldown period.
 * Returns `true` if the rule is in cooldown (not eligible to execute), `false` otherwise.
 */
export function isRuleInCooldown(
  lastExecutedAt: Date | string | null | undefined,
  cooldownSeconds: number,
  now?: Date,
): boolean {
  if (
    !cooldownSeconds ||
    cooldownSeconds <= 0 ||
    lastExecutedAt === null ||
    lastExecutedAt === undefined
  ) {
    return false;
  }

  const lastExecutedTime =
    lastExecutedAt instanceof Date ? lastExecutedAt.getTime() : new Date(lastExecutedAt).getTime();

  if (Number.isNaN(lastExecutedTime)) {
    return false;
  }

  const currentTime = (now ?? new Date()).getTime();
  const diffMs = currentTime - lastExecutedTime;

  if (diffMs < 0) {
    return false; // Defensive against clock skew
  }

  return diffMs < cooldownSeconds * 1000;
}
