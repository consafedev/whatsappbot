import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAppointmentBookingTurnPlaceholderInTransaction,
  processPersistedBookingTurn,
} from "./appointment-booking-manager";
import {
  hashAppointmentBookingRuleDefinition,
  normalizeAppointmentBookingPolicy,
} from "./appointment-booking-policy";
import { selectAppointmentBookingRouteFromRules } from "./inbound-event-dispatcher";
import { createPlatformDatabaseClient, type PrismaClient } from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = `e14-s10-security-${crypto.randomUUID()}`;
let database: PrismaClient;
let tenantId = "";
let foreignTenantId = "";
let serviceId = "";
let resourceId = "";

type ConversationFixture = Readonly<{
  tenantId: string;
  channelAccountId: string;
  contactId: string;
  conversationId: string;
}>;

async function cleanup() {
  const tenants = await database.tenant.findMany({
    where: { slug: { startsWith: prefix } },
    select: { id: true },
  });
  const ids = tenants.map((row) => row.id);
  if (ids.length === 0) return;
  await database.message.deleteMany({ where: { tenantId: { in: ids } } });
  await database.outboundMessage.deleteMany({ where: { tenantId: { in: ids } } });
  await database.appointmentBookingTurn.deleteMany({ where: { tenantId: { in: ids } } });
  await database.appointmentBookingFlow.updateMany({
    where: { tenantId: { in: ids }, selectedAppointmentId: { not: null } },
    data: { selectedAppointmentId: null },
  });
  await database.appointment.deleteMany({ where: { tenantId: { in: ids } } });
  await database.appointmentBookingFlow.deleteMany({ where: { tenantId: { in: ids } } });
  await database.rule.deleteMany({ where: { tenantId: { in: ids } } });
  await database.conversation.deleteMany({ where: { tenantId: { in: ids } } });
  await database.channelAccount.deleteMany({ where: { tenantId: { in: ids } } });
  await database.appointmentAvailabilityRule.deleteMany({ where: { tenantId: { in: ids } } });
  await database.appointmentResource.deleteMany({ where: { tenantId: { in: ids } } });
  await database.appointmentService.deleteMany({ where: { tenantId: { in: ids } } });
  await database.contact.deleteMany({ where: { tenantId: { in: ids } } });
  await database.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
  await database.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await database.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await database.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await database.tenant.deleteMany({ where: { id: { in: ids } } });
}

async function conversationFixture(forTenant = tenantId): Promise<ConversationFixture> {
  const contact = await database.contact.create({
    data: {
      tenantId: forTenant,
      name: "Security fixture contact",
      phoneNumber: `+52${Date.now()}${Math.floor(Math.random() * 10000)}`,
    },
  });
  const channel = await database.channelAccount.create({
    data: {
      tenantId: forTenant,
      providerType: "test",
      displayName: "S10 security test",
      status: "connected",
      active: true,
    },
  });
  const conversation = await database.conversation.create({
    data: {
      tenantId: forTenant,
      channelAccountId: channel.id,
      contactId: contact.id,
      status: "open",
      automationMode: "AUTO",
    },
  });
  return {
    tenantId: forTenant,
    channelAccountId: channel.id,
    contactId: contact.id,
    conversationId: conversation.id,
  };
}

async function message(fixture: ConversationFixture, textBody: string, createdNew = false) {
  const row = await database.message.create({
    data: {
      tenantId: fixture.tenantId,
      conversationId: fixture.conversationId,
      channelAccountId: fixture.channelAccountId,
      contactId: fixture.contactId,
      direction: "inbound",
      origin: "provider",
      actorType: "customer",
      messageType: "text",
      textBody,
    },
  });
  await database.$transaction((transaction) =>
    createAppointmentBookingTurnPlaceholderInTransaction(
      createTenantContext(fixture.tenantId),
      transaction,
      row.id,
      createdNew,
    ),
  );
  return row;
}

async function createBookingRule(
  fixture: ConversationFixture,
  organizationUnitId?: string,
  reminderOffsetsMinutes?: readonly number[],
) {
  const policy = normalizeAppointmentBookingPolicy({
    serviceIds: [serviceId],
    resourceIds: [resourceId],
    ...(reminderOffsetsMinutes ? { reminderOffsetsMinutes } : {}),
  });
  const rule = await database.rule.create({
    data: {
      tenantId: fixture.tenantId,
      name: "S10 security booking rule",
      channelAccountId: fixture.channelAccountId,
      ...(organizationUnitId ? { organizationUnitId } : {}),
      triggerType: "ON_MESSAGE_RECEIVED",
      status: "active",
      executionMode: "first_match_stop",
      conditions: [],
      actions: [{ actionType: "start_appointment_booking", parameters: policy }],
    },
  });
  return { rule, policy };
}

function routeSelector(
  fixture: ConversationFixture,
): Parameters<typeof processPersistedBookingTurn>[3] {
  return async (transaction, inbound) => {
    const [conversation, contact, channel, rules] = await Promise.all([
      transaction.conversation.findFirst({
        where: { id: inbound.conversationId, tenantId: fixture.tenantId },
      }),
      transaction.contact.findFirst({
        where: { id: inbound.contactId, tenantId: fixture.tenantId },
      }),
      transaction.channelAccount.findFirst({
        where: { id: inbound.channelAccountId, tenantId: fixture.tenantId },
      }),
      transaction.rule.findMany({ where: { tenantId: fixture.tenantId } }),
    ]);
    if (!conversation || !contact || !channel) return { kind: "LEGACY" as const };
    return selectAppointmentBookingRouteFromRules(
      rules as never,
      {
        channel: { channelAccountId: channel.id, providerType: channel.providerType },
        channelAccountId: channel.id,
        contact: {
          customAttributes: contact.customAttributes ?? {},
          ...(contact.name ? { name: contact.name } : {}),
          phoneNumber: contact.phoneNumber,
          tags: contact.tags,
        },
        contactId: contact.id,
        conversation: {
          assignedUnitId: conversation.assignedUnitId,
          assignedUserId: conversation.assignedUserId,
          automationMode: conversation.automationMode,
          automationPausedReason:
            conversation.metadata && typeof conversation.metadata === "object"
              ? (conversation.metadata as Record<string, unknown>).automationPausedReason
              : null,
          humanTakeoverUntil: conversation.humanTakeoverUntil,
          status: conversation.status,
          unreadCount: 1,
        },
        conversationId: conversation.id,
        message: {
          direction: "inbound",
          mediaType: null,
          origin: "customer",
          textBody: inbound.textBody,
        },
        now: new Date(),
      } as never,
      inbound.createdNewConversation,
    );
  };
}

function persistedRuleSelector(
  fixture: ConversationFixture,
  ruleId: string,
): Parameters<typeof processPersistedBookingTurn>[3] {
  return async (transaction) => {
    const rule = await transaction.rule.findFirst({
      where: { id: ruleId, tenantId: fixture.tenantId, channelAccountId: fixture.channelAccountId },
    });
    if (
      rule?.status !== "active" ||
      rule.triggerType !== "ON_MESSAGE_RECEIVED" ||
      rule.executionMode !== "first_match_stop" ||
      !Array.isArray(rule.actions) ||
      rule.actions.length !== 1
    ) {
      return { kind: "LEGACY" as const };
    }
    const action = rule.actions[0];
    if (
      !action ||
      typeof action !== "object" ||
      !("actionType" in action) ||
      action.actionType !== "start_appointment_booking" ||
      !("parameters" in action)
    ) {
      return { kind: "LEGACY" as const };
    }
    return {
      kind: "BOOKING" as const,
      ruleId: rule.id,
      trigger: "ON_MESSAGE_RECEIVED" as const,
      policy: normalizeAppointmentBookingPolicy(action.parameters),
      policyHash: hashAppointmentBookingRuleDefinition(rule),
    };
  };
}

async function process(
  fixture: ConversationFixture,
  messageId: string,
  selector = routeSelector(fixture),
  dataSource: PrismaClient = database,
) {
  return processPersistedBookingTurn(
    createTenantContext(fixture.tenantId),
    dataSource as never,
    messageId,
    selector,
  );
}

async function proposal(fixture: ConversationFixture) {
  const { rule } = await createBookingRule(fixture);
  const start = await message(fixture, "Quiero reservar", true);
  const selector = persistedRuleSelector(fixture, rule.id);
  const started = await process(fixture, start.id, selector);
  if (started.route !== "BOOKING")
    throw new Error(`booking route was not selected: ${JSON.stringify(started)}`);
  await process(fixture, (await message(fixture, "1")).id, selector);
  await process(fixture, (await message(fixture, "1")).id, selector);
  const slot = await process(fixture, (await message(fixture, "1")).id, selector);
  if (!slot.outboundMessageId) throw new Error("slot selection did not create a proposal");
  const prompt = await database.message.findFirstOrThrow({
    where: { tenantId: fixture.tenantId, outboundMessageId: slot.outboundMessageId },
  });
  const token = prompt.textBody?.split("\n").at(-1)?.trim();
  if (!token?.startsWith("CONFIRM-"))
    throw new Error("confirmation token missing in persisted prompt");
  return { rule, token };
}

describe.sequential("E14-S10 PostgreSQL booking security and contention", () => {
  beforeAll(async () => {
    database = createPlatformDatabaseClient(loadDatabaseConfig());
    await database.$connect();
    await cleanup();
    const [tenant, foreign] = await Promise.all(
      ["a", "b"].map((suffix) =>
        database.tenant.create({
          data: {
            slug: `${prefix}-${suffix}`,
            status: "active",
            legalName: suffix,
            displayName: suffix,
            defaultTimezone: "UTC",
            defaultLocale: "es-MX",
            defaultCurrency: "MXN",
          },
        }),
      ),
    );
    if (!tenant || !foreign) throw new Error("S10 security tenant fixture failed");
    tenantId = tenant.id;
    foreignTenantId = foreign.id;
    await database.tenantEntitlement.createMany({
      data: [tenantId, foreignTenantId].flatMap((id) =>
        [
          "module.appointments",
          "module.automation.basic",
          "module.messaging.basic",
          "module.crm_lite",
          "module.scheduling",
        ].map((entitlementKey) => ({
          tenantId: id,
          entitlementKey,
          enabled: true,
          source: "contract" as const,
        })),
      ),
    });
    const service = await database.appointmentService.create({
      data: { tenantId, name: "S10 security service", durationMinutes: 30 },
    });
    const resource = await database.appointmentResource.create({
      data: { tenantId, name: "S10 security resource", capacity: 1 },
    });
    serviceId = service.id;
    resourceId = resource.id;
    await database.appointmentAvailabilityRule.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        tenantId,
        resourceId,
        dayOfWeek,
        startTime: "08:00",
        endTime: "12:00",
        timezone: "UTC",
        capacity: 1,
      })),
    });
  }, 60_000);

  afterAll(async () => {
    if (database) {
      await cleanup();
      await database.$disconnect();
    }
  }, 60_000);

  it("does not process a canonical message through a different tenant context", async () => {
    const foreign = await conversationFixture(foreignTenantId);
    await createBookingRule(foreign);
    const inbound = await message(foreign, "quiero reservar", true);
    let selectorCalls = 0;
    await expect(
      processPersistedBookingTurn(
        createTenantContext(tenantId),
        database as never,
        inbound.id,
        async () => {
          selectorCalls += 1;
          return { kind: "LEGACY" };
        },
      ),
    ).rejects.toThrow("Persisted inbound message context is missing");
    expect(selectorCalls).toBe(0);
    expect(
      await database.appointmentBookingFlow.count({ where: { tenantId: foreignTenantId } }),
    ).toBe(0);
  });

  it.each(["ASSISTED", "HUMAN", "MONITOR"] as const)(
    "does not start a booking while conversation mode is %s",
    async (mode) => {
      const fixture = await conversationFixture();
      await createBookingRule(fixture);
      await database.conversation.update({
        where: { tenantId_id: { tenantId, id: fixture.conversationId } },
        data: { automationMode: mode },
      });
      const inbound = await message(fixture, "quiero reservar", true);
      const result = await process(fixture, inbound.id);
      expect(result).toMatchObject({ route: "LEGACY", handled: false });
      expect(
        await database.appointmentBookingFlow.count({
          where: { tenantId, conversationId: fixture.conversationId },
        }),
      ).toBe(0);
      expect(
        await database.appointment.count({ where: { tenantId, contactId: fixture.contactId } }),
      ).toBe(0);
    },
  );

  it("does not start a booking during active human takeover or pause", async () => {
    for (const patch of [
      { humanTakeoverUntil: new Date(Date.now() + 60_000) },
      { metadata: { automationPausedReason: "manual_pause" } },
    ]) {
      const fixture = await conversationFixture();
      await createBookingRule(fixture);
      await database.conversation.update({
        where: { tenantId_id: { tenantId, id: fixture.conversationId } },
        data: patch,
      });
      const result = await process(fixture, (await message(fixture, "quiero reservar", true)).id);
      expect(result).toMatchObject({ route: "LEGACY", handled: false });
      expect(
        await database.appointmentBookingFlow.count({
          where: { tenantId, conversationId: fixture.conversationId },
        }),
      ).toBe(0);
    }
  });

  it("rejects a unit-scoped booking rule when the conversation has no assigned unit", async () => {
    const fixture = await conversationFixture();
    const unit = await database.organizationUnit.create({
      data: { tenantId, name: "S10 scoped unit", type: "branch" },
    });
    await createBookingRule(fixture, unit.id);
    const inbound = await message(fixture, "quiero reservar", true);
    const result = await process(fixture, inbound.id);
    expect(result).toMatchObject({ route: "LEGACY", handled: false });
    expect(
      await database.appointmentBookingFlow.count({
        where: { tenantId, conversationId: fixture.conversationId },
      }),
    ).toBe(0);
  });

  it("rechecks mode, takeover, and pause before accepting a previously issued confirmation", async () => {
    const scenarios = [
      { automationMode: "ASSISTED" as const },
      { automationMode: "HUMAN" as const },
      { automationMode: "MONITOR" as const },
      { humanTakeoverUntil: new Date(Date.now() + 60_000) },
      { metadata: { automationPausedReason: "manual_pause" } },
    ];
    for (const patch of scenarios) {
      const fixture = await conversationFixture();
      const { token } = await proposal(fixture);
      await database.conversation.update({
        where: { tenantId_id: { tenantId, id: fixture.conversationId } },
        data: patch,
      });
      const result = await process(fixture, (await message(fixture, token)).id);
      expect(result).toMatchObject({ route: "LEGACY", handled: true, legacyShouldRun: false });
      expect(
        await database.appointment.count({ where: { tenantId, contactId: fixture.contactId } }),
      ).toBe(0);
    }
  });

  it("does not let another same-tenant contact continue a customer's active flow", async () => {
    const fixture = await conversationFixture();
    const { token } = await proposal(fixture);
    const flowBefore = await database.appointmentBookingFlow.findFirstOrThrow({
      where: { tenantId, conversationId: fixture.conversationId, closedAt: null },
    });
    const outboundBefore = await database.outboundMessage.count({
      where: { tenantId, channelAccountId: fixture.channelAccountId },
    });
    const other = await database.contact.create({
      data: {
        tenantId,
        name: "Different customer",
        phoneNumber: `+52${Date.now()}${Math.floor(Math.random() * 10000)}`,
      },
    });
    const forgedMessage = await database.message.create({
      data: {
        tenantId,
        conversationId: fixture.conversationId,
        channelAccountId: fixture.channelAccountId,
        contactId: other.id,
        direction: "inbound",
        origin: "provider",
        actorType: "customer",
        messageType: "text",
        textBody: token,
      },
    });
    await database.$transaction((transaction) =>
      createAppointmentBookingTurnPlaceholderInTransaction(
        createTenantContext(tenantId),
        transaction,
        forgedMessage.id,
        false,
      ),
    );
    const result = await process(fixture, forgedMessage.id);
    expect(result).toMatchObject({ route: "LEGACY", legacyShouldRun: false });
    expect(
      await database.appointment.count({ where: { tenantId, contactId: fixture.contactId } }),
    ).toBe(0);
    expect(
      await database.outboundMessage.count({
        where: { tenantId, channelAccountId: fixture.channelAccountId },
      }),
    ).toBe(outboundBefore);
    expect(
      await database.appointmentBookingFlow.findFirstOrThrow({
        where: { tenantId, conversationId: fixture.conversationId },
      }),
    ).toMatchObject({
      contactId: fixture.contactId,
      phase: flowBefore.phase,
      proposalVersion: flowBefore.proposalVersion,
      confirmationTokenHash: flowBefore.confirmationTokenHash,
      closedAt: null,
    });
  });

  it("keeps an invalid numeric BOOKING receipt immutable after a later valid phase", async () => {
    const fixture = await conversationFixture();
    const { rule } = await createBookingRule(fixture);
    const selector = persistedRuleSelector(fixture, rule.id);
    await process(fixture, (await message(fixture, "quiero reservar", true)).id, selector);
    const invalid = await message(fixture, "no es un número");
    const firstDelivery = await process(fixture, invalid.id, selector);
    const invalidReceipt = await database.appointmentBookingTurn.findUniqueOrThrow({
      where: { tenantId_inboundMessageId: { tenantId, inboundMessageId: invalid.id } },
    });
    expect(firstDelivery).toMatchObject({ route: "BOOKING", handled: true });
    expect(invalidReceipt).toMatchObject({ route: "BOOKING", outboundMessageId: null });

    await process(fixture, (await message(fixture, "1")).id, selector);
    const phaseAfterValidInput = (
      await database.appointmentBookingFlow.findFirstOrThrow({
        where: { tenantId, conversationId: fixture.conversationId, closedAt: null },
      })
    ).phase;
    const outboundCountBeforeReplay = await database.message.count({
      where: { tenantId, conversationId: fixture.conversationId, direction: "outbound" },
    });
    const duplicate = await process(fixture, invalid.id, selector);
    expect(duplicate).toMatchObject({ duplicate: true, route: "BOOKING" });
    expect(
      (
        await database.appointmentBookingFlow.findFirstOrThrow({
          where: { tenantId, conversationId: fixture.conversationId, closedAt: null },
        })
      ).phase,
    ).toBe(phaseAfterValidInput);
    expect(
      await database.message.count({
        where: { tenantId, conversationId: fixture.conversationId, direction: "outbound" },
      }),
    ).toBe(outboundCountBeforeReplay);
  });

  it("SALIR closes the flow and stale CONFIRM input is consumed without starting another flow", async () => {
    const fixture = await conversationFixture();
    const { token } = await proposal(fixture);
    const exit = await message(fixture, "SALIR");
    const exited = await process(fixture, exit.id);
    expect(exited).toMatchObject({ route: "BOOKING", handled: true, legacyShouldRun: false });
    const closed = await database.appointmentBookingFlow.findFirstOrThrow({
      where: { tenantId, conversationId: fixture.conversationId },
    });
    expect(closed).toMatchObject({ closedAt: expect.any(Date), phase: "CANCELLED" });

    const duplicateExit = await process(fixture, exit.id);
    expect(duplicateExit).toMatchObject({ duplicate: true, route: "BOOKING" });
    const stale = await process(fixture, (await message(fixture, token)).id);
    expect(stale.legacyShouldRun).toBe(false);
    expect(
      await database.appointmentBookingFlow.count({
        where: { tenantId, conversationId: fixture.conversationId, closedAt: null },
      }),
    ).toBe(0);
    expect(
      await database.appointment.count({ where: { tenantId, contactId: fixture.contactId } }),
    ).toBe(0);
  });

  it("cancels an offered proposal when the live rule channel scope changes", async () => {
    const fixture = await conversationFixture();
    const { rule, token } = await proposal(fixture);
    const differentChannel = await database.channelAccount.create({
      data: {
        tenantId,
        providerType: "test",
        displayName: "S10 other channel scope",
        status: "connected",
        active: true,
      },
    });
    await database.rule.update({
      where: { tenantId_id: { tenantId, id: rule.id } },
      data: { channelAccountId: differentChannel.id },
    });
    const result = await process(fixture, (await message(fixture, token)).id);
    expect(result).toMatchObject({ route: "BOOKING", handled: true, legacyShouldRun: false });
    expect(
      await database.appointmentBookingFlow.count({
        where: { tenantId, conversationId: fixture.conversationId, closedAt: null },
      }),
    ).toBe(0);
    expect(
      await database.appointment.count({ where: { tenantId, contactId: fixture.contactId } }),
    ).toBe(0);
  });

  it("rolls back booking flow, receipt, audit, outbox, appointment, and outbound together after an outbox fault", async () => {
    const fixture = await conversationFixture();
    const { token } = await proposal(fixture);
    const confirmation = await message(fixture, token);
    const flowBefore = await database.appointmentBookingFlow.findFirstOrThrow({
      where: { tenantId, conversationId: fixture.conversationId, closedAt: null },
    });
    const turnBefore = await database.appointmentBookingTurn.findUniqueOrThrow({
      where: { tenantId_inboundMessageId: { tenantId, inboundMessageId: confirmation.id } },
    });
    const [appointmentsBefore, outboundsBefore, auditsBefore, outboxBefore] = await Promise.all([
      database.appointment.count({ where: { tenantId, bookingFlowId: flowBefore.id } }),
      database.message.count({
        where: { tenantId, conversationId: fixture.conversationId, direction: "outbound" },
      }),
      database.auditLog.count({ where: { tenantId } }),
      database.domainEventOutbox.count({ where: { tenantId } }),
    ]);
    expect(turnBefore).toMatchObject({
      route: "UNDECIDED",
      flowId: null,
      outboundMessageId: null,
      appointmentId: null,
    });

    const triggerSuffix = fixture.tenantId.replaceAll("-", "");
    const functionName = `e14_s10_reject_outbox_${triggerSuffix}`;
    const triggerName = `e14_s10_booking_outbox_${triggerSuffix}`;
    if (!/^[0-9a-f-]{36}$/i.test(fixture.tenantId)) {
      throw new Error("test fixture tenant id was not a UUID");
    }
    try {
      await database.$executeRawUnsafe(`
        CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'intentional E14-S10 outbox rollback';
        END;
        $$
      `);
      await database.$executeRawUnsafe(`
        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON domain_event_outbox
        FOR EACH ROW
        WHEN (NEW.tenant_id = '${fixture.tenantId}'::uuid)
        EXECUTE FUNCTION ${functionName}()
      `);
      await expect(process(fixture, confirmation.id)).rejects.toThrow(
        "intentional E14-S10 outbox rollback",
      );
    } finally {
      await database.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${triggerName} ON domain_event_outbox`,
      );
      await database.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }

    const [flowAfter, turnAfter, appointmentsAfter, outboundsAfter, auditsAfter, outboxAfter] =
      await Promise.all([
        database.appointmentBookingFlow.findUniqueOrThrow({ where: { id: flowBefore.id } }),
        database.appointmentBookingTurn.findUniqueOrThrow({
          where: { tenantId_inboundMessageId: { tenantId, inboundMessageId: confirmation.id } },
        }),
        database.appointment.count({ where: { tenantId, bookingFlowId: flowBefore.id } }),
        database.message.count({
          where: { tenantId, conversationId: fixture.conversationId, direction: "outbound" },
        }),
        database.auditLog.count({ where: { tenantId } }),
        database.domainEventOutbox.count({ where: { tenantId } }),
      ]);
    expect(flowAfter).toMatchObject({
      phase: flowBefore.phase,
      proposalVersion: flowBefore.proposalVersion,
      selectedServiceId: flowBefore.selectedServiceId,
      selectedResourceId: flowBefore.selectedResourceId,
      proposedStartsAt: flowBefore.proposedStartsAt,
      confirmationTokenHash: flowBefore.confirmationTokenHash,
      closedAt: flowBefore.closedAt,
    });
    expect(turnAfter).toMatchObject({
      route: "UNDECIDED",
      flowId: null,
      outboundMessageId: null,
      appointmentId: null,
    });
    expect(appointmentsAfter).toBe(appointmentsBefore);
    expect(outboundsAfter).toBe(outboundsBefore);
    expect(auditsAfter).toBe(auditsBefore);
    expect(outboxAfter).toBe(outboxBefore);

    const retry = await process(fixture, confirmation.id);
    expect(retry).toMatchObject({
      route: "BOOKING",
      handled: true,
      appointmentId: expect.any(String),
    });
    expect(
      await database.appointment.count({ where: { tenantId, bookingFlowId: flowBefore.id } }),
    ).toBe(1);
    const committedTurn = await database.appointmentBookingTurn.findUniqueOrThrow({
      where: { tenantId_inboundMessageId: { tenantId, inboundMessageId: confirmation.id } },
    });
    expect(committedTurn).toMatchObject({
      route: "BOOKING",
      appointmentId: retry.appointmentId,
      outboundMessageId: expect.any(String),
    });
    expect(
      await database.message.count({
        where: { tenantId, conversationId: fixture.conversationId, direction: "outbound" },
      }),
    ).toBe(outboundsBefore + 1);
  });

  it("invalidates a proposal after booking module revocation", async () => {
    const fixture = await conversationFixture();
    const { token } = await proposal(fixture);
    await database.tenantEntitlement.update({
      where: { tenantId_entitlementKey: { tenantId, entitlementKey: "module.appointments" } },
      data: { enabled: false },
    });
    try {
      const result = await process(fixture, (await message(fixture, token)).id);
      expect(result).toMatchObject({ handled: true, route: "LEGACY", legacyShouldRun: false });
      expect(
        await database.appointment.count({ where: { tenantId, contactId: fixture.contactId } }),
      ).toBe(0);
    } finally {
      await database.tenantEntitlement.update({
        where: { tenantId_entitlementKey: { tenantId, entitlementKey: "module.appointments" } },
        data: { enabled: true },
      });
    }
  });

  it("requires the scheduling module again before confirming a reminder-enabled proposal", async () => {
    const fixture = await conversationFixture();
    const remindersBefore = await database.appointmentReminder.count({ where: { tenantId } });
    const { rule } = await createBookingRule(fixture, undefined, [60]);
    const selector = persistedRuleSelector(fixture, rule.id);
    await process(fixture, (await message(fixture, "quiero reservar", true)).id, selector);
    await process(fixture, (await message(fixture, "1")).id, selector);
    await process(fixture, (await message(fixture, "1")).id, selector);
    const slot = await process(fixture, (await message(fixture, "1")).id, selector);
    if (!slot.outboundMessageId) throw new Error("reminder-enabled proposal prompt missing");
    const prompt = await database.message.findFirstOrThrow({
      where: { tenantId, outboundMessageId: slot.outboundMessageId },
    });
    const token = prompt.textBody?.split("\n").at(-1)?.trim();
    if (!token?.startsWith("CONFIRM-"))
      throw new Error("reminder-enabled confirmation token missing");
    await database.tenantEntitlement.update({
      where: { tenantId_entitlementKey: { tenantId, entitlementKey: "module.scheduling" } },
      data: { enabled: false },
    });
    try {
      const result = await process(fixture, (await message(fixture, token)).id);
      expect(result).toMatchObject({ route: "BOOKING", handled: true, legacyShouldRun: false });
      expect(
        await database.appointment.count({ where: { tenantId, contactId: fixture.contactId } }),
      ).toBe(0);
      expect(await database.appointmentReminder.count({ where: { tenantId } })).toBe(
        remindersBefore,
      );
    } finally {
      await database.tenantEntitlement.update({
        where: { tenantId_entitlementKey: { tenantId, entitlementKey: "module.scheduling" } },
        data: { enabled: true },
      });
    }
  });

  it("invalidates a proposal when its live booking policy changes", async () => {
    const fixture = await conversationFixture();
    const { rule, token } = await proposal(fixture);
    await database.rule.update({
      where: { tenantId_id: { tenantId, id: rule.id } },
      data: {
        actions: [
          {
            actionType: "start_appointment_booking",
            parameters: { serviceIds: [], resourceIds: [] },
          },
        ],
      },
    });
    const result = await process(fixture, (await message(fixture, token)).id);
    expect(result).toMatchObject({ handled: true, route: "BOOKING", legacyShouldRun: false });
    expect(
      (
        await database.appointmentBookingFlow.findFirstOrThrow({
          where: { tenantId, conversationId: fixture.conversationId },
        })
      ).terminalReason,
    ).toBe("rule_policy_changed");
    expect(
      await database.appointment.count({ where: { tenantId, contactId: fixture.contactId } }),
    ).toBe(0);
  });

  it("serializes two distinct inbound confirmations for one proposal into one appointment", async () => {
    const fixture = await conversationFixture();
    const { token } = await proposal(fixture);
    const first = await message(fixture, token);
    const second = await message(fixture, token);
    const results = await Promise.all([process(fixture, first.id), process(fixture, second.id)]);
    const appointments = await database.appointment.findMany({
      where: { tenantId, contactId: fixture.contactId },
    });
    expect(appointments).toHaveLength(1);
    expect(results.filter((result) => result.appointmentId === appointments[0]?.id)).toHaveLength(
      1,
    );
    expect(
      await database.appointmentBookingTurn.count({
        where: {
          tenantId,
          inboundMessageId: { in: [first.id, second.id] },
          outboundMessageId: { not: null },
        },
      }),
    ).toBe(1);
  });

  it("replays a concurrent duplicate canonical message without duplicate outbound or appointment effects", async () => {
    const fixture = await conversationFixture();
    const { rule } = await createBookingRule(fixture);
    const inbound = await message(fixture, "quiero reservar", true);
    const selector = persistedRuleSelector(fixture, rule.id);
    const results = await Promise.all([
      process(fixture, inbound.id, selector),
      process(fixture, inbound.id, selector),
    ]);
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
    expect(
      await database.appointmentBookingFlow.count({
        where: { tenantId, conversationId: fixture.conversationId, closedAt: null },
      }),
    ).toBe(1);
    expect(
      await database.appointmentBookingTurn.count({
        where: { tenantId, inboundMessageId: inbound.id, outboundMessageId: { not: null } },
      }),
    ).toBe(1);
  });
});
