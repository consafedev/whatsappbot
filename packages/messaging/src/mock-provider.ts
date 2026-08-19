import { randomUUID } from "node:crypto";
import {
  type ConnectionResult,
  type ConnectionState,
  MESSAGE_STATUS,
  MessagingProvider,
  type MockMessagingProviderOptions,
  type MockOutboundMessage,
  type MockProviderFailure,
  type NormalizedInboundEvent,
  type ProviderHealth,
  type ProviderSendResult,
  type SendMessageMetadata,
  verifyHmacSha256Signature,
} from "./provider";

export type { MockMessagingProviderOptions, MockOutboundMessage, MockProviderFailure };

export class MockMessagingProvider extends MessagingProvider {
  readonly sentMessages: MockOutboundMessage[] = [];
  private readonly options: MockMessagingProviderOptions;
  private state: ConnectionState = "connected";

  constructor(options: MockMessagingProviderOptions = {}) {
    super();
    this.options = options;
    if (options.health === "disconnected") this.state = "disconnected";
  }

  async connect(_accountId: string): Promise<ConnectionResult> {
    this.state = "connected";
    return { checkedAt: new Date(), pairingCode: null, state: this.state };
  }

  async disconnect(_accountId: string): Promise<void> {
    this.state = "disconnected";
  }

  async getConnectionState(_accountId: string): Promise<ConnectionState> {
    return this.state;
  }

  async sendText(
    to: string,
    message: string,
    metadata: SendMessageMetadata,
  ): Promise<ProviderSendResult> {
    this.sentMessages.push({
      caption: null,
      kind: "text",
      mediaType: null,
      mediaUrl: null,
      message,
      metadata,
      to,
    });
    return this.sendResult();
  }

  async sendMedia(
    to: string,
    mediaUrl: string,
    mediaType: string,
    caption?: string,
  ): Promise<ProviderSendResult> {
    this.sentMessages.push({
      caption: caption ?? null,
      kind: "media",
      mediaType,
      mediaUrl,
      message: null,
      metadata: {},
      to,
    });
    return this.sendResult();
  }

  verifyWebhookSignature(
    headers: Readonly<Record<string, string | undefined>>,
    rawBody: Uint8Array,
    secret: string,
  ): boolean {
    return verifyHmacSha256Signature(headers, rawBody, secret);
  }

  async normalizeInboundPayload(
    payload: Readonly<Record<string, unknown>>,
  ): Promise<NormalizedInboundEvent> {
    const text = typeof payload.text === "string" ? payload.text : null;
    const from = typeof payload.from === "string" ? payload.from : null;
    const mediaUrl = typeof payload.mediaUrl === "string" ? payload.mediaUrl : null;
    const providerMessageId =
      typeof payload.providerMessageId === "string" ? payload.providerMessageId : null;
    const rawTimestamp =
      typeof payload.timestamp === "string" ? new Date(payload.timestamp) : new Date();
    const providerTimestamp = Number.isNaN(rawTimestamp.getTime()) ? new Date() : rawTimestamp;
    return {
      contactPoint: from,
      conversationExternalId:
        typeof payload.conversationId === "string" ? payload.conversationId : from,
      direction: "inbound",
      eventId: typeof payload.eventId === "string" ? payload.eventId : randomUUID(),
      mediaType: typeof payload.mediaType === "string" ? payload.mediaType : null,
      mediaUrl,
      messageType: text !== null ? "text" : mediaUrl !== null ? "media" : "unknown",
      metadata: {},
      origin: payload.fromMe === true ? "human_external_device" : "customer",
      providerMessageId,
      providerTimestamp,
      textBody: text,
    };
  }

  async getHealthStatus(): Promise<ProviderHealth> {
    const status = this.options.health ?? "healthy";
    return {
      checkedAt: new Date(),
      errorCode: status === "healthy" ? null : "MOCK_HEALTH_CONFIGURED",
      latencyMs: 0,
      message:
        status === "healthy" ? "Mock provider is healthy" : "Mock provider health configured",
      status,
    };
  }

  private sendResult(): ProviderSendResult {
    const failure = this.options.failure;
    if (failure !== undefined) {
      const errorCode =
        failure === "network"
          ? "NETWORK_ERROR"
          : failure === "rate_limit"
            ? "RATE_LIMITED"
            : "INVALID_NUMBER";
      return {
        acceptedAt: new Date(),
        errorCode,
        errorMessage: failure,
        providerMessageId: null,
        status: MESSAGE_STATUS.FAILED,
      };
    }
    return {
      acceptedAt: new Date(),
      providerMessageId: `mock-${randomUUID()}`,
      status: MESSAGE_STATUS.SENT,
    };
  }
}
