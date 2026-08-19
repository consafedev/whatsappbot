import type { MessagingProvider, ProviderSendResult, SendMessageMetadata } from "./provider";
import { getMessagingProvider } from "./provider-factory";

export type OutboundDispatchMessage = Readonly<{
  id: string;
  tenantId: string;
  channelAccountId: string;
  recipientPhone: string;
  messageType: "text" | "media" | "template" | string;
  content: unknown;
  retryCount: number;
  maxRetries: number;
}>;

export type OutboundDispatchChannel = Readonly<{
  active: boolean;
  providerType: string;
  status: string;
}>;

export type OutboundDispatchFailureKind = "transient" | "permanent";

export type OutboundDispatchOutcome =
  | Readonly<{
      kind: "sent";
      providerMessageId: string;
    }>
  | Readonly<{
      kind: "failed";
      error: string;
      failureKind: OutboundDispatchFailureKind;
      nextRetryAt: Date | null;
    }>;

export type OutboundDispatcherDependencies = Readonly<{
  assertMessagingEntitled(tenantId: string): Promise<void>;
  assertTenantOperational(tenantId: string): Promise<void>;
  findChannel(tenantId: string, channelAccountId: string): Promise<OutboundDispatchChannel | null>;
  providerFactory?: (channel: OutboundDispatchChannel) => MessagingProvider;
  now?: () => Date;
}>;

export type BackoffOptions = Readonly<{
  baseDelayMs?: number;
  maxDelayMs?: number;
}>;

const TRANSIENT_ERROR_MARKERS = [
  "NETWORK",
  "TIMEOUT",
  "RATE_LIMIT",
  "429",
  "500",
  "502",
  "503",
  "504",
] as const;

const PERMANENT_ERROR_MARKERS = [
  "INVALID_NUMBER",
  "BAD_REQUEST",
  "400",
  "CREDENTIAL",
  "UNAUTHORIZED",
  "401",
  "403",
  "NOT_REGISTERED",
] as const;

function markerValue(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`.toUpperCase();
  return String(error).toUpperCase();
}

export function classifyOutboundError(error: unknown): OutboundDispatchFailureKind {
  const value = markerValue(error);
  if (TRANSIENT_ERROR_MARKERS.some((marker) => value.includes(marker))) return "transient";
  return "permanent";
}

export function calculateOutboundBackoff(retryCount: number, options: BackoffOptions = {}): number {
  if (!Number.isInteger(retryCount) || retryCount < 0) {
    throw new RangeError("retryCount must be a non-negative integer");
  }
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 60_000;
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 1) throw new RangeError("Invalid base delay");
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs) {
    throw new RangeError("Invalid maximum delay");
  }
  return Math.min(maxDelayMs, baseDelayMs * 2 ** retryCount);
}

function contentRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function textContent(value: unknown): string | null {
  const text = contentRecord(value).text;
  return typeof text === "string" && text.length > 0 ? text : null;
}

function mediaContent(value: unknown): { url: string; caption?: string; mediaType: string } | null {
  const content = contentRecord(value);
  const url = content.mediaUrl;
  if (typeof url !== "string" || url.length === 0) return null;
  const caption = typeof content.caption === "string" ? content.caption : undefined;
  const mediaType =
    typeof content.mediaType === "string" ? content.mediaType : "application/octet-stream";
  return { mediaType, url, ...(caption === undefined ? {} : { caption }) };
}

function sendMetadata(message: OutboundDispatchMessage): SendMessageMetadata {
  return {
    idempotencyKey: `send-message:${message.id}`,
    messageId: message.id,
    tenantId: message.tenantId,
  };
}

function providerFailure(result: ProviderSendResult): Error {
  return new Error(result.errorCode ?? result.errorMessage ?? "Provider rejected outbound message");
}

export class OutboundMessageDispatcher {
  private readonly dependencies: OutboundDispatcherDependencies;

  constructor(dependencies: OutboundDispatcherDependencies) {
    this.dependencies = dependencies;
  }

  async dispatch(message: OutboundDispatchMessage): Promise<OutboundDispatchOutcome> {
    try {
      await this.dependencies.assertTenantOperational(message.tenantId);
      await this.dependencies.assertMessagingEntitled(message.tenantId);
      const channel = await this.dependencies.findChannel(
        message.tenantId,
        message.channelAccountId,
      );
      if (channel === null || !channel.active) {
        return this.permanentFailure("Channel account is inactive or unavailable");
      }
      if (channel.status !== "connected") {
        return this.permanentFailure(`Channel account is not connected: ${channel.status}`);
      }

      const providerFactory = this.dependencies.providerFactory ?? getMessagingProvider;
      const provider = providerFactory(channel);
      const content = contentRecord(message.content);
      const result = await this.send(provider, message, content, sendMetadata(message));
      if (result.status === "sent" && result.providerMessageId !== null) {
        return { kind: "sent", providerMessageId: result.providerMessageId };
      }
      return this.failureFrom(providerFailure(result), message.retryCount);
    } catch (error) {
      return this.failureFrom(error, message.retryCount);
    }
  }

  private async send(
    provider: MessagingProvider,
    message: OutboundDispatchMessage,
    content: Record<string, unknown>,
    metadata: SendMessageMetadata,
  ): Promise<ProviderSendResult> {
    if (message.messageType === "text") {
      const text = textContent(content);
      if (text === null) throw new Error("Outbound text content is required");
      return provider.sendText(message.recipientPhone, text, metadata);
    }
    if (message.messageType === "media") {
      const media = mediaContent(content);
      if (media === null) throw new Error("Outbound media content is required");
      return provider.sendMedia(message.recipientPhone, media.url, media.mediaType, media.caption);
    }
    throw new Error(`Outbound message type is not supported: ${message.messageType}`);
  }

  private failureFrom(error: unknown, retryCount: number): OutboundDispatchOutcome {
    const failureKind = classifyOutboundError(error);
    return {
      error: error instanceof Error ? error.message : String(error),
      failureKind,
      kind: "failed",
      nextRetryAt:
        failureKind === "transient"
          ? new Date(
              (this.dependencies.now ?? (() => new Date()))().getTime() +
                calculateOutboundBackoff(retryCount),
            )
          : null,
    };
  }

  private permanentFailure(error: string): OutboundDispatchOutcome {
    return { error, failureKind: "permanent", kind: "failed", nextRetryAt: null };
  }
}

export function isPermanentOutboundError(error: unknown): boolean {
  const value = markerValue(error);
  return PERMANENT_ERROR_MARKERS.some((marker) => value.includes(marker));
}
