import { expect, it } from "vitest";
import { RULE_TRIGGER_TYPES, validateActions } from "./rule-catalog-manager";

it("exposes scheduled tasks as the sixth rule trigger", () => {
  expect(RULE_TRIGGER_TYPES).toEqual([
    "ON_MESSAGE_RECEIVED",
    "ON_CONVERSATION_CREATED",
    "ON_STATUS_CHANGED",
    "ON_CONVERSATION_UNASSIGNED",
    "ON_OUT_OF_BUSINESS_HOURS",
    "ON_SCHEDULED_TASK",
  ]);
});

it("accepts one bounded appointment-booking action with explicit service and resource scopes", () => {
  expect(
    validateActions([
      {
        actionType: "start_appointment_booking",
        parameters: {
          serviceIds: ["019a0000-0000-7000-8000-000000000001"],
          resourceIds: ["019a0000-0000-7000-8000-000000000002"],
          reminderOffsetsMinutes: [1440, 60],
        },
      },
    ]),
  ).toEqual([
    {
      actionType: "start_appointment_booking",
      parameters: {
        serviceIds: ["019a0000-0000-7000-8000-000000000001"],
        resourceIds: ["019a0000-0000-7000-8000-000000000002"],
        reminderOffsetsMinutes: [1440, 60],
      },
    },
  ]);
});

it("rejects an appointment-booking action combined with a legacy action", () => {
  expect(() =>
    validateActions([
      {
        actionType: "start_appointment_booking",
        parameters: {
          serviceIds: ["019a0000-0000-7000-8000-000000000001"],
          resourceIds: ["019a0000-0000-7000-8000-000000000002"],
        },
      },
      { actionType: "SEND_MESSAGE", parameters: { text: "No side effects" } },
    ]),
  ).toThrow("Appointment booking must be the only rule action");
});

it("rejects duplicate or out-of-range reminder offsets for booking", () => {
  expect(() =>
    validateActions([
      {
        actionType: "start_appointment_booking",
        parameters: {
          serviceIds: ["019a0000-0000-7000-8000-000000000001"],
          resourceIds: ["019a0000-0000-7000-8000-000000000002"],
          reminderOffsetsMinutes: [60, 60],
        },
      },
    ]),
  ).toThrow("reminderOffsetsMinutes must not contain duplicates");
});
