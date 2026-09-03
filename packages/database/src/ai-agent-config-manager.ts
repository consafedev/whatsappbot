import type { Prisma, PrismaClient } from "./generated/prisma/client";

export type AiAgentConfigDatabase = Pick<
  PrismaClient,
  "tenantAiAgentConfig" | "tenant" | "$transaction"
>;

export const AI_AGENT_AUTOMATION_MODES = ["RULES_ONLY", "HYBRID_RULES_AI", "FULL_AI"] as const;

export type AiAgentAutomationMode = (typeof AI_AGENT_AUTOMATION_MODES)[number];

export const DEFAULT_HUMAN_HANDOFF_KEYWORDS: readonly string[] = [
  "humano",
  "asesor",
  "persona",
  "agente",
  "ayuda",
];

export interface TenantAiAgentConfigData {
  readonly id: string;
  readonly tenantId: string;
  readonly automationMode: AiAgentAutomationMode;
  readonly systemDirectives: string | null;
  readonly virtualAliasKey: string;
  readonly minConfidenceScore: number;
  readonly humanHandoffKeywords: string[];
  readonly outOfHoursReply: string | null;
  readonly isEnabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UpsertTenantAiAgentConfigInput {
  readonly tenantId: string;
  readonly automationMode?: AiAgentAutomationMode | undefined;
  readonly systemDirectives?: string | null | undefined;
  readonly virtualAliasKey?: string | undefined;
  readonly minConfidenceScore?: number | undefined;
  readonly humanHandoffKeywords?: string[] | undefined;
  readonly outOfHoursReply?: string | null | undefined;
  readonly isEnabled?: boolean | undefined;
}

function parseKeywords(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map(String).filter((s) => s.trim().length > 0);
  }
  return [...DEFAULT_HUMAN_HANDOFF_KEYWORDS];
}

/**
 * Retrieves the AI agent configuration for a tenant.
 * Returns default values if no record exists yet.
 */
export async function getTenantAiAgentConfig(
  db: AiAgentConfigDatabase,
  tenantId: string,
): Promise<TenantAiAgentConfigData> {
  const existing = await db.tenantAiAgentConfig.findUnique({
    where: { tenantId },
  });

  if (!existing) {
    return {
      id: "",
      tenantId,
      automationMode: "HYBRID_RULES_AI",
      systemDirectives: null,
      virtualAliasKey: "platform-smart",
      minConfidenceScore: 0.7,
      humanHandoffKeywords: [...DEFAULT_HUMAN_HANDOFF_KEYWORDS],
      outOfHoursReply: null,
      isEnabled: false,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
  }

  return {
    id: existing.id,
    tenantId: existing.tenantId,
    automationMode: existing.automationMode as AiAgentAutomationMode,
    systemDirectives: existing.systemDirectives,
    virtualAliasKey: existing.virtualAliasKey,
    minConfidenceScore: Number(existing.minConfidenceScore),
    humanHandoffKeywords: parseKeywords(existing.humanHandoffKeywords),
    outOfHoursReply: existing.outOfHoursReply,
    isEnabled: existing.isEnabled,
    createdAt: existing.createdAt,
    updatedAt: existing.updatedAt,
  };
}

/**
 * Creates or updates the AI agent configuration for a tenant.
 */
export async function upsertTenantAiAgentConfig(
  db: AiAgentConfigDatabase,
  input: UpsertTenantAiAgentConfigInput,
): Promise<TenantAiAgentConfigData> {
  const keywords = input.humanHandoffKeywords
    ? input.humanHandoffKeywords.map((k) => k.trim().toLowerCase()).filter(Boolean)
    : undefined;

  const upserted = await db.tenantAiAgentConfig.upsert({
    where: { tenantId: input.tenantId },
    create: {
      tenantId: input.tenantId,
      automationMode: input.automationMode ?? "HYBRID_RULES_AI",
      systemDirectives: input.systemDirectives ?? null,
      virtualAliasKey: input.virtualAliasKey ?? "platform-smart",
      minConfidenceScore: input.minConfidenceScore ?? 0.7,
      humanHandoffKeywords: (keywords ?? [
        ...DEFAULT_HUMAN_HANDOFF_KEYWORDS,
      ]) as unknown as Prisma.InputJsonValue,
      outOfHoursReply: input.outOfHoursReply ?? null,
      isEnabled: input.isEnabled ?? false,
    },
    update: {
      ...(input.automationMode !== undefined ? { automationMode: input.automationMode } : {}),
      ...(input.systemDirectives !== undefined ? { systemDirectives: input.systemDirectives } : {}),
      ...(input.virtualAliasKey !== undefined ? { virtualAliasKey: input.virtualAliasKey } : {}),
      ...(input.minConfidenceScore !== undefined
        ? { minConfidenceScore: input.minConfidenceScore }
        : {}),
      ...(keywords !== undefined
        ? { humanHandoffKeywords: keywords as unknown as Prisma.InputJsonValue }
        : {}),
      ...(input.outOfHoursReply !== undefined ? { outOfHoursReply: input.outOfHoursReply } : {}),
      ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
      updatedAt: new Date(),
    },
  });

  return {
    id: upserted.id,
    tenantId: upserted.tenantId,
    automationMode: upserted.automationMode as AiAgentAutomationMode,
    systemDirectives: upserted.systemDirectives,
    virtualAliasKey: upserted.virtualAliasKey,
    minConfidenceScore: Number(upserted.minConfidenceScore),
    humanHandoffKeywords: parseKeywords(upserted.humanHandoffKeywords),
    outOfHoursReply: upserted.outOfHoursReply,
    isEnabled: upserted.isEnabled,
    createdAt: upserted.createdAt,
    updatedAt: upserted.updatedAt,
  };
}
