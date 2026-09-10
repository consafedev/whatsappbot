import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CampaignApiError,
  calculateFunnelStepPercentage,
  calculateProgress,
  cancelCampaign,
  createCampaign,
  createMessageTemplate,
  extractMustacheVariables,
  fetchCampaignAudience,
  fetchCampaignDetail,
  fetchCampaignMetrics,
  fetchCampaigns,
  fetchChannelsForCampaigns,
  fetchMessageTemplates,
  formatAudienceMemberStatus,
  formatCampaignStatus,
  normalizeCampaign,
  pauseCampaign,
  populateAudience,
  startCampaign,
} from "./campaigns-view-model";

describe("normalizeCampaign", () => {
  it("derives flat display fields from nested API relations", () => {
    const normalized = normalizeCampaign({
      id: "cmp-1",
      name: "Promo",
      status: "DRAFT",
      channelAccountId: "chn-1",
      channelAccount: { id: "chn-1", displayName: "Ventas WhatsApp", phoneNumber: "+52" },
      template: { id: "tpl-1", name: "Bienvenida", category: "MARKETING" },
      totalRecipients: 10,
      sentCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      rateLimitPerMinute: 30,
      createdAt: "2026-09-08T00:00:00Z",
      updatedAt: "2026-09-08T00:00:00Z",
    });

    expect(normalized.channelDisplayName).toBe("Ventas WhatsApp");
    expect(normalized.templateName).toBe("Bienvenida");
  });

  it("keeps existing flat fields when nested relations are absent", () => {
    const normalized = normalizeCampaign({
      id: "cmp-2",
      name: "Sin relaciones",
      status: "RUNNING",
      channelAccountId: "chn-2",
      channelDisplayName: "Canal plano",
      totalRecipients: 5,
      sentCount: 1,
      deliveredCount: 1,
      failedCount: 0,
      rateLimitPerMinute: 30,
      createdAt: "2026-09-08T00:00:00Z",
      updatedAt: "2026-09-08T00:00:00Z",
    });

    expect(normalized.channelDisplayName).toBe("Canal plano");
    expect(normalized.templateName).toBeUndefined();
  });
});

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
      expect(res.campaigns[0]?.channelDisplayName).toBeUndefined();
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
            data: { totalAdded: 25, totalRecipients: 25 },
          }),
        });

      const started = await startCampaign(base, "cmp-1");
      expect(started.status).toBe("RUNNING");

      const paused = await pauseCampaign(base, "cmp-1");
      expect(paused.status).toBe("PAUSED");

      const cancelled = await cancelCampaign(base, "cmp-1");
      expect(cancelled.status).toBe("CANCELLED");

      const populated = await populateAudience(base, "cmp-1");
      expect(populated.totalAdded).toBe(25);
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

    it("fetchCampaigns normalizes nested channelAccount/template relations into flat fields", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            campaigns: [
              {
                id: "cmp-9",
                name: "Campaña Anidada",
                status: "RUNNING",
                channelAccountId: "chn-9",
                channelAccount: { id: "chn-9", displayName: "Soporte WA", phoneNumber: null },
                template: { id: "tpl-9", name: "Promo Verano" },
                totalRecipients: 3,
                sentCount: 1,
                deliveredCount: 1,
                failedCount: 0,
                rateLimitPerMinute: 60,
                createdAt: "2026-09-08T00:00:00Z",
                updatedAt: "2026-09-08T00:00:00Z",
              },
            ],
            total: 1,
            limit: 20,
            offset: 0,
          },
        }),
      });

      const res = await fetchCampaigns(base);
      expect(res.campaigns[0]?.channelDisplayName).toBe("Soporte WA");
      expect(res.campaigns[0]?.templateName).toBe("Promo Verano");
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

    it("fetches campaign metrics and parses the API data envelope", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            totalRecipients: 100,
            sentCount: 95,
            deliveredCount: 90,
            readCount: 60,
            failedCount: 5,
            pendingCount: 5,
            deliveryRate: 94.74,
            readRate: 66.67,
            failureRate: 5.26,
          },
        }),
      });

      const metrics = await fetchCampaignMetrics(base, "cmp-100");
      expect(metrics.totalRecipients).toBe(100);
      expect(metrics.sentCount).toBe(95);
      expect(metrics.deliveredCount).toBe(90);
      expect(metrics.readCount).toBe(60);
      expect(metrics.failedCount).toBe(5);
      expect(metrics.pendingCount).toBe(5);
      expect(metrics.deliveryRate).toBe(94.74);
      expect(metrics.readRate).toBe(66.67);
      expect(metrics.failureRate).toBe(5.26);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/api/v1/campaigns/cmp-100/metrics",
        expect.objectContaining({ method: "GET", credentials: "include" }),
      );
    });

    it("throws CampaignApiError when fetchCampaignMetrics fails", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          message: "Campaign not found",
        }),
      });

      await expect(fetchCampaignMetrics(base, "cmp-nonexistent")).rejects.toThrow(CampaignApiError);
    });

    it("fetches audience members and normalizes contact relations", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            members: [
              {
                id: "mem-1",
                contactId: "ct-1",
                status: "READ",
                sentAt: "2026-09-08T10:00:00Z",
                deliveredAt: "2026-09-08T10:01:00Z",
                readAt: "2026-09-08T10:05:00Z",
                errorMessage: null,
                contact: {
                  id: "ct-1",
                  name: "Juan Perez",
                  phoneNumber: "+5215512345678",
                  email: "juan@example.com",
                },
              },
              {
                id: "mem-2",
                contactId: "ct-2",
                status: "FAILED",
                sentAt: "2026-09-08T10:00:00Z",
                deliveredAt: null,
                readAt: null,
                errorMessage: "Number not registered on WhatsApp",
                contact: null,
                contactName: "Contacto Desconocido",
                phoneNumber: "+5215587654321",
              },
            ],
            total: 2,
            limit: 50,
            offset: 0,
          },
        }),
      });

      const res = await fetchCampaignAudience(base, "cmp-100", {
        status: "READ",
        limit: 10,
        offset: 0,
      });
      expect(res.total).toBe(2);
      expect(res.members).toHaveLength(2);
      expect(res.members[0]?.contactName).toBe("Juan Perez");
      expect(res.members[0]?.phoneNumber).toBe("+5215512345678");
      expect(res.members[0]?.email).toBe("juan@example.com");
      expect(res.members[0]?.status).toBe("READ");
      expect(res.members[1]?.contactName).toBe("Contacto Desconocido");
      expect(res.members[1]?.errorMessage).toBe("Number not registered on WhatsApp");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/api/v1/campaigns/cmp-100/audience?status=READ&limit=10&offset=0",
        expect.objectContaining({ method: "GET" }),
      );
    });
  });

  describe("formatAudienceMemberStatus", () => {
    it("returns correct details for PENDING", () => {
      const details = formatAudienceMemberStatus("PENDING");
      expect(details.label).toBe("Pendiente");
      expect(details.variant).toBe("neutral");
    });

    it("returns correct details for SENT", () => {
      const details = formatAudienceMemberStatus("SENT");
      expect(details.label).toBe("Enviado");
      expect(details.variant).toBe("info");
    });

    it("returns correct details for DELIVERED", () => {
      const details = formatAudienceMemberStatus("DELIVERED");
      expect(details.label).toBe("Entregado");
      expect(details.variant).toBe("info");
    });

    it("returns correct details for READ", () => {
      const details = formatAudienceMemberStatus("READ");
      expect(details.label).toBe("Leído");
      expect(details.variant).toBe("success");
    });

    it("returns correct details for FAILED", () => {
      const details = formatAudienceMemberStatus("FAILED");
      expect(details.label).toBe("Fallido");
      expect(details.variant).toBe("danger");
    });

    it("returns fallback for unknown status", () => {
      const details = formatAudienceMemberStatus("UNKNOWN_STATUS");
      expect(details.label).toBe("UNKNOWN_STATUS");
      expect(details.variant).toBe("neutral");
    });
  });

  describe("calculateFunnelStepPercentage", () => {
    it("returns 0 when base is 0 or negative", () => {
      expect(calculateFunnelStepPercentage(10, 0)).toBe(0);
      expect(calculateFunnelStepPercentage(10, -5)).toBe(0);
    });

    it("returns 0 when current is 0 or negative", () => {
      expect(calculateFunnelStepPercentage(0, 100)).toBe(0);
      expect(calculateFunnelStepPercentage(-10, 100)).toBe(0);
    });

    it("returns 0 for non-finite numbers", () => {
      expect(calculateFunnelStepPercentage(Number.NaN, 100)).toBe(0);
      expect(calculateFunnelStepPercentage(50, Number.POSITIVE_INFINITY)).toBe(0);
    });

    it("calculates exact percentage with one decimal place", () => {
      expect(calculateFunnelStepPercentage(50, 100)).toBe(50);
      expect(calculateFunnelStepPercentage(1, 3)).toBe(33.3);
      expect(calculateFunnelStepPercentage(95, 100)).toBe(95);
      expect(calculateFunnelStepPercentage(90, 95)).toBe(94.7);
    });

    it("clamps result to 100 maximum", () => {
      expect(calculateFunnelStepPercentage(150, 100)).toBe(100);
    });
  });
});
