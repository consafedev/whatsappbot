import { randomUUID } from "node:crypto";
import type {
  InboundEventType,
  InboundNormalizationContext,
  NormalizedInboundEvent,
  NormalizedMedia,
  NormalizedMessageType,
  NormalizedStatusUpdate,
  ProviderType,
} from "./provider";

type Payload = Readonly<Record<string, unknown>>;

function record(value: unknown): Payload {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Payload)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nestedString(value: unknown, ...keys: string[]): string | null {
  let current: unknown = value;
  for (const key of keys) current = record(current)[key];
  return stringValue(current);
}

function dateValue(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value);
  if (typeof value === "number") {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return dateValue(numeric);
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

function messageType(
  value: unknown,
  fallback: NormalizedMessageType = "unknown",
): NormalizedMessageType {
  if (typeof value !== "string") return fallback;
  const normalized = value.toLowerCase();
  if (normalized === "chat" || normalized === "text") return "text";
  if (normalized === "image" || normalized === "photo") return "image";
  if (normalized === "audio" || normalized === "ptt") return "audio";
  if (normalized === "document") return "document";
  if (normalized === "video") return "video";
  if (normalized === "location") return "location";
  if (normalized === "interactive" || normalized === "button") return "interactive";
  if (normalized === "media") return "media";
  return fallback;
}

function eventType(value: unknown): InboundEventType {
  if (typeof value !== "string") return "UNKNOWN";
  const normalized = value.toUpperCase();
  if (normalized === "MESSAGE_RECEIVED" || normalized === "MESSAGE") return "MESSAGE_RECEIVED";
  if (normalized === "STATUS_UPDATE" || normalized === "STATUS") return "STATUS_UPDATE";
  if (normalized === "DELIVERY_RECEIPT" || normalized === "RECEIPT") {
    return "DELIVERY_RECEIPT";
  }
  return "UNKNOWN";
}

function statusUpdate(value: unknown, timestamp: Date): NormalizedStatusUpdate | null {
  const source = record(value);
  const status = stringValue(source.status)?.toLowerCase();
  if (status !== "sent" && status !== "delivered" && status !== "read" && status !== "failed") {
    return null;
  }
  const errorCode = stringValue(source.errorCode);
  const errorMessage = stringValue(source.errorMessage);
  return {
    ...(errorCode === null ? {} : { errorCode }),
    ...(errorMessage === null ? {} : { errorMessage }),
    status,
    timestamp: dateValue(source.timestamp ?? timestamp),
  };
}

function media(
  source: Payload,
  type: NormalizedMessageType,
  fallbackUrl: string | null = null,
): NormalizedMedia | null {
  const mediaSource = record(source.media ?? source[type]);
  const url =
    stringValue(mediaSource.url) ??
    stringValue(mediaSource.link) ??
    stringValue(mediaSource.id) ??
    fallbackUrl;
  if (url === null || type === "text" || type === "unknown") return null;
  const caption = stringValue(mediaSource.caption) ?? stringValue(source.caption);
  const fileName = stringValue(mediaSource.fileName) ?? stringValue(mediaSource.filename);
  return {
    ...(caption === null ? {} : { caption }),
    ...(fileName === null ? {} : { fileName }),
    mimeType:
      stringValue(mediaSource.mimeType) ??
      stringValue(mediaSource.mimetype) ??
      stringValue(mediaSource.mime_type) ??
      "application/octet-stream",
    url,
  };
}

function baseEvent(
  payload: Payload,
  context: InboundNormalizationContext,
  values: Readonly<{
    eventId?: string | null;
    eventType?: InboundEventType;
    providerMessageId?: string | null;
    senderPhone?: string | null;
    recipientPhone?: string | null;
    messageType?: NormalizedMessageType;
    textBody?: string | null;
    media?: NormalizedMedia | null;
    statusUpdate?: NormalizedStatusUpdate | null;
    timestamp?: Date;
    conversationExternalId?: string | null;
    origin?: "customer" | "human_external_device";
  }>,
): NormalizedInboundEvent {
  const timestamp = values.timestamp ?? new Date();
  const type = values.messageType ?? "unknown";
  const textBody = values.textBody ?? null;
  return {
    channelId: context.channelId,
    contactPoint: values.senderPhone ?? null,
    conversationExternalId: values.conversationExternalId ?? values.senderPhone ?? null,
    direction: "inbound",
    eventId: values.eventId ?? values.providerMessageId ?? cryptoRandomId(),
    eventType: values.eventType ?? "UNKNOWN",
    media: values.media ?? null,
    mediaType: values.media?.mimeType ?? null,
    mediaUrl: values.media?.url ?? null,
    messageType: type,
    metadata: {},
    origin: values.origin ?? "customer",
    providerMessageId: values.providerMessageId ?? null,
    providerTimestamp: timestamp,
    providerType: context.providerType,
    rawPayload: payload,
    recipientPhone: values.recipientPhone ?? null,
    senderPhone: values.senderPhone ?? null,
    statusUpdate: values.statusUpdate ?? null,
    tenantId: context.tenantId,
    textBody,
    timestamp,
  };
}

function cryptoRandomId(): string {
  return `inbound-${randomUUID()}`;
}

function receiptEventId(providerMessageId: string | null, status: string | null, timestamp: Date) {
  if (providerMessageId === null || status === null) return null;
  return `receipt:${providerMessageId}:${status}:${timestamp.toISOString()}`;
}

function normalizeGenericPayload(
  payload: Payload,
  context: InboundNormalizationContext,
): NormalizedInboundEvent {
  const type = messageType(
    payload.messageType ?? payload.type,
    payload.text !== undefined ? "text" : "unknown",
  );
  const timestamp = dateValue(payload.timestamp ?? payload.t ?? payload.ts);
  const status = statusUpdate(payload.statusUpdate ?? payload.status, timestamp);
  const normalizedEventType = eventType(payload.eventType ?? payload.event);
  const inferredEventType =
    normalizedEventType !== "UNKNOWN"
      ? normalizedEventType
      : status === null
        ? type === "unknown"
          ? "UNKNOWN"
          : "MESSAGE_RECEIVED"
        : "DELIVERY_RECEIPT";
  const mediaValue = media(payload, type, stringValue(payload.mediaUrl));
  const providerMessageId =
    stringValue(payload.providerMessageId ?? nestedString(payload, "id", "_serialized")) ??
    stringValue(payload.id);
  const explicitEventId = stringValue(payload.eventId);
  return baseEvent(payload, context, {
    conversationExternalId: stringValue(payload.conversationId ?? payload.chatId),
    eventId:
      inferredEventType === "MESSAGE_RECEIVED"
        ? explicitEventId
        : (explicitEventId ?? receiptEventId(providerMessageId, status?.status ?? null, timestamp)),
    eventType: inferredEventType,
    media: mediaValue,
    messageType: type,
    origin: payload.fromMe === true ? "human_external_device" : "customer",
    providerMessageId,
    recipientPhone: stringValue(payload.to ?? payload.recipientPhone),
    senderPhone: stringValue(payload.from ?? payload.senderPhone),
    statusUpdate: status,
    textBody: stringValue(payload.text ?? payload.body ?? payload.caption),
    timestamp,
  });
}

function normalizeMetaPayload(
  payload: Payload,
  context: InboundNormalizationContext,
): NormalizedInboundEvent {
  const entry = record((Array.isArray(payload.entry) ? payload.entry[0] : null) ?? payload);
  const change = record((Array.isArray(entry.changes) ? entry.changes[0] : null) ?? entry);
  const value = record(change.value ?? change);
  const message = record(Array.isArray(value.messages) ? value.messages[0] : null);
  const receipt = record(Array.isArray(value.statuses) ? value.statuses[0] : null);
  if (Object.keys(receipt).length > 0 && Object.keys(message).length === 0) {
    const timestamp = dateValue(receipt.timestamp);
    const normalizedStatus = statusUpdate(receipt, timestamp);
    const providerMessageId = stringValue(receipt.id);
    return baseEvent(payload, context, {
      eventId: receiptEventId(providerMessageId, normalizedStatus?.status ?? null, timestamp),
      eventType: "DELIVERY_RECEIPT",
      providerMessageId,
      recipientPhone: stringValue(receipt.recipient_id),
      statusUpdate: normalizedStatus,
      timestamp,
    });
  }
  const type = messageType(message.type, message.text !== undefined ? "text" : "unknown");
  const timestamp = dateValue(message.timestamp);
  const mediaSource = record(message[type]);
  const mediaValue = media(
    {
      ...message,
      media: mediaSource,
    },
    type,
    stringValue(mediaSource.id),
  );
  return baseEvent(payload, context, {
    conversationExternalId: stringValue(message.from),
    eventId: stringValue(message.id),
    eventType: Object.keys(message).length === 0 ? "UNKNOWN" : "MESSAGE_RECEIVED",
    media: mediaValue,
    messageType: type,
    providerMessageId: stringValue(message.id),
    recipientPhone:
      nestedString(value, "metadata", "display_phone_number") ??
      nestedString(value, "metadata", "phone_number_id"),
    senderPhone: stringValue(message.from),
    textBody:
      nestedString(message, "text", "body") ?? nestedString(message, "interactive", "body", "text"),
    timestamp,
  });
}

export function normalizeInboundPayload(
  providerType: ProviderType,
  payload: Payload,
  context: InboundNormalizationContext,
): NormalizedInboundEvent {
  if (providerType === "meta") return normalizeMetaPayload(payload, context);
  return normalizeGenericPayload(payload, context);
}
