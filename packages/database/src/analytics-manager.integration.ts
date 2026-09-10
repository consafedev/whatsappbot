import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AnalyticsDateRangeInvalidError,
  getTenantMessageTimeSeries,
  getTenantOperationalOverview,
} from "./analytics-manager";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  type PrismaClient,
  syncPermissionCatalog,
} from "./platform";

const prefix = "e12-s01-analytics";
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
    await prisma.aiUsageLog.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.message.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.inboundMessageEvent.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.outboundMessage.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { tenantId: { in: ids } } });
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

async function provisionTenant(marker: string): Promise<{ tenantId: string }> {
  const repo = createPlatformTenantProvisioningRepository(prisma);
  const result = await repo.provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "USD",
    defaultLocale: "es-MX",
    defaultTimezone: "UTC",
    deploymentId: null,
    displayName: `Analytics Tenant ${marker}`,
    enabledModules: ["module.messaging.basic", "module.reports"],
    legalName: `Analytics Tenant ${marker} SA`,
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
      timezone: "UTC",
    },
    requestId: `${prefix}-${marker}-${Date.now()}`,
    slug: `${prefix}-${marker}-${Date.now()}`,
  });
  return { tenantId: result.tenant.id };
}

describe.sequential("Analytics Manager Database Integration", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient({
      databaseUrl:
        process.env.DATABASE_URL ??
        "postgresql://whatsapp_platform_dev:replace-with-a-local-development-password@localhost:5432/whatsapp_platform_dev",
    });
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);

    const a = await provisionTenant("a");
    const b = await provisionTenant("b");
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;

    const channelA = await prisma.channelAccount.create({
      data: {
        channelType: "whatsapp",
        displayName: "Channel A",
        phoneNumber: "+5215500001111",
        providerType: "baileys",
        status: "connected",
        tenantId: tenantAId,
      },
    });
    channelAccountAId = channelA.id;

    const channelB = await prisma.channelAccount.create({
      data: {
        channelType: "whatsapp",
        displayName: "Channel B",
        phoneNumber: "+5215500002222",
        providerType: "baileys",
        status: "connected",
        tenantId: tenantBId,
      },
    });
    channelAccountBId = channelB.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("calculates accurate operational metrics and delivery rate in specific time window", async () => {
    const from = new Date("2026-09-01T00:00:00.000Z");
    const to = new Date("2026-09-05T23:59:59.999Z");
    const insideDate = new Date("2026-09-02T12:00:00.000Z");
    const outsideDate = new Date("2026-08-20T12:00:00.000Z");

    const contactA = await prisma.contact.create({
      data: {
        name: "Contact Alpha",
        phoneNumber: "+5215511110001",
        tenantId: tenantAId,
      },
    });

    // 2 active conversations and 1 closed conversation in the period for Tenant A
    await prisma.conversation.create({
      data: {
        channelAccountId: channelAccountAId,
        contactId: contactA.id,
        createdAt: insideDate,
        lastMessageAt: insideDate,
        status: "open",
        tenantId: tenantAId,
        updatedAt: insideDate,
      },
    });
    await prisma.conversation.create({
      data: {
        channelAccountId: channelAccountAId,
        contactId: contactA.id,
        createdAt: insideDate,
        lastMessageAt: insideDate,
        status: "pending",
        tenantId: tenantAId,
        updatedAt: insideDate,
      },
    });
    await prisma.conversation.create({
      data: {
        channelAccountId: channelAccountAId,
        closedAt: insideDate,
        contactId: contactA.id,
        createdAt: insideDate,
        status: "closed",
        tenantId: tenantAId,
        updatedAt: insideDate,
      },
    });

    // Conversation outside period for Tenant A (should not count)
    await prisma.conversation.create({
      data: {
        channelAccountId: channelAccountAId,
        contactId: contactA.id,
        createdAt: outsideDate,
        lastMessageAt: outsideDate,
        status: "open",
        tenantId: tenantAId,
        updatedAt: outsideDate,
      },
    });

    // Inbound messages: 3 inside window, 1 outside window for Tenant A
    await prisma.inboundMessageEvent.createMany({
      data: [
        {
          channelAccountId: channelAccountAId,
          createdAt: insideDate,
          eventType: "MESSAGE_RECEIVED",
          payload: { text: "msg 1" },
          tenantId: tenantAId,
        },
        {
          channelAccountId: channelAccountAId,
          createdAt: new Date("2026-09-03T10:00:00.000Z"),
          eventType: "MESSAGE_RECEIVED",
          payload: { text: "msg 2" },
          tenantId: tenantAId,
        },
        {
          channelAccountId: channelAccountAId,
          createdAt: new Date("2026-09-04T15:00:00.000Z"),
          eventType: "MESSAGE_RECEIVED",
          payload: { text: "msg 3" },
          tenantId: tenantAId,
        },
        {
          channelAccountId: channelAccountAId,
          createdAt: outsideDate,
          eventType: "MESSAGE_RECEIVED",
          payload: { text: "old msg" },
          tenantId: tenantAId,
        },
      ],
    });

    // Outbound messages: 4 inside window (2 DELIVERED, 1 READ, 1 FAILED), 1 outside
    await prisma.outboundMessage.createMany({
      data: [
        {
          channelAccountId: channelAccountAId,
          content: { text: "out 1" },
          createdAt: insideDate,
          idempotencyKey: "idem-a-1",
          recipientPhone: "+5215511110001",
          status: "DELIVERED",
          tenantId: tenantAId,
        },
        {
          channelAccountId: channelAccountAId,
          content: { text: "out 2" },
          createdAt: new Date("2026-09-03T11:00:00.000Z"),
          idempotencyKey: "idem-a-2",
          recipientPhone: "+5215511110001",
          status: "READ",
          tenantId: tenantAId,
        },
        {
          channelAccountId: channelAccountAId,
          content: { text: "out 3" },
          createdAt: new Date("2026-09-04T12:00:00.000Z"),
          idempotencyKey: "idem-a-3",
          recipientPhone: "+5215511110001",
          status: "DELIVERED",
          tenantId: tenantAId,
        },
        {
          channelAccountId: channelAccountAId,
          content: { text: "out 4" },
          createdAt: new Date("2026-09-04T14:00:00.000Z"),
          idempotencyKey: "idem-a-4",
          recipientPhone: "+5215511110001",
          status: "FAILED",
          tenantId: tenantAId,
        },
        {
          channelAccountId: channelAccountAId,
          content: { text: "out old" },
          createdAt: outsideDate,
          idempotencyKey: "idem-a-old",
          recipientPhone: "+5215511110001",
          status: "DELIVERED",
          tenantId: tenantAId,
        },
      ],
    });

    // AI Usage logs for Tenant A: 2 inside, 1 outside
    await prisma.aiUsageLog.createMany({
      data: [
        {
          channelAccountId: channelAccountAId,
          completionTokens: 150,
          costEstimatedUsd: 0.0025,
          createdAt: insideDate,
          modelId: "gpt-4o-mini",
          promptTokens: 300,
          providerType: "openai",
          purpose: "auto-reply",
          status: "success",
          tenantId: tenantAId,
          totalTokens: 450,
        },
        {
          channelAccountId: channelAccountAId,
          completionTokens: 50,
          costEstimatedUsd: 0.001,
          createdAt: new Date("2026-09-03T16:00:00.000Z"),
          modelId: "gpt-4o-mini",
          promptTokens: 100,
          providerType: "openai",
          purpose: "classification",
          status: "success",
          tenantId: tenantAId,
          totalTokens: 150,
        },
        {
          channelAccountId: channelAccountAId,
          completionTokens: 500,
          costEstimatedUsd: 0.05,
          createdAt: outsideDate,
          modelId: "gpt-4o",
          promptTokens: 1000,
          providerType: "openai",
          purpose: "summary",
          status: "success",
          tenantId: tenantAId,
          totalTokens: 1500,
        },
      ],
    });

    const overviewA = await getTenantOperationalOverview(prisma, {
      from,
      tenantId: tenantAId,
      to,
    });

    expect(overviewA.tenantId).toBe(tenantAId);
    expect(overviewA.inboundMessagesCount).toBe(3);
    expect(overviewA.outboundMessagesCount).toBe(4);
    expect(overviewA.activeConversationsCount).toBe(2);
    expect(overviewA.closedConversationsCount).toBe(1);
    // 3 out of 4 outbound messages delivered or read -> 75%
    expect(overviewA.deliverySuccessRate).toBe(75);

    // AI Token Usage
    expect(overviewA.aiTokenUsage.promptTokens).toBe(400); // 300 + 100
    expect(overviewA.aiTokenUsage.completionTokens).toBe(200); // 150 + 50
    expect(overviewA.aiTokenUsage.totalTokens).toBe(600); // 450 + 150
    expect(overviewA.aiTokenUsage.estimatedCostUsd).toBeCloseTo(0.0035, 4);
  });

  it("enforces strict A/B multitenant isolation", async () => {
    const from = new Date("2026-09-01T00:00:00.000Z");
    const to = new Date("2026-09-05T23:59:59.999Z");
    const date = new Date("2026-09-03T12:00:00.000Z");

    // Create 1 message and 1 conversation for Tenant B
    const contactB = await prisma.contact.create({
      data: {
        name: "Contact Beta",
        phoneNumber: "+5215522220002",
        tenantId: tenantBId,
      },
    });

    await prisma.conversation.create({
      data: {
        channelAccountId: channelAccountBId,
        contactId: contactB.id,
        createdAt: date,
        lastMessageAt: date,
        status: "open",
        tenantId: tenantBId,
        updatedAt: date,
      },
    });

    await prisma.inboundMessageEvent.create({
      data: {
        channelAccountId: channelAccountBId,
        createdAt: date,
        eventType: "MESSAGE_RECEIVED",
        payload: { text: "msg B" },
        tenantId: tenantBId,
      },
    });

    const overviewB = await getTenantOperationalOverview(prisma, {
      from,
      tenantId: tenantBId,
      to,
    });

    // Tenant B sees only its 1 inbound message and 1 active conversation
    expect(overviewB.tenantId).toBe(tenantBId);
    expect(overviewB.inboundMessagesCount).toBe(1);
    expect(overviewB.outboundMessagesCount).toBe(0);
    expect(overviewB.activeConversationsCount).toBe(1);
    expect(overviewB.closedConversationsCount).toBe(0);
    expect(overviewB.deliverySuccessRate).toBe(0);
    expect(overviewB.aiTokenUsage.totalTokens).toBe(0);
    expect(overviewB.aiTokenUsage.estimatedCostUsd).toBe(0);

    // Re-verify Tenant A remains unaffected
    const overviewA = await getTenantOperationalOverview(prisma, {
      from,
      tenantId: tenantAId,
      to,
    });
    expect(overviewA.inboundMessagesCount).toBe(3);
    expect(overviewA.activeConversationsCount).toBe(2);
  });

  it("generates time series buckets by day and by hour with zero-filled intervals", async () => {
    const from = new Date("2026-09-01T00:00:00.000Z");
    const to = new Date("2026-09-03T23:59:59.999Z");

    const dailySeries = await getTenantMessageTimeSeries(prisma, {
      from,
      interval: "day",
      tenantId: tenantAId,
      to,
    });

    // Should have buckets for 2026-09-01, 2026-09-02, 2026-09-03
    expect(dailySeries.length).toBeGreaterThanOrEqual(3);
    const day1 = dailySeries.find((b) => b.timestamp.startsWith("2026-09-01"));
    const day2 = dailySeries.find((b) => b.timestamp.startsWith("2026-09-02"));
    const day3 = dailySeries.find((b) => b.timestamp.startsWith("2026-09-03"));

    expect(day1).toBeDefined();
    expect(day2).toBeDefined();
    expect(day3).toBeDefined();

    // Day 1 had 0 messages (zero-filled bucket)
    expect(day1?.inbound).toBe(0);
    expect(day1?.outbound).toBe(0);
    expect(day1?.total).toBe(0);

    // Day 2 had 1 inbound and 1 outbound
    expect(day2?.inbound).toBe(1);
    expect(day2?.outbound).toBe(1);
    expect(day2?.total).toBe(2);

    // Day 3 had 1 inbound and 1 outbound
    expect(day3?.inbound).toBe(1);
    expect(day3?.outbound).toBe(1);
    expect(day3?.total).toBe(2);

    // Hourly series for a 3-hour period
    const hourFrom = new Date("2026-09-02T11:00:00.000Z");
    const hourTo = new Date("2026-09-02T13:00:00.000Z");

    const hourlySeries = await getTenantMessageTimeSeries(prisma, {
      from: hourFrom,
      interval: "hour",
      tenantId: tenantAId,
      to: hourTo,
    });

    expect(hourlySeries.length).toBeGreaterThanOrEqual(3);
    const targetHour = hourlySeries.find((b) => b.timestamp.startsWith("2026-09-02T12:00:00"));
    expect(targetHour).toBeDefined();
    expect(targetHour?.inbound).toBe(1);
    expect(targetHour?.outbound).toBe(1);
    expect(targetHour?.total).toBe(2);
  });

  it("rejects inverted date ranges (from > to) with AnalyticsDateRangeInvalidError", async () => {
    const from = new Date("2026-09-10T00:00:00.000Z");
    const to = new Date("2026-09-01T00:00:00.000Z");

    await expect(
      getTenantOperationalOverview(prisma, { from, tenantId: tenantAId, to }),
    ).rejects.toThrow(AnalyticsDateRangeInvalidError);

    await expect(
      getTenantMessageTimeSeries(prisma, { from, tenantId: tenantAId, to }),
    ).rejects.toThrow(AnalyticsDateRangeInvalidError);
  });
});
