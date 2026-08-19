import type { Prisma } from "./generated/prisma/client";

export type InboundWebhookChannel = Readonly<{
  id: string;
  tenantId: string;
  providerType: string;
  status: string;
  active: boolean;
  credentialsCiphertext: string | null;
}>;

export type InboundWebhookChannelResolverDatabase = Pick<
  Prisma.TransactionClient,
  "channelAccount"
>;

export interface InboundWebhookChannelResolver {
  findById(channelId: string): Promise<InboundWebhookChannel | null>;
}

export function createInboundWebhookChannelResolver(
  database: InboundWebhookChannelResolverDatabase,
): InboundWebhookChannelResolver {
  return Object.freeze({
    findById: async (channelId: string): Promise<InboundWebhookChannel | null> => {
      const channel = await database.channelAccount.findUnique({
        select: {
          active: true,
          credentialsCiphertext: true,
          id: true,
          providerType: true,
          status: true,
          tenantId: true,
        },
        where: { id: channelId },
      });
      return channel;
    },
  });
}
