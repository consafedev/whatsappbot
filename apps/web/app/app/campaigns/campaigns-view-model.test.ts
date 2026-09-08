import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CampaignApiError,
  calculateProgress,
  cancelCampaign,
  createCampaign,
  createMessageTemplate,
  extractMustacheVariables,
  fetchCampaignDetail,
  fetchCampaigns,
  fetchChannelsForCampaigns,
  fetchMessageTemplates,
  formatCampaignStatus,
  pauseCampaign,
  populateAudience,
  startCampaign,
} from "./campaigns-view-model";

describe("campaigns-view-model", () => {
  describe("formatCampaignStatus", () => {
    it("returns correct badge details for DRAFT", () => {
      const details = formatCampaignStatus("DRAFT");
      expect(details.label).toBe("Borrador");
      expect(details.variant).toBe("neutral");
      expect(details.dotColor).toBe("#868e96");
    });

    it("returns correct badge details for SCHEDULED", () => {
      const details = formatCampaignStatus("SCHEDULED");
      expect(details.label).toBe("Programada");
      expect(details.variant).toBe("info");
    });

    it("returns correct badge details for RUNNING", () => {
      const details = formatCampaignStatus("RUNNING");
      expect(details.label).toBe("En ejecución");
      expect(details.variant).toBe("info");
    });

    it("returns correct badge details for PAUSED", () => {
      const details = formatCampaignStatus("PAUSED");
      expect(details.label).toBe("Pausada");
      expect(details.variant).toBe("warn");
    });

    it("returns correct badge details for COMPLETED", () => {
      const details = formatCampaignStatus("COMPLETED");
      expect(details.label).toBe("Completada");
      expect(details.variant).toBe("success");
    });

    it("returns correct badge details for CANCELLED", () => {
      const details = formatCampaignStatus("CANCELLED");
      expect(details.label).toBe("Cancelada");
      expect(details.variant).toBe("neutral");
    });

    it("returns correct badge details for FAILED", () => {
      const details = formatCampaignStatus("FAILED");
      expect(details.label).toBe("Fallida");
      expect(details.variant).toBe("danger");
    });

    it("handles lowercase or mixed case gracefully", () => {
      const details = formatCampaignStatus("running");
      expect(details.label).toBe("En ejecución");
    });

    it("handles unknown or null statuses gracefully", () => {
      expect(formatCampaignStatus(null).label).toBe("Desconocido");
      expect(formatCampaignStatus("SOMETHING_ELSE").label).toBe("SOMETHING_ELSE");
    });
  });

  describe("calculateProgress", () => {
    it("calculates 0% when recipients is 0 or negative", () => {
      expect(calculateProgress(0, 0)).toBe(0);
      expect(calculateProgress(10, 0)).toBe(0);
      expect(calculateProgress(10, -5)).toBe(0);
    });

    it("calculates 0% when sentCount is 0 or negative", () => {
      expect(calculateProgress(0, 100)).toBe(0);
      expect(calculateProgress(-1, 100)).toBe(0);
    });

    it("calculates exact rounded percentages correctly", () => {
      expect(calculateProgress(50, 100)).toBe(50);
      expect(calculateProgress(1, 3)).toBe(33);
      expect(calculateProgress(2, 3)).toBe(67);
      expect(calculateProgress(100, 100)).toBe(100);
    });

    it("caps at 100% if sentCount exceeds totalRecipients", () => {
      expect(calculateProgress(150, 100)).toBe(100);
    });

    it("handles NaN safely", () => {
      expect(calculateProgress(Number.NaN, 100)).toBe(0);
      expect(calculateProgress(50, Number.NaN)).toBe(0);
    });
  });

  describe("extractMustacheVariables", () => {
    it("returns empty array for empty or null content", () => {
      expect(extractMustacheVariables("")).toEqual([]);
      expect(extractMustacheVariables(null)).toEqual([]);
    });

    it("returns empty array when no variables are present", () => {
      expect(extractMustacheVariables("Hola mundo sin variables")).toEqual([]);
    });

    it("extracts unique variables with standard syntax", () => {
      const text = "Hola {{nombre}}, tu saldo es {{saldo}} en {{fecha}}.";
      expect(extractMustacheVariables(text)).toEqual(["nombre", "saldo", "fecha"]);
    });

    it("trims whitespace inside braces and deduplicates", () => {
      const text = "Hola {{ nombre  }}, bienvenido {{nombre}} a {{ empresa }}!";
      expect(extractMustacheVariables(text)).toEqual(["nombre", "empresa"]);
    });
  });

  describe("REST client functions", () => {
    const originalFetch = globalThis.fetch;
    const base = "http://localhost:3001";

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("fetchCampaigns parses query params and returns campaign list", async () => {
      const mockCampaigns = [
        {
          id: "cmp-1",
          name: "Promo Verano",
          status: "DRAFT",
          channelAccountId: "chn-1",
          totalRecipients: 100,
          sentCount: 0,
          deliveredCount: 0,
          readCount: 0,
          failedCount: 0,
          rateLimitPerMinute: 30,
          createdAt: "2026-09-08T00:00:00Z",
          updatedAt: "2026-09-08T00:00:00Z",
        },
      ];

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            campaigns: mockCampaigns,
            total: 1,
            limit: 20,
            offset: 0,
          },
        }),
      });

      const res = await fetchCampaigns(base, { status: "DRAFT", limit: 20, offset: 0 });
      expect(res.campaigns).toHaveLength(1);
      expect(res.total).toBe(1);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/api/v1/campaigns?status=DRAFT&limit=20&offset=0",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("fetchCampaignDetail retrieves single campaign", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: "cmp-1",
            name: "Promo Verano",
            status: "DRAFT",
            channelAccountId: "chn-1",
            messageContent: "Hola {{nombre}}",
            totalRecipients: 50,
          },
        }),
      });

      const detail = await fetchCampaignDetail(base, "cmp-1");
      expect(detail.id).toBe("cmp-1");
      expect(detail.messageContent).toBe("Hola {{nombre}}");
    });

    it("createCampaign sends JSON POST and returns created item", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: "cmp-new",
            name: "Nueva Campaña",
            status: "DRAFT",
            channelAccountId: "chn-1",
          },
        }),
      });

      const res = await createCampaign(base, {
        name: "Nueva Campaña",
        channelAccountId: "chn-1",
        messageContent: "Mensaje de prueba",
        rateLimitPerMinute: 45,
      });

      expect(res.id).toBe("cmp-new");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/api/v1/campaigns",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            name: "Nueva Campaña",
            channelAccountId: "chn-1",
            messageContent: "Mensaje de prueba",
            rateLimitPerMinute: 45,
          }),
        }),
      );
    });

    it("startCampaign, pauseCampaign, cancelCampaign and populateAudience call expected POST routes", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "cmp-1", status: "RUNNING" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "cmp-1", status: "PAUSED" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "cmp-1", status: "CANCELLED" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: { campaignId: "cmp-1", populatedCount: 25, totalRecipients: 25 },
          }),
        });

      const started = await startCampaign(base, "cmp-1");
      expect(started.status).toBe("RUNNING");

      const paused = await pauseCampaign(base, "cmp-1");
      expect(paused.status).toBe("PAUSED");

      const cancelled = await cancelCampaign(base, "cmp-1");
      expect(cancelled.status).toBe("CANCELLED");

      const populated = await populateAudience(base, "cmp-1");
      expect(populated.populatedCount).toBe(25);
    });

    it("fetchMessageTemplates and createMessageTemplate work correctly", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: "tpl-1", name: "Bienvenida", content: "Hola {{1}}" }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: { id: "tpl-2", name: "Recordatorio", content: "Recordatorio {{1}}" },
          }),
        });

      const templates = await fetchMessageTemplates(base, "MARKETING");
      expect(templates).toHaveLength(1);
      expect(templates[0]?.name).toBe("Bienvenida");

      const created = await createMessageTemplate(base, {
        name: "Recordatorio",
        content: "Recordatorio {{1}}",
      });
      expect(created.id).toBe("tpl-2");
    });

    it("fetchChannelsForCampaigns extracts channel accounts", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: "chn-1",
              displayName: "Ventas WhatsApp",
              phoneNumber: "+5215551234567",
              providerType: "baileys",
              status: "connected",
            },
          ],
        }),
      });

      const channels = await fetchChannelsForCampaigns(base);
      expect(channels).toHaveLength(1);
      expect(channels[0]?.displayName).toBe("Ventas WhatsApp");
    });

    it("handles API error responses and throws CampaignApiError", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          message: "Campaign name is required",
          code: "VALIDATION_FAILED",
        }),
      });

      await expect(createCampaign(base, { name: "", channelAccountId: "chn-1" })).rejects.toThrow(
        CampaignApiError,
      );
    });
  });
});
