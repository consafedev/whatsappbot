import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatchCampaignBatch } from "./campaign-execution-dispatcher";
import {
  CampaignEmptyAudienceError,
  CampaignInvalidStatusTransitionError,
  CampaignNotFoundError,
  CampaignNotRunningError,
  cancelCampaign,
  createCampaign,
  createMessageTemplate,
  getCampaignDetail,
  pauseCampaign,
  segmentAndPopulateAudience,
  startCampaign,
} from "./campaign-manager";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  type PrismaClient,
  syncPermissionCatalog,
} from "./platform";

const prefix = "e11-s02-dispatch";
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

describe("campaign-execution-dispatcher integration", () => {
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
        phoneNumber: "+5215500001111",
        phoneNumberUniqueKey: `+5215500001111:${tenantAId}`,
      },
    });
    channelAccountAId = channelA.id;

    await prisma.channelAccount.create({
      data: {
        tenantId: tenantBId,
        displayName: "Canal B",
        providerType: "mock",
        channelType: "whatsapp",
        status: "connected",
        phoneNumber: "+5215500002222",
        phoneNumberUniqueKey: `+5215500002222:${tenantBId}`,
      },
    });

    // Contacts for Tenant A
    await prisma.contact.create({
      data: {
        tenantId: tenantAId,
        name: "Laura Cliente",
        phoneNumber: "+5215577770001",
        tags: ["promo2026"],
        customAttributes: { descuento: "20%" },
      },
    });
    await prisma.contact.create({
      data: {
        tenantId: tenantAId,
        name: "Mateo Cliente",
        phoneNumber: "+5215577770002",
        tags: ["promo2026"],
        customAttributes: { descuento: "15%" },
      },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("enforces lifecycle state machine transitions and guards", async () => {
    const campaign = await createCampaign(prisma, {
      tenantId: tenantAId,
      channelAccountId: channelAccountAId,
      name: "Campaña Ciclo de Vida",
      messageContent: "Hola {{nombre}}, tu descuento es {{descuento}}.",
    });

    expect(campaign.status).toBe("DRAFT");

    // Starting with 0 recipients must fail
    await expect(
      startCampaign(prisma, {
        tenantId: tenantAId,
        campaignId: campaign.id,
      }),
    ).rejects.toThrow(CampaignEmptyAudienceError);

    // Segment audience
    await prisma.campaign.update({
      where: {
        tenantId_id: {
          tenantId: tenantAId,
          id: campaign.id,
        },
      },
      data: {
        audienceFilter: { tags: ["promo2026"] },
      },
    });
    await segmentAndPopulateAudience(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });

    // Start campaign -> RUNNING
    const started = await startCampaign(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });
    expect(started.status).toBe("RUNNING");
    expect(started.startedAt).toBeDefined();

    // Starting an already RUNNING campaign must fail
    await expect(
      startCampaign(prisma, {
        tenantId: tenantAId,
        campaignId: campaign.id,
      }),
    ).rejects.toThrow(CampaignInvalidStatusTransitionError);

    // Pause campaign -> PAUSED
    const paused = await pauseCampaign(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });
    expect(paused.status).toBe("PAUSED");

    // Pausing an already PAUSED campaign must fail
    await expect(
      pauseCampaign(prisma, {
        tenantId: tenantAId,
        campaignId: campaign.id,
      }),
    ).rejects.toThrow(CampaignInvalidStatusTransitionError);

    // Resume campaign -> RUNNING
    const resumed = await startCampaign(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });
    expect(resumed.status).toBe("RUNNING");

    // Cancel campaign -> CANCELLED
    const cancelled = await cancelCampaign(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });
    expect(cancelled.status).toBe("CANCELLED");

    // Cancelling an already CANCELLED campaign must fail
    await expect(
      cancelCampaign(prisma, {
        tenantId: tenantAId,
        campaignId: campaign.id,
      }),
    ).rejects.toThrow(CampaignInvalidStatusTransitionError);
  });

  it("dispatches batches, populates outbox with source CAMPAIGN, and transitions to COMPLETED", async () => {
    const template = await createMessageTemplate(prisma, {
      tenantId: tenantAId,
      name: "Oferta Verano Dispatch",
      content: "Hola {{nombre}}, tienes un descuento de {{descuento}} en tu cuenta.",
    });

    const campaign = await createCampaign(prisma, {
      tenantId: tenantAId,
      channelAccountId: channelAccountAId,
      templateId: template.id,
      name: "Campaña Despacho Lotes",
      rateLimitPerMinute: 60,
      audienceFilter: { tags: ["promo2026"] },
    });

    await segmentAndPopulateAudience(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });

    // Attempting to dispatch before starting must fail with CampaignNotRunningError
    await expect(
      dispatchCampaignBatch(prisma, {
        tenantId: tenantAId,
        campaignId: campaign.id,
        batchSize: 1,
      }),
    ).rejects.toThrow(CampaignNotRunningError);

    // Start campaign
    await startCampaign(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });

    // Dispatch first batch: batchSize = 1
    const batch1 = await dispatchCampaignBatch(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
      batchSize: 1,
    });

    expect(batch1.processedCount).toBe(1);
    expect(batch1.remainingPending).toBe(1);
    expect(batch1.isCompleted).toBe(false);

    // Verify outbound message was created with source "CAMPAIGN"
    const outboundMessages = await prisma.outboundMessage.findMany({
      where: {
        tenantId: tenantAId,
        channelAccountId: channelAccountAId,
      },
    });
    expect(outboundMessages.length).toBe(1);
    const firstOutbound = outboundMessages[0];
    expect(firstOutbound).toBeDefined();
    if (!firstOutbound) {
      throw new Error("Expected firstOutbound to be defined");
    }
    expect(firstOutbound.status).toBe("PENDING");
    const content = firstOutbound.content as {
      text: string;
      metadata: { source: string; campaignId: string };
    };
    expect(content.metadata.source).toBe("CAMPAIGN");
    expect(content.metadata.campaignId).toBe(campaign.id);
    expect(content.text).toMatch(
      /Hola (Laura|Mateo) Cliente, tienes un descuento de (20%|15%) en tu cuenta\./,
    );

    // Verify campaign sentCount is 1
    let detail = await getCampaignDetail(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });
    expect(detail.sentCount).toBe(1);
    expect(detail.status).toBe("RUNNING");

    // Dispatch second batch: finishes the remaining recipient
    const batch2 = await dispatchCampaignBatch(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
      batchSize: 5,
    });

    expect(batch2.processedCount).toBe(1);
    expect(batch2.remainingPending).toBe(0);
    expect(batch2.isCompleted).toBe(true);

    // Verify campaign is COMPLETED with completedAt
    detail = await getCampaignDetail(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });
    expect(detail.status).toBe("COMPLETED");
    expect(detail.completedAt).toBeDefined();
    expect(detail.sentCount).toBe(2);

    // Dispatched 2 total outbound messages
    const allOutbound = await prisma.outboundMessage.findMany({
      where: {
        tenantId: tenantAId,
        channelAccountId: channelAccountAId,
      },
    });
    expect(allOutbound.length).toBe(2);
  });

  it("strictly enforces A/B tenant isolation on campaign execution", async () => {
    const campaignA = await createCampaign(prisma, {
      tenantId: tenantAId,
      channelAccountId: channelAccountAId,
      name: "Campaña Aislada A",
      messageContent: "Mensaje privado",
    });

    // Tenant B cannot start Tenant A's campaign
    await expect(
      startCampaign(prisma, {
        tenantId: tenantBId,
        campaignId: campaignA.id,
      }),
    ).rejects.toThrow(CampaignNotFoundError);

    // Tenant B cannot pause Tenant A's campaign
    await expect(
      pauseCampaign(prisma, {
        tenantId: tenantBId,
        campaignId: campaignA.id,
      }),
    ).rejects.toThrow(CampaignNotFoundError);

    // Tenant B cannot cancel Tenant A's campaign
    await expect(
      cancelCampaign(prisma, {
        tenantId: tenantBId,
        campaignId: campaignA.id,
      }),
    ).rejects.toThrow(CampaignNotFoundError);

    // Tenant B cannot dispatch Tenant A's campaign
    await expect(
      dispatchCampaignBatch(prisma, {
        tenantId: tenantBId,
        campaignId: campaignA.id,
      }),
    ).rejects.toThrow(CampaignNotFoundError);
  });
});
