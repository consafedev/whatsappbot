import { PrismaPg } from "@prisma/adapter-pg";
import { type DatabaseConfig, loadDatabaseConfig } from "@whatsapp-platform/config";
import { PrismaClient } from "./generated/prisma/client";

let sharedClient: PrismaClient | undefined;

export function createPlatformDatabaseClient(config: Readonly<DatabaseConfig>): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.databaseUrl }),
  });
}

export function getPlatformDatabaseClient(): PrismaClient {
  sharedClient ??= createPlatformDatabaseClient(loadDatabaseConfig());
  return sharedClient;
}

export async function disconnectPlatformDatabaseClient(): Promise<void> {
  if (sharedClient === undefined) {
    return;
  }

  await sharedClient.$disconnect();
  sharedClient = undefined;
}

export { Prisma, PrismaClient } from "./generated/prisma/client";
