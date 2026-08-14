import type { LimitEntitlementKey, ModuleEntitlementKey } from "./entitlement-catalog";
import type { Prisma, TenantEntitlement } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";

export type TemporalEntitlement = Readonly<{
  enabled: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}>;

export function tenantEntitlementEffective(entitlement: TemporalEntitlement, now: Date): boolean {
  return (
    entitlement.enabled &&
    (entitlement.startsAt === null || entitlement.startsAt.getTime() <= now.getTime()) &&
    (entitlement.endsAt === null || entitlement.endsAt.getTime() > now.getTime())
  );
}

export type TenantEntitlementStatus = "effective" | "scheduled" | "expired" | "disabled";

export function tenantEntitlementStatus(
  entitlement: TemporalEntitlement,
  now: Date,
): TenantEntitlementStatus {
  if (!entitlement.enabled) return "disabled";
  if (entitlement.startsAt !== null && entitlement.startsAt.getTime() > now.getTime()) {
    return "scheduled";
  }
  if (entitlement.endsAt !== null && entitlement.endsAt.getTime() <= now.getTime()) {
    return "expired";
  }
  return "effective";
}

export function effectiveTenantEntitlementWhere(now: Date): Prisma.TenantEntitlementWhereInput {
  return {
    enabled: true,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    ],
  };
}

export type TenantEntitlementReadDatabase = Pick<Prisma.TransactionClient, "tenantEntitlement">;

export interface TenantEntitlementResolver {
  list(): Promise<TenantEntitlement[]>;
  findById(id: string): Promise<TenantEntitlement | null>;
  findByKey(entitlementKey: string): Promise<TenantEntitlement | null>;
  getModule(key: ModuleEntitlementKey): Promise<TenantEntitlement | null>;
  isModuleEnabled(key: ModuleEntitlementKey, now?: Date): Promise<boolean>;
  getLimit(key: LimitEntitlementKey): Promise<TenantEntitlement | null>;
}

export class TenantModuleEntitlementRequiredError extends Error {
  override readonly name = "TenantModuleEntitlementRequiredError";

  constructor(readonly moduleKey: ModuleEntitlementKey) {
    super(`Tenant module entitlement is required: ${moduleKey}`);
  }
}

export function createTenantEntitlementResolver(
  context: TenantContext,
  database: TenantEntitlementReadDatabase,
): TenantEntitlementResolver {
  const validatedContext = createTenantContext(context.tenantId);
  const findByKey = (entitlementKey: string) =>
    database.tenantEntitlement.findUnique({
      where: {
        tenantId_entitlementKey: { tenantId: validatedContext.tenantId, entitlementKey },
      },
    });
  return Object.freeze({
    findById: (id: string) =>
      database.tenantEntitlement.findUnique({
        where: { id, tenantId: validatedContext.tenantId },
      }),
    findByKey,
    getLimit: findByKey,
    getModule: findByKey,
    isModuleEnabled: async (key: ModuleEntitlementKey, now = new Date()) => {
      const entitlement = await findByKey(key);
      return entitlement !== null && tenantEntitlementEffective(entitlement, now);
    },
    list: () =>
      database.tenantEntitlement.findMany({
        orderBy: { entitlementKey: "asc" },
        where: { tenantId: validatedContext.tenantId },
      }),
  });
}

export async function assertTenantModuleEntitled(
  context: TenantContext,
  moduleKey: ModuleEntitlementKey,
  database: TenantEntitlementReadDatabase,
  now = new Date(),
): Promise<void> {
  if (!(await createTenantEntitlementResolver(context, database).isModuleEnabled(moduleKey, now))) {
    throw new TenantModuleEntitlementRequiredError(moduleKey);
  }
}
