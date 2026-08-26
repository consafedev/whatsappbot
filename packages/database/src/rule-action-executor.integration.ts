import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";
import {
  executeRuleActions,
  RuleActionContactNotFoundError,
  RuleActionConversationNotFoundError,
  RuleActionInvalidStateTransitionError,
  RuleActionUserNotFoundError,
  type RuleExecutionContext,
} from "./rule-action-executor";
import type { RuleItem } from "./rule-catalog-manager";
import { createTenantContext } from "./tenant-context";

const prefix = "e08-s03-actions-db";
const metadata = { actorUserId: "e08-s03-actor", requestId: `${prefix}-request` };
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";
let rootAId = "";
let rootBId = "";
let channelAId = "";
let channelBId = "";
let userAId = "";
let userBId = "";
let unitAId = "";
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
  await prisma.rule.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.message.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.contact.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.outboundMessage.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.inboundMessageEvent.deleteMany({ where: { tenantId: { in: ids } } });
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
    displayName: `Action Tenant ${marker}`,
    enabledModules: ["module.messaging.basic", "module.crm_lite", "module.automation.basic"],
    legalName: `Action Tenant ${marker} SA`,
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
      locale: "es-MX",
      passwordHash: "$argon2id$test-hash-not-reversible",
      timezone: "America/Mexico_City",
    },
    requestId: `${prefix}-${marker}`,
    slug: `${prefix}-${marker}`,
  });
  return { id: result.tenant.id, rootId: result.organizationRoot.id };
}

describe("RuleActionExecutor (integration)", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await syncPermissionCatalog(prisma);
    await cleanup();

    const provA = await provision("a");
    const provB = await provision("b");
    tenantAId = provA.id;
    rootAId = provA.rootId;
    tenantBId = provB.id;
    rootBId = provB.rootId;

    // Create active users
    const userA = await prisma.user.create({
      data: {
        displayName: "Agent Alice",
        email: `${prefix}-user-a@test.local`,
        locale: "es-MX",
        passwordHash: "hash-a",
        status: "active",
        tenantId: tenantAId,
        timezone: "America/Mexico_City",
      },
    });
    userAId = userA.id;

    const userB = await prisma.user.create({
      data: {
        displayName: "Agent Bob",
        email: `${prefix}-user-b@test.local`,
        locale: "es-MX",
        passwordHash: "hash-b",
        status: "active",
        tenantId: tenantBId,
        timezone: "America/Mexico_City",
      },
    });
    userBId = userB.id;

    // Create sub organization unit for A
    const unitA = await prisma.organizationUnit.create({
      data: {
        name: "Sales Unit A",
        parentId: rootAId,
        tenantId: tenantAId,
        type: "department",
      },
    });
    unitAId = unitA.id;

    // Create channel accounts
    const channelA = await prisma.channelAccount.create({
      data: {
        active: true,
        credentialsCiphertext: "cipher-a",
        credentialsKeyVersion: 1,
        displayName: "Main WA A",
        organizationUnitId: rootAId,
        phoneNumber: "+5215500000001",
        providerType: "mock",
        status: "ACTIVE",
        tenantId: tenantAId,
      },
    });
    channelAId = channelA.id;

    const channelB = await prisma.channelAccount.create({
      data: {
        active: true,
        credentialsCiphertext: "cipher-b",
        credentialsKeyVersion: 1,
        displayName: "Main WA B",
        organizationUnitId: rootBId,
        phoneNumber: "+5215500000002",
        providerType: "mock",
        status: "ACTIVE",
        tenantId: tenantBId,
      },
    });
    channelBId = channelB.id;

    // Create contacts
    const contactA = await prisma.contact.create({
      data: {
        customAttributes: { initialTier: "basic", vipFlag: false },
        name: "Carlos Rivera",
        phoneNumber: "+5215511111111",
        status: "ACTIVE",
        tags: ["lead"],
        tenantId: tenantAId,
      },
    });
    contactAId = contactA.id;

    const contactB = await prisma.contact.create({
      data: {
        customAttributes: {},
        name: "Diana Prince",
        phoneNumber: "+5215522222222",
        status: "ACTIVE",
        tags: ["prospect"],
        tenantId: tenantBId,
      },
    });
    contactBId = contactB.id;

    // Create conversations
    const convA = await prisma.conversation.create({
      data: {
        automationMode: "AUTO",
        channelAccountId: channelAId,
        contactId: contactAId,
        status: "new",
        tenantId: tenantAId,
      },
    });
    conversationAId = convA.id;

    const convB = await prisma.conversation.create({
      data: {
        automationMode: "AUTO",
        channelAccountId: channelBId,
        contactId: contactBId,
        status: "new",
        tenantId: tenantBId,
      },
    });
    conversationBId = convB.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("executes SEND_MESSAGE: creates Message, OutboundMessage, and emits message.queued", async () => {
    const tenantCtx = createTenantContext(tenantAId);

    const rule: RuleItem = {
      actions: [
        {
          actionType: "SEND_MESSAGE",
          parameters: {
            textBody:
              "Hola {{contact.name}}, hemos recibido su mensaje en el canal {{channel.providerType}}.",
          },
        },
      ],
      channelAccountId: channelAId,
      conditions: [],
      cooldownSeconds: 0,
      createdAt: new Date(),
      description: "Auto welcome message",
      executionMode: "first_match_stop",
      id: "019532bb-9543-7f2a-89a3-c59828d50001",
      name: "Welcome Rule",
      organizationUnitId: null,
      priority: 100,
      status: "active",
      tenantId: tenantAId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date(),
    };

    // Prepare rule in db for update timestamp
    await prisma.rule.create({
      data: {
        actions: rule.actions as Prisma.InputJsonValue,
        channelAccountId: channelAId,
        conditions: [],
        cooldownSeconds: 0,
        description: rule.description,
        executionMode: rule.executionMode,
        id: rule.id,
        name: rule.name,
        priority: rule.priority,
        status: rule.status,
        tenantId: tenantAId,
        triggerType: rule.triggerType,
      },
    });

    const context: RuleExecutionContext = {
      channel: { channelAccountId: channelAId, providerType: "whatsapp_cloud" },
      channelAccountId: channelAId,
      contact: { name: "Carlos Rivera", phoneNumber: "+5215511111111" },
      contactId: contactAId,
      conversation: { status: "new" },
      conversationId: conversationAId,
      now: new Date("2026-08-25T18:00:00Z"),
    };

    const result = await executeRuleActions(tenantCtx, rule, context, prisma, metadata);

    expect(result.success).toBe(true);
    expect(result.actionsApplied).toEqual(["SEND_MESSAGE"]);

    // Verify Message in DB
    const message = await prisma.message.findFirst({
      where: { conversationId: conversationAId, tenantId: tenantAId },
    });
    expect(message).not.toBeNull();
    expect(message?.direction).toBe("outbound");
    expect(message?.origin).toBe("automation");
    expect(message?.actorType).toBe("system");
    expect(message?.deliveryStatus).toBe("queued");
    expect(message?.textBody).toBe(
      "Hola Carlos Rivera, hemos recibido su mensaje en el canal whatsapp_cloud.",
    );

    // Verify OutboundMessage in DB
    const outbound = await prisma.outboundMessage.findFirst({
      where: { channelAccountId: channelAId, tenantId: tenantAId },
    });
    expect(outbound).not.toBeNull();
    expect(outbound?.status).toBe("QUEUED");
    expect(outbound?.recipientPhone).toBe("+5215511111111");

    // Verify Outbox
    expect(message).not.toBeNull();
    if (!message) throw new Error("Message not found");
    const outbox = await prisma.domainEventOutbox.findFirst({
      where: {
        aggregateId: message.id,
        eventType: "message.queued",
        tenantId: tenantAId,
      },
    });
    expect(outbox).not.toBeNull();
  });

  it("executes ASSIGN_USER and ASSIGN_ORGANIZATION_UNIT on conversation", async () => {
    const tenantCtx = createTenantContext(tenantAId);

    const rule: RuleItem = {
      actions: [
        { actionType: "ASSIGN_USER", parameters: { userId: userAId } },
        { actionType: "ASSIGN_ORGANIZATION_UNIT", parameters: { unitId: unitAId } },
      ],
      channelAccountId: null,
      conditions: [],
      cooldownSeconds: 0,
      createdAt: new Date(),
      description: null,
      executionMode: "first_match_stop",
      id: "019532bb-9543-7f2a-89a3-c59828d50002",
      name: "Assign Rule",
      organizationUnitId: null,
      priority: 200,
      status: "active",
      tenantId: tenantAId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date(),
    };

    await prisma.rule.create({
      data: {
        actions: rule.actions as Prisma.InputJsonValue,
        conditions: [],
        id: rule.id,
        name: rule.name,
        priority: rule.priority,
        status: rule.status,
        tenantId: tenantAId,
        triggerType: rule.triggerType,
      },
    });

    const context: RuleExecutionContext = {
      conversationId: conversationAId,
    };

    const result = await executeRuleActions(tenantCtx, rule, context, prisma, metadata);

    expect(result.success).toBe(true);
    expect(result.actionsApplied).toEqual(["ASSIGN_USER", "ASSIGN_ORGANIZATION_UNIT"]);

    const conv = await prisma.conversation.findUnique({
      where: { id: conversationAId },
    });
    expect(conv?.assignedUserId).toBe(userAId);
    expect(conv?.assignedUnitId).toBe(unitAId);

    // Verify outbox
    const assignmentOutbox = await prisma.domainEventOutbox.findMany({
      where: {
        aggregateId: conversationAId,
        eventType: "conversation.assigned",
        tenantId: tenantAId,
      },
    });
    expect(assignmentOutbox.length).toBeGreaterThanOrEqual(2);
  });

  it("executes CHANGE_CONVERSATION_STATUS respecting lifecycle transitions", async () => {
    const tenantCtx = createTenantContext(tenantAId);

    const ruleOpen: RuleItem = {
      actions: [{ actionType: "CHANGE_CONVERSATION_STATUS", parameters: { status: "open" } }],
      channelAccountId: null,
      conditions: [],
      cooldownSeconds: 0,
      createdAt: new Date(),
      description: null,
      executionMode: "first_match_stop",
      id: "019532bb-9543-7f2a-89a3-c59828d50003",
      name: "Open Conversation",
      organizationUnitId: null,
      priority: 300,
      status: "active",
      tenantId: tenantAId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date(),
    };

    await prisma.rule.create({
      data: {
        actions: ruleOpen.actions as Prisma.InputJsonValue,
        conditions: [],
        id: ruleOpen.id,
        name: ruleOpen.name,
        priority: ruleOpen.priority,
        status: ruleOpen.status,
        tenantId: tenantAId,
        triggerType: ruleOpen.triggerType,
      },
    });

    const result = await executeRuleActions(
      tenantCtx,
      ruleOpen,
      { conversationId: conversationAId },
      prisma,
      metadata,
    );

    expect(result.success).toBe(true);
    expect(result.actionsApplied).toEqual(["CHANGE_CONVERSATION_STATUS"]);

    const conv = await prisma.conversation.findUnique({ where: { id: conversationAId } });
    expect(conv?.status).toBe("open");
  });

  it("executes ADD_CONTACT_TAG, REMOVE_CONTACT_TAG and SET_CONTACT_CUSTOM_ATTRIBUTE", async () => {
    const tenantCtx = createTenantContext(tenantAId);

    const rule: RuleItem = {
      actions: [
        { actionType: "ADD_CONTACT_TAG", parameters: { tag: "vip" } },
        { actionType: "ADD_CONTACT_TAG", parameters: { tag: "b2b_customer" } },
        { actionType: "REMOVE_CONTACT_TAG", parameters: { tag: "lead" } },
        {
          actionType: "SET_CONTACT_CUSTOM_ATTRIBUTE",
          parameters: { key: "planTier", value: "enterprise" },
        },
      ],
      channelAccountId: null,
      conditions: [],
      cooldownSeconds: 0,
      createdAt: new Date(),
      description: null,
      executionMode: "first_match_stop",
      id: "019532bb-9543-7f2a-89a3-c59828d50004",
      name: "Tag and Attribute Rule",
      organizationUnitId: null,
      priority: 400,
      status: "active",
      tenantId: tenantAId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date(),
    };

    await prisma.rule.create({
      data: {
        actions: rule.actions as Prisma.InputJsonValue,
        conditions: [],
        id: rule.id,
        name: rule.name,
        priority: rule.priority,
        status: rule.status,
        tenantId: tenantAId,
        triggerType: rule.triggerType,
      },
    });

    const result = await executeRuleActions(
      tenantCtx,
      rule,
      { contactId: contactAId },
      prisma,
      metadata,
    );

    expect(result.success).toBe(true);
    expect(result.actionsApplied).toEqual([
      "ADD_CONTACT_TAG",
      "ADD_CONTACT_TAG",
      "REMOVE_CONTACT_TAG",
      "SET_CONTACT_CUSTOM_ATTRIBUTE",
    ]);

    const contact = await prisma.contact.findUnique({ where: { id: contactAId } });
    expect(contact?.tags).toContain("vip");
    expect(contact?.tags).toContain("b2b_customer");
    expect(contact?.tags).not.toContain("lead");
    const customAttrs = (contact?.customAttributes ?? {}) as Record<string, unknown>;
    expect(customAttrs.planTier).toBe("enterprise");
    expect(customAttrs.initialTier).toBe("basic"); // preserved
  });

  it("executes SET_AUTOMATION_MODE on conversation", async () => {
    const tenantCtx = createTenantContext(tenantAId);

    const rule: RuleItem = {
      actions: [{ actionType: "SET_AUTOMATION_MODE", parameters: { mode: "HUMAN" } }],
      channelAccountId: null,
      conditions: [],
      cooldownSeconds: 0,
      createdAt: new Date(),
      description: null,
      executionMode: "first_match_stop",
      id: "019532bb-9543-7f2a-89a3-c59828d50005",
      name: "Takeover Rule",
      organizationUnitId: null,
      priority: 500,
      status: "active",
      tenantId: tenantAId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date(),
    };

    await prisma.rule.create({
      data: {
        actions: rule.actions as Prisma.InputJsonValue,
        conditions: [],
        id: rule.id,
        name: rule.name,
        priority: rule.priority,
        status: rule.status,
        tenantId: tenantAId,
        triggerType: rule.triggerType,
      },
    });

    const result = await executeRuleActions(
      tenantCtx,
      rule,
      { conversationId: conversationAId },
      prisma,
      metadata,
    );

    expect(result.success).toBe(true);
    expect(result.actionsApplied).toEqual(["SET_AUTOMATION_MODE"]);

    const conv = await prisma.conversation.findUnique({ where: { id: conversationAId } });
    expect(conv?.automationMode).toBe("HUMAN");
  });

  it("enforces strict A/B Tenant Isolation: Tenant A rule cannot mutate Tenant B conversation or contact", async () => {
    const tenantCtxA = createTenantContext(tenantAId);

    const ruleA: RuleItem = {
      actions: [{ actionType: "ADD_CONTACT_TAG", parameters: { tag: "cross_tenant_tag" } }],
      channelAccountId: null,
      conditions: [],
      cooldownSeconds: 0,
      createdAt: new Date(),
      description: null,
      executionMode: "first_match_stop",
      id: "019532bb-9543-7f2a-89a3-c59828d50006",
      name: "Cross Tenant Attack",
      organizationUnitId: null,
      priority: 600,
      status: "active",
      tenantId: tenantAId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date(),
    };

    await prisma.rule.create({
      data: {
        actions: ruleA.actions as Prisma.InputJsonValue,
        conditions: [],
        id: ruleA.id,
        name: ruleA.name,
        priority: ruleA.priority,
        status: ruleA.status,
        tenantId: tenantAId,
        triggerType: ruleA.triggerType,
      },
    });

    // Attempt to target Contact B with Tenant A context
    await expect(
      executeRuleActions(tenantCtxA, ruleA, { contactId: contactBId }, prisma, metadata),
    ).rejects.toThrow(RuleActionContactNotFoundError);

    // Attempt to target Conversation B with Tenant A context
    await expect(
      executeRuleActions(tenantCtxA, ruleA, { conversationId: conversationBId }, prisma, metadata),
    ).rejects.toThrow(RuleActionConversationNotFoundError);

    // Verify Contact B and Conversation B remain untouched
    const contactB = await prisma.contact.findUnique({ where: { id: contactBId } });
    expect(contactB?.tags).not.toContain("cross_tenant_tag");
    const convB = await prisma.conversation.findUnique({ where: { id: conversationBId } });
    expect(convB?.status).toBe("new");
  });

  it("rolls back all operations atomically when an action in the pipeline fails", async () => {
    const tenantCtx = createTenantContext(tenantAId);

    const initialContact = await prisma.contact.findUnique({ where: { id: contactAId } });
    const initialTags = initialContact?.tags ?? [];

    const failingRule: RuleItem = {
      actions: [
        { actionType: "ADD_CONTACT_TAG", parameters: { tag: "temporary_tag" } },
        { actionType: "ASSIGN_USER", parameters: { userId: userBId } }, // User B belongs to Tenant B!
      ],
      channelAccountId: null,
      conditions: [],
      cooldownSeconds: 0,
      createdAt: new Date(),
      description: null,
      executionMode: "first_match_stop",
      id: "019532bb-9543-7f2a-89a3-c59828d50007",
      name: "Failing Rule",
      organizationUnitId: null,
      priority: 700,
      status: "active",
      tenantId: tenantAId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date(),
    };

    await prisma.rule.create({
      data: {
        actions: failingRule.actions as Prisma.InputJsonValue,
        conditions: [],
        id: failingRule.id,
        name: failingRule.name,
        priority: failingRule.priority,
        status: failingRule.status,
        tenantId: tenantAId,
        triggerType: failingRule.triggerType,
      },
    });

    await expect(
      executeRuleActions(
        tenantCtx,
        failingRule,
        { contactId: contactAId, conversationId: conversationAId },
        prisma,
        metadata,
      ),
    ).rejects.toThrow(RuleActionUserNotFoundError);

    // Verify rollback: temporary_tag was NOT added to Contact A
    const refreshedContact = await prisma.contact.findUnique({ where: { id: contactAId } });
    expect(refreshedContact?.tags).toEqual(initialTags);
  });

  it("rejects invalid state transition on conversation", async () => {
    const tenantCtx = createTenantContext(tenantAId);

    // Close conversation first
    await prisma.conversation.update({
      where: { id: conversationAId },
      data: { status: "closed" },
    });

    const invalidTransitionRule: RuleItem = {
      actions: [
        { actionType: "CHANGE_CONVERSATION_STATUS", parameters: { status: "pending" } }, // closed -> pending is invalid
      ],
      channelAccountId: null,
      conditions: [],
      cooldownSeconds: 0,
      createdAt: new Date(),
      description: null,
      executionMode: "first_match_stop",
      id: "019532bb-9543-7f2a-89a3-c59828d50008",
      name: "Invalid Transition",
      organizationUnitId: null,
      priority: 800,
      status: "active",
      tenantId: tenantAId,
      triggerType: "ON_MESSAGE_RECEIVED",
      updatedAt: new Date(),
    };

    await prisma.rule.create({
      data: {
        actions: invalidTransitionRule.actions as Prisma.InputJsonValue,
        conditions: [],
        id: invalidTransitionRule.id,
        name: invalidTransitionRule.name,
        priority: invalidTransitionRule.priority,
        status: invalidTransitionRule.status,
        tenantId: tenantAId,
        triggerType: invalidTransitionRule.triggerType,
      },
    });

    await expect(
      executeRuleActions(
        tenantCtx,
        invalidTransitionRule,
        { conversationId: conversationAId },
        prisma,
        metadata,
      ),
    ).rejects.toThrow(RuleActionInvalidStateTransitionError);
  });
});
