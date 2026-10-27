type LocalFields = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}>;

export type CalendarView = "day" | "week" | "list";
export type CalendarWindow = Readonly<{ from: string; to: string; days: readonly string[] }>;

const partFormatterCache = new Map<string, Intl.DateTimeFormat>();
const displayFormatterCache = new Map<string, Intl.DateTimeFormat>();
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/;

function assertDateKey(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError("Invalid calendar date; expected YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (
    year < 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError("Invalid calendar date; expected a real YYYY-MM-DD date");
  }
}

function formatter(zone: string): Intl.DateTimeFormat {
  let current = partFormatterCache.get(zone);
  if (current === undefined) {
    try {
      current = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23",
        minute: "2-digit",
        month: "2-digit",
        second: "2-digit",
        timeZone: zone,
        year: "numeric",
      });
      current.format(0);
    } catch {
      throw new RangeError(`Invalid IANA timezone: ${zone}`);
    }
    partFormatterCache.set(zone, current);
  }
  return current;
}

function fieldsAt(epochMilliseconds: number, zone: string): LocalFields {
  const parts = formatter(zone).formatToParts(epochMilliseconds);
  const values = new Map(parts.map(({ type, value }) => [type, value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
  };
}

function localDate(fields: LocalFields): string {
  return `${String(fields.year).padStart(4, "0")}-${String(fields.month).padStart(2, "0")}-${String(fields.day).padStart(2, "0")}`;
}

function localDateTime(fields: LocalFields): string {
  return `${localDate(fields)}T${String(fields.hour).padStart(2, "0")}:${String(fields.minute).padStart(2, "0")}`;
}

function parseInstant(value: Date | string): number {
  if (value instanceof Date) {
    const epoch = value.getTime();
    if (Number.isFinite(epoch)) return epoch;
    throw new RangeError("Invalid instant");
  }
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) {
    throw new RangeError("Invalid instant; expected an ISO timestamp with an explicit timezone");
  }
  assertDateKey(value.slice(0, 10));
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new RangeError("Invalid instant");
  return epoch;
}

function parseLocalDateTime(value: string): LocalFields {
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) throw new RangeError("Invalid local date-time; expected YYYY-MM-DDTHH:mm");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const dateKey = `${match[1]}-${match[2]}-${match[3]}`;
  assertDateKey(dateKey);
  return { year, month, day, hour, minute, second: 0 };
}

function utcFromFields(fields: LocalFields): number {
  const date = new Date(0);
  date.setUTCFullYear(fields.year, fields.month - 1, fields.day);
  date.setUTCHours(fields.hour, fields.minute, fields.second, 0);
  return date.getTime();
}

function equalFields(left: LocalFields, right: LocalFields): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function offsetAt(epochMilliseconds: number, zone: string): number {
  const fields = fieldsAt(epochMilliseconds, zone);
  const asUtc = utcFromFields(fields);
  return asUtc - Math.floor(epochMilliseconds / 1000) * 1000;
}

function possibleOffsets(around: number, zone: string): Set<number> {
  const offsets = new Set<number>();
  const halfRange = 36 * 60 * 60 * 1000;
  const step = 3 * 60 * 60 * 1000;
  for (let sample = around - halfRange; sample <= around + halfRange; sample += step) {
    offsets.add(offsetAt(sample, zone));
  }
  return offsets;
}

function resolveLocalFields(fields: LocalFields, zone: string): number[] {
  const naive = utcFromFields(fields);
  const instants = new Set<number>();
  for (const offset of possibleOffsets(naive, zone)) {
    const candidate = naive - offset;
    if (equalFields(fieldsAt(candidate, zone), fields)) instants.add(candidate);
  }
  return [...instants].sort((left, right) => left - right);
}

function earliestInstantOnDate(dateKey: string, zone: string): number {
  const exactMidnights = resolveLocalFields(parseLocalDateTime(`${dateKey}T00:00`), zone);
  const exactMidnight = exactMidnights[0];
  if (exactMidnight !== undefined) return exactMidnight;

  // Some zones advance at midnight. Find the first representable minute whose
  // local date is still the requested date, and fail if that date was skipped.
  const targetDay = utcFromFields(parseLocalDateTime(`${dateKey}T00:00`));
  const lower = targetDay - 36 * 60 * 60 * 1000;
  const upper = targetDay + 36 * 60 * 60 * 1000;
  const minute = 60_000;
  const firstAligned = Math.ceil(lower / minute) * minute;
  for (let instant = firstAligned; instant <= upper; instant += minute) {
    if (localDate(fieldsAt(instant, zone)) === dateKey) return instant;
  }
  throw new RangeError(`Local calendar date ${dateKey} does not exist in ${zone}`);
}

function startOfNextExistingDate(dateKey: string, zone: string): number {
  for (let daysAhead = 1; daysAhead <= 14; daysAhead += 1) {
    const candidate = addDays(dateKey, daysAhead);
    try {
      return earliestInstantOnDate(candidate, zone);
    } catch (error) {
      if (
        error instanceof RangeError &&
        error.message === `Local calendar date ${candidate} does not exist in ${zone}`
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new RangeError(`No next local calendar date could be resolved after ${dateKey} in ${zone}`);
}

function addDays(dateKey: string, amount: number): string {
  const date = new Date(utcFromFields(parseLocalDateTime(`${dateKey}T12:00`)));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function iso(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toISOString();
}

/** Returns the Gregorian local date containing an absolute instant. */
export function dateKeyInZone(instant: Date | string, zone: string): string {
  const epoch = parseInstant(instant);
  return localDate(fieldsAt(epoch, zone));
}

/** Returns an absolute half-open UTC window and its local calendar date keys. */
export function getCalendarWindow(
  dateKey: string,
  view: CalendarView,
  zone: string,
): CalendarWindow {
  assertDateKey(dateKey);
  formatter(zone);
  if (view !== "day" && view !== "week" && view !== "list") {
    throw new RangeError(`Invalid calendar view: ${String(view)}`);
  }

  let firstDate = dateKey;
  let dayCount = 1;
  if (view === "week") {
    const weekday = new Date(utcFromFields(parseLocalDateTime(`${dateKey}T12:00`))).getUTCDay();
    firstDate = addDays(dateKey, -((weekday + 6) % 7));
    dayCount = 7;
  } else if (view === "list") {
    dayCount = 7;
  }
  const days = Array.from({ length: dayCount }, (_, index) => addDays(firstDate, index));
  const firstDay = days[0];
  const lastDay = days.at(-1);
  if (firstDay === undefined || lastDay === undefined) {
    throw new RangeError("Calendar window contains no local dates");
  }
  const localDayStarts = days.map((day) => earliestInstantOnDate(day, zone));
  const from = localDayStarts[0];
  if (from === undefined) throw new RangeError("Calendar window contains no local dates");
  const to = startOfNextExistingDate(lastDay, zone);
  return { from: iso(from), to: iso(to), days };
}

/** Returns visible local dates intersecting an appointment's half-open interval. */
export function getVisibleAppointmentDays(
  startsAt: string,
  endsAt: string,
  days: readonly string[],
  zone: string,
): string[] {
  const startsAtEpoch = parseInstant(startsAt);
  const endsAtEpoch = parseInstant(endsAt);
  if (endsAtEpoch <= startsAtEpoch) {
    throw new RangeError("Appointment endsAt must be later than startsAt");
  }
  formatter(zone);

  return days.filter((day) => {
    assertDateKey(day);
    const dayStart = earliestInstantOnDate(day, zone);
    const dayEnd = startOfNextExistingDate(day, zone);
    return startsAtEpoch < dayEnd && endsAtEpoch > dayStart;
  });
}

/** Returns every instant represented by a local wall time; gaps yield []. */
export function resolveLocalTime(localDateTime: string, zone: string): string[] {
  formatter(zone);
  return resolveLocalFields(parseLocalDateTime(localDateTime), zone).map(iso);
}

/** Formats an absolute instant using Intl in the explicitly selected zone. */
export function formatZoned(instant: Date | string, zone: string, locale?: string): string {
  const epoch = parseInstant(instant);
  const key = `${locale ?? "default"}\u0000${zone}`;
  let current = displayFormatterCache.get(key);
  if (current === undefined) {
    try {
      current = new Intl.DateTimeFormat(locale, {
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        month: "short",
        timeZone: zone,
        timeZoneName: "longOffset",
        year: "numeric",
      });
      current.format(0);
    } catch {
      throw new RangeError(`Invalid IANA timezone or locale: ${zone}`);
    }
    displayFormatterCache.set(key, current);
  }
  return current.format(epoch);
}

/** Returns an unambiguous local field string suitable for datetime-local UI. */
export function formatLocalDateTime(instant: Date | string, zone: string): string {
  return localDateTime(fieldsAt(parseInstant(instant), zone));
}
