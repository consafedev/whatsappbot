import { normalizeInboundPayload } from "./inbound-normalizer";
import type { ProviderType } from "./provider";
import {
  type ConnectionResult,
  type ConnectionState,
  type InboundNormalizationContext,
  MessagingProvider,
  MessagingProviderError,
  type NormalizedInboundEvent,
  type ProviderHealth,
  type ProviderSendResult,
  type SendMessageMetadata,
  verifyHmacSha256Signature,
} from "./provider";

export class InboundMessagingProviderAdapter extends MessagingProvider {
  constructor(private readonly providerType: ProviderType) {
    super();
  }

  async connect(_accountId: string): Promise<ConnectionResult> {
    throw this.unsupported();
  }

  async disconnect(_accountId: string): Promise<void> {
    throw this.unsupported();
  }

  async getConnectionState(_accountId: string): Promise<ConnectionState> {
    throw this.unsupported();
  }

  async sendText(
    _to: string,
    _message: string,
    _metadata: SendMessageMetadata,
  ): Promise<ProviderSendResult> {
    throw this.unsupported();
  }

  async sendMedia(
    _to: string,
    _mediaUrl: string,
    _mediaType: string,
    _caption?: string,
  ): Promise<ProviderSendResult> {
    throw this.unsupported();
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
    context?: InboundNormalizationContext,
  ): Promise<NormalizedInboundEvent> {
    return normalizeInboundPayload(
      this.providerType,
      payload,
      context ?? { channelId: "", providerType: this.providerType, tenantId: "" },
    );
  }

  async getHealthStatus(): Promise<ProviderHealth> {
    throw this.unsupported();
  }

  private unsupported(): MessagingProviderError {
    return new MessagingProviderError(
      "UNSUPPORTED_PROVIDER",
      `Provider ${this.providerType} is not implemented in this release`,
    );
  }
}
