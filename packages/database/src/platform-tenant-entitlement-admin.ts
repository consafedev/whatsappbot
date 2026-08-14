import type { LimitEntitlementKey, ModuleEntitlementKey } from "./entitlement-catalog";
import { Prisma, type PrismaClient } from "./generated/prisma/client";
import { tenantEntitlementEffective, tenantEntitlementStatus } from "./tenant-entitlements";

export type PlatformModuleEntitlementPatch = Readonly<{
  enabled?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
  config?: Prisma.InputJsonObject;
}>;

export type PlatformLimitEntitlementPatch = Readonly<{
  value: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
}>;

type PlatformEntitlementMutationMetadata = Readonly<{
  actorPlatformAdminId: string;
  requestId: string;
}>;

export type PlatformModuleEntitlementResult = Readonly<{
  key: ModuleEntitlementKey;
  enabled: boolean;
  effective: boolean;
  status: "effective" | "scheduled" | "expired" | "disabled";
  source: "manual_override";
  startsAt: Date | null;
  endsAt: Date | null;
  configPresent: boolean;
}>;

export type PlatformLimitEntitlementResult = Readonly<{
  key: LimitEntitlementKey;
  value: string;
  effective: boolean;
  source: "manual_override";
  startsAt: Date | null;
  endsAt: Date | null;
}>;

export class PlatformEntitlementTenantNotFoundError extends Error {
  override readonly name = "PlatformEntitlementTenantNotFoundError";
}

export class PlatformEntitlementDateRangeError extends Error {
  override readonly name = "PlatformEntitlementDateRangeError";
}

export interface PlatformTenantEntitlementAdminRepository {
  moduleConfig(tenantId: string, key: ModuleEntitlementKey): Promise<Prisma.JsonObject>;
  patchModule(
    tenantId: string,
    key: ModuleEntitlementKey,
    patch: PlatformModuleEntitlementPatch,
    metadata: PlatformEntitlementMutationMetadata,
    now?: Date,
  ): Promise<PlatformModuleEntitlementResult>;
  patchLimit(
    tenantId: string,
    key: LimitEntitlementKey,
    patch: PlatformLimitEntitlementPatch,
    metadata: PlatformEntitlementMutationMetadata,
    now?: Date,
  ): Promise<PlatformLimitEntitlementResult>;
}

export type PlatformTenantEntitlementAdminDatabase = Pick<
  PrismaClient,
  "$transaction" | "tenant" | "tenantEntitlement"
>;

function assertDateRange(startsAt: Date | null, endsAt: Date | null): void {
  if (startsAt !== null && endsAt !== null && endsAt.getTime() <= startsAt.getTime()) {
    throw new PlatformEntitlementDateRangeError();
  }
}

function configObject(value: Prisma.JsonValue): Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : Object.freeze({});
}

function summary(row: {
  entitlementKey: string;
  enabled: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  source: string;
  limitValue: Prisma.Decimal | null;
}) {
  return {
    enabled: row.enabled,
    endsAt: row.endsAt?.toISOString() ?? null,
    key: row.entitlementKey,
    limitValue: row.limitValue?.toFixed(4) ?? null,
    source: row.source,
    startsAt: row.startsAt?.toISOString() ?? null,
  };
}

export function createPlatformTenantEntitlementAdminRepository(
  database: PlatformTenantEntitlementAdminDatabase,
): PlatformTenantEntitlementAdminRepository {
  const repository: PlatformTenantEntitlementAdminRepository = {
    moduleConfig: async (tenantId: string, key: ModuleEntitlementKey) => {
      const tenant = await database.tenant.findUnique({
        select: { id: true },
        where: { id: tenantId },
      });
      if (tenant === null) throw new PlatformEntitlementTenantNotFoundError();
      const row = await database.tenantEntitlement.findUnique({
        select: { config: true },
        where: { tenantId_entitlementKey: { entitlementKey: key, tenantId } },
      });
      return row === null ? {} : configObject(row.config);
    },
    patchModule: async (tenantId, key, patch, metadata, now = new Date()) =>
      database.$transaction(async (transaction) => {
        const tenant = await transaction.tenant.findUnique({
          select: { id: true },
          where: { id: tenantId },
        });
        if (tenant === null) throw new PlatformEntitlementTenantNotFoundError();
        const before = await transaction.tenantEntitlement.findUnique({
          where: { tenantId_entitlementKey: { entitlementKey: key, tenantId } },
        });
        const startsAt = patch.startsAt === undefined ? (before?.startsAt ?? null) : patch.startsAt;
        const endsAt = patch.endsAt === undefined ? (before?.endsAt ?? null) : patch.endsAt;
        assertDateRange(startsAt, endsAt);
        const config =
          patch.config === undefined ? configObject(before?.config ?? {}) : patch.config;
        const enabled = patch.enabled ?? before?.enabled ?? false;
        const row = await transaction.tenantEntitlement.upsert({
          create: {
            config,
            enabled,
            endsAt,
            entitlementKey: key,
            limitValue: null,
            source: "manual_override",
            startsAt,
            tenantId,
          },
          update: { config, enabled, endsAt, source: "manual_override", startsAt },
          where: { tenantId_entitlementKey: { entitlementKey: key, tenantId } },
        });
        const configChanged = patch.config !== undefined;
        const beforeSummary = before === null ? null : summary(before);
        const afterSummary = {
          ...summary(row),
          configChanged,
          configKeyCount: Object.keys(config).length,
          configSizeBytes: Buffer.byteLength(JSON.stringify(config), "utf8"),
        };
        await transaction.auditLog.create({
          data: {
            action: "tenant.entitlement.changed",
            actorId: metadata.actorPlatformAdminId,
            actorType: "platform_admin",
            afterSummary,
            ...(beforeSummary === null ? {} : { beforeSummary }),
            entityId: row.id,
            entityType: "TenantEntitlement",
            requestId: metadata.requestId,
            tenantId,
          },
        });
        await transaction.domainEventOutbox.create({
          data: {
            aggregateId: row.id,
            aggregateType: "TenantEntitlement",
            eventType: "tenant.entitlement.changed",
            payload: {
              configChanged,
              effective: tenantEntitlementEffective(row, now),
              enabled: row.enabled,
              entitlementKey: key,
              source: row.source,
              tenantId,
            },
            tenantId,
          },
        });
        return {
          configPresent: Object.keys(config).length > 0,
          effective: tenantEntitlementEffective(row, now),
          enabled: row.enabled,
          endsAt: row.endsAt,
          key,
          source: "manual_override" as const,
          startsAt: row.startsAt,
          status: tenantEntitlementStatus(row, now),
        };
      }),
    patchLimit: async (tenantId, key, patch, metadata, now = new Date()) =>
      database.$transaction(async (transaction) => {
        const tenant = await transaction.tenant.findUnique({
          select: { id: true },
          where: { id: tenantId },
        });
        if (tenant === null) throw new PlatformEntitlementTenantNotFoundError();
        const before = await transaction.tenantEntitlement.findUnique({
          where: { tenantId_entitlementKey: { entitlementKey: key, tenantId } },
        });
        const startsAt = patch.startsAt === undefined ? (before?.startsAt ?? null) : patch.startsAt;
        const endsAt = patch.endsAt === undefined ? (before?.endsAt ?? null) : patch.endsAt;
        assertDateRange(startsAt, endsAt);
        const limitValue = new Prisma.Decimal(patch.value);
        const row = await transaction.tenantEntitlement.upsert({
          create: {
            config: {},
            enabled: true,
            endsAt,
            entitlementKey: key,
            limitValue,
            source: "manual_override",
            startsAt,
            tenantId,
          },
          update: { enabled: true, endsAt, limitValue, source: "manual_override", startsAt },
          where: { tenantId_entitlementKey: { entitlementKey: key, tenantId } },
        });
        await transaction.auditLog.create({
          data: {
            action: "tenant.entitlement.changed",
            actorId: metadata.actorPlatformAdminId,
            actorType: "platform_admin",
            afterSummary: summary(row),
            ...(before === null ? {} : { beforeSummary: summary(before) }),
            entityId: row.id,
            entityType: "TenantEntitlement",
            requestId: metadata.requestId,
            tenantId,
          },
        });
        await transaction.domainEventOutbox.create({
          data: {
            aggregateId: row.id,
            aggregateType: "TenantEntitlement",
            eventType: "tenant.entitlement.changed",
            payload: {
              configChanged: false,
              effective: tenantEntitlementEffective(row, now),
              enabled: row.enabled,
              entitlementKey: key,
              limitValue: row.limitValue?.toFixed(4) ?? null,
              source: row.source,
              tenantId,
            },
            tenantId,
          },
        });
        return {
          effective: tenantEntitlementEffective(row, now),
          endsAt: row.endsAt,
          key,
          source: "manual_override" as const,
          startsAt: row.startsAt,
          value: row.limitValue?.toFixed(4) ?? "0.0000",
        };
      }),
  };
  return Object.freeze(repository);
}
