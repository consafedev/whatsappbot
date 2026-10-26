import { describe, expect, it } from "vitest";
import {
  AppointmentAvailabilityQueryValidationError,
  calculateAppointmentAvailability,
} from "./appointment-availability-calculator";

const rule = {
  dayOfWeek: 0,
  startTime: "08:00",
  endTime: "13:00",
  timezone: "America/New_York",
  capacity: 2,
  serviceId: null,
  effectiveFrom: null,
  effectiveTo: null,
};

const base = {
  from: "2026-11-01T13:00:00.000Z",
  to: "2026-11-01T17:00:00.000Z",
  timezone: "America/New_York",
  resourceId: "resource",
  resourceCapacity: 2,
  durationMinutes: 60,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  rules: [rule],
  exceptions: [],
  occupied: [],
  businessHours: null,
  limit: 100,
};

describe("E14-S05 availability calculator", () => {
  it("unions adjacent windows, takes maximum capacity, and honors partial-second BLOCKED boundaries", () => {
    const result = calculateAppointmentAvailability({
      ...base,
      rules: [
        { ...rule, startTime: "08:00", endTime: "09:00", capacity: 1 },
        { ...rule, startTime: "09:00", endTime: "11:00", capacity: 2 },
      ],
      exceptions: [
        {
          type: "BLOCKED" as const,
          startsAt: "2026-11-01T14:29:59.999Z",
          endsAt: "2026-11-01T14:30:00.002Z",
        },
      ],
    });
    expect(
      result.slots.find((slot) => slot.startsAt === "2026-11-01T13:30:00.000Z"),
    ).toBeUndefined();
    expect(
      result.slots.find((slot) => slot.startsAt === "2026-11-01T13:00:00.000Z")?.capacity,
    ).toBe(1);
    expect(
      result.slots.find((slot) => slot.startsAt === "2026-11-01T15:00:00.000Z")?.capacity,
    ).toBe(2);
  });

  it("keeps the two folded DST wall times as distinct UTC starts", () => {
    const result = calculateAppointmentAvailability({
      ...base,
      from: "2026-11-01T05:00:00.000Z",
      to: "2026-11-01T07:00:00.000Z",
      durationMinutes: 30,
      rules: [{ ...rule, startTime: "01:00", endTime: "02:00" }],
    });
    expect(result.slots.some((slot) => slot.startsAt === "2026-11-01T05:00:00.000Z")).toBe(true);
    expect(result.slots.some((slot) => slot.startsAt === "2026-11-01T06:00:00.000Z")).toBe(true);
  });

  it("uses peak occupancy for remaining capacity and paginates without dropping slots", () => {
    const input = {
      ...base,
      occupied: [
        { startsAt: "2026-11-01T13:10:00.000Z", endsAt: "2026-11-01T13:20:00.000Z", capacity: 1 },
        { startsAt: "2026-11-01T13:30:00.000Z", endsAt: "2026-11-01T13:40:00.000Z", capacity: 1 },
      ],
      limit: 1,
    };
    const first = calculateAppointmentAvailability(input);
    expect(first.slots[0]?.capacity).toBe(1);
    expect(first.nextFrom).toBeDefined();
    if (first.nextFrom === undefined) throw new Error("Expected nextFrom");
    const second = calculateAppointmentAvailability({ ...input, from: first.nextFrom });
    expect(second.slots[0]?.startsAt).toBe(first.nextFrom);
  });

  it("omits nonexistent spring DST wall times and honors effective dates and service-specific filtering", () => {
    const result = calculateAppointmentAvailability({
      ...base,
      from: "2026-03-08T06:00:00.000Z",
      to: "2026-03-08T08:00:00.000Z",
      durationMinutes: 30,
      rules: [
        {
          ...rule,
          startTime: "02:00",
          endTime: "03:00",
          effectiveFrom: "2026-03-08",
          effectiveTo: "2026-03-08",
        },
      ],
    });
    expect(result.slots).toHaveLength(0);
    const valid = calculateAppointmentAvailability({
      ...base,
      from: "2026-03-08T07:00:00.000Z",
      to: "2026-03-08T08:00:00.000Z",
      durationMinutes: 30,
      rules: [
        {
          ...rule,
          startTime: "03:00",
          endTime: "04:00",
          effectiveFrom: "2026-03-08",
          effectiveTo: "2026-03-08",
        },
      ],
    });
    expect(valid.slots[0]?.startsAt).toBe("2026-03-08T07:00:00.000Z");
  });

  it("allows EXTRA_AVAILABILITY without a weekly rule but keeps business hours and BLOCKED authoritative", () => {
    const input = {
      ...base,
      rules: [],
      exceptions: [
        {
          type: "EXTRA_AVAILABILITY" as const,
          startsAt: "2026-11-01T13:00:00.000Z",
          endsAt: "2026-11-01T15:00:00.000Z",
        },
      ],
    };
    expect(calculateAppointmentAvailability(input).slots[0]?.capacity).toBe(2);
    const closed = calculateAppointmentAvailability({
      ...input,
      businessHours: { timezone: "UTC", schedules: [{ dayOfWeek: 0, isOpen: false }] },
    });
    expect(closed.slots).toHaveLength(0);
  });

  it("requires continuous coverage through buffers outside the query window", () => {
    const input = {
      ...base,
      from: "2026-11-01T13:30:00.000Z",
      to: "2026-11-01T14:00:00.000Z",
      durationMinutes: 30,
      bufferAfterMinutes: 15,
      rules: [
        { ...rule, startTime: "08:00", endTime: "09:00" },
        { ...rule, startTime: "09:00", endTime: "10:00" },
      ],
    };
    expect(calculateAppointmentAvailability(input).slots[0]?.startsAt).toBe(input.from);
    const gap = calculateAppointmentAvailability({
      ...input,
      rules: [input.rules[0] ?? rule, { ...rule, startTime: "09:01", endTime: "10:00" }],
    });
    expect(gap.slots).toHaveLength(0);
  });

  it("allows a slot to cross midnight through adjacent 24:00 and 00:00 weekly rules", () => {
    const result = calculateAppointmentAvailability({
      ...base,
      from: "2026-10-26T23:30:00.000Z",
      to: "2026-10-27T00:30:00.000Z",
      timezone: "UTC",
      durationMinutes: 60,
      rules: [
        { ...rule, dayOfWeek: 1, startTime: "22:00", endTime: "24:00", timezone: "UTC" },
        { ...rule, dayOfWeek: 2, startTime: "00:00", endTime: "06:00", timezone: "UTC" },
      ],
    });
    expect(result.slots[0]?.startsAt).toBe("2026-10-26T23:30:00.000Z");
  });

  it("uses the prior opening weekday for an overnight business-hours slot", () => {
    const result = calculateAppointmentAvailability({
      ...base,
      from: "2026-10-27T01:00:00.000Z",
      to: "2026-10-27T03:00:00.000Z",
      timezone: "UTC",
      durationMinutes: 60,
      rules: [{ ...rule, dayOfWeek: 2, startTime: "00:00", endTime: "07:00", timezone: "UTC" }],
      businessHours: {
        timezone: "UTC",
        schedules: [{ dayOfWeek: 1, isOpen: true, openTime: "22:00", closeTime: "06:00" }],
      },
    });
    expect(result.slots[0]?.startsAt).toBe("2026-10-27T01:00:00.000Z");
  });

  it("excludes early opening-day time and applies week rollover and holidays to slots", () => {
    const mondayNight = {
      timezone: "UTC",
      schedules: [{ dayOfWeek: 1, isOpen: true, openTime: "22:00", closeTime: "06:00" }],
    };
    const tuesday = {
      ...base,
      from: "2026-10-27T01:00:00.000Z",
      to: "2026-10-27T03:00:00.000Z",
      timezone: "UTC",
      durationMinutes: 60,
      rules: [{ ...rule, dayOfWeek: 2, startTime: "00:00", endTime: "07:00", timezone: "UTC" }],
      businessHours: mondayNight,
    };
    expect(
      calculateAppointmentAvailability({
        ...tuesday,
        from: "2026-10-26T01:00:00.000Z",
        to: "2026-10-26T03:00:00.000Z",
        rules: [{ ...rule, dayOfWeek: 1, startTime: "00:00", endTime: "07:00", timezone: "UTC" }],
      }).slots,
    ).toHaveLength(0);
    const sundayNight = {
      timezone: "UTC",
      schedules: [
        { dayOfWeek: 0, isOpen: true, openTime: "22:00", closeTime: "06:00" },
        { dayOfWeek: 1, isOpen: false },
      ],
    };
    expect(
      calculateAppointmentAvailability({
        ...tuesday,
        from: "2026-08-31T01:00:00.000Z",
        to: "2026-08-31T03:00:00.000Z",
        rules: [{ ...rule, dayOfWeek: 1, startTime: "00:00", endTime: "07:00", timezone: "UTC" }],
        businessHours: sundayNight,
      }).slots[0]?.startsAt,
    ).toBe("2026-08-31T01:00:00.000Z");
    for (const holidays of [["2026-10-26"], ["2026-10-27"]]) {
      expect(
        calculateAppointmentAvailability({
          ...tuesday,
          businessHours: { ...mondayNight, holidays },
        }).slots,
      ).toHaveLength(0);
    }
    expect(
      calculateAppointmentAvailability({
        ...tuesday,
        businessHours: { timezone: "UTC", schedules: [], holidays: ["2026-10-27"] },
      }).slots,
    ).toHaveLength(0);
  });

  it("rejects an excessive evaluation budget and fixed-offset timezone", () => {
    expect(() => calculateAppointmentAvailability({ ...base, timezone: "+01:00" })).toThrow(
      AppointmentAvailabilityQueryValidationError,
    );
    expect(() =>
      calculateAppointmentAvailability({
        ...base,
        from: "2026-11-01T00:00:00.000Z",
        to: "2026-11-08T00:00:00.000Z",
        rules: Array.from({ length: 600 }, () => rule),
      }),
    ).toThrow(/work budget/);
  });
});
