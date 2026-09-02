import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  fetchAiAgentConfig,
  fetchAiUsageSummary,
  fetchKnowledgeDocumentDetail,
  fetchKnowledgeDocuments,
  formatCostUsd,
  formatDocumentStatus,
  formatKeywordsOutput,
  formatTokens,
  parseKeywordsInput,
  updateAiAgentConfig,
} from "./ai-view-model";

const BASE_URL = "http://localhost:3001";

describe("ai-view-model", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("formatters and parsers", () => {
    it("formatDocumentStatus maps all known statuses correctly", () => {
      expect(formatDocumentStatus("INDEXED")).toEqual({
        label: "Indexado",
        variant: "success",
        className: expect.stringContaining("emerald"),
      });

      expect(formatDocumentStatus("PROCESSING")).toEqual({
        label: "Procesando",
        variant: "warning",
        className: expect.stringContaining("amber"),
      });

      expect(formatDocumentStatus("PENDING")).toEqual({
        label: "Procesando",
        variant: "warning",
        className: expect.stringContaining("amber"),
      });

      expect(formatDocumentStatus("FAILED")).toEqual({
        label: "Error",
        variant: "error",
        className: expect.stringContaining("rose"),
      });

      expect(formatDocumentStatus("OTHER")).toEqual({
        label: "OTHER",
        variant: "neutral",
        className: expect.stringContaining("slate"),
      });
    });

    it("formatTokens handles small and large counts", () => {
      expect(formatTokens(450)).toBe("450");
      expect(formatTokens(1_500)).toBe("1.5k");
      expect(formatTokens(2_500_000)).toBe("2.50M");
    });

    it("formatCostUsd formats currency with 4 decimal places", () => {
      expect(formatCostUsd(0.045)).toBe("$0.0450");
      expect(formatCostUsd(12.5)).toBe("$12.5000");
    });

    it("parseKeywordsInput normalizes keywords from various formats", () => {
      const input = "Humano, Asesor\n Persona,  , urgente ";
      const result = parseKeywordsInput(input);
      expect(result).toEqual(["humano", "asesor", "persona", "urgente"]);
    });

    it("formatKeywordsOutput joins array with comma and space", () => {
      expect(formatKeywordsOutput(["humano", "asesor", "agente"])).toBe("humano, asesor, agente");
    });
  });

  describe("REST client fetchers", () => {
    it("fetchAiAgentConfig calls GET endpoint and returns data", async () => {
      const mockConfig = {
        id: "cfg-1",
        tenantId: "tenant-1",
        automationMode: "HYBRID_RULES_AI",
        systemDirectives: "Directiva test",
        virtualAliasKey: "platform-smart",
        minConfidenceScore: 0.75,
        humanHandoffKeywords: ["humano", "asesor"],
        outOfHoursReply: null,
        isEnabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: mockConfig }),
      } as Response);

      const result = await fetchAiAgentConfig(BASE_URL);
      expect(result).toEqual(mockConfig);
      expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/api/v1/ai/agent/config`, expect.objectContaining({
        credentials: "include",
      }));
    });

    it("updateAiAgentConfig calls PUT endpoint with payload", async () => {
      const updatePayload = {
        isEnabled: true,
        automationMode: "FULL_AI" as const,
        minConfidenceScore: 0.8,
      };

      const mockUpdated = {
        id: "cfg-1",
        tenantId: "tenant-1",
        automationMode: "FULL_AI",
        systemDirectives: null,
        virtualAliasKey: "platform-smart",
        minConfidenceScore: 0.8,
        humanHandoffKeywords: ["humano"],
        outOfHoursReply: null,
        isEnabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: mockUpdated }),
      } as Response);

      const result = await updateAiAgentConfig(BASE_URL, updatePayload);
      expect(result).toEqual(mockUpdated);
      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/ai/agent/config`,
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify(updatePayload),
        }),
      );
    });

    it("fetchKnowledgeDocuments calls GET with pagination", async () => {
      const mockDocs = {
        documents: [
          {
            id: "doc-1",
            title: "Manual",
            sourceType: "text",
            status: "INDEXED",
            charCount: 100,
            tokenCount: 25,
            chunksCount: 2,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          },
        ],
        total: 1,
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockDocs,
      } as Response);

      const result = await fetchKnowledgeDocuments(BASE_URL, 10, 0);
      expect(result).toEqual(mockDocs);
      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/ai/knowledge/documents?limit=10&offset=0`,
        expect.anything(),
      );
    });

    it("createKnowledgeDocument calls POST endpoint", async () => {
      const payload = {
        title: "Guía de Garantías",
        sourceType: "markdown",
        rawContent: "# Garantías...",
      };

      const createdDoc = {
        id: "doc-2",
        title: payload.title,
        sourceType: payload.sourceType,
        status: "INDEXED",
        charCount: 15,
        tokenCount: 4,
        chunksCount: 1,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => createdDoc,
      } as Response);

      const result = await createKnowledgeDocument(BASE_URL, payload);
      expect(result).toEqual(createdDoc);
      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/ai/knowledge/documents`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("fetchKnowledgeDocumentDetail retrieves document detail with chunks", async () => {
      const detail = {
        id: "doc-1",
        title: "Manual",
        sourceType: "text",
        status: "INDEXED",
        charCount: 100,
        tokenCount: 25,
        chunksCount: 1,
        rawContent: "Contenido completo",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        chunks: [
          {
            id: "chk-1",
            chunkIndex: 0,
            content: "Fragmento 1",
            tokenCount: 25,
            createdAt: "2026-01-01",
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => detail,
      } as Response);

      const result = await fetchKnowledgeDocumentDetail(BASE_URL, "doc-1");
      expect(result).toEqual(detail);
    });

    it("deleteKnowledgeDocument sends DELETE request", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
      } as Response);

      await expect(deleteKnowledgeDocument(BASE_URL, "doc-1")).resolves.toBeUndefined();
      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/ai/knowledge/documents/doc-1`,
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("fetchAiUsageSummary retrieves usage statistics", async () => {
      const summary = {
        totalRequests: 42,
        successfulRequests: 40,
        totalPromptTokens: 1000,
        totalCompletionTokens: 500,
        totalTokens: 1500,
        totalEstimatedCostUsd: 0.015,
        averageLatencyMs: 250,
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => summary,
      } as Response);

      const result = await fetchAiUsageSummary(BASE_URL);
      expect(result).toEqual(summary);
      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/ai/usage/summary`,
        expect.anything(),
      );
    });

    it("throws a descriptive error when fetch response is not ok", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "Module not entitled",
      } as Response);

      await expect(fetchAiAgentConfig(BASE_URL)).rejects.toThrow(
        "Error al obtener configuración del agente (403): Module not entitled",
      );
    });
  });
});
