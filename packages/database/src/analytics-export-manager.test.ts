import { describe, expect, it } from "vitest";
import {
  escapeCsvField,
  generateOperationalOverviewCsv,
  generateTimeSeriesCsv,
} from "./analytics-export-manager";
import type { TenantOperationalOverviewResult } from "./analytics-manager";

describe("analytics-export-manager", () => {
  describe("escapeCsvField", () => {
    it("returns plain numbers and strings unchanged", () => {
      expect(escapeCsvField("hello")).toBe("hello");
      expect(escapeCsvField(123)).toBe("123");
      expect(escapeCsvField(0)).toBe("0");
    });

    it("returns empty string for null and undefined", () => {
      expect(escapeCsvField(null)).toBe("");
      expect(escapeCsvField(undefined)).toBe("");
    });

    it("escapes fields containing commas", () => {
      expect(escapeCsvField("a,b")).toBe('"a,b"');
    });

    it("escapes fields containing double quotes by doubling them", () => {
      expect(escapeCsvField('hello "world"')).toBe('"hello ""world"""');
    });

    it("escapes fields containing newlines", () => {
      expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
      expect(escapeCsvField("line1\r\nline2")).toBe('"line1\r\nline2"');
    });
  });

  describe("generateOperationalOverviewCsv", () => {
    const mockOverview: TenantOperationalOverviewResult = {
      tenantId: "tenant-123",
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-10T23:59:59.000Z",
      inboundMessagesCount: 150,
      outboundMessagesCount: 220,
      activeConversationsCount: 18,
      closedConversationsCount: 45,
      aiTokenUsage: {
        promptTokens: 12000,
        completionTokens: 3500,
        totalTokens: 15500,
        estimatedCostUsd: 0.031,
        costEstimatedUsd: 0.031,
      },
      deliverySuccessRate: 97.5,
    };

    const options = {
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-10T23:59:59.000Z"),
    };

    it("generates CSV with UTF-8 BOM preamble and expected structure", () => {
      const csv = generateOperationalOverviewCsv(mockOverview, options);

      // Must start with UTF-8 BOM
      expect(csv.startsWith("\uFEFF")).toBe(true);

      // Verify title and date range
      expect(csv).toContain("Reporte Operativo de Mensajería");
      expect(csv).toContain("Periodo,2026-09-01 a 2026-09-10");

      // Verify header and metrics
      expect(csv).toContain("Métrica,Valor");
      expect(csv).toContain("Mensajes Entrantes,150");
      expect(csv).toContain("Mensajes Salientes,220");
      expect(csv).toContain("Conversaciones Activas,18");
      expect(csv).toContain("Conversaciones Cerradas,45");
      expect(csv).toContain("Efectividad de Entrega,97.5%");
      expect(csv).toContain("Tokens de IA (Prompt),12000");
      expect(csv).toContain("Tokens de IA (Completitud),3500");
      expect(csv).toContain("Tokens de IA (Total),15500");
      expect(csv).toContain("Costo Estimado IA (USD),$0.0310");
    });
  });

  describe("generateTimeSeriesCsv", () => {
    it("generates time series table with UTF-8 BOM and headers", () => {
      const buckets = [
        {
          timestamp: "2026-09-01",
          inbound: 10,
          outbound: 20,
          total: 30,
        },
        {
          timestamp: "2026-09-02",
          inbound: 15,
          outbound: 25,
          total: 40,
        },
      ];

      const csv = generateTimeSeriesCsv(buckets);

      // Must start with UTF-8 BOM
      expect(csv.startsWith("\uFEFF")).toBe(true);

      // Verify header and rows
      expect(csv).toContain("Fecha/Hora,Mensajes Entrantes,Mensajes Salientes,Volumen Total");
      expect(csv).toContain("2026-09-01,10,20,30");
      expect(csv).toContain("2026-09-02,15,25,40");
    });

    it("supports object with buckets property", () => {
      const input = {
        buckets: [
          {
            timestamp: "2026-09-01T10:00:00.000Z",
            inbound: 5,
            outbound: 8,
            total: 13,
          },
        ],
      };

      const csv = generateTimeSeriesCsv(input);
      expect(csv.startsWith("\uFEFF")).toBe(true);
      expect(csv).toContain("2026-09-01T10:00:00.000Z,5,8,13");
    });

    it("handles empty buckets list gracefully", () => {
      const csv = generateTimeSeriesCsv([]);
      expect(csv.startsWith("\uFEFF")).toBe(true);
      expect(csv).toContain("Fecha/Hora,Mensajes Entrantes,Mensajes Salientes,Volumen Total");
    });
  });
});
