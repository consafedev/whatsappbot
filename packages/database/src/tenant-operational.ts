import type { Prisma } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";

export type TenantOperationalReadDatabase = Pick<Prisma.TransactionClient, "tenant">;

export class TenantNotOperationalError extends Error {
  override readonly name = "TenantNotOperationalError";

  constructor(readonly tenantId: string) {
    super(`Tenant is not operational: ${tenantId}`);
  }
}

export function tenantIsOperational(status: string): boolean {
  return status === "active";
}

/**
 * Revalidate the tenant immediately before work that must not run while the
 * tenant is suspended. Callers receive no tenant-controlled identifier.
 */
export async function assertTenantOperational(
  context: TenantContext,
  database: TenantOperationalReadDatabase,
): Promise<void> {
  const validatedContext = createTenantContext(context.tenantId);
  const tenant = await database.tenant.findUnique({
    select: { status: true },
    where: { id: validatedContext.tenantId },
  });
  if (tenant === null || !tenantIsOperational(tenant.status)) {
    throw new TenantNotOperationalError(validatedContext.tenantId);
  }
}
