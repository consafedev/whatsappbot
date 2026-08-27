import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addKeyToPool,
  createAiProviderConfig,
  getTenantAiUsageSummary,
  recordAiUsage,
  resolveProviderAndKey,
  updateKeyStatus,
} from "./ai-gateway-manager";
import type { PrismaClient } from "./generated/prisma/client";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";

const prefix = "e10-s01-ai-db";
const secret = "test-encryption-key-32-bytes-long!";
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.aiUsageLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.aiProviderConfig.deleteMany({ where: { tenantId: { in: ids } } });
  // Clean platform test configs
  await prisma.aiProviderConfig.deleteMany({
    where: { tenantId: null, name: { startsWith: prefix } },
  });
  await prisma.userSession.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userPasswordResetToken.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userRole.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: ids } } } });
  await prisma.role.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

async function provision(marker: string): Promise<string> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "USD",
    defaultLocale: "en-US",
    defaultTimezone: "UTC",
    deploymentId: null,
    displayName: `AI Tenant ${marker}`,
    enabledModules: ["module.messaging.basic", "module.ai"],
    legalName: `AI Tenant Legal ${marker}`,
    limits: {
      channelAccounts: 5,
      monthlyAiBudget: null,
      organizationUnits: 5,
      storageBytes: 1_073_741_824,
      users: 5,
    },
    owner: {
      displayName: `Admin ${marker}`,
      email: `admin-${marker}@ai-test.local`,
      locale: "en-US",
      passwordHash: "hash123",
      timezone: "UTC",
    },
    requestId: `${prefix}-${marker}`,
    slug: `${prefix}-${marker}`,
  });
  return result.tenant.id;
}

beforeAll(async () => {
  const config = loadDatabaseConfig();
  prisma = createPlatformDatabaseClient(config);
  await prisma.$connect();
  await cleanup();
  await syncPermissionCatalog(prisma);
  tenantAId = await provision("a");
  tenantBId = await provision("b");
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("ai-gateway-manager (PostgreSQL Integration)", () => {
  it("creates platform-global and tenant BYOK provider configurations", async () => {
    // 1. Platform-global provider
    const globalConfig = await createAiProviderConfig(prisma, {
      name: `${prefix}-global-openai`,
      providerType: "openai_compatible",
      baseUrl: "https://api.openai.com/v1",
      isDefault: true,
      isEnabled: true,
    });
    expect(globalConfig.id).toBeDefined();
    expect(globalConfig.tenantId).toBeNull();

    // 2. Tenant A BYOK provider
    const tenantAConfig = await createAiProviderConfig(prisma, {
      tenantId: tenantAId,
      name: "Tenant A DeepSeek Local",
      providerType: "openai_compatible",
      baseUrl: "http://localhost:11434/v1",
      isDefault: true,
      isEnabled: true,
    });
    expect(tenantAConfig.id).toBeDefined();
    expect(tenantAConfig.tenantId).toBe(tenantAId);

    // 3. Add encrypted keys to pool
    const keyA = await addKeyToPool(prisma, {
      providerConfigId: tenantAConfig.id,
      plainApiKey: "sk-tenant-a-secret-key-1234",
      encryptionSecret: secret,
      priority: 2,
    });
    expect(keyA.keyMask).toBe("sk-...1234");
    expect(keyA.encryptedKey).toMatch(/^v1\./);
    expect(keyA.status).toBe("active");

    const keyGlobal = await addKeyToPool(prisma, {
      providerConfigId: globalConfig.id,
      plainApiKey: "sk-platform-global-key-9999",
      encryptionSecret: secret,
      priority: 1,
    });
    expect(keyGlobal.keyMask).toBe("sk-...9999");
  });

  it("resolves tenant BYOK provider for Tenant A and platform provider for Tenant B", async () => {
    // Tenant A resolution -> gets Tenant A's BYOK provider and decrypted key
    const resolvedA = await resolveProviderAndKey(prisma, {
      tenantId: tenantAId,
      encryptionSecret: secret,
    });
    expect(resolvedA).not.toBeNull();
    expect(resolvedA?.config.tenantId).toBe(tenantAId);
    expect(resolvedA?.decryptedApiKey).toBe("sk-tenant-a-secret-key-1234");
    expect(resolvedA?.selectedKey?.keyMask).toBe("sk-...1234");

    // Tenant B resolution (has no BYOK) -> falls back to platform global provider
    const resolvedB = await resolveProviderAndKey(prisma, {
      tenantId: tenantBId,
      encryptionSecret: secret,
    });
    expect(resolvedB).not.toBeNull();
    expect(resolvedB?.config.tenantId).toBeNull();
    expect(resolvedB?.decryptedApiKey).toBe("sk-platform-global-key-9999");
    expect(resolvedB?.selectedKey?.keyMask).toBe("sk-...9999");
  });

  it("records AI usage and strictly isolates consumption between tenants", async () => {
    // Record usage for Tenant A
    await recordAiUsage(prisma, {
      tenantId: tenantAId,
      providerType: "openai_compatible",
      modelId: "deepseek-chat",
      promptTokens: 100,
      completionTokens: 200,
      costEstimatedUsd: 0.00045,
      latencyMs: 350,
      purpose: "smart_reply",
      status: "success",
    });

    await recordAiUsage(prisma, {
      tenantId: tenantAId,
      providerType: "openai_compatible",
      modelId: "deepseek-chat",
      promptTokens: 50,
      completionTokens: 50,
      costEstimatedUsd: 0.00015,
      latencyMs: 150,
      purpose: "triage",
      status: "success",
    });

    // Record usage for Tenant B
    await recordAiUsage(prisma, {
      tenantId: tenantBId,
      providerType: "openai_compatible",
      modelId: "gpt-4o",
      promptTokens: 500,
      completionTokens: 500,
      costEstimatedUsd: 0.005,
      latencyMs: 800,
      purpose: "autonomous_agent",
      status: "success",
    });

    // Summary for Tenant A
    const summaryA = await getTenantAiUsageSummary(prisma, { tenantId: tenantAId });
    expect(summaryA.totalRequests).toBe(2);
    expect(summaryA.successfulRequests).toBe(2);
    expect(summaryA.totalPromptTokens).toBe(150);
    expect(summaryA.totalCompletionTokens).toBe(250);
    expect(summaryA.totalTokens).toBe(400);
    expect(summaryA.totalEstimatedCostUsd).toBe(0.0006);
    expect(summaryA.averageLatencyMs).toBe(250); // (350+150)/2

    // Summary for Tenant B
    const summaryB = await getTenantAiUsageSummary(prisma, { tenantId: tenantBId });
    expect(summaryB.totalRequests).toBe(1);
    expect(summaryB.totalTokens).toBe(1000);
    expect(summaryB.totalEstimatedCostUsd).toBe(0.005);
  });

  it("updates key status and respects rate limiting cooldown", async () => {
    const config = await createAiProviderConfig(prisma, {
      tenantId: tenantAId,
      name: "Tenant A Rate Limited Provider",
      providerType: "openai_compatible",
      isEnabled: true,
    });

    const key = await addKeyToPool(prisma, {
      providerConfigId: config.id,
      plainApiKey: "sk-rate-limited-test-key-5555",
      encryptionSecret: secret,
      priority: 1,
    });

    // Mark key as rate limited for 10 minutes
    const future = new Date(Date.now() + 600_000);
    await updateKeyStatus(prisma, {
      keyId: key.id,
      status: "rate_limited",
      rateLimitedUntil: future,
    });

    const resolved = await resolveProviderAndKey(prisma, {
      tenantId: tenantAId,
      providerConfigId: config.id,
      encryptionSecret: secret,
      now: new Date(),
    });

    expect(resolved?.selectedKey).toBeNull();
    expect(resolved?.decryptedApiKey).toBeNull();
  });
});
