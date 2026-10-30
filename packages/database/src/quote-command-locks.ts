import type { Prisma } from "./generated/prisma/client";

export async function quoteCommandLock(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  key: string,
): Promise<void> {
  await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`quotes:command:${tenantId.toLowerCase()}:${key}`}, 0))`;
}

export async function quoteTenantPolicyLock(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`quotes:tenant-policy:${tenantId.toLowerCase()}`}, 0))`;
}
