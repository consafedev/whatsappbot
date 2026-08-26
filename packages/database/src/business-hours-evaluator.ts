export interface DaySchedule {
  dayOfWeek: number; // 0 (Domingo) .. 6 (Sábado)
  isOpen: boolean;
  openTime?: string; // "09:00" formato 24h HH:mm
  closeTime?: string; // "18:00" formato 24h HH:mm
}

export interface BusinessHoursConfig {
  timezone: string; // ej. "America/Mexico_City"
  schedules: DaySchedule[];
  holidays?: string[]; // Fechas YYYY-MM-DD
}

/**
 * Pure and deterministic evaluator for business hours schedules.
 * Evaluates whether a given timestamp falls within the active business hours window.
 *
 * Rules:
 * - If config is null, undefined, or schedules array is empty -> returns true (24/7 continuous hours).
 * - Resolves local date and time in the tenant's configured timezone (with fallback to UTC on invalid IANA timezone).
 * - If current date in tenant timezone is in `config.holidays` -> returns false.
 * - If current day of week has no schedule or `isOpen === false` -> returns false.
 * - If `isOpen === true` without specific time limits -> returns true (all day).
 * - Validates current local time against `[openTime, closeTime)` (supporting standard daytime and overnight intervals).
 */
export function isWithinBusinessHours(
  config: BusinessHoursConfig | null | undefined,
  now?: Date,
): boolean {
  if (!config || !Array.isArray(config.schedules) || config.schedules.length === 0) {
    return true;
  }

  let timezone = "UTC";
  if (config.timezone && typeof config.timezone === "string") {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: config.timezone });
      timezone = config.timezone;
    } catch {
      timezone = "UTC";
    }
  }

  const currentDate = now ?? new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: timezone,
    year: "numeric",
  });

  const parts = formatter.formatToParts(currentDate);
  const partMap: Record<string, string> = {};
  for (const part of parts) {
    partMap[part.type] = part.value;
  }

  const year = Number(partMap.year);
  const month = Number(partMap.month);
  const day = Number(partMap.day);
  const yyyyMmDd = `${partMap.year}-${partMap.month}-${partMap.day}`;
  const currentHhMm = `${partMap.hour}:${partMap.minute}`;
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  // Check holidays
  if (Array.isArray(config.holidays) && config.holidays.includes(yyyyMmDd)) {
    return false;
  }

  // Find schedule for current weekday
  const schedule = config.schedules.find((s) => s.dayOfWeek === dayOfWeek);
  if (!schedule?.isOpen) {
    return false;
  }

  if (!schedule.openTime || !schedule.closeTime) {
    return true;
  }

  const openTime = schedule.openTime.trim();
  const closeTime = schedule.closeTime.trim();
  if (openTime.length === 0 || closeTime.length === 0) {
    return true;
  }

  if (closeTime > openTime) {
    return currentHhMm >= openTime && currentHhMm < closeTime;
  }

  if (closeTime < openTime) {
    // Overnight window (e.g. 22:00 to 06:00)
    return currentHhMm >= openTime || currentHhMm < closeTime;
  }

  return false;
}
