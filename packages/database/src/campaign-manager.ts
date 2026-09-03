import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { extractTemplateVariables } from "./template-renderer";
import { createTenantContext } from "./tenant-context";
import { assertTenantOperational } from "./tenant-operational";

export type CampaignDatabase = Pick<
  PrismaClient,
  | "messageTemplate"
  | "campaign"
  | "campaignAudienceMember"
  | "channelAccount"
  | "contact"
  | "tenant"
  | "$transaction"
>;

export class CampaignNotFoundError extends Error {
  readonly code = "CAMPAIGN_NOT_FOUND";
  constructor(campaignId: string) {
    super(`Campaign '${campaignId}' not found for tenant`);
    this.name = "CampaignNotFoundError";
  }
}

export class MessageTemplateNotFoundError extends Error {
  readonly code = "MESSAGE_TEMPLATE_NOT_FOUND";
  constructor(templateId: string) {
    super(`Message template '${templateId}' not found for tenant`);
    this.name = "MessageTemplateNotFoundError";
  }
}

export class CampaignChannelAccountNotFoundError extends Error {
  readonly code = "CHANNEL_ACCOUNT_NOT_FOUND";
  constructor(channelAccountId: string) {
    super(`Channel account '${channelAccountId}' not found for tenant`);
    this.name = "CampaignChannelAccountNotFoundError";
  }
}

export class CampaignInvalidStatusTransitionError extends Error {
  readonly code = "CAMPAIGN_INVALID_STATUS_TRANSITION";
  constructor(campaignId: string, currentStatus: string, targetStatus: string, reason?: string) {
    super(
      `Cannot transition campaign '${campaignId}' from status '${currentStatus}' to '${targetStatus}'${reason ? `: ${reason}` : ""}`,
    );
    this.name = "CampaignInvalidStatusTransitionError";
  }
}

export class CampaignEmptyAudienceError extends Error {
  readonly code = "CAMPAIGN_EMPTY_AUDIENCE";
  constructor(campaignId: string) {
    super(`Campaign '${campaignId}' has no audience members (totalRecipients is 0)`);
    this.name = "CampaignEmptyAudienceError";
  }
}

export class CampaignNotRunningError extends Error {
  readonly code = "CAMPAIGN_NOT_RUNNING";
  constructor(campaignId: string, currentStatus: string) {
    super(`Campaign '${campaignId}' is not running (current status: '${currentStatus}')`);
    this.name = "CampaignNotRunningError";
  }
}

export interface CreateMessageTemplateInput {
  readonly tenantId: string;
  readonly name: string;
  readonly category?: string | undefined;
  readonly content: string;
  readonly variables?: string[] | undefined;
  readonly mediaUrl?: string | null | undefined;
  readonly mediaType?: string | null | undefined;
}

export interface ListMessageTemplatesInput {
  readonly tenantId: string;
  readonly category?: string | undefined;
}

export interface CreateCampaignInput {
  readonly tenantId: string;
  readonly channelAccountId: string;
  readonly templateId?: string | null | undefined;
  readonly name: string;
  readonly messageContent?: string | undefined;
  readonly rateLimitPerMinute?: number | undefined;
  readonly audienceFilter?: Record<string, unknown> | undefined;
  readonly scheduledAt?: Date | null | undefined;
}

export interface SegmentAudienceInput {
  readonly tenantId: string;
  readonly campaignId: string;
}

export interface ListCampaignsInput {
  readonly tenantId: string;
  readonly status?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export async function createMessageTemplate(
  database: CampaignDatabase,
  input: CreateMessageTemplateInput,
) {
  await assertTenantOperational(createTenantContext(input.tenantId), database);

  const variables =
    input.variables && input.variables.length > 0
      ? input.variables
      : extractTemplateVariables(input.content);

  return database.messageTemplate.create({
    data: {
      tenantId: input.tenantId,
      name: input.name.trim(),
      category: (input.category || "MARKETING").toUpperCase(),
      content: input.content.trim(),
      variables: variables as unknown as Prisma.InputJsonValue,
      mediaUrl: input.mediaUrl ?? null,
      mediaType: input.mediaType ?? null,
    },
  });
}

export async function listMessageTemplates(
  database: CampaignDatabase,
  input: ListMessageTemplatesInput,
) {
  const where: Prisma.MessageTemplateWhereInput = {
    tenantId: input.tenantId,
    ...(input.category ? { category: input.category.toUpperCase() } : {}),
  };

  return database.messageTemplate.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
}

export async function createCampaign(database: CampaignDatabase, input: CreateCampaignInput) {
  await assertTenantOperational(createTenantContext(input.tenantId), database);

  // Validate channel account ownership
  const channel = await database.channelAccount.findUnique({
    where: {
      tenantId_id: {
        tenantId: input.tenantId,
        id: input.channelAccountId,
      },
    },
  });

  if (!channel) {
    throw new CampaignChannelAccountNotFoundError(input.channelAccountId);
  }

  // Validate template ownership if specified
  let resolvedContent = input.messageContent?.trim() || "";
  if (input.templateId) {
    const template = await database.messageTemplate.findUnique({
      where: {
        tenantId_id: {
          tenantId: input.tenantId,
          id: input.templateId,
        },
      },
    });

    if (!template) {
      throw new MessageTemplateNotFoundError(input.templateId);
    }

    if (!resolvedContent) {
      resolvedContent = template.content;
    }
  }

  if (!resolvedContent) {
    throw new Error("Campaign messageContent cannot be empty");
  }

  return database.campaign.create({
    data: {
      tenantId: input.tenantId,
      channelAccountId: input.channelAccountId,
      templateId: input.templateId ?? null,
      name: input.name.trim(),
      status: "DRAFT",
      messageContent: resolvedContent,
      rateLimitPerMinute: input.rateLimitPerMinute ?? 30,
      audienceFilter: (input.audienceFilter ?? {}) as Prisma.InputJsonValue,
      scheduledAt: input.scheduledAt ?? null,
    },
  });
}

export async function segmentAndPopulateAudience(
  database: CampaignDatabase,
  input: SegmentAudienceInput,
): Promise<{ totalAdded: number; totalRecipients: number }> {
  await assertTenantOperational(createTenantContext(input.tenantId), database);

  const campaign = await database.campaign.findUnique({
    where: {
      tenantId_id: {
        tenantId: input.tenantId,
        id: input.campaignId,
      },
    },
  });

  if (!campaign) {
    throw new CampaignNotFoundError(input.campaignId);
  }

  const filter =
    (campaign.audienceFilter as { tags?: string[]; organizationUnitId?: string }) ?? {};

  const contactWhere: Prisma.ContactWhereInput = {
    tenantId: input.tenantId,
    status: "ACTIVE",
  };

  if (filter.tags && Array.isArray(filter.tags) && filter.tags.length > 0) {
    contactWhere.tags = { hasSome: filter.tags };
  }

  const matchingContacts = await database.contact.findMany({
    where: contactWhere,
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      customAttributes: true,
    },
  });

  if (matchingContacts.length === 0) {
    return { totalAdded: 0, totalRecipients: campaign.totalRecipients };
  }

  const membersData: Prisma.CampaignAudienceMemberCreateManyInput[] = matchingContacts.map(
    (contact) => ({
      tenantId: input.tenantId,
      campaignId: input.campaignId,
      contactId: contact.id,
      status: "PENDING",
      variables: {
        nombre: contact.name,
        telefono: contact.phoneNumber,
        ...((contact.customAttributes as Record<string, unknown>) ?? {}),
      } as unknown as Prisma.InputJsonValue,
    }),
  );

  const createResult = await database.campaignAudienceMember.createMany({
    data: membersData,
    skipDuplicates: true,
  });

  const totalRecipients = await database.campaignAudienceMember.count({
    where: { campaignId: input.campaignId },
  });

  await database.campaign.update({
    where: { tenantId_id: { tenantId: input.tenantId, id: input.campaignId } },
    data: { totalRecipients },
  });

  return {
    totalAdded: createResult.count,
    totalRecipients,
  };
}

export async function getCampaignDetail(
  database: CampaignDatabase,
  input: { tenantId: string; campaignId: string },
) {
  const campaign = await database.campaign.findUnique({
    where: {
      tenantId_id: {
        tenantId: input.tenantId,
        id: input.campaignId,
      },
    },
    include: {
      template: {
        select: {
          id: true,
          name: true,
          category: true,
          content: true,
          variables: true,
        },
      },
      channelAccount: {
        select: {
          id: true,
          displayName: true,
          phoneNumber: true,
          status: true,
        },
      },
      _count: {
        select: {
          audienceMembers: true,
        },
      },
    },
  });

  if (!campaign) {
    throw new CampaignNotFoundError(input.campaignId);
  }

  return campaign;
}

export async function listCampaigns(database: CampaignDatabase, input: ListCampaignsInput) {
  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;

  const where: Prisma.CampaignWhereInput = {
    tenantId: input.tenantId,
    ...(input.status ? { status: input.status } : {}),
  };

  const [campaigns, total] = await Promise.all([
    database.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        template: {
          select: { id: true, name: true },
        },
        channelAccount: {
          select: { id: true, displayName: true, phoneNumber: true },
        },
      },
    }),
    database.campaign.count({ where }),
  ]);

  return { campaigns, total, limit, offset };
}

export async function startCampaign(
  database: CampaignDatabase,
  input: { tenantId: string; campaignId: string },
) {
  await assertTenantOperational(createTenantContext(input.tenantId), database);

  const campaign = await database.campaign.findUnique({
    where: {
      tenantId_id: {
        tenantId: input.tenantId,
        id: input.campaignId,
      },
    },
  });

  if (!campaign) {
    throw new CampaignNotFoundError(input.campaignId);
  }

  if (campaign.status !== "DRAFT" && campaign.status !== "PAUSED") {
    throw new CampaignInvalidStatusTransitionError(
      input.campaignId,
      campaign.status,
      "RUNNING",
      "Campaign must be in DRAFT or PAUSED state to start",
    );
  }

  if (campaign.totalRecipients <= 0) {
    throw new CampaignEmptyAudienceError(input.campaignId);
  }

  return database.campaign.update({
    where: {
      tenantId_id: {
        tenantId: input.tenantId,
        id: input.campaignId,
      },
    },
    data: {
      status: "RUNNING",
      startedAt: campaign.startedAt ?? new Date(),
    },
  });
}

export async function pauseCampaign(
  database: CampaignDatabase,
  input: { tenantId: string; campaignId: string },
) {
  await assertTenantOperational(createTenantContext(input.tenantId), database);

  const campaign = await database.campaign.findUnique({
    where: {
      tenantId_id: {
        tenantId: input.tenantId,
        id: input.campaignId,
      },
    },
  });

  if (!campaign) {
    throw new CampaignNotFoundError(input.campaignId);
  }

  if (campaign.status !== "RUNNING") {
    throw new CampaignInvalidStatusTransitionError(
      input.campaignId,
      campaign.status,
      "PAUSED",
      "Only RUNNING campaigns can be paused",
    );
  }

  return database.campaign.update({
    where: {
      tenantId_id: {
        tenantId: input.tenantId,
        id: input.campaignId,
      },
    },
    data: {
      status: "PAUSED",
    },
  });
}

export async function cancelCampaign(
  database: CampaignDatabase,
  input: { tenantId: string; campaignId: string },
) {
  await assertTenantOperational(createTenantContext(input.tenantId), database);

  const campaign = await database.campaign.findUnique({
    where: {
      tenantId_id: {
        tenantId: input.tenantId,
        id: input.campaignId,
      },
    },
  });

  if (!campaign) {
    throw new CampaignNotFoundError(input.campaignId);
  }

  if (campaign.status === "COMPLETED" || campaign.status === "CANCELLED") {
    throw new CampaignInvalidStatusTransitionError(
      input.campaignId,
      campaign.status,
      "CANCELLED",
      "Cannot cancel an already completed or cancelled campaign",
    );
  }

  return database.campaign.update({
    where: {
      tenantId_id: {
        tenantId: input.tenantId,
        id: input.campaignId,
      },
    },
    data: {
      status: "CANCELLED",
    },
  });
}
