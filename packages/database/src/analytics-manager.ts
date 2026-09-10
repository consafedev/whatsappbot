import type { PrismaClient } from "./generated/prisma/client";
import { createTenantContext } from "./tenant-context";
import { assertTenantOperational } from "./tenant-operational";

export type AnalyticsDatabase = Pick<
  PrismaClient,
  "inboundMessageEvent" | "outboundMessage" | "message" | "conversation" | "aiUsageLog" | "tenant"
>;

export class AnalyticsDateRangeInvalidError extends Error {
  readonly code = "ANALYTICS_DATE_RANGE_INVALID";

  constructor(message = "The 'from' date must be before or equal to 'to' date") {
    super(message);
    this.name = "AnalyticsDateRangeInvalidError";
  }
}

export interface OperationalOverviewParams {
  readonly tenantId: string;
  readonly from: Date;
  readonly to: Date;
}

export interface AiTokenUsageSummary {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostUsd: number;
  readonly costEstimatedUsd: number;
}

export interface TenantOperationalOverviewResult {
  readonly tenantId: string;
  readonly from: string;
  readonly to: string;
  readonly inboundMessagesCount: number;
  readonly outboundMessagesCount: number;
  readonly activeConversationsCount: number;
  readonly closedConversationsCount: number;
  readonly aiTokenUsage: AiTokenUsageSummary;
  readonly deliverySuccessRate: number;
}

export interface MessageTimeSeriesParams {
  readonly tenantId: string;
  readonly from: Date;
  readonly to: Date;
  readonly interval?: "day" | "hour" | undefined;
}

export interface MessageTimeSeriesBucket {
  readonly timestamp: string;
  readonly inbound: number;
  readonly outbound: number;
  readonly total: number;
}

function validateDateRange(from: Date, to: Date): void {
  if (!(from instanceof Date) || Number.isNaN(from.getTime())) {
    throw new AnalyticsDateRangeInvalidError("Invalid 'from' date provided");
  }
  if (!(to instanceof Date) || Number.isNaN(to.getTime())) {
    throw new AnalyticsDateRangeInvalidError("Invalid 'to' date provided");
  }
  if (from.getTime() > to.getTime()) {
    throw new AnalyticsDateRangeInvalidError(
      "The 'from' date must be before or equal to 'to' date",
    );
  }
}

export async function getTenantOperationalOverview(
  database: AnalyticsDatabase,
  params: OperationalOverviewParams,
): Promise<TenantOperationalOverviewResult> {
  const { tenantId, from, to } = params;
  validateDateRange(from, to);
  await assertTenantOperational(createTenantContext(tenantId), database);

  const [
    inboundEventsCount,
    inboundMessagesCountFromTable,
    outboundRecordsCount,
    outboundMessagesCountFromTable,
    activeConversationsCount,
    closedConversationsCount,
    aiUsageAggregation,
    outboundDeliveredOrReadCount,
    messageDeliveredOrReadCount,
  ] = await Promise.all([
    database.inboundMessageEvent.count({
      where: {
        tenantId,
        createdAt: { gte: from, lte: to },
        eventType: { notIn: ["STATUS_UPDATE", "DELIVERY_RECEIPT"] },
      },
    }),
    database.message.count({
      where: {
        tenantId,
        direction: "inbound",
        createdAt: { gte: from, lte: to },
      },
    }),
    database.outboundMessage.count({
      where: {
        tenantId,
        createdAt: { gte: from, lte: to },
      },
    }),
    database.message.count({
      where: {
        tenantId,
        direction: "outbound",
        createdAt: { gte: from, lte: to },
      },
    }),
    database.conversation.count({
      where: {
        tenantId,
        status: { not: "closed" },
        OR: [
          { lastMessageAt: { gte: from, lte: to } },
          { updatedAt: { gte: from, lte: to } },
          { createdAt: { gte: from, lte: to } },
        ],
      },
    }),
    database.conversation.count({
      where: {
        tenantId,
        status: "closed",
        OR: [{ closedAt: { gte: from, lte: to } }, { updatedAt: { gte: from, lte: to } }],
      },
    }),
    database.aiUsageLog.aggregate({
      where: {
        tenantId,
        createdAt: { gte: from, lte: to },
      },
      _sum: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        costEstimatedUsd: true,
      },
    }),
    database.outboundMessage.count({
      where: {
        tenantId,
        createdAt: { gte: from, lte: to },
        OR: [
          { status: { in: ["DELIVERED", "READ", "delivered", "read"] } },
          { message: { deliveryStatus: { in: ["DELIVERED", "READ", "delivered", "read"] } } },
        ],
      },
    }),
    database.message.count({
      where: {
        tenantId,
        direction: "outbound",
        createdAt: { gte: from, lte: to },
        deliveryStatus: { in: ["DELIVERED", "READ", "delivered", "read"] },
      },
    }),
  ]);

  const inboundMessagesCount = Math.max(inboundEventsCount, inboundMessagesCountFromTable);
  const outboundMessagesCount = Math.max(outboundRecordsCount, outboundMessagesCountFromTable);
  const deliveredOrReadCount = Math.max(outboundDeliveredOrReadCount, messageDeliveredOrReadCount);

  const deliverySuccessRate =
    outboundMessagesCount > 0
      ? Math.min(100, Number(((deliveredOrReadCount / outboundMessagesCount) * 100).toFixed(2)))
      : 0;

  const promptTokens = aiUsageAggregation._sum.promptTokens ?? 0;
  const completionTokens = aiUsageAggregation._sum.completionTokens ?? 0;
  const totalTokens = aiUsageAggregation._sum.totalTokens ?? promptTokens + completionTokens;
  const rawCost = aiUsageAggregation._sum.costEstimatedUsd;
  const estimatedCostUsd = rawCost != null ? Number(rawCost) : 0;

  return {
    tenantId,
    from: from.toISOString(),
    to: to.toISOString(),
    inboundMessagesCount,
    outboundMessagesCount,
    activeConversationsCount,
    closedConversationsCount,
    aiTokenUsage: {
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUsd,
      costEstimatedUsd: estimatedCostUsd,
    },
    deliverySuccessRate,
  };
}

function getBucketKey(date: Date, interval: "day" | "hour"): string {
  const d = new Date(date);
  if (interval === "hour") {
    d.setUTCMinutes(0, 0, 0);
  } else {
    d.setUTCHours(0, 0, 0, 0);
  }
  return d.toISOString();
}

function generateBucketKeys(from: Date, to: Date, interval: "day" | "hour"): string[] {
  const keys: string[] = [];
  const current = new Date(from);
  if (interval === "hour") {
    current.setUTCMinutes(0, 0, 0);
  } else {
    current.setUTCHours(0, 0, 0, 0);
  }

  const endTimestamp = to.getTime();
  const stepMs = interval === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

  while (current.getTime() <= endTimestamp) {
    keys.push(current.toISOString());
    current.setTime(current.getTime() + stepMs);
  }

  const lastKey = getBucketKey(to, interval);
  if (!keys.includes(lastKey)) {
    keys.push(lastKey);
  }

  return keys;
}

export async function getTenantMessageTimeSeries(
  database: AnalyticsDatabase,
  params: MessageTimeSeriesParams,
): Promise<readonly MessageTimeSeriesBucket[]> {
  const { tenantId, from, to, interval = "day" } = params;
  if (interval !== "day" && interval !== "hour") {
    throw new AnalyticsDateRangeInvalidError("Interval must be either 'day' or 'hour'");
  }
  validateDateRange(from, to);
  await assertTenantOperational(createTenantContext(tenantId), database);

  const [inboundEvents, inboundMessages, outboundRecords, outboundMessages] = await Promise.all([
    database.inboundMessageEvent.findMany({
      select: { createdAt: true },
      where: {
        tenantId,
        createdAt: { gte: from, lte: to },
        eventType: { notIn: ["STATUS_UPDATE", "DELIVERY_RECEIPT"] },
      },
    }),
    database.message.findMany({
      select: { createdAt: true },
      where: {
        tenantId,
        direction: "inbound",
        createdAt: { gte: from, lte: to },
      },
    }),
    database.outboundMessage.findMany({
      select: { createdAt: true },
      where: {
        tenantId,
        createdAt: { gte: from, lte: to },
      },
    }),
    database.message.findMany({
      select: { createdAt: true },
      where: {
        tenantId,
        direction: "outbound",
        createdAt: { gte: from, lte: to },
      },
    }),
  ]);

  const chosenInbounds =
    inboundEvents.length >= inboundMessages.length ? inboundEvents : inboundMessages;
  const chosenOutbounds =
    outboundRecords.length >= outboundMessages.length ? outboundRecords : outboundMessages;

  const bucketKeys = generateBucketKeys(from, to, interval);
  const bucketsMap = new Map<string, { inbound: number; outbound: number }>();

  for (const key of bucketKeys) {
    bucketsMap.set(key, { inbound: 0, outbound: 0 });
  }

  for (const item of chosenInbounds) {
    const key = getBucketKey(item.createdAt, interval);
    const bucket = bucketsMap.get(key);
    if (bucket) {
      bucket.inbound += 1;
    } else {
      bucketsMap.set(key, { inbound: 1, outbound: 0 });
    }
  }

  for (const item of chosenOutbounds) {
    const key = getBucketKey(item.createdAt, interval);
    const bucket = bucketsMap.get(key);
    if (bucket) {
      bucket.outbound += 1;
    } else {
      bucketsMap.set(key, { inbound: 0, outbound: 1 });
    }
  }

  const sortedKeys = Array.from(bucketsMap.keys()).sort();
  return sortedKeys.map((key) => {
    const counts = bucketsMap.get(key) ?? { inbound: 0, outbound: 0 };
    return {
      timestamp: key,
      inbound: counts.inbound,
      outbound: counts.outbound,
      total: counts.inbound + counts.outbound,
    };
  });
}
