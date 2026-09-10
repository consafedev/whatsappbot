import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadAnalyticsCsv,
  fetchMessageTimeSeries,
  fetchOperationalOverview,
  formatCurrencyUsd,
  formatNumber,
  ReportsApiError,
  resolveDatePreset,
} from "./reports-view-model";

describe("reports-view-model", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("resolveDatePreset", () => {
    const fixedDate = new Date("2026-09-10T12:00:00.000Z");

    it("resolves 7d preset correctly", () => {
      const { from, to } = resolveDatePreset("7d", fixedDate);
      expect(to).toBe("2026-09-10T12:00:00.000Z");
      expect(from).toBe("2026-09-03T12:00:00.000Z");
      expect(new Date(from).getTime()).toBeLessThan(new Date(to).getTime());
    });

    it("resolves 30d preset correctly", () => {
      const { from, to } = resolveDatePreset("30d", fixedDate);
      expect(to).toBe("2026-09-10T12:00:00.000Z");
      expect(from).toBe("2026-08-11T12:00:00.000Z");
    });

    it("resolves this_month preset to start of current month", () => {
      const { from, to } = resolveDatePreset("this_month", fixedDate);
      expect(to).toBe("2026-09-10T12:00:00.000Z");
      expect(from).toBe("2026-09-01T00:00:00.000Z");
    });

    it("resolves custom preset fallback", () => {
      const { from, to } = resolveDatePreset("custom", fixedDate);
      expect(to).toBe("2026-09-10T12:00:00.000Z");
      expect(from).toBe("2026-09-03T12:00:00.000Z");
    });
  });

  describe("formatNumber", () => {
    it("formats finite numbers properly", () => {
      expect(formatNumber(0)).toBe("0");
      expect(formatNumber(42)).toBe("42");
      const formatted1000 = formatNumber(1000);
      expect(formatted1000).toMatch(/1[.,]000/);
    });

    it("handles NaN and non-finite values safely", () => {
      expect(formatNumber(Number.NaN)).toBe("0");
      expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("0");
    });
  });

  describe("formatCurrencyUsd", () => {
    it("formats USD amounts with 4 decimal places", () => {
      expect(formatCurrencyUsd(0)).toBe("$0.0000");
      expect(formatCurrencyUsd(0.0035)).toBe("$0.0035");
      expect(formatCurrencyUsd(1.5)).toBe("$1.5000");
      expect(formatCurrencyUsd(12.34567)).toBe("$12.3457");
    });

    it("handles NaN and non-finite values safely", () => {
      expect(formatCurrencyUsd(Number.NaN)).toBe("$0.0000");
      expect(formatCurrencyUsd(Number.NEGATIVE_INFINITY)).toBe("$0.0000");
    });
  });

  describe("fetchOperationalOverview", () => {
    it("unpacks success data from envelope", async () => {
      const mockData = {
        inboundMessagesCount: 150,
        outboundMessagesCount: 220,
        activeConversationsCount: 18,
        closedConversationsCount: 45,
        aiTokenUsage: {
          promptTokens: 12000,
          completionTokens: 3500,
          totalTokens: 15500,
          estimatedCostUsd: 0.031,
        },
        deliverySuccessRate: 97.5,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: mockData }),
      } as unknown as Response);

      const result = await fetchOperationalOverview("http://localhost:3001", {
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-09-10T00:00:00.000Z",
      });

      expect(result.inboundMessagesCount).toBe(150);
      expect(result.outboundMessagesCount).toBe(220);
      expect(result.activeConversationsCount).toBe(18);
      expect(result.closedConversationsCount).toBe(45);
      expect(result.aiTokenUsage.totalTokens).toBe(15500);
      expect(result.aiTokenUsage.estimatedCostUsd).toBe(0.031);
      expect(result.deliverySuccessRate).toBe(97.5);

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/api/v1/analytics/overview?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-10T00%3A00%3A00.000Z",
        expect.objectContaining({
          credentials: "include",
          method: "GET",
        }),
      );
    });

    it("handles missing nested fields with safe defaults", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as unknown as Response);

      const result = await fetchOperationalOverview("http://localhost:3001");
      expect(result.inboundMessagesCount).toBe(0);
      expect(result.outboundMessagesCount).toBe(0);
      expect(result.activeConversationsCount).toBe(0);
      expect(result.closedConversationsCount).toBe(0);
      expect(result.aiTokenUsage.totalTokens).toBe(0);
      expect(result.deliverySuccessRate).toBe(100);
    });

    it("throws ReportsApiError on HTTP 400 bad request", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          statusCode: 400,
          message: "The 'from' date must be before or equal to 'to' date",
        }),
      } as unknown as Response);

      await expect(fetchOperationalOverview("http://localhost:3001")).rejects.toThrow(
        ReportsApiError,
      );
      try {
        await fetchOperationalOverview("http://localhost:3001");
      } catch (err) {
        expect(err).toBeInstanceOf(ReportsApiError);
        expect((err as ReportsApiError).statusCode).toBe(400);
        expect((err as ReportsApiError).message).toBe(
          "The 'from' date must be before or equal to 'to' date",
        );
      }
    });

    it("throws ReportsApiError on HTTP 403 forbidden", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          statusCode: 403,
          message: "Forbidden",
        }),
      } as unknown as Response);

      try {
        await fetchOperationalOverview("http://localhost:3001");
      } catch (err) {
        expect(err).toBeInstanceOf(ReportsApiError);
        expect((err as ReportsApiError).statusCode).toBe(403);
        expect((err as ReportsApiError).message).toBe(
          "No tienes permiso suficiente o el módulo de reportes no está activo",
        );
      }
    });
  });

  describe("fetchMessageTimeSeries", () => {
    it("unpacks and normalizes time series buckets", async () => {
      const mockRawBuckets = [
        { timestamp: "2026-09-01T00:00:00.000Z", inbound: 10, outbound: 15, total: 25 },
        { timestamp: "2026-09-02T00:00:00.000Z", inbound: 20, outbound: 25, total: 45 },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: mockRawBuckets }),
      } as unknown as Response);

      const result = await fetchMessageTimeSeries("http://localhost:3001", {
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-09-02T23:59:59.000Z",
        interval: "day",
      });

      expect(result.interval).toBe("day");
      expect(result.buckets).toHaveLength(2);
      expect(result.buckets[0]).toEqual({
        bucket: "2026-09-01T00:00:00.000Z",
        inboundCount: 10,
        outboundCount: 15,
        totalCount: 25,
      });
      expect(result.buckets[1]).toEqual({
        bucket: "2026-09-02T00:00:00.000Z",
        inboundCount: 20,
        outboundCount: 25,
        totalCount: 45,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/api/v1/analytics/time-series?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-02T23%3A59%3A59.000Z&interval=day",
        expect.objectContaining({
          credentials: "include",
          method: "GET",
        }),
      );
    });

    it("handles hour interval and empty buckets safely", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      } as unknown as Response);

      const result = await fetchMessageTimeSeries("http://localhost:3001", {
        interval: "hour",
      });

      expect(result.interval).toBe("hour");
      expect(result.buckets).toEqual([]);
    });

    it("throws ReportsApiError on server failure", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "Internal Server Error" }),
      } as unknown as Response);

      await expect(fetchMessageTimeSeries("http://localhost:3001")).rejects.toThrow(
        ReportsApiError,
      );
    });
  });

  describe("downloadAnalyticsCsv", () => {
    it("requests overview CSV export and returns Blob", async () => {
      const mockCsvContent = "\uFEFFReporte Operativo de Mensajería\nMétricas,Valores\n";
      const mockBlob = new Blob([mockCsvContent], { type: "text/csv; charset=utf-8" });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => mockBlob,
      } as unknown as Response);

      const result = await downloadAnalyticsCsv("http://localhost:3001", {
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-09-10T00:00:00.000Z",
        type: "overview",
      });

      expect(result).toBe(mockBlob);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/api/v1/analytics/export/csv?type=overview&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-10T00%3A00%3A00.000Z",
        expect.objectContaining({
          credentials: "include",
          headers: { Accept: "text/csv" },
          method: "GET",
        }),
      );
    });

    it("requests time-series CSV export with interval", async () => {
      const mockBlob = new Blob(["time series csv"], { type: "text/csv" });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => mockBlob,
      } as unknown as Response);

      const result = await downloadAnalyticsCsv("http://localhost:3001", {
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-09-10T00:00:00.000Z",
        type: "time-series",
        interval: "hour",
      });

      expect(result).toBe(mockBlob);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/api/v1/analytics/export/csv?type=time-series&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-10T00%3A00%3A00.000Z&interval=hour",
        expect.objectContaining({
          method: "GET",
        }),
      );
    });

    it("throws ReportsApiError on 403 Forbidden", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          statusCode: 403,
          message: "Forbidden resource",
        }),
      } as unknown as Response);

      await expect(
        downloadAnalyticsCsv("http://localhost:3001", {
          from: "2026-09-01T00:00:00.000Z",
          to: "2026-09-10T00:00:00.000Z",
          type: "overview",
        }),
      ).rejects.toThrow(ReportsApiError);
    });

    it("throws ReportsApiError on 400 Bad Request with custom error message", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          statusCode: 400,
          message: "The 'from' date must be before or equal to 'to' date",
        }),
      } as unknown as Response);

      try {
        await downloadAnalyticsCsv("http://localhost:3001", {
          from: "2026-09-10T00:00:00.000Z",
          to: "2026-09-01T00:00:00.000Z",
          type: "overview",
        });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ReportsApiError);
        expect((err as ReportsApiError).statusCode).toBe(400);
        expect((err as ReportsApiError).message).toBe(
          "The 'from' date must be before or equal to 'to' date",
        );
      }
    });
  });
});
