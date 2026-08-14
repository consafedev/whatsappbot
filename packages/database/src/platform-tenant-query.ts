import type { Prisma } from "./generated/prisma/client";
import type {
  DeploymentEnvironment,
  PlatformDeploymentMode,
  PlatformDeploymentStatus,
  TenantStatus,
} from "./generated/prisma/enums";
import { effectivePlatformEntitlementWhere } from "./platform-tenant-entitlements";

export type PlatformTenantListOptions = Readonly<{
  page: number;
  pageSize: number;
  search?: string;
  status?: TenantStatus;
  now?: Date;
}>;

export type PlatformTenantDeploymentSummary = Readonly<{
  id: string;
  name: string;
  mode: PlatformDeploymentMode;
  environment: DeploymentEnvironment;
  status: PlatformDeploymentStatus;
  currentVersion: string;
  lastHealthAt: Date | null;
}>;

export type PlatformTenantListItem = Readonly<{
  id: string;
  displayName: string;
  legalName: string;
  slug: string;
  status: TenantStatus;
  deployment: PlatformTenantDeploymentSummary | null;
  enabledModules: readonly string[];
  channelCount: null;
  userCount: number;
  lastActivityAt: Date | null;
}>;

export type PlatformTenantListResult = Readonly<{
  items: readonly PlatformTenantListItem[];
  page: number;
  pageSize: number;
  total: number;
}>;

export type PlatformTenantQueryDatabase = Pick<Prisma.TransactionClient, "tenant">;

export interface PlatformTenantQueryService {
  list(options: PlatformTenantListOptions): Promise<PlatformTenantListResult>;
}

function latestDate(first: Date | undefined, second: Date | undefined): Date | null {
  if (first === undefined) return second ?? null;
  if (second === undefined) return first;
  return first.getTime() >= second.getTime() ? first : second;
}

export function createPlatformTenantQueryService(
  database: PlatformTenantQueryDatabase,
): PlatformTenantQueryService {
  const service: PlatformTenantQueryService = {
    list: async (options) => {
      const now = options.now ?? new Date();
      const search = options.search?.trim();
      const where: Prisma.TenantWhereInput = {
        ...(options.status === undefined ? {} : { status: options.status }),
        ...(search === undefined || search.length === 0
          ? {}
          : {
              OR: [
                { displayName: { contains: search, mode: "insensitive" } },
                { legalName: { contains: search, mode: "insensitive" } },
                { slug: { contains: search, mode: "insensitive" } },
              ],
            }),
      };

      const [total, tenants] = await Promise.all([
        database.tenant.count({ where }),
        database.tenant.findMany({
          orderBy: [{ displayName: "asc" }, { id: "asc" }],
          select: {
            _count: { select: { users: true } },
            auditLogs: {
              orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
              select: { occurredAt: true },
              take: 1,
            },
            deployment: {
              select: {
                currentVersion: true,
                environment: true,
                id: true,
                lastHealthAt: true,
                mode: true,
                name: true,
                status: true,
              },
            },
            displayName: true,
            entitlements: {
              orderBy: { entitlementKey: "asc" },
              select: { entitlementKey: true },
              where: {
                entitlementKey: { startsWith: "module." },
                ...effectivePlatformEntitlementWhere(now),
              },
            },
            id: true,
            legalName: true,
            slug: true,
            status: true,
            userSessions: {
              orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
              select: { lastSeenAt: true },
              take: 1,
            },
          },
          skip: (options.page - 1) * options.pageSize,
          take: options.pageSize,
          where,
        }),
      ]);

      return {
        items: tenants.map((tenant) => ({
          channelCount: null,
          deployment: tenant.deployment,
          displayName: tenant.displayName,
          enabledModules: tenant.entitlements.map(({ entitlementKey }) => entitlementKey),
          id: tenant.id,
          lastActivityAt: latestDate(
            tenant.userSessions[0]?.lastSeenAt,
            tenant.auditLogs[0]?.occurredAt,
          ),
          legalName: tenant.legalName,
          slug: tenant.slug,
          status: tenant.status,
          userCount: tenant._count.users,
        })),
        page: options.page,
        pageSize: options.pageSize,
        total,
      };
    },
  };
  return Object.freeze(service);
}
