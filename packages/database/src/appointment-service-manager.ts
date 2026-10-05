import { type AppointmentService, Prisma } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess, type TenantTransactionDatabase } from "./tenant-data-access";
import { assertTenantOperational } from "./tenant-operational";

export type AppointmentServiceMutationMetadata = Readonly<{
  actorUserId: string;
  requestId: string;
}>;

export type AppointmentServiceInput = Readonly<{
  name: string;
  description?: string | null;
  durationMinutes: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  price?: number | string | Prisma.Decimal | null;
  currency?: string;
  organizationUnitId?: string | null;
  settings?: Record<string, unknown>;
}>;

export type AppointmentServicePatch = Partial<
  Readonly<{
    name: string;
    description: string | null;
    durationMinutes: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    price: number | string | Prisma.Decimal | null;
    currency: string;
    organizationUnitId: string | null;
    active: boolean;
    settings: Record<string, unknown>;
  }>
>;

export type AppointmentServiceListFilters = Readonly<{
  active?: boolean;
  organizationUnitId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}>;

export type AppointmentServiceManagerDatabase = TenantTransactionDatabase &
  Pick<Prisma.TransactionClient, "appointmentService" | "organizationUnit" | "tenant">;

export type AppointmentServiceListPage = Readonly<{
  items: readonly AppointmentService[];
  total: number;
}>;

export class AppointmentServiceNotFoundError extends Error {
  override readonly name = "AppointmentServiceNotFoundError";

  constructor(readonly appointmentServiceId: string) {
    super("Appointment service was not found");
  }
}

export class AppointmentServiceValidationError extends Error {
  override readonly name = "AppointmentServiceValidationError";
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;
const MAX_INTEGER_COLUMN = 2_147_483_647;

function requireMetadata(metadata: AppointmentServiceMutationMetadata): void {
  if (!metadata.actorUserId.trim() || !metadata.requestId.trim()) {
    throw new AppointmentServiceValidationError("actorUserId and requestId are required");
  }
}

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0 || normalized.length > 150) {
    throw new AppointmentServiceValidationError("name must contain between 1 and 150 characters");
  }
  return normalized;
}

function normalizeDuration(value: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_INTEGER_COLUMN) {
    throw new AppointmentServiceValidationError(
      `durationMinutes must be a positive integer no greater than ${MAX_INTEGER_COLUMN}`,
    );
  }
  return value;
}

function normalizeBuffer(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > MAX_INTEGER_COLUMN) {
    throw new AppointmentServiceValidationError(
      `${field} must be a non-negative integer no greater than ${MAX_INTEGER_COLUMN}`,
    );
  }
  return value;
}

function normalizeCurrency(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new AppointmentServiceValidationError("currency must be a three-character code");
  }
  return currency;
}

function normalizePrice(
  value: number | string | Prisma.Decimal | null | undefined,
): Prisma.Decimal | null | undefined {
  if (value === undefined || value === null) return value;
  let price: Prisma.Decimal;
  try {
    price = new Prisma.Decimal(value);
  } catch {
    throw new AppointmentServiceValidationError("price must be a valid non-negative amount");
  }
  if (!price.isFinite() || price.isNegative()) {
    throw new AppointmentServiceValidationError("price must be a valid non-negative amount");
  }
  if (price.decimalPlaces() > 2 || price.gte("10000000000")) {
    throw new AppointmentServiceValidationError("price exceeds NUMERIC(12,2) precision");
  }
  return price;
}

function normalizeSettings(value: Record<string, unknown>): Prisma.InputJsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    throw new AppointmentServiceValidationError("settings must be valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppointmentServiceValidationError("settings must be a JSON object");
  }
  return parsed as Prisma.InputJsonObject;
}

function auditSummary(service: AppointmentService): Prisma.InputJsonObject {
  return {
    active: service.active,
    bufferAfterMinutes: service.bufferAfterMinutes,
    bufferBeforeMinutes: service.bufferBeforeMinutes,
    currency: service.currency,
    description: service.description,
    durationMinutes: service.durationMinutes,
    name: service.name,
    organizationUnitId: service.organizationUnitId,
    price: service.price?.toFixed(2) ?? null,
  };
}

async function assertOrganizationUnitBelongsToTenant(
  database: Pick<Prisma.TransactionClient, "organizationUnit">,
  tenantId: string,
  organizationUnitId: string,
): Promise<void> {
  const unit = await database.organizationUnit.findFirst({
    select: { id: true },
    where: { id: organizationUnitId, tenantId },
  });
  if (unit === null) {
    throw new AppointmentServiceValidationError("organizationUnitId must belong to the tenant");
  }
}

function serviceWhere(tenantId: string, id: string): Prisma.AppointmentServiceWhereUniqueInput {
  return { id, tenantId };
}

async function recordMutation(
  context: TenantContext,
  transaction: Prisma.TransactionClient,
  service: AppointmentService,
  metadata: AppointmentServiceMutationMetadata,
  action: "created" | "updated" | "archived",
  before?: AppointmentService,
): Promise<void> {
  const access = createTenantDataAccess(context, transaction);
  await access.audit.append({
    action: `appointment_service.${action}`,
    actorId: metadata.actorUserId,
    actorType: "tenant_user",
    ...(before === undefined ? {} : { beforeSummary: auditSummary(before) }),
    afterSummary: auditSummary(service),
    entityId: service.id,
    entityType: "AppointmentService",
    organizationUnitId: service.organizationUnitId,
    requestId: metadata.requestId,
  });
  await access.outbox.append({
    aggregateId: service.id,
    aggregateType: "AppointmentService",
    eventType: `appointment_service.${action}`,
    payload: {
      appointmentServiceId: service.id,
      tenantId: context.tenantId,
    },
  });
}

export async function createAppointmentService(
  context: TenantContext,
  database: AppointmentServiceManagerDatabase,
  input: AppointmentServiceInput,
  metadata: AppointmentServiceMutationMetadata,
): Promise<AppointmentService> {
  const tenant = createTenantContext(context.tenantId);
  requireMetadata(metadata);
  const name = normalizeName(input.name);
  const durationMinutes = normalizeDuration(input.durationMinutes);
  const bufferBeforeMinutes = normalizeBuffer(input.bufferBeforeMinutes, "bufferBeforeMinutes");
  const bufferAfterMinutes = normalizeBuffer(input.bufferAfterMinutes, "bufferAfterMinutes");
  const price = normalizePrice(input.price);
  const currency = normalizeCurrency(input.currency);
  const settings = input.settings === undefined ? undefined : normalizeSettings(input.settings);

  return database.$transaction(async (transaction) => {
    await assertTenantOperational(tenant, transaction);
    if (input.organizationUnitId !== undefined && input.organizationUnitId !== null) {
      await assertOrganizationUnitBelongsToTenant(
        transaction,
        tenant.tenantId,
        input.organizationUnitId,
      );
    }
    const service = await transaction.appointmentService.create({
      data: {
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.organizationUnitId === undefined
          ? {}
          : { organizationUnitId: input.organizationUnitId }),
        ...(price === undefined ? {} : { price }),
        ...(currency === undefined ? {} : { currency }),
        ...(bufferBeforeMinutes === undefined ? {} : { bufferBeforeMinutes }),
        ...(bufferAfterMinutes === undefined ? {} : { bufferAfterMinutes }),
        ...(settings === undefined ? {} : { settings }),
        durationMinutes,
        name,
        tenantId: tenant.tenantId,
      },
    });
    await recordMutation(tenant, transaction, service, metadata, "created");
    return service;
  });
}

export async function getAppointmentServiceById(
  context: TenantContext,
  database: AppointmentServiceManagerDatabase,
  id: string,
): Promise<AppointmentService> {
  const tenant = createTenantContext(context.tenantId);
  const service = await database.appointmentService.findFirst({
    where: { id, tenantId: tenant.tenantId },
  });
  if (service === null) throw new AppointmentServiceNotFoundError(id);
  return service;
}

export async function listAppointmentServices(
  context: TenantContext,
  database: AppointmentServiceManagerDatabase,
  filters: AppointmentServiceListFilters = {},
): Promise<AppointmentServiceListPage> {
  const tenant = createTenantContext(context.tenantId);
  const limit = filters.limit ?? DEFAULT_PAGE_SIZE;
  const offset = filters.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new AppointmentServiceValidationError(`limit must be between 1 and ${MAX_PAGE_SIZE}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new AppointmentServiceValidationError("offset must be a non-negative integer");
  }
  const search = filters.search?.trim();
  const where: Prisma.AppointmentServiceWhereInput = {
    tenantId: tenant.tenantId,
    ...(filters.active === undefined ? {} : { active: filters.active }),
    ...(filters.organizationUnitId === undefined
      ? {}
      : { organizationUnitId: filters.organizationUnitId }),
    ...(search === undefined || search.length === 0
      ? {}
      : { name: { contains: search, mode: "insensitive" } }),
  };
  const [items, total] = await Promise.all([
    database.appointmentService.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: offset,
      take: limit,
      where,
    }),
    database.appointmentService.count({ where }),
  ]);
  return { items, total };
}

export async function updateAppointmentService(
  context: TenantContext,
  database: AppointmentServiceManagerDatabase,
  id: string,
  patch: AppointmentServicePatch,
  metadata: AppointmentServiceMutationMetadata,
): Promise<AppointmentService> {
  const tenant = createTenantContext(context.tenantId);
  requireMetadata(metadata);
  if (!Object.values(patch).some((value) => value !== undefined)) {
    throw new AppointmentServiceValidationError("At least one field must be updated");
  }
  const data: Prisma.AppointmentServiceUncheckedUpdateInput = {};
  if (patch.name !== undefined) data.name = normalizeName(patch.name);
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.durationMinutes !== undefined)
    data.durationMinutes = normalizeDuration(patch.durationMinutes);
  if (patch.bufferBeforeMinutes !== undefined) {
    data.bufferBeforeMinutes = normalizeBuffer(
      patch.bufferBeforeMinutes,
      "bufferBeforeMinutes",
    ) as number;
  }
  if (patch.bufferAfterMinutes !== undefined) {
    data.bufferAfterMinutes = normalizeBuffer(
      patch.bufferAfterMinutes,
      "bufferAfterMinutes",
    ) as number;
  }
  if (patch.price !== undefined) data.price = normalizePrice(patch.price) as Prisma.Decimal | null;
  if (patch.currency !== undefined) data.currency = normalizeCurrency(patch.currency) as string;
  if (patch.active !== undefined) data.active = patch.active;
  if (patch.settings !== undefined) data.settings = normalizeSettings(patch.settings);

  return database.$transaction(async (transaction) => {
    await assertTenantOperational(tenant, transaction);
    const before = await transaction.appointmentService.findFirst({
      where: { id, tenantId: tenant.tenantId },
    });
    if (before === null) throw new AppointmentServiceNotFoundError(id);
    if (patch.organizationUnitId !== undefined) {
      if (patch.organizationUnitId !== null) {
        await assertOrganizationUnitBelongsToTenant(
          transaction,
          tenant.tenantId,
          patch.organizationUnitId,
        );
      }
      data.organizationUnitId = patch.organizationUnitId;
    }
    const service = await transaction.appointmentService.update({
      data,
      where: serviceWhere(tenant.tenantId, id),
    });
    await recordMutation(tenant, transaction, service, metadata, "updated", before);
    return service;
  });
}

export async function archiveAppointmentService(
  context: TenantContext,
  database: AppointmentServiceManagerDatabase,
  id: string,
  metadata: AppointmentServiceMutationMetadata,
): Promise<AppointmentService> {
  const tenant = createTenantContext(context.tenantId);
  requireMetadata(metadata);
  return database.$transaction(async (transaction) => {
    await assertTenantOperational(tenant, transaction);
    const before = await transaction.appointmentService.findFirst({
      where: { id, tenantId: tenant.tenantId },
    });
    if (before === null) throw new AppointmentServiceNotFoundError(id);
    if (!before.active) return before;
    const service = await transaction.appointmentService.update({
      data: { active: false },
      where: serviceWhere(tenant.tenantId, id),
    });
    await recordMutation(tenant, transaction, service, metadata, "archived", before);
    return service;
  });
}
