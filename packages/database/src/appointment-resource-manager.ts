import type { AppointmentResource, Prisma } from "./generated/prisma/client";
import { AppointmentResourceType } from "./generated/prisma/enums";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess, type TenantTransactionDatabase } from "./tenant-data-access";
import { assertTenantOperational } from "./tenant-operational";

export type AppointmentResourceMutationMetadata = Readonly<{
  actorUserId: string;
  requestId: string;
}>;

export type AppointmentResourceInput = Readonly<{
  name: string;
  type?: AppointmentResourceType;
  description?: string | null;
  capacity?: number;
  organizationUnitId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}>;

export type AppointmentResourcePatch = Readonly<{
  name?: string | undefined;
  type?: AppointmentResourceType | undefined;
  description?: string | null | undefined;
  capacity?: number | undefined;
  organizationUnitId?: string | null | undefined;
  userId?: string | null | undefined;
  active?: boolean | undefined;
  metadata?: Record<string, unknown> | undefined;
}>;

export type AppointmentResourceListFilters = Readonly<{
  active?: boolean;
  type?: AppointmentResourceType;
  organizationUnitId?: string;
  userId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}>;

export type AppointmentResourceManagerDatabase = TenantTransactionDatabase &
  Pick<Prisma.TransactionClient, "appointmentResource" | "organizationUnit" | "tenant" | "user">;

export type AppointmentResourceListPage = Readonly<{
  items: readonly AppointmentResource[];
  total: number;
}>;

export class AppointmentResourceNotFoundError extends Error {
  override readonly name = "AppointmentResourceNotFoundError";

  constructor(readonly appointmentResourceId: string) {
    super("Appointment resource was not found");
  }
}

export class AppointmentResourceValidationError extends Error {
  override readonly name = "AppointmentResourceValidationError";
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;
const MAX_CAPACITY = 2_147_483_647;
const RESOURCE_TYPES = new Set<string>(Object.values(AppointmentResourceType));

function requireMetadata(metadata: AppointmentResourceMutationMetadata): void {
  if (!metadata.actorUserId.trim() || !metadata.requestId.trim()) {
    throw new AppointmentResourceValidationError("actorUserId and requestId are required");
  }
}

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0 || normalized.length > 150) {
    throw new AppointmentResourceValidationError("name must contain between 1 and 150 characters");
  }
  return normalized;
}

function normalizeCapacity(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > MAX_CAPACITY) {
    throw new AppointmentResourceValidationError(
      `capacity must be an integer between 1 and ${MAX_CAPACITY}`,
    );
  }
  return value;
}

function normalizeType(
  value: AppointmentResourceType | undefined,
): AppointmentResourceType | undefined {
  if (value === undefined) return undefined;
  if (!RESOURCE_TYPES.has(value)) {
    throw new AppointmentResourceValidationError(
      "type must be a supported appointment resource type",
    );
  }
  return value;
}

function normalizeMetadata(value: Record<string, unknown>): Prisma.InputJsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    throw new AppointmentResourceValidationError("metadata must be valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppointmentResourceValidationError("metadata must be a JSON object");
  }
  return parsed as Prisma.InputJsonObject;
}

function resourceSummary(resource: AppointmentResource): Prisma.InputJsonObject {
  return {
    active: resource.active,
    capacity: resource.capacity,
    description: resource.description,
    name: resource.name,
    organizationUnitId: resource.organizationUnitId,
    type: resource.type,
    userId: resource.userId,
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
    throw new AppointmentResourceValidationError("organizationUnitId must belong to the tenant");
  }
}

async function assertActiveUserBelongsToTenant(
  database: Pick<Prisma.TransactionClient, "user">,
  tenantId: string,
  userId: string,
): Promise<void> {
  const user = await database.user.findFirst({
    select: { id: true },
    where: { id: userId, status: "active", tenantId },
  });
  if (user === null) {
    throw new AppointmentResourceValidationError(
      "userId must identify an active user in the tenant",
    );
  }
}

function resourceWhere(tenantId: string, id: string): Prisma.AppointmentResourceWhereUniqueInput {
  return { id, tenantId };
}

async function recordMutation(
  context: TenantContext,
  transaction: Prisma.TransactionClient,
  resource: AppointmentResource,
  metadata: AppointmentResourceMutationMetadata,
  action: "created" | "updated" | "archived",
  before?: AppointmentResource,
): Promise<void> {
  const access = createTenantDataAccess(context, transaction);
  await access.audit.append({
    action: `appointment_resource.${action}`,
    actorId: metadata.actorUserId,
    actorType: "tenant_user",
    ...(before === undefined ? {} : { beforeSummary: resourceSummary(before) }),
    afterSummary: resourceSummary(resource),
    entityId: resource.id,
    entityType: "AppointmentResource",
    organizationUnitId: resource.organizationUnitId,
    requestId: metadata.requestId,
  });
  await access.outbox.append({
    aggregateId: resource.id,
    aggregateType: "AppointmentResource",
    eventType: `appointment_resource.${action}`,
    payload: {
      appointmentResourceId: resource.id,
      tenantId: context.tenantId,
    },
  });
}

export async function createAppointmentResource(
  context: TenantContext,
  database: AppointmentResourceManagerDatabase,
  input: AppointmentResourceInput,
  mutationMetadata: AppointmentResourceMutationMetadata,
): Promise<AppointmentResource> {
  const tenant = createTenantContext(context.tenantId);
  requireMetadata(mutationMetadata);
  const name = normalizeName(input.name);
  const capacity = normalizeCapacity(input.capacity);
  const type = normalizeType(input.type);
  const metadata = input.metadata === undefined ? undefined : normalizeMetadata(input.metadata);

  return database.$transaction(async (transaction) => {
    await assertTenantOperational(tenant, transaction);
    if (input.organizationUnitId !== undefined && input.organizationUnitId !== null) {
      await assertOrganizationUnitBelongsToTenant(
        transaction,
        tenant.tenantId,
        input.organizationUnitId,
      );
    }
    if (input.userId !== undefined && input.userId !== null) {
      await assertActiveUserBelongsToTenant(transaction, tenant.tenantId, input.userId);
    }
    const resource = await transaction.appointmentResource.create({
      data: {
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.organizationUnitId === undefined
          ? {}
          : { organizationUnitId: input.organizationUnitId }),
        ...(input.userId === undefined ? {} : { userId: input.userId }),
        ...(capacity === undefined ? {} : { capacity }),
        ...(metadata === undefined ? {} : { metadata }),
        ...(type === undefined ? {} : { type }),
        name,
        tenantId: tenant.tenantId,
      },
    });
    await recordMutation(tenant, transaction, resource, mutationMetadata, "created");
    return resource;
  });
}

export async function getAppointmentResourceById(
  context: TenantContext,
  database: AppointmentResourceManagerDatabase,
  id: string,
): Promise<AppointmentResource> {
  const tenant = createTenantContext(context.tenantId);
  const resource = await database.appointmentResource.findFirst({
    where: { id, tenantId: tenant.tenantId },
  });
  if (resource === null) throw new AppointmentResourceNotFoundError(id);
  return resource;
}

export async function listAppointmentResources(
  context: TenantContext,
  database: AppointmentResourceManagerDatabase,
  filters: AppointmentResourceListFilters = {},
): Promise<AppointmentResourceListPage> {
  const tenant = createTenantContext(context.tenantId);
  const limit = filters.limit ?? DEFAULT_PAGE_SIZE;
  const offset = filters.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new AppointmentResourceValidationError(`limit must be between 1 and ${MAX_PAGE_SIZE}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new AppointmentResourceValidationError("offset must be a non-negative integer");
  }
  const search = filters.search?.trim();
  const where: Prisma.AppointmentResourceWhereInput = {
    tenantId: tenant.tenantId,
    ...(filters.active === undefined ? {} : { active: filters.active }),
    ...(filters.type === undefined ? {} : { type: filters.type }),
    ...(filters.organizationUnitId === undefined
      ? {}
      : { organizationUnitId: filters.organizationUnitId }),
    ...(filters.userId === undefined ? {} : { userId: filters.userId }),
    ...(search === undefined || search.length === 0
      ? {}
      : { name: { contains: search, mode: "insensitive" } }),
  };
  const [items, total] = await Promise.all([
    database.appointmentResource.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: offset,
      take: limit,
      where,
    }),
    database.appointmentResource.count({ where }),
  ]);
  return { items, total };
}

export async function updateAppointmentResource(
  context: TenantContext,
  database: AppointmentResourceManagerDatabase,
  id: string,
  patch: AppointmentResourcePatch,
  mutationMetadata: AppointmentResourceMutationMetadata,
): Promise<AppointmentResource> {
  const tenant = createTenantContext(context.tenantId);
  requireMetadata(mutationMetadata);
  if (!Object.values(patch).some((value) => value !== undefined)) {
    throw new AppointmentResourceValidationError("At least one field must be updated");
  }

  const data: Prisma.AppointmentResourceUncheckedUpdateInput = {};
  if (patch.name !== undefined) data.name = normalizeName(patch.name);
  if (patch.type !== undefined) data.type = normalizeType(patch.type) as AppointmentResourceType;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.capacity !== undefined) data.capacity = normalizeCapacity(patch.capacity) as number;
  if (patch.active !== undefined) data.active = patch.active;
  if (patch.metadata !== undefined) data.metadata = normalizeMetadata(patch.metadata);

  return database.$transaction(async (transaction) => {
    await assertTenantOperational(tenant, transaction);
    const before = await transaction.appointmentResource.findFirst({
      where: { id, tenantId: tenant.tenantId },
    });
    if (before === null) throw new AppointmentResourceNotFoundError(id);
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
    if (patch.userId !== undefined) {
      if (patch.userId !== null) {
        await assertActiveUserBelongsToTenant(transaction, tenant.tenantId, patch.userId);
      }
      data.userId = patch.userId;
    }
    const resource = await transaction.appointmentResource.update({
      data,
      where: resourceWhere(tenant.tenantId, id),
    });
    await recordMutation(tenant, transaction, resource, mutationMetadata, "updated", before);
    return resource;
  });
}

export async function archiveAppointmentResource(
  context: TenantContext,
  database: AppointmentResourceManagerDatabase,
  id: string,
  mutationMetadata: AppointmentResourceMutationMetadata,
): Promise<AppointmentResource> {
  const tenant = createTenantContext(context.tenantId);
  requireMetadata(mutationMetadata);
  return database.$transaction(async (transaction) => {
    await assertTenantOperational(tenant, transaction);
    const before = await transaction.appointmentResource.findFirst({
      where: { id, tenantId: tenant.tenantId },
    });
    if (before === null) throw new AppointmentResourceNotFoundError(id);
    if (!before.active) return before;
    const resource = await transaction.appointmentResource.update({
      data: { active: false },
      where: resourceWhere(tenant.tenantId, id),
    });
    await recordMutation(tenant, transaction, resource, mutationMetadata, "archived", before);
    return resource;
  });
}
