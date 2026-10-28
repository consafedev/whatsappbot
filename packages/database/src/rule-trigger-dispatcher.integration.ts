import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/prisma/client";
import {
  createInboundEventDispatcher,
  type InboundEventDispatcher,
  selectAppointmentBookingRouteFromRules,
} from "./inbound-event-dispatcher";
import { createInboundEventManager, type InboundEventManager } from "./inbound-event-manager";
import { createInboundMessageManager } from "./inbound-message-manager";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";
import type { RuleItem } from "./rule-catalog-manager";
import { dispatchRuleTriggers } from "./rule-trigger-dispatcher";
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
let serviceAId = "";
let resourceAId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length === 0) return;

  await prisma.appointmentBookingTurn.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentBookingFlow.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.rule.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.message.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.contact.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.outboundMessage.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentAvailabilityException.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentAvailabilityRule.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentService.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentResource.deleteMany({ where: { tenantId: { in: ids } } });
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
    enabledModules: [
      "module.messaging.basic",
      "module.crm_lite",
      "module.automation.basic",
      "module.appointments",
    ],
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

    const [serviceA, resourceA] = await Promise.all([
      prisma.appointmentService.create({
        data: {
          durationMinutes: 30,
          name: "Rule booking service",
          organizationUnitId: rootAId,
          tenantId: tenantAId,
        },
      }),
      prisma.appointmentResource.create({
        data: {
          name: "Rule booking resource",
          organizationUnitId: rootAId,
          tenantId: tenantAId,
        },
      }),
    ]);
    serviceAId = serviceA.id;
    resourceAId = resourceA.id;
    await prisma.appointmentAvailabilityRule.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        tenantId: tenantAId,
        resourceId: resourceAId,
        serviceId: serviceAId,
        dayOfWeek,
        startTime: "00:00",
        endTime: "23:59",
        timezone: "America/Mexico_City",
        capacity: 1,
      })),
    });

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

  it("lets an earlier image-scoped legacy rule claim media messages before booking", async () => {
    await prisma.rule.updateMany({ where: { tenantId: tenantAId }, data: { status: "inactive" } });
    const imageLegacyRule = await prisma.rule.create({
      data: {
        actions: [{ actionType: "SEND_MESSAGE", parameters: { text: "Received image" } }],
        conditions: [{ field: "message.mediaType", operator: "EQUALS", value: "image" }],
        cooldownSeconds: 0,
        executionMode: "first_match_stop",
        name: "Legacy image receiver before booking",
        priority: 1,
        status: "active",
        tenantId: tenantAId,
        triggerType: "ON_MESSAGE_RECEIVED",
      },
    });
    const imageBookingRule = await prisma.rule.create({
      data: {
        actions: [
          {
            actionType: "start_appointment_booking",
            parameters: { resourceIds: [resourceAId], serviceIds: [serviceAId] },
          },
        ],
        conditions: [],
        cooldownSeconds: 0,
        executionMode: "first_match_stop",
        name: "Later image booking candidate",
        priority: 2,
        status: "active",
        tenantId: tenantAId,
        triggerType: "ON_MESSAGE_RECEIVED",
      },
    });

    const recorded = await inboundEvents.recordInboundEvent(createTenantContext(tenantAId), {
      channelAccountId: channelAId,
      eventType: "MESSAGE_RECEIVED",
      messageType: "image",
      normalizedData: { fromMe: false, messageType: "image", textBody: "photo" },
      payload: { body: "photo", messageType: "image" },
      providerMessageId: "msg-booking-route-image-legacy",
      senderPhone: "+525588887779",
    });
    const result = await dispatcher.dispatch(createTenantContext(tenantAId), {
      inboundEventId: recorded.event.id,
    });

    expect(result.kind).toBe("inbound");
    const canonicalMessage = await prisma.message.findFirstOrThrow({
      where: { inboundEventId: recorded.event.id, tenantId: tenantAId },
    });
    expect(canonicalMessage).toMatchObject({
      direction: "inbound",
      messageType: "image",
      origin: "customer",
    });
    await expect(
      prisma.appointmentBookingTurn.findUniqueOrThrow({
        where: {
          tenantId_inboundMessageId: {
            inboundMessageId: canonicalMessage.id,
            tenantId: tenantAId,
          },
        },
      }),
    ).resolves.toMatchObject({ route: "LEGACY" });
    expect(
      await prisma.outboundMessage.count({
        where: { recipientPhone: "+525588887779", tenantId: tenantAId },
      }),
    ).toBe(1);
    expect(await prisma.appointmentBookingFlow.count({ where: { tenantId: tenantAId } })).toBe(0);
    await prisma.rule.updateMany({
      data: { status: "inactive" },
      where: { id: { in: [imageLegacyRule.id, imageBookingRule.id] }, tenantId: tenantAId },
    });
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

  it("does not execute an appointment-booking action through generic rule dispatch", async () => {
    await prisma.rule.updateMany({ where: { tenantId: tenantAId }, data: { status: "inactive" } });
    const bookingContact = await prisma.contact.create({
      data: { name: "Booking Router Guard", phoneNumber: "+525588887777", tenantId: tenantAId },
    });
    const conversation = await prisma.conversation.create({
      data: {
        automationMode: "AUTO",
        channelAccountId: channelAId,
        contactId: bookingContact.id,
        status: "open",
        tenantId: tenantAId,
      },
    });
    const rule = await prisma.rule.create({
      data: {
        actions: [{ actionType: "start_appointment_booking", parameters: {} }],
        conditions: [],
        cooldownSeconds: 0,
        executionMode: "first_match_stop",
        name: "Booking action must use persisted inbound router",
        priority: 1,
        status: "active",
        tenantId: tenantAId,
        triggerType: "ON_MESSAGE_RECEIVED",
      },
    });

    const result = await dispatchRuleTriggers(
      createTenantContext(tenantAId),
      "ON_MESSAGE_RECEIVED",
      {
        channelAccountId: channelAId,
        conversation: { automationMode: "AUTO", status: "open" },
        conversationId: conversation.id,
        contactId: bookingContact.id,
        message: {
          direction: "inbound",
          mediaType: null,
          origin: "customer",
          textBody: "reservar",
        },
      },
      prisma,
    );

    expect(result.rulesExecuted).toBe(0);
    expect(result.results).toHaveLength(0);
    expect(
      await prisma.outboundMessage.count({
        where: { recipientPhone: "+525588887777", tenantId: tenantAId },
      }),
    ).toBe(0);
    expect(await prisma.rule.findUniqueOrThrow({ where: { id: rule.id } })).toMatchObject({
      updatedAt: rule.updatedAt,
    });
  });

  it("routes new customer messages before legacy actions and keeps duplicates out of echo reconciliation", async () => {
    await prisma.rule.updateMany({ where: { tenantId: tenantAId }, data: { status: "inactive" } });
    const creationRule = await prisma.rule.create({
      data: {
        actions: [{ actionType: "SEND_MESSAGE", parameters: { text: "Welcome response" } }],
        conditions: [{ field: "message.textBody", operator: "CONTAINS", value: "WELCOME" }],
        cooldownSeconds: 0,
        executionMode: "first_match_stop",
        name: "Legacy creation rule wins before booking",
        priority: 1,
        status: "active",
        tenantId: tenantAId,
        triggerType: "ON_CONVERSATION_CREATED",
      },
    });
    const bookingRule = await prisma.rule.create({
      data: {
        actions: [
          {
            actionType: "start_appointment_booking",
            parameters: { resourceIds: [resourceAId], serviceIds: [serviceAId] },
          },
        ],
        conditions: [{ field: "message.textBody", operator: "CONTAINS", value: "BOOK" }],
        cooldownSeconds: 0,
        executionMode: "first_match_stop",
        name: "Book only when no earlier legacy rule matches",
        priority: 10,
        status: "active",
        tenantId: tenantAId,
        triggerType: "ON_MESSAGE_RECEIVED",
      },
    });

    const recoveryPhone = "+525588887770";
    const recoveryEvent = await inboundEvents.recordInboundEvent(createTenantContext(tenantAId), {
      channelAccountId: channelAId,
      eventType: "MESSAGE_RECEIVED",
      normalizedData: { fromMe: false, textBody: "WELCOME retry" },
      payload: { body: "WELCOME retry" },
      providerMessageId: "msg-booking-route-recovery",
      senderPhone: recoveryPhone,
    });
    const messages = createInboundMessageManager(prisma);
    const persistedBeforeDispatch = await messages.persistInboundMessage(
      createTenantContext(tenantAId),
      { inboundEventId: recoveryEvent.event.id },
    );
    expect(persistedBeforeDispatch.duplicate).toBe(false);
    const recoveredLegacyDispatch = await dispatcher.dispatch(createTenantContext(tenantAId), {
      inboundEventId: recoveryEvent.event.id,
    });
    expect(recoveredLegacyDispatch.kind).toBe("inbound");
    if (recoveredLegacyDispatch.kind === "inbound") {
      expect(recoveredLegacyDispatch.result.duplicate).toBe(true);
    }
    const recoveryTurn = await prisma.appointmentBookingTurn.findUniqueOrThrow({
      where: {
        tenantId_inboundMessageId: {
          inboundMessageId: persistedBeforeDispatch.message.id,
          tenantId: tenantAId,
        },
      },
    });
    expect(recoveryTurn).toMatchObject({ createdNewConversation: true, route: "LEGACY" });
    expect(
      await prisma.outboundMessage.count({
        where: { recipientPhone: recoveryPhone, tenantId: tenantAId },
      }),
    ).toBe(1);
    await dispatcher.dispatch(createTenantContext(tenantAId), {
      inboundEventId: recoveryEvent.event.id,
    });
    expect(
      await prisma.outboundMessage.count({
        where: { recipientPhone: recoveryPhone, tenantId: tenantAId },
      }),
    ).toBe(1);

    const legacyPhone = "+525588887771";
    const legacyEvent = await inboundEvents.recordInboundEvent(createTenantContext(tenantAId), {
      channelAccountId: channelAId,
      eventType: "MESSAGE_RECEIVED",
      normalizedData: { fromMe: false, textBody: "WELCOME reservar" },
      payload: { body: "WELCOME reservar" },
      providerMessageId: "msg-booking-priority-legacy",
      senderPhone: legacyPhone,
    });
    const legacyResult = await dispatcher.dispatch(createTenantContext(tenantAId), {
      inboundEventId: legacyEvent.event.id,
    });
    expect(legacyResult.kind).toBe("inbound");
    const legacyMessage = await prisma.message.findFirstOrThrow({
      where: { inboundEventId: legacyEvent.event.id, tenantId: tenantAId },
    });
    await expect(
      prisma.appointmentBookingTurn.findUniqueOrThrow({
        where: {
          tenantId_inboundMessageId: { inboundMessageId: legacyMessage.id, tenantId: tenantAId },
        },
      }),
    ).resolves.toMatchObject({ route: "LEGACY" });
    expect(await prisma.appointmentBookingFlow.count({ where: { tenantId: tenantAId } })).toBe(0);
    expect(
      await prisma.outboundMessage.count({
        where: { recipientPhone: legacyPhone, tenantId: tenantAId },
      }),
    ).toBe(1);
    expect(creationRule.status).toBe("active");

    await prisma.appointmentBookingTurn.delete({
      where: {
        tenantId_inboundMessageId: { inboundMessageId: legacyMessage.id, tenantId: tenantAId },
      },
    });
    await prisma.rule.update({
      where: { id: bookingRule.id },
      data: { conditions: [{ field: "message.textBody", operator: "CONTAINS", value: "WELCOME" }] },
    });
    const preCutoverDuplicate = await dispatcher.dispatch(createTenantContext(tenantAId), {
      inboundEventId: legacyEvent.event.id,
    });
    expect(preCutoverDuplicate.kind).toBe("inbound");
    if (preCutoverDuplicate.kind === "inbound") {
      expect(preCutoverDuplicate.result.duplicate).toBe(true);
    }
    expect(await prisma.appointmentBookingFlow.count({ where: { tenantId: tenantAId } })).toBe(0);
    expect(
      await prisma.outboundMessage.count({
        where: { recipientPhone: legacyPhone, tenantId: tenantAId },
      }),
    ).toBe(1);

    const tieCreatedAt = new Date("2026-01-01T00:00:00.000Z");
    const tiedBookingRuleIds = [
      "019a0000-0000-7000-8000-0000000000f0",
      "019a0000-0000-7000-8000-0000000000f1",
    ];
    await prisma.rule.update({ where: { id: bookingRule.id }, data: { status: "inactive" } });
    await prisma.rule.createMany({
      data: tiedBookingRuleIds.map((id) => ({
        actions: [
          {
            actionType: "start_appointment_booking",
            parameters: { resourceIds: [resourceAId], serviceIds: [serviceAId] },
          },
        ],
        conditions: [{ field: "message.textBody", operator: "CONTAINS", value: "BOOK" }],
        cooldownSeconds: 0,
        createdAt: tieCreatedAt,
        executionMode: "first_match_stop",
        id,
        name: `Tied booking rule ${id.slice(-1)}`,
        priority: 10,
        status: "active",
        tenantId: tenantAId,
        triggerType: "ON_MESSAGE_RECEIVED",
      })),
    });
    const bookingPhone = "+525588887772";
    const bookingEvent = await inboundEvents.recordInboundEvent(createTenantContext(tenantAId), {
      channelAccountId: channelAId,
      eventType: "MESSAGE_RECEIVED",
      normalizedData: { fromMe: false, textBody: "BOOK reservar" },
      payload: { body: "BOOK reservar" },
      providerMessageId: "msg-booking-route-once",
      senderPhone: bookingPhone,
    });
    const firstBookingResult = await dispatcher.dispatch(createTenantContext(tenantAId), {
      inboundEventId: bookingEvent.event.id,
    });
    expect(firstBookingResult.kind).toBe("inbound");
    const bookingMessage = await prisma.message.findFirstOrThrow({
      where: { inboundEventId: bookingEvent.event.id, tenantId: tenantAId },
    });
    expect(bookingMessage.textBody).toBe("BOOK reservar");
    const bookingMessageContactId = bookingMessage.contactId;
    if (bookingMessageContactId === null) throw new Error("Expected inbound booking contact");
    const [bookingConversation, bookingContact, bookingChannel, activeBookingRules] =
      await Promise.all([
        prisma.conversation.findFirstOrThrow({
          where: { id: bookingMessage.conversationId, tenantId: tenantAId },
        }),
        prisma.contact.findFirstOrThrow({
          where: { id: bookingMessageContactId, tenantId: tenantAId },
        }),
        prisma.channelAccount.findFirstOrThrow({
          where: { id: channelAId, tenantId: tenantAId },
        }),
        prisma.rule.findMany({
          orderBy: [{ priority: "asc" }, { createdAt: "desc" }, { id: "desc" }],
          where: { status: "active", tenantId: tenantAId },
        }),
      ]);
    const storedTurn = await prisma.appointmentBookingTurn.findUniqueOrThrow({
      where: {
        tenantId_inboundMessageId: { inboundMessageId: bookingMessage.id, tenantId: tenantAId },
      },
    });
    expect(
      selectAppointmentBookingRouteFromRules(
        activeBookingRules as unknown as RuleItem[],
        {
          channel: { channelAccountId: channelAId, providerType: bookingChannel.providerType },
          channelAccountId: channelAId,
          contact: {
            customAttributes: {},
            ...(bookingContact.name === null ? {} : { name: bookingContact.name }),
            phoneNumber: bookingContact.phoneNumber,
            tags: bookingContact.tags,
          },
          contactId: bookingContact.id,
          conversation: {
            assignedUnitId: bookingConversation.assignedUnitId,
            assignedUserId: bookingConversation.assignedUserId,
            automationMode: bookingConversation.automationMode,
            humanTakeoverUntil: bookingConversation.humanTakeoverUntil,
            status: bookingConversation.status,
            unreadCount: 1,
          },
          conversationId: bookingConversation.id,
          message: {
            direction: "inbound",
            mediaType: null,
            origin: bookingMessage.origin,
            textBody: bookingMessage.textBody,
          },
          now: new Date(),
        },
        storedTurn.createdNewConversation,
      ),
    ).toMatchObject({ kind: "BOOKING", ruleId: tiedBookingRuleIds[1] });
    await expect(
      prisma.appointmentBookingTurn.findUniqueOrThrow({
        where: {
          tenantId_inboundMessageId: { inboundMessageId: bookingMessage.id, tenantId: tenantAId },
        },
      }),
    ).resolves.toMatchObject({ route: "BOOKING", originatingRuleId: tiedBookingRuleIds[1] });
    expect(await prisma.appointmentBookingFlow.count({ where: { tenantId: tenantAId } })).toBe(1);

    const duplicateBookingResult = await dispatcher.dispatch(createTenantContext(tenantAId), {
      inboundEventId: bookingEvent.event.id,
    });
    expect(duplicateBookingResult.kind).toBe("inbound");
    if (duplicateBookingResult.kind === "inbound") {
      expect(duplicateBookingResult.result.duplicate).toBe(true);
    }
    expect(await prisma.appointmentBookingFlow.count({ where: { tenantId: tenantAId } })).toBe(1);
    expect(
      await prisma.outboundMessage.count({
        where: { recipientPhone: bookingPhone, tenantId: tenantAId },
      }),
    ).toBe(1);
  });
});
