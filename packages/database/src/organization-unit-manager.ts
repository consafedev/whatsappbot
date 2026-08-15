import { type OrganizationUnit, Prisma, type TenantEntitlement } from "./generated/prisma/client";
import type { OrganizationUnitType } from "./generated/prisma/enums";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess, type TenantTransactionDatabase } from "./tenant-data-access";
import { tenantEntitlementEffective } from "./tenant-entitlements";

/**
 * MVP safety cap for the documented "profundidad razonable configurable".
 * The root unit has depth 0 and the deepest allowed node has depth
 * ORGANIZATION_UNIT_MAX_DEPTH. There is no settings engine yet, so the cap is
 * an explicit code constant that will become configurable in a later story.
 */
export const ORGANIZATION_UNIT_MAX_DEPTH = 10;

export type OrganizationUnitItem = Readonly<{
  id: string;
  parentId: string | null;
  type: OrganizationUnitType;
  name: string;
  code: string | null;
  timezone: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}>;

export type OrganizationUnitCreateInput = Readonly<{
  parentId: string;
  type: OrganizationUnitType;
  name: string;
  code?: string | null;
  timezone?: string | null;
  active?: boolean;
}>;

export type OrganizationUnitUpdateInput = Readonly<{
  parentId?: string | null;
  type?: OrganizationUnitType;
  name?: string;
  code?: string | null;
  timezone?: string | null;
  active?: boolean;
}>;

export type OrganizationUnitMutationMetadata = Readonly<{
  actorUserId: string;
  requestId: string;
}>;

export type OrganizationUnitUsage = Readonly<{
  used: number;
  limit: string | null;
}>;

export type OrganizationUnitTreePage = Readonly<{
  items: readonly OrganizationUnitItem[];
  usage: OrganizationUnitUsage;
}>;

export type OrganizationUnitManagerDatabase = TenantTransactionDatabase &
  Pick<Prisma.TransactionClient, "organizationUnit" | "tenantEntitlement">;

export interface OrganizationUnitManager {
  list(context: TenantContext): Promise<OrganizationUnitTreePage>;
  create(
    context: TenantContext,
    input: OrganizationUnitCreateInput,
    metadata: OrganizationUnitMutationMetadata,
  ): Promise<OrganizationUnitItem>;
  update(
    context: TenantContext,
    unitId: string,
    input: OrganizationUnitUpdateInput,
    metadata: OrganizationUnitMutationMetadata,
  ): Promise<OrganizationUnitItem>;
}

export class OrganizationUnitNotFoundError extends Error {
  override readonly name = "OrganizationUnitNotFoundError";

  constructor() {
    super("Tenant-scoped organization unit was not found");
  }
}

export class OrganizationUnitParentNotFoundError extends Error {
  override readonly name = "OrganizationUnitParentNotFoundError";

  constructor() {
    super("Tenant-scoped organization unit parent was not found");
  }
}

export class OrganizationUnitRootInvariantError extends Error {
  override readonly name = "OrganizationUnitRootInvariantError";

  constructor() {
    super("The structural root organization unit cannot be moved, deactivated or retyped");
  }
}

export class OrganizationUnitCycleError extends Error {
  override readonly name = "OrganizationUnitCycleError";

  constructor() {
    super("Organization unit hierarchy cannot contain cycles");
  }
}

export class OrganizationUnitDepthError extends Error {
  override readonly name = "OrganizationUnitDepthError";

  constructor() {
    super(`Organization unit depth exceeds the maximum of ${ORGANIZATION_UNIT_MAX_DEPTH}`);
  }
}

export class OrganizationUnitLimitReachedError extends Error {
  override readonly name = "OrganizationUnitLimitReachedError";

  constructor() {
    super("Organization unit limit reached");
  }
}

export class OrganizationUnitCompanyTypeReservedError extends Error {
  override readonly name = "OrganizationUnitCompanyTypeReservedError";

  constructor() {
    super("The company organization unit type is reserved for the structural root");
  }
}

function auditSummary(unit: OrganizationUnitItem): Prisma.InputJsonValue {
  return {
    active: unit.active,
    code: unit.code,
    name: unit.name,
    parentId: unit.parentId,
    timezone: unit.timezone,
    type: unit.type,
  };
}

function effectiveOrganizationUnitLimit(
  entitlement: TenantEntitlement | null,
  now: Date,
): Prisma.Decimal | null {
  if (entitlement === null || !tenantEntitlementEffective(entitlement, now)) {
    return null;
  }
  return entitlement.limitValue;
}

function unitSummary(unit: OrganizationUnit): OrganizationUnitItem {
  return {
    active: unit.active,
    code: unit.code,
    createdAt: unit.createdAt,
    id: unit.id,
    name: unit.name,
    parentId: unit.parentId,
    timezone: unit.timezone,
    type: unit.type,
    updatedAt: unit.updatedAt,
  };
}

async function unitDepth(
  transaction: Prisma.TransactionClient,
  unit: OrganizationUnit,
  tenantId: string,
): Promise<number> {
  let depth = 0;
  let cursor = unit;
  while (cursor.parentId !== null) {
    if (depth > ORGANIZATION_UNIT_MAX_DEPTH) {
      throw new OrganizationUnitCycleError();
    }
    const parent = await transaction.organizationUnit.findUnique({
      where: { id: cursor.parentId, tenantId },
    });
    if (parent === null) throw new OrganizationUnitParentNotFoundError();
    cursor = parent;
    depth += 1;
  }
  return depth;
}

async function assertParentIsNotDescendant(
  transaction: Prisma.TransactionClient,
  unitId: string,
  parent: OrganizationUnit,
  tenantId: string,
): Promise<void> {
  let cursor = parent;
  while (cursor.parentId !== null) {
    if (cursor.parentId === unitId) {
      throw new OrganizationUnitCycleError();
    }
    const ancestor = await transaction.organizationUnit.findUnique({
      where: { id: cursor.parentId, tenantId },
    });
    if (ancestor === null) throw new OrganizationUnitParentNotFoundError();
    cursor = ancestor;
  }
}

/**
 * Maximum distance from the given unit to any of its descendants, counting
 * edges. Only tenant-local units participate: every child maps to a parent of
 * the same tenant, so the adjacency built from the passed units cannot reach
 * another tenant. The defensive visited set turns corrupted cyclic data into
 * an explicit cycle error instead of an infinite loop.
 */
function organizationUnitSubtreeHeight(units: readonly OrganizationUnit[], unitId: string): number {
  const childrenByParent = new Map<string, string[]>();
  for (const unit of units) {
    if (unit.parentId === null) continue;
    const children = childrenByParent.get(unit.parentId);
    if (children === undefined) {
      childrenByParent.set(unit.parentId, [unit.id]);
    } else {
      children.push(unit.id);
    }
  }
  const visited = new Set<string>();
  const heightFrom = (nodeId: string): number => {
    if (visited.has(nodeId)) {
      throw new OrganizationUnitCycleError();
    }
    visited.add(nodeId);
    let height = 0;
    for (const child of childrenByParent.get(nodeId) ?? []) {
      height = Math.max(height, 1 + heightFrom(child));
    }
    return height;
  };
  return heightFrom(unitId);
}

async function assertOrganizationUnitLimit(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  now = new Date(),
): Promise<void> {
  const row = await transaction.tenantEntitlement.findUnique({
    where: { tenantId_entitlementKey: { entitlementKey: "limit.organization_units", tenantId } },
  });
  const limit = effectiveOrganizationUnitLimit(row, now);
  if (limit === null) return;
  const used = await transaction.organizationUnit.count({ where: { tenantId } });
  const nextUsed = new Prisma.Decimal(used).plus(1);
  if (limit.lt(nextUsed)) {
    throw new OrganizationUnitLimitReachedError();
  }
}

async function lockTenantOrganizationUnits(
  transaction: Prisma.TransactionClient,
  tenantId: string,
) {
  await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${tenantId}::text, 0::bigint))`;
}

export function createOrganizationUnitManager(
  database: OrganizationUnitManagerDatabase,
): OrganizationUnitManager {
  const list = async (context: TenantContext): Promise<OrganizationUnitTreePage> => {
    const tenantContext = createTenantContext(context.tenantId);
    const [units, entitlement] = await Promise.all([
      database.organizationUnit.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
        where: { tenantId: tenantContext.tenantId },
      }),
      database.tenantEntitlement.findUnique({
        where: {
          tenantId_entitlementKey: {
            entitlementKey: "limit.organization_units",
            tenantId: tenantContext.tenantId,
          },
        },
      }),
    ]);
    const limit = effectiveOrganizationUnitLimit(entitlement, new Date());
    return {
      items: units.map(unitSummary),
      usage: { used: units.length, limit: limit === null ? null : limit.toString() },
    };
  };

  const create = async (
    context: TenantContext,
    input: OrganizationUnitCreateInput,
    metadata: OrganizationUnitMutationMetadata,
  ): Promise<OrganizationUnitItem> => {
    const tenantContext = createTenantContext(context.tenantId);
    return database.$transaction(async (transaction) => {
      await lockTenantOrganizationUnits(transaction, tenantContext.tenantId);
      if (input.type === "company") {
        throw new OrganizationUnitCompanyTypeReservedError();
      }
      const parent = await transaction.organizationUnit.findUnique({
        where: { id: input.parentId, tenantId: tenantContext.tenantId },
      });
      if (parent === null) throw new OrganizationUnitParentNotFoundError();
      if (
        (await unitDepth(transaction, parent, tenantContext.tenantId)) + 1 >
        ORGANIZATION_UNIT_MAX_DEPTH
      ) {
        throw new OrganizationUnitDepthError();
      }
      await assertOrganizationUnitLimit(transaction, tenantContext.tenantId);

      const unit = await transaction.organizationUnit.create({
        data: {
          active: input.active ?? true,
          code: input.code ?? null,
          name: input.name,
          parentId: input.parentId,
          tenantId: tenantContext.tenantId,
          timezone: input.timezone ?? null,
          type: input.type,
        },
      });
      const item = unitSummary(unit);
      const data = createTenantDataAccess(tenantContext, transaction);
      await data.audit.append({
        action: "organization_unit.created",
        actorId: metadata.actorUserId,
        actorType: "tenant_user",
        afterSummary: auditSummary(item),
        entityId: item.id,
        entityType: "OrganizationUnit",
        organizationUnitId: item.id,
        requestId: metadata.requestId,
      });
      await data.outbox.append({
        aggregateId: item.id,
        aggregateType: "OrganizationUnit",
        eventType: "organization_unit.created",
        payload: {
          active: item.active,
          parentId: item.parentId,
          tenantId: tenantContext.tenantId,
          type: item.type,
          unitId: item.id,
        },
      });
      return item;
    });
  };

  const update = async (
    context: TenantContext,
    unitId: string,
    input: OrganizationUnitUpdateInput,
    metadata: OrganizationUnitMutationMetadata,
  ): Promise<OrganizationUnitItem> => {
    const tenantContext = createTenantContext(context.tenantId);
    return database.$transaction(async (transaction) => {
      await lockTenantOrganizationUnits(transaction, tenantContext.tenantId);
      const current = await transaction.organizationUnit.findUnique({
        where: { id: unitId, tenantId: tenantContext.tenantId },
      });
      if (current === null) throw new OrganizationUnitNotFoundError();
      const isRoot = current.parentId === null;

      if (input.parentId !== undefined) {
        if (isRoot) {
          if (input.parentId !== null) throw new OrganizationUnitRootInvariantError();
        } else if (input.parentId === null) {
          throw new OrganizationUnitRootInvariantError();
        } else {
          if (input.parentId === current.id) throw new OrganizationUnitCycleError();
          const parent = await transaction.organizationUnit.findUnique({
            where: { id: input.parentId, tenantId: tenantContext.tenantId },
          });
          if (parent === null) throw new OrganizationUnitParentNotFoundError();
          await assertParentIsNotDescendant(
            transaction,
            current.id,
            parent,
            tenantContext.tenantId,
          );
          const units = await transaction.organizationUnit.findMany({
            where: { tenantId: tenantContext.tenantId },
          });
          const newDepth = (await unitDepth(transaction, parent, tenantContext.tenantId)) + 1;
          const height = organizationUnitSubtreeHeight(units, current.id);
          if (newDepth + height > ORGANIZATION_UNIT_MAX_DEPTH) {
            throw new OrganizationUnitDepthError();
          }
        }
      }
      if (input.type !== undefined) {
        if (isRoot && input.type !== "company") throw new OrganizationUnitRootInvariantError();
        if (!isRoot && input.type === "company") {
          throw new OrganizationUnitCompanyTypeReservedError();
        }
      }
      if (input.active !== undefined && isRoot && input.active !== true) {
        throw new OrganizationUnitRootInvariantError();
      }

      const data: Prisma.OrganizationUnitUncheckedUpdateInput = {};
      if (input.parentId !== undefined) data.parentId = input.parentId;
      if (input.type !== undefined) data.type = input.type;
      if (input.name !== undefined) data.name = input.name;
      if (input.code !== undefined) data.code = input.code;
      if (input.timezone !== undefined) data.timezone = input.timezone;
      if (input.active !== undefined) data.active = input.active;

      const updated = await transaction.organizationUnit.update({
        data,
        where: { id: current.id, tenantId: tenantContext.tenantId },
      });
      const item = unitSummary(updated);
      const before = unitSummary(current);
      const access = createTenantDataAccess(tenantContext, transaction);
      await access.audit.append({
        action: "organization_unit.updated",
        actorId: metadata.actorUserId,
        actorType: "tenant_user",
        afterSummary: auditSummary(item),
        beforeSummary: auditSummary(before),
        entityId: item.id,
        entityType: "OrganizationUnit",
        organizationUnitId: item.id,
        requestId: metadata.requestId,
      });
      await access.outbox.append({
        aggregateId: item.id,
        aggregateType: "OrganizationUnit",
        eventType: "organization_unit.updated",
        payload: {
          active: item.active,
          parentId: item.parentId,
          tenantId: tenantContext.tenantId,
          type: item.type,
          unitId: item.id,
        },
      });
      return item;
    });
  };

  return Object.freeze({ create, list, update });
}
