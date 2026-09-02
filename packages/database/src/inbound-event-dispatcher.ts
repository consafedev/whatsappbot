import type { ConversationManagerDatabase } from "./conversation-manager";
import {
  createDeliveryStatusManager,
  type DeliveryStatusManager,
  type DeliveryStatusReconcileResult,
} from "./delivery-status-manager";
import {
  createExternalHumanMessageManager,
  type ExternalHumanMessageManager,
  ExternalHumanMessageOutboundEchoRaceError,
  type ExternalHumanMessageResult,
} from "./external-human-message-manager";
import type { InboundMessageEvent, Prisma, PrismaClient } from "./generated/prisma/client";
import {
  createInboundMessageManager,
  type InboundMessageManager,
  type InboundMessagePersistResult,
} from "./inbound-message-manager";
import {
  createOutboundEchoManager,
  OutboundEchoAlreadyProcessedError,
  OutboundEchoConflictError,
  type OutboundEchoManager,
  OutboundEchoNotMatchedError,
  type OutboundEchoReconcileResult,
} from "./outbound-echo-manager";
import type { RuleExecutionContext } from "./rule-action-executor";
import {
  dispatchRuleTriggers,
  type RuleTriggerDispatcherDatabase,
  type RuleTriggerDispatchResult,
} from "./rule-trigger-dispatcher";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { TenantModuleEntitlementRequiredError } from "./tenant-entitlements";
import { processInboundAiTurn, type AiTurnResult } from "./ai-agent-dispatcher";

export type InboundEventDispatcherDatabase = ConversationManagerDatabase &
  Pick<
    PrismaClient,
    | "message"
    | "outboundMessage"
    | "rule"
    | "user"
    | "organizationUnit"
    | "auditLog"
    | "domainEventOutbox"
  >;

export type InboundEventDispatchInput = Readonly<{ inboundEventId: string }>;

export type InboundEventDispatchResult = Readonly<
  | {
      kind: "inbound";
      result: InboundMessagePersistResult;
      ruleDispatchResults?: RuleTriggerDispatchResult[];
      aiTurnResult?: AiTurnResult;
    }
  | { kind: "echo"; result: OutboundEchoReconcileResult }
  | { kind: "external_human"; result: ExternalHumanMessageResult }
  | { kind: "delivery_status"; result: DeliveryStatusReconcileResult }
>;

export class InboundEventDispatchEventNotFoundError extends Error {
  override readonly name = "InboundEventDispatchEventNotFoundError";

  constructor() {
    super("Inbound event was not found");
  }
}

export class InboundEventDispatchDeferredError extends Error {
  override readonly name = "InboundEventDispatchDeferredError";

  constructor(eventType: string) {
    super(`Inbound event type ${eventType} is deferred to a later story`);
  }
}

export class InboundEventDispatchDeliveryStatusInvalidError extends Error {
  override readonly name = "InboundEventDispatchDeliveryStatusInvalidError";

  constructor() {
    super("Inbound delivery status event is missing a valid provider message or status update");
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function jsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function externalStructuredPayload(event: InboundMessageEvent): Prisma.InputJsonValue | undefined {
  const normalized = record(event.normalizedData);
  const payload = record(event.payload);
  const explicit = jsonValue(normalized.structuredPayload ?? payload.structuredPayload);
  if (explicit !== undefined) return explicit;
  const data: Record<string, Prisma.InputJsonValue> = {};
  const media = jsonValue(normalized.media ?? payload.media);
  const metadata = jsonValue(normalized.metadata);
  const conversationExternalId = jsonValue(normalized.conversationExternalId);
  if (media !== undefined) data.media = media;
  if (metadata !== undefined) data.metadata = metadata;
  if (conversationExternalId !== undefined) data.conversationExternalId = conversationExternalId;
  return Object.keys(data).length === 0 ? undefined : data;
}

function externalTextBody(event: InboundMessageEvent): string | null {
  const normalized = record(event.normalizedData);
  const payload = record(event.payload);
  return (
    stringValue(normalized.textBody) ??
    stringValue(payload.textBody) ??
    stringValue(payload.text) ??
    stringValue(payload.body) ??
    stringValue(payload.caption)
  );
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value);
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fromMe(event: InboundMessageEvent): boolean {
  const normalized = record(event.normalizedData);
  const payload = record(event.payload);
  return (
    normalized.fromMe === true ||
    normalized.origin === "human_external_device" ||
    payload.fromMe === true
  );
}

function providerTimestamp(event: InboundMessageEvent): Date {
  const normalized = record(event.normalizedData);
  return (
    dateValue(normalized.providerTimestamp) ??
    dateValue(normalized.timestamp) ??
    new Date(event.createdAt)
  );
}

const DELIVERY_STATUSES = new Set(["sent", "delivered", "read", "failed"]);

function deliveryStatusInput(event: InboundMessageEvent): {
  providerMessageId: string;
  statusUpdate: {
    status: "sent" | "delivered" | "read" | "failed";
    timestamp: Date;
    errorCode?: string;
    errorMessage?: string;
  };
} {
  const normalized = record(event.normalizedData);
  const payload = record(event.payload);
  const normalizedUpdate = record(normalized.statusUpdate);
  const payloadUpdate = record(payload.statusUpdate);
  const source = Object.keys(normalizedUpdate).length > 0 ? normalizedUpdate : payloadUpdate;
  const rawStatus =
    stringValue(source.status) ?? stringValue(normalized.status) ?? stringValue(payload.status);
  const status = rawStatus?.toLowerCase();
  const providerMessageId =
    stringValue(normalized.providerMessageId) ??
    stringValue(normalizedUpdate.providerMessageId) ??
    stringValue(payload.providerMessageId) ??
    event.providerMessageId;
  const timestamp =
    dateValue(source.timestamp) ??
    dateValue(normalized.providerTimestamp) ??
    dateValue(normalized.timestamp);

  if (
    providerMessageId === null ||
    status === undefined ||
    !DELIVERY_STATUSES.has(status) ||
    timestamp === null
  ) {
    throw new InboundEventDispatchDeliveryStatusInvalidError();
  }

  const errorCode = stringValue(source.errorCode);
  const errorMessage = stringValue(source.errorMessage);
  return {
    providerMessageId,
    statusUpdate: {
      ...(errorCode === null ? {} : { errorCode }),
      ...(errorMessage === null ? {} : { errorMessage }),
      status: status as "sent" | "delivered" | "read" | "failed",
      timestamp,
    },
  };
}

export interface InboundEventDispatcher {
  dispatch(
    context: TenantContext,
    input: InboundEventDispatchInput,
  ): Promise<InboundEventDispatchResult>;
}

export function createInboundEventDispatcher(
  database: InboundEventDispatcherDatabase,
  options?: { encryptionSecret?: string | Uint8Array },
): InboundEventDispatcher {
  const inboundMessages: InboundMessageManager = createInboundMessageManager(database);
  const outboundEchoes: OutboundEchoManager = createOutboundEchoManager(database);
  const externalHumanMessages: ExternalHumanMessageManager =
    createExternalHumanMessageManager(database);
  const deliveryStatuses: DeliveryStatusManager = createDeliveryStatusManager(database);

  const dispatch = async (
    context: TenantContext,
    input: InboundEventDispatchInput,
  ): Promise<InboundEventDispatchResult> => {
    const tenant = createTenantContext(context.tenantId);
    const event = await database.inboundMessageEvent.findFirst({
      where: { id: input.inboundEventId, tenantId: tenant.tenantId },
    });
    if (event === null) throw new InboundEventDispatchEventNotFoundError();

    if (event.eventType === "MESSAGE_RECEIVED") {
      if (!fromMe(event)) {
        const persistResult = await inboundMessages.persistInboundMessage(tenant, input);
        const ruleDispatchResults: RuleTriggerDispatchResult[] = [];

        if (!persistResult.duplicate) {
          const [conversation, contact, channel] = await Promise.all([
            database.conversation.findFirst({
              where: { id: persistResult.conversationId, tenantId: tenant.tenantId },
            }),
            persistResult.message.contactId
              ? database.contact.findFirst({
                  where: { id: persistResult.message.contactId, tenantId: tenant.tenantId },
                })
              : null,
            database.channelAccount.findFirst({
              where: { id: persistResult.message.channelAccountId, tenantId: tenant.tenantId },
            }),
          ]);

          const resolvedContactId = contact?.id ?? persistResult.message.contactId ?? null;
          const resolvedProviderType = channel?.providerType;
          const contactName = contact?.name;
          const contactPhone = contact?.phoneNumber;
          const assignedUnitId = conversation?.assignedUnitId;
          const assignedUserId = conversation?.assignedUserId;
          const automationMode = conversation?.automationMode;
          const conversationStatus = conversation?.status;

          const ruleContext: RuleExecutionContext = {
            channel: {
              channelAccountId: persistResult.message.channelAccountId,
              ...(resolvedProviderType ? { providerType: resolvedProviderType } : {}),
            },
            channelAccountId: persistResult.message.channelAccountId,
            contact: {
              customAttributes:
                contact?.customAttributes && typeof contact.customAttributes === "object"
                  ? (contact.customAttributes as Record<string, unknown>)
                  : {},
              ...(contactName !== undefined && contactName !== null ? { name: contactName } : {}),
              ...(contactPhone !== undefined ? { phoneNumber: contactPhone } : {}),
              tags: contact?.tags ?? [],
            },
            ...(resolvedContactId !== null ? { contactId: resolvedContactId } : {}),
            conversation: {
              ...(assignedUnitId !== undefined ? { assignedUnitId } : {}),
              ...(assignedUserId !== undefined ? { assignedUserId } : {}),
              ...(automationMode !== undefined ? { automationMode } : {}),
              ...(conversationStatus !== undefined ? { status: conversationStatus } : {}),
              unreadCount: 1,
            },
            conversationId: persistResult.conversationId,
            message: {
              direction: persistResult.message.direction,
              mediaType:
                persistResult.message.messageType !== "text"
                  ? persistResult.message.messageType
                  : null,
              origin: persistResult.message.origin,
              textBody: persistResult.message.textBody,
            },
            now: new Date(),
          };

          try {
            if (persistResult.isNewConversation) {
              const resCreated = await dispatchRuleTriggers(
                tenant,
                "ON_CONVERSATION_CREATED",
                ruleContext,
                database as unknown as RuleTriggerDispatcherDatabase,
              );
              ruleDispatchResults.push(resCreated);
            }
            const resReceived = await dispatchRuleTriggers(
              tenant,
              "ON_MESSAGE_RECEIVED",
              ruleContext,
              database as unknown as RuleTriggerDispatcherDatabase,
            );
            ruleDispatchResults.push(resReceived);
          } catch (error) {
            if (!(error instanceof TenantModuleEntitlementRequiredError)) {
              throw error;
            }
          }

          const rulesSentMessage = ruleDispatchResults.some((r) =>
            r.results.some((exec) => exec.actionsApplied.includes("SEND_MESSAGE")),
          );

          let aiTurnResult: AiTurnResult | undefined;
          if (!rulesSentMessage && persistResult.message.textBody) {
            try {
              aiTurnResult = await processInboundAiTurn(
                database as unknown as PrismaClient,
                {
                  tenantId: tenant.tenantId,
                  conversationId: persistResult.conversationId,
                  channelAccountId: persistResult.message.channelAccountId,
                  contactId: resolvedContactId ?? "",
                  inboundMessageId: persistResult.message.id,
                  inboundText: persistResult.message.textBody,
                  encryptionSecret:
                    options?.encryptionSecret ??
                    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                },
              );
            } catch {
              // Gracefully continue so inbound persist does not fail
            }
          }

          return {
            kind: "inbound",
            result: persistResult,
            ...(ruleDispatchResults.length > 0 ? { ruleDispatchResults } : {}),
            ...(aiTurnResult?.handled ? { aiTurnResult } : {}),
          };
        }
      }
      if (event.providerMessageId === null) throw new OutboundEchoNotMatchedError();
      const echoInput = {
        channelAccountId: event.channelAccountId,
        inboundEventId: event.id,
        providerMessageId: event.providerMessageId,
        providerTimestamp: providerTimestamp(event),
      };
      try {
        return {
          kind: "echo",
          result: await outboundEchoes.reconcileOutboundEcho(tenant, echoInput),
        };
      } catch (error) {
        if (
          !(error instanceof OutboundEchoNotMatchedError) &&
          !(error instanceof OutboundEchoAlreadyProcessedError) &&
          !(error instanceof OutboundEchoConflictError)
        ) {
          throw error;
        }
      }

      try {
        const structuredPayload = externalStructuredPayload(event);
        return {
          kind: "external_human",
          result: await externalHumanMessages.reconcileExternalHumanMessage(tenant, {
            ...echoInput,
            recipientPhone: event.recipientPhone,
            ...(structuredPayload === undefined ? {} : { structuredPayload }),
            textBody: externalTextBody(event),
          }),
        };
      } catch (error) {
        if (!(error instanceof ExternalHumanMessageOutboundEchoRaceError)) throw error;
        return {
          kind: "echo",
          result: await outboundEchoes.reconcileOutboundEcho(tenant, echoInput),
        };
      }
    }

    if (event.eventType === "STATUS_UPDATE" || event.eventType === "DELIVERY_RECEIPT") {
      const delivery = deliveryStatusInput(event);
      return {
        kind: "delivery_status",
        result: await deliveryStatuses.reconcileDeliveryStatus(tenant, {
          channelAccountId: event.channelAccountId,
          inboundEventId: event.id,
          providerMessageId: delivery.providerMessageId,
          statusUpdate: delivery.statusUpdate,
        }),
      };
    }

    throw new InboundEventDispatchDeferredError(event.eventType);
  };

  return Object.freeze({ dispatch });
}
