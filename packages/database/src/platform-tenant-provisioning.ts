import { INITIAL_TENANT_ROLES, PERMISSION_CATALOG } from "@whatsapp-platform/rbac";
import { MODULE_ENTITLEMENT_KEYS, type ModuleEntitlementKey } from "./entitlement-catalog";
import type { PrismaClient } from "./generated/prisma/client";

export const PLATFORM_TENANT_MODULE_KEYS = MODULE_ENTITLEMENT_KEYS;
export type PlatformTenantModuleKey = ModuleEntitlementKey;

export type PlatformTenantInitialLimits = Readonly<{
  channelAccounts: number;
  users: number;
  organizationUnits: number;
  storageBytes: number;
  monthlyAiBudget: number | null;
}>;

export type PlatformTenantProvisioningInput = Readonly<{
  legalName: string;
  displayName: string;
  slug: string;
  defaultTimezone: string;
  defaultLocale: string;
  defaultCurrency: string;
  deploymentId: string | null;
  owner: Readonly<{
    email: string;
    passwordHash: string;
    displayName: string;
    locale: string;
    timezone: string;
  }>;
  enabledModules: readonly PlatformTenantModuleKey[];
  limits: PlatformTenantInitialLimits;
  actorPlatformAdminId: string;
  requestId: string;
}>;

export type PlatformTenantProvisioningResult = Readonly<{
  tenant: Readonly<{
    id: string;
    displayName: string;
    legalName: string;
    slug: string;
    status: "active";
  }>;
  owner: Readonly<{ id: string; email: string; displayName: string }>;
  organizationRoot: Readonly<{ id: string; name: string }>;
  enabledModules: readonly PlatformTenantModuleKey[];
  limits: PlatformTenantInitialLimits;
}>;

export class PlatformTenantSlugConflictError extends Error {
  override readonly name = "PlatformTenantSlugConflictError";
}

export class PlatformTenantDeploymentNotFoundError extends Error {
  override readonly name = "PlatformTenantDeploymentNotFoundError";
}

export class PlatformTenantPermissionCatalogError extends Error {
  override readonly name = "PlatformTenantPermissionCatalogError";
}

export type PlatformTenantProvisioningDatabase = Pick<PrismaClient, "$transaction">;

export interface PlatformTenantProvisioningRepository {
  provision(input: PlatformTenantProvisioningInput): Promise<PlatformTenantProvisioningResult>;
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function limitRows(tenantId: string, limits: PlatformTenantInitialLimits) {
  const values = [
    ["limit.channel_accounts", limits.channelAccounts],
    ["limit.users", limits.users],
    ["limit.organization_units", limits.organizationUnits],
    ["limit.storage_bytes", limits.storageBytes],
    ["limit.monthly_ai_budget", limits.monthlyAiBudget],
  ] as const;
  return values.map(([entitlementKey, limitValue]) => ({
    config: {},
    enabled: true,
    entitlementKey,
    limitValue: limitValue === null ? null : String(limitValue),
    source: "manual_override" as const,
    tenantId,
  }));
}

export function createPlatformTenantProvisioningRepository(
  database: PlatformTenantProvisioningDatabase,
): PlatformTenantProvisioningRepository {
  return Object.freeze({
    provision: async (input: PlatformTenantProvisioningInput) => {
      try {
        return await database.$transaction(async (transaction) => {
          const permissions = await transaction.permission.findMany({
            select: { id: true, key: true },
            where: { key: { in: PERMISSION_CATALOG.map(({ key }) => key) } },
          });
          if (permissions.length !== PERMISSION_CATALOG.length) {
            throw new PlatformTenantPermissionCatalogError();
          }
          if (input.deploymentId !== null) {
            const deployment = await transaction.platformDeployment.findUnique({
              select: { id: true },
              where: { id: input.deploymentId },
            });
            if (deployment === null) throw new PlatformTenantDeploymentNotFoundError();
          }

          const tenant = await transaction.tenant.create({
            data: {
              brandingConfig: {},
              defaultCurrency: input.defaultCurrency,
              defaultLocale: input.defaultLocale,
              defaultTimezone: input.defaultTimezone,
              deploymentId: input.deploymentId,
              displayName: input.displayName,
              legalName: input.legalName,
              settings: {},
              slug: input.slug,
              status: "active",
            },
            select: { displayName: true, id: true, legalName: true, slug: true, status: true },
          });
          const owner = await transaction.user.create({
            data: {
              displayName: input.owner.displayName,
              email: input.owner.email,
              locale: input.owner.locale,
              mfaState: "disabled",
              passwordHash: input.owner.passwordHash,
              status: "active",
              tenantId: tenant.id,
              timezone: input.owner.timezone,
            },
            select: { displayName: true, email: true, id: true },
          });
          const roles = await Promise.all(
            INITIAL_TENANT_ROLES.map((role) =>
              transaction.role.create({
                data: { ...role, isSystem: true, tenantId: tenant.id },
                select: { id: true, key: true },
              }),
            ),
          );
          const ownerRole = roles.find(({ key }) => key === "owner");
          if (ownerRole === undefined) throw new Error("Owner role provisioning failed");
          const permissionIds = new Map(permissions.map(({ id, key }) => [key, id]));
          await transaction.rolePermission.createMany({
            data: PERMISSION_CATALOG.map(({ key }) => {
              const permissionId = permissionIds.get(key);
              if (permissionId === undefined) throw new PlatformTenantPermissionCatalogError();
              return { permissionId, roleId: ownerRole.id };
            }),
          });
          await transaction.userRole.create({
            data: {
              organizationUnitId: null,
              roleId: ownerRole.id,
              tenantId: tenant.id,
              userId: owner.id,
            },
          });
          const organizationRoot = await transaction.organizationUnit.create({
            data: {
              active: true,
              code: null,
              name: tenant.displayName,
              parentId: null,
              settings: {},
              tenantId: tenant.id,
              timezone: null,
              type: "company",
            },
            select: { id: true, name: true },
          });
          await transaction.tenantEntitlement.createMany({
            data: [
              ...input.enabledModules.map((entitlementKey: PlatformTenantModuleKey) => ({
                config: {},
                enabled: true,
                entitlementKey,
                limitValue: null,
                source: "manual_override" as const,
                tenantId: tenant.id,
              })),
              ...limitRows(tenant.id, input.limits),
            ],
          });
          await transaction.auditLog.create({
            data: {
              action: "tenant.created",
              actorId: input.actorPlatformAdminId,
              actorType: "platform_admin",
              afterSummary: {
                displayName: tenant.displayName,
                enabledModules: input.enabledModules,
                slug: tenant.slug,
                status: tenant.status,
              },
              entityId: tenant.id,
              entityType: "Tenant",
              requestId: input.requestId,
              tenantId: tenant.id,
            },
          });
          await transaction.domainEventOutbox.create({
            data: {
              aggregateId: tenant.id,
              aggregateType: "Tenant",
              eventType: "tenant.created",
              payload: { slug: tenant.slug, status: tenant.status, tenantId: tenant.id },
              tenantId: tenant.id,
            },
          });

          return {
            enabledModules: input.enabledModules,
            limits: input.limits,
            organizationRoot,
            owner,
            tenant: { ...tenant, status: "active" as const },
          };
        });
      } catch (error) {
        if (error instanceof PlatformTenantPermissionCatalogError) throw error;
        if (error instanceof PlatformTenantDeploymentNotFoundError) throw error;
        if (isPrismaError(error, "P2002")) throw new PlatformTenantSlugConflictError();
        if (isPrismaError(error, "P2003")) throw new PlatformTenantDeploymentNotFoundError();
        throw error;
      }
    },
  });
}
