import { describe, expect, it } from "vitest";
import {
  type BusinessHoursConfig,
  isWithinBusinessHours,
} from "./business-hours-evaluator";

describe("BusinessHoursEvaluator", () => {
  const standardWeekSchedule: BusinessHoursConfig = {
    holidays: ["2026-12-25", "2026-01-01"],
    schedules: [
      { closeTime: "14:00", dayOfWeek: 0, isOpen: false, openTime: "09:00" }, // Sunday closed
      { closeTime: "18:00", dayOfWeek: 1, isOpen: true, openTime: "09:00" }, // Monday 09:00-18:00
      { closeTime: "18:00", dayOfWeek: 2, isOpen: true, openTime: "09:00" }, // Tuesday 09:00-18:00
      { closeTime: "18:00", dayOfWeek: 3, isOpen: true, openTime: "09:00" }, // Wednesday 09:00-18:00
      { closeTime: "18:00", dayOfWeek: 4, isOpen: true, openTime: "09:00" }, // Thursday 09:00-18:00
      { closeTime: "18:00", dayOfWeek: 5, isOpen: true, openTime: "09:00" }, // Friday 09:00-18:00
      { closeTime: "14:00", dayOfWeek: 6, isOpen: true, openTime: "10:00" }, // Saturday 10:00-14:00
    ],
    timezone: "America/Mexico_City",
  };

  describe("Null / Empty / Default configuration", () => {
    it("returns true when config is null (24/7 default)", () => {
      expect(isWithinBusinessHours(null, new Date())).toBe(true);
    });

    it("returns true when config is undefined", () => {
      expect(isWithinBusinessHours(undefined, new Date())).toBe(true);
    });

    it("returns true when schedules array is empty", () => {
      expect(
        isWithinBusinessHours({ schedules: [], timezone: "America/Mexico_City" }, new Date()),
      ).toBe(true);
    });
  });

  describe("Daytime schedule evaluation", () => {
    // 2026-08-26 is a Wednesday (dayOfWeek 3)
    // 15:00 UTC = 09:00 in America/Mexico_City (UTC-6)
    // 23:59 UTC = 17:59 in America/Mexico_City
    // 00:00 UTC (next day) = 18:00 in America/Mexico_City

    it("returns true at exactly openTime (inclusive: 09:00 Mexico City)", () => {
      const openInstant = new Date("2026-08-26T15:00:00.000Z"); // 09:00 Mexico City
      expect(isWithinBusinessHours(standardWeekSchedule, openInstant)).toBe(true);
    });

    it("returns true within the middle of business hours (14:30 Mexico City)", () => {
      const middleInstant = new Date("2026-08-26T20:30:00.000Z"); // 14:30 Mexico City
      expect(isWithinBusinessHours(standardWeekSchedule, middleInstant)).toBe(true);
    });

    it("returns true one minute before closing (17:59 Mexico City)", () => {
      const closingSoon = new Date("2026-08-26T23:59:00.000Z"); // 17:59 Mexico City
      expect(isWithinBusinessHours(standardWeekSchedule, closingSoon)).toBe(true);
    });

    it("returns false exactly at closeTime (exclusive: 18:00 Mexico City)", () => {
      const closeInstant = new Date("2026-08-27T00:00:00.000Z"); // 18:00 Wednesday in Mexico City
      expect(isWithinBusinessHours(standardWeekSchedule, closeInstant)).toBe(false);
    });

    it("returns false before openTime (08:59 Mexico City)", () => {
      const beforeOpen = new Date("2026-08-26T14:59:00.000Z"); // 08:59 Mexico City
      expect(isWithinBusinessHours(standardWeekSchedule, beforeOpen)).toBe(false);
    });

    it("returns false late at night (22:00 Mexico City)", () => {
      const lateNight = new Date("2026-08-27T04:00:00.000Z"); // 22:00 Wednesday in Mexico City
      expect(isWithinBusinessHours(standardWeekSchedule, lateNight)).toBe(false);
    });
  });

  describe("Non-working days and missing days", () => {
    it("returns false on Sunday when isOpen is false", () => {
      // 2026-08-30 is Sunday
      const sundayNoon = new Date("2026-08-30T18:00:00.000Z"); // 12:00 Sunday Mexico City
      expect(isWithinBusinessHours(standardWeekSchedule, sundayNoon)).toBe(false);
    });

    it("returns false when the current day has no entry in schedules", () => {
      const partialSchedule: BusinessHoursConfig = {
        schedules: [
          { closeTime: "18:00", dayOfWeek: 1, isOpen: true, openTime: "09:00" }, // Monday only
        ],
        timezone: "UTC",
      };
      // Wednesday
      const wednesday = new Date("2026-08-26T12:00:00.000Z");
      expect(isWithinBusinessHours(partialSchedule, wednesday)).toBe(false);
    });

    it("returns true when isOpen is true with no specific times (open all day)", () => {
      const allDaySchedule: BusinessHoursConfig = {
        schedules: [{ dayOfWeek: 3, isOpen: true }], // Wednesday all day
        timezone: "UTC",
      };
      const wednesdayMidnight = new Date("2026-08-26T03:00:00.000Z");
      expect(isWithinBusinessHours(allDaySchedule, wednesdayMidnight)).toBe(true);
    });
  });

  describe("Holiday exclusions", () => {
    it("returns false on holidays even during normal working hours", () => {
      // 2026-12-25 is a Friday (dayOfWeek 5), normally open 09:00-18:00
      const christmasDay = new Date("2026-12-25T18:00:00.000Z"); // 12:00 Mexico City
      expect(isWithinBusinessHours(standardWeekSchedule, christmasDay)).toBe(false);
    });

    it("returns true on non-holiday dates in the same month", () => {
      // 2026-12-24 is Thursday
      const christmasEve = new Date("2026-12-24T18:00:00.000Z"); // 12:00 Mexico City
      expect(isWithinBusinessHours(standardWeekSchedule, christmasEve)).toBe(true);
    });
  });

  describe("Overnight schedules", () => {
    const nightShiftConfig: BusinessHoursConfig = {
      schedules: [
        { closeTime: "06:00", dayOfWeek: 3, isOpen: true, openTime: "22:00" }, // Wed 22:00 to 06:00
      ],
      timezone: "UTC",
    };

    it("returns true late at night during shift (23:30)", () => {
      const lateNight = new Date("2026-08-26T23:30:00.000Z");
      expect(isWithinBusinessHours(nightShiftConfig, lateNight)).toBe(true);
    });

    it("returns true in the early morning before shift end (05:30)", () => {
      const earlyMorning = new Date("2026-08-26T05:30:00.000Z");
      expect(isWithinBusinessHours(nightShiftConfig, earlyMorning)).toBe(true);
    });

    it("returns false in the afternoon outside shift (14:00)", () => {
      const afternoon = new Date("2026-08-26T14:00:00.000Z");
      expect(isWithinBusinessHours(nightShiftConfig, afternoon)).toBe(false);
    });
  });

  describe("Timezone resolution and safety fallback", () => {
    it("correctly resolves schedules across different timezones", () => {
      const tokyoSchedule: BusinessHoursConfig = {
        schedules: [{ closeTime: "18:00", dayOfWeek: 3, isOpen: true, openTime: "09:00" }],
        timezone: "Asia/Tokyo", // UTC+9
      };
      // 2026-08-26 01:00 UTC = 10:00 AM Tokyo (Open)
      const tokyoOpen = new Date("2026-08-26T01:00:00.000Z");
      expect(isWithinBusinessHours(tokyoSchedule, tokyoOpen)).toBe(true);

      // 2026-08-26 12:00 UTC = 21:00 Tokyo (Closed)
      const tokyoClosed = new Date("2026-08-26T12:00:00.000Z");
      expect(isWithinBusinessHours(tokyoSchedule, tokyoClosed)).toBe(false);
    });

    it("falls back to UTC when given an invalid IANA timezone without throwing", () => {
      const invalidTzConfig: BusinessHoursConfig = {
        schedules: [{ closeTime: "18:00", dayOfWeek: 3, isOpen: true, openTime: "09:00" }],
        timezone: "Invalid/NonExistentTimezone_12345",
      };
      // 2026-08-26 12:00 UTC (Wednesday) -> Within 09:00-18:00 UTC
      const dateInUtc = new Date("2026-08-26T12:00:00.000Z");
      expect(isWithinBusinessHours(invalidTzConfig, dateInUtc)).toBe(true);

      // 2026-08-26 22:00 UTC -> Outside UTC hours
      const dateOutsideUtc = new Date("2026-08-26T22:00:00.000Z");
      expect(isWithinBusinessHours(invalidTzConfig, dateOutsideUtc)).toBe(false);
    });
  });
});
