import {
  AppointmentAvailabilityQueryValidationError,
  type AppointmentAvailabilityResult,
  calculateAppointmentAvailability,
  isValidAppointmentTimezone,
  parseAppointmentAvailabilityRange,
} from "./appointment-availability-calculator";
import { parseAppointmentCalendarDate } from "./appointment-availability-manager";
import type { BusinessHoursConfig, DaySchedule } from "./business-hours-evaluator";
import type { Prisma } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export type AppointmentAvailabilityQueryDatabase = Pick<
  Prisma.TransactionClient,
  | "tenant"
  | "tenantEntitlement"
  | "appointmentService"
  | "appointmentResource"
  | "appointmentAvailabilityRule"
  | "appointmentAvailabilityException"
  | "appointment"
>;
export type FindAppointmentAvailabilityInput = Readonly<{
  serviceId: string;
  resourceId: string;
  from: string;
  to: string;
  limit?: number;
}>;

export class AppointmentAvailabilityTargetNotFoundError extends Error {
  override readonly name = "AppointmentAvailabilityTargetNotFoundError";
  constructor() {
    super("Appointment service or resource was not found");
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validCalendarDate(value: string): boolean {
  try {
    return parseAppointmentCalendarDate(value, "holiday") !== null;
  } catch {
    return false;
  }
}

function parseBusinessHours(value: unknown): BusinessHoursConfig {
  const config = object(value);
  if (
    config === null ||
    Object.keys(config).some((key) => !["timezone", "schedules", "holidays"].includes(key))
  ) {
    throw new AppointmentAvailabilityQueryValidationError(
      "businessHours must be a valid configuration object",
    );
  }
  if (
    typeof config.timezone !== "string" ||
    config.timezone.length === 0 ||
    config.timezone.length > 100
  ) {
    throw new AppointmentAvailabilityQueryValidationError("businessHours timezone is invalid");
  }
  if (!isValidAppointmentTimezone(config.timezone)) {
    throw new AppointmentAvailabilityQueryValidationError("businessHours timezone is invalid");
  }
  if (!Array.isArray(config.schedules) || config.schedules.length > 7) {
    throw new AppointmentAvailabilityQueryValidationError("businessHours schedules are invalid");
  }
  const schedules: DaySchedule[] = [];
  const seen = new Set<number>();
  for (const raw of config.schedules) {
    const schedule = object(raw);
    if (
      schedule === null ||
      Object.keys(schedule).some(
        (key) => !["dayOfWeek", "isOpen", "openTime", "closeTime"].includes(key),
      ) ||
      !Number.isInteger(schedule.dayOfWeek) ||
      (schedule.dayOfWeek as number) < 0 ||
      (schedule.dayOfWeek as number) > 6 ||
      seen.has(schedule.dayOfWeek as number) ||
      typeof schedule.isOpen !== "boolean"
    ) {
      throw new AppointmentAvailabilityQueryValidationError("businessHours schedule is invalid");
    }
    seen.add(schedule.dayOfWeek as number);
    const hasOpen = Object.hasOwn(schedule, "openTime");
    const hasClose = Object.hasOwn(schedule, "closeTime");
    if (
      hasOpen !== hasClose ||
      (hasOpen &&
        (typeof schedule.openTime !== "string" ||
          typeof schedule.closeTime !== "string" ||
          !TIME_PATTERN.test(schedule.openTime) ||
          !TIME_PATTERN.test(schedule.closeTime) ||
          schedule.openTime === schedule.closeTime))
    ) {
      throw new AppointmentAvailabilityQueryValidationError(
        "businessHours time bounds are invalid",
      );
    }
    schedules.push({
      dayOfWeek: schedule.dayOfWeek as number,
      isOpen: schedule.isOpen,
      ...(hasOpen
        ? { openTime: schedule.openTime as string, closeTime: schedule.closeTime as string }
        : {}),
    });
  }
  let holidays: string[] | undefined;
  if (config.holidays !== undefined) {
    if (
      !Array.isArray(config.holidays) ||
      config.holidays.length > 366 ||
      config.holidays.some((item) => typeof item !== "string" || !validCalendarDate(item))
    ) {
      throw new AppointmentAvailabilityQueryValidationError("businessHours holidays are invalid");
    }
    holidays = config.holidays as string[];
  }
  return { timezone: config.timezone, schedules, ...(holidays === undefined ? {} : { holidays }) };
}

function selectBusinessHours(...sources: unknown[]): BusinessHoursConfig | null {
  for (const source of sources) {
    const settings = object(source);
    if (settings !== null && Object.hasOwn(settings, "businessHours")) {
      return parseBusinessHours(settings.businessHours);
    }
  }
  return null;
}

export async function findAppointmentAvailability(
  context: TenantContext,
  database: AppointmentAvailabilityQueryDatabase,
  input: FindAppointmentAvailabilityInput,
): Promise<AppointmentAvailabilityResult> {
  const tenantContext = createTenantContext(context.tenantId);
  if (!UUID_V7_PATTERN.test(input.serviceId) || !UUID_V7_PATTERN.test(input.resourceId)) {
    throw new AppointmentAvailabilityQueryValidationError(
      "serviceId and resourceId must be UUIDv7",
    );
  }
  const { from, to } = parseAppointmentAvailabilityRange(input.from, input.to);
  if (
    input.limit !== undefined &&
    (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500)
  ) {
    throw new AppointmentAvailabilityQueryValidationError("limit must be between 1 and 500");
  }
  await assertTenantOperational(tenantContext, database);
  await assertTenantModuleEntitled(tenantContext, "module.appointments", database);
  const [tenant, service, resource] = await Promise.all([
    database.tenant.findUnique({
      where: { id: tenantContext.tenantId },
      select: { defaultTimezone: true, settings: true },
    }),
    database.appointmentService.findFirst({
      where: { id: input.serviceId, tenantId: tenantContext.tenantId, active: true },
      include: { organizationUnit: true },
    }),
    database.appointmentResource.findFirst({
      where: { id: input.resourceId, tenantId: tenantContext.tenantId, active: true },
      include: { organizationUnit: true },
    }),
  ]);
  if (
    tenant === null ||
    service === null ||
    resource === null ||
    (service.organizationUnitId !== null &&
      resource.organizationUnitId !== null &&
      service.organizationUnitId !== resource.organizationUnitId) ||
    (service.organizationUnit !== null && !service.organizationUnit.active) ||
    (resource.organizationUnit !== null && !resource.organizationUnit.active)
  ) {
    throw new AppointmentAvailabilityTargetNotFoundError();
  }
  const timezone =
    resource.organizationUnit?.timezone ??
    service.organizationUnit?.timezone ??
    tenant.defaultTimezone;
  const businessHours = selectBusinessHours(
    resource.metadata,
    resource.organizationUnit?.settings,
    service.settings,
    service.organizationUnit?.settings,
    tenant.settings,
  );
  const before = service.bufferBeforeMinutes * 60_000;
  const after = service.bufferAfterMinutes * 60_000;
  if (before > 86_400_000 || after > 86_400_000) {
    throw new AppointmentAvailabilityQueryValidationError(
      "buffer exceeds the bounded calculation range",
    );
  }
  const [rules, exceptions, appointments] = await Promise.all([
    database.appointmentAvailabilityRule.findMany({
      where: {
        tenantId: tenantContext.tenantId,
        resourceId: resource.id,
        active: true,
        OR: [{ serviceId: service.id }, { serviceId: null }],
      },
      take: 1_001,
    }),
    database.appointmentAvailabilityException.findMany({
      where: {
        tenantId: tenantContext.tenantId,
        resourceId: resource.id,
        active: true,
        startsAt: { lt: new Date(to + after) },
        endsAt: { gt: new Date(from - before) },
      },
      take: 1_001,
    }),
    database.appointment.findMany({
      where: {
        tenantId: tenantContext.tenantId,
        resourceId: resource.id,
        status: { in: ["REQUESTED", "CONFIRMED"] },
        occupiedStartsAt: { lt: new Date(to + after) },
        occupiedEndsAt: { gt: new Date(from - before) },
      },
      select: { occupiedStartsAt: true, occupiedEndsAt: true },
      take: 1_001,
    }),
  ]);
  if (rules.length > 1_000 || exceptions.length > 1_000 || appointments.length > 1_000) {
    throw new AppointmentAvailabilityQueryValidationError(
      "availability query exceeds the 1000-record limit",
    );
  }
  return calculateAppointmentAvailability({
    from: input.from,
    to: input.to,
    timezone,
    resourceId: resource.id,
    resourceCapacity: resource.capacity,
    durationMinutes: service.durationMinutes,
    bufferBeforeMinutes: service.bufferBeforeMinutes,
    bufferAfterMinutes: service.bufferAfterMinutes,
    rules,
    exceptions,
    occupied: appointments.map((item) => ({
      startsAt: item.occupiedStartsAt,
      endsAt: item.occupiedEndsAt,
      capacity: 1,
    })),
    businessHours,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
}
