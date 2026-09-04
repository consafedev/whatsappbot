import { CampaignNotFoundError } from "./campaign-manager";
import type { PrismaClient } from "./generated/prisma/client";
import { createTenantContext } from "./tenant-context";
import { assertTenantOperational } from "./tenant-operational";

export type CampaignDeliveryReconcilerDatabase = Pick<
  PrismaClient,
  "campaign" | "campaignAudienceMember" | "outboundMessage" | "tenant" | "$transaction"
>;

export class CampaignAudienceMemberNotFoundError extends Error {
  readonly code = "CAMPAIGN_AUDIENCE_MEMBER_NOT_FOUND";
  constructor(memberId: string) {
    super(`Campaign audience member '${memberId}' not found for tenant and campaign`);
    this.name = "CampaignAudienceMemberNotFoundError";
  }
}

export type CampaignDeliveryStatus = "DELIVERED" | "READ" | "FAILED";

export interface ReconcileCampaignDeliveryInput {
  readonly tenantId: string;
  readonly campaignId: string;
  readonly campaignAudienceMemberId: string;
  readonly status: CampaignDeliveryStatus;
  readonly timestamp?: Date | undefined;
  readonly errorMessage?: string | undefined;
}

export interface ReconcileCampaignDeliveryResult {
  readonly memberId: string;
  readonly previousStatus: string;
  readonly currentStatus: string;
  readonly updated: boolean;
}

export async function reconcileCampaignAudienceDeliveryStatus(
  database: CampaignDeliveryReconcilerDatabase,
  input: ReconcileCampaignDeliveryInput,
): Promise<ReconcileCampaignDeliveryResult> {
  await assertTenantOperational(createTenantContext(input.tenantId), database);

  return database.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUnique({
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

    const member = await tx.campaignAudienceMember.findUnique({
      where: {
        tenantId_id: {
          tenantId: input.tenantId,
          id: input.campaignAudienceMemberId,
        },
      },
    });

    if (!member || member.campaignId !== input.campaignId) {
      throw new CampaignAudienceMemberNotFoundError(input.campaignAudienceMemberId);
    }

    const currentStatus = member.status;
    const targetStatus = input.status;
    const timestamp = input.timestamp ?? new Date();

    // Monotonicity: READ is terminal — do not degrade
    if (currentStatus === "READ") {
      return {
        memberId: member.id,
        previousStatus: currentStatus,
        currentStatus: "READ",
        updated: false,
      };
    }

    // Monotonicity: FAILED is terminal — do not upgrade to DELIVERED/READ
    if (currentStatus === "FAILED") {
      return {
        memberId: member.id,
        previousStatus: currentStatus,
        currentStatus: "FAILED",
        updated: false,
      };
    }

    // If target is DELIVERED
    if (targetStatus === "DELIVERED") {
      if (currentStatus === "DELIVERED") {
        return {
          memberId: member.id,
          previousStatus: currentStatus,
          currentStatus: "DELIVERED",
          updated: false,
        };
      }

      await tx.campaignAudienceMember.update({
        where: {
          tenantId_id: {
            tenantId: input.tenantId,
            id: member.id,
          },
        },
        data: {
          status: "DELIVERED",
          deliveredAt: member.deliveredAt ?? timestamp,
        },
      });

      await tx.campaign.update({
        where: {
          tenantId_id: {
            tenantId: input.tenantId,
            id: input.campaignId,
          },
        },
        data: {
          deliveredCount: { increment: 1 },
        },
      });

      return {
        memberId: member.id,
        previousStatus: currentStatus,
        currentStatus: "DELIVERED",
        updated: true,
      };
    }

    // If target is READ
    if (targetStatus === "READ") {
      const isAlreadyDelivered = currentStatus === "DELIVERED";

      await tx.campaignAudienceMember.update({
        where: {
          tenantId_id: {
            tenantId: input.tenantId,
            id: member.id,
          },
        },
        data: {
          status: "READ",
          readAt: timestamp,
          deliveredAt: member.deliveredAt ?? timestamp,
        },
      });

      // If it wasn't marked delivered yet, increment deliveredCount as well
      if (!isAlreadyDelivered) {
        await tx.campaign.update({
          where: {
            tenantId_id: {
              tenantId: input.tenantId,
              id: input.campaignId,
            },
          },
          data: {
            deliveredCount: { increment: 1 },
          },
        });
      }

      return {
        memberId: member.id,
        previousStatus: currentStatus,
        currentStatus: "READ",
        updated: true,
      };
    }

    // If target is FAILED
    if (targetStatus === "FAILED") {
      if (currentStatus === "FAILED") {
        return {
          memberId: member.id,
          previousStatus: currentStatus,
          currentStatus: "FAILED",
          updated: false,
        };
      }

      await tx.campaignAudienceMember.update({
        where: {
          tenantId_id: {
            tenantId: input.tenantId,
            id: member.id,
          },
        },
        data: {
          status: "FAILED",
          errorMessage: input.errorMessage ?? "Delivery failed",
        },
      });

      await tx.campaign.update({
        where: {
          tenantId_id: {
            tenantId: input.tenantId,
            id: input.campaignId,
          },
        },
        data: {
          failedCount: { increment: 1 },
        },
      });

      return {
        memberId: member.id,
        previousStatus: currentStatus,
        currentStatus: "FAILED",
        updated: true,
      };
    }

    return {
      memberId: member.id,
      previousStatus: currentStatus,
      currentStatus,
      updated: false,
    };
  });
}

export async function reconcileCampaignDeliveryFromOutboundMessage(
  database: CampaignDeliveryReconcilerDatabase,
  params: {
    tenantId: string;
    outboundMessageId: string;
    status: CampaignDeliveryStatus;
    timestamp?: Date;
    errorMessage?: string;
  },
): Promise<ReconcileCampaignDeliveryResult | null> {
  const outbound = await database.outboundMessage.findUnique({
    where: {
      tenantId_id: {
        tenantId: params.tenantId,
        id: params.outboundMessageId,
      },
    },
  });

  if (!outbound) return null;

  const content = outbound.content as {
    metadata?: {
      source?: string;
      campaignId?: string;
      campaignAudienceMemberId?: string;
    };
  } | null;

  if (
    content?.metadata?.source === "CAMPAIGN" &&
    content.metadata.campaignId &&
    content.metadata.campaignAudienceMemberId
  ) {
    return reconcileCampaignAudienceDeliveryStatus(database, {
      tenantId: params.tenantId,
      campaignId: content.metadata.campaignId,
      campaignAudienceMemberId: content.metadata.campaignAudienceMemberId,
      status: params.status,
      timestamp: params.timestamp,
      errorMessage: params.errorMessage,
    });
  }

  return null;
}
