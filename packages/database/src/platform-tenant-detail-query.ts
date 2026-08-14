import { LIMIT_ENTITLEMENT_KEYS, type LimitEntitlementKey } from "./entitlement-catalog";
import type { Prisma } from "./generated/prisma/client";
import type {
  DeploymentEnvironment,
  OrganizationUnitType,
  PlatformDeploymentMode,
  PlatformDeploymentStatus,
  ReleaseChannel,
  TenantEntitlementSource,
  TenantStatus,
  UserMfaState,
  UserStatus,
} from "./generated/prisma/enums";
import { platformEntitlementEffective } from "./platform-tenant-entitlements";
import {
  PLATFORM_TENANT_MODULE_KEYS,
  type PlatformTenantModuleKey,
} from "./platform-tenant-provisioning";
import { tenantEntitlementStatus } from "./tenant-entitlements";

export const PLATFORM_TENANT_LIMIT_KEYS = LIMIT_ENTITLEMENT_KEYS;
export type PlatformTenantLimitKey = LimitEntitlementKey;

export class PlatformTenantNotFoundError extends Error {
  override readonly name = "PlatformTenantNotFoundError";
}

export type PlatformTenantPageOptions = Readonly<{ page: number; pageSize: number }>;

export type PlatformTenantDetail = Readonly<{
  general: Readonly<{
    id: string;
    legalName: string;
    displayName: string;
    slug: string;
    status: TenantStatus;
    defaultTimezone: string;
    defaultLocale: string;
    defaultCurrency: string;
    createdAt: Date;
    updatedAt: Date;
    suspendedAt: Date | null;
    themeMode: "default" | "light" | "dark" | "system";
    brandingOverride: boolean;
  }>;
  organizationRoot: Readonly<{
    id: string;
    name: string;
    type: OrganizationUnitType;
    active: boolean;
  }> | null;
  modules: readonly Readonly<{
    key: PlatformTenantModuleKey;
    enabled: boolean;
    effective: boolean;
    status: "effective" | "scheduled" | "expired" | "disabled";
    source: TenantEntitlementSource | null;
    startsAt: Date | null;
    endsAt: Date | null;
    configPresent: boolean;
  }>[];
  limits: readonly Readonly<{
    key: PlatformTenantLimitKey;
    limitValue: string | null;
    source: TenantEntitlementSource | null;
    startsAt: Date | null;
    endsAt: Date | null;
  }>[];
  usage: Readonly<{
    users: Readonly<{ used: number; limit: string | null }>;
    organizationUnits: Readonly<{ used: number; limit: string | null }>;
    channels: Readonly<{ used: null; limit: string | null }>;
    storageBytes: Readonly<{ used: null; limit: string | null }>;
    monthlyAiBudget: Readonly<{ used: null; limit: string | null }>;
  }>;
  channels: Readonly<{ available: false; count: null }>;
  deployment: Readonly<{
    id: string;
    name: string;
    mode: PlatformDeploymentMode;
    environment: DeploymentEnvironment;
    currentVersion: string;
    targetVersion: string | null;
    releaseChannel: ReleaseChannel;
    status: PlatformDeploymentStatus;
    lastHealthAt: Date | null;
  }> | null;
  backup: Readonly<{ available: false }>;
}>;

export type PlatformTenantUserPage = Readonly<{
  items: readonly Readonly<{
    id: string;
    email: string;
    displayName: string;
    status: UserStatus;
    locale: string;
    timezone: string;
    lastLoginAt: Date | null;
    mfaState: UserMfaState;
    createdAt: Date;
    roles: readonly Readonly<{
      name: string;
      key: string;
      organizationUnit: Readonly<{ id: string; name: string }> | null;
    }>[];
  }>[];
  page: number;
  pageSize: number;
  total: number;
}>;

export type PlatformTenantAuditPage = Readonly<{
  items: readonly Readonly<{
    id: string;
    actorType: string;
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    organizationUnitId: string | null;
    requestId: string;
    occurredAt: Date;
  }>[];
  page: number;
  pageSize: number;
  total: number;
}>;

export type PlatformTenantDetailQueryDatabase = Pick<
  Prisma.TransactionClient,
  "tenant" | "user" | "auditLog"
>;

export interface PlatformTenantDetailQueryService {
  detail(tenantId: string, now?: Date): Promise<PlatformTenantDetail>;
  users(tenantId: string, options: PlatformTenantPageOptions): Promise<PlatformTenantUserPage>;
  audit(tenantId: string, options: PlatformTenantPageOptions): Promise<PlatformTenantAuditPage>;
}

function nonEmptyJson(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function themeMode(settings: unknown): "default" | "light" | "dark" | "system" {
  if (typeof settings !== "object" || settings === null || Array.isArray(settings))
    return "default";
  const value = (settings as Record<string, unknown>).themeMode;
  return value === "light" || value === "dark" || value === "system" ? value : "default";
}

export function createPlatformTenantDetailQueryService(
  database: PlatformTenantDetailQueryDatabase,
): PlatformTenantDetailQueryService {
  return Object.freeze({
    detail: async (tenantId: string, observedAt = new Date()): Promise<PlatformTenantDetail> => {
      const tenant = await database.tenant.findUnique({
        where: { id: tenantId },
        select: {
          _count: { select: { organizationUnits: true, users: true } },
          brandingConfig: true,
          createdAt: true,
          defaultCurrency: true,
          defaultLocale: true,
          defaultTimezone: true,
          deployment: {
            select: {
              currentVersion: true,
              environment: true,
              id: true,
              lastHealthAt: true,
              mode: true,
              name: true,
              releaseChannel: true,
              status: true,
              targetVersion: true,
            },
          },
          displayName: true,
          entitlements: {
            select: {
              config: true,
              enabled: true,
              endsAt: true,
              entitlementKey: true,
              limitValue: true,
              source: true,
              startsAt: true,
            },
            where: {
              entitlementKey: {
                in: [...PLATFORM_TENANT_MODULE_KEYS, ...PLATFORM_TENANT_LIMIT_KEYS],
              },
            },
          },
          id: true,
          legalName: true,
          organizationUnits: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { active: true, id: true, name: true, type: true },
            take: 1,
            where: { parentId: null },
          },
          settings: true,
          slug: true,
          status: true,
          suspendedAt: true,
          updatedAt: true,
        },
      });
      if (tenant === null) throw new PlatformTenantNotFoundError();

      const byKey = new Map(tenant.entitlements.map((row) => [row.entitlementKey, row]));
      const limits = PLATFORM_TENANT_LIMIT_KEYS.map((key) => {
        const row = byKey.get(key);
        return {
          key,
          limitValue: row?.limitValue?.toFixed(4) ?? null,
          source: row?.source ?? null,
          startsAt: row?.startsAt ?? null,
          endsAt: row?.endsAt ?? null,
        };
      });
      const limit = (key: PlatformTenantLimitKey) =>
        limits.find((item) => item.key === key)?.limitValue ?? null;

      return {
        general: {
          id: tenant.id,
          legalName: tenant.legalName,
          displayName: tenant.displayName,
          slug: tenant.slug,
          status: tenant.status,
          defaultTimezone: tenant.defaultTimezone,
          defaultLocale: tenant.defaultLocale,
          defaultCurrency: tenant.defaultCurrency,
          createdAt: tenant.createdAt,
          updatedAt: tenant.updatedAt,
          suspendedAt: tenant.suspendedAt,
          themeMode: themeMode(tenant.settings),
          brandingOverride: nonEmptyJson(tenant.brandingConfig),
        },
        organizationRoot: tenant.organizationUnits[0] ?? null,
        modules: PLATFORM_TENANT_MODULE_KEYS.map((key) => {
          const row = byKey.get(key);
          return {
            key,
            enabled: row?.enabled ?? false,
            effective: row === undefined ? false : platformEntitlementEffective(row, observedAt),
            source: row?.source ?? null,
            status: row === undefined ? "disabled" : tenantEntitlementStatus(row, observedAt),
            startsAt: row?.startsAt ?? null,
            endsAt: row?.endsAt ?? null,
            configPresent: nonEmptyJson(row?.config),
          };
        }),
        limits,
        usage: {
          users: { used: tenant._count.users, limit: limit("limit.users") },
          organizationUnits: {
            used: tenant._count.organizationUnits,
            limit: limit("limit.organization_units"),
          },
          channels: { used: null, limit: limit("limit.channel_accounts") },
          storageBytes: { used: null, limit: limit("limit.storage_bytes") },
          monthlyAiBudget: { used: null, limit: limit("limit.monthly_ai_budget") },
        },
        channels: { available: false, count: null },
        deployment: tenant.deployment,
        backup: { available: false },
      };
    },

    users: async (
      tenantId: string,
      options: PlatformTenantPageOptions,
    ): Promise<PlatformTenantUserPage> => {
      const [tenant, total, users] = await Promise.all([
        database.tenant.findUnique({ select: { id: true }, where: { id: tenantId } }),
        database.user.count({ where: { tenantId } }),
        database.user.findMany({
          orderBy: [{ displayName: "asc" }, { id: "asc" }],
          select: {
            createdAt: true,
            displayName: true,
            email: true,
            id: true,
            lastLoginAt: true,
            locale: true,
            mfaState: true,
            roleAssignments: {
              orderBy: [{ role: { name: "asc" } }, { id: "asc" }],
              select: {
                organizationUnit: { select: { id: true, name: true } },
                role: { select: { key: true, name: true } },
              },
            },
            status: true,
            timezone: true,
          },
          skip: (options.page - 1) * options.pageSize,
          take: options.pageSize,
          where: { tenantId },
        }),
      ]);
      if (tenant === null) throw new PlatformTenantNotFoundError();
      return {
        items: users.map(({ roleAssignments, ...user }) => ({
          ...user,
          roles: roleAssignments.map(({ organizationUnit, role }) => ({
            ...role,
            organizationUnit,
          })),
        })),
        page: options.page,
        pageSize: options.pageSize,
        total,
      };
    },

    audit: async (
      tenantId: string,
      options: PlatformTenantPageOptions,
    ): Promise<PlatformTenantAuditPage> => {
      const [tenant, total, items] = await Promise.all([
        database.tenant.findUnique({ select: { id: true }, where: { id: tenantId } }),
        database.auditLog.count({ where: { tenantId } }),
        database.auditLog.findMany({
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          select: {
            action: true,
            actorId: true,
            actorType: true,
            entityId: true,
            entityType: true,
            id: true,
            occurredAt: true,
            organizationUnitId: true,
            requestId: true,
          },
          skip: (options.page - 1) * options.pageSize,
          take: options.pageSize,
          where: { tenantId },
        }),
      ]);
      if (tenant === null) throw new PlatformTenantNotFoundError();
      return { items, page: options.page, pageSize: options.pageSize, total };
    },
  });
}
