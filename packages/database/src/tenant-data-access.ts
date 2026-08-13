import { type AuditEntryInput, type AuditWriter, auditCreateData } from "./audit";
import {
  type DomainEventOutbox,
  type OrganizationUnit,
  Prisma,
  type TenantEntitlement,
} from "./generated/prisma/client";
import type { OrganizationUnitType, TenantEntitlementSource } from "./generated/prisma/enums";
import { createTenantContext, type TenantContext } from "./tenant-context";

export type TenantDataAccessDatabase = Pick<
  Prisma.TransactionClient,
  "auditLog" | "domainEventOutbox" | "organizationUnit" | "tenantEntitlement"
>;

type JsonInput = Prisma.InputJsonValue;
type DecimalInput = Prisma.Decimal | Prisma.DecimalJsLike | number | string;

export type TenantEntitlementCreateData = Readonly<{
  entitlementKey: string;
  enabled?: boolean;
  limitValue?: DecimalInput | null;
  config?: JsonInput;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  source: TenantEntitlementSource;
}>;

export type TenantEntitlementUpdateData = Readonly<{
  entitlementKey?: string;
  enabled?: boolean;
  limitValue?: DecimalInput | null;
  config?: JsonInput;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  source?: TenantEntitlementSource;
}>;

export type OrganizationUnitCreateData = Readonly<{
  parentId?: string | null;
  type: OrganizationUnitType;
  name: string;
  code?: string | null;
  timezone?: string | null;
  businessHoursId?: string | null;
  address?: JsonInput | null;
  settings?: JsonInput;
  active?: boolean;
}>;

export type OrganizationUnitUpdateData = Readonly<{
  parentId?: string | null;
  type?: OrganizationUnitType;
  name?: string;
  code?: string | null;
  timezone?: string | null;
  businessHoursId?: string | null;
  address?: JsonInput | null;
  settings?: JsonInput;
  active?: boolean;
}>;

export type DomainEventInput = Readonly<{
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: JsonInput;
}>;

export interface TenantEntitlementRepository {
  list(): Promise<TenantEntitlement[]>;
  findById(id: string): Promise<TenantEntitlement | null>;
  findByKey(entitlementKey: string): Promise<TenantEntitlement | null>;
  create(data: TenantEntitlementCreateData): Promise<TenantEntitlement>;
  update(id: string, data: TenantEntitlementUpdateData): Promise<TenantEntitlement>;
}

export interface OrganizationUnitRepository {
  list(): Promise<OrganizationUnit[]>;
  listRoots(): Promise<OrganizationUnit[]>;
  listChildren(parentId: string): Promise<OrganizationUnit[]>;
  findById(id: string): Promise<OrganizationUnit | null>;
  create(data: OrganizationUnitCreateData): Promise<OrganizationUnit>;
  update(id: string, data: OrganizationUnitUpdateData): Promise<OrganizationUnit>;
}

export interface TenantOutboxWriter {
  append(event: DomainEventInput): Promise<DomainEventOutbox>;
}

export type TenantDataAccess = Readonly<{
  audit: AuditWriter;
  entitlements: TenantEntitlementRepository;
  organizationUnits: OrganizationUnitRepository;
  outbox: TenantOutboxWriter;
}>;

export interface TenantTransactionDatabase {
  $transaction<Result>(
    callback: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result>;
}

export class TenantScopedRecordNotFoundError extends Error {
  constructor(resource: "TenantEntitlement" | "OrganizationUnit") {
    super(`Tenant-scoped ${resource} was not found`);
    this.name = "TenantScopedRecordNotFoundError";
  }
}

function isPrismaNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
}

function entitlementCreateData(
  context: TenantContext,
  input: TenantEntitlementCreateData,
): Prisma.TenantEntitlementUncheckedCreateInput {
  const data: Prisma.TenantEntitlementUncheckedCreateInput = {
    tenantId: context.tenantId,
    entitlementKey: input.entitlementKey,
    source: input.source,
  };

  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.limitValue !== undefined) data.limitValue = input.limitValue;
  if (input.config !== undefined) data.config = input.config;
  if (input.startsAt !== undefined) data.startsAt = input.startsAt;
  if (input.endsAt !== undefined) data.endsAt = input.endsAt;

  return data;
}

function entitlementUpdateData(
  input: TenantEntitlementUpdateData,
): Prisma.TenantEntitlementUncheckedUpdateInput {
  const data: Prisma.TenantEntitlementUncheckedUpdateInput = {};

  if (input.entitlementKey !== undefined) data.entitlementKey = input.entitlementKey;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.limitValue !== undefined) data.limitValue = input.limitValue;
  if (input.config !== undefined) data.config = input.config;
  if (input.startsAt !== undefined) data.startsAt = input.startsAt;
  if (input.endsAt !== undefined) data.endsAt = input.endsAt;
  if (input.source !== undefined) data.source = input.source;

  return data;
}

function organizationUnitCreateData(
  context: TenantContext,
  input: OrganizationUnitCreateData,
): Prisma.OrganizationUnitUncheckedCreateInput {
  const data: Prisma.OrganizationUnitUncheckedCreateInput = {
    tenantId: context.tenantId,
    type: input.type,
    name: input.name,
  };

  if (input.parentId !== undefined) data.parentId = input.parentId;
  if (input.code !== undefined) data.code = input.code;
  if (input.timezone !== undefined) data.timezone = input.timezone;
  if (input.businessHoursId !== undefined) data.businessHoursId = input.businessHoursId;
  if (input.address !== undefined)
    data.address = input.address === null ? Prisma.DbNull : input.address;
  if (input.settings !== undefined) data.settings = input.settings;
  if (input.active !== undefined) data.active = input.active;

  return data;
}

function organizationUnitUpdateData(
  input: OrganizationUnitUpdateData,
): Prisma.OrganizationUnitUncheckedUpdateInput {
  const data: Prisma.OrganizationUnitUncheckedUpdateInput = {};

  if (input.parentId !== undefined) data.parentId = input.parentId;
  if (input.type !== undefined) data.type = input.type;
  if (input.name !== undefined) data.name = input.name;
  if (input.code !== undefined) data.code = input.code;
  if (input.timezone !== undefined) data.timezone = input.timezone;
  if (input.businessHoursId !== undefined) data.businessHoursId = input.businessHoursId;
  if (input.address !== undefined)
    data.address = input.address === null ? Prisma.DbNull : input.address;
  if (input.settings !== undefined) data.settings = input.settings;
  if (input.active !== undefined) data.active = input.active;

  return data;
}

function createTenantEntitlementRepository(
  context: TenantContext,
  database: TenantDataAccessDatabase,
): TenantEntitlementRepository {
  const repository: TenantEntitlementRepository = {
    list: () =>
      database.tenantEntitlement.findMany({
        orderBy: { entitlementKey: "asc" },
        where: { tenantId: context.tenantId },
      }),
    findById: (id: string) =>
      database.tenantEntitlement.findUnique({
        where: { id, tenantId: context.tenantId },
      }),
    findByKey: (entitlementKey: string) =>
      database.tenantEntitlement.findUnique({
        where: {
          tenantId_entitlementKey: { tenantId: context.tenantId, entitlementKey },
        },
      }),
    create: (data: TenantEntitlementCreateData) =>
      database.tenantEntitlement.create({ data: entitlementCreateData(context, data) }),
    update: async (id: string, data: TenantEntitlementUpdateData) => {
      try {
        return await database.tenantEntitlement.update({
          data: entitlementUpdateData(data),
          where: { id, tenantId: context.tenantId },
        });
      } catch (error) {
        if (isPrismaNotFound(error)) {
          throw new TenantScopedRecordNotFoundError("TenantEntitlement");
        }
        throw error;
      }
    },
  };

  return Object.freeze(repository);
}

function createOrganizationUnitRepository(
  context: TenantContext,
  database: TenantDataAccessDatabase,
): OrganizationUnitRepository {
  const repository: OrganizationUnitRepository = {
    list: () =>
      database.organizationUnit.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
        where: { tenantId: context.tenantId },
      }),
    listRoots: () =>
      database.organizationUnit.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
        where: { parentId: null, tenantId: context.tenantId },
      }),
    listChildren: (parentId: string) =>
      database.organizationUnit.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
        where: { parentId, tenantId: context.tenantId },
      }),
    findById: (id: string) =>
      database.organizationUnit.findUnique({
        where: { id, tenantId: context.tenantId },
      }),
    create: (data: OrganizationUnitCreateData) =>
      database.organizationUnit.create({ data: organizationUnitCreateData(context, data) }),
    update: async (id: string, data: OrganizationUnitUpdateData) => {
      try {
        return await database.organizationUnit.update({
          data: organizationUnitUpdateData(data),
          where: { id, tenantId: context.tenantId },
        });
      } catch (error) {
        if (isPrismaNotFound(error)) {
          throw new TenantScopedRecordNotFoundError("OrganizationUnit");
        }
        throw error;
      }
    },
  };

  return Object.freeze(repository);
}

function createTenantOutboxWriter(
  context: TenantContext,
  database: TenantDataAccessDatabase,
): TenantOutboxWriter {
  return Object.freeze({
    append: (event: DomainEventInput) =>
      database.domainEventOutbox.create({
        data: {
          aggregateId: event.aggregateId,
          aggregateType: event.aggregateType,
          eventType: event.eventType,
          payload: event.payload,
          tenantId: context.tenantId,
        },
      }),
  });
}

function createTenantAuditWriter(
  context: TenantContext,
  database: TenantDataAccessDatabase,
): AuditWriter {
  return Object.freeze({
    append: (entry: AuditEntryInput) =>
      database.auditLog.create({ data: auditCreateData(entry, context.tenantId) }),
  });
}

export function createTenantDataAccess(
  context: TenantContext,
  database: TenantDataAccessDatabase,
): TenantDataAccess {
  const validatedContext = createTenantContext(context.tenantId);

  return Object.freeze({
    audit: createTenantAuditWriter(validatedContext, database),
    entitlements: createTenantEntitlementRepository(validatedContext, database),
    organizationUnits: createOrganizationUnitRepository(validatedContext, database),
    outbox: createTenantOutboxWriter(validatedContext, database),
  });
}

export async function withTenantTransaction<Result>(
  context: TenantContext,
  database: TenantTransactionDatabase,
  callback: (data: TenantDataAccess) => Promise<Result>,
): Promise<Result> {
  const validatedContext = createTenantContext(context.tenantId);

  return database.$transaction((transaction) =>
    callback(createTenantDataAccess(validatedContext, transaction)),
  );
}
