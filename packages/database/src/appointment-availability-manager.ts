import type { AppointmentAvailabilityRule, Prisma } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess, type TenantTransactionDatabase } from "./tenant-data-access";
import { assertTenantOperational } from "./tenant-operational";

export type AppointmentAvailabilityRuleMutationMetadata = Readonly<{
  actorUserId: string;
  requestId: string;
}>;

export type AppointmentAvailabilityRuleInput = Readonly<{
  resourceId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone?: string | null;
  effectiveFrom?: Date | string | null;
  effectiveTo?: Date | string | null;
  capacity?: number;
  active?: boolean;
}>;

export type AppointmentAvailabilityRulePatch = Readonly<{
  dayOfWeek?: number | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  timezone?: string | null | undefined;
  effectiveFrom?: Date | string | null | undefined;
  effectiveTo?: Date | string | null | undefined;
  capacity?: number | undefined;
  active?: boolean | undefined;
}>;

export type AppointmentAvailabilityRuleListFilters = Readonly<{
  resourceId?: string;
  dayOfWeek?: number;
  active?: boolean;
  limit?: number;
  offset?: number;
}>;

export type AppointmentAvailabilityRuleManagerDatabase = TenantTransactionDatabase &
  Pick<Prisma.TransactionClient, "appointmentAvailabilityRule" | "appointmentResource" | "tenant">;

export type AppointmentAvailabilityRuleListPage = Readonly<{
  items: readonly AppointmentAvailabilityRule[];
  total: number;
}>;

export class AppointmentAvailabilityRuleNotFoundError extends Error {
  override readonly name = "AppointmentAvailabilityRuleNotFoundError";

  constructor(readonly availabilityRuleId: string) {
    super("Appointment availability rule was not found");
  }
}

export class AppointmentAvailabilityRuleValidationError extends Error {
  override readonly name = "AppointmentAvailabilityRuleValidationError";
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_CAPACITY = 2_147_483_647;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AVAILABILITY_RULE_PATCH_FIELDS = new Set([
  "dayOfWeek",
  "startTime",
  "endTime",
  "timezone",
  "effectiveFrom",
  "effectiveTo",
  "capacity",
  "active",
]);

function requireUuidV7(value: string, field: string): void {
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) {
    throw new AppointmentAvailabilityRuleValidationError(`${field} must be a UUIDv7`);
  }
}

function requireMetadata(metadata: AppointmentAvailabilityRuleMutationMetadata): void {
  if (
    typeof metadata.actorUserId !== "string" ||
    !metadata.actorUserId.trim() ||
    typeof metadata.requestId !== "string" ||
    !metadata.requestId.trim()
  ) {
    throw new AppointmentAvailabilityRuleValidationError("actorUserId and requestId are required");
  }
}

function normalizeDayOfWeek(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 6) {
    throw new AppointmentAvailabilityRuleValidationError(
      "dayOfWeek must be an integer from 0 to 6",
    );
  }
  return value;
}

function normalizeTime(value: string, field: "startTime" | "endTime"): string {
  if (typeof value !== "string" || !TIME_PATTERN.test(value)) {
    throw new AppointmentAvailabilityRuleValidationError(`${field} must use HH:mm 24-hour time`);
  }
  return value;
}

function assertTimeRange(startTime: string, endTime: string): void {
  if (startTime >= endTime) {
    throw new AppointmentAvailabilityRuleValidationError("startTime must be earlier than endTime");
  }
}

function normalizeCapacity(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > MAX_CAPACITY) {
    throw new AppointmentAvailabilityRuleValidationError(
      `capacity must be an integer between 1 and ${MAX_CAPACITY}`,
    );
  }
  return value;
}

function normalizeActive(value: boolean | undefined): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw new AppointmentAvailabilityRuleValidationError("active must be a boolean");
  }
  return value;
}

function normalizeTimezone(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") {
    throw new AppointmentAvailabilityRuleValidationError(
      "timezone must be an IANA timezone or null",
    );
  }
  const timezone = value.trim();
  if (timezone.length === 0 || timezone.length > 100) {
    throw new AppointmentAvailabilityRuleValidationError(
      "timezone must contain 1 to 100 characters",
    );
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new AppointmentAvailabilityRuleValidationError("timezone must be a valid IANA timezone");
  }
  return timezone;
}

function normalizeDate(
  value: Date | string | null | undefined,
  field: "effectiveFrom" | "effectiveTo",
): Date | null | undefined {
  if (value === undefined || value === null) return value;
  let day: string;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new AppointmentAvailabilityRuleValidationError(
        `${field} must be a valid calendar date`,
      );
    }
    day = value.toISOString().slice(0, 10);
  } else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    day = value;
  } else {
    throw new AppointmentAvailabilityRuleValidationError(`${field} must use YYYY-MM-DD`);
  }
  const normalized = new Date(`${day}T00:00:00.000Z`);
  if (
    !Number.isFinite(normalized.getTime()) ||
    normalized.getUTCFullYear() < 1 ||
    normalized.toISOString().slice(0, 10) !== day
  ) {
    throw new AppointmentAvailabilityRuleValidationError(`${field} must be a valid calendar date`);
  }
  return normalized;
}

function assertDateRange(from: Date | null | undefined, to: Date | null | undefined): void {
  if (from !== null && from !== undefined && to !== null && to !== undefined && from > to) {
    throw new AppointmentAvailabilityRuleValidationError(
      "effectiveFrom must be on or before effectiveTo",
    );
  }
}

function ruleSummary(rule: AppointmentAvailabilityRule): Prisma.InputJsonObject {
  return {
    active: rule.active,
    capacity: rule.capacity,
    dayOfWeek: rule.dayOfWeek,
    effectiveFrom: rule.effectiveFrom?.toISOString() ?? null,
    effectiveTo: rule.effectiveTo?.toISOString() ?? null,
    endTime: rule.endTime,
    resourceId: rule.resourceId,
    startTime: rule.startTime,
    timezone: rule.timezone,
  };
}

function availabilityRuleWhere(
  tenantId: string,
  id: string,
): Prisma.AppointmentAvailabilityRuleWhereUniqueInput {
  return { id, tenantId };
}

async function assertActiveResourceBelongsToTenant(
  database: Pick<Prisma.TransactionClient, "appointmentResource">,
  tenantId: string,
  resourceId: string,
): Promise<void> {
  const resource = await database.appointmentResource.findFirst({
    select: { id: true },
    where: { active: true, id: resourceId, tenantId },
  });
  if (resource === null) {
    throw new AppointmentAvailabilityRuleValidationError(
      "resourceId must identify an active resource in the tenant",
    );
  }
}

async function recordMutation(
  context: TenantContext,
  transaction: Prisma.TransactionClient,
  rule: AppointmentAvailabilityRule,
  metadata: AppointmentAvailabilityRuleMutationMetadata,
  action: "created" | "updated",
  before?: AppointmentAvailabilityRule,
): Promise<void> {
  const access = createTenantDataAccess(context, transaction);
  await access.audit.append({
    action: `appointment_availability_rule.${action}`,
    actorId: metadata.actorUserId,
    actorType: "tenant_user",
    ...(before === undefined ? {} : { beforeSummary: ruleSummary(before) }),
    afterSummary: ruleSummary(rule),
    entityId: rule.id,
    entityType: "AppointmentAvailabilityRule",
    requestId: metadata.requestId,
  });
  await access.outbox.append({
    aggregateId: rule.id,
    aggregateType: "AppointmentAvailabilityRule",
    eventType: `appointment_availability_rule.${action}`,
    payload: { appointmentAvailabilityRuleId: rule.id, tenantId: context.tenantId },
  });
}

export async function createAvailabilityRule(
  context: TenantContext,
  database: AppointmentAvailabilityRuleManagerDatabase,
  input: AppointmentAvailabilityRuleInput,
  mutationMetadata: AppointmentAvailabilityRuleMutationMetadata,
): Promise<AppointmentAvailabilityRule> {
  const tenant = createTenantContext(context.tenantId);
  requireMetadata(mutationMetadata);
  requireUuidV7(input.resourceId, "resourceId");
  const dayOfWeek = normalizeDayOfWeek(input.dayOfWeek);
  const startTime = normalizeTime(input.startTime, "startTime");
  const endTime = normalizeTime(input.endTime, "endTime");
  assertTimeRange(startTime, endTime);
  const timezone = normalizeTimezone(input.timezone);
  const effectiveFrom = normalizeDate(input.effectiveFrom, "effectiveFrom");
  const effectiveTo = normalizeDate(input.effectiveTo, "effectiveTo");
  assertDateRange(effectiveFrom, effectiveTo);
  const capacity = normalizeCapacity(input.capacity);
  const active = normalizeActive(input.active);

  return database.$transaction(async (transaction) => {
    await assertTenantOperational(tenant, transaction);
    await assertActiveResourceBelongsToTenant(transaction, tenant.tenantId, input.resourceId);
    const rule = await transaction.appointmentAvailabilityRule.create({
      data: {
        ...(timezone === undefined ? {} : { timezone }),
        ...(effectiveFrom === undefined ? {} : { effectiveFrom }),
        ...(effectiveTo === undefined ? {} : { effectiveTo }),
        ...(capacity === undefined ? {} : { capacity }),
        ...(active === undefined ? {} : { active }),
        dayOfWeek,
        endTime,
        resourceId: input.resourceId,
        startTime,
        tenantId: tenant.tenantId,
      },
    });
    await recordMutation(tenant, transaction, rule, mutationMetadata, "created");
    return rule;
  });
}

export async function getAvailabilityRuleById(
  context: TenantContext,
  database: AppointmentAvailabilityRuleManagerDatabase,
  id: string,
): Promise<AppointmentAvailabilityRule> {
  const tenant = createTenantContext(context.tenantId);
  requireUuidV7(id, "id");
  const rule = await database.appointmentAvailabilityRule.findFirst({
    where: { id, tenantId: tenant.tenantId },
  });
  if (rule === null) throw new AppointmentAvailabilityRuleNotFoundError(id);
  return rule;
}

export async function listAvailabilityRules(
  context: TenantContext,
  database: AppointmentAvailabilityRuleManagerDatabase,
  filters: AppointmentAvailabilityRuleListFilters = {},
): Promise<AppointmentAvailabilityRuleListPage> {
  const tenant = createTenantContext(context.tenantId);
  const limit = filters.limit ?? DEFAULT_PAGE_SIZE;
  const offset = filters.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new AppointmentAvailabilityRuleValidationError(
      `limit must be between 1 and ${MAX_PAGE_SIZE}`,
    );
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new AppointmentAvailabilityRuleValidationError("offset must be a non-negative integer");
  }
  const dayOfWeek =
    filters.dayOfWeek === undefined ? undefined : normalizeDayOfWeek(filters.dayOfWeek);
  if (filters.resourceId !== undefined) requireUuidV7(filters.resourceId, "resourceId");
  const active = normalizeActive(filters.active);
  const where: Prisma.AppointmentAvailabilityRuleWhereInput = {
    tenantId: tenant.tenantId,
    ...(filters.resourceId === undefined ? {} : { resourceId: filters.resourceId }),
    ...(dayOfWeek === undefined ? {} : { dayOfWeek }),
    ...(active === undefined ? {} : { active }),
  };
  const [items, total] = await Promise.all([
    database.appointmentAvailabilityRule.findMany({
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }, { id: "asc" }],
      skip: offset,
      take: limit,
      where,
    }),
    database.appointmentAvailabilityRule.count({ where }),
  ]);
  return { items, total };
}

export async function updateAvailabilityRule(
  context: TenantContext,
  database: AppointmentAvailabilityRuleManagerDatabase,
  id: string,
  patch: AppointmentAvailabilityRulePatch,
  mutationMetadata: AppointmentAvailabilityRuleMutationMetadata,
): Promise<AppointmentAvailabilityRule> {
  const tenant = createTenantContext(context.tenantId);
  requireMetadata(mutationMetadata);
  requireUuidV7(id, "id");
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    throw new AppointmentAvailabilityRuleValidationError("patch must be an object");
  }
  const unsupportedField = Object.keys(patch).find(
    (field) => !AVAILABILITY_RULE_PATCH_FIELDS.has(field),
  );
  if (unsupportedField !== undefined) {
    throw new AppointmentAvailabilityRuleValidationError(
      `Unsupported availability rule field: ${unsupportedField}`,
    );
  }
  if (!Object.values(patch).some((value) => value !== undefined)) {
    throw new AppointmentAvailabilityRuleValidationError("At least one field must be updated");
  }

  const data: Prisma.AppointmentAvailabilityRuleUncheckedUpdateInput = {};
  if (patch.dayOfWeek !== undefined) data.dayOfWeek = normalizeDayOfWeek(patch.dayOfWeek);
  if (patch.startTime !== undefined) data.startTime = normalizeTime(patch.startTime, "startTime");
  if (patch.endTime !== undefined) data.endTime = normalizeTime(patch.endTime, "endTime");
  if (patch.timezone !== undefined)
    data.timezone = normalizeTimezone(patch.timezone) as string | null;
  if (patch.effectiveFrom !== undefined) {
    data.effectiveFrom = normalizeDate(patch.effectiveFrom, "effectiveFrom") as Date | null;
  }
  if (patch.effectiveTo !== undefined) {
    data.effectiveTo = normalizeDate(patch.effectiveTo, "effectiveTo") as Date | null;
  }
  if (patch.capacity !== undefined) data.capacity = normalizeCapacity(patch.capacity) as number;
  if (patch.active !== undefined) data.active = normalizeActive(patch.active) as boolean;

  return database.$transaction(async (transaction) => {
    await assertTenantOperational(tenant, transaction);
    const before = await transaction.appointmentAvailabilityRule.findFirst({
      where: { id, tenantId: tenant.tenantId },
    });
    if (before === null) throw new AppointmentAvailabilityRuleNotFoundError(id);

    const startTime = patch.startTime === undefined ? before.startTime : (data.startTime as string);
    const endTime = patch.endTime === undefined ? before.endTime : (data.endTime as string);
    assertTimeRange(startTime, endTime);
    const effectiveFrom =
      patch.effectiveFrom === undefined
        ? before.effectiveFrom
        : (data.effectiveFrom as Date | null);
    const effectiveTo =
      patch.effectiveTo === undefined ? before.effectiveTo : (data.effectiveTo as Date | null);
    assertDateRange(effectiveFrom, effectiveTo);

    const rule = await transaction.appointmentAvailabilityRule.update({
      data,
      where: availabilityRuleWhere(tenant.tenantId, id),
    });
    await recordMutation(tenant, transaction, rule, mutationMetadata, "updated", before);
    return rule;
  });
}

export async function deleteAvailabilityRule(
  context: TenantContext,
  database: AppointmentAvailabilityRuleManagerDatabase,
  id: string,
  mutationMetadata: AppointmentAvailabilityRuleMutationMetadata,
): Promise<AppointmentAvailabilityRule> {
  const tenant = createTenantContext(context.tenantId);
  requireMetadata(mutationMetadata);
  requireUuidV7(id, "id");
  return database.$transaction(async (transaction) => {
    await assertTenantOperational(tenant, transaction);
    const before = await transaction.appointmentAvailabilityRule.findFirst({
      where: { id, tenantId: tenant.tenantId },
    });
    if (before === null) throw new AppointmentAvailabilityRuleNotFoundError(id);
    await transaction.appointmentAvailabilityRule.delete({
      where: availabilityRuleWhere(tenant.tenantId, id),
    });
    const access = createTenantDataAccess(tenant, transaction);
    await access.audit.append({
      action: "appointment_availability_rule.deleted",
      actorId: mutationMetadata.actorUserId,
      actorType: "tenant_user",
      beforeSummary: ruleSummary(before),
      entityId: before.id,
      entityType: "AppointmentAvailabilityRule",
      requestId: mutationMetadata.requestId,
    });
    await access.outbox.append({
      aggregateId: before.id,
      aggregateType: "AppointmentAvailabilityRule",
      eventType: "appointment_availability_rule.deleted",
      payload: { appointmentAvailabilityRuleId: before.id, tenantId: tenant.tenantId },
    });
    return before;
  });
}
