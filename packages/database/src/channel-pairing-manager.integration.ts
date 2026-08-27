import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ChannelAccountNotFoundError,
  ChannelAlreadyConnectedError,
  type ChannelPairingManager,
  createChannelPairingManager,
} from "./index";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e09-s01-pairing-db";
let prisma: PrismaClient;
let pairingManager: ChannelPairingManager;

let tenantAId = "";
let tenantBId = "";
let ownerAId = "";
let ownerBId = "";
let channelAId = "";
let channelBId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length === 0) return;
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

async function provision(marker: string): Promise<{ ownerId: string; tenantId: string }> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Pairing ${marker}`,
    enabledModules: ["module.messaging.basic"],
    legalName: `Pairing ${marker} SA`,
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
  return { ownerId: result.owner.id, tenantId: result.tenant.id };
}

describe.sequential("E09-S01 channel pairing manager integration", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);

    pairingManager = createChannelPairingManager(prisma);

    const [tenantA, tenantB] = await Promise.all([provision("a"), provision("b")]);
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;
    ownerAId = tenantA.ownerId;
    ownerBId = tenantB.ownerId;

    const [channelA, channelB] = await Promise.all([
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "WhatsApp Línea A",
          providerType: "baileys",
          status: "DISCONNECTED",
          tenantId: tenantAId,
        },
      }),
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "WhatsApp Línea B",
          providerType: "baileys",
          status: "DISCONNECTED",
          tenantId: tenantBId,
        },
      }),
    ]);
    channelAId = channelA.id;
    channelBId = channelB.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("executes full lifecycle: DISCONNECTED -> CONNECTING -> QR_READY -> CONNECTED", async () => {
    const tenantA = createTenantContext(tenantAId);

    // 1. DISCONNECTED -> CONNECTING (initiateChannelPairing)
    const connecting = await pairingManager.initiateChannelPairing(
      tenantA,
      channelAId,
      ownerAId,
      "req-initiate-01",
    );
    expect(connecting.status).toBe("CONNECTING");

    const auditInitiate = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "channel.pairing_initiated",
        entityId: channelAId,
        tenantId: tenantAId,
      },
      orderBy: { occurredAt: "desc" },
    });
    expect(auditInitiate.actorId).toBe(ownerAId);
    expect((auditInitiate.afterSummary as Record<string, unknown>).status).toBe("CONNECTING");

    const outboxInitiate = await prisma.domainEventOutbox.findFirstOrThrow({
      where: {
        aggregateId: channelAId,
        eventType: "channel.pairing_requested",
        tenantId: tenantAId,
      },
      orderBy: { occurredAt: "desc" },
    });
    expect(outboxInitiate.payload).toMatchObject({
      actorId: ownerAId,
      channelAccountId: channelAId,
      tenantId: tenantAId,
    });

    // 2. CONNECTING -> QR_READY (updateChannelQrCode)
    const rawQr1 = "2@1234567890abcdef,mock-public-key,mock-secret";
    const qrReady = await pairingManager.updateChannelQrCode(tenantA, channelAId, rawQr1);
    expect(qrReady.status).toBe("QR_READY");
    const settingsQr = qrReady.settings as Record<string, unknown>;
    expect(settingsQr.latestQrRaw).toBe(rawQr1);
    expect(settingsQr.qrGeneratedAt).toBeDefined();

    const outboxQr = await prisma.domainEventOutbox.findFirstOrThrow({
      where: {
        aggregateId: channelAId,
        eventType: "channel.qr_generated",
        tenantId: tenantAId,
      },
      orderBy: { occurredAt: "desc" },
    });
    expect(outboxQr.payload).toMatchObject({
      channelAccountId: channelAId,
      qrRaw: rawQr1,
      tenantId: tenantAId,
    });

    // 3. QR_READY -> CONNECTED (confirmChannelConnected)
    const connected = await pairingManager.confirmChannelConnected(tenantA, channelAId, {
      encryptedCredentials: "mock-encrypted-auth-state",
      phoneNumber: "+5215512345678",
      platform: "baileys",
    });
    expect(connected.status).toBe("CONNECTED");
    expect(connected.phoneNumber).toBe("+5215512345678");
    expect(connected.lastConnectedAt).not.toBeNull();
    const settingsConnected = connected.settings as Record<string, unknown>;
    expect(settingsConnected.latestQrRaw).toBeNull();
    expect(settingsConnected.connectedAt).toBeDefined();

    const auditConnected = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "channel.connected",
        entityId: channelAId,
        tenantId: tenantAId,
      },
      orderBy: { occurredAt: "desc" },
    });
    expect(auditConnected.actorType).toBe("system");
    expect((auditConnected.afterSummary as Record<string, unknown>).phoneNumber).toBe(
      "+5215512345678",
    );

    const outboxConnected = await prisma.domainEventOutbox.findFirstOrThrow({
      where: {
        aggregateId: channelAId,
        eventType: "channel.connected",
        tenantId: tenantAId,
      },
      orderBy: { occurredAt: "desc" },
    });
    expect(outboxConnected.payload).toMatchObject({
      channelAccountId: channelAId,
      phoneNumber: "+5215512345678",
      tenantId: tenantAId,
    });

    // 4. Re-initiating pairing when already connected throws ChannelAlreadyConnectedError
    await expect(
      pairingManager.initiateChannelPairing(tenantA, channelAId, ownerAId),
    ).rejects.toThrow(ChannelAlreadyConnectedError);
  });

  it("handles QR rotation and updates latest QR payload", async () => {
    const tenantA = createTenantContext(tenantAId);

    const qrRotation1 = "2@rotation-frame-1";
    const qrRotation2 = "2@rotation-frame-2";

    await pairingManager.updateChannelQrCode(tenantA, channelAId, qrRotation1);
    const updated1 = await prisma.channelAccount.findUniqueOrThrow({ where: { id: channelAId } });
    expect((updated1.settings as Record<string, unknown>).latestQrRaw).toBe(qrRotation1);

    await pairingManager.updateChannelQrCode(tenantA, channelAId, qrRotation2);
    const updated2 = await prisma.channelAccount.findUniqueOrThrow({ where: { id: channelAId } });
    expect((updated2.settings as Record<string, unknown>).latestQrRaw).toBe(qrRotation2);
  });

  it("disconnects channel manually and clears QR code", async () => {
    const tenantA = createTenantContext(tenantAId);

    const disconnected = await pairingManager.disconnectChannel(
      tenantA,
      channelAId,
      ownerAId,
      "user_requested_logout",
      "req-disc-01",
    );

    expect(disconnected.status).toBe("DISCONNECTED");
    expect(disconnected.lastDisconnectedAt).not.toBeNull();
    const settings = disconnected.settings as Record<string, unknown>;
    expect(settings.latestQrRaw).toBeNull();
    expect(settings.disconnectedAt).toBeDefined();
    expect(settings.disconnectReason).toBe("user_requested_logout");

    const auditDisconnected = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "channel.disconnected",
        entityId: channelAId,
        tenantId: tenantAId,
      },
      orderBy: { occurredAt: "desc" },
    });
    expect(auditDisconnected.actorId).toBe(ownerAId);
    expect((auditDisconnected.afterSummary as Record<string, unknown>).reason).toBe(
      "user_requested_logout",
    );

    const outboxDisconnected = await prisma.domainEventOutbox.findFirstOrThrow({
      where: {
        aggregateId: channelAId,
        eventType: "channel.disconnected",
        tenantId: tenantAId,
      },
      orderBy: { occurredAt: "desc" },
    });
    expect(outboxDisconnected.payload).toMatchObject({
      actorId: ownerAId,
      channelAccountId: channelAId,
      reason: "user_requested_logout",
      tenantId: tenantAId,
    });
  });

  it("enforces strict multi-tenant A/B isolation: Tenant B cannot access or mutate Tenant A's channels", async () => {
    const tenantB = createTenantContext(tenantBId);

    // Tenant B cannot initiate pairing on Tenant A's channel
    await expect(
      pairingManager.initiateChannelPairing(tenantB, channelAId, ownerBId),
    ).rejects.toThrow(ChannelAccountNotFoundError);

    // Tenant B cannot update QR on Tenant A's channel
    await expect(
      pairingManager.updateChannelQrCode(tenantB, channelAId, "2@cross-tenant-qr"),
    ).rejects.toThrow(ChannelAccountNotFoundError);

    // Tenant B cannot confirm connection on Tenant A's channel
    await expect(
      pairingManager.confirmChannelConnected(tenantB, channelAId, {
        phoneNumber: "+5215599999999",
      }),
    ).rejects.toThrow(ChannelAccountNotFoundError);

    // Tenant B cannot disconnect Tenant A's channel
    await expect(pairingManager.disconnectChannel(tenantB, channelAId, ownerBId)).rejects.toThrow(
      ChannelAccountNotFoundError,
    );
  });

  it("rolls back database mutations and audit logs if outbox write fails", async () => {
    const failingDatabase = {
      ...prisma,
      channelAccount: prisma.channelAccount,
      tenant: prisma.tenant,
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

    const failingManager = createChannelPairingManager(failingDatabase);
    const tenantB = createTenantContext(tenantBId);

    await expect(
      failingManager.initiateChannelPairing(tenantB, channelBId, ownerBId),
    ).rejects.toThrow("forced outbox failure");

    const channelBState = await prisma.channelAccount.findUniqueOrThrow({
      where: { id: channelBId },
    });
    expect(channelBState.status).toBe("DISCONNECTED");

    const auditCount = await prisma.auditLog.count({
      where: {
        action: "channel.pairing_initiated",
        entityId: channelBId,
        tenantId: tenantBId,
      },
    });
    expect(auditCount).toBe(0);
  });
});
