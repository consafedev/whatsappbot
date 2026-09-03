import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CampaignChannelAccountNotFoundError,
  CampaignNotFoundError,
  createCampaign,
  createMessageTemplate,
  getCampaignDetail,
  listCampaigns,
  listMessageTemplates,
  segmentAndPopulateAudience,
} from "./campaign-manager";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  type PrismaClient,
  syncPermissionCatalog,
} from "./platform";

const prefix = "e11-s01-campaign";
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";
let channelAccountAId = "";
let channelAccountBId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length > 0) {
    await prisma.campaignAudienceMember.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.campaign.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.messageTemplate.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.contact.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.channelAccount.deleteMany({
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

describe("campaign-manager integration", () => {
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

    // Create Channel Accounts
    const channelA = await prisma.channelAccount.create({
      data: {
        tenantId: tenantAId,
        displayName: "Canal Ventas A",
        providerType: "mock",
        channelType: "whatsapp",
        status: "connected",
        phoneNumber: "+5215500000001",
        phoneNumberUniqueKey: `+5215500000001:${tenantAId}`,
      },
    });
    channelAccountAId = channelA.id;

    const channelB = await prisma.channelAccount.create({
      data: {
        tenantId: tenantBId,
        displayName: "Canal Ventas B",
        providerType: "mock",
        channelType: "whatsapp",
        status: "connected",
        phoneNumber: "+5215500000002",
        phoneNumberUniqueKey: `+5215500000002:${tenantBId}`,
      },
    });
    channelAccountBId = channelB.id;

    // Create Contacts for Tenant A
    await prisma.contact.create({
      data: {
        tenantId: tenantAId,
        name: "Ana VIP",
        phoneNumber: "+5215511111111",
        tags: ["vip", "promo"],
      },
    });

    await prisma.contact.create({
      data: {
        tenantId: tenantAId,
        name: "Beto Promo",
        phoneNumber: "+5215511111112",
        tags: ["promo"],
      },
    });

    await prisma.contact.create({
      data: {
        tenantId: tenantAId,
        name: "Carlos General",
        phoneNumber: "+5215511111113",
        tags: ["general"],
      },
    });

    // Create Contact for Tenant B
    await prisma.contact.create({
      data: {
        tenantId: tenantBId,
        name: "Daniel VIP Tenant B",
        phoneNumber: "+5215522222221",
        tags: ["vip"],
      },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("creates message templates and lists them by tenant and category", async () => {
    const templateMarketing = await createMessageTemplate(prisma, {
      tenantId: tenantAId,
      name: "Oferta Verano",
      category: "MARKETING",
      content: "Hola {{nombre}}, aprovecha el 20% de descuento en tu orden {{pedido}}.",
    });

    expect(templateMarketing.id).toBeDefined();
    expect(templateMarketing.variables).toEqual(["nombre", "pedido"]);
    expect(templateMarketing.category).toBe("MARKETING");

    const templateUtility = await createMessageTemplate(prisma, {
      tenantId: tenantAId,
      name: "Recordatorio Cita",
      category: "UTILITY",
      content: "Hola {{nombre}}, tu cita es el {{fecha}}.",
    });

    expect(templateUtility.id).toBeDefined();

    const allTemplates = await listMessageTemplates(prisma, { tenantId: tenantAId });
    expect(allTemplates.length).toBe(2);

    const utilityTemplates = await listMessageTemplates(prisma, {
      tenantId: tenantAId,
      category: "UTILITY",
    });
    expect(utilityTemplates.length).toBe(1);
    expect(utilityTemplates[0]?.name).toBe("Recordatorio Cita");
  });

  it("creates a campaign with validated channel account and template content", async () => {
    const template = await createMessageTemplate(prisma, {
      tenantId: tenantAId,
      name: "Plantilla Campaña",
      content: "Hola {{nombre}}, tenemos promociones para ti.",
    });

    const campaign = await createCampaign(prisma, {
      tenantId: tenantAId,
      channelAccountId: channelAccountAId,
      templateId: template.id,
      name: "Campaña VIP Marzo",
      rateLimitPerMinute: 60,
      audienceFilter: { tags: ["vip"] },
    });

    expect(campaign.id).toBeDefined();
    expect(campaign.status).toBe("DRAFT");
    expect(campaign.messageContent).toBe("Hola {{nombre}}, tenemos promociones para ti.");
    expect(campaign.rateLimitPerMinute).toBe(60);
    expect(campaign.totalRecipients).toBe(0);
  });

  it("rejects campaign creation when channel account belongs to another tenant", async () => {
    await expect(
      createCampaign(prisma, {
        tenantId: tenantAId,
        channelAccountId: channelAccountBId, // Belongs to Tenant B!
        name: "Campaña Inválida",
        messageContent: "Mensaje de prueba",
      }),
    ).rejects.toThrow(CampaignChannelAccountNotFoundError);
  });

  it("segments active contacts by tags and populates audience without duplicates", async () => {
    const campaign = await createCampaign(prisma, {
      tenantId: tenantAId,
      channelAccountId: channelAccountAId,
      name: "Campaña Promo & VIP",
      messageContent: "Promoción especial para ti.",
      audienceFilter: { tags: ["vip"] },
    });

    // Ana has tag "vip". Beto and Carlos do not.
    const result1 = await segmentAndPopulateAudience(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });

    expect(result1.totalAdded).toBe(1);
    expect(result1.totalRecipients).toBe(1);

    // Verify audience member record
    const detail = await getCampaignDetail(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });
    expect(detail.totalRecipients).toBe(1);
    expect(detail._count.audienceMembers).toBe(1);

    // Running segmentation again does not create duplicate recipients
    const result2 = await segmentAndPopulateAudience(prisma, {
      tenantId: tenantAId,
      campaignId: campaign.id,
    });
    expect(result2.totalAdded).toBe(0);
    expect(result2.totalRecipients).toBe(1);
  });

  it("strictly enforces A/B tenant isolation", async () => {
    const campaignA = await createCampaign(prisma, {
      tenantId: tenantAId,
      channelAccountId: channelAccountAId,
      name: "Campaña Privada A",
      messageContent: "Contenido confidencial de Tenant A",
    });

    // Tenant B cannot retrieve Tenant A's campaign
    await expect(
      getCampaignDetail(prisma, {
        tenantId: tenantBId,
        campaignId: campaignA.id,
      }),
    ).rejects.toThrow(CampaignNotFoundError);

    // Tenant B listCampaigns returns only its own
    const listB = await listCampaigns(prisma, { tenantId: tenantBId });
    expect(listB.campaigns.some((c) => c.id === campaignA.id)).toBe(false);

    // Tenant B cannot populate audience on Tenant A's campaign
    await expect(
      segmentAndPopulateAudience(prisma, {
        tenantId: tenantBId,
        campaignId: campaignA.id,
      }),
    ).rejects.toThrow(CampaignNotFoundError);
  });
});
