import { CampaignAnalyticsClient } from "./campaign-analytics-client";

export const dynamic = "force-dynamic";

export default async function CampaignAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CampaignAnalyticsClient campaignId={id} />;
}
