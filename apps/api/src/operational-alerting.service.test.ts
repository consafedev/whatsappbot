import {
  type AnalyticsDatabase,
  createTenantContext,
  type TenantContext,
} from "@whatsapp-platform/database";
import { describe, expect, it, vi } from "vitest";
import {
  evaluateOperationalAlerts,
  OperationalAlertingService,
} from "./operational-alerting.service";
import type { SystemHealthData, SystemObservabilityService } from "./system-observability.service";

describe("OperationalAlertingService", () => {
  const context: TenantContext = createTenantContext("01918a00-0000-7000-8000-000000000001");

  describe("evaluateOperationalAlerts", () => {
    it("returns empty alerts array when all metrics are within normal thresholds", () => {
      const alerts = evaluateOperationalAlerts({
        tenantId: context.tenantId,
        databaseLatencyMs: 25,
        databaseOk: true,
        redisLatencyMs: 15,
        redisOk: true,
        pendingOutboxCount: 10,
        failedOutboxCount: 1,
        averageTransitSeconds: 4.5,
        sentMessagesCount: 50,
        disconnectedChannelsCount: 0,
        evaluatedAt: "2026-09-10T12:00:00.000Z",
      });

      expect(alerts).toEqual([]);
    });

    it("evaluates HIGH_FAILURE_RATE with warning when rate is between 15% and 30%", () => {
      // 2 failures / 10 sent = 20%
      const alerts = evaluateOperationalAlerts({
        tenantId: context.tenantId,
        databaseLatencyMs: 20,
        databaseOk: true,
        redisLatencyMs: 10,
        redisOk: true,
        pendingOutboxCount: 5,
        failedOutboxCount: 2,
        averageTransitSeconds: 3,
        sentMessagesCount: 10,
        disconnectedChannelsCount: 0,
        evaluatedAt: "2026-09-10T12:00:00.000Z",
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        code: "HIGH_FAILURE_RATE",
        severity: "warning",
        metricValue: "20%",
        thresholdValue: "> 15%",
      });
    });

    it("evaluates HIGH_FAILURE_RATE with critical when rate exceeds 30%", () => {
      // 4 failures / 10 sent = 40%
      const alerts = evaluateOperationalAlerts({
        tenantId: context.tenantId,
        databaseLatencyMs: 20,
        databaseOk: true,
        redisLatencyMs: 10,
        redisOk: true,
        pendingOutboxCount: 5,
        failedOutboxCount: 4,
        averageTransitSeconds: 3,
        sentMessagesCount: 10,
        disconnectedChannelsCount: 0,
        evaluatedAt: "2026-09-10T12:00:00.000Z",
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        code: "HIGH_FAILURE_RATE",
        severity: "critical",
        metricValue: "40%",
        thresholdValue: "> 30%",
      });
    });

    it("ignores HIGH_FAILURE_RATE if sent messages count is below 10", () => {
      // 3 failures / 5 sent = 60%, but sentMessagesCount < 10
      const alerts = evaluateOperationalAlerts({
        tenantId: context.tenantId,
        databaseLatencyMs: 20,
        databaseOk: true,
        redisLatencyMs: 10,
        redisOk: true,
        pendingOutboxCount: 5,
        failedOutboxCount: 3,
        averageTransitSeconds: 3,
        sentMessagesCount: 5,
        disconnectedChannelsCount: 0,
        evaluatedAt: "2026-09-10T12:00:00.000Z",
      });

      expect(alerts).toEqual([]);
    });

    it("evaluates OUTBOX_BACKLOG when pendingCount > 50", () => {
      const alerts = evaluateOperationalAlerts({
        tenantId: context.tenantId,
        databaseLatencyMs: 20,
        databaseOk: true,
        redisLatencyMs: 10,
        redisOk: true,
        pendingOutboxCount: 55,
        failedOutboxCount: 0,
        averageTransitSeconds: 10,
        sentMessagesCount: 20,
        disconnectedChannelsCount: 0,
        evaluatedAt: "2026-09-10T12:00:00.000Z",
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        code: "OUTBOX_BACKLOG",
        severity: "warning",
      });
    });

    it("evaluates OUTBOX_BACKLOG when averageTransitSeconds > 60", () => {
      const alerts = evaluateOperationalAlerts({
        tenantId: context.tenantId,
        databaseLatencyMs: 20,
        databaseOk: true,
        redisLatencyMs: 10,
        redisOk: true,
        pendingOutboxCount: 15,
        failedOutboxCount: 0,
        averageTransitSeconds: 75.4,
        sentMessagesCount: 20,
        disconnectedChannelsCount: 0,
        evaluatedAt: "2026-09-10T12:00:00.000Z",
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        code: "OUTBOX_BACKLOG",
        severity: "warning",
      });
    });

    it("evaluates HIGH_LATENCY_DB warning for latency > 300ms, critical for connection failure", () => {
      const warningAlerts = evaluateOperationalAlerts({
        tenantId: context.tenantId,
        databaseLatencyMs: 340,
        databaseOk: true,
        redisLatencyMs: 10,
        redisOk: true,
        pendingOutboxCount: 5,
        failedOutboxCount: 0,
        averageTransitSeconds: 2,
        sentMessagesCount: 20,
        disconnectedChannelsCount: 0,
      });

      expect(warningAlerts).toHaveLength(1);
      expect(warningAlerts[0]).toMatchObject({
        code: "HIGH_LATENCY_DB",
        severity: "warning",
        metricValue: "340ms",
      });

      const criticalAlerts = evaluateOperationalAlerts({
        tenantId: context.tenantId,
        databaseLatencyMs: -1,
        databaseOk: false,
        redisLatencyMs: 10,
        redisOk: true,
        pendingOutboxCount: 5,
        failedOutboxCount: 0,
        averageTransitSeconds: 2,
        sentMessagesCount: 20,
        disconnectedChannelsCount: 0,
      });

      expect(criticalAlerts).toHaveLength(1);
      expect(criticalAlerts[0]).toMatchObject({
        code: "HIGH_LATENCY_DB",
        severity: "critical",
        metricValue: "Desconectada",
      });
    });

    it("evaluates HIGH_LATENCY_REDIS warning for latency > 300ms, critical for connection failure", () => {
      const warningAlerts = evaluateOperationalAlerts({
        tenantId: context.tenantId,
        databaseLatencyMs: 20,
        databaseOk: true,
        redisLatencyMs: 380,
        redisOk: true,
        pendingOutboxCount: 5,
        failedOutboxCount: 0,
        averageTransitSeconds: 2,
        sentMessagesCount: 20,
        disconnectedChannelsCount: 0,
      });

      expect(warningAlerts).toHaveLength(1);
      expect(warningAlerts[0]).toMatchObject({
        code: "HIGH_LATENCY_REDIS",
        severity: "warning",
        metricValue: "380ms",
      });

      const criticalAlerts = evaluateOperationalAlerts({
        tenantId: context.tenantId,
        databaseLatencyMs: 20,
        databaseOk: true,
        redisLatencyMs: -1,
        redisOk: false,
        pendingOutboxCount: 5,
        failedOutboxCount: 0,
        averageTransitSeconds: 2,
        sentMessagesCount: 20,
        disconnectedChannelsCount: 0,
      });

      expect(criticalAlerts).toHaveLength(1);
      expect(criticalAlerts[0]).toMatchObject({
        code: "HIGH_LATENCY_REDIS",
        severity: "critical",
        metricValue: "Desconectado",
      });
    });

    it("evaluates CHANNEL_DISCONNECTED when disconnectedChannelsCount > 0", () => {
      const alerts = evaluateOperationalAlerts({
        tenantId: context.tenantId,
        databaseLatencyMs: 20,
        databaseOk: true,
        redisLatencyMs: 15,
        redisOk: true,
        pendingOutboxCount: 5,
        failedOutboxCount: 0,
        averageTransitSeconds: 2,
        sentMessagesCount: 20,
        disconnectedChannelsCount: 2,
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        code: "CHANNEL_DISCONNECTED",
        severity: "warning",
        metricValue: 2,
      });
    });
  });

  describe("getOperationalAlerts service method", () => {
    it("aggregates active alerts and calculates summary counts correctly", async () => {
      const mockHealth: SystemHealthData = {
        status: "degraded",
        timestamp: new Date().toISOString(),
        databaseLatencyMs: 350, // Warning: HIGH_LATENCY_DB
        redisLatencyMs: 400, // Warning: HIGH_LATENCY_REDIS
        outboxMetrics: {
          pendingCount: 60, // Warning: OUTBOX_BACKLOG
          failedCount: 4,
          averageTransitSeconds: 15,
        },
        workerStatus: {
          whatsappWorker: "degraded",
          jobsWorker: "active",
        },
      };

      const mockObservability = {
        getSystemHealth: vi.fn().mockResolvedValue(mockHealth),
      } as unknown as SystemObservabilityService;

      const mockDatabase = {
        outboundMessage: {
          count: vi.fn().mockResolvedValue(20), // 4 failed / 20 sent = 20% -> Warning: HIGH_FAILURE_RATE
        },
        channelAccount: {
          count: vi.fn().mockResolvedValue(1), // Warning: CHANNEL_DISCONNECTED
        },
      } as unknown as AnalyticsDatabase;

      const service = new OperationalAlertingService(mockDatabase, mockObservability);
      const result = await service.getOperationalAlerts(context);

      expect(result.activeAlerts).toHaveLength(5);
      expect(result.summary).toEqual({
        total: 5,
        critical: 0,
        warning: 5,
        info: 0,
      });
      expect(result.evaluatedAt).toBeDefined();
    });
  });
});
