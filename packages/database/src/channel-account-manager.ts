import { type ChannelAccount, Prisma, type TenantEntitlement } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess, type TenantTransactionDatabase } from "./tenant-data-access";
import { tenantEntitlementEffective } from "./tenant-entitlements";

export const CHANNEL_ACCOUNT_STATUSES = [
  "not_configured",
  "pairing",
  "connected",
  "reconnecting",
  "degraded",
  "disconnected",
  "requires_reauth",
  "error",
  "disabled",
  "archived",
] as const;

export type ChannelAccountStatus = (typeof CHANNEL_ACCOUNT_STATUSES)[number];

export type ChannelAccountItem = Readonly<{
  id: string;
  tenantId: string;
  organizationUnitId: string | null;
  channelType: string;
  providerType: string;
  displayName: string;
  externalAccountId: string | null;
  phoneNumber: string | null;
  status: string;
  automationDefaultMode: string | null;
  settings: Prisma.JsonValue;
  healthStatus: string | null;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
  credentialsConfigured: boolean;
}>;

export type ChannelAccountUsage = Readonly<{
  used: number;
  limit: string | null;
}>;

export type ChannelAccountPage = Readonly<{
  items: readonly ChannelAccountItem[];
  page: number;
  pageSize: number;
  total: number;
  usage: ChannelAccountUsage;
}>;

export type ChannelAccountCreateInput = Readonly<{
  displayName: string;
  phoneNumber: string | null;
  providerType: string;
  externalAccountId?: string | null;
  organizationUnitId?: string | null;
  credentialsCiphertext?: string | null;
  settings?: Prisma.InputJsonValue;
  active?: boolean;
}>;

export type ChannelAccountUpdateInput = Readonly<{
  displayName?: string;
  status?: ChannelAccountStatus;
  externalAccountId?: string | null;
  organizationUnitId?: string | null;
  credentialsCiphertext?: string | null;
  settings?: Prisma.InputJsonValue;
  isActive?: boolean;
}>;

export type ChannelAccountMutationMetadata = Readonly<{
  actorUserId: string;
  requestId: string;
}>;

export type ChannelAccountManagerDatabase = TenantTransactionDatabase &
  Pick<Prisma.TransactionClient, "channelAccount" | "organizationUnit" | "tenantEntitlement">;

export interface ChannelAccountManager {
  list(context: TenantContext, options: ChannelAccountListOptions): Promise<ChannelAccountPage>;
  findById(context: TenantContext, channelId: string): Promise<ChannelAccountItem | null>;
  create(
    context: TenantContext,
    input: ChannelAccountCreateInput,
    metadata: ChannelAccountMutationMetadata,
  ): Promise<ChannelAccountItem>;
  update(
    context: TenantContext,
    channelId: string,
    input: ChannelAccountUpdateInput,
    metadata: ChannelAccountMutationMetadata,
  ): Promise<ChannelAccountItem>;
  archive(
    context: TenantContext,
    channelId: string,
    metadata: ChannelAccountMutationMetadata,
  ): Promise<ChannelAccountItem>;
}

export type ChannelAccountListOptions = Readonly<{
  page: number;
  pageSize: number;
  status?: ChannelAccountStatus;
}>;

export class ChannelAccountNotFoundError extends Error {
  override readonly name = "ChannelAccountNotFoundError";

  constructor() {
    super("Channel account was not found");
  }
}

export class ChannelAccountPhoneConflictError extends Error {
  override readonly name = "ChannelAccountPhoneConflictError";

  constructor() {
    super("An active channel already uses this phone number");
  }
}

export class ChannelAccountLimitReachedError extends Error {
  override readonly name = "ChannelAccountLimitReachedError";

  constructor() {
    super("channel account limit reached");
  }
}

export class ChannelAccountOrganizationUnitNotFoundError extends Error {
  override readonly name = "ChannelAccountOrganizationUnitNotFoundError";

  constructor() {
    super("Organization unit was not found");
  }
}

export class ChannelAccountModuleEntitlementRequiredError extends Error {
  override readonly name = "ChannelAccountModuleEntitlementRequiredError";

  constructor() {
    super("Messaging module entitlement is required");
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function effectiveLimit(row: TenantEntitlement | null, now: Date): Prisma.Decimal | null {
  return row !== null && tenantEntitlementEffective(row, now) ? row.limitValue : null;
}

function channelItem(channel: ChannelAccount): ChannelAccountItem {
  return {
    automationDefaultMode: channel.automationDefaultMode,
    channelType: channel.channelType,
    createdAt: channel.createdAt,
    credentialsConfigured: channel.credentialsCiphertext !== null,
    displayName: channel.displayName,
    externalAccountId: channel.externalAccountId,
    healthStatus: channel.healthStatus,
    id: channel.id,
    isActive: channel.active,
    lastConnectedAt: channel.lastConnectedAt,
    lastDisconnectedAt: channel.lastDisconnectedAt,
    lastErrorAt: channel.lastErrorAt,
    lastErrorCode: channel.lastErrorCode,
    organizationUnitId: channel.organizationUnitId,
    phoneNumber: channel.phoneNumber,
    providerType: channel.providerType,
    settings: channel.settings,
    status: channel.status,
    tenantId: channel.tenantId,
    updatedAt: channel.updatedAt,
  };
}

function summary(channel: ChannelAccountItem): Prisma.InputJsonValue {
  return {
    active: channel.isActive,
    displayName: channel.displayName,
    organizationUnitId: channel.organizationUnitId,
    phoneNumber: channel.phoneNumber,
    providerType: channel.providerType,
    status: channel.status,
  };
}

function lockTenantChannels(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<unknown> {
  return transaction.$queryRaw`
    SELECT 1 FROM pg_advisory_xact_lock(
      hashtextextended(${tenantId}::text || ':channel-accounts'::text, 0::bigint)
    )`;
}

async function assertModuleAndLimit(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  shouldConsume: boolean,
  now = new Date(),
): Promise<void> {
  const [module, limit] = await Promise.all([
    transaction.tenantEntitlement.findUnique({
      where: { tenantId_entitlementKey: { entitlementKey: "module.messaging.basic", tenantId } },
    }),
    transaction.tenantEntitlement.findUnique({
      where: { tenantId_entitlementKey: { entitlementKey: "limit.channel_accounts", tenantId } },
    }),
  ]);
  if (module === null || !tenantEntitlementEffective(module, now)) {
    throw new ChannelAccountModuleEntitlementRequiredError();
  }
  if (!shouldConsume) return;
  const maximum = effectiveLimit(limit, now);
  if (maximum === null) return;
  const used = await transaction.channelAccount.count({ where: { active: true, tenantId } });
  if (maximum.lt(new Prisma.Decimal(used).plus(1))) {
    throw new ChannelAccountLimitReachedError();
  }
}

async function assertOrganizationUnit(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  organizationUnitId: string | null | undefined,
): Promise<void> {
  if (organizationUnitId === undefined || organizationUnitId === null) return;
  const unit = await transaction.organizationUnit.findUnique({
    where: { id: organizationUnitId, tenantId },
  });
  if (unit === null) throw new ChannelAccountOrganizationUnitNotFoundError();
}

export function createChannelAccountManager(
  database: ChannelAccountManagerDatabase,
): ChannelAccountManager {
  const list = async (
    context: TenantContext,
    options: ChannelAccountListOptions,
  ): Promise<ChannelAccountPage> => {
    const tenant = createTenantContext(context.tenantId);
    const where = {
      tenantId: tenant.tenantId,
      ...(options.status === undefined ? {} : { status: options.status }),
    };
    const [items, total, used, limit] = await Promise.all([
      database.channelAccount.findMany({
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
        where,
      }),
      database.channelAccount.count({ where }),
      database.channelAccount.count({ where: { active: true, tenantId: tenant.tenantId } }),
      database.tenantEntitlement.findUnique({
        where: {
          tenantId_entitlementKey: {
            entitlementKey: "limit.channel_accounts",
            tenantId: tenant.tenantId,
          },
        },
      }),
    ]);
    const maximum = effectiveLimit(limit, new Date());
    return {
      items: items.map(channelItem),
      page: options.page,
      pageSize: options.pageSize,
      total,
      usage: { limit: maximum === null ? null : maximum.toFixed(4), used },
    };
  };

  const findById = async (
    context: TenantContext,
    channelId: string,
  ): Promise<ChannelAccountItem | null> => {
    const tenant = createTenantContext(context.tenantId);
    const channel = await database.channelAccount.findUnique({
      where: { id: channelId, tenantId: tenant.tenantId },
    });
    return channel === null ? null : channelItem(channel);
  };

  const create = async (
    context: TenantContext,
    input: ChannelAccountCreateInput,
    metadata: ChannelAccountMutationMetadata,
  ): Promise<ChannelAccountItem> => {
    const tenant = createTenantContext(context.tenantId);
    return database.$transaction(async (transaction) => {
      await lockTenantChannels(transaction, tenant.tenantId);
      const active = input.active ?? true;
      await assertModuleAndLimit(transaction, tenant.tenantId, active);
      await assertOrganizationUnit(transaction, tenant.tenantId, input.organizationUnitId);
      try {
        const created = await transaction.channelAccount.create({
          data: {
            active,
            channelType: "whatsapp",
            credentialsCiphertext: input.credentialsCiphertext ?? null,
            credentialsKeyVersion: input.credentialsCiphertext === undefined ? null : 1,
            displayName: input.displayName,
            externalAccountId: input.externalAccountId ?? null,
            organizationUnitId: input.organizationUnitId ?? null,
            phoneNumber: input.phoneNumber,
            phoneNumberUniqueKey: active ? input.phoneNumber : null,
            providerType: input.providerType,
            settings: input.settings ?? {},
            status: active ? "disconnected" : "disabled",
            tenantId: tenant.tenantId,
          },
        });
        const item = channelItem(created);
        const access = createTenantDataAccess(tenant, transaction);
        await access.audit.append({
          action: "channel.created",
          actorId: metadata.actorUserId,
          actorType: "tenant_user",
          afterSummary: summary(item),
          entityId: item.id,
          entityType: "ChannelAccount",
          organizationUnitId: item.organizationUnitId,
          requestId: metadata.requestId,
        });
        await access.outbox.append({
          aggregateId: item.id,
          aggregateType: "ChannelAccount",
          eventType: "channel.created",
          payload: {
            channelAccountId: item.id,
            providerType: item.providerType,
            tenantId: tenant.tenantId,
          },
        });
        return item;
      } catch (error) {
        if (isUniqueViolation(error)) throw new ChannelAccountPhoneConflictError();
        throw error;
      }
    });
  };

  const update = async (
    context: TenantContext,
    channelId: string,
    input: ChannelAccountUpdateInput,
    metadata: ChannelAccountMutationMetadata,
  ): Promise<ChannelAccountItem> => {
    const tenant = createTenantContext(context.tenantId);
    return database.$transaction(async (transaction) => {
      await lockTenantChannels(transaction, tenant.tenantId);
      const current = await transaction.channelAccount.findUnique({
        where: { id: channelId, tenantId: tenant.tenantId },
      });
      if (current === null) throw new ChannelAccountNotFoundError();
      const nextActive =
        input.isActive ??
        (input.status === "disabled" || input.status === "archived" ? false : current.active);
      await assertModuleAndLimit(transaction, tenant.tenantId, nextActive && !current.active);
      await assertOrganizationUnit(transaction, tenant.tenantId, input.organizationUnitId);
      const nextStatus = input.status ?? (nextActive ? current.status : "disabled");
      const data: Prisma.ChannelAccountUncheckedUpdateInput = {
        active: nextActive,
        phoneNumberUniqueKey: nextActive ? current.phoneNumber : null,
        status:
          nextActive && (nextStatus === "disabled" || nextStatus === "archived")
            ? "disconnected"
            : nextStatus,
      };
      if (input.displayName !== undefined) data.displayName = input.displayName;
      if (input.externalAccountId !== undefined) data.externalAccountId = input.externalAccountId;
      if (input.organizationUnitId !== undefined)
        data.organizationUnitId = input.organizationUnitId;
      if (input.credentialsCiphertext !== undefined)
        data.credentialsCiphertext = input.credentialsCiphertext;
      if (input.credentialsCiphertext !== undefined) {
        data.credentialsKeyVersion = input.credentialsCiphertext === null ? null : 1;
      }
      if (input.settings !== undefined) data.settings = input.settings;
      try {
        const updated = await transaction.channelAccount.update({
          data,
          where: { id: current.id, tenantId: tenant.tenantId },
        });
        const before = channelItem(current);
        const after = channelItem(updated);
        const access = createTenantDataAccess(tenant, transaction);
        await access.audit.append({
          action: "channel.updated",
          actorId: metadata.actorUserId,
          actorType: "tenant_user",
          afterSummary: summary(after),
          beforeSummary: summary(before),
          entityId: after.id,
          entityType: "ChannelAccount",
          organizationUnitId: after.organizationUnitId,
          requestId: metadata.requestId,
        });
        await access.outbox.append({
          aggregateId: after.id,
          aggregateType: "ChannelAccount",
          eventType: "channel.updated",
          payload: { channelAccountId: after.id, tenantId: tenant.tenantId },
        });
        return after;
      } catch (error) {
        if (isUniqueViolation(error)) throw new ChannelAccountPhoneConflictError();
        throw error;
      }
    });
  };

  const archive = async (
    context: TenantContext,
    channelId: string,
    metadata: ChannelAccountMutationMetadata,
  ): Promise<ChannelAccountItem> => {
    const tenant = createTenantContext(context.tenantId);
    return database.$transaction(async (transaction) => {
      await lockTenantChannels(transaction, tenant.tenantId);
      const current = await transaction.channelAccount.findUnique({
        where: { id: channelId, tenantId: tenant.tenantId },
      });
      if (current === null) throw new ChannelAccountNotFoundError();
      const updated = await transaction.channelAccount.update({
        data: { active: false, phoneNumberUniqueKey: null, status: "archived" },
        where: { id: current.id, tenantId: tenant.tenantId },
      });
      const before = channelItem(current);
      const after = channelItem(updated);
      const access = createTenantDataAccess(tenant, transaction);
      await access.audit.append({
        action: "channel.deleted",
        actorId: metadata.actorUserId,
        actorType: "tenant_user",
        afterSummary: summary(after),
        beforeSummary: summary(before),
        entityId: after.id,
        entityType: "ChannelAccount",
        organizationUnitId: after.organizationUnitId,
        requestId: metadata.requestId,
      });
      await access.outbox.append({
        aggregateId: after.id,
        aggregateType: "ChannelAccount",
        eventType: "channel.deleted",
        payload: { channelAccountId: after.id, tenantId: tenant.tenantId },
      });
      return after;
    });
  };

  return Object.freeze({ archive, create, findById, list, update });
}
