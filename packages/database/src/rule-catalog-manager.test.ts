import { expect, it } from "vitest";
import { RULE_TRIGGER_TYPES } from "./rule-catalog-manager";

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
