import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/prisma/client";
import {
  createInactivityManager,
  type InactivityManager,
} from "./inactivity-manager";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e08-s06-inactivity-db";
let prisma: PrismaClient;
let inactivityManager: InactivityManager;

let tenantAId = "";
let tenantBId = "";
let channelAId = "";
let channelBId = "";
let contactAId = "";
let contactBId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length === 0) return;
  await prisma.message.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.outboundMessage.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.inboundMessageEvent.deleteMany({ where: { tenantId: { in: ids } } });
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

async function provision(marker: string): Promise<{ ownerId: string; tenantId: string }> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Inactivity ${marker}`,
    enabledModules: ["module.messaging.basic", "module.crm_lite", "module.automation.basic"],
    legalName: `Inactivity ${marker} SA`,
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

describe.sequential("E08-S06 InactivityManager integration", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);

    inactivityManager = createInactivityManager(prisma);

    const [tenantA, tenantB] = await Promise.all([provision("a"), provision("b")]);
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    const [channelA, channelB] = await Promise.all([
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "Channel A",
          providerType: "mock",
          status: "connected",
          tenantId: tenantAId,
        },
      }),
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "Channel B",
          providerType: "mock",
          status: "connected",
          tenantId: tenantBId,
        },
      }),
    ]);
    channelAId = channelA.id;
    channelBId = channelB.id;

    const [contactA, contactB] = await Promise.all([
      prisma.contact.create({
        data: {
          name: "Contact A",
          phoneNumber: "+525511111111",
          tenantId: tenantAId,
        },
      }),
      prisma.contact.create({
        data: {
          name: "Contact B",
          phoneNumber: "+525522222222",
          tenantId: tenantBId,
        },
      }),
    ]);
    contactAId = contactA.id;
    contactBId = contactB.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("auto-closes inactive open and pending conversations past threshold with audit and outbox events", async () => {
    const tenantA = createTenantContext(tenantAId);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    // Inactive conversation
    const inactiveConv = await prisma.conversation.create({
      data: {
        automationMode: "AUTO",
        channelAccountId: channelAId,
        contactId: contactAId,
        createdAt: twoHoursAgo,
        lastMessageAt: twoHoursAgo,
        status: "open",
        tenantId: tenantAId,
      },
    });

    // Active recent conversation (should NOT be closed)
    const activeConv = await prisma.conversation.create({
      data: {
        automationMode: "AUTO",
        channelAccountId: channelAId,
        contactId: contactAId,
        createdAt: new Date(),
        lastMessageAt: new Date(),
        status: "open",
        tenantId: tenantAId,
      },
    });

    const result = await inactivityManager.processInactivityTimeouts(tenantA, {
      closeReason: "inactivity_timeout_test",
      inactivityMinutes: 60, // 1 hour threshold
    });

    expect(result.closedCount).toBe(1);
    expect(result.processedConversationIds).toContain(inactiveConv.id);
    expect(result.processedConversationIds).not.toContain(activeConv.id);

    // Verify inactive conversation in DB
    const updatedInactive = await prisma.conversation.findUniqueOrThrow({
      where: { id: inactiveConv.id },
    });
    expect(updatedInactive.status).toBe("closed");
    expect(updatedInactive.closedAt).toBeDefined();
    const meta = updatedInactive.metadata as Record<string, unknown>;
    expect(meta.closeReason).toBe("inactivity_timeout_test");

    // Verify active conversation remains open
    const updatedActive = await prisma.conversation.findUniqueOrThrow({
      where: { id: activeConv.id },
    });
    expect(updatedActive.status).toBe("open");

    // Verify AuditLog and Outbox for closed conversation
    const audit = await prisma.auditLog.findFirst({
      orderBy: { occurredAt: "desc" },
      where: {
        action: "conversation.auto_closed",
        entityId: inactiveConv.id,
        tenantId: tenantAId,
      },
    });
    expect(audit).toBeDefined();

    const outbox = await prisma.domainEventOutbox.findFirst({
      orderBy: { occurredAt: "desc" },
      where: {
        aggregateId: inactiveConv.id,
        eventType: "conversation.status_updated",
        tenantId: tenantAId,
      },
    });
    expect(outbox).toBeDefined();
    expect((outbox?.payload as Record<string, unknown>)?.newStatus).toBe("closed");
    expect((outbox?.payload as Record<string, unknown>)?.reason).toBe(
      "inactivity_timeout_test",
    );
  });

  it("releases takeover (HUMAN -> AUTO) for inactive operator conversations", async () => {
    const tenantA = createTenantContext(tenantAId);
    const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000);

    const humanConv = await prisma.conversation.create({
      data: {
        automationMode: "HUMAN",
        channelAccountId: channelAId,
        contactId: contactAId,
        createdAt: fortyMinutesAgo,
        lastMessageAt: fortyMinutesAgo,
        metadata: {
          automationPausedAt: fortyMinutesAgo.toISOString(),
          automationPausedReason: "agent_reply",
        },
        status: "open",
        tenantId: tenantAId,
      },
    });

    const result = await inactivityManager.processInactivityTimeouts(tenantA, {
      inactivityMinutes: 120, // 2h auto-close
      releaseTakeoverMinutes: 30, // 30m release takeover
    });

    expect(result.closedCount).toBe(0);
    expect(result.releasedCount).toBe(1);
    expect(result.processedConversationIds).toContain(humanConv.id);

    const updated = await prisma.conversation.findUniqueOrThrow({
      where: { id: humanConv.id },
    });
    expect(updated.automationMode).toBe("AUTO");
    expect(updated.status).toBe("open");
    const meta = updated.metadata as Record<string, unknown>;
    expect(meta.automationPausedAt).toBeNull();
    expect(meta.automationPausedReason).toBe("inactivity_release");

    // Verify AuditLog and Outbox for released mode
    const audit = await prisma.auditLog.findFirst({
      orderBy: { occurredAt: "desc" },
      where: {
        action: "conversation.automation_mode_updated",
        entityId: humanConv.id,
        tenantId: tenantAId,
      },
    });
    expect(audit).toBeDefined();
    expect((audit?.afterSummary as Record<string, unknown>)?.automationMode).toBe("AUTO");

    const outbox = await prisma.domainEventOutbox.findFirst({
      orderBy: { occurredAt: "desc" },
      where: {
        aggregateId: humanConv.id,
        eventType: "conversation.automation_mode_updated",
        tenantId: tenantAId,
      },
    });
    expect(outbox).toBeDefined();
    expect((outbox?.payload as Record<string, unknown>)?.newMode).toBe("AUTO");
    expect((outbox?.payload as Record<string, unknown>)?.previousMode).toBe("HUMAN");
    expect((outbox?.payload as Record<string, unknown>)?.reason).toBe(
      "inactivity_release",
    );
  });

  it("enforces strict A/B tenant isolation: Tenant A processing does not touch Tenant B conversations", async () => {
    const tenantA = createTenantContext(tenantAId);
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);

    const convTenantB = await prisma.conversation.create({
      data: {
        automationMode: "HUMAN",
        channelAccountId: channelBId,
        contactId: contactBId,
        createdAt: threeHoursAgo,
        lastMessageAt: threeHoursAgo,
        status: "open",
        tenantId: tenantBId,
      },
    });

    const result = await inactivityManager.processInactivityTimeouts(tenantA, {
      inactivityMinutes: 60,
      releaseTakeoverMinutes: 30,
    });

    expect(result.processedConversationIds).not.toContain(convTenantB.id);

    const freshConvB = await prisma.conversation.findUniqueOrThrow({
      where: { id: convTenantB.id },
    });
    expect(freshConvB.status).toBe("open");
    expect(freshConvB.automationMode).toBe("HUMAN");
  });
});
