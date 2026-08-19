import { randomUUID } from "node:crypto";
import {
  applyDecorators,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type {
  OutboundMessageContent,
  OutboundMessageManager,
  OutboundMessageRecord,
  TenantContext,
} from "@whatsapp-platform/database";
import {
  OutboundMessageChannelInactiveError,
  OutboundMessageChannelNotFoundError,
  OutboundMessageStateError,
} from "@whatsapp-platform/database";
import {
  CurrentTenantContext,
  CurrentTenantIdentity,
  type TenantAuthenticationRequest,
  type TenantSessionIdentity,
} from "./tenant-context";
import { RequireEntitlements, TenantEntitlementGuard } from "./tenant-entitlements";
import { TenantAuthorized } from "./tenant-rbac";

export const OUTBOUND_MESSAGE_MANAGER = Symbol("OUTBOUND_MESSAGE_MANAGER");

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TEXT_LENGTH = 4_096;
const MAX_CAPTION_LENGTH = 1_024;
const MAX_MEDIA_URL_LENGTH = 2_048;

type OutboundMessageRequest = TenantAuthenticationRequest;

type ParsedMessageContent = Readonly<{
  content: OutboundMessageContent;
  messageType: "text" | "media";
}>;

type ParsedOutboundMessage = ParsedMessageContent &
  Readonly<{
    recipientPhone: string;
  }>;

function header(request: OutboundMessageRequest, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function plainObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Invalid outbound message request");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new BadRequestException("Invalid outbound message request");
  }
}

function nonEmptyString(value: unknown, max: number, message: string): string {
  if (typeof value !== "string") throw new BadRequestException(message);
  const result = value.trim();
  if (result.length === 0 || result.length > max) throw new BadRequestException(message);
  return result;
}

function recipientPhone(value: unknown): string {
  const input = nonEmptyString(value, 30, "Invalid recipient phone").replace(/[\s().-]/g, "");
  if (!/^\+?[1-9][0-9]{6,14}$/.test(input)) {
    throw new BadRequestException("Invalid recipient phone");
  }
  return input.startsWith("+") ? input : `+${input}`;
}

function mediaUrl(value: unknown): string {
  const input = nonEmptyString(value, MAX_MEDIA_URL_LENGTH, "Invalid media URL");
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new BadRequestException("Invalid media URL");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
  ) {
    throw new BadRequestException("Invalid media URL");
  }
  return parsed.toString();
}

function parseContent(messageType: unknown, value: unknown): ParsedMessageContent {
  if (messageType !== "text" && messageType !== "media") {
    throw new BadRequestException("Invalid message type");
  }
  const content = plainObject(value);
  if (messageType === "text") {
    exactKeys(content, ["text"]);
    return {
      content: { text: nonEmptyString(content.text, MAX_TEXT_LENGTH, "Invalid message text") },
      messageType,
    };
  }
  exactKeys(content, ["mediaUrl", "mediaType", "caption"]);
  const caption =
    content.caption === undefined
      ? undefined
      : nonEmptyString(content.caption, MAX_CAPTION_LENGTH, "Invalid media caption");
  const mediaType =
    content.mediaType === undefined
      ? undefined
      : nonEmptyString(content.mediaType, 100, "Invalid media type");
  return {
    content: {
      ...(caption === undefined ? {} : { caption }),
      ...(mediaType === undefined ? {} : { mediaType }),
      mediaUrl: mediaUrl(content.mediaUrl),
    },
    messageType,
  };
}

function parseBody(body: unknown): ParsedOutboundMessage {
  const value = plainObject(body);
  exactKeys(value, ["recipientPhone", "messageType", "content"]);
  const parsed = parseContent(value.messageType, value.content);
  return { ...parsed, recipientPhone: recipientPhone(value.recipientPhone) };
}

function channelId(value: string): string {
  if (!UUID_V7_PATTERN.test(value)) throw new NotFoundException("Channel not found");
  return value.toLowerCase();
}

function messageId(value: string): string {
  if (!UUID_V7_PATTERN.test(value)) throw new NotFoundException("Outbound message not found");
  return value.toLowerCase();
}

function idempotencyKey(request: OutboundMessageRequest): string {
  const value = header(request, "idempotency-key") ?? randomUUID();
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(value)) {
    throw new BadRequestException("Invalid idempotency key");
  }
  return value;
}

function publicResponse(message: OutboundMessageRecord) {
  return {
    createdAt: message.createdAt.toISOString(),
    failedAt: message.failedAt?.toISOString() ?? null,
    messageId: message.id,
    providerMessageId: message.providerMessageId,
    retryCount: message.retryCount,
    scheduledAt: message.scheduledAt?.toISOString() ?? null,
    sentAt: message.sentAt?.toISOString() ?? null,
    status: message.status,
    success: true as const,
    updatedAt: message.updatedAt.toISOString(),
  };
}

function apiError(error: unknown): never {
  if (error instanceof OutboundMessageChannelNotFoundError) {
    throw new NotFoundException("Channel not found");
  }
  if (error instanceof OutboundMessageChannelInactiveError) {
    throw new ConflictException({
      code: "CHANNEL_INACTIVE",
      error: "Conflict",
      message: "Channel is inactive",
      statusCode: 409,
    });
  }
  if (error instanceof OutboundMessageStateError) {
    throw new ConflictException("Outbound message cannot be created");
  }
  throw error;
}

function outboundAuthorized(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    TenantAuthorized("channels.manage"),
    RequireEntitlements("module.messaging.basic"),
    UseGuards(TenantEntitlementGuard),
  );
}

@Injectable()
export class OutboundMessagesService {
  constructor(@Inject(OUTBOUND_MESSAGE_MANAGER) private readonly manager: OutboundMessageManager) {}

  async enqueue(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: OutboundMessageRequest,
    channelAccountId: string,
    body: unknown,
  ) {
    const parsed = parseBody(body);
    try {
      const message = await this.manager.enqueueOutboundMessage(
        context,
        channelId(channelAccountId),
        {
          actorUserId: identity.userId,
          content: parsed.content,
          idempotencyKey: idempotencyKey(request),
          messageType: parsed.messageType,
          recipientPhone: parsed.recipientPhone,
        },
      );
      return {
        messageId: message.id,
        status: message.status,
        success: true as const,
      };
    } catch (error) {
      return apiError(error);
    }
  }

  async get(context: TenantContext, channelAccountId: string, messageIdParam: string) {
    const channel = channelId(channelAccountId);
    const message = await this.manager.findById(context, messageId(messageIdParam));
    if (message === null || message.channelAccountId !== channel) {
      throw new NotFoundException("Outbound message not found");
    }
    return publicResponse(message);
  }
}

@Controller("api/v1/channels/:channelId/messages")
export class OutboundMessagesController {
  constructor(private readonly service: OutboundMessagesService) {}

  @Post()
  @HttpCode(202)
  @outboundAuthorized()
  enqueue(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: OutboundMessageRequest,
    @Param("channelId") channelAccountId: string,
    @Body() body: unknown,
  ) {
    return this.service.enqueue(context, identity, request, channelAccountId, body);
  }

  @Get(":messageId")
  @outboundAuthorized()
  get(
    @CurrentTenantContext() context: TenantContext,
    @Param("channelId") channelAccountId: string,
    @Param("messageId") messageId: string,
  ) {
    return this.service.get(context, channelAccountId, messageId);
  }
}
