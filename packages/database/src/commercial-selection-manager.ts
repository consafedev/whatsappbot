import type { Prisma } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { assertTenantOperational } from "./tenant-operational";

export const COMMERCIAL_SELECTION_LIMITS = Object.freeze({
  defaultPageSize: 20,
  maxPageSize: 50,
  search: 100,
});

export type CommercialSelectionFilters = Readonly<{
  cursor?: string;
  limit?: number;
  search?: string;
}>;

export type CommercialSelectionContactDatabase = Pick<
  Prisma.TransactionClient,
  "contact" | "tenant"
>;
export type CommercialSelectionOrganizationUnitDatabase = Pick<
  Prisma.TransactionClient,
  "organizationUnit" | "tenant"
>;
export type CommercialSelectionManagerDatabase = CommercialSelectionContactDatabase &
  CommercialSelectionOrganizationUnitDatabase;

export type ContactOption = Readonly<{ id: string; name: string; phoneNumber: string }>;
export type OrganizationUnitOption = Readonly<{ id: string; name: string; code: string | null }>;
export type CommercialSelectionPage<T> = Readonly<{
  items: readonly T[];
  nextCursor: string | null;
  limit: number;
}>;

export class CommercialSelectionValidationError extends Error {
  override readonly name = "CommercialSelectionValidationError";
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTERS = /\p{Cc}/u;
const FILTER_KEYS = new Set(["cursor", "limit", "search"]);

function validateFilters(filters: CommercialSelectionFilters): Readonly<{
  cursor?: string;
  limit: number;
  search?: string;
}> {
  if (filters === null || typeof filters !== "object" || Array.isArray(filters)) {
    throw new CommercialSelectionValidationError("filters must be an object");
  }
  if (Object.keys(filters).some((key) => !FILTER_KEYS.has(key))) {
    throw new CommercialSelectionValidationError("filters contains an unknown field");
  }
  const record = filters as Record<string, unknown>;
  let cursor: string | undefined;
  if (record.cursor !== undefined) {
    if (typeof record.cursor !== "string" || !UUID_V7.test(record.cursor)) {
      throw new CommercialSelectionValidationError("cursor must be a UUIDv7");
    }
    cursor = record.cursor;
  }
  let limit: number = COMMERCIAL_SELECTION_LIMITS.defaultPageSize;
  if (record.limit !== undefined) {
    if (
      typeof record.limit !== "number" ||
      !Number.isInteger(record.limit) ||
      record.limit < 1 ||
      record.limit > COMMERCIAL_SELECTION_LIMITS.maxPageSize
    ) {
      throw new CommercialSelectionValidationError("limit must be an integer from 1 to 50");
    }
    limit = record.limit;
  }
  let search: string | undefined;
  if (record.search !== undefined) {
    if (typeof record.search !== "string" || CONTROL_CHARACTERS.test(record.search)) {
      throw new CommercialSelectionValidationError("search must be a string without controls");
    }
    search = record.search.trim();
    if (search.length > COMMERCIAL_SELECTION_LIMITS.search) {
      throw new CommercialSelectionValidationError("search must not exceed 100 characters");
    }
  }
  return {
    ...(cursor === undefined ? {} : { cursor }),
    limit,
    ...(search === undefined ? {} : { search }),
  };
}

function page<T extends Readonly<{ id: string }>>(
  rows: readonly T[],
  limit: number,
): CommercialSelectionPage<T> {
  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasNext ? (items.at(-1)?.id ?? null) : null,
    limit,
  };
}

export async function listCommercialContactOptions(
  context: TenantContext,
  database: CommercialSelectionContactDatabase,
  filters: CommercialSelectionFilters = {},
): Promise<CommercialSelectionPage<ContactOption>> {
  const tenant = createTenantContext(context.tenantId);
  const { cursor, limit, search } = validateFilters(filters);
  await assertTenantOperational(tenant, database);
  const rows = await database.contact.findMany({
    orderBy: { id: "asc" },
    select: { id: true, name: true, phoneNumber: true },
    take: limit + 1,
    where: {
      tenantId: tenant.tenantId,
      status: "ACTIVE",
      ...(cursor === undefined ? {} : { id: { gt: cursor } }),
      ...(search === undefined || search.length === 0
        ? {}
        : {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { phoneNumber: { contains: search, mode: "insensitive" } },
            ],
          }),
    },
  });
  return page(rows, limit);
}

export async function listCommercialOrganizationUnitOptions(
  context: TenantContext,
  database: CommercialSelectionOrganizationUnitDatabase,
  filters: CommercialSelectionFilters = {},
): Promise<CommercialSelectionPage<OrganizationUnitOption>> {
  const tenant = createTenantContext(context.tenantId);
  const { cursor, limit, search } = validateFilters(filters);
  await assertTenantOperational(tenant, database);
  const rows = await database.organizationUnit.findMany({
    orderBy: { id: "asc" },
    select: { id: true, name: true, code: true },
    take: limit + 1,
    where: {
      tenantId: tenant.tenantId,
      active: true,
      ...(cursor === undefined ? {} : { id: { gt: cursor } }),
      ...(search === undefined || search.length === 0
        ? {}
        : {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { code: { contains: search, mode: "insensitive" } },
            ],
          }),
    },
  });
  return page(rows, limit);
}
