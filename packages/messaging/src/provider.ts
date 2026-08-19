import { createHmac, timingSafeEqual } from "node:crypto";

export const MESSAGE_STATUS = Object.freeze({
  QUEUED: "queued",
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
  FAILED: "failed",
} as const);

export type MessageStatus = (typeof MESSAGE_STATUS)[keyof typeof MESSAGE_STATUS];
export const MessageStatusEnum = MESSAGE_STATUS;

export type ProviderType = "mock" | "baileys" | "wppconnect" | "meta";
export type InboundEventType =
  | "MESSAGE_RECEIVED"
  | "STATUS_UPDATE"
  | "DELIVERY_RECEIPT"
  | "UNKNOWN";
export type NormalizedMessageType =
  | "text"
  | "image"
  | "audio"
  | "document"
  | "video"
  | "location"
  | "interactive"
  | "media"
  | "unknown";
export type ProviderHealthState = "healthy" | "degraded" | "disconnected" | "error";
export type ConnectionState =
  | "not_configured"
  | "pairing"
  | "connected"
  | "reconnecting"
  | "degraded"
  | "disconnected"
  | "requires_reauth"
  | "disabled";

export type ProviderSendResult = Readonly<{
  providerMessageId: string | null;
  status: MessageStatus;
  acceptedAt: Date;
  errorCode?: string;
  errorMessage?: string;
}>;

export type SendMessageMetadata = Readonly<Record<string, unknown>>;

export type InboundNormalizationContext = Readonly<{
  channelId: string;
  tenantId: string;
  providerType: ProviderType;
}>;

export type NormalizedMedia = Readonly<{
  url: string;
  mimeType: string;
  fileName?: string;
  caption?: string;
}>;

export type NormalizedStatusUpdate = Readonly<{
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: Date;
  errorCode?: string;
}>;

export type NormalizedInboundEvent = Readonly<{
  providerType: ProviderType;
  channelId: string;
  tenantId: string;
  eventType: InboundEventType;
  eventId: string;
  providerMessageId: string | null;
  senderPhone: string | null;
  recipientPhone: string | null;
  messageType: NormalizedMessageType;
  media: NormalizedMedia | null;
  statusUpdate: NormalizedStatusUpdate | null;
  rawPayload: Readonly<Record<string, unknown>>;
  timestamp: Date;
  conversationExternalId: string | null;
  contactPoint: string | null;
  direction: "inbound";
  origin: "customer" | "human_external_device";
  textBody: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  providerTimestamp: Date;
  metadata: Readonly<Record<string, unknown>>;
}>;

export type ProviderHealth = Readonly<{
  status: ProviderHealthState;
  checkedAt: Date;
  latencyMs: number | null;
  message: string | null;
  errorCode: string | null;
}>;

export type MockProviderFailure = "network" | "rate_limit" | "invalid_number";

export type MockMessagingProviderOptions = Readonly<{
  failure?: MockProviderFailure;
  health?: ProviderHealthState;
}>;

export type MockOutboundMessage = Readonly<{
  kind: "text" | "media";
  to: string;
  message: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  caption: string | null;
  metadata: SendMessageMetadata;
}>;

export type ConnectionResult = Readonly<{
  state: ConnectionState;
  pairingCode: string | null;
  checkedAt: Date;
}>;

export type PairingResult = Readonly<{
  state: "pairing" | "connected" | "disconnected";
  qr: string | null;
  expiresAt: Date | null;
}>;

export class MessagingProviderError extends Error {
  override readonly name = "MessagingProviderError";

  constructor(
    readonly code: "NETWORK_ERROR" | "RATE_LIMITED" | "INVALID_NUMBER" | "UNSUPPORTED_PROVIDER",
    message: string,
  ) {
    super(message);
  }
}

export abstract class MessagingProvider {
  abstract connect(accountId: string): Promise<ConnectionResult>;
  abstract disconnect(accountId: string): Promise<void>;
  abstract getConnectionState(accountId: string): Promise<ConnectionState>;
  abstract sendText(
    to: string,
    message: string,
    metadata: SendMessageMetadata,
  ): Promise<ProviderSendResult>;
  abstract sendMedia(
    to: string,
    mediaUrl: string,
    mediaType: string,
    caption?: string,
  ): Promise<ProviderSendResult>;
  abstract verifyWebhookSignature(
    headers: Readonly<Record<string, string | undefined>>,
    rawBody: Uint8Array,
    secret: string,
  ): boolean;
  abstract normalizeInboundPayload(
    payload: Readonly<Record<string, unknown>>,
    context?: InboundNormalizationContext,
  ): Promise<NormalizedInboundEvent>;
  abstract getHealthStatus(): Promise<ProviderHealth>;
}

export function verifyHmacSha256Signature(
  headers: Readonly<Record<string, string | undefined>>,
  rawBody: Uint8Array,
  secret: string,
): boolean {
  const supplied = headers["x-signature"] ?? headers["x-hub-signature-256"];
  if (supplied === undefined || secret.length === 0) return false;
  const normalized = supplied.replace(/^sha256=/i, "");
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = Buffer.from(normalized, "hex");
  const target = Buffer.from(expected, "hex");
  return actual.length === target.length && timingSafeEqual(actual, target);
}
