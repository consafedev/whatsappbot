import { PrismaPg } from "@prisma/adapter-pg";
import { type DatabaseConfig, loadDatabaseConfig } from "@whatsapp-platform/config";
import { PrismaClient } from "./generated/prisma/client";

let sharedClient: PrismaClient | undefined;

export function createPrismaClient(config: Readonly<DatabaseConfig>): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.databaseUrl }),
  });
}

export function getPrismaClient(): PrismaClient {
  sharedClient ??= createPrismaClient(loadDatabaseConfig());
  return sharedClient;
}

export async function disconnectPrismaClient(): Promise<void> {
  if (sharedClient === undefined) {
    return;
  }

  await sharedClient.$disconnect();
  sharedClient = undefined;
}

export { PrismaClient } from "./generated/prisma/client";
export * from "./generated/prisma/enums";
