import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ChannelAccountManager, createChannelAccountManager } from "./channel-account-manager";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e05-s01-channel-db";
const metadata = { actorUserId: "e05-s01-actor", requestId: `${prefix}-request` };
let prisma: PrismaClient;
let manager: ChannelAccountManager;
let tenantAId = "";
let tenantBId = "";
let rootAId = "";
let rootBId = "";
let channelAId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.channelAccount.deleteMany({ where: { tenantId: { in: ids } } });
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

async function provision(marker: string): Promise<{ id: string; rootId: string }> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Channels ${marker}`,
    enabledModules: ["module.messaging.basic"],
    legalName: `Channels ${marker} SA`,
    limits: {
      channelAccounts: 2,
      monthlyAiBudget: null,
      organizationUnits: 3,
      storageBytes: 1_073_741_824,
      users: 5,
    },
    owner: {
      displayName: `Owner ${marker}`,
      email: `${prefix}-owner-${marker}@example.invalid`,
      locale: "es-MX",
      passwordHash: "$argon2id$test-hash-not-reversible",
      timezone: "America/Mexico_City",
    },
    requestId: `${prefix}-${marker}`,
    slug: `${prefix}-${marker}`,
  });
  return { id: result.tenant.id, rootId: result.organizationRoot.id };
}

describe.sequential("Channel account manager", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    const [tenantA, tenantB] = await Promise.all([provision("a"), provision("b")]);
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    rootAId = tenantA.rootId;
    rootBId = tenantB.rootId;
    manager = createChannelAccountManager(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("creates tenant-scoped channels without exposing credentials and emits Audit/Outbox", async () => {
    const created = await manager.create(
      createTenantContext(tenantAId),
      {
        credentialsCiphertext: "v1.ciphertext",
        displayName: "Línea Ventas",
        organizationUnitId: rootAId,
        phoneNumber: "+5215512345678",
        providerType: "mock",
        settings: { autoReply: false },
      },
      metadata,
    );
    channelAId = created.id;
    expect(created).toMatchObject({
      displayName: "Línea Ventas",
      isActive: true,
      organizationUnitId: rootAId,
      phoneNumber: "+5215512345678",
      providerType: "mock",
    });
    expect(created.credentialsConfigured).toBe(true);
    expect(JSON.stringify(created)).not.toContain("ciphertext");
    const [audit, event] = await Promise.all([
      prisma.auditLog.findFirstOrThrow({
        where: { action: "channel.created", entityId: channelAId },
      }),
      prisma.domainEventOutbox.findFirstOrThrow({
        where: { eventType: "channel.created", aggregateId: channelAId },
      }),
    ]);
    expect(JSON.stringify(audit.afterSummary)).not.toContain("ciphertext");
    expect(JSON.stringify(event.payload)).not.toContain("ciphertext");
  });

  it("rejects duplicate active phones, enforces the exact limit, and frees a slot on archive", async () => {
    await expect(
      manager.create(
        createTenantContext(tenantAId),
        { displayName: "Duplicado", phoneNumber: "+5215512345678", providerType: "mock" },
        metadata,
      ),
    ).rejects.toThrow("active channel already uses");
    await manager.create(
      createTenantContext(tenantAId),
      { displayName: "Línea Soporte", phoneNumber: "+5215512345679", providerType: "mock" },
      metadata,
    );
    await expect(
      manager.create(
        createTenantContext(tenantAId),
        { displayName: "Línea Extra", phoneNumber: "+5215512345680", providerType: "mock" },
        metadata,
      ),
    ).rejects.toThrow("channel account limit reached");
    const archived = await manager.archive(createTenantContext(tenantAId), channelAId, metadata);
    expect(archived).toMatchObject({ isActive: false, status: "archived" });
    const reused = await manager.create(
      createTenantContext(tenantAId),
      { displayName: "Línea Reutilizada", phoneNumber: "+5215512345678", providerType: "mock" },
      metadata,
    );
    expect(reused.isActive).toBe(true);
  });

  it("fails closed for cross-tenant reads and writes, including organization units", async () => {
    expect(await manager.findById(createTenantContext(tenantBId), channelAId)).toBeNull();
    await expect(
      manager.update(
        createTenantContext(tenantBId),
        channelAId,
        { displayName: "Escape" },
        metadata,
      ),
    ).rejects.toThrow("Channel account was not found");
    await expect(
      manager.create(
        createTenantContext(tenantBId),
        {
          displayName: "Cross OU",
          organizationUnitId: rootAId,
          phoneNumber: "+5215512345681",
          providerType: "mock",
        },
        metadata,
      ),
    ).rejects.toThrow("Organization unit was not found");
    expect(rootBId).not.toBe(rootAId);
  });

  it("rolls back the channel and audit when the outbox append fails", async () => {
    const failingDatabase = {
      channelAccount: prisma.channelAccount,
      organizationUnit: prisma.organizationUnit,
      tenantEntitlement: prisma.tenantEntitlement,
      $transaction: ((callback: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
        prisma.$transaction((transaction) =>
          callback(
            new Proxy(transaction, {
              get(target, property, receiver) {
                if (property === "domainEventOutbox") {
                  return { create: async () => Promise.reject(new Error("forced outbox failure")) };
                }
                return Reflect.get(target, property, receiver);
              },
            }),
          ),
        )) as typeof prisma.$transaction,
    };
    const failingManager = createChannelAccountManager(failingDatabase);
    await expect(
      failingManager.create(
        createTenantContext(tenantBId),
        { displayName: "Rollback", phoneNumber: "+5215512345682", providerType: "mock" },
        metadata,
      ),
    ).rejects.toThrow("forced outbox failure");
    expect(
      await prisma.channelAccount.findFirst({
        where: { displayName: "Rollback", tenantId: tenantBId },
      }),
    ).toBeNull();
    expect(
      await prisma.auditLog.count({ where: { action: "channel.created", tenantId: tenantBId } }),
    ).toBe(0);
  });
});
