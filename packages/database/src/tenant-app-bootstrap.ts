import { isModuleEntitlementKey } from "./entitlement-catalog";
import type { Prisma } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess, type TenantDataAccessDatabase } from "./tenant-data-access";
import { tenantEntitlementEffective } from "./tenant-entitlements";

export type TenantAppBootstrapDatabase = TenantDataAccessDatabase &
  Pick<Prisma.TransactionClient, "tenant">;

export type TenantAppBootstrap = Readonly<{
  branding: Readonly<{ mode: "platform_default" }>;
  effectiveModules: readonly string[];
  effectivePermissions: readonly string[];
  tenant: Readonly<{
    defaultLocale: string;
    defaultTimezone: string;
    displayName: string;
    id: string;
    slug: string;
  }>;
  user: Readonly<{
    displayName: string;
    email: string;
    id: string;
    locale: string;
    mfaState: string;
    timezone: string;
  }>;
}>;

export class TenantAppBootstrapNotFoundError extends Error {
  constructor() {
    super("Tenant app identity was not found");
    this.name = "TenantAppBootstrapNotFoundError";
  }
}

export async function createTenantAppBootstrap(
  context: TenantContext,
  userId: string,
  database: TenantAppBootstrapDatabase,
  now = new Date(),
): Promise<TenantAppBootstrap> {
  const tenantContext = createTenantContext(context.tenantId);
  const data = createTenantDataAccess(tenantContext, database);
  const [tenant, user, entitlements, permissions] = await Promise.all([
    database.tenant.findUnique({
      select: {
        defaultLocale: true,
        defaultTimezone: true,
        displayName: true,
        id: true,
        slug: true,
      },
      where: { id: tenantContext.tenantId },
    }),
    database.user.findUnique({
      select: {
        displayName: true,
        email: true,
        id: true,
        locale: true,
        mfaState: true,
        timezone: true,
      },
      where: { id: userId, tenantId: tenantContext.tenantId },
    }),
    data.entitlements.list(),
    data.permissions.resolveForUser(userId),
  ]);

  if (tenant === null || user === null) throw new TenantAppBootstrapNotFoundError();

  return Object.freeze({
    branding: Object.freeze({ mode: "platform_default" as const }),
    effectiveModules: Object.freeze(
      entitlements
        .filter(
          (entitlement) =>
            isModuleEntitlementKey(entitlement.entitlementKey) &&
            tenantEntitlementEffective(entitlement, now),
        )
        .map((entitlement) => entitlement.entitlementKey)
        .sort(),
    ),
    effectivePermissions: Object.freeze([...permissions].sort()),
    tenant: Object.freeze(tenant),
    user: Object.freeze({ ...user, mfaState: user.mfaState }),
  });
}
