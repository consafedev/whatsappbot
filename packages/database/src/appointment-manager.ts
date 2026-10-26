import { AppointmentAvailabilityQueryValidationError } from "./appointment-availability-calculator";
import { parseAppointmentOffsetTimestamp } from "./appointment-exception-manager";
import { findAppointmentAvailability } from "./appointment-slot-query";
import type { Appointment, AppointmentStatus, Prisma } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess, type TenantTransactionDatabase } from "./tenant-data-access";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

export type AppointmentMutationMetadata = Readonly<{ actorUserId: string; requestId: string }>;
export type CreateAppointmentInput = Readonly<{
  serviceId: string;
  resourceId: string;
  contactId: string;
  startsAt: string;
  idempotencyKey: string;
  notes?: string | null;
}>;
export type AppointmentListFilters = Readonly<{
  resourceId?: string;
  serviceId?: string;
  contactId?: string;
  organizationUnitId?: string;
  status?: AppointmentStatus;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}>;
export type AppointmentManagerDatabase = TenantTransactionDatabase &
  Pick<
    Prisma.TransactionClient,
    | "tenant"
    | "tenantEntitlement"
    | "user"
    | "contact"
    | "appointment"
    | "appointmentService"
    | "appointmentResource"
    | "appointmentAvailabilityRule"
    | "appointmentAvailabilityException"
  >;
export class AppointmentValidationError extends Error {
  override readonly name = "AppointmentValidationError";
}
export class AppointmentNotFoundError extends Error {
  override readonly name = "AppointmentNotFoundError";
}
export class AppointmentConflictError extends Error {
  override readonly name = "AppointmentConflictError";
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: string, field: string): void {
  if (typeof value !== "string" || !UUID_V7.test(value))
    throw new AppointmentValidationError(`${field} must be a UUIDv7`);
}

function offsetTime(value: string, field: string): Date {
  try {
    return parseAppointmentOffsetTimestamp(value, field);
  } catch {
    throw new AppointmentValidationError(
      `${field} must be an ISO timestamp with an explicit offset`,
    );
  }
}

function normalize(input: CreateAppointmentInput): {
  startsAt: Date;
  notes: string | null;
  idempotencyKey: string;
} {
  uuid(input.serviceId, "serviceId");
  uuid(input.resourceId, "resourceId");
  uuid(input.contactId, "contactId");
  const startsAt = offsetTime(input.startsAt, "startsAt");
  if (startsAt.getTime() % 60_000 !== 0)
    throw new AppointmentValidationError("startsAt must be minute aligned");
  if (
    typeof input.idempotencyKey !== "string" ||
    input.idempotencyKey.trim().length < 1 ||
    input.idempotencyKey.trim().length > 128
  )
    throw new AppointmentValidationError("idempotencyKey must contain 1 to 128 characters");
  if (input.notes !== undefined && input.notes !== null && typeof input.notes !== "string")
    throw new AppointmentValidationError("notes must be a string or null");
  const notes = input.notes?.trim() || null;
  if (notes !== null && notes.length > 2000)
    throw new AppointmentValidationError("notes must not exceed 2000 characters");
  return { startsAt, notes, idempotencyKey: input.idempotencyKey.trim() };
}

function sameCommand(
  existing: Appointment,
  input: CreateAppointmentInput,
  normalized: ReturnType<typeof normalize>,
  actor: string,
): boolean {
  return (
    existing.serviceId === input.serviceId.toLowerCase() &&
    existing.resourceId === input.resourceId.toLowerCase() &&
    existing.contactId === input.contactId.toLowerCase() &&
    existing.startsAt.getTime() === normalized.startsAt.getTime() &&
    existing.notes === normalized.notes &&
    existing.createdByUserId === actor.toLowerCase() &&
    existing.source === "dashboard"
  );
}

// Called only inside the caller's transaction. S07 may reuse this after its own row lock.
export async function createAppointmentInTransaction(
  tenant: TenantContext,
  transaction: Prisma.TransactionClient,
  input: CreateAppointmentInput,
  normalized: ReturnType<typeof normalize>,
  metadata: AppointmentMutationMetadata,
): Promise<Appointment> {
  await assertTenantOperational(tenant, transaction);
  await assertTenantModuleEntitled(tenant, "module.appointments", transaction);
  const actor = await transaction.user.findFirst({
    where: { id: metadata.actorUserId, tenantId: tenant.tenantId, status: "active" },
    select: { id: true },
  });
  if (actor === null)
    throw new AppointmentValidationError("actorUserId must be an active tenant user");
  await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`${tenant.tenantId.toLowerCase()}:${normalized.idempotencyKey}`}, 0))`;
  const existing = await transaction.appointment.findUnique({
    where: {
      tenantId_idempotencyKey: {
        tenantId: tenant.tenantId,
        idempotencyKey: normalized.idempotencyKey,
      },
    },
  });
  if (existing !== null) {
    if (!sameCommand(existing, input, normalized, metadata.actorUserId))
      throw new AppointmentConflictError(
        "Idempotency key belongs to a different appointment command",
      );
    return existing;
  }
  const lockedResources = await transaction.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM appointment_resources WHERE tenant_id = ${tenant.tenantId}::uuid AND id = ${input.resourceId}::uuid FOR UPDATE`;
  if (lockedResources.length !== 1) throw new AppointmentNotFoundError("Resource was not found");
  const lockedServices = await transaction.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM appointment_services WHERE tenant_id = ${tenant.tenantId}::uuid AND id = ${input.serviceId}::uuid FOR SHARE`;
  if (lockedServices.length !== 1) throw new AppointmentNotFoundError("Service was not found");
  const [service, resource, contact] = await Promise.all([
    transaction.appointmentService.findFirst({
      where: { tenantId: tenant.tenantId, id: input.serviceId, active: true },
      include: { organizationUnit: true },
    }),
    transaction.appointmentResource.findFirst({
      where: { tenantId: tenant.tenantId, id: input.resourceId, active: true },
      include: { organizationUnit: true },
    }),
    transaction.contact.findFirst({
      where: { tenantId: tenant.tenantId, id: input.contactId, status: "ACTIVE" },
      select: { id: true },
    }),
  ]);
  if (
    service === null ||
    resource === null ||
    contact === null ||
    (service.organizationUnitId !== null &&
      resource.organizationUnitId !== null &&
      service.organizationUnitId !== resource.organizationUnitId) ||
    (service.organizationUnit !== null && !service.organizationUnit.active) ||
    (resource.organizationUnit !== null && !resource.organizationUnit.active)
  )
    throw new AppointmentNotFoundError("Appointment target was not found");
  const endsAt = new Date(normalized.startsAt.getTime() + service.durationMinutes * 60_000);
  if (!Number.isFinite(endsAt.getTime()))
    throw new AppointmentValidationError("Appointment end is invalid");
  let availability: Awaited<ReturnType<typeof findAppointmentAvailability>>;
  try {
    availability = await findAppointmentAvailability(tenant, transaction, {
      serviceId: input.serviceId,
      resourceId: input.resourceId,
      from: normalized.startsAt.toISOString(),
      to: endsAt.toISOString(),
      limit: 1,
    });
  } catch (error) {
    if (error instanceof AppointmentAvailabilityQueryValidationError)
      throw new AppointmentValidationError(error.message);
    throw error;
  }
  const slot = availability.slots.find(
    (candidate) =>
      candidate.startsAt === normalized.startsAt.toISOString() &&
      candidate.endsAt === endsAt.toISOString() &&
      candidate.capacity > 0,
  );
  if (slot === undefined)
    throw new AppointmentConflictError("Requested appointment slot is unavailable");
  const appointment = await transaction.appointment.create({
    data: {
      tenantId: tenant.tenantId,
      organizationUnitId: resource.organizationUnitId ?? service.organizationUnitId,
      contactId: input.contactId,
      serviceId: input.serviceId,
      resourceId: input.resourceId,
      createdByUserId: metadata.actorUserId,
      idempotencyKey: normalized.idempotencyKey,
      status: "CONFIRMED",
      confirmationStatus: "CONFIRMED",
      startsAt: normalized.startsAt,
      endsAt: new Date(slot.endsAt),
      occupiedStartsAt: new Date(
        normalized.startsAt.getTime() - service.bufferBeforeMinutes * 60_000,
      ),
      occupiedEndsAt: new Date(endsAt.getTime() + service.bufferAfterMinutes * 60_000),
      durationMinutes: service.durationMinutes,
      bufferBeforeMinutes: service.bufferBeforeMinutes,
      bufferAfterMinutes: service.bufferAfterMinutes,
      timezoneSnapshot: availability.timezone,
      source: "dashboard",
      notes: normalized.notes,
    },
  });
  const access = createTenantDataAccess(tenant, transaction);
  const summary = {
    appointmentId: appointment.id,
    serviceId: appointment.serviceId,
    resourceId: appointment.resourceId,
    contactId: appointment.contactId,
    status: appointment.status,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    occupiedStartsAt: appointment.occupiedStartsAt.toISOString(),
    occupiedEndsAt: appointment.occupiedEndsAt.toISOString(),
    timezoneSnapshot: appointment.timezoneSnapshot,
    durationMinutes: appointment.durationMinutes,
    bufferBeforeMinutes: appointment.bufferBeforeMinutes,
    bufferAfterMinutes: appointment.bufferAfterMinutes,
  };
  await access.audit.append({
    action: "appointment.created",
    actorId: metadata.actorUserId,
    actorType: "tenant_user",
    afterSummary: summary,
    entityId: appointment.id,
    entityType: "Appointment",
    requestId: metadata.requestId,
  });
  await access.outbox.append({
    aggregateId: appointment.id,
    aggregateType: "Appointment",
    eventType: "appointment.created",
    payload: { tenantId: tenant.tenantId, ...summary },
  });
  return appointment;
}

export async function createAppointment(
  context: TenantContext,
  database: AppointmentManagerDatabase,
  input: CreateAppointmentInput,
  metadata: AppointmentMutationMetadata,
): Promise<Appointment> {
  const tenant = createTenantContext(context.tenantId);
  uuid(metadata.actorUserId, "actorUserId");
  if (typeof metadata.requestId !== "string" || metadata.requestId.trim().length === 0)
    throw new AppointmentValidationError("requestId is required");
  const normalized = normalize(input);
  return database.$transaction((transaction) =>
    createAppointmentInTransaction(tenant, transaction, input, normalized, metadata),
  );
}

export async function getAppointmentById(
  context: TenantContext,
  database: AppointmentManagerDatabase,
  id: string,
): Promise<Appointment> {
  const tenant = createTenantContext(context.tenantId);
  uuid(id, "id");
  await assertTenantOperational(tenant, database);
  await assertTenantModuleEntitled(tenant, "module.appointments", database);
  const appointment = await database.appointment.findFirst({
    where: { tenantId: tenant.tenantId, id },
  });
  if (appointment === null) throw new AppointmentNotFoundError("Appointment was not found");
  return appointment;
}

export async function listAppointments(
  context: TenantContext,
  database: AppointmentManagerDatabase,
  filters: AppointmentListFilters = {},
): Promise<{ items: Appointment[]; total: number }> {
  const tenant = createTenantContext(context.tenantId);
  await assertTenantOperational(tenant, database);
  await assertTenantModuleEntitled(tenant, "module.appointments", database);
  for (const field of ["resourceId", "serviceId", "contactId", "organizationUnitId"] as const)
    if (filters[field] !== undefined) uuid(filters[field], field);
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(offset) ||
    offset < 0
  )
    throw new AppointmentValidationError("Invalid appointment pagination");
  if (
    filters.status !== undefined &&
    !["REQUESTED", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW", "RESCHEDULED"].includes(
      filters.status,
    )
  )
    throw new AppointmentValidationError("Invalid appointment status");
  const from = filters.from === undefined ? undefined : offsetTime(filters.from, "from");
  const to = filters.to === undefined ? undefined : offsetTime(filters.to, "to");
  if (from !== undefined && to !== undefined && from >= to)
    throw new AppointmentValidationError("from must be before to");
  const where: Prisma.AppointmentWhereInput = {
    tenantId: tenant.tenantId,
    ...(filters.resourceId === undefined ? {} : { resourceId: filters.resourceId }),
    ...(filters.serviceId === undefined ? {} : { serviceId: filters.serviceId }),
    ...(filters.contactId === undefined ? {} : { contactId: filters.contactId }),
    ...(filters.organizationUnitId === undefined
      ? {}
      : { organizationUnitId: filters.organizationUnitId }),
    ...(filters.status === undefined ? {} : { status: filters.status }),
    ...(from === undefined ? {} : { endsAt: { gt: from } }),
    ...(to === undefined ? {} : { startsAt: { lt: to } }),
  };
  const [items, total] = await Promise.all([
    database.appointment.findMany({
      where,
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: limit,
      skip: offset,
    }),
    database.appointment.count({ where }),
  ]);
  return { items, total };
}
