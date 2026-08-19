import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { InboundEventManager, InboundEventResult } from "@whatsapp-platform/database";
import {
  createTenantContext,
  InboundChannelInactiveError,
  InboundChannelNotFoundError,
  InboundMessagingModuleRequiredError,
  InboundTenantNotOperationalError,
} from "@whatsapp-platform/database";
import type {
  InboundWebhookChannel,
  InboundWebhookChannelResolver,
  Prisma,
} from "@whatsapp-platform/database/platform";
import {
  canonicalProviderType,
  getMessagingInboundProvider,
  type MessagingCredentialCipher,
  MessagingCredentialCipherError,
  MessagingProviderError,
  type NormalizedInboundEvent,
} from "@whatsapp-platform/messaging";
import { MESSAGING_CREDENTIAL_CIPHER } from "./tenant-channels";

export const INBOUND_EVENT_MANAGER = Symbol("INBOUND_EVENT_MANAGER");
export const INBOUND_WEBHOOK_CHANNEL_RESOLVER = Symbol("INBOUND_WEBHOOK_CHANNEL_RESOLVER");
export const INBOUND_WEBHOOK_OPTIONS = Symbol("INBOUND_WEBHOOK_OPTIONS");

type ApiResponse = {
  setHeader(name: string, value: string): void;
};

type WebhookRequest = {
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Uint8Array;
};

export type InboundWebhookOptions = Readonly<{
  allowMock: boolean;
}>;

export type InboundWebhookResponse = Readonly<{
  success: true;
  eventId: string;
  status: "accepted" | "duplicate_ignored";
}>;

export type InboundWebhookVerificationQuery = Readonly<Record<string, string | undefined>>;

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RAW_BODY_BYTES = 256 * 1024;

function channelId(value: string): string {
  if (!UUID_V7_PATTERN.test(value)) throw new NotFoundException("Webhook channel not found");
  return value.toLowerCase();
}

function header(request: WebhookRequest, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function bodyRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Webhook payload must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function credentialValue(
  credentials: Readonly<Record<string, unknown>>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = credentials[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function rawBody(request: WebhookRequest, body: Record<string, unknown>): Uint8Array {
  const value = request.rawBody ?? Buffer.from(JSON.stringify(body), "utf8");
  if (value.byteLength > MAX_RAW_BODY_BYTES) {
    throw new BadRequestException("Webhook payload is too large");
  }
  return value;
}

function metadata(result: InboundEventResult): InboundWebhookResponse {
  return {
    eventId: result.event.id,
    status: result.duplicate ? "duplicate_ignored" : "accepted",
    success: true,
  };
}

@Injectable()
export class InboundWebhookService {
  constructor(
    @Inject(INBOUND_EVENT_MANAGER) private readonly eventManager: InboundEventManager,
    @Inject(INBOUND_WEBHOOK_CHANNEL_RESOLVER)
    private readonly channelResolver: InboundWebhookChannelResolver,
    @Inject(MESSAGING_CREDENTIAL_CIPHER)
    private readonly credentialCipher: MessagingCredentialCipher | null,
    @Inject(INBOUND_WEBHOOK_OPTIONS) private readonly options: InboundWebhookOptions,
  ) {}

  async verify(
    rawChannelId: string,
    query: InboundWebhookVerificationQuery,
    response: ApiResponse,
  ): Promise<string> {
    const channel = await this.loadChannel(rawChannelId);
    const credentials = this.decryptCredentials(channel);
    const verifyToken = credentialValue(credentials, [
      "verifyToken",
      "webhookVerifyToken",
      "webhookSecret",
    ]);
    if (
      query["hub.mode"] !== "subscribe" ||
      verifyToken === null ||
      query["hub.verify_token"] !== verifyToken ||
      query["hub.challenge"] === undefined
    ) {
      throw new ForbiddenException("Webhook verification failed");
    }
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    return query["hub.challenge"];
  }

  async receive(
    rawChannelId: string,
    request: WebhookRequest,
    body: unknown,
    mock: boolean,
  ): Promise<InboundWebhookResponse> {
    if (mock && !this.options.allowMock) throw new NotFoundException("Webhook not found");
    const channel = await this.loadChannel(rawChannelId);
    const providerType = canonicalProviderType(channel.providerType);
    if (providerType === null || (mock && providerType !== "mock")) {
      throw new BadRequestException("Unsupported webhook provider");
    }
    const payload = bodyRecord(body);
    const bytes = rawBody(request, payload);
    const credentials = this.decryptCredentials(channel);
    const provider = getMessagingInboundProvider({ providerType });
    if (!mock) {
      const webhookSecret = credentialValue(credentials, ["webhookSecret", "signatureSecret"]);
      if (
        webhookSecret !== null &&
        !provider.verifyWebhookSignature(
          {
            "x-hub-signature-256": header(request, "x-hub-signature-256"),
            "x-signature": header(request, "x-signature"),
          },
          bytes,
          webhookSecret,
        )
      ) {
        throw new UnauthorizedException("Invalid webhook signature");
      }
    }

    let normalized: NormalizedInboundEvent;
    try {
      normalized = await provider.normalizeInboundPayload(payload, {
        channelId: channel.id,
        providerType,
        tenantId: channel.tenantId,
      });
    } catch (error) {
      if (error instanceof MessagingProviderError) throw new BadRequestException(error.message);
      throw error;
    }

    try {
      const result = await this.eventManager.recordInboundEvent(
        createTenantContext(channel.tenantId),
        {
          channelAccountId: channel.id,
          eventType: normalized.eventType,
          messageType: normalized.messageType,
          normalizedData: jsonInput(normalized),
          payload: jsonInput(payload),
          providerMessageId: normalized.providerMessageId,
          recipientPhone: normalized.recipientPhone,
          senderPhone: normalized.senderPhone,
        },
      );
      return metadata(result);
    } catch (error) {
      if (error instanceof InboundChannelNotFoundError)
        throw new NotFoundException("Webhook channel not found");
      if (error instanceof InboundChannelInactiveError)
        throw new ForbiddenException("Webhook channel is inactive");
      if (error instanceof InboundMessagingModuleRequiredError) {
        throw new ForbiddenException("Messaging module is not enabled");
      }
      if (error instanceof InboundTenantNotOperationalError) {
        throw new ForbiddenException("Tenant is not operational");
      }
      throw error;
    }
  }

  private async loadChannel(rawChannelId: string): Promise<InboundWebhookChannel> {
    const id = channelId(rawChannelId);
    const channel = await this.channelResolver.findById(id);
    if (channel === null) throw new NotFoundException("Webhook channel not found");
    if (
      !channel.active ||
      channel.status === "archived" ||
      channel.status === "disabled" ||
      channel.status === "disconnected"
    ) {
      throw new ForbiddenException("Webhook channel is inactive");
    }
    return channel;
  }

  private decryptCredentials(channel: InboundWebhookChannel): Readonly<Record<string, unknown>> {
    if (channel.credentialsCiphertext === null) return {};
    if (this.credentialCipher === null) {
      throw new ServiceUnavailableException("Webhook credential encryption is not configured");
    }
    try {
      return this.credentialCipher.decrypt(channel.credentialsCiphertext);
    } catch (error) {
      if (error instanceof MessagingCredentialCipherError) {
        throw new ServiceUnavailableException("Webhook credentials are unavailable");
      }
      throw error;
    }
  }
}

@Controller("api/v1/webhooks/whatsapp")
export class InboundWebhookController {
  constructor(private readonly service: InboundWebhookService) {}

  @Get(":channelId")
  verify(
    @Param("channelId") channelIdValue: string,
    @Query() query: InboundWebhookVerificationQuery,
    @Res({ passthrough: true }) response: ApiResponse,
  ): Promise<string> {
    return this.service.verify(channelIdValue, query, response);
  }

  @Post(":channelId")
  @HttpCode(200)
  receive(
    @Param("channelId") channelIdValue: string,
    @Req() request: WebhookRequest,
    @Body() body: unknown,
  ): Promise<InboundWebhookResponse> {
    return this.service.receive(channelIdValue, request, body, false);
  }

  @Post("mock/:channelId")
  @HttpCode(200)
  receiveMock(
    @Param("channelId") channelIdValue: string,
    @Req() request: WebhookRequest,
    @Body() body: unknown,
  ): Promise<InboundWebhookResponse> {
    return this.service.receive(channelIdValue, request, body, true);
  }
}
