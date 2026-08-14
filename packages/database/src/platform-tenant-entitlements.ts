import type { Prisma } from "./generated/prisma/client";

export type TemporalEntitlement = Readonly<{
  enabled: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}>;

export function platformEntitlementEffective(entitlement: TemporalEntitlement, now: Date): boolean {
  return (
    entitlement.enabled &&
    (entitlement.startsAt === null || entitlement.startsAt.getTime() <= now.getTime()) &&
    (entitlement.endsAt === null || entitlement.endsAt.getTime() > now.getTime())
  );
}

export function effectivePlatformEntitlementWhere(now: Date): Prisma.TenantEntitlementWhereInput {
  return {
    enabled: true,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    ],
  };
}
