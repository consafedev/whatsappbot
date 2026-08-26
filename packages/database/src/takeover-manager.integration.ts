import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/prisma/client";
import {
  ConversationNotFoundError,
  createExternalHumanMessageManager,
  createOutboundConversationMessageManager,
  createTakeoverManager,
  type ExternalHumanMessageManager,
  type OutboundConversationMessageManager,
  type TakeoverManager,
} from "./index";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e08-s05-takeover-db";
let prisma: PrismaClient;
let takeoverManager: TakeoverManager;
let outboundManager: OutboundConversationMessageManager;
let externalHumanManager: ExternalHumanMessageManager;

let tenantAId = "";
let tenantBId = "";
let ownerAId = "";
let channelAId = "";
let channelBId = "";
let contactAId = "";
let conversationAId = "";
let conversationBId = "";

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
    displayName: `Takeover ${marker}`,
    enabledModules: ["module.messaging.basic", "module.crm_lite", "module.automation.basic"],
    legalName: `Takeover ${marker} SA`,
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

describe.sequential("E08-S05 takeover manager integration", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);

    takeoverManager = createTakeoverManager(prisma);
    outboundManager = createOutboundConversationMessageManager(prisma);
    externalHumanManager = createExternalHumanMessageManager(prisma);

    const [tenantA, tenantB] = await Promise.all([provision("a"), provision("b")]);
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;
    ownerAId = tenantA.ownerId;

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

    const [convA, convB] = await Promise.all([
      prisma.conversation.create({
        data: {
          automationMode: "AUTO",
          channelAccountId: channelAId,
          contactId: contactAId,
          status: "open",
          tenantId: tenantAId,
        },
      }),
      prisma.conversation.create({
        data: {
          automationMode: "AUTO",
          channelAccountId: channelBId,
          contactId: contactB.id,
          status: "open",
          tenantId: tenantBId,
        },
      }),
    ]);
    conversationAId = convA.id;
    conversationBId = convB.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("performs manual mode transitions AUTO -> HUMAN -> AUTO with metadata and outbox events", async () => {
    const tenantA = createTenantContext(tenantAId);

    // 1. Transition to HUMAN
    const humanConv = await takeoverManager.setConversationAutomationMode(
      tenantA,
      conversationAId,
      ownerAId,
      "HUMAN",
      "agent_takeover",
      "req-manual-human",
    );

    expect(humanConv.automationMode).toBe("HUMAN");
    const metaHuman = humanConv.metadata as Record<string, unknown>;
    expect(metaHuman.automationPausedAt).toBeDefined();
    expect(metaHuman.automationPausedReason).toBe("agent_takeover");

    const auditHuman = await prisma.auditLog.findFirst({
      where: {
        action: "conversation.automation_mode_updated",
        entityId: conversationAId,
        tenantId: tenantAId,
      },
      orderBy: { occurredAt: "desc" },
    });
    expect(auditHuman).toBeDefined();
    expect((auditHuman?.afterSummary as Record<string, unknown>)?.automationMode).toBe("HUMAN");

    const outboxHuman = await prisma.domainEventOutbox.findFirst({
      where: {
        aggregateId: conversationAId,
        eventType: "conversation.automation_mode_updated",
        tenantId: tenantAId,
      },
      orderBy: { occurredAt: "desc" },
    });
    expect(outboxHuman).toBeDefined();
    expect((outboxHuman?.payload as Record<string, unknown>)?.newMode).toBe("HUMAN");
    expect((outboxHuman?.payload as Record<string, unknown>)?.previousMode).toBe("AUTO");

    // 2. Transition back to AUTO
    const autoConv = await takeoverManager.setConversationAutomationMode(
      tenantA,
      conversationAId,
      ownerAId,
      "AUTO",
      undefined,
      "req-manual-auto",
    );

    expect(autoConv.automationMode).toBe("AUTO");
    const metaAuto = autoConv.metadata as Record<string, unknown>;
    expect(metaAuto.automationPausedAt).toBeNull();
    expect(metaAuto.automationPausedReason).toBeNull();

    const outboxAuto = await prisma.domainEventOutbox.findFirst({
      where: {
        aggregateId: conversationAId,
        eventType: "conversation.automation_mode_updated",
        tenantId: tenantAId,
      },
      orderBy: { occurredAt: "desc" },
    });
    expect((outboxAuto?.payload as Record<string, unknown>)?.newMode).toBe("AUTO");
    expect((outboxAuto?.payload as Record<string, unknown>)?.previousMode).toBe("HUMAN");
  });

  it("automatically pauses automation (AUTO -> HUMAN) when an agent sends a reply from dashboard", async () => {
    const tenantA = createTenantContext(tenantAId);

    // Ensure conversation is in AUTO mode
    await prisma.conversation.update({
      data: {
        automationMode: "AUTO",
        metadata: {},
      },
      where: { id: conversationAId },
    });

    const sendResult = await outboundManager.sendConversationMessage(tenantA, conversationAId, {
      actorUserId: ownerAId,
      content: { text: "Hola, te atiende un asesor humano." },
      messageType: "text",
      requestId: "req-agent-reply-takeover",
    });

    expect(sendResult.duplicate).toBe(false);

    const updatedConv = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationAId },
    });
    expect(updatedConv.automationMode).toBe("HUMAN");
    const meta = updatedConv.metadata as Record<string, unknown>;
    expect(meta.automationPausedAt).toBeDefined();
    expect(meta.automationPausedReason).toBe("agent_reply");

    const takeoverOutbox = await prisma.domainEventOutbox.findFirst({
      where: {
        aggregateId: conversationAId,
        eventType: "conversation.automation_mode_updated",
        tenantId: tenantAId,
      },
      orderBy: { occurredAt: "desc" },
    });
    expect((takeoverOutbox?.payload as Record<string, unknown>)?.newMode).toBe("HUMAN");
    expect((takeoverOutbox?.payload as Record<string, unknown>)?.reason).toBe("agent_reply");
  });

  it("automatically pauses automation (AUTO -> HUMAN) when external human message is detected on WhatsApp", async () => {
    const tenantA = createTenantContext(tenantAId);

    // Reset conversation to AUTO mode
    await prisma.conversation.update({
      data: {
        automationMode: "AUTO",
        metadata: {},
      },
      where: { id: conversationAId },
    });

    const inboundEvent = await prisma.inboundMessageEvent.create({
      data: {
        channelAccountId: channelAId,
        eventType: "MESSAGE_RECEIVED",
        messageType: "text",
        normalizedData: {
          fromMe: true,
          origin: "human_external_device",
          recipientPhone: "+525511111111",
          textBody: "Mensaje escrito desde celular por operador",
        },
        payload: { fromMe: true },
        processedStatus: "PENDING",
        providerMessageId: "msg-ext-takeover-001",
        recipientPhone: "+525511111111",
        tenantId: tenantAId,
      },
    });

    const reconcileResult = await externalHumanManager.reconcileExternalHumanMessage(tenantA, {
      channelAccountId: channelAId,
      inboundEventId: inboundEvent.id,
      providerMessageId: "msg-ext-takeover-001",
      providerTimestamp: new Date(),
      recipientPhone: "+525511111111",
      textBody: "Mensaje escrito desde celular por operador",
    });

    expect(reconcileResult.duplicate).toBe(false);

    const updatedConv = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationAId },
    });
    expect(updatedConv.automationMode).toBe("HUMAN");
    const meta = updatedConv.metadata as Record<string, unknown>;
    expect(meta.automationPausedAt).toBeDefined();
    expect(meta.automationPausedReason).toBe("external_human_reply");
  });

  it("enforces strict A/B isolation: Tenant A cannot toggle automation mode of Tenant B conversation", async () => {
    const tenantA = createTenantContext(tenantAId);

    await expect(
      takeoverManager.setConversationAutomationMode(
        tenantA,
        conversationBId,
        ownerAId,
        "HUMAN",
        "cross_tenant_attempt",
      ),
    ).rejects.toThrow(ConversationNotFoundError);
  });
});
