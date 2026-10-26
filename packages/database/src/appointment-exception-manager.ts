import {
  type AppointmentAvailabilityException,
  type AppointmentAvailabilityExceptionType,
  Prisma,
} from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess, type TenantTransactionDatabase } from "./tenant-data-access";
import { assertTenantOperational } from "./tenant-operational";

export type AppointmentAvailabilityExceptionMutationMetadata = Readonly<{
  actorUserId: string;
  requestId: string;
}>;

export type AppointmentAvailabilityExceptionInput = Readonly<{
  resourceId: string;
  type?: AppointmentAvailabilityExceptionType;
  startsAt: string;
  endsAt: string;
  reason?: string | null;
  active?: boolean;
}>;

export type AppointmentAvailabilityExceptionPatch = Readonly<{
  type?: AppointmentAvailabilityExceptionType | undefined;
  startsAt?: string | undefined;
  endsAt?: string | undefined;
  reason?: string | null | undefined;
  active?: boolean | undefined;
}>;

export type AppointmentAvailabilityExceptionListFilters = Readonly<{
  resourceId?: string;
  type?: AppointmentAvailabilityExceptionType;
  from?: string;
  to?: string;
  active?: boolean;
  limit?: number;
  offset?: number;
}>;

export type AppointmentAvailabilityExceptionManagerDatabase = TenantTransactionDatabase &
  Pick<
    Prisma.TransactionClient,
    "appointmentAvailabilityException" | "appointmentResource" | "tenant"
  >;

export type AppointmentAvailabilityExceptionListPage = Readonly<{
  items: readonly AppointmentAvailabilityException[];
  total: number;
}>;

export class AppointmentAvailabilityExceptionNotFoundError extends Error {
  override readonly name = "AppointmentAvailabilityExceptionNotFoundError";
  constructor(readonly availabilityExceptionId: string) {
    super("Appointment availability exception was not found");
  }
}

export class AppointmentAvailabilityExceptionValidationError extends Error {
  override readonly name = "AppointmentAvailabilityExceptionValidationError";
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OFFSET_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/;
const PATCH_FIELDS = new Set(["type", "startsAt", "endsAt", "reason", "active"]);
const TYPES = new Set<AppointmentAvailabilityExceptionType>(["BLOCKED", "EXTRA_AVAILABILITY"]);

function requireUuidV7(value: string, field: string): void {
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) {
    throw new AppointmentAvailabilityExceptionValidationError(`${field} must be a UUIDv7`);
  }
}

function requireMetadata(metadata: AppointmentAvailabilityExceptionMutationMetadata): void {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    typeof metadata.actorUserId !== "string" ||
    !metadata.actorUserId.trim() ||
    typeof metadata.requestId !== "string" ||
    !metadata.requestId.trim()
  ) {
    throw new AppointmentAvailabilityExceptionValidationError(
      "actorUserId and requestId are required",
    );
  }
}

function normalizeType(
  value: AppointmentAvailabilityExceptionType | undefined,
): AppointmentAvailabilityExceptionType {
  if (value === undefined) return "BLOCKED";
  if (!TYPES.has(value))
    throw new AppointmentAvailabilityExceptionValidationError(
      "type must be BLOCKED or EXTRA_AVAILABILITY",
    );
  return value;
}

function normalizeActive(value: boolean | undefined): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw new AppointmentAvailabilityExceptionValidationError("active must be a boolean");
  }
  return value;
}

function normalizeReason(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string")
    throw new AppointmentAvailabilityExceptionValidationError("reason must be a string or null");
  const reason = value.trim();
  if (reason.length > 255)
    throw new AppointmentAvailabilityExceptionValidationError(
      "reason must be at most 255 characters",
    );
  return reason || null;
}

function normalizeTimestamp(value: string, field: "startsAt" | "endsAt"): Date {
  if (typeof value !== "string")
    throw new AppointmentAvailabilityExceptionValidationError(
      `${field} must be a valid ISO timestamp with an explicit offset`,
    );
  const match = OFFSET_DATETIME_PATTERN.exec(value);
  if (match === null)
    throw new AppointmentAvailabilityExceptionValidationError(
      `${field} must be an ISO timestamp with an explicit offset`,
    );
  const [, yearRaw, monthRaw, dayRaw, , , , , sign, offsetHourRaw, offsetMinuteRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const calendar = new Date(0);
  calendar.setUTCHours(0, 0, 0, 0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (
    year < 1 ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) {
    throw new AppointmentAvailabilityExceptionValidationError(
      `${field} must contain a valid calendar date`,
    );
  }
  if (sign !== undefined) {
    const hour = Number(offsetHourRaw);
    const minute = Number(offsetMinuteRaw);
    if (hour > 14 || minute > 59 || (hour === 14 && minute !== 0)) {
      throw new AppointmentAvailabilityExceptionValidationError(
        `${field} must contain a valid ISO offset`,
      );
    }
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new AppointmentAvailabilityExceptionValidationError(
      `${field} must be a valid ISO timestamp`,
    );
  return date;
}

function assertInterval(startsAt: Date, endsAt: Date): void {
  if (startsAt >= endsAt)
    throw new AppointmentAvailabilityExceptionValidationError(
      "startsAt must be earlier than endsAt",
    );
}

function summary(item: AppointmentAvailabilityException): Prisma.InputJsonObject {
  return {
    active: item.active,
    endsAt: item.endsAt.toISOString(),
    reason: item.reason,
    resourceId: item.resourceId,
    startsAt: item.startsAt.toISOString(),
    type: item.type,
  };
}

async function lockExceptionRow(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  id: string,
): Promise<void> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "appointment_availability_exceptions"
    WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${id}::uuid
    FOR UPDATE
  `);
  if (rows.length === 0) throw new AppointmentAvailabilityExceptionNotFoundError(id);
}

async function assertActiveResource(
  database: Pick<Prisma.TransactionClient, "appointmentResource">,
  tenantId: string,
  resourceId: string,
): Promise<void> {
  const resource = await database.appointmentResource.findFirst({
    select: { id: true },
    where: { active: true, id: resourceId, tenantId },
  });
  if (resource === null)
    throw new AppointmentAvailabilityExceptionValidationError(
      "resourceId must identify an active resource in the tenant",
    );
}

async function recordMutation(
  context: TenantContext,
  transaction: Prisma.TransactionClient,
  item: AppointmentAvailabilityException,
  metadata: AppointmentAvailabilityExceptionMutationMetadata,
  action: "created" | "updated",
  before?: AppointmentAvailabilityException,
): Promise<void> {
  const access = createTenantDataAccess(context, transaction);
  await access.audit.append({
    action: `appointment_availability_exception.${action}`,
    actorId: metadata.actorUserId,
    actorType: "tenant_user",
    ...(before === undefined ? {} : { beforeSummary: summary(before) }),
    afterSummary: summary(item),
    entityId: item.id,
    entityType: "AppointmentAvailabilityException",
    requestId: metadata.requestId,
  });
  await access.outbox.append({
    aggregateId: item.id,
    aggregateType: "AppointmentAvailabilityException",
    eventType: `appointment_availability_exception.${action}`,
    payload: { appointmentAvailabilityExceptionId: item.id, tenantId: context.tenantId },
  });
}

export async function createAvailabilityException(
  context: TenantContext,
  database: AppointmentAvailabilityExceptionManagerDatabase,
  input: AppointmentAvailabilityExceptionInput,
  metadata: AppointmentAvailabilityExceptionMutationMetadata,
): Promise<AppointmentAvailabilityException> {
  const tenant = createTenantContext(context.tenantId);
  requireMetadata(metadata);
  requireUuidV7(input.resourceId, "resourceId");
  const type = normalizeType(input.type);
  const startsAt = normalizeTimestamp(input.startsAt, "startsAt");
  const endsAt = normalizeTimestamp(input.endsAt, "endsAt");
  assertInterval(startsAt, endsAt);
  const reason = normalizeReason(input.reason);
  const active = normalizeActive(input.active);
  return database.$transaction(async (transaction) => {
    await assertTenantOperational(tenant, transaction);
    await assertActiveResource(transaction, tenant.tenantId, input.resourceId);
    const item = await transaction.appointmentAvailabilityException.create({
      data: {
        ...(reason === undefined ? {} : { reason }),
        ...(active === undefined ? {} : { active }),
        endsAt,
        resourceId: input.resourceId,
        startsAt,
        tenantId: tenant.tenantId,
        type,
      },
    });
    await recordMutation(tenant, transaction, item, metadata, "created");
    return item;
  });
}

export async function getAvailabilityExceptionById(
  context: TenantContext,
  database: AppointmentAvailabilityExceptionManagerDatabase,
  id: string,
): Promise<AppointmentAvailabilityException> {
  const tenant = createTenantContext(context.tenantId);
  requireUuidV7(id, "id");
  const item = await database.appointmentAvailabilityException.findFirst({
    where: { id, tenantId: tenant.tenantId },
  });
  if (item === null) throw new AppointmentAvailabilityExceptionNotFoundError(id);
  return item;
}

export async function listAvailabilityExceptions(
  context: TenantContext,
  database: AppointmentAvailabilityExceptionManagerDatabase,
  filters: AppointmentAvailabilityExceptionListFilters = {},
): Promise<AppointmentAvailabilityExceptionListPage> {
  const tenant = createTenantContext(context.tenantId);
  const limit = filters.limit ?? DEFAULT_PAGE_SIZE;
  const offset = filters.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE)
    throw new AppointmentAvailabilityExceptionValidationError(
      `limit must be between 1 and ${MAX_PAGE_SIZE}`,
    );
  if (!Number.isInteger(offset) || offset < 0)
    throw new AppointmentAvailabilityExceptionValidationError(
      "offset must be a non-negative integer",
    );
  if (filters.resourceId !== undefined) requireUuidV7(filters.resourceId, "resourceId");
  const active = normalizeActive(filters.active);
  const type = filters.type === undefined ? undefined : normalizeType(filters.type);
  const from =
    filters.from === undefined ? undefined : normalizeTimestamp(filters.from, "startsAt");
  const to = filters.to === undefined ? undefined : normalizeTimestamp(filters.to, "endsAt");
  if (from !== undefined && to !== undefined && from >= to)
    throw new AppointmentAvailabilityExceptionValidationError("from must be earlier than to");
  const where: Prisma.AppointmentAvailabilityExceptionWhereInput = {
    tenantId: tenant.tenantId,
    ...(filters.resourceId === undefined ? {} : { resourceId: filters.resourceId }),
    ...(type === undefined ? {} : { type }),
    ...(active === undefined ? {} : { active }),
    ...(from === undefined && to === undefined
      ? {}
      : {
          startsAt: { ...(to === undefined ? {} : { lt: to }) },
          endsAt: { ...(from === undefined ? {} : { gt: from }) },
        }),
  };
  const [items, total] = await Promise.all([
    database.appointmentAvailabilityException.findMany({
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      skip: offset,
      take: limit,
      where,
    }),
    database.appointmentAvailabilityException.count({ where }),
  ]);
  return { items, total };
}

export async function updateAvailabilityException(
  context: TenantContext,
  database: AppointmentAvailabilityExceptionManagerDatabase,
  id: string,
  patch: AppointmentAvailabilityExceptionPatch,
  metadata: AppointmentAvailabilityExceptionMutationMetadata,
): Promise<AppointmentAvailabilityException> {
  const tenant = createTenantContext(context.tenantId);
  requireMetadata(metadata);
  requireUuidV7(id, "id");
  if (patch === null || typeof patch !== "object" || Array.isArray(patch))
    throw new AppointmentAvailabilityExceptionValidationError("patch must be an object");
  const unsupported = Object.keys(patch).find((field) => !PATCH_FIELDS.has(field));
  if (unsupported !== undefined)
    throw new AppointmentAvailabilityExceptionValidationError(
      `Unsupported availability exception field: ${unsupported}`,
    );
  if (!Object.values(patch).some((value) => value !== undefined))
    throw new AppointmentAvailabilityExceptionValidationError("At least one field must be updated");
  const data: Prisma.AppointmentAvailabilityExceptionUncheckedUpdateInput = {};
  if (patch.type !== undefined) data.type = normalizeType(patch.type);
  if (patch.startsAt !== undefined) data.startsAt = normalizeTimestamp(patch.startsAt, "startsAt");
  if (patch.endsAt !== undefined) data.endsAt = normalizeTimestamp(patch.endsAt, "endsAt");
  if (patch.reason !== undefined) data.reason = normalizeReason(patch.reason) as string | null;
  if (patch.active !== undefined) data.active = normalizeActive(patch.active) as boolean;
  return database.$transaction(async (transaction) => {
    await assertTenantOperational(tenant, transaction);
    await lockExceptionRow(transaction, tenant.tenantId, id);
    const before = await transaction.appointmentAvailabilityException.findFirst({
      where: { id, tenantId: tenant.tenantId },
    });
    if (before === null) throw new AppointmentAvailabilityExceptionNotFoundError(id);
    const startsAt = patch.startsAt === undefined ? before.startsAt : (data.startsAt as Date);
    const endsAt = patch.endsAt === undefined ? before.endsAt : (data.endsAt as Date);
    assertInterval(startsAt, endsAt);
    const item = await transaction.appointmentAvailabilityException.update({
      data,
      where: { id, tenantId: tenant.tenantId },
    });
    await recordMutation(tenant, transaction, item, metadata, "updated", before);
    return item;
  });
}

export async function deleteAvailabilityException(
  context: TenantContext,
  database: AppointmentAvailabilityExceptionManagerDatabase,
  id: string,
  metadata: AppointmentAvailabilityExceptionMutationMetadata,
): Promise<AppointmentAvailabilityException> {
  const tenant = createTenantContext(context.tenantId);
  requireMetadata(metadata);
  requireUuidV7(id, "id");
  return database.$transaction(async (transaction) => {
    await assertTenantOperational(tenant, transaction);
    await lockExceptionRow(transaction, tenant.tenantId, id);
    const before = await transaction.appointmentAvailabilityException.findFirst({
      where: { id, tenantId: tenant.tenantId },
    });
    if (before === null) throw new AppointmentAvailabilityExceptionNotFoundError(id);
    const access = createTenantDataAccess(tenant, transaction);
    await access.audit.append({
      action: "appointment_availability_exception.deleted",
      actorId: metadata.actorUserId,
      actorType: "tenant_user",
      beforeSummary: summary(before),
      entityId: before.id,
      entityType: "AppointmentAvailabilityException",
      requestId: metadata.requestId,
    });
    await transaction.appointmentAvailabilityException.delete({
      where: { id, tenantId: tenant.tenantId },
    });
    await access.outbox.append({
      aggregateId: before.id,
      aggregateType: "AppointmentAvailabilityException",
      eventType: "appointment_availability_exception.deleted",
      payload: { appointmentAvailabilityExceptionId: before.id, tenantId: tenant.tenantId },
    });
    return before;
  });
}
