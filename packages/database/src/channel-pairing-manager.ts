import { ChannelAccountNotFoundError } from "./channel-account-manager";
import type { ChannelAccount, Prisma, PrismaClient } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import {
  createTenantDataAccess,
  type TenantDataAccessDatabase,
  type TenantTransactionDatabase,
} from "./tenant-data-access";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

export class ChannelAlreadyConnectedError extends Error {
  override readonly name = "ChannelAlreadyConnectedError";

  constructor() {
    super("Channel account is already connected");
  }
}

export type ChannelPairingConnectionDetails = Readonly<{
  phoneNumber: string;
  platform?: string;
  encryptedCredentials?: string;
}>;

export type ChannelPairingManagerDatabase = TenantTransactionDatabase &
  TenantDataAccessDatabase &
  Pick<PrismaClient, "channelAccount" | "tenant" | "tenantEntitlement">;

export interface ChannelPairingManager {
  initiateChannelPairing(
    context: TenantContext,
    channelAccountId: string,
    actorId: string,
    requestId?: string,
  ): Promise<ChannelAccount>;
  updateChannelQrCode(
    context: TenantContext,
    channelAccountId: string,
    qrRaw: string,
  ): Promise<ChannelAccount>;
  confirmChannelConnected(
    context: TenantContext,
    channelAccountId: string,
    connectionDetails: ChannelPairingConnectionDetails,
  ): Promise<ChannelAccount>;
  disconnectChannel(
    context: TenantContext,
    channelAccountId: string,
    actorId: string,
    reason?: string,
    requestId?: string,
  ): Promise<ChannelAccount>;
}

function parseJson(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

export function createChannelPairingManager(
  database: ChannelPairingManagerDatabase,
): ChannelPairingManager {
  const initiateChannelPairing = async (
    context: TenantContext,
    channelAccountId: string,
    actorId: string,
    requestId = "channel-pairing-initiate",
  ): Promise<ChannelAccount> => {
    const tenant = createTenantContext(context.tenantId);
    return database.$transaction(async (transaction) => {
      await assertTenantOperational(tenant, transaction);
      await assertTenantModuleEntitled(tenant, "module.messaging.basic", transaction);

      const current = await transaction.channelAccount.findUnique({
        where: { id: channelAccountId, tenantId: tenant.tenantId },
      });

      if (current === null) {
        throw new ChannelAccountNotFoundError();
      }

      if (current.status.toUpperCase() === "CONNECTED") {
        throw new ChannelAlreadyConnectedError();
      }

      const now = new Date();
      const currentSettings = parseJson(current.settings);
      const currentMetadata = parseJson(currentSettings.metadata);
      const nextMetadata = {
        ...currentMetadata,
        latestQrRaw: null,
        pairingInitiatedAt: now.toISOString(),
      };
      const nextSettings = {
        ...currentSettings,
        latestQrRaw: null,
        metadata: nextMetadata,
        pairingInitiatedAt: now.toISOString(),
      };

      const updated = await transaction.channelAccount.update({
        data: {
          settings: nextSettings as Prisma.InputJsonValue,
          status: "CONNECTING",
          updatedAt: now,
        },
        where: { id: channelAccountId, tenantId: tenant.tenantId },
      });

      const access = createTenantDataAccess(tenant, transaction);
      await access.audit.append({
        action: "channel.pairing_initiated",
        actorId,
        actorType: actorId === "system" ? "system" : "tenant_user",
        afterSummary: {
          displayName: updated.displayName,
          id: updated.id,
          status: "CONNECTING",
        },
        entityId: updated.id,
        entityType: "ChannelAccount",
        organizationUnitId: updated.organizationUnitId,
        requestId,
      });

      await access.outbox.append({
        aggregateId: updated.id,
        aggregateType: "ChannelAccount",
        eventType: "channel.pairing_requested",
        payload: {
          actorId,
          channelAccountId: updated.id,
          tenantId: tenant.tenantId,
          timestamp: now.toISOString(),
        },
      });

      return updated;
    });
  };

  const updateChannelQrCode = async (
    context: TenantContext,
    channelAccountId: string,
    qrRaw: string,
  ): Promise<ChannelAccount> => {
    const tenant = createTenantContext(context.tenantId);
    return database.$transaction(async (transaction) => {
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
        latestQrRaw: qrRaw,
        qrGeneratedAt: now.toISOString(),
      };
      const nextSettings = {
        ...currentSettings,
        latestQrRaw: qrRaw,
        metadata: nextMetadata,
        qrGeneratedAt: now.toISOString(),
      };

      const updated = await transaction.channelAccount.update({
        data: {
          settings: nextSettings as Prisma.InputJsonValue,
          status: "QR_READY",
          updatedAt: now,
        },
        where: { id: channelAccountId, tenantId: tenant.tenantId },
      });

      const access = createTenantDataAccess(tenant, transaction);
      await access.outbox.append({
        aggregateId: updated.id,
        aggregateType: "ChannelAccount",
        eventType: "channel.qr_generated",
        payload: {
          channelAccountId: updated.id,
          qrRaw,
          tenantId: tenant.tenantId,
          timestamp: now.toISOString(),
        },
      });

      return updated;
    });
  };

  const confirmChannelConnected = async (
    context: TenantContext,
    channelAccountId: string,
    connectionDetails: ChannelPairingConnectionDetails,
  ): Promise<ChannelAccount> => {
    const tenant = createTenantContext(context.tenantId);
    return database.$transaction(async (transaction) => {
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
        connectedAt: now.toISOString(),
        latestQrRaw: null,
        ...(connectionDetails.platform !== undefined
          ? { platform: connectionDetails.platform }
          : {}),
      };
      const nextSettings = {
        ...currentSettings,
        connectedAt: now.toISOString(),
        latestQrRaw: null,
        metadata: nextMetadata,
        ...(connectionDetails.platform !== undefined
          ? { platform: connectionDetails.platform }
          : {}),
      };

      const data: Prisma.ChannelAccountUncheckedUpdateInput = {
        lastConnectedAt: now,
        phoneNumber: connectionDetails.phoneNumber,
        phoneNumberUniqueKey: current.active ? connectionDetails.phoneNumber : null,
        settings: nextSettings as Prisma.InputJsonValue,
        status: "CONNECTED",
        updatedAt: now,
      };

      if (connectionDetails.encryptedCredentials !== undefined) {
        data.credentialsCiphertext = connectionDetails.encryptedCredentials;
        data.credentialsKeyVersion = 1;
      }

      const updated = await transaction.channelAccount.update({
        data,
        where: { id: channelAccountId, tenantId: tenant.tenantId },
      });

      const access = createTenantDataAccess(tenant, transaction);
      await access.audit.append({
        action: "channel.connected",
        actorId: "system",
        actorType: "system",
        afterSummary: {
          displayName: updated.displayName,
          id: updated.id,
          phoneNumber: connectionDetails.phoneNumber,
          status: "CONNECTED",
        },
        entityId: updated.id,
        entityType: "ChannelAccount",
        organizationUnitId: updated.organizationUnitId,
        requestId: "channel-connected-confirmation",
      });

      await access.outbox.append({
        aggregateId: updated.id,
        aggregateType: "ChannelAccount",
        eventType: "channel.connected",
        payload: {
          channelAccountId: updated.id,
          phoneNumber: connectionDetails.phoneNumber,
          tenantId: tenant.tenantId,
          timestamp: now.toISOString(),
        },
      });

      return updated;
    });
  };

  const disconnectChannel = async (
    context: TenantContext,
    channelAccountId: string,
    actorId: string,
    reason?: string,
    requestId = "channel-disconnect",
  ): Promise<ChannelAccount> => {
    const tenant = createTenantContext(context.tenantId);
    return database.$transaction(async (transaction) => {
      const current = await transaction.channelAccount.findUnique({
        where: { id: channelAccountId, tenantId: tenant.tenantId },
      });

      if (current === null) {
        throw new ChannelAccountNotFoundError();
      }

      const now = new Date();
      const disconnectReason = reason ?? "manual_disconnect";
      const currentSettings = parseJson(current.settings);
      const currentMetadata = parseJson(currentSettings.metadata);
      const nextMetadata = {
        ...currentMetadata,
        disconnectedAt: now.toISOString(),
        disconnectReason,
        latestQrRaw: null,
      };
      const nextSettings = {
        ...currentSettings,
        disconnectedAt: now.toISOString(),
        disconnectReason,
        latestQrRaw: null,
        metadata: nextMetadata,
      };

      const updated = await transaction.channelAccount.update({
        data: {
          lastDisconnectedAt: now,
          settings: nextSettings as Prisma.InputJsonValue,
          status: "DISCONNECTED",
          updatedAt: now,
        },
        where: { id: channelAccountId, tenantId: tenant.tenantId },
      });

      const access = createTenantDataAccess(tenant, transaction);
      await access.audit.append({
        action: "channel.disconnected",
        actorId,
        actorType: actorId === "system" ? "system" : "tenant_user",
        afterSummary: {
          displayName: updated.displayName,
          id: updated.id,
          reason: disconnectReason,
          status: "DISCONNECTED",
        },
        entityId: updated.id,
        entityType: "ChannelAccount",
        organizationUnitId: updated.organizationUnitId,
        requestId,
      });

      await access.outbox.append({
        aggregateId: updated.id,
        aggregateType: "ChannelAccount",
        eventType: "channel.disconnected",
        payload: {
          actorId,
          channelAccountId: updated.id,
          reason: disconnectReason,
          tenantId: tenant.tenantId,
          timestamp: now.toISOString(),
        },
      });

      return updated;
    });
  };

  return Object.freeze({
    confirmChannelConnected,
    disconnectChannel,
    initiateChannelPairing,
    updateChannelQrCode,
  });
}

export async function initiateChannelPairing(
  tenantContext: TenantContext,
  channelAccountId: string,
  actorId: string,
  database?: ChannelPairingManagerDatabase,
  requestId?: string,
): Promise<ChannelAccount> {
  if (!database) {
    throw new Error("Database client is required for initiateChannelPairing");
  }
  return createChannelPairingManager(database).initiateChannelPairing(
    tenantContext,
    channelAccountId,
    actorId,
    requestId,
  );
}

export async function updateChannelQrCode(
  tenantContext: TenantContext,
  channelAccountId: string,
  qrRaw: string,
  database?: ChannelPairingManagerDatabase,
): Promise<ChannelAccount> {
  if (!database) {
    throw new Error("Database client is required for updateChannelQrCode");
  }
  return createChannelPairingManager(database).updateChannelQrCode(
    tenantContext,
    channelAccountId,
    qrRaw,
  );
}

export async function confirmChannelConnected(
  tenantContext: TenantContext,
  channelAccountId: string,
  connectionDetails: ChannelPairingConnectionDetails,
  database?: ChannelPairingManagerDatabase,
): Promise<ChannelAccount> {
  if (!database) {
    throw new Error("Database client is required for confirmChannelConnected");
  }
  return createChannelPairingManager(database).confirmChannelConnected(
    tenantContext,
    channelAccountId,
    connectionDetails,
  );
}

export async function disconnectChannel(
  tenantContext: TenantContext,
  channelAccountId: string,
  actorId: string,
  reason?: string,
  database?: ChannelPairingManagerDatabase,
  requestId?: string,
): Promise<ChannelAccount> {
  if (!database) {
    throw new Error("Database client is required for disconnectChannel");
  }
  return createChannelPairingManager(database).disconnectChannel(
    tenantContext,
    channelAccountId,
    actorId,
    reason,
    requestId,
  );
}
