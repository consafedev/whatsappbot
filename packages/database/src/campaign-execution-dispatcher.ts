import {
  type CampaignDatabase,
  CampaignNotFoundError,
  CampaignNotRunningError,
} from "./campaign-manager";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { renderTemplate } from "./template-renderer";
import { createTenantContext } from "./tenant-context";
import { assertTenantOperational } from "./tenant-operational";

export type CampaignExecutionDatabase = CampaignDatabase & Pick<PrismaClient, "outboundMessage">;

export interface DispatchCampaignBatchInput {
  readonly tenantId: string;
  readonly campaignId: string;
  readonly batchSize?: number | undefined;
}

export interface DispatchCampaignBatchResult {
  readonly processedCount: number;
  readonly remainingPending: number;
  readonly isCompleted: boolean;
}

export async function dispatchCampaignBatch(
  database: CampaignExecutionDatabase,
  input: DispatchCampaignBatchInput,
): Promise<DispatchCampaignBatchResult> {
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
    throw new CampaignNotRunningError(input.campaignId, campaign.status);
  }

  const batchLimit =
    input.batchSize && input.batchSize > 0
      ? input.batchSize
      : campaign.rateLimitPerMinute > 0
        ? campaign.rateLimitPerMinute
        : 30;

  const pendingMembers = await database.campaignAudienceMember.findMany({
    where: {
      tenantId: input.tenantId,
      campaignId: input.campaignId,
      status: "PENDING",
    },
    take: batchLimit,
    include: {
      contact: {
        select: {
          id: true,
          phoneNumber: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (pendingMembers.length === 0) {
    const remainingPending = await database.campaignAudienceMember.count({
      where: {
        tenantId: input.tenantId,
        campaignId: input.campaignId,
        status: "PENDING",
      },
    });

    if (remainingPending === 0) {
      await database.campaign.update({
        where: {
          tenantId_id: {
            tenantId: input.tenantId,
            id: input.campaignId,
          },
        },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });
      return { processedCount: 0, remainingPending: 0, isCompleted: true };
    }

    return { processedCount: 0, remainingPending, isCompleted: false };
  }

  let processedCount = 0;
  const now = new Date();

  for (const member of pendingMembers) {
    const renderedText = renderTemplate(
      campaign.messageContent,
      (member.variables as Record<string, string | number | null | undefined>) ?? {},
    );

    const idempotencyKey = `campaign:${campaign.id}:member:${member.id}`;

    await database.$transaction(async (tx) => {
      await tx.outboundMessage.create({
        data: {
          tenantId: input.tenantId,
          channelAccountId: campaign.channelAccountId,
          idempotencyKey,
          recipientPhone: member.contact.phoneNumber,
          messageType: "text",
          content: {
            text: renderedText,
            metadata: {
              campaignId: campaign.id,
              campaignAudienceMemberId: member.id,
              source: "CAMPAIGN",
            },
          } as unknown as Prisma.InputJsonValue,
          status: "PENDING",
        },
      });

      await tx.campaignAudienceMember.update({
        where: {
          tenantId_id: {
            tenantId: input.tenantId,
            id: member.id,
          },
        },
        data: {
          status: "SENT",
          sentAt: now,
        },
      });
    });

    processedCount++;
  }

  await database.campaign.update({
    where: {
      tenantId_id: {
        tenantId: input.tenantId,
        id: input.campaignId,
      },
    },
    data: {
      sentCount: { increment: processedCount },
    },
  });

  const remainingPending = await database.campaignAudienceMember.count({
    where: {
      tenantId: input.tenantId,
      campaignId: input.campaignId,
      status: "PENDING",
    },
  });

  const isCompleted = remainingPending === 0;

  if (isCompleted) {
    await database.campaign.update({
      where: {
        tenantId_id: {
          tenantId: input.tenantId,
          id: input.campaignId,
        },
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
  }

  return {
    processedCount,
    remainingPending,
    isCompleted,
  };
}
