import { describe, expect, it } from "vitest";
import {
  dateKeyInZone,
  formatLocalDateTime,
  formatZoned,
  getCalendarWindow,
  getVisibleAppointmentDays,
  resolveLocalTime,
} from "./appointment-calendar";

describe("appointment calendar timezone helpers", () => {
  it("uses the requested zone instead of the host timezone for date keys", () => {
    expect(dateKeyInZone("2024-01-01T23:30:00.000Z", "Asia/Kolkata")).toBe("2024-01-02");
  });

  it("builds Monday-based weeks and rolling seven-day lists with an exclusive end", () => {
    expect(getCalendarWindow("2024-01-03", "week", "UTC")).toEqual({
      from: "2024-01-01T00:00:00.000Z",
      to: "2024-01-08T00:00:00.000Z",
      days: [
        "2024-01-01",
        "2024-01-02",
        "2024-01-03",
        "2024-01-04",
        "2024-01-05",
        "2024-01-06",
        "2024-01-07",
      ],
    });
    expect(getCalendarWindow("2024-01-03", "list", "UTC").days).toEqual([
      "2024-01-03",
      "2024-01-04",
      "2024-01-05",
      "2024-01-06",
      "2024-01-07",
      "2024-01-08",
      "2024-01-09",
    ]);
  });

  it("validates every local day in a multi-day window and supports years below 0100", () => {
    expect(() => getCalendarWindow("2011-12-28", "week", "Pacific/Apia")).toThrow(
      "Local calendar date 2011-12-30 does not exist in Pacific/Apia",
    );
    expect(getCalendarWindow("2011-12-29", "day", "Pacific/Apia")).toMatchObject({
      from: "2011-12-29T10:00:00.000Z",
      to: "2011-12-30T10:00:00.000Z",
    });
    expect(getCalendarWindow("0099-12-31", "day", "UTC")).toMatchObject({
      from: "0099-12-31T00:00:00.000Z",
      to: "0100-01-01T00:00:00.000Z",
    });
  });

  it("uses 23-hour and 25-hour local days across New York daylight transitions", () => {
    const spring = getCalendarWindow("2024-03-10", "day", "America/New_York");
    const fall = getCalendarWindow("2024-11-03", "day", "America/New_York");
    expect(Date.parse(spring.to) - Date.parse(spring.from)).toBe(23 * 60 * 60 * 1000);
    expect(Date.parse(fall.to) - Date.parse(fall.from)).toBe(25 * 60 * 60 * 1000);
  });

  it("returns both instants in a fold and no instant in a gap", () => {
    expect(resolveLocalTime("2024-11-03T01:30", "America/New_York")).toEqual([
      "2024-11-03T05:30:00.000Z",
      "2024-11-03T06:30:00.000Z",
    ]);
    expect(resolveLocalTime("2024-03-10T02:30", "America/New_York")).toEqual([]);
  });

  it("handles a half-hour zone and a midnight DST gap", () => {
    expect(resolveLocalTime("2024-01-02T03:00", "Asia/Kolkata")).toEqual([
      "2024-01-01T21:30:00.000Z",
    ]);
    const brazil = getCalendarWindow("2018-11-04", "day", "America/Sao_Paulo");
    expect(brazil.from).toBe("2018-11-04T03:00:00.000Z");
    expect(formatLocalDateTime(brazil.from, "America/Sao_Paulo")).toContain("01:00");
  });

  it("formats instants with the requested zone and rejects invalid dates, zones and skipped days", () => {
    expect(formatZoned("2024-01-01T23:30:00.000Z", "Asia/Kolkata", "en-GB")).toContain(
      "2 Jan 2024",
    );
    expect(() => dateKeyInZone("not-a-date", "UTC")).toThrow(RangeError);
    expect(() => dateKeyInZone("2024-01-01T00:00:00Z", "Mars/Olympus")).toThrow(RangeError);
    expect(() => getCalendarWindow("2011-12-30", "day", "Pacific/Apia")).toThrow(RangeError);
  });

  it("formats both occurrences of a repeated wall time with their distinct UTC offsets", () => {
    const first = formatZoned("2024-11-03T05:30:00.000Z", "America/New_York", "en-US");
    const second = formatZoned("2024-11-03T06:30:00.000Z", "America/New_York", "en-US");

    expect(first).toContain("1:30 AM");
    expect(second).toContain("1:30 AM");
    expect(first).toContain("GMT-04:00");
    expect(second).toContain("GMT-05:00");
    expect(first).not.toBe(second);
  });

  it("includes appointments intersecting each visible day, including carryovers", () => {
    expect(
      getVisibleAppointmentDays(
        "2024-01-07T23:00:00.000Z",
        "2024-01-09T02:00:00.000Z",
        ["2024-01-08", "2024-01-09", "2024-01-10"],
        "UTC",
      ),
    ).toEqual(["2024-01-08", "2024-01-09"]);
  });

  it("uses 23-hour and 25-hour local day boundaries for overlap grouping", () => {
    const spring = getCalendarWindow("2024-03-10", "day", "America/New_York");
    const fall = getCalendarWindow("2024-11-03", "day", "America/New_York");

    expect(
      getVisibleAppointmentDays(spring.from, spring.to, spring.days, "America/New_York"),
    ).toEqual(["2024-03-10"]);
    expect(getVisibleAppointmentDays(fall.from, fall.to, fall.days, "America/New_York")).toEqual([
      "2024-11-03",
    ]);
  });

  it("treats appointment end at local midnight as exclusive and rejects invalid intervals", () => {
    expect(
      getVisibleAppointmentDays(
        "2024-02-01T23:00:00.000Z",
        "2024-02-02T00:00:00.000Z",
        ["2024-02-01", "2024-02-02"],
        "UTC",
      ),
    ).toEqual(["2024-02-01"]);
    expect(() =>
      getVisibleAppointmentDays(
        "2024-02-02T00:00:00.000Z",
        "2024-02-02T00:00:00.000Z",
        ["2024-02-02"],
        "UTC",
      ),
    ).toThrow(RangeError);
  });
});
