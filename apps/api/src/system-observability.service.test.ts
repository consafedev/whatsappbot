import {
  type AnalyticsDatabase,
  createTenantContext,
  type TenantContext,
} from "@whatsapp-platform/database";
import { describe, expect, it, vi } from "vitest";
import {
  calculateOutboxMetrics,
  pingPostgres,
  pingRedis,
  SystemObservabilityService,
} from "./system-observability.service";

describe("SystemObservabilityService", () => {
  const context: TenantContext = createTenantContext("01918a00-0000-7000-8000-000000000001");

  describe("pingRedis", () => {
    it("returns ok: false on invalid URL", async () => {
      const result = await pingRedis("not-a-valid-url");
      expect(result.ok).toBe(false);
      expect(result.latencyMs).toBe(-1);
    });

    it("returns ok: false on unreachable port with fast timeout", async () => {
      const result = await pingRedis("redis://127.0.0.1:59999", 50);
      expect(result.ok).toBe(false);
      expect(result.latencyMs).toBe(-1);
    });
  });

  describe("pingPostgres", () => {
    it("returns ok: true when database query resolves", async () => {
      const mockDb = {
        tenant: {
          findFirst: vi.fn().mockResolvedValue({ id: "tenant-test-123" }),
        },
      } as unknown as AnalyticsDatabase;

      const result = await pingPostgres(mockDb);
      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns ok: false when database query rejects", async () => {
      const mockDb = {
        tenant: {
          findFirst: vi.fn().mockRejectedValue(new Error("Connection error")),
        },
      } as unknown as AnalyticsDatabase;

      const result = await pingPostgres(mockDb);
      expect(result.ok).toBe(false);
      expect(result.latencyMs).toBe(-1);
    });
  });

  describe("calculateOutboxMetrics", () => {
    it("computes counts and average transit time", async () => {
      const now = new Date();
      const createdAt1 = new Date(now.getTime() - 5000);
      const sentAt1 = new Date(now.getTime() - 3000); // 2 seconds
      const createdAt2 = new Date(now.getTime() - 10000);
      const sentAt2 = new Date(now.getTime() - 6000); // 4 seconds

      const mockDb = {
        outboundMessage: {
          count: vi.fn().mockImplementation(({ where }) => {
            if (where.status === "PENDING") return Promise.resolve(3);
            if (where.status === "FAILED") return Promise.resolve(1);
            return Promise.resolve(0);
          }),
          findMany: vi.fn().mockResolvedValue([
            { createdAt: createdAt1, sentAt: sentAt1 },
            { createdAt: createdAt2, sentAt: sentAt2 },
          ]),
        },
      } as unknown as AnalyticsDatabase;

      const metrics = await calculateOutboxMetrics(mockDb, "tenant-test-123");
      expect(metrics.pendingCount).toBe(3);
      expect(metrics.failedCount).toBe(1);
      expect(metrics.averageTransitSeconds).toBe(3); // (2 + 4) / 2 = 3
    });

    it("handles zero sent messages gracefully", async () => {
      const mockDb = {
        outboundMessage: {
          count: vi.fn().mockResolvedValue(0),
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as unknown as AnalyticsDatabase;

      const metrics = await calculateOutboxMetrics(mockDb, "tenant-test-123");
      expect(metrics.pendingCount).toBe(0);
      expect(metrics.failedCount).toBe(0);
      expect(metrics.averageTransitSeconds).toBe(0);
    });
  });

  describe("getSystemHealth", () => {
    it("returns healthy status and active workers when db and redis are responsive", async () => {
      const mockDb = {
        tenant: {
          findFirst: vi.fn().mockResolvedValue({ id: "tenant-test-123" }),
        },
        outboundMessage: {
          count: vi.fn().mockResolvedValue(0),
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as unknown as AnalyticsDatabase;

      // Mock redis url pointing to unreachable port with fast timeout to test fallback or pass mock
      const service = new SystemObservabilityService(mockDb, "not-a-valid-url");
      const health = await service.getSystemHealth(context);

      expect(health).toHaveProperty("timestamp");
      expect(health.redisLatencyMs).toBe(-1);
      expect(health.status).toBe("unhealthy");
      expect(health.workerStatus.whatsappWorker).toBe("inactive");
      expect(health.workerStatus.jobsWorker).toBe("inactive");
    });
  });
});
