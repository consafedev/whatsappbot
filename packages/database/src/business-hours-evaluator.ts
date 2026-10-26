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
 * - If config is null or undefined -> returns true; empty schedules mean 24/7 weekly hours.
 * - Resolves local date and time in the tenant's configured timezone (with fallback to UTC on invalid IANA timezone).
 * - If current date in tenant timezone is in `config.holidays` -> returns false.
 * - A closed or missing current day starts no new opening, but may receive an overnight carry.
 * - If `isOpen === true` without specific time limits -> returns true (all day).
 * - An overnight window belongs to its opening weekday and carries into the next morning.
 *   Holidays close the current local date and cancel carry from a holiday opening date.
 */
export function isWithinBusinessHours(
  config: BusinessHoursConfig | null | undefined,
  now?: Date,
): boolean {
  if (!config || !Array.isArray(config.schedules)) {
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

  // A dated holiday closes the whole local calendar day, including overnight carry.
  if (Array.isArray(config.holidays) && config.holidays.includes(yyyyMmDd)) {
    return false;
  }

  if (config.schedules.length === 0) return true;

  // The current weekday owns openings that begin today.
  const schedule = config.schedules.find((s) => s.dayOfWeek === dayOfWeek);
  if (schedule?.isOpen) {
    if (!schedule.openTime || !schedule.closeTime) return true;
    const openTime = schedule.openTime.trim();
    const closeTime = schedule.closeTime.trim();
    if (openTime.length === 0 || closeTime.length === 0) return true;
    if (closeTime > openTime && currentHhMm >= openTime && currentHhMm < closeTime) return true;
    if (closeTime < openTime && currentHhMm >= openTime) return true;
  }

  // A prior-day overnight opening may continue even when today is marked closed.
  const previous = config.schedules.find((s) => s.dayOfWeek === (dayOfWeek + 6) % 7);
  if (previous?.isOpen && previous.openTime && previous.closeTime) {
    const openTime = previous.openTime.trim();
    const closeTime = previous.closeTime.trim();
    if (closeTime < openTime && currentHhMm < closeTime) {
      const previousDate = new Date(Date.UTC(year, month - 1, day) - 86_400_000)
        .toISOString()
        .slice(0, 10);
      return !Array.isArray(config.holidays) || !config.holidays.includes(previousDate);
    }
  }
  return false;
}
