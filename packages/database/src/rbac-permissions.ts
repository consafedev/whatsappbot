import { PERMISSION_CATALOG } from "@whatsapp-platform/rbac";
import type { Prisma, PrismaClient } from "./generated/prisma/client";

export type PermissionCatalogDatabase = Pick<PrismaClient | Prisma.TransactionClient, "permission">;

export async function syncPermissionCatalog(
  database: PermissionCatalogDatabase,
): Promise<{ synchronized: number }> {
  await Promise.all(
    PERMISSION_CATALOG.map((permission) =>
      database.permission.upsert({
        create: permission,
        update: { description: permission.description },
        where: { key: permission.key },
      }),
    ),
  );
  return { synchronized: PERMISSION_CATALOG.length };
}
