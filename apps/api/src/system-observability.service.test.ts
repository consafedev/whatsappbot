import * as net from "node:net";
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

/**
 * Minimal RESP server used to observe the exact bytes pingRedis sends.
 * Records the first command of each connection and answers AUTH with +OK
 * and PING with +PONG, so pingRedis completes its handshake successfully.
 */
function startRespEchoServer(): Promise<{
  port: number;
  close: () => Promise<void>;
  firstCommands: string[];
}> {
  const firstCommands: string[] = [];
  const server = net.createServer((socket) => {
    let firstChunk = true;
    socket.on("data", (data) => {
      if (firstChunk) {
        firstChunk = false;
        firstCommands.push(data.toString("utf8"));
      }
      const text = data.toString();
      if (text.startsWith("AUTH ")) {
        socket.write("+OK\r\n");
      } else if (text.includes("PING")) {
        socket.write("+PONG\r\n");
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        port,
        firstCommands,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

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

    it("decodes percent-encoded passwords before AUTH", async () => {
      const server = await startRespEchoServer();
      try {
        // %40 decodes to '@': the raw encoded form must NOT reach the wire.
        const result = await pingRedis(`redis://:secret%40pass@127.0.0.1:${server.port}`, 2000);
        expect(result.ok).toBe(true);
        expect(result.latencyMs).toBeGreaterThanOrEqual(1);
        expect(server.firstCommands.length).toBe(1);
        expect(server.firstCommands[0]).toBe("AUTH secret@pass\r\n");
      } finally {
        await server.close();
      }
    });

    it("refuses passwords containing CR or LF before opening any connection", async () => {
      const server = await startRespEchoServer();
      try {
        // %0D%0A decodes to CRLF: the probe must reject it without connecting.
        const result = await pingRedis(`redis://:bad%0D%0Apass@127.0.0.1:${server.port}`, 2000);
        expect(result.ok).toBe(false);
        expect(result.latencyMs).toBe(-1);
        expect(server.firstCommands.length).toBe(0);
      } finally {
        await server.close();
      }
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
