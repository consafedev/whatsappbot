import { expect, it } from "vitest";
import { selectAppointmentBookingRouteFromRules } from "./inbound-event-dispatcher";
import type { RuleItem } from "./rule-catalog-manager";

const bookingAction = {
  actionType: "start_appointment_booking",
  parameters: {
    resourceIds: ["019a0000-0000-7000-8000-000000000002"],
    serviceIds: ["019a0000-0000-7000-8000-000000000001"],
  },
};

function rule(overrides: Partial<RuleItem> & Pick<RuleItem, "id" | "triggerType">): RuleItem {
  return {
    actions: [bookingAction],
    channelAccountId: null,
    conditions: [],
    cooldownSeconds: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    description: null,
    executionMode: "first_match_stop",
    name: overrides.id,
    organizationUnitId: null,
    priority: 100,
    status: "active",
    tenantId: "019a0000-0000-7000-8000-000000000003",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const context = {
  channelAccountId: "019a0000-0000-7000-8000-000000000004",
  conversation: { automationMode: "AUTO", status: "open", unreadCount: 1 },
  conversationId: "019a0000-0000-7000-8000-000000000005",
  contact: { customAttributes: {}, tags: [] },
  contactId: "019a0000-0000-7000-8000-000000000006",
  message: { direction: "inbound", mediaType: null, origin: "customer", textBody: "reservar" },
  now: new Date("2026-01-02T00:00:00.000Z"),
};

it("lets a matching conversation-created rule claim a new conversation before booking", () => {
  const result = selectAppointmentBookingRouteFromRules(
    [
      rule({
        id: "019a0000-0000-7000-8000-000000000010",
        triggerType: "ON_CONVERSATION_CREATED",
        actions: [{ actionType: "send_message" }],
      }),
      rule({ id: "019a0000-0000-7000-8000-000000000011", triggerType: "ON_MESSAGE_RECEIVED" }),
    ],
    context,
    true,
  );

  expect(result).toEqual({ kind: "LEGACY" });
});

it("does not let a booking action jump ahead of an earlier matching evaluate_all rule", () => {
  const result = selectAppointmentBookingRouteFromRules(
    [
      rule({
        id: "019a0000-0000-7000-8000-000000000012",
        triggerType: "ON_MESSAGE_RECEIVED",
        executionMode: "evaluate_all",
        actions: [{ actionType: "send_message" }],
      }),
      rule({
        id: "019a0000-0000-7000-8000-000000000013",
        triggerType: "ON_MESSAGE_RECEIVED",
        priority: 101,
      }),
    ],
    context,
    false,
  );

  expect(result).toEqual({ kind: "LEGACY" });
});

it("selects only the first eligible booking rule in AUTO mode", () => {
  const result = selectAppointmentBookingRouteFromRules(
    [
      rule({ id: "019a0000-0000-7000-8000-000000000014", triggerType: "ON_MESSAGE_RECEIVED" }),
      rule({
        id: "019a0000-0000-7000-8000-000000000015",
        triggerType: "ON_MESSAGE_RECEIVED",
        priority: 101,
      }),
    ],
    context,
    false,
  );

  expect(result).toMatchObject({
    kind: "BOOKING",
    policy: {
      resourceIds: ["019a0000-0000-7000-8000-000000000002"],
      serviceIds: ["019a0000-0000-7000-8000-000000000001"],
    },
    ruleId: "019a0000-0000-7000-8000-000000000014",
    trigger: "ON_MESSAGE_RECEIVED",
  });
});

it("does not start booking in ASSISTED mode or for evaluate_all booking rules", () => {
  const assisted = selectAppointmentBookingRouteFromRules(
    [rule({ id: "019a0000-0000-7000-8000-000000000016", triggerType: "ON_MESSAGE_RECEIVED" })],
    { ...context, conversation: { ...context.conversation, automationMode: "ASSISTED" } },
    false,
  );
  const evaluateAll = selectAppointmentBookingRouteFromRules(
    [
      rule({
        id: "019a0000-0000-7000-8000-000000000017",
        triggerType: "ON_MESSAGE_RECEIVED",
        executionMode: "evaluate_all",
      }),
    ],
    context,
    false,
  );

  expect(assisted).toEqual({ kind: "LEGACY" });
  expect(evaluateAll).toEqual({ kind: "LEGACY" });
});

it("requires an exact assigned organization unit for a scoped booking rule", () => {
  const scopedRule = rule({
    id: "019a0000-0000-7000-8000-000000000018",
    organizationUnitId: "019a0000-0000-7000-8000-000000000019",
    triggerType: "ON_MESSAGE_RECEIVED",
  });

  expect(selectAppointmentBookingRouteFromRules([scopedRule], context, false)).toEqual({
    kind: "LEGACY",
  });
  expect(
    selectAppointmentBookingRouteFromRules(
      [scopedRule],
      {
        ...context,
        conversation: {
          ...context.conversation,
          assignedUnitId: "019a0000-0000-7000-8000-000000000019",
        },
      },
      false,
    ),
  ).toMatchObject({ kind: "BOOKING", ruleId: scopedRule.id });
  expect(
    selectAppointmentBookingRouteFromRules(
      [scopedRule],
      {
        ...context,
        conversation: {
          ...context.conversation,
          assignedUnitId: "019a0000-0000-7000-8000-000000000020",
        },
      },
      false,
    ),
  ).toEqual({ kind: "LEGACY" });
});

it("preserves legacy scoped-rule matching on unassigned conversations", () => {
  const legacyScopedRule = rule({
    id: "019a0000-0000-7000-8000-000000000021",
    organizationUnitId: "019a0000-0000-7000-8000-000000000022",
    triggerType: "ON_MESSAGE_RECEIVED",
    actions: [{ actionType: "send_message" }],
  });
  const laterBookingRule = rule({
    id: "019a0000-0000-7000-8000-000000000023",
    triggerType: "ON_MESSAGE_RECEIVED",
    priority: 101,
  });

  expect(
    selectAppointmentBookingRouteFromRules([legacyScopedRule, laterBookingRule], context, false),
  ).toEqual({ kind: "LEGACY" });
  expect(
    selectAppointmentBookingRouteFromRules(
      [legacyScopedRule, laterBookingRule],
      {
        ...context,
        conversation: {
          ...context.conversation,
          assignedUnitId: "019a0000-0000-7000-8000-000000000024",
        },
      },
      false,
    ),
  ).toMatchObject({ kind: "BOOKING", ruleId: laterBookingRule.id });
});
