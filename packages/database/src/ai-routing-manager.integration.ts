import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/prisma/client";
import {
  addKeyToPool,
  createAiProviderConfig,
  createVirtualAlias,
  listTenantAliases,
  resolveRoutesForAlias,
  seedDefaultPlatformAliases,
  updateVirtualAliasRoutes,
  VirtualAliasConflictError,
} from "./index";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";

const prefix = "e10-s02-ai-route";
const secret = "test-encryption-key-32-bytes-long!";
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";
let platformProviderId = "";
let tenantAProviderId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length > 0) {
    await prisma.aiModelRoute.deleteMany({
      where: {
        virtualAlias: {
          tenantId: { in: ids },
        },
      },
    });
    await prisma.aiVirtualAlias.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.aiKeyPool.deleteMany({
      where: { providerConfig: { tenantId: { in: ids } } },
    });
    await prisma.aiProviderConfig.deleteMany({
      where: { tenantId: { in: ids } },
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

  // Cleanup test platform aliases
  await prisma.aiModelRoute.deleteMany({
    where: {
      virtualAlias: {
        tenantId: null,
        aliasKey: { startsWith: "test-platform" },
      },
    },
  });
  await prisma.aiVirtualAlias.deleteMany({
    where: {
      tenantId: null,
      aliasKey: { startsWith: "test-platform" },
    },
  });
}

async function provision(marker: string): Promise<string> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "USD",
    defaultLocale: "en-US",
    defaultTimezone: "UTC",
    deploymentId: null,
    displayName: `AI Route Tenant ${marker}`,
    enabledModules: ["module.messaging.basic", "module.ai"],
    legalName: `AI Route Tenant ${marker} SA`,
    limits: {
      channelAccounts: 5,
      monthlyAiBudget: null,
      organizationUnits: 5,
      storageBytes: 1_073_741_824,
      users: 5,
    },
    owner: {
      displayName: `Admin ${marker}`,
      email: `admin-${marker}@ai-route-test.local`,
      locale: "en-US",
      passwordHash: "hash123",
      timezone: "UTC",
    },
    requestId: `${prefix}-${marker}`,
    slug: `${prefix}-${marker}`,
  });
  return result.tenant.id;
}

describe.sequential("AI Gateway Routing & Virtual Aliases Database Manager", () => {
  beforeAll(async () => {
    const config = loadDatabaseConfig();
    prisma = createPlatformDatabaseClient(config);
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);

    tenantAId = await provision("a");
    tenantBId = await provision("b");

    // Create a platform global provider config
    const platformConfig = await createAiProviderConfig(prisma, {
      tenantId: null,
      name: "Platform OpenAI Fallback",
      providerType: "openai_compatible",
      baseUrl: "https://api.openai.com/v1",
      isEnabled: true,
    });
    platformProviderId = platformConfig.id;

    await addKeyToPool(prisma, {
      providerConfigId: platformProviderId,
      plainApiKey: "sk-platform-global-key-12345",
      encryptionSecret: secret,
      priority: 1,
    });

    // Create a tenant A BYOK provider config
    const tenantAConfig = await createAiProviderConfig(prisma, {
      tenantId: tenantAId,
      name: "Tenant A BYOK OpenAI",
      providerType: "openai_compatible",
      baseUrl: "https://custom-openai.tenant-a.com/v1",
      isEnabled: true,
    });
    tenantAProviderId = tenantAConfig.id;

    await addKeyToPool(prisma, {
      providerConfigId: tenantAProviderId,
      plainApiKey: "sk-tenant-a-custom-key-99999",
      encryptionSecret: secret,
      priority: 1,
    });
  });

  afterAll(async () => {
    await prisma.aiModelRoute.deleteMany({
      where: { virtualAlias: { tenantId: null } },
    });
    await prisma.aiVirtualAlias.deleteMany({
      where: { tenantId: null },
    });
    await cleanup();
    if (platformProviderId) {
      await prisma.aiKeyPool.deleteMany({ where: { providerConfigId: platformProviderId } });
      await prisma.aiProviderConfig.deleteMany({ where: { id: platformProviderId } });
    }
    await prisma.$disconnect();
  });

  it("seeds and creates platform-global virtual aliases", async () => {
    await seedDefaultPlatformAliases(prisma, platformProviderId);

    const fastAlias = await resolveRoutesForAlias(prisma, {
      tenantId: null,
      aliasKey: "platform-fast",
      encryptionSecret: secret,
    });

    expect(fastAlias).not.toBeNull();
    expect(fastAlias?.aliasKey).toBe("platform-fast");
    expect(fastAlias?.isOverride).toBe(false);
    expect(fastAlias?.routes).toHaveLength(1);
    expect(fastAlias?.routes[0]?.providerConfigId).toBe(platformProviderId);
    expect(fastAlias?.routes[0]?.keys[0]?.rawApiKey).toBe("sk-platform-global-key-12345");
  });

  it("resolves platform-global alias for Tenant B when no override exists", async () => {
    const resolved = await resolveRoutesForAlias(prisma, {
      tenantId: tenantBId,
      aliasKey: "platform-fast",
      encryptionSecret: secret,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.isOverride).toBe(false);
    expect(resolved?.tenantId).toBeNull();
    expect(resolved?.routes[0]?.keys[0]?.rawApiKey).toBe("sk-platform-global-key-12345");
  });

  it("allows Tenant A to override platform-fast with tenant custom BYOK routes", async () => {
    const override = await createVirtualAlias(prisma, {
      tenantId: tenantAId,
      aliasKey: "platform-fast",
      name: "Tenant A Custom Fast Model",
      description: "Custom route using Tenant A BYOK provider",
      routes: [
        {
          providerConfigId: tenantAProviderId,
          targetModelId: "gpt-4o-mini-custom",
          priority: 1,
          timeoutMs: 8000,
          maxRetries: 2,
          isEnabled: true,
        },
        {
          providerConfigId: platformProviderId,
          targetModelId: "gpt-4o-mini",
          priority: 2, // fallback to platform
          timeoutMs: 10000,
          maxRetries: 1,
          isEnabled: true,
        },
      ],
    });

    expect(override.aliasKey).toBe("platform-fast");
    expect(override.tenantId).toBe(tenantAId);

    // Resolving for Tenant A returns the tenant override
    const resolvedA = await resolveRoutesForAlias(prisma, {
      tenantId: tenantAId,
      aliasKey: "platform-fast",
      encryptionSecret: secret,
    });

    expect(resolvedA).not.toBeNull();
    expect(resolvedA?.isOverride).toBe(true);
    expect(resolvedA?.tenantId).toBe(tenantAId);
    expect(resolvedA?.routes).toHaveLength(2);
    expect(resolvedA?.routes[0]?.priority).toBe(1);
    expect(resolvedA?.routes[0]?.targetModelId).toBe("gpt-4o-mini-custom");
    expect(resolvedA?.routes[0]?.keys[0]?.rawApiKey).toBe("sk-tenant-a-custom-key-99999");
    expect(resolvedA?.routes[1]?.priority).toBe(2);
    expect(resolvedA?.routes[1]?.keys[0]?.rawApiKey).toBe("sk-platform-global-key-12345");

    // Resolving for Tenant B STILL returns the platform global route (A/B strict isolation)
    const resolvedB = await resolveRoutesForAlias(prisma, {
      tenantId: tenantBId,
      aliasKey: "platform-fast",
      encryptionSecret: secret,
    });

    expect(resolvedB).not.toBeNull();
    expect(resolvedB?.isOverride).toBe(false);
    expect(resolvedB?.routes).toHaveLength(1);
    expect(resolvedB?.routes[0]?.keys[0]?.rawApiKey).toBe("sk-platform-global-key-12345");
  });

  it("updates routes and lists aliases for tenant", async () => {
    const list = await listTenantAliases(prisma, tenantAId);
    expect(list.length).toBeGreaterThanOrEqual(3);

    const fastItem = list.find((a) => a.aliasKey === "platform-fast" && a.isOverride);
    expect(fastItem).toBeDefined();
    if (!fastItem) return;

    await updateVirtualAliasRoutes(prisma, {
      aliasId: fastItem.id,
      tenantId: tenantAId,
      routes: [
        {
          providerConfigId: tenantAProviderId,
          targetModelId: "gpt-4o-mini-v2",
          priority: 1,
          timeoutMs: 5000,
        },
      ],
    });

    const updated = await resolveRoutesForAlias(prisma, {
      tenantId: tenantAId,
      aliasKey: "platform-fast",
      encryptionSecret: secret,
    });

    expect(updated?.routes).toHaveLength(1);
    expect(updated?.routes[0]?.targetModelId).toBe("gpt-4o-mini-v2");
  });

  it("prevents duplicate alias creation for the same tenant and key", async () => {
    await expect(
      createVirtualAlias(prisma, {
        tenantId: tenantAId,
        aliasKey: "platform-fast",
        name: "Duplicate",
      }),
    ).rejects.toThrow(VirtualAliasConflictError);
  });
});
