import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
  applyDecorators,
} from "@nestjs/common";
import {
  AiAuthenticationError,
  AiRateLimitError,
  type AiCompletionResponse,
  type AiMessage,
  type AiProviderType,
  createAiProvider,
} from "@whatsapp-platform/ai-gateway";
import {
  getTenantAiUsageSummary,
  recordAiUsage,
  resolveProviderAndKey,
  type AiGatewayDatabase,
  type TenantAiUsageSummary,
  type TenantContext,
} from "@whatsapp-platform/database";
import type { PermissionKey } from "@whatsapp-platform/rbac";
import { TenantUserSessionGuard } from "./tenant-auth";
import {
  CurrentTenantContext,
  CurrentTenantIdentity,
  TenantContextGuard,
  type TenantSessionIdentity,
} from "./tenant-context";
import { RequireEntitlements, TenantEntitlementGuard } from "./tenant-entitlements";
import { RequirePermissions, TenantPermissionGuard } from "./tenant-rbac";

export const AI_GATEWAY_DATABASE = Symbol("AI_GATEWAY_DATABASE");
export const AI_GATEWAY_SECRET = Symbol("AI_GATEWAY_SECRET");

function aiAuthorized(...permissions: PermissionKey[]): MethodDecorator & ClassDecorator {
  return applyDecorators(
    RequirePermissions(...permissions),
    UseGuards(
      TenantUserSessionGuard,
      TenantContextGuard,
      TenantPermissionGuard,
      TenantEntitlementGuard,
    ),
  );
}

export interface DiscoverModelsQuery {
  readonly providerType?: string | undefined;
  readonly providerConfigId?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly apiKey?: string | undefined;
}

export interface TestCompletionPayload {
  readonly prompt?: string | undefined;
  readonly messages?: Array<{ role: "system" | "user" | "assistant"; content: string }> | undefined;
  readonly model?: string | undefined;
  readonly providerType?: string | undefined;
  readonly providerConfigId?: string | undefined;
  readonly temperature?: number | undefined;
  readonly maxTokens?: number | undefined;
}

@Injectable()
export class AiGatewayService {
  constructor(
    @Inject(AI_GATEWAY_DATABASE) private readonly database: AiGatewayDatabase,
    @Inject(AI_GATEWAY_SECRET) private readonly secret: string | Uint8Array,
  ) {}

  async discoverModels(
    context: TenantContext,
    query: DiscoverModelsQuery,
  ): Promise<{ models: string[] }> {
    if (query.apiKey) {
      const providerType = (query.providerType ?? "openai_compatible") as AiProviderType;
      const provider = createAiProvider(providerType);
      const models = await provider.fetchAvailableModels({
        apiKey: query.apiKey,
        baseUrl: query.baseUrl,
      });
      return { models };
    }

    const resolved = await resolveProviderAndKey(this.database, {
      tenantId: context.tenantId,
      providerConfigId: query.providerConfigId,
      providerType: query.providerType,
      encryptionSecret: this.secret,
    });

    if (!resolved) {
      throw new NotFoundException("No enabled AI provider configuration found");
    }

    const providerType = resolved.config.providerType as AiProviderType;
    const provider = createAiProvider(providerType);
    const credentials = {
      apiKey: resolved.decryptedApiKey ?? "mock-key",
      baseUrl: resolved.config.baseUrl ?? query.baseUrl,
    };

    const models = await provider.fetchAvailableModels(credentials);
    return { models };
  }

  async testCompletion(
    context: TenantContext,
    payload: TestCompletionPayload,
    _identity: TenantSessionIdentity,
  ): Promise<Record<string, unknown>> {
    const messages: readonly AiMessage[] =
      payload.messages && payload.messages.length > 0
        ? payload.messages
        : [{ role: "user", content: payload.prompt || "Hola, prueba de completado AI" }];

    let providerType: AiProviderType = (payload.providerType ?? "mock") as AiProviderType;
    let apiKey = "mock-key";
    let baseUrl: string | undefined;
    let keyId: string | undefined;
    let model = payload.model ?? "mock-gpt-4o";

    if (payload.providerType !== "mock" || payload.providerConfigId) {
      const resolved = await resolveProviderAndKey(this.database, {
        tenantId: context.tenantId,
        providerConfigId: payload.providerConfigId,
        providerType: payload.providerType,
        encryptionSecret: this.secret,
      });

      if (resolved) {
        providerType = resolved.config.providerType as AiProviderType;
        baseUrl = resolved.config.baseUrl ?? undefined;
        apiKey = resolved.decryptedApiKey ?? "mock-key";
        keyId = resolved.selectedKey?.id;
        if (!payload.model) {
          model = providerType === "google_gemini" ? "gemini-1.5-flash" : "gpt-4o";
        }
      }
    }

    const provider = createAiProvider(providerType);
    let response: AiCompletionResponse;

    try {
      response = await provider.generateCompletion(
        {
          model,
          messages,
          temperature: payload.temperature,
          maxTokens: payload.maxTokens,
        },
        { apiKey, baseUrl },
      );
    } catch (err: unknown) {
      const status = err instanceof AiRateLimitError ? "rate_limited" : "error";
      const errorMessage = err instanceof Error ? err.message : String(err);

      await recordAiUsage(this.database, {
        tenantId: context.tenantId,
        providerType,
        modelId: model,
        promptTokens: 0,
        completionTokens: 0,
        costEstimatedUsd: 0,
        latencyMs: 0,
        purpose: "test",
        status,
        errorMessage,
        keyId,
      });

      if (err instanceof AiRateLimitError) {
        throw new HttpException("AI Provider rate limit exceeded", HttpStatus.TOO_MANY_REQUESTS);
      }
      if (err instanceof AiAuthenticationError) {
        throw new UnauthorizedException(errorMessage);
      }
      throw new BadRequestException(errorMessage);
    }

    await recordAiUsage(this.database, {
      tenantId: context.tenantId,
      providerType,
      modelId: response.model,
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      totalTokens: response.usage.totalTokens,
      costEstimatedUsd: 0.00001 * response.usage.totalTokens,
      latencyMs: response.latencyMs,
      purpose: "test",
      status: "success",
      keyId,
    });

    return {
      model: response.model,
      content: response.content,
      finishReason: response.finishReason,
      usage: response.usage,
      latencyMs: response.latencyMs,
      providerType,
    };
  }

  async getUsageSummary(
    context: TenantContext,
    since?: Date | undefined,
  ): Promise<TenantAiUsageSummary> {
    return getTenantAiUsageSummary(this.database, {
      tenantId: context.tenantId,
      since,
    });
  }
}

@Controller("api/v1/ai")
@RequireEntitlements("module.ai")
export class AiGatewayController {
  constructor(private readonly service: AiGatewayService) {}

  @Get("models/discover")
  @aiAuthorized("ai.settings.manage")
  async discoverModels(
    @CurrentTenantContext() context: TenantContext,
    @Query("providerType") providerType?: string,
    @Query("providerConfigId") providerConfigId?: string,
    @Query("baseUrl") baseUrl?: string,
    @Headers("x-provider-api-key") apiKey?: string,
  ): Promise<{ models: string[] }> {
    return this.service.discoverModels(context, {
      providerType,
      providerConfigId,
      baseUrl,
      apiKey,
    });
  }

  @Post("completions/test")
  @HttpCode(200)
  @aiAuthorized("ai.settings.manage")
  async testCompletion(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Body() payload: TestCompletionPayload,
  ): Promise<Record<string, unknown>> {
    return this.service.testCompletion(context, payload, identity);
  }

  @Get("usage/summary")
  @aiAuthorized("ai.settings.manage")
  async getUsageSummary(
    @CurrentTenantContext() context: TenantContext,
    @Query("since") sinceStr?: string,
  ): Promise<TenantAiUsageSummary> {
    const since = sinceStr ? new Date(sinceStr) : undefined;
    return this.service.getUsageSummary(context, since);
  }
}
