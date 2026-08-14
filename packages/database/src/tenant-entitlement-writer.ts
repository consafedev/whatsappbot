import type { Prisma, TenantEntitlement } from "./generated/prisma/client";
import type { TenantEntitlementSource } from "./generated/prisma/enums";
import { createTenantContext, type TenantContext } from "./tenant-context";

type DecimalInput = Prisma.Decimal | Prisma.DecimalJsLike | number | string;

export type TenantEntitlementCreateData = Readonly<{
  entitlementKey: string;
  enabled?: boolean;
  limitValue?: DecimalInput | null;
  config?: Prisma.InputJsonValue;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  source: TenantEntitlementSource;
}>;

export type TenantEntitlementUpdateData = Readonly<{
  entitlementKey?: string;
  enabled?: boolean;
  limitValue?: DecimalInput | null;
  config?: Prisma.InputJsonValue;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  source?: TenantEntitlementSource;
}>;

export interface TenantEntitlementWriter {
  create(data: TenantEntitlementCreateData): Promise<TenantEntitlement>;
  update(id: string, data: TenantEntitlementUpdateData): Promise<TenantEntitlement>;
}

function updateData(
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

/** Internal fixture/foundation writer. It is deliberately absent from the package root export. */
export function createTenantEntitlementWriter(
  context: TenantContext,
  database: Pick<Prisma.TransactionClient, "tenantEntitlement">,
): TenantEntitlementWriter {
  const validated = createTenantContext(context.tenantId);
  return Object.freeze({
    create: (input: TenantEntitlementCreateData) =>
      database.tenantEntitlement.create({
        data: {
          entitlementKey: input.entitlementKey,
          source: input.source,
          tenantId: validated.tenantId,
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          ...(input.limitValue === undefined ? {} : { limitValue: input.limitValue }),
          ...(input.config === undefined ? {} : { config: input.config }),
          ...(input.startsAt === undefined ? {} : { startsAt: input.startsAt }),
          ...(input.endsAt === undefined ? {} : { endsAt: input.endsAt }),
        },
      }),
    update: (id: string, input: TenantEntitlementUpdateData) =>
      database.tenantEntitlement.update({
        data: updateData(input),
        where: { id, tenantId: validated.tenantId },
      }),
  });
}
