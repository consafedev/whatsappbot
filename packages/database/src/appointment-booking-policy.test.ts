import { describe, expect, it } from "vitest";
import {
  AppointmentBookingValidationError,
  hashAppointmentBookingRuleDefinition,
  normalizeAppointmentBookingPolicy,
} from "./appointment-booking-policy";

const serviceId = "0199f2a0-0000-7000-8000-000000000001";
const otherServiceId = "0199f2a0-0000-7000-8000-000000000002";
const resourceId = "0199f2a0-0000-7000-8000-000000000003";

describe("E14-S10 booking policy", () => {
  it("normalizes bounded service/resource UUID scopes and reminder offsets", () => {
    expect(
      normalizeAppointmentBookingPolicy({
        resourceIds: [resourceId.toUpperCase()],
        reminderOffsetsMinutes: [120, 30],
        serviceIds: [serviceId.toUpperCase()],
      }),
    ).toEqual({
      resourceIds: [resourceId],
      reminderOffsetsMinutes: [30, 120],
      serviceIds: [serviceId],
    });
  });

  it("rejects unbounded, empty, duplicate, or malformed booking scope", () => {
    expect(() =>
      normalizeAppointmentBookingPolicy({ serviceIds: [], resourceIds: [resourceId] }),
    ).toThrow(AppointmentBookingValidationError);
    expect(() =>
      normalizeAppointmentBookingPolicy({
        serviceIds: [serviceId],
        resourceIds: [resourceId],
        reminderOffsetsMinutes: [30, 30],
      }),
    ).toThrow(AppointmentBookingValidationError);
    expect(() =>
      normalizeAppointmentBookingPolicy({
        serviceIds: [serviceId, otherServiceId],
        resourceIds: [resourceId],
        reminderOffsetsMinutes: [10_081],
      }),
    ).toThrow(AppointmentBookingValidationError);
  });

  it("hashes authorization-relevant rule definition but ignores presentation and execution metrics", () => {
    const base = {
      actions: [
        { actionType: "start_appointment_booking", parameters: { serviceIds: [serviceId] } },
      ],
      channelAccountId: null,
      conditions: [{ field: "message.textBody", operator: "contains", value: "cita" }],
      cooldownSeconds: 0,
      executionMode: "first_match_stop",
      name: "Booking",
      organizationUnitId: null,
      priority: 10,
      status: "active",
      triggerType: "ON_MESSAGE_RECEIVED",
    } as const;
    const hash = hashAppointmentBookingRuleDefinition(base);

    expect(
      hashAppointmentBookingRuleDefinition({
        ...base,
        description: "changed description",
        executionCount: 99,
        lastExecutedAt: new Date("2026-10-27T00:00:00.000Z"),
        name: "Renamed",
        updatedAt: new Date("2026-10-28T00:00:00.000Z"),
      }),
    ).toBe(hash);
    expect(hashAppointmentBookingRuleDefinition({ ...base, priority: 11 })).not.toBe(hash);
    expect(
      hashAppointmentBookingRuleDefinition({
        ...base,
        conditions: [{ field: "message.textBody", operator: "contains", value: "consulta" }],
      }),
    ).not.toBe(hash);
  });
});
