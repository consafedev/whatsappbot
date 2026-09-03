import {
  applyDecorators,
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  CampaignChannelAccountNotFoundError,
  CampaignEmptyAudienceError,
  type CampaignExecutionDatabase,
  CampaignInvalidStatusTransitionError,
  CampaignNotFoundError,
  CampaignNotRunningError,
  cancelCampaign,
  createCampaign,
  createMessageTemplate,
  dispatchCampaignBatch,
  getCampaignDetail,
  listCampaigns,
  listMessageTemplates,
  MessageTemplateNotFoundError,
  pauseCampaign,
  segmentAndPopulateAudience,
  startCampaign,
  type TenantContext,
} from "@whatsapp-platform/database";
import type { PermissionKey } from "@whatsapp-platform/rbac";
import { TenantUserSessionGuard } from "./tenant-auth";
import { CurrentTenantContext, TenantContextGuard } from "./tenant-context";
import { RequireEntitlements, TenantEntitlementGuard } from "./tenant-entitlements";
import { RequirePermissions, TenantPermissionGuard } from "./tenant-rbac";

export const CAMPAIGNS_DATABASE = Symbol("CAMPAIGNS_DATABASE");

function campaignsAuthorized(...permissions: PermissionKey[]): MethodDecorator & ClassDecorator {
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

export interface CreateMessageTemplateDto {
  readonly name: string;
  readonly category?: string | undefined;
  readonly content: string;
  readonly variables?: string[] | undefined;
  readonly mediaUrl?: string | null | undefined;
  readonly mediaType?: string | null | undefined;
}

export interface ListMessageTemplatesQuery {
  readonly category?: string | undefined;
}

export interface CreateCampaignDto {
  readonly channelAccountId: string;
  readonly templateId?: string | null | undefined;
  readonly name: string;
  readonly messageContent?: string | undefined;
  readonly rateLimitPerMinute?: number | undefined;
  readonly audienceFilter?: Record<string, unknown> | undefined;
  readonly scheduledAt?: string | null | undefined;
}

export interface ListCampaignsQuery {
  readonly status?: string | undefined;
  readonly limit?: string | undefined;
  readonly offset?: string | undefined;
}

@Injectable()
export class CampaignsService {
  constructor(@Inject(CAMPAIGNS_DATABASE) private readonly database: CampaignExecutionDatabase) {}

  async createTemplate(context: TenantContext, dto: CreateMessageTemplateDto) {
    if (!dto.name?.trim()) {
      throw new BadRequestException("Template name is required");
    }
    if (!dto.content?.trim()) {
      throw new BadRequestException("Template content is required");
    }
    return createMessageTemplate(this.database, {
      tenantId: context.tenantId,
      name: dto.name,
      category: dto.category,
      content: dto.content,
      variables: dto.variables,
      mediaUrl: dto.mediaUrl,
      mediaType: dto.mediaType,
    });
  }

  async listTemplates(context: TenantContext, query: ListMessageTemplatesQuery) {
    return listMessageTemplates(this.database, {
      tenantId: context.tenantId,
      category: query.category,
    });
  }

  async createCampaign(context: TenantContext, dto: CreateCampaignDto) {
    if (!dto.name?.trim()) {
      throw new BadRequestException("Campaign name is required");
    }
    if (!dto.channelAccountId?.trim()) {
      throw new BadRequestException("Channel account ID is required");
    }
    try {
      return await createCampaign(this.database, {
        tenantId: context.tenantId,
        channelAccountId: dto.channelAccountId,
        templateId: dto.templateId,
        name: dto.name,
        messageContent: dto.messageContent,
        rateLimitPerMinute: dto.rateLimitPerMinute,
        audienceFilter: dto.audienceFilter,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      });
    } catch (err: unknown) {
      if (
        err instanceof CampaignChannelAccountNotFoundError ||
        err instanceof MessageTemplateNotFoundError
      ) {
        throw new NotFoundException(err.message);
      }
      if (err instanceof Error) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  async populateAudience(context: TenantContext, campaignId: string) {
    try {
      return await segmentAndPopulateAudience(this.database, {
        tenantId: context.tenantId,
        campaignId,
      });
    } catch (err: unknown) {
      if (err instanceof CampaignNotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }

  async getCampaign(context: TenantContext, campaignId: string) {
    try {
      return await getCampaignDetail(this.database, {
        tenantId: context.tenantId,
        campaignId,
      });
    } catch (err: unknown) {
      if (err instanceof CampaignNotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }

  async listCampaigns(context: TenantContext, query: ListCampaignsQuery) {
    const limit = query.limit ? Number.parseInt(query.limit, 10) : 20;
    const offset = query.offset ? Number.parseInt(query.offset, 10) : 0;
    return listCampaigns(this.database, {
      tenantId: context.tenantId,
      status: query.status,
      limit,
      offset,
    });
  }

  async startCampaign(context: TenantContext, campaignId: string) {
    try {
      return await startCampaign(this.database, {
        tenantId: context.tenantId,
        campaignId,
      });
    } catch (err: unknown) {
      if (err instanceof CampaignNotFoundError) {
        throw new NotFoundException(err.message);
      }
      if (
        err instanceof CampaignInvalidStatusTransitionError ||
        err instanceof CampaignEmptyAudienceError
      ) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  async pauseCampaign(context: TenantContext, campaignId: string) {
    try {
      return await pauseCampaign(this.database, {
        tenantId: context.tenantId,
        campaignId,
      });
    } catch (err: unknown) {
      if (err instanceof CampaignNotFoundError) {
        throw new NotFoundException(err.message);
      }
      if (err instanceof CampaignInvalidStatusTransitionError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  async cancelCampaign(context: TenantContext, campaignId: string) {
    try {
      return await cancelCampaign(this.database, {
        tenantId: context.tenantId,
        campaignId,
      });
    } catch (err: unknown) {
      if (err instanceof CampaignNotFoundError) {
        throw new NotFoundException(err.message);
      }
      if (err instanceof CampaignInvalidStatusTransitionError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  async dispatchBatch(context: TenantContext, campaignId: string, batchSize?: number) {
    try {
      return await dispatchCampaignBatch(this.database, {
        tenantId: context.tenantId,
        campaignId,
        batchSize,
      });
    } catch (err: unknown) {
      if (err instanceof CampaignNotFoundError) {
        throw new NotFoundException(err.message);
      }
      if (err instanceof CampaignNotRunningError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }
}

@Controller("api/v1/campaigns")
@RequireEntitlements("module.campaigns")
export class CampaignsController {
  constructor(private readonly service: CampaignsService) {}

  @Post("templates")
  @HttpCode(HttpStatus.CREATED)
  @campaignsAuthorized("campaigns.manage")
  async createTemplate(
    @CurrentTenantContext() context: TenantContext,
    @Body() dto: CreateMessageTemplateDto,
  ) {
    const template = await this.service.createTemplate(context, dto);
    return { success: true, data: template };
  }

  @Get("templates")
  @campaignsAuthorized("campaigns.read")
  async listTemplates(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: ListMessageTemplatesQuery,
  ) {
    const templates = await this.service.listTemplates(context, query);
    return { success: true, data: templates };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @campaignsAuthorized("campaigns.manage")
  async createCampaign(
    @CurrentTenantContext() context: TenantContext,
    @Body() dto: CreateCampaignDto,
  ) {
    const campaign = await this.service.createCampaign(context, dto);
    return { success: true, data: campaign };
  }

  @Post(":id/audience/populate")
  @HttpCode(HttpStatus.OK)
  @campaignsAuthorized("campaigns.manage")
  async populateAudience(
    @CurrentTenantContext() context: TenantContext,
    @Param("id") campaignId: string,
  ) {
    const result = await this.service.populateAudience(context, campaignId);
    return { success: true, data: result };
  }

  @Get()
  @campaignsAuthorized("campaigns.read")
  async listCampaigns(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: ListCampaignsQuery,
  ) {
    const result = await this.service.listCampaigns(context, query);
    return { success: true, data: result };
  }

  @Get(":id")
  @campaignsAuthorized("campaigns.read")
  async getCampaign(
    @CurrentTenantContext() context: TenantContext,
    @Param("id") campaignId: string,
  ) {
    const campaign = await this.service.getCampaign(context, campaignId);
    return { success: true, data: campaign };
  }

  @Post(":id/start")
  @HttpCode(HttpStatus.OK)
  @campaignsAuthorized("campaigns.manage")
  async startCampaign(
    @CurrentTenantContext() context: TenantContext,
    @Param("id") campaignId: string,
  ) {
    const campaign = await this.service.startCampaign(context, campaignId);
    return { success: true, data: campaign };
  }

  @Post(":id/pause")
  @HttpCode(HttpStatus.OK)
  @campaignsAuthorized("campaigns.manage")
  async pauseCampaign(
    @CurrentTenantContext() context: TenantContext,
    @Param("id") campaignId: string,
  ) {
    const campaign = await this.service.pauseCampaign(context, campaignId);
    return { success: true, data: campaign };
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  @campaignsAuthorized("campaigns.manage")
  async cancelCampaign(
    @CurrentTenantContext() context: TenantContext,
    @Param("id") campaignId: string,
  ) {
    const campaign = await this.service.cancelCampaign(context, campaignId);
    return { success: true, data: campaign };
  }

  @Post(":id/dispatch-batch")
  @HttpCode(HttpStatus.OK)
  @campaignsAuthorized("campaigns.manage")
  async dispatchBatch(
    @CurrentTenantContext() context: TenantContext,
    @Param("id") campaignId: string,
    @Body() body?: { batchSize?: number },
  ) {
    const result = await this.service.dispatchBatch(context, campaignId, body?.batchSize);
    return { success: true, data: result };
  }
}
