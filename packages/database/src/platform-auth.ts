import type { Prisma } from "./generated/prisma/client";
import type { PlatformAdminMfaState, PlatformAdminStatus } from "./generated/prisma/enums";

export type PlatformAdminProfile = Readonly<{
  id: string;
  email: string;
  displayName: string;
  locale: string;
  timezone: string;
  mfaState: PlatformAdminMfaState;
}>;

export type PlatformAdminCredentialRecord = PlatformAdminProfile &
  Readonly<{
    passwordHash: string;
    status: PlatformAdminStatus;
  }>;

export type CreatePlatformAdminInput = Readonly<{
  email: string;
  passwordHash: string;
  displayName: string;
  locale: string;
  timezone: string;
}>;

export type BootstrapPlatformAdminInput = CreatePlatformAdminInput &
  Readonly<{ requestId: string }>;

export type CreatePlatformAdminSessionInput = Readonly<{
  platformAdminId: string;
  tokenHash: Buffer;
  deviceLabel?: string | null;
  ipHash?: Buffer | null;
  expiresAt: Date;
  requestId: string;
}>;

export type PlatformSessionIdentity = Readonly<{
  sessionId: string;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  adminStatus: PlatformAdminStatus;
  admin: PlatformAdminProfile;
}>;

type PlatformAuthTransactionClient = Pick<
  Prisma.TransactionClient,
  "auditLog" | "platformAdmin" | "platformAdminSession"
>;

export interface PlatformAuthDatabase {
  auditLog: PlatformAuthTransactionClient["auditLog"];
  platformAdmin: PlatformAuthTransactionClient["platformAdmin"];
  platformAdminSession: PlatformAuthTransactionClient["platformAdminSession"];
  $transaction<Result>(
    callback: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result>;
}

export interface PlatformAuthRepository {
  findAdminByNormalizedEmail(email: string): Promise<PlatformAdminCredentialRecord | null>;
  bootstrapAdmin(input: BootstrapPlatformAdminInput): Promise<PlatformAdminProfile>;
  createLoginSession(input: CreatePlatformAdminSessionInput): Promise<PlatformAdminProfile>;
  findSessionByTokenHash(tokenHash: Buffer): Promise<PlatformSessionIdentity | null>;
  touchSession(sessionId: string, touchedAt: Date): Promise<void>;
  revokeSession(sessionId: string, platformAdminId: string, requestId: string): Promise<void>;
}

const safeAdminSelect = {
  displayName: true,
  email: true,
  id: true,
  locale: true,
  mfaState: true,
  timezone: true,
} satisfies Prisma.PlatformAdminSelect;

function createRepository(
  database: PlatformAuthTransactionClient,
  transactionDatabase?: PlatformAuthDatabase,
): PlatformAuthRepository {
  const repository: PlatformAuthRepository = {
    findAdminByNormalizedEmail: (email) =>
      database.platformAdmin.findUnique({
        select: { ...safeAdminSelect, passwordHash: true, status: true },
        where: { email },
      }),
    bootstrapAdmin: async ({ requestId, ...input }) => {
      if (transactionDatabase === undefined) {
        throw new TypeError("Admin bootstrap requires a transaction-capable database");
      }
      return transactionDatabase.$transaction(async (transaction) => {
        const admin = await transaction.platformAdmin.create({
          data: input,
          select: safeAdminSelect,
        });
        await transaction.auditLog.create({
          data: {
            action: "platform_admin.bootstrap.created",
            actorId: admin.id,
            actorType: "system",
            entityId: admin.id,
            entityType: "PlatformAdmin",
            requestId,
            tenantId: null,
          },
        });
        return admin;
      });
    },
    createLoginSession: async (input) => {
      if (transactionDatabase === undefined) {
        throw new TypeError("Login session creation requires a transaction-capable database");
      }

      return transactionDatabase.$transaction(async (transaction) => {
        const admin = await transaction.platformAdmin.update({
          data: { lastLoginAt: new Date() },
          select: safeAdminSelect,
          where: { id: input.platformAdminId, status: "active" },
        });
        await transaction.platformAdminSession.create({
          data: {
            ...(input.deviceLabel !== undefined ? { deviceLabel: input.deviceLabel } : {}),
            expiresAt: input.expiresAt,
            ...(input.ipHash !== undefined && input.ipHash !== null
              ? { ipHash: new Uint8Array(input.ipHash) }
              : input.ipHash === null
                ? { ipHash: null }
                : {}),
            platformAdminId: input.platformAdminId,
            tokenHash: new Uint8Array(input.tokenHash),
          },
        });
        await transaction.auditLog.create({
          data: {
            action: "platform_admin.login.succeeded",
            actorId: input.platformAdminId,
            actorType: "user",
            entityId: input.platformAdminId,
            entityType: "PlatformAdmin",
            requestId: input.requestId,
            tenantId: null,
          },
        });
        return admin;
      });
    },
    findSessionByTokenHash: async (tokenHash) => {
      const session = await database.platformAdminSession.findUnique({
        select: {
          expiresAt: true,
          lastSeenAt: true,
          platformAdminId: true,
          revokedAt: true,
          id: true,
        },
        where: { tokenHash: new Uint8Array(tokenHash) },
      });
      if (session === null) return null;

      const platformAdmin = await database.platformAdmin.findUnique({
        select: { ...safeAdminSelect, status: true },
        where: { id: session.platformAdminId },
      });
      if (platformAdmin === null) return null;

      const { status: adminStatus, ...admin } = platformAdmin;
      return {
        admin,
        adminStatus,
        expiresAt: session.expiresAt,
        lastSeenAt: session.lastSeenAt,
        revokedAt: session.revokedAt,
        sessionId: session.id,
      };
    },
    touchSession: async (sessionId, touchedAt) => {
      await database.platformAdminSession.updateMany({
        data: { lastSeenAt: touchedAt },
        where: { id: sessionId, revokedAt: null },
      });
    },
    revokeSession: async (sessionId, platformAdminId, requestId) => {
      if (transactionDatabase === undefined) {
        throw new TypeError("Session revocation requires a transaction-capable database");
      }

      await transactionDatabase.$transaction(async (transaction) => {
        const result = await transaction.platformAdminSession.updateMany({
          data: { revokedAt: new Date() },
          where: { id: sessionId, platformAdminId, revokedAt: null },
        });
        if (result.count === 0) return;
        await transaction.auditLog.create({
          data: {
            action: "platform_admin.logout",
            actorId: platformAdminId,
            actorType: "user",
            entityId: platformAdminId,
            entityType: "PlatformAdmin",
            requestId,
            tenantId: null,
          },
        });
      });
    },
  };
  return Object.freeze(repository);
}

export function createPlatformAuthRepository(
  database: PlatformAuthDatabase,
): PlatformAuthRepository {
  return createRepository(database, database);
}
