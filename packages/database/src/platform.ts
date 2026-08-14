import { PrismaPg } from "@prisma/adapter-pg";
import { type DatabaseConfig, loadDatabaseConfig } from "@whatsapp-platform/config";
import {
  type AuditDatabaseClient,
  type AuditEntryInput,
  type AuditWriter,
  auditCreateData,
} from "./audit";
import { PrismaClient } from "./generated/prisma/client";

export {
  type BootstrapPlatformAdminInput,
  type CreatePlatformAdminInput,
  type CreatePlatformAdminSessionInput,
  createPlatformAuthRepository,
  type PlatformAdminCredentialRecord,
  type PlatformAdminProfile,
  type PlatformAuthRepository,
  type PlatformSessionIdentity,
} from "./platform-auth";
export {
  createPlatformTenantProvisioningRepository,
  PLATFORM_TENANT_MODULE_KEYS,
  PlatformTenantDeploymentNotFoundError,
  type PlatformTenantInitialLimits,
  type PlatformTenantModuleKey,
  PlatformTenantPermissionCatalogError,
  type PlatformTenantProvisioningDatabase,
  type PlatformTenantProvisioningInput,
  type PlatformTenantProvisioningRepository,
  type PlatformTenantProvisioningResult,
  PlatformTenantSlugConflictError,
} from "./platform-tenant-provisioning";
export {
  createPlatformTenantQueryService,
  type PlatformTenantDeploymentSummary,
  type PlatformTenantListItem,
  type PlatformTenantListOptions,
  type PlatformTenantListResult,
  type PlatformTenantQueryDatabase,
  type PlatformTenantQueryService,
} from "./platform-tenant-query";
export {
  type PermissionCatalogDatabase,
  syncPermissionCatalog,
} from "./rbac-permissions";
export {
  type CreatePasswordResetInput,
  type CreateTenantSessionInput,
  type CreateTenantUserInput,
  createTenantAuthRepository,
  type PasswordResetRecord,
  type TenantAuthRepository,
  type TenantAuthTenant,
  type TenantLoginRecord,
  type TenantSessionIdentity,
  type TenantUserProfile,
} from "./tenant-auth";

export type PlatformAuditEntryInput = Readonly<
  AuditEntryInput & {
    tenantId?: string | null;
  }
>;

export interface PlatformAuditWriter extends Omit<AuditWriter, "append"> {
  append(entry: PlatformAuditEntryInput): ReturnType<AuditWriter["append"]>;
}

export function createPlatformAuditWriter(database: AuditDatabaseClient): PlatformAuditWriter {
  return Object.freeze({
    append: (entry: PlatformAuditEntryInput) =>
      database.auditLog.create({ data: auditCreateData(entry, entry.tenantId ?? null) }),
  });
}

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
