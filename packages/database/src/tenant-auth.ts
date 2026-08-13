import type { Prisma } from "./generated/prisma/client";
import type { TenantStatus, UserMfaState, UserStatus } from "./generated/prisma/enums";

export type TenantAuthTenant = Readonly<{
  id: string;
  slug: string;
  displayName: string;
}>;

export type TenantUserProfile = Readonly<{
  id: string;
  email: string;
  displayName: string;
  locale: string;
  timezone: string;
  mfaState: UserMfaState;
}>;

export type TenantLoginRecord = Readonly<{
  tenant: TenantAuthTenant;
  tenantStatus: TenantStatus;
  user: (TenantUserProfile & { passwordHash: string; status: UserStatus }) | null;
}>;

export type TenantSessionIdentity = Readonly<{
  sessionId: string;
  tenant: TenantAuthTenant;
  tenantStatus: TenantStatus;
  user: TenantUserProfile;
  userStatus: UserStatus;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}>;

export type CreateTenantUserInput = Readonly<{
  tenantId: string;
  email: string;
  passwordHash: string;
  displayName: string;
  locale: string;
  timezone: string;
}>;

export type CreateTenantSessionInput = Readonly<{
  tenantId: string;
  userId: string;
  tokenHash: Buffer;
  deviceLabel?: string;
  ipHash?: Buffer;
  expiresAt: Date;
  requestId: string;
}>;

export type CreatePasswordResetInput = Readonly<{
  tenantId: string;
  userId: string;
  tokenHash: Buffer;
  expiresAt: Date;
  requestId: string;
}>;

export type PasswordResetRecord = Readonly<{
  id: string;
  tenantId: string;
  userId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
  tenantStatus: TenantStatus;
  userStatus: UserStatus;
}>;

type TenantAuthClient = Pick<
  Prisma.TransactionClient,
  "auditLog" | "tenant" | "user" | "userPasswordResetToken" | "userSession"
>;

export interface TenantAuthDatabase extends TenantAuthClient {
  $transaction<Result>(
    callback: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result>;
}

export interface TenantAuthRepository {
  createUser(input: CreateTenantUserInput): Promise<TenantUserProfile>;
  findLoginRecord(slug: string, email: string): Promise<TenantLoginRecord | null>;
  createLoginSession(input: CreateTenantSessionInput): Promise<{
    tenant: TenantAuthTenant;
    user: TenantUserProfile;
  }>;
  findSessionByTokenHash(tokenHash: Buffer): Promise<TenantSessionIdentity | null>;
  touchSession(sessionId: string, touchedAt: Date): Promise<void>;
  revokeSession(identity: TenantSessionIdentity, requestId: string): Promise<void>;
  revokeAllSessions(identity: TenantSessionIdentity, requestId: string): Promise<void>;
  createPasswordReset(input: CreatePasswordResetInput): Promise<void>;
  findPasswordReset(slug: string, tokenHash: Buffer): Promise<PasswordResetRecord | null>;
  completePasswordReset(
    reset: PasswordResetRecord,
    passwordHash: string,
    requestId: string,
  ): Promise<boolean>;
}

const safeUserSelect = {
  displayName: true,
  email: true,
  id: true,
  locale: true,
  mfaState: true,
  timezone: true,
} satisfies Prisma.UserSelect;

const safeTenantSelect = {
  displayName: true,
  id: true,
  slug: true,
} satisfies Prisma.TenantSelect;

function binary(value: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

export function createTenantAuthRepository(database: TenantAuthDatabase): TenantAuthRepository {
  const repository: TenantAuthRepository = {
    createUser: (input) =>
      database.user.create({
        data: input,
        select: safeUserSelect,
      }),
    findLoginRecord: async (slug, email) => {
      const tenant = await database.tenant.findUnique({
        select: {
          ...safeTenantSelect,
          status: true,
          users: {
            select: { ...safeUserSelect, passwordHash: true, status: true },
            take: 1,
            where: { email },
          },
        },
        where: { slug },
      });
      if (tenant === null) return null;
      const { status: tenantStatus, users, ...safeTenant } = tenant;
      return { tenant: safeTenant, tenantStatus, user: users[0] ?? null };
    },
    createLoginSession: (input) =>
      database.$transaction(async (transaction) => {
        const user = await transaction.user.update({
          data: { lastLoginAt: new Date() },
          select: safeUserSelect,
          where: { id: input.userId, status: "active", tenantId: input.tenantId },
        });
        const tenant = await transaction.tenant.findUniqueOrThrow({
          select: safeTenantSelect,
          where: { id: input.tenantId, status: "active" },
        });
        await transaction.userSession.create({
          data: {
            ...(input.deviceLabel === undefined ? {} : { deviceLabel: input.deviceLabel }),
            expiresAt: input.expiresAt,
            ...(input.ipHash === undefined ? {} : { ipHash: binary(input.ipHash) }),
            tenantId: input.tenantId,
            tokenHash: binary(input.tokenHash),
            userId: input.userId,
          },
        });
        await transaction.auditLog.create({
          data: {
            action: "tenant_user.login.succeeded",
            actorId: input.userId,
            actorType: "user",
            entityId: input.userId,
            entityType: "User",
            requestId: input.requestId,
            tenantId: input.tenantId,
          },
        });
        return { tenant, user };
      }),
    findSessionByTokenHash: async (tokenHash) => {
      const session = await database.userSession.findUnique({
        select: {
          expiresAt: true,
          id: true,
          lastSeenAt: true,
          revokedAt: true,
          tenant: { select: { ...safeTenantSelect, status: true } },
          user: { select: { ...safeUserSelect, status: true } },
        },
        where: { tokenHash: binary(tokenHash) },
      });
      if (session === null) return null;
      const { status: tenantStatus, ...tenant } = session.tenant;
      const { status: userStatus, ...user } = session.user;
      return { ...session, sessionId: session.id, tenant, tenantStatus, user, userStatus };
    },
    touchSession: async (sessionId, touchedAt) => {
      await database.userSession.updateMany({
        data: { lastSeenAt: touchedAt },
        where: { id: sessionId, revokedAt: null },
      });
    },
    revokeSession: (identity, requestId) =>
      database.$transaction(async (transaction) => {
        const result = await transaction.userSession.updateMany({
          data: { revokedAt: new Date() },
          where: {
            id: identity.sessionId,
            revokedAt: null,
            tenantId: identity.tenant.id,
            userId: identity.user.id,
          },
        });
        if (result.count === 0) return;
        await transaction.auditLog.create({
          data: {
            action: "tenant_user.logout",
            actorId: identity.user.id,
            actorType: "user",
            entityId: identity.user.id,
            entityType: "User",
            requestId,
            tenantId: identity.tenant.id,
          },
        });
      }),
    revokeAllSessions: (identity, requestId) =>
      database.$transaction(async (transaction) => {
        await transaction.userSession.updateMany({
          data: { revokedAt: new Date() },
          where: { revokedAt: null, tenantId: identity.tenant.id, userId: identity.user.id },
        });
        await transaction.auditLog.create({
          data: {
            action: "tenant_user.sessions.revoked",
            actorId: identity.user.id,
            actorType: "user",
            entityId: identity.user.id,
            entityType: "User",
            requestId,
            tenantId: identity.tenant.id,
          },
        });
      }),
    createPasswordReset: (input) =>
      database.$transaction(async (transaction) => {
        await transaction.userPasswordResetToken.updateMany({
          data: { revokedAt: new Date() },
          where: {
            consumedAt: null,
            revokedAt: null,
            tenantId: input.tenantId,
            userId: input.userId,
          },
        });
        await transaction.userPasswordResetToken.create({
          data: {
            expiresAt: input.expiresAt,
            tenantId: input.tenantId,
            tokenHash: binary(input.tokenHash),
            userId: input.userId,
          },
        });
        await transaction.auditLog.create({
          data: {
            action: "tenant_user.password_reset.requested",
            actorId: input.userId,
            actorType: "user",
            entityId: input.userId,
            entityType: "User",
            requestId: input.requestId,
            tenantId: input.tenantId,
          },
        });
      }),
    findPasswordReset: async (slug, tokenHash) => {
      const reset = await database.userPasswordResetToken.findUnique({
        select: {
          consumedAt: true,
          expiresAt: true,
          id: true,
          revokedAt: true,
          tenant: { select: { slug: true, status: true } },
          tenantId: true,
          user: { select: { status: true } },
          userId: true,
        },
        where: { tokenHash: binary(tokenHash) },
      });
      if (reset === null || reset.tenant.slug !== slug) return null;
      return {
        consumedAt: reset.consumedAt,
        expiresAt: reset.expiresAt,
        id: reset.id,
        revokedAt: reset.revokedAt,
        tenantId: reset.tenantId,
        tenantStatus: reset.tenant.status,
        userId: reset.userId,
        userStatus: reset.user.status,
      };
    },
    completePasswordReset: (reset, passwordHash, requestId) =>
      database.$transaction(async (transaction) => {
        const tenant = await transaction.tenant.findUnique({
          select: { id: true },
          where: { id: reset.tenantId, status: "active" },
        });
        const user = await transaction.user.findUnique({
          select: { id: true },
          where: { id: reset.userId, status: "active", tenantId: reset.tenantId },
        });
        if (tenant === null || user === null) return false;
        const consumed = await transaction.userPasswordResetToken.updateMany({
          data: { consumedAt: new Date() },
          where: {
            consumedAt: null,
            expiresAt: { gt: new Date() },
            id: reset.id,
            revokedAt: null,
            tenantId: reset.tenantId,
            userId: reset.userId,
          },
        });
        if (consumed.count === 0) return false;
        await transaction.user.update({
          data: { passwordHash },
          where: { id: reset.userId, status: "active", tenantId: reset.tenantId },
        });
        await transaction.userSession.updateMany({
          data: { revokedAt: new Date() },
          where: { revokedAt: null, tenantId: reset.tenantId, userId: reset.userId },
        });
        await transaction.auditLog.create({
          data: {
            action: "tenant_user.password_reset.completed",
            actorId: reset.userId,
            actorType: "user",
            entityId: reset.userId,
            entityType: "User",
            requestId,
            tenantId: reset.tenantId,
          },
        });
        return true;
      }),
  };
  return Object.freeze(repository);
}
