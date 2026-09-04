import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CampaignAudienceMemberNotFoundError,
  reconcileCampaignAudienceDeliveryStatus,
  reconcileCampaignDeliveryFromOutboundMessage,
} from "./campaign-delivery-reconciler";
import { dispatchCampaignBatch } from "./campaign-execution-dispatcher";
import {
  CampaignNotFoundError,
  createCampaign,
  getCampaignDetail,
  getCampaignMetrics,
  listCampaignAudienceMembers,
  segmentAndPopulateAudience,
  startCampaign,
} from "./campaign-manager";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  type PrismaClient,
  syncPermissionCatalog,
} from "./platform";

const prefix = "e11-s03-reconcile";
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";
let channelAccountAId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length > 0) {
    await prisma.outboundMessage.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.campaignAudienceMember.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.campaign.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.messageTemplate.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.contact.deleteMany({ where: { tenantId: { in: ids } } });
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
}

async function provisionTenant(marker: string): Promise<{ tenantId: string; ownerId: string }> {
  const repo = createPlatformTenantProvisioningRepository(prisma);
  const result = await repo.provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "USD",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Tenant ${marker}`,
    enabledModules: ["module.messaging.basic", "module.campaigns"],
    legalName: `Tenant ${marker} SA`,
    limits: {
      channelAccounts: 5,
      monthlyAiBudget: null,
      organizationUnits: 5,
      storageBytes: 1024 * 1024 * 1024,
      users: 5,
    },
    owner: {
      displayName: `Owner ${marker}`,
      email: `${prefix}-${marker}-${Date.now()}@example.invalid`,
      locale: "es-MX",
      passwordHash: "$argon2id$test-hash-not-reversible",
      timezone: "America/Mexico_City",
    },
    requestId: `${prefix}-${marker}-${Date.now()}`,
    slug: `${prefix}-${marker}-${Date.now()}`,
  });
  return {
    ownerId: result.owner.id,
    tenantId: result.tenant.id,
  };
}

describe("campaign-delivery-reconciler integration", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient({
      databaseUrl:
        process.env.DATABASE_URL ??
        "postgresql://whatsapp_platform_dev:replace-with-a-local-development-password@localhost:5432/whatsapp_platform_dev",
    });
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);

    const tenantA = await provisionTenant("a");
    const tenantB = await provisionTenant("b");
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    const channelA = await prisma.channelAccount.create({
      data: {
        tenantId: tenantAId,
        displayName: "Canal A",
        providerType: "mock",
        channelType: "whatsapp",
        status: "connected",
        phoneNumber: "+5215500003333",
        phoneNumberUniqueKey: `+5215500003333:${tenantAId}`,
      },
    });
    channelAccountAId = channelA.id;

    // Contacts for Tenant A
    await prisma.contact.create({
      data: {
        tenantId: tenantAId,
        name: "Ana Lopez",
        phoneNumber: "+5215588880001",
        tags: ["blackfriday"],
      },
    });
    await prisma.contact.create({
      data: {
        tenantId: tenantAId,
        name: "Carlos Gomez",
        phoneNumber: "+5215588880002",
        tags: ["blackfriday"],
      },
    });
    await prisma.contact.create({
      data: {
        tenantId: tenantAId,
        name: "Diana Perez",
        phoneNumber: "+5215588880003",
        tags: ["blackfriday"],
      },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("reconciles delivery statuses monotonically and updates campaign counters", async () => {
    const campaign = await createCampaign(prisma, {
      tenantId: tenantAId,
      channelAccountId: channelAccountAId,
      name: "Campaña Black Friday",
      messageContent: "Hola {{nombre}}, gran venta de Black Friday!",
      audienceFilter: { tags: ["blackfriday"] },
    });

    await segmentAndPopulateAudience(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });

    await startCampaign(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });

    // Dispatch all 3
    const dispatchResult = await dispatchCampaignBatch(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
      batchSize: 10,
    });
    expect(dispatchResult.processedCount).toBe(3);
    expect(dispatchResult.isCompleted).toBe(true);

    const members = await prisma.campaignAudienceMember.findMany({
      where: { tenantId: tenantAId, campaignId: campaign.id },
      orderBy: { createdAt: "asc" },
    });
    expect(members.length).toBe(3);

    const member1 = members[0];
    const member2 = members[1];
    const member3 = members[2];
    expect(member1).toBeDefined();
    expect(member2).toBeDefined();
    expect(member3).toBeDefined();
    if (!member1 || !member2 || !member3) throw new Error("Expected members to be defined");

    // 1. Member 1: SENT -> DELIVERED
    const res1 = await reconcileCampaignAudienceDeliveryStatus(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
      campaignAudienceMemberId: member1.id,
      status: "DELIVERED",
    });
    expect(res1.updated).toBe(true);
    expect(res1.currentStatus).toBe("DELIVERED");

    let detail = await getCampaignDetail(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });
    expect(detail.deliveredCount).toBe(1);

    // 2. Member 1: DELIVERED -> READ
    const res2 = await reconcileCampaignAudienceDeliveryStatus(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
      campaignAudienceMemberId: member1.id,
      status: "READ",
    });
    expect(res2.updated).toBe(true);
    expect(res2.currentStatus).toBe("READ");

    detail = await getCampaignDetail(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });
    // deliveredCount should not increment again
    expect(detail.deliveredCount).toBe(1);

    // 3. Member 1: Out-of-order DELIVERED arriving after READ (monotonicity test)
    const res3 = await reconcileCampaignAudienceDeliveryStatus(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
      campaignAudienceMemberId: member1.id,
      status: "DELIVERED",
    });
    expect(res3.updated).toBe(false);
    expect(res3.currentStatus).toBe("READ");

    // 4. Member 2: SENT -> READ directly (skipping DELIVERED)
    const res4 = await reconcileCampaignAudienceDeliveryStatus(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
      campaignAudienceMemberId: member2.id,
      status: "READ",
    });
    expect(res4.updated).toBe(true);
    expect(res4.currentStatus).toBe("READ");

    detail = await getCampaignDetail(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });
    // deliveredCount should now increment to 2
    expect(detail.deliveredCount).toBe(2);

    // 5. Member 3: SENT -> FAILED
    const res5 = await reconcileCampaignAudienceDeliveryStatus(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
      campaignAudienceMemberId: member3.id,
      status: "FAILED",
      errorMessage: "Destination phone disconnected",
    });
    expect(res5.updated).toBe(true);
    expect(res5.currentStatus).toBe("FAILED");

    detail = await getCampaignDetail(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });
    expect(detail.failedCount).toBe(1);

    // 6. Member 3: Duplicate FAILED (idempotency test)
    const res6 = await reconcileCampaignAudienceDeliveryStatus(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
      campaignAudienceMemberId: member3.id,
      status: "FAILED",
    });
    expect(res6.updated).toBe(false);
    expect(res6.currentStatus).toBe("FAILED");

    detail = await getCampaignDetail(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });
    expect(detail.failedCount).toBe(1);

    // Verify Campaign Metrics
    const metrics = await getCampaignMetrics(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });
    expect(metrics.totalRecipients).toBe(3);
    expect(metrics.sentCount).toBe(3);
    expect(metrics.deliveredCount).toBe(2);
    expect(metrics.readCount).toBe(2);
    expect(metrics.failedCount).toBe(1);
    expect(metrics.pendingCount).toBe(0);
    expect(metrics.deliveryRate).toBe(66.67);
    expect(metrics.readRate).toBe(100);
    expect(metrics.failureRate).toBe(33.33);

    // Verify Audience Members List & Filtering
    const allAudience = await listCampaignAudienceMembers(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });
    expect(allAudience.total).toBe(3);
    expect(allAudience.members.length).toBe(3);
    expect(allAudience.members[0]?.contact.name).toBeDefined();

    const readAudience = await listCampaignAudienceMembers(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
      status: "READ",
    });
    expect(readAudience.total).toBe(2);

    const failedAudience = await listCampaignAudienceMembers(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
      status: "FAILED",
    });
    expect(failedAudience.total).toBe(1);
    expect(failedAudience.members[0]?.errorMessage).toBe("Destination phone disconnected");
  });

  it("reconciles delivery from outboundMessage metadata successfully", async () => {
    const campaign = await createCampaign(prisma, {
      tenantId: tenantAId,
      channelAccountId: channelAccountAId,
      name: "Campaña Hook Outbox",
      messageContent: "Hola {{nombre}}!",
      audienceFilter: { tags: ["blackfriday"] },
    });

    await segmentAndPopulateAudience(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });

    await startCampaign(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });

    await dispatchCampaignBatch(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
      batchSize: 1,
    });

    // Find the created outbound message
    const outbound = await prisma.outboundMessage.findFirst({
      where: {
        tenantId: tenantAId,
        channelAccountId: channelAccountAId,
        content: {
          path: ["metadata", "campaignId"],
          equals: campaign.id,
        },
      },
    });

    expect(outbound).toBeDefined();
    if (!outbound) throw new Error("Expected outbound to be defined");

    const hookResult = await reconcileCampaignDeliveryFromOutboundMessage(prisma, {
      tenantId: tenantAId,
      outboundMessageId: outbound.id,
      status: "DELIVERED",
    });

    expect(hookResult).toBeDefined();
    expect(hookResult?.updated).toBe(true);
    expect(hookResult?.currentStatus).toBe("DELIVERED");
  });

  it("strictly enforces A/B tenant isolation on reconciliation and metrics", async () => {
    const campaignA = await createCampaign(prisma, {
      tenantId: tenantAId,
      channelAccountId: channelAccountAId,
      name: "Campaña Aislada Métricas",
      messageContent: "Mensaje privado",
    });

    // Tenant B cannot get Tenant A's metrics
    await expect(
      getCampaignMetrics(prisma, {
        tenantId: tenantBId,
        campaignId: campaignA.id,
      }),
    ).rejects.toThrow(CampaignNotFoundError);

    // Tenant B cannot list Tenant A's audience members
    await expect(
      listCampaignAudienceMembers(prisma, {
        tenantId: tenantBId,
        campaignId: campaignA.id,
      }),
    ).rejects.toThrow(CampaignNotFoundError);

    // Tenant B cannot reconcile Tenant A's audience
    await expect(
      reconcileCampaignAudienceDeliveryStatus(prisma, {
        tenantId: tenantBId,
        campaignId: campaignA.id,
        campaignAudienceMemberId: "019c0000-0000-7000-8000-000000000099",
        status: "DELIVERED",
      }),
    ).rejects.toThrow(CampaignNotFoundError);

    // Non-existent member for existing campaign throws CampaignAudienceMemberNotFoundError
    await expect(
      reconcileCampaignAudienceDeliveryStatus(prisma, {
        tenantId: tenantAId,
        campaignId: campaignA.id,
        campaignAudienceMemberId: "019c0000-0000-7000-8000-000000000099",
        status: "DELIVERED",
      }),
    ).rejects.toThrow(CampaignAudienceMemberNotFoundError);
  });
});
