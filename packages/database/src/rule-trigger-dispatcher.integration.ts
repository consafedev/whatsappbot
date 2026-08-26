import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/prisma/client";
import {
  createInboundEventDispatcher,
  type InboundEventDispatcher,
} from "./inbound-event-dispatcher";
import { createInboundEventManager, type InboundEventManager } from "./inbound-event-manager";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e08-s04-dispatcher-db";
let prisma: PrismaClient;
let inboundEvents: InboundEventManager;
let dispatcher: InboundEventDispatcher;
let tenantAId = "";
let tenantBId = "";
let rootAId = "";
let rootBId = "";
let channelAId = "";
let channelBId = "";
let userAId = "";
let _userBId = "";
let contactAId = "";
let _contactBId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length === 0) return;

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
    displayName: `Rule Trigger Tenant ${marker}`,
    enabledModules: ["module.messaging.basic", "module.crm_lite", "module.automation.basic"],
    legalName: `Rule Trigger Tenant ${marker} SA`,
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

describe.sequential("RuleTriggerDispatcher (PostgreSQL integration)", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);

    const provA = await provision("a");
    const provB = await provision("b");
    tenantAId = provA.id;
    rootAId = provA.rootId;
    tenantBId = provB.id;
    rootBId = provB.rootId;

    const userA = await prisma.user.create({
      data: {
        displayName: "Operator Alice",
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
        displayName: "Operator Bob",
        email: `${prefix}-user-b@test.local`,
        locale: "es-MX",
        passwordHash: "hash-b",
        status: "active",
        tenantId: tenantBId,
        timezone: "America/Mexico_City",
      },
    });
    _userBId = userB.id;

    const channelA = await prisma.channelAccount.create({
      data: {
        active: true,
        credentialsCiphertext: "cipher-a",
        credentialsKeyVersion: 1,
        displayName: "Channel A",
        organizationUnitId: rootAId,
        phoneNumber: "+525500000001",
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
        displayName: "Channel B",
        organizationUnitId: rootBId,
        phoneNumber: "+525500000002",
        providerType: "mock",
        status: "ACTIVE",
        tenantId: tenantBId,
      },
    });
    channelBId = channelB.id;

    const contactA = await prisma.contact.create({
      data: {
        customAttributes: { vip: true },
        name: "Carlos Rivera",
        phoneNumber: "+525511111111",
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
        phoneNumber: "+525522222222",
        status: "ACTIVE",
        tags: ["prospect"],
        tenantId: tenantBId,
      },
    });
    _contactBId = contactB.id;

    inboundEvents = createInboundEventManager(prisma);
    dispatcher = createInboundEventDispatcher(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma?.$disconnect();
  });

  it("inbound message triggers ON_MESSAGE_RECEIVED rule and sends automated reply (SEND_MESSAGE)", async () => {
    // Create rule for Tenant A
    const rule = await prisma.rule.create({
      data: {
        actions: [
          {
            actionType: "SEND_MESSAGE",
            parameters: {
              text: "Hola {{contact.name}}, recibimos tu solicitud de cotizacion.",
            },
          },
        ],
        channelAccountId: channelAId,
        conditions: [
          {
            field: "message.textBody",
            operator: "CONTAINS",
            value: "cotizacion",
          },
        ],
        cooldownSeconds: 0,
        executionMode: "first_match_stop",
        name: "Auto-reply Quote",
        priority: 10,
        status: "active",
        tenantId: tenantAId,
        triggerType: "ON_MESSAGE_RECEIVED",
      },
    });

    // Record and dispatch inbound message event
    const recorded = await inboundEvents.recordInboundEvent(createTenantContext(tenantAId), {
      channelAccountId: channelAId,
      eventType: "MESSAGE_RECEIVED",
      normalizedData: {
        fromMe: false,
        textBody: "Hola deseo una cotizacion de servicios",
      },
      payload: {
        body: "Hola deseo una cotizacion de servicios",
      },
      providerMessageId: "msg-inbound-quote-1",
      senderPhone: "+525511111111",
    });

    const dispatchResult = await dispatcher.dispatch(createTenantContext(tenantAId), {
      inboundEventId: recorded.event.id,
    });

    expect(dispatchResult.kind).toBe("inbound");
    if (dispatchResult.kind === "inbound") {
      expect(dispatchResult.result.duplicate).toBe(false);
      expect(dispatchResult.ruleDispatchResults).toBeDefined();
      const messageTriggerResult = dispatchResult.ruleDispatchResults?.find(
        (r) => r.triggerType === "ON_MESSAGE_RECEIVED",
      );
      expect(messageTriggerResult?.rulesExecuted).toBe(1);
      expect(messageTriggerResult?.results[0]?.ruleId).toBe(rule.id);
      expect(messageTriggerResult?.results[0]?.actionsApplied).toContain("SEND_MESSAGE");
    }

    // Verify outbound message was created and queued
    const outboundMessages = await prisma.outboundMessage.findMany({
      where: {
        channelAccountId: channelAId,
        recipientPhone: "+525511111111",
        tenantId: tenantAId,
      },
    });
    expect(outboundMessages.length).toBe(1);
    expect(outboundMessages[0]?.status).toBe("QUEUED");

    // Verify canonical Message
    const canonicalMessages = await prisma.message.findMany({
      where: {
        direction: "outbound",
        origin: "automation",
        tenantId: tenantAId,
      },
    });
    expect(canonicalMessages.length).toBe(1);
    expect(canonicalMessages[0]?.actorType).toBe("system");
    expect(canonicalMessages[0]?.deliveryStatus).toBe("queued");
    expect(canonicalMessages[0]?.textBody).toBe(
      "Hola Carlos Rivera, recibimos tu solicitud de cotizacion.",
    );

    // Verify Outbox: message.queued and rule.executed
    const outboxEvents = await prisma.domainEventOutbox.findMany({
      where: {
        tenantId: tenantAId,
      },
    });
    const eventTypes = outboxEvents.map((e) => e.eventType);
    expect(eventTypes).toContain("message.queued");
    expect(eventTypes).toContain("rule.executed");

    // Verify AuditLog: rule.executed
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        action: "rule.executed",
        entityId: rule.id,
        tenantId: tenantAId,
      },
    });
    expect(auditLogs.length).toBe(1);
  });

  it("inbound message updates contact tags (ADD_CONTACT_TAG) and assigns operator (ASSIGN_USER)", async () => {
    const _rule = await prisma.rule.create({
      data: {
        actions: [
          {
            actionType: "ADD_CONTACT_TAG",
            parameters: { tag: "soporte-urgente" },
          },
          {
            actionType: "ASSIGN_USER",
            parameters: { userId: userAId },
          },
        ],
        channelAccountId: null,
        conditions: [
          {
            field: "message.textBody",
            operator: "CONTAINS",
            value: "urgente",
          },
        ],
        cooldownSeconds: 0,
        executionMode: "evaluate_all",
        name: "Urgent Support Routing",
        priority: 5,
        status: "active",
        tenantId: tenantAId,
        triggerType: "ON_MESSAGE_RECEIVED",
      },
    });

    const recorded = await inboundEvents.recordInboundEvent(createTenantContext(tenantAId), {
      channelAccountId: channelAId,
      eventType: "MESSAGE_RECEIVED",
      normalizedData: {
        fromMe: false,
        textBody: "Requiero ayuda urgente con mi cuenta",
      },
      payload: {
        body: "Requiero ayuda urgente con mi cuenta",
      },
      providerMessageId: "msg-inbound-urgent-1",
      senderPhone: "+525511111111",
    });

    const dispatchResult = await dispatcher.dispatch(createTenantContext(tenantAId), {
      inboundEventId: recorded.event.id,
    });

    expect(dispatchResult.kind).toBe("inbound");

    // Check contact tags
    const contact = await prisma.contact.findUniqueOrThrow({
      where: { id: contactAId },
    });
    expect(contact.tags).toContain("soporte-urgente");

    // Check conversation assigned user
    if (dispatchResult.kind === "inbound") {
      const conv = await prisma.conversation.findUniqueOrThrow({
        where: { id: dispatchResult.result.conversationId },
      });
      expect(conv.assignedUserId).toBe(userAId);
    }
  });

  it("multi-tenancy isolation: Tenant A inbound message does not trigger Tenant B rules or mutate Tenant B data", async () => {
    // Create rule for Tenant B
    const ruleB = await prisma.rule.create({
      data: {
        actions: [
          {
            actionType: "SEND_MESSAGE",
            parameters: { text: "Respuesta de Tenant B" },
          },
        ],
        channelAccountId: channelBId,
        conditions: [],
        cooldownSeconds: 0,
        executionMode: "first_match_stop",
        name: "Catch-all Tenant B",
        priority: 10,
        status: "active",
        tenantId: tenantBId,
        triggerType: "ON_MESSAGE_RECEIVED",
      },
    });

    // Inbound event arrives for Tenant A
    const recordedA = await inboundEvents.recordInboundEvent(createTenantContext(tenantAId), {
      channelAccountId: channelAId,
      eventType: "MESSAGE_RECEIVED",
      normalizedData: {
        fromMe: false,
        textBody: "Mensaje normal para Tenant A",
      },
      payload: {
        body: "Mensaje normal para Tenant A",
      },
      providerMessageId: "msg-tenant-a-iso-1",
      senderPhone: "+525511111111",
    });

    await dispatcher.dispatch(createTenantContext(tenantAId), {
      inboundEventId: recordedA.event.id,
    });

    // Verify Tenant B has 0 outbound messages
    const outboundB = await prisma.outboundMessage.findMany({
      where: { tenantId: tenantBId },
    });
    expect(outboundB.length).toBe(0);

    // Verify Tenant B rule audit log was never created
    const auditLogsB = await prisma.auditLog.findMany({
      where: { entityId: ruleB.id, tenantId: tenantBId },
    });
    expect(auditLogsB.length).toBe(0);
  });

  it("blocks automatic rules when conversation is in HUMAN mode", async () => {
    // Put conversation into HUMAN mode
    const contact = await prisma.contact.create({
      data: {
        name: "Human Mode User",
        phoneNumber: "+525599998888",
        tenantId: tenantAId,
      },
    });

    const _conversation = await prisma.conversation.create({
      data: {
        automationMode: "HUMAN",
        channelAccountId: channelAId,
        contactId: contact.id,
        status: "open",
        tenantId: tenantAId,
      },
    });

    const _rule = await prisma.rule.create({
      data: {
        actions: [
          {
            actionType: "SEND_MESSAGE",
            parameters: { text: "No debería enviarse porque está en HUMAN mode" },
          },
        ],
        channelAccountId: null,
        conditions: [],
        cooldownSeconds: 0,
        executionMode: "first_match_stop",
        name: "Bot Auto-Reply",
        priority: 1,
        status: "active",
        tenantId: tenantAId,
        triggerType: "ON_MESSAGE_RECEIVED",
      },
    });

    const recorded = await inboundEvents.recordInboundEvent(createTenantContext(tenantAId), {
      channelAccountId: channelAId,
      eventType: "MESSAGE_RECEIVED",
      normalizedData: {
        fromMe: false,
        textBody: "Hola bot",
      },
      payload: {
        body: "Hola bot",
      },
      providerMessageId: "msg-human-mode-test-1",
      senderPhone: "+525599998888",
    });

    const dispatchResult = await dispatcher.dispatch(createTenantContext(tenantAId), {
      inboundEventId: recorded.event.id,
    });

    expect(dispatchResult.kind).toBe("inbound");
    if (dispatchResult.kind === "inbound") {
      expect(dispatchResult.result.duplicate).toBe(false);
      // No rules executed
      const executed = dispatchResult.ruleDispatchResults?.some((r) => r.rulesExecuted > 0);
      expect(executed).toBeFalsy();
    }

    // Verify no outbound message was queued for this recipient
    const outbound = await prisma.outboundMessage.findMany({
      where: {
        recipientPhone: "+525599998888",
        tenantId: tenantAId,
      },
    });
    expect(outbound.length).toBe(0);
  });

  it("triggers ON_CONVERSATION_CREATED and ON_MESSAGE_RECEIVED on first message of new conversation", async () => {
    // Rule for ON_CONVERSATION_CREATED
    const ruleCreated = await prisma.rule.create({
      data: {
        actions: [
          {
            actionType: "ADD_CONTACT_TAG",
            parameters: { tag: "new-customer" },
          },
        ],
        channelAccountId: null,
        conditions: [],
        cooldownSeconds: 0,
        executionMode: "first_match_stop",
        name: "Tag New Conversation",
        priority: 10,
        status: "active",
        tenantId: tenantAId,
        triggerType: "ON_CONVERSATION_CREATED",
      },
    });

    // Rule for ON_MESSAGE_RECEIVED
    const ruleReceived = await prisma.rule.create({
      data: {
        actions: [
          {
            actionType: "SEND_MESSAGE",
            parameters: { text: "Bienvenido a nuestro servicio!" },
          },
        ],
        channelAccountId: null,
        conditions: [
          {
            field: "message.textBody",
            operator: "CONTAINS",
            value: "nuevo cliente",
          },
        ],
        cooldownSeconds: 0,
        executionMode: "first_match_stop",
        name: "Welcome Auto-Reply",
        priority: 0,
        status: "active",
        tenantId: tenantAId,
        triggerType: "ON_MESSAGE_RECEIVED",
      },
    });

    const newSenderPhone = "+525577776666";

    const recorded = await inboundEvents.recordInboundEvent(createTenantContext(tenantAId), {
      channelAccountId: channelAId,
      eventType: "MESSAGE_RECEIVED",
      normalizedData: {
        fromMe: false,
        textBody: "Hola soy nuevo cliente",
      },
      payload: {
        body: "Hola soy nuevo cliente",
      },
      providerMessageId: "msg-new-conv-trigger-1",
      senderPhone: newSenderPhone,
    });

    const dispatchResult = await dispatcher.dispatch(createTenantContext(tenantAId), {
      inboundEventId: recorded.event.id,
    });

    expect(dispatchResult.kind).toBe("inbound");
    if (dispatchResult.kind === "inbound") {
      expect(dispatchResult.result.isNewConversation).toBe(true);
      expect(dispatchResult.ruleDispatchResults?.length).toBe(2);
      const createdTriggerRes = dispatchResult.ruleDispatchResults?.find(
        (r) => r.triggerType === "ON_CONVERSATION_CREATED",
      );
      const receivedTriggerRes = dispatchResult.ruleDispatchResults?.find(
        (r) => r.triggerType === "ON_MESSAGE_RECEIVED",
      );
      expect(createdTriggerRes?.rulesExecuted).toBe(1);
      expect(createdTriggerRes?.results[0]?.ruleId).toBe(ruleCreated.id);
      expect(receivedTriggerRes?.rulesExecuted).toBe(1);
      expect(receivedTriggerRes?.results[0]?.ruleId).toBe(ruleReceived.id);
    }

    // Verify contact has 'new-customer' tag
    const contact = await prisma.contact.findFirstOrThrow({
      where: { phoneNumber: newSenderPhone, tenantId: tenantAId },
    });
    expect(contact.tags).toContain("new-customer");

    // Verify welcome message was queued
    const outbound = await prisma.outboundMessage.findMany({
      where: {
        recipientPhone: newSenderPhone,
        tenantId: tenantAId,
      },
    });
    expect(outbound.length).toBe(1);
  });
});
