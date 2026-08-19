import { randomUUID } from "node:crypto";
import { normalizeInboundPayload } from "./inbound-normalizer";
import {
  type ConnectionResult,
  type ConnectionState,
  type InboundNormalizationContext,
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
    context: InboundNormalizationContext = {
      channelId: "",
      providerType: "mock",
      tenantId: "",
    },
  ): Promise<NormalizedInboundEvent> {
    return normalizeInboundPayload("mock", payload, context);
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
