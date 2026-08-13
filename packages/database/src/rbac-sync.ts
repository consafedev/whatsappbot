import {
  disconnectPlatformDatabaseClient,
  getPlatformDatabaseClient,
  syncPermissionCatalog,
} from "./platform";

async function main(): Promise<void> {
  const result = await syncPermissionCatalog(getPlatformDatabaseClient());
  console.log(`Synchronized ${result.synchronized} canonical permissions.`);
}

main()
  .catch(() => {
    console.error("Permission catalog synchronization failed.");
    process.exitCode = 1;
  })
  .finally(disconnectPlatformDatabaseClient);
