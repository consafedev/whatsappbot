import type { InboundMessageEvent, Prisma } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import {
  createTenantDataAccess,
  type TenantDataAccessDatabase,
  type TenantTransactionDatabase,
} from "./tenant-data-access";
import {
  assertTenantModuleEntitled,
  TenantModuleEntitlementRequiredError,
} from "./tenant-entitlements";
import { assertTenantOperational, TenantNotOperationalError } from "./tenant-operational";

export const INBOUND_EVENT_STATUSES = ["PENDING", "PROCESSED", "DUPLICATE", "FAILED"] as const;
export type InboundEventStatus = (typeof INBOUND_EVENT_STATUSES)[number];

export type InboundEventRecord = Readonly<{
  id: string;
  tenantId: string;
  channelAccountId: string;
  providerMessageId: string | null;
  eventType: string;
  senderPhone: string | null;
  recipientPhone: string | null;
  messageType: string | null;
  payload: Prisma.JsonValue;
  normalizedData: Prisma.JsonValue | null;
  processedStatus: InboundEventStatus;
  createdAt: Date;
  processedAt: Date | null;
}>;

export type InboundEventInput = Readonly<{
  channelAccountId: string;
  providerMessageId?: string | null;
  eventType: string;
  senderPhone?: string | null;
  recipientPhone?: string | null;
  messageType?: string | null;
  payload: Prisma.InputJsonValue;
  normalizedData?: Prisma.InputJsonValue;
}>;

export type InboundEventResult = Readonly<{
  event: InboundEventRecord;
  duplicate: boolean;
  status: "PENDING" | "DUPLICATE";
}>;

export type InboundEventManagerDatabase = TenantTransactionDatabase &
  TenantDataAccessDatabase &
  Pick<
    Prisma.TransactionClient,
    "channelAccount" | "inboundMessageEvent" | "tenant" | "tenantEntitlement"
  >;

export interface InboundEventManager {
  findById(context: TenantContext, eventId: string): Promise<InboundEventRecord | null>;
  recordInboundEvent(context: TenantContext, input: InboundEventInput): Promise<InboundEventResult>;
}

export class InboundChannelNotFoundError extends Error {
  override readonly name = "InboundChannelNotFoundError";

  constructor() {
    super("Channel was not found");
  }
}

export class InboundChannelInactiveError extends Error {
  override readonly name = "InboundChannelInactiveError";

  constructor() {
    super("Channel is not active");
  }
}

export class InboundTenantNotOperationalError extends Error {
  override readonly name = "InboundTenantNotOperationalError";

  constructor() {
    super("Tenant is not operational");
  }
}

export class InboundMessagingModuleRequiredError extends Error {
  override readonly name = "InboundMessagingModuleRequiredError";

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

function inboundEventItem(event: InboundMessageEvent): InboundEventRecord {
  return {
    channelAccountId: event.channelAccountId,
    createdAt: event.createdAt,
    eventType: event.eventType,
    id: event.id,
    messageType: event.messageType,
    normalizedData: event.normalizedData,
    payload: event.payload,
    processedAt: event.processedAt,
    processedStatus: event.processedStatus as InboundEventStatus,
    providerMessageId: event.providerMessageId,
    recipientPhone: event.recipientPhone,
    senderPhone: event.senderPhone,
    tenantId: event.tenantId,
  };
}

export function createInboundEventManager(
  database: InboundEventManagerDatabase,
): InboundEventManager {
  const findById = async (
    context: TenantContext,
    eventId: string,
  ): Promise<InboundEventRecord | null> => {
    const tenant = createTenantContext(context.tenantId);
    const event = await database.inboundMessageEvent.findUnique({
      where: { id: eventId, tenantId: tenant.tenantId },
    });
    return event === null ? null : inboundEventItem(event);
  };

  const recordInboundEvent = async (
    context: TenantContext,
    input: InboundEventInput,
  ): Promise<InboundEventResult> => {
    const tenant = createTenantContext(context.tenantId);
    try {
      return await database.$transaction(async (transaction) => {
        try {
          await assertTenantOperational(tenant, transaction);
        } catch (error) {
          if (error instanceof TenantNotOperationalError) {
            throw new InboundTenantNotOperationalError();
          }
          throw error;
        }
        try {
          await assertTenantModuleEntitled(tenant, "module.messaging.basic", transaction);
        } catch (error) {
          if (error instanceof TenantModuleEntitlementRequiredError) {
            throw new InboundMessagingModuleRequiredError();
          }
          throw error;
        }

        const channel = await transaction.channelAccount.findUnique({
          select: { active: true, id: true, status: true },
          where: { id: input.channelAccountId, tenantId: tenant.tenantId },
        });
        if (channel === null) throw new InboundChannelNotFoundError();
        if (
          !channel.active ||
          channel.status === "archived" ||
          channel.status === "disabled" ||
          channel.status === "disconnected"
        ) {
          throw new InboundChannelInactiveError();
        }

        if (input.providerMessageId !== undefined && input.providerMessageId !== null) {
          const existing = await transaction.inboundMessageEvent.findUnique({
            where: {
              tenantId_channelAccountId_providerMessageId: {
                channelAccountId: channel.id,
                providerMessageId: input.providerMessageId,
                tenantId: tenant.tenantId,
              },
            },
          });
          if (existing !== null) {
            return {
              duplicate: true,
              event: { ...inboundEventItem(existing), processedStatus: "DUPLICATE" },
              status: "DUPLICATE",
            };
          }
        }

        const created = await transaction.inboundMessageEvent.create({
          data: {
            channelAccountId: channel.id,
            eventType: input.eventType,
            ...(input.messageType === undefined ? {} : { messageType: input.messageType }),
            ...(input.normalizedData === undefined ? {} : { normalizedData: input.normalizedData }),
            ...(input.providerMessageId === undefined
              ? {}
              : { providerMessageId: input.providerMessageId }),
            ...(input.recipientPhone === undefined ? {} : { recipientPhone: input.recipientPhone }),
            ...(input.senderPhone === undefined ? {} : { senderPhone: input.senderPhone }),
            payload: input.payload,
            tenantId: tenant.tenantId,
          },
        });
        const access = createTenantDataAccess(tenant, transaction);
        await access.outbox.append({
          aggregateId: created.id,
          aggregateType: "InboundMessageEvent",
          eventType: "messaging.inbound.event_received",
          payload: {
            channelAccountId: created.channelAccountId,
            eventId: created.id,
            eventType: created.eventType,
            providerMessageId: created.providerMessageId,
          },
        });
        return {
          duplicate: false,
          event: inboundEventItem(created),
          status: "PENDING",
        };
      });
    } catch (error) {
      if (
        !isUniqueViolation(error) ||
        input.providerMessageId === null ||
        input.providerMessageId === undefined
      ) {
        throw error;
      }
      const existing = await database.inboundMessageEvent.findUnique({
        where: {
          tenantId_channelAccountId_providerMessageId: {
            channelAccountId: input.channelAccountId,
            providerMessageId: input.providerMessageId,
            tenantId: tenant.tenantId,
          },
        },
      });
      if (existing === null) throw error;
      return {
        duplicate: true,
        event: { ...inboundEventItem(existing), processedStatus: "DUPLICATE" },
        status: "DUPLICATE",
      };
    }
  };

  return Object.freeze({ findById, recordInboundEvent });
}
