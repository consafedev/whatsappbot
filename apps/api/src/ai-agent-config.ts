import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Put,
  UseGuards,
  applyDecorators,
} from "@nestjs/common";
import {
  AI_AGENT_AUTOMATION_MODES,
  getTenantAiAgentConfig,
  upsertTenantAiAgentConfig,
  type AiAgentAutomationMode,
  type AiGatewayDatabase,
  type TenantAiAgentConfigData,
  type TenantContext,
} from "@whatsapp-platform/database";
import type { PermissionKey } from "@whatsapp-platform/rbac";
import { AI_GATEWAY_DATABASE } from "./ai-gateway";
import { TenantUserSessionGuard } from "./tenant-auth";
import { CurrentTenantContext, TenantContextGuard } from "./tenant-context";
import { RequireEntitlements, TenantEntitlementGuard } from "./tenant-entitlements";
import { RequirePermissions, TenantPermissionGuard } from "./tenant-rbac";

function aiAgentAuthorized(...permissions: PermissionKey[]): MethodDecorator & ClassDecorator {
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

export interface UpdateAiAgentConfigDto {
  readonly automationMode?: "RULES_ONLY" | "HYBRID_RULES_AI" | "FULL_AI" | undefined;
  readonly systemDirectives?: string | null | undefined;
  readonly virtualAliasKey?: string | undefined;
  readonly minConfidenceScore?: number | undefined;
  readonly humanHandoffKeywords?: string[] | undefined;
  readonly outOfHoursReply?: string | null | undefined;
  readonly isEnabled?: boolean | undefined;
}

@Injectable()
export class AiAgentConfigService {
  constructor(@Inject(AI_GATEWAY_DATABASE) private readonly db: AiGatewayDatabase) {}

  async getConfig(tenant: TenantContext): Promise<TenantAiAgentConfigData> {
    return getTenantAiAgentConfig(this.db, tenant.tenantId);
  }

  async updateConfig(
    tenant: TenantContext,
    dto: UpdateAiAgentConfigDto,
  ): Promise<TenantAiAgentConfigData> {
    if (
      dto.automationMode !== undefined &&
      !AI_AGENT_AUTOMATION_MODES.includes(dto.automationMode as AiAgentAutomationMode)
    ) {
      throw new BadRequestException(`Invalid automationMode: ${dto.automationMode}`);
    }

    if (
      dto.minConfidenceScore !== undefined &&
      (typeof dto.minConfidenceScore !== "number" ||
        dto.minConfidenceScore < 0 ||
        dto.minConfidenceScore > 1)
    ) {
      throw new BadRequestException("minConfidenceScore must be a number between 0.0 and 1.0");
    }

    return upsertTenantAiAgentConfig(this.db, {
      tenantId: tenant.tenantId,
      automationMode: dto.automationMode,
      systemDirectives: dto.systemDirectives,
      virtualAliasKey: dto.virtualAliasKey,
      minConfidenceScore: dto.minConfidenceScore,
      humanHandoffKeywords: dto.humanHandoffKeywords,
      outOfHoursReply: dto.outOfHoursReply,
      isEnabled: dto.isEnabled,
    });
  }
}

@Controller("api/v1/ai/agent")
@RequireEntitlements("module.ai")
export class AiAgentConfigController {
  constructor(private readonly service: AiAgentConfigService) {}

  @Get("config")
  @aiAgentAuthorized("ai.settings.manage")
  async getConfig(
    @CurrentTenantContext() tenant: TenantContext,
  ): Promise<{ success: true; data: TenantAiAgentConfigData }> {
    const data = await this.service.getConfig(tenant);
    return { success: true, data };
  }

  @Put("config")
  @aiAgentAuthorized("ai.settings.manage")
  @HttpCode(HttpStatus.OK)
  async updateConfig(
    @CurrentTenantContext() tenant: TenantContext,
    @Body() dto: UpdateAiAgentConfigDto,
  ): Promise<{ success: true; data: TenantAiAgentConfigData }> {
    const data = await this.service.updateConfig(tenant, dto);
    return { success: true, data };
  }
}
