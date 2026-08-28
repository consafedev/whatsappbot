import {
  KeyPoolSelector,
  decryptApiKey,
  encryptApiKey,
  maskApiKey,
  type KeyPoolEntry,
} from "@whatsapp-platform/ai-gateway";
import { Prisma, type PrismaClient } from "./generated/prisma/client";

export type AiGatewayDatabase = Pick<
  PrismaClient,
  "aiProviderConfig" | "aiKeyPool" | "aiUsageLog" | "aiVirtualAlias" | "aiModelRoute" | "knowledgeDocument" | "knowledgeChunk" | "tenant" | "$transaction"
>;

export interface CreateAiProviderConfigInput {
  tenantId?: string | null | undefined;
  name: string;
  providerType: "openai_compatible" | "google_gemini" | "mock" | string;
  baseUrl?: string | null | undefined;
  isEnabled?: boolean | undefined;
  isDefault?: boolean | undefined;
  settings?: Record<string, unknown> | undefined;
}

export interface AddKeyToPoolInput {
  providerConfigId: string;
  plainApiKey: string;
  encryptionSecret: string | Uint8Array;
  priority?: number | undefined;
}

export interface UpdateKeyStatusInput {
  keyId: string;
  status: "active" | "rate_limited" | "disabled";
  rateLimitedUntil?: Date | null | undefined;
  incrementCalls?: boolean | undefined;
}

export interface ResolveProviderAndKeyInput {
  tenantId: string;
  providerConfigId?: string | undefined;
  providerType?: string | undefined;
  encryptionSecret: string | Uint8Array;
  now?: Date | undefined;
}

export interface ResolvedProviderAndKey {
  config: {
    id: string;
    tenantId: string | null;
    name: string;
    providerType: string;
    baseUrl: string | null;
    isEnabled: boolean;
    isDefault: boolean;
    settings: unknown;
  };
  selectedKey: {
    id: string;
    keyMask: string;
    priority: number;
    totalCalls: number;
    status: string;
  } | null;
  decryptedApiKey: string | null;
}

export interface RecordAiUsageInput {
  tenantId: string;
  channelAccountId?: string | null | undefined;
  conversationId?: string | null | undefined;
  providerType: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens?: number | undefined;
  costEstimatedUsd?: number | string | Prisma.Decimal | undefined;
  latencyMs?: number | undefined;
  purpose: string;
  status: string;
  errorMessage?: string | null | undefined;
  keyId?: string | undefined;
}

export interface GetTenantAiUsageSummaryInput {
  tenantId: string;
  since?: Date | undefined;
}

export interface TenantAiUsageSummary {
  tenantId: string;
  totalRequests: number;
  successfulRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  averageLatencyMs: number;
}

export async function createAiProviderConfig(
  database: AiGatewayDatabase,
  input: CreateAiProviderConfigInput,
) {
  if (input.isDefault && input.tenantId !== undefined) {
    await database.aiProviderConfig.updateMany({
      where: {
        tenantId: input.tenantId,
        isDefault: true,
      },
      data: { isDefault: false },
    });
  }

  return database.aiProviderConfig.create({
    data: {
      tenantId: input.tenantId ?? null,
      name: input.name,
      providerType: input.providerType,
      baseUrl: input.baseUrl ?? null,
      isEnabled: input.isEnabled ?? true,
      isDefault: input.isDefault ?? false,
      settings: (input.settings ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export async function addKeyToPool(
  database: AiGatewayDatabase,
  input: AddKeyToPoolInput,
) {
  const encryptedKey = encryptApiKey(input.plainApiKey, input.encryptionSecret);
  const keyMask = maskApiKey(input.plainApiKey);

  return database.aiKeyPool.create({
    data: {
      providerConfigId: input.providerConfigId,
      encryptedKey,
      keyMask,
      status: "active",
      priority: input.priority ?? 1,
      totalCalls: 0,
    },
  });
}

export async function updateKeyStatus(
  database: AiGatewayDatabase,
  input: UpdateKeyStatusInput,
) {
  return database.aiKeyPool.update({
    where: { id: input.keyId },
    data: {
      status: input.status,
      rateLimitedUntil: input.rateLimitedUntil ?? null,
      ...(input.incrementCalls ? { totalCalls: { increment: 1 } } : {}),
    },
  });
}

export async function resolveProviderAndKey(
  database: AiGatewayDatabase,
  input: ResolveProviderAndKeyInput,
): Promise<ResolvedProviderAndKey | null> {
  const now = input.now ?? new Date();

  let config:
    | (Prisma.AiProviderConfigGetPayload<{ include: { keyPool: true } }>)
    | null = null;

  if (input.providerConfigId) {
    config = await database.aiProviderConfig.findFirst({
      where: {
        id: input.providerConfigId,
        isEnabled: true,
        OR: [{ tenantId: input.tenantId }, { tenantId: null }],
      },
      include: { keyPool: true },
    });
  } else {
    // 1. Try tenant BYOK first
    config = await database.aiProviderConfig.findFirst({
      where: {
        tenantId: input.tenantId,
        isEnabled: true,
        ...(input.providerType ? { providerType: input.providerType } : {}),
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      include: { keyPool: true },
    });

    // 2. Fallback to platform-global provider
    if (!config) {
      config = await database.aiProviderConfig.findFirst({
        where: {
          tenantId: null,
          isEnabled: true,
          ...(input.providerType ? { providerType: input.providerType } : {}),
        },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
        include: { keyPool: true },
      });
    }
  }

  if (!config) {
    return null;
  }

  if (config.providerType === "mock") {
    return {
      config: {
        id: config.id,
        tenantId: config.tenantId,
        name: config.name,
        providerType: config.providerType,
        baseUrl: config.baseUrl,
        isEnabled: config.isEnabled,
        isDefault: config.isDefault,
        settings: config.settings,
      },
      selectedKey: null,
      decryptedApiKey: "mock-key",
    };
  }

  const poolEntries: KeyPoolEntry[] = config.keyPool.map((k) => ({
    id: k.id,
    providerConfigId: k.providerConfigId,
    encryptedKey: k.encryptedKey,
    keyMask: k.keyMask,
    status: k.status,
    rateLimitedUntil: k.rateLimitedUntil,
    priority: k.priority,
    totalCalls: k.totalCalls,
  }));

  const selected = KeyPoolSelector.selectNextKey(poolEntries, now);
  if (!selected) {
    return {
      config: {
        id: config.id,
        tenantId: config.tenantId,
        name: config.name,
        providerType: config.providerType,
        baseUrl: config.baseUrl,
        isEnabled: config.isEnabled,
        isDefault: config.isDefault,
        settings: config.settings,
      },
      selectedKey: null,
      decryptedApiKey: null,
    };
  }

  const decryptedApiKey = decryptApiKey(selected.encryptedKey, input.encryptionSecret);

  return {
    config: {
      id: config.id,
      tenantId: config.tenantId,
      name: config.name,
      providerType: config.providerType,
      baseUrl: config.baseUrl,
      isEnabled: config.isEnabled,
      isDefault: config.isDefault,
      settings: config.settings,
    },
    selectedKey: {
      id: selected.id,
      keyMask: selected.keyMask,
      priority: selected.priority,
      totalCalls: selected.totalCalls,
      status: selected.status,
    },
    decryptedApiKey,
  };
}

export async function recordAiUsage(
  database: AiGatewayDatabase,
  input: RecordAiUsageInput,
) {
  const totalTokens = input.totalTokens ?? input.promptTokens + input.completionTokens;
  const cost =
    input.costEstimatedUsd !== undefined
      ? new Prisma.Decimal(input.costEstimatedUsd.toString())
      : new Prisma.Decimal(0);

  const [usageLog] = await Promise.all([
    database.aiUsageLog.create({
      data: {
        tenantId: input.tenantId,
        channelAccountId: input.channelAccountId ?? null,
        conversationId: input.conversationId ?? null,
        providerType: input.providerType,
        modelId: input.modelId,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        totalTokens,
        costEstimatedUsd: cost,
        latencyMs: input.latencyMs ?? 0,
        purpose: input.purpose,
        status: input.status,
        errorMessage: input.errorMessage ?? null,
      },
    }),
    ...(input.keyId
      ? [
          database.aiKeyPool.update({
            where: { id: input.keyId },
            data: {
              totalCalls: { increment: 1 },
              ...(input.status === "rate_limited"
                ? {
                    status: "rate_limited",
                    rateLimitedUntil: new Date(Date.now() + 60_000), // 1 min default cooldown
                  }
                : {}),
            },
          }),
        ]
      : []),
  ]);

  return usageLog;
}

export async function getTenantAiUsageSummary(
  database: AiGatewayDatabase,
  input: GetTenantAiUsageSummaryInput,
): Promise<TenantAiUsageSummary> {
  const where: Prisma.AiUsageLogWhereInput = {
    tenantId: input.tenantId,
    ...(input.since ? { createdAt: { gte: input.since } } : {}),
  };

  const logs = await database.aiUsageLog.findMany({
    where,
    select: {
      promptTokens: true,
      completionTokens: true,
      totalTokens: true,
      costEstimatedUsd: true,
      latencyMs: true,
      status: true,
    },
  });

  const totalRequests = logs.length;
  let successfulRequests = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let totalLatency = 0;

  for (const log of logs) {
    if (log.status === "success") {
      successfulRequests += 1;
    }
    totalPromptTokens += log.promptTokens;
    totalCompletionTokens += log.completionTokens;
    totalTokens += log.totalTokens;
    totalCost += Number(log.costEstimatedUsd);
    totalLatency += log.latencyMs;
  }

  const averageLatencyMs = totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0;

  return {
    tenantId: input.tenantId,
    totalRequests,
    successfulRequests,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens,
    totalEstimatedCostUsd: Number(totalCost.toFixed(6)),
    averageLatencyMs,
  };
}
