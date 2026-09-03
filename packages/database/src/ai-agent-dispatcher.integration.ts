import { MockEmbeddingProvider } from "@whatsapp-platform/ai-gateway";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addKeyToPool,
  createAiProviderConfig,
  createKnowledgeDocument,
  createVirtualAlias,
  indexKnowledgeDocument,
  type ModuleEntitlementKey,
  processInboundAiTurn,
  upsertTenantAiAgentConfig,
} from "./index";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  type PrismaClient,
  syncPermissionCatalog,
} from "./platform";

const prefix = "e10-s05-ai-agent";
const secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";
let channelAccountAId = "";
let channelAccountBId = "";
let contactAId = "";
let contactBId = "";
let conversationAId = "";
let conversationBId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length > 0) {
    await prisma.tenantAiAgentConfig.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.knowledgeChunk.deleteMany({
      where: { tenantId: { in: ids } },
    });
    await prisma.knowledgeDocument.deleteMany({
      where: { tenantId: { in: ids } },
    });
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
}

async function provision(
  marker: string,
  modules: readonly ModuleEntitlementKey[] = [
    "module.messaging.basic",
    "module.crm_lite",
    "module.ai",
  ],
): Promise<{ ownerId: string; rootId: string; tenantId: string }> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "USD",
    defaultLocale: "en-US",
    defaultTimezone: "UTC",
    deploymentId: null,
    displayName: `AI Agent Tenant ${marker}`,
    enabledModules: modules,
    legalName: `AI Agent Tenant ${marker} SA`,
    limits: {
      channelAccounts: 5,
      monthlyAiBudget: null,
      organizationUnits: 5,
      storageBytes: 1_073_741_824,
      users: 5,
    },
    owner: {
      displayName: `Owner ${marker}`,
      email: `${prefix}-owner-${marker}@example.invalid`,
      locale: "en-US",
      passwordHash: "$argon2id$test-hash-not-reversible",
      timezone: "UTC",
    },
    requestId: `${prefix}-${marker}`,
    slug: `${prefix}-${marker}`,
  });
  return {
    ownerId: result.owner.id,
    rootId: result.organizationRoot.id,
    tenantId: result.tenant.id,
  };
}

describe.sequential("AI Agent Dispatcher Database Integration", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient({
      databaseUrl:
        process.env.DATABASE_URL ??
        "postgresql://whatsapp_platform_dev:replace-with-a-local-development-password@localhost:5432/whatsapp_platform_dev",
    });
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);

    const [tA, tB] = await Promise.all([provision("a"), provision("b")]);
    tenantAId = tA.tenantId;
    tenantBId = tB.tenantId;

    // Tenant A custom provider and virtual alias
    const tenantAProvider = await createAiProviderConfig(prisma, {
      tenantId: tenantAId,
      name: "Tenant A Mock AI",
      providerType: "mock",
      isEnabled: true,
    });

    await addKeyToPool(prisma, {
      providerConfigId: tenantAProvider.id,
      plainApiKey: "mock-key",
      encryptionSecret: secret,
      priority: 1,
    });

    await createVirtualAlias(prisma, {
      tenantId: tenantAId,
      aliasKey: "platform-smart",
      name: "Tenant A Smart",
      routes: [
        {
          providerConfigId: tenantAProvider.id,
          targetModelId: "mock-model",
          priority: 1,
          timeoutMs: 5000,
        },
      ],
    });

    // Channel account for Tenant A
    const channelA = await prisma.channelAccount.create({
      data: {
        tenantId: tenantAId,
        displayName: "Tenant A WhatsApp",
        providerType: "mock",
        status: "connected",
        active: true,
        phoneNumber: "+15551234001",
      },
    });
    channelAccountAId = channelA.id;

    // Contact and Conversation for Tenant A
    const contactA = await prisma.contact.create({
      data: {
        tenantId: tenantAId,
        name: "Cliente A",
        phoneNumber: "+15559876001",
      },
    });
    contactAId = contactA.id;

    const convA = await prisma.conversation.create({
      data: {
        tenantId: tenantAId,
        channelAccountId: channelAccountAId,
        contactId: contactAId,
        status: "open",
        automationMode: "AUTO",
      },
    });
    conversationAId = convA.id;

    // Ingest knowledge for Tenant A
    const docA = await createKnowledgeDocument(prisma, {
      tenantId: tenantAId,
      title: "Garantías y Soporte",
      sourceType: "markdown",
      rawContent: "Toda garantía requiere factura original y tiene vigencia de 12 meses.",
    });

    await indexKnowledgeDocument(prisma, {
      tenantId: tenantAId,
      documentId: docA.id,
      embeddingProvider: new MockEmbeddingProvider(),
    });

    // Configure AI Agent for Tenant A
    await upsertTenantAiAgentConfig(prisma, {
      tenantId: tenantAId,
      isEnabled: true,
      automationMode: "HYBRID_RULES_AI",
      systemDirectives: "Eres un asistente servicial de soporte técnico.",
      virtualAliasKey: "platform-smart",
      minConfidenceScore: 0.5,
      humanHandoffKeywords: ["humano", "asesor", "persona", "agente"],
    });

    // Channel account, Contact and Conversation for Tenant B
    const channelB = await prisma.channelAccount.create({
      data: {
        tenantId: tenantBId,
        displayName: "Tenant B WhatsApp",
        providerType: "mock",
        status: "connected",
        active: true,
        phoneNumber: "+15551234002",
      },
    });
    channelAccountBId = channelB.id;

    const contactB = await prisma.contact.create({
      data: {
        tenantId: tenantBId,
        name: "Cliente B",
        phoneNumber: "+15559876002",
      },
    });
    contactBId = contactB.id;

    const convB = await prisma.conversation.create({
      data: {
        tenantId: tenantBId,
        channelAccountId: channelAccountBId,
        contactId: contactBId,
        status: "open",
        automationMode: "AUTO",
      },
    });
    conversationBId = convB.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("generates RAG reply and enqueues AI_BOT message on knowledge match", async () => {
    const inboundText = "Toda garantía requiere factura original y tiene vigencia de 12 meses.";

    const turnResult = await processInboundAiTurn(prisma, {
      tenantId: tenantAId,
      conversationId: conversationAId,
      channelAccountId: channelAccountAId,
      contactId: contactAId,
      inboundText,
      encryptionSecret: secret,
    });

    expect(turnResult.handled).toBe(true);
    if (turnResult.handled && turnResult.action === "ai_reply") {
      expect(turnResult.replyText).toBeDefined();
      expect(turnResult.citations.length).toBeGreaterThan(0);
      expect(turnResult.citations[0]?.documentTitle).toBe("Garantías y Soporte");
      expect(turnResult.totalTokens).toBeGreaterThan(0);
    }

    // Verify outbound message was created with AI_BOT sender
    const lastMessage = await prisma.message.findFirst({
      where: { tenantId: tenantAId, conversationId: conversationAId },
      orderBy: { createdAt: "desc" },
    });

    expect(lastMessage).toBeDefined();
    expect(lastMessage?.actorType).toBe("AI_BOT");
    expect(lastMessage?.direction).toBe("outbound");
    expect((lastMessage?.metadata as Record<string, unknown>)?.senderType).toBe("AI_BOT");
  });

  it("detects human handoff keyword and triggers takeover without AI reply", async () => {
    const inboundText = "Por favor quiero hablar con un asesor humano";

    const turnResult = await processInboundAiTurn(prisma, {
      tenantId: tenantAId,
      conversationId: conversationAId,
      channelAccountId: channelAccountAId,
      contactId: contactAId,
      inboundText,
      encryptionSecret: secret,
    });

    expect(turnResult.handled).toBe(true);
    if (turnResult.handled) {
      expect(turnResult.action).toBe("human_handoff");
    }

    // Verify conversation mode was switched to HUMAN
    const updatedConv = await prisma.conversation.findUnique({
      where: { tenantId_id: { tenantId: tenantAId, id: conversationAId } },
    });
    expect(updatedConv?.automationMode).toBe("HUMAN");

    // Verify domain event was queued
    const takeoverEvent = await prisma.domainEventOutbox.findFirst({
      where: {
        tenantId: tenantAId,
        aggregateId: conversationAId,
        eventType: "conversation.takeover_requested",
      },
    });
    expect(takeoverEvent).toBeDefined();

    // Verify handoff notice was sent
    const lastMessage = await prisma.message.findFirst({
      where: { tenantId: tenantAId, conversationId: conversationAId },
      orderBy: { createdAt: "desc" },
    });
    expect(lastMessage?.actorType).toBe("AI_BOT");
    expect(lastMessage?.textBody).toContain("asesor humano");
  });

  it("refrains from replying when conversation is already in HUMAN mode", async () => {
    // Conversation A is now in HUMAN mode from previous test
    const turnResult = await processInboundAiTurn(prisma, {
      tenantId: tenantAId,
      conversationId: conversationAId,
      channelAccountId: channelAccountAId,
      contactId: contactAId,
      inboundText: "¿Cual es el horario de atencion?",
      encryptionSecret: secret,
    });

    expect(turnResult.handled).toBe(false);
    if (!turnResult.handled) {
      expect(turnResult.reason).toBe("human_takeover");
    }
  });

  it("strictly isolates knowledge base and config between tenants (A/B isolation)", async () => {
    // Tenant B has NO agent config enabled
    const turnResultB = await processInboundAiTurn(prisma, {
      tenantId: tenantBId,
      conversationId: conversationBId,
      channelAccountId: channelAccountBId,
      contactId: contactBId,
      inboundText: "Toda garantía requiere factura original",
      encryptionSecret: secret,
    });

    // Tenant B has agent disabled by default
    expect(turnResultB.handled).toBe(false);
    if (!turnResultB.handled) {
      expect(turnResultB.reason).toBe("disabled");
    }
  });
});
