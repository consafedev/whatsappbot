import { ChannelAccountNotFoundError } from "./channel-account-manager";
import type { ChannelAccount, Prisma, PrismaClient } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import {
  createTenantDataAccess,
  type TenantDataAccessDatabase,
  type TenantTransactionDatabase,
} from "./tenant-data-access";
import { assertTenantOperational } from "./tenant-operational";

export type ChannelHeartbeatMetrics = Readonly<{
  latencyMs?: number;
  socketStatus: "open" | "connecting" | "closed";
}>;

export type ChannelConnectionFailure = Readonly<{
  isFatal: boolean;
  statusCode?: number;
  reason: string;
  attemptCount?: number;
}>;

export type ChannelHealthManagerDatabase = TenantTransactionDatabase &
  TenantDataAccessDatabase &
  Pick<PrismaClient, "channelAccount" | "tenant">;

export interface ChannelHealthManager {
  recordChannelHeartbeat(
    context: TenantContext,
    channelAccountId: string,
    metrics: ChannelHeartbeatMetrics,
  ): Promise<ChannelAccount>;
  handleChannelConnectionFailure(
    context: TenantContext,
    channelAccountId: string,
    failure: ChannelConnectionFailure,
  ): Promise<ChannelAccount>;
  checkStaleChannels(context: TenantContext, staleThresholdSeconds?: number): Promise<string[]>;
}

function parseJson(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

export function createChannelHealthManager(
  database: ChannelHealthManagerDatabase,
): ChannelHealthManager {
  const recordChannelHeartbeat = async (
    context: TenantContext,
    channelAccountId: string,
    metrics: ChannelHeartbeatMetrics,
  ): Promise<ChannelAccount> => {
    const tenant = createTenantContext(context.tenantId);
    return database.$transaction(async (transaction) => {
      await assertTenantOperational(tenant, transaction);

      const current = await transaction.channelAccount.findUnique({
        where: { id: channelAccountId, tenantId: tenant.tenantId },
      });

      if (current === null) {
        throw new ChannelAccountNotFoundError();
      }

      const now = new Date();
      const currentSettings = parseJson(current.settings);
      const currentMetadata = parseJson(currentSettings.metadata);

      const nextMetadata = {
        ...currentMetadata,
        isDegraded: false,
        lastHeartbeatAt: now.toISOString(),
        lastLatencyMs: metrics.latencyMs ?? null,
        socketStatus: metrics.socketStatus,
      };

      const nextSettings = {
        ...currentSettings,
        isDegraded: false,
        lastHeartbeatAt: now.toISOString(),
        lastLatencyMs: metrics.latencyMs ?? null,
        metadata: nextMetadata,
        socketStatus: metrics.socketStatus,
      };

      return transaction.channelAccount.update({
        data: {
          healthStatus: "healthy",
          settings: nextSettings as Prisma.InputJsonValue,
          updatedAt: now,
        },
        where: { id: channelAccountId, tenantId: tenant.tenantId },
      });
    });
  };

  const handleChannelConnectionFailure = async (
    context: TenantContext,
    channelAccountId: string,
    failure: ChannelConnectionFailure,
  ): Promise<ChannelAccount> => {
    const tenant = createTenantContext(context.tenantId);
    return database.$transaction(async (transaction) => {
      await assertTenantOperational(tenant, transaction);

      const current = await transaction.channelAccount.findUnique({
        where: { id: channelAccountId, tenantId: tenant.tenantId },
      });

      if (current === null) {
        throw new ChannelAccountNotFoundError();
      }

      const now = new Date();
      const currentSettings = parseJson(current.settings);
      const currentMetadata = parseJson(currentSettings.metadata);
      const access = createTenantDataAccess(tenant, transaction);

      if (failure.isFatal) {
        const nextMetadata = {
          ...currentMetadata,
          disconnectReason: failure.reason,
          disconnectedAt: now.toISOString(),
          isDegraded: false,
          latestQrRaw: null,
          socketStatus: "closed",
          statusCode: failure.statusCode ?? null,
        };

        const nextSettings = {
          ...currentSettings,
          disconnectReason: failure.reason,
          disconnectedAt: now.toISOString(),
          isDegraded: false,
          latestQrRaw: null,
          metadata: nextMetadata,
          socketStatus: "closed",
          statusCode: failure.statusCode ?? null,
        };

        const updated = await transaction.channelAccount.update({
          data: {
            credentialsCiphertext: null,
            credentialsKeyVersion: null,
            healthStatus: "disconnected",
            lastDisconnectedAt: now,
            settings: nextSettings as Prisma.InputJsonValue,
            status: "DISCONNECTED",
            updatedAt: now,
          },
          where: { id: channelAccountId, tenantId: tenant.tenantId },
        });

        await access.audit.append({
          action: "channel.disconnected",
          actorId: "system",
          actorType: "system",
          afterSummary: {
            displayName: updated.displayName,
            id: updated.id,
            reason: failure.reason,
            status: "DISCONNECTED",
            statusCode: failure.statusCode,
          },
          entityId: updated.id,
          entityType: "ChannelAccount",
          organizationUnitId: updated.organizationUnitId,
          requestId: "channel-fatal-disconnect",
        });

        await access.outbox.append({
          aggregateId: updated.id,
          aggregateType: "ChannelAccount",
          eventType: "channel.disconnected",
          payload: {
            channelAccountId: updated.id,
            reason: failure.reason,
            statusCode: failure.statusCode,
            tenantId: tenant.tenantId,
            timestamp: now.toISOString(),
          },
        });

        return updated;
      }

      // Non-fatal (transient reconnection attempt)
      const attempts = failure.attemptCount ?? 1;
      const nextMetadata = {
        ...currentMetadata,
        lastReconnectAttemptAt: now.toISOString(),
        reconnectAttempts: attempts,
        reconnectReason: failure.reason,
        socketStatus: "connecting",
        statusCode: failure.statusCode ?? null,
      };

      const nextSettings = {
        ...currentSettings,
        lastReconnectAttemptAt: now.toISOString(),
        metadata: nextMetadata,
        reconnectAttempts: attempts,
        reconnectReason: failure.reason,
        socketStatus: "connecting",
        statusCode: failure.statusCode ?? null,
      };

      const updated = await transaction.channelAccount.update({
        data: {
          healthStatus: "degraded",
          settings: nextSettings as Prisma.InputJsonValue,
          status: "CONNECTING",
          updatedAt: now,
        },
        where: { id: channelAccountId, tenantId: tenant.tenantId },
      });

      await access.outbox.append({
        aggregateId: updated.id,
        aggregateType: "ChannelAccount",
        eventType: "channel.reconnecting",
        payload: {
          attemptCount: attempts,
          channelAccountId: updated.id,
          reason: failure.reason,
          statusCode: failure.statusCode,
          tenantId: tenant.tenantId,
          timestamp: now.toISOString(),
        },
      });

      return updated;
    });
  };

  const checkStaleChannels = async (
    context: TenantContext,
    staleThresholdSeconds = 90,
  ): Promise<string[]> => {
    const tenant = createTenantContext(context.tenantId);
    return database.$transaction(async (transaction) => {
      await assertTenantOperational(tenant, transaction);

      const activeChannels = await transaction.channelAccount.findMany({
        where: {
          active: true,
          status: { in: ["CONNECTED", "connected"] },
          tenantId: tenant.tenantId,
        },
      });

      const now = Date.now();
      const thresholdMs = staleThresholdSeconds * 1000;
      const degradedIds: string[] = [];

      for (const channel of activeChannels) {
        const settings = parseJson(channel.settings);
        const metadata = parseJson(settings.metadata);
        const lastHeartbeatIso =
          (metadata.lastHeartbeatAt as string | undefined) ??
          (settings.lastHeartbeatAt as string | undefined);

        let isStale = false;
        if (!lastHeartbeatIso) {
          isStale = true;
        } else {
          const lastHeartbeatTime = new Date(lastHeartbeatIso).getTime();
          if (Number.isNaN(lastHeartbeatTime) || now - lastHeartbeatTime > thresholdMs) {
            isStale = true;
          }
        }

        if (isStale) {
          degradedIds.push(channel.id);
          const nextMetadata = { ...metadata, isDegraded: true };
          const nextSettings = { ...settings, isDegraded: true, metadata: nextMetadata };

          await transaction.channelAccount.update({
            data: {
              healthStatus: "degraded",
              settings: nextSettings as Prisma.InputJsonValue,
              updatedAt: new Date(),
            },
            where: { id: channel.id, tenantId: tenant.tenantId },
          });
        }
      }

      return degradedIds;
    });
  };

  return Object.freeze({
    checkStaleChannels,
    handleChannelConnectionFailure,
    recordChannelHeartbeat,
  });
}

export async function recordChannelHeartbeat(
  tenantContext: TenantContext,
  channelAccountId: string,
  metrics: ChannelHeartbeatMetrics,
  database?: ChannelHealthManagerDatabase,
): Promise<ChannelAccount> {
  if (!database) {
    throw new Error("Database client is required for recordChannelHeartbeat");
  }
  return createChannelHealthManager(database).recordChannelHeartbeat(
    tenantContext,
    channelAccountId,
    metrics,
  );
}

export async function handleChannelConnectionFailure(
  tenantContext: TenantContext,
  channelAccountId: string,
  failure: ChannelConnectionFailure,
  database?: ChannelHealthManagerDatabase,
): Promise<ChannelAccount> {
  if (!database) {
    throw new Error("Database client is required for handleChannelConnectionFailure");
  }
  return createChannelHealthManager(database).handleChannelConnectionFailure(
    tenantContext,
    channelAccountId,
    failure,
  );
}

export async function checkStaleChannels(
  tenantContext: TenantContext,
  staleThresholdSeconds = 90,
  database?: ChannelHealthManagerDatabase,
): Promise<string[]> {
  if (!database) {
    throw new Error("Database client is required for checkStaleChannels");
  }
  return createChannelHealthManager(database).checkStaleChannels(
    tenantContext,
    staleThresholdSeconds,
  );
}
