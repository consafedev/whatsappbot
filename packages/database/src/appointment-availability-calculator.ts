import { parseAppointmentCalendarDate } from "./appointment-availability-manager";
import { parseAppointmentOffsetTimestamp } from "./appointment-exception-manager";
import { type BusinessHoursConfig, isWithinBusinessHours } from "./business-hours-evaluator";

const MINUTE = 60_000;
const DAY = 86_400_000;
const MAX_RANGE = 7 * DAY;
const MAX_RECORDS = 1_000;
const IANA_ZONE_PATTERN = /^[A-Za-z_][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

export function isValidAppointmentTimezone(value: string): boolean {
  if (!IANA_ZONE_PATTERN.test(value) || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export type AvailabilityRuleWindow = Readonly<{
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone: string | null;
  effectiveFrom: Date | string | null;
  effectiveTo: Date | string | null;
  serviceId: string | null;
  capacity: number;
}>;
export type AvailabilityExceptionWindow = Readonly<{
  type: "BLOCKED" | "EXTRA_AVAILABILITY";
  startsAt: Date | string;
  endsAt: Date | string;
}>;
export type OccupiedAppointmentInterval = Readonly<{
  startsAt: Date | string;
  endsAt: Date | string;
  capacity: number;
}>;
export type AppointmentAvailabilityInput = Readonly<{
  from: string;
  to: string;
  timezone: string;
  resourceId: string;
  resourceCapacity: number;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  rules: readonly AvailabilityRuleWindow[];
  exceptions: readonly AvailabilityExceptionWindow[];
  occupied: readonly OccupiedAppointmentInterval[];
  businessHours: BusinessHoursConfig | null;
  limit?: number;
}>;
export type AppointmentAvailabilityResult = Readonly<{
  timezone: string;
  slots: readonly Readonly<{
    startsAt: string;
    endsAt: string;
    resourceId: string;
    capacity: number;
  }>[];
  nextFrom?: string;
}>;

export class AppointmentAvailabilityQueryValidationError extends Error {
  override readonly name = "AppointmentAvailabilityQueryValidationError";
}

type LocalMinute = Readonly<{ date: string; dayOfWeek: number; time: string }>;
const formatters = new Map<string, Intl.DateTimeFormat>();

function localMinute(at: number, timezone: string): LocalMinute {
  let formatter = formatters.get(timezone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      timeZone: timezone,
      year: "numeric",
    });
    formatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    date,
    dayOfWeek: new Date(`${date}T00:00:00.000Z`).getUTCDay(),
    time: `${parts.hour}:${parts.minute}`,
  };
}

function instant(value: Date | string, field: string): number {
  if (value instanceof Date) {
    if (Number.isFinite(value.getTime())) return value.getTime();
    throw new AppointmentAvailabilityQueryValidationError(`${field} must be a valid timestamp`);
  }
  try {
    return parseAppointmentOffsetTimestamp(value, field).getTime();
  } catch {
    throw new AppointmentAvailabilityQueryValidationError(
      `${field} must be a valid ISO timestamp with an explicit offset`,
    );
  }
}

export function parseAppointmentAvailabilityRange(
  from: string,
  to: string,
): { from: number; to: number } {
  const first = instant(from, "from");
  const last = instant(to, "to");
  if (first >= last || last - first > MAX_RANGE) {
    throw new AppointmentAvailabilityQueryValidationError(
      "range must be positive and at most 7 elapsed days",
    );
  }
  return { from: first, to: last };
}

function calendarDate(value: Date | string | null): string | null {
  if (value === null) return null;
  try {
    return (
      parseAppointmentCalendarDate(value, "effective date")?.toISOString().slice(0, 10) ?? null
    );
  } catch {
    throw new AppointmentAvailabilityQueryValidationError("effective date is invalid");
  }
}

function lowerBound(values: readonly number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((values[mid] ?? Number.POSITIVE_INFINITY) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function calculateAppointmentAvailability(
  input: AppointmentAvailabilityInput,
): AppointmentAvailabilityResult {
  const { from, to } = parseAppointmentAvailabilityRange(input.from, input.to);
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new AppointmentAvailabilityQueryValidationError("limit must be between 1 and 500");
  }
  if (
    !Number.isInteger(input.resourceCapacity) ||
    input.resourceCapacity < 1 ||
    !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes < 1 ||
    !Number.isInteger(input.bufferBeforeMinutes) ||
    input.bufferBeforeMinutes < 0 ||
    !Number.isInteger(input.bufferAfterMinutes) ||
    input.bufferAfterMinutes < 0
  ) {
    throw new AppointmentAvailabilityQueryValidationError(
      "capacity, duration and buffers must be valid integers",
    );
  }
  if (
    input.rules.length > MAX_RECORDS ||
    input.exceptions.length > MAX_RECORDS ||
    input.occupied.length > MAX_RECORDS
  ) {
    throw new AppointmentAvailabilityQueryValidationError(
      "availability input exceeds the 1000-record limit",
    );
  }
  if (!isValidAppointmentTimezone(input.timezone)) {
    throw new AppointmentAvailabilityQueryValidationError("timezone must be an IANA timezone");
  }
  const before = input.bufferBeforeMinutes * MINUTE;
  const after = input.bufferAfterMinutes * MINUTE;
  const duration = input.durationMinutes * MINUTE;
  if (before > DAY || after > DAY || duration > MAX_RANGE) {
    throw new AppointmentAvailabilityQueryValidationError(
      "duration or buffer exceeds the bounded calculation range",
    );
  }
  const scanFrom = Math.floor((from - before) / MINUTE) * MINUTE;
  const scanTo = Math.ceil((to + after) / MINUTE) * MINUTE;
  const rulesByZone = new Map<
    string,
    Array<AvailabilityRuleWindow & { fromDate: string | null; toDate: string | null }>
  >();
  for (const rule of input.rules) {
    const zone = rule.timezone ?? input.timezone;
    if (!isValidAppointmentTimezone(zone)) {
      throw new AppointmentAvailabilityQueryValidationError(
        "rule timezone must be an IANA timezone",
      );
    }
    const bucket = rulesByZone.get(zone) ?? [];
    bucket.push({
      ...rule,
      fromDate: calendarDate(rule.effectiveFrom),
      toDate: calendarDate(rule.effectiveTo),
    });
    rulesByZone.set(zone, bucket);
  }
  const scanMinutes = (scanTo - scanFrom) / MINUTE;
  if (
    scanMinutes * Math.max(1, rulesByZone.size) > 200_000 ||
    scanMinutes * Math.max(1, input.rules.length) > 5_000_000
  ) {
    throw new AppointmentAvailabilityQueryValidationError(
      "availability calculation exceeds work budget; use a smaller range",
    );
  }

  const minuteCapacity: number[] = [];
  const businessOpen: boolean[] = [];
  for (let minute = scanFrom; minute < scanTo; minute += MINUTE) {
    let capacity = 0;
    for (const [zone, rules] of rulesByZone) {
      const local = localMinute(minute, zone);
      for (const rule of rules) {
        if (
          rule.dayOfWeek === local.dayOfWeek &&
          rule.startTime <= local.time &&
          local.time < rule.endTime &&
          (rule.fromDate === null || rule.fromDate <= local.date) &&
          (rule.toDate === null || local.date <= rule.toDate)
        ) {
          capacity = Math.max(capacity, rule.capacity);
        }
      }
    }
    capacity = Math.min(capacity, input.resourceCapacity);
    const open =
      input.businessHours === null || isWithinBusinessHours(input.businessHours, new Date(minute));
    businessOpen.push(open);
    if (!open) capacity = 0;
    minuteCapacity.push(capacity);
  }

  type Delta = { extra: number; blocked: number; occupied: number };
  const events = new Map<number, Delta>();
  const boundaries = new Set<number>();
  for (let minute = scanFrom; minute <= scanTo; minute += MINUTE) boundaries.add(minute);
  function addEvent(at: number, field: keyof Delta, amount: number): void {
    const bounded = Math.min(scanTo, Math.max(scanFrom, at));
    boundaries.add(bounded);
    const delta = events.get(bounded) ?? { extra: 0, blocked: 0, occupied: 0 };
    delta[field] += amount;
    events.set(bounded, delta);
  }
  for (const exception of input.exceptions) {
    const start = instant(exception.startsAt, "exception startsAt");
    const end = instant(exception.endsAt, "exception endsAt");
    if (start >= end)
      throw new AppointmentAvailabilityQueryValidationError("exception interval must be positive");
    const field = exception.type === "BLOCKED" ? "blocked" : "extra";
    addEvent(start, field, 1);
    addEvent(end, field, -1);
  }
  for (const interval of input.occupied) {
    const start = instant(interval.startsAt, "occupied startsAt");
    const end = instant(interval.endsAt, "occupied endsAt");
    if (start >= end || !Number.isInteger(interval.capacity) || interval.capacity < 1) {
      throw new AppointmentAvailabilityQueryValidationError(
        "occupied interval and capacity must be valid",
      );
    }
    addEvent(start, "occupied", interval.capacity);
    addEvent(end, "occupied", -interval.capacity);
  }
  const points = [...boundaries].sort((a, b) => a - b);
  const available: number[] = [];
  let extra = 0,
    blocked = 0,
    occupied = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const at = points[i] ?? scanTo;
    const delta = events.get(at);
    if (delta) {
      extra += delta.extra;
      blocked += delta.blocked;
      occupied += delta.occupied;
    }
    const base = minuteCapacity[Math.floor((at - scanFrom) / MINUTE)] ?? 0;
    const open = businessOpen[Math.floor((at - scanFrom) / MINUTE)] ?? false;
    available.push(
      (blocked > 0 || !open ? 0 : extra > 0 ? input.resourceCapacity : base) - occupied,
    );
  }
  let size = 1;
  while (size < available.length) size *= 2;
  const tree = Array<number>(2 * size).fill(Number.POSITIVE_INFINITY);
  for (let i = 0; i < available.length; i++)
    tree[size + i] = available[i] ?? Number.POSITIVE_INFINITY;
  for (let i = size - 1; i > 0; i--)
    tree[i] = Math.min(
      tree[i * 2] ?? Number.POSITIVE_INFINITY,
      tree[i * 2 + 1] ?? Number.POSITIVE_INFINITY,
    );
  function minimum(start: number, end: number): number {
    let left = lowerBound(points, start + 1) - 1 + size;
    let right = lowerBound(points, end) + size;
    let value = Number.POSITIVE_INFINITY;
    while (left < right) {
      if (left & 1) value = Math.min(value, tree[left++] ?? Number.POSITIVE_INFINITY);
      if (right & 1) value = Math.min(value, tree[--right] ?? Number.POSITIVE_INFINITY);
      left >>= 1;
      right >>= 1;
    }
    return value;
  }
  const slots: Array<{ startsAt: string; endsAt: string; resourceId: string; capacity: number }> =
    [];
  for (let start = Math.ceil(from / MINUTE) * MINUTE; start + duration <= to; start += MINUTE) {
    const capacity = minimum(start - before, start + duration + after);
    if (capacity <= 0) continue;
    if (slots.length === limit)
      return { timezone: input.timezone, slots, nextFrom: new Date(start).toISOString() };
    slots.push({
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + duration).toISOString(),
      resourceId: input.resourceId,
      capacity,
    });
  }
  return { timezone: input.timezone, slots };
}
