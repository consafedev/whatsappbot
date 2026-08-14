import type { PrismaClient } from "./generated/prisma/client";
import type { TenantStatus } from "./generated/prisma/enums";

export type PlatformTenantStatusMutationMetadata = Readonly<{
  actorPlatformAdminId: string;
  requestId: string;
}>;

export type PlatformTenantStatusMutationResult = Readonly<{
  changed: boolean;
  tenant: Readonly<{
    id: string;
    status: TenantStatus;
    suspendedAt: Date | null;
  }>;
}>;

export class PlatformTenantStatusNotFoundError extends Error {
  override readonly name = "PlatformTenantStatusNotFoundError";
}

export class PlatformTenantStatusTransitionError extends Error {
  override readonly name = "PlatformTenantStatusTransitionError";

  constructor(readonly currentStatus: TenantStatus) {
    super(`Tenant status cannot transition through this endpoint: ${currentStatus}`);
  }
}

export interface PlatformTenantStatusWriter {
  reactivate(
    tenantId: string,
    metadata: PlatformTenantStatusMutationMetadata,
    now?: Date,
  ): Promise<PlatformTenantStatusMutationResult>;
  suspend(
    tenantId: string,
    metadata: PlatformTenantStatusMutationMetadata,
    now?: Date,
  ): Promise<PlatformTenantStatusMutationResult>;
}

export type PlatformTenantStatusDatabase = Pick<
  PrismaClient,
  "$transaction" | "auditLog" | "domainEventOutbox" | "tenant"
>;

type TargetTransition = Readonly<{
  action: "tenant.reactivated" | "tenant.suspended";
  expectedStatus: "active" | "suspended";
  nextStatus: "active" | "suspended";
}>;

const suspendTransition: TargetTransition = {
  action: "tenant.suspended",
  expectedStatus: "active",
  nextStatus: "suspended",
};

const reactivateTransition: TargetTransition = {
  action: "tenant.reactivated",
  expectedStatus: "suspended",
  nextStatus: "active",
};

export function createPlatformTenantStatusWriter(
  database: PlatformTenantStatusDatabase,
): PlatformTenantStatusWriter {
  const transition = async (
    tenantId: string,
    target: TargetTransition,
    metadata: PlatformTenantStatusMutationMetadata,
    now = new Date(),
  ): Promise<PlatformTenantStatusMutationResult> =>
    database.$transaction(async (transaction) => {
      const current = await transaction.tenant.findUnique({
        select: { id: true, status: true, suspendedAt: true },
        where: { id: tenantId },
      });
      if (current === null) throw new PlatformTenantStatusNotFoundError();
      if (current.status === target.nextStatus) {
        return { changed: false, tenant: current };
      }
      if (current.status !== target.expectedStatus) {
        throw new PlatformTenantStatusTransitionError(current.status);
      }

      const suspendedAt = target.nextStatus === "suspended" ? now : null;
      const updated = await transaction.tenant.updateMany({
        data: { status: target.nextStatus, suspendedAt },
        where: { id: tenantId, status: target.expectedStatus },
      });
      if (updated.count === 0) {
        const concurrent = await transaction.tenant.findUnique({
          select: { id: true, status: true, suspendedAt: true },
          where: { id: tenantId },
        });
        if (concurrent === null) throw new PlatformTenantStatusNotFoundError();
        if (concurrent.status === target.nextStatus) return { changed: false, tenant: concurrent };
        throw new PlatformTenantStatusTransitionError(concurrent.status);
      }

      const tenant = { id: tenantId, status: target.nextStatus, suspendedAt };
      const beforeSummary = { status: current.status };
      const afterSummary = {
        status: target.nextStatus,
        suspendedAt: suspendedAt?.toISOString() ?? null,
      };
      await transaction.auditLog.create({
        data: {
          action: target.action,
          actorId: metadata.actorPlatformAdminId,
          actorType: "platform_admin",
          afterSummary,
          beforeSummary,
          entityId: tenantId,
          entityType: "Tenant",
          requestId: metadata.requestId,
          tenantId,
        },
      });
      await transaction.domainEventOutbox.create({
        data: {
          aggregateId: tenantId,
          aggregateType: "Tenant",
          eventType: target.action,
          payload: {
            previousStatus: current.status,
            status: target.nextStatus,
            suspendedAt: afterSummary.suspendedAt,
            tenantId,
          },
          tenantId,
        },
      });
      return { changed: true, tenant };
    });

  return Object.freeze({
    reactivate: (tenantId: string, metadata: PlatformTenantStatusMutationMetadata, now?: Date) =>
      transition(tenantId, reactivateTransition, metadata, now),
    suspend: (tenantId: string, metadata: PlatformTenantStatusMutationMetadata, now?: Date) =>
      transition(tenantId, suspendTransition, metadata, now),
  });
}
