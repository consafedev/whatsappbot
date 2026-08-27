import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChannelApiError,
  calculateQrTtlRemaining,
  createChannel,
  disconnectChannel,
  fetchChannelHealth,
  fetchChannelQr,
  fetchChannels,
  formatChannelStatus,
  formatLatency,
  formatRelativeTime,
  formatSocketStatus,
  initiateChannelPairing,
} from "./channels-view-model";

describe("channels view model", () => {
  describe("formatChannelStatus", () => {
    it("formats CONNECTED status correctly", () => {
      const res1 = formatChannelStatus("connected");
      expect(res1.variant).toBe("success");
      expect(res1.label).toBe("Conectado");
      expect(res1.dotColor).toBe("#2b8a3e");

      const res2 = formatChannelStatus("CONNECTED");
      expect(res2.variant).toBe("success");
      expect(res2.label).toBe("Conectado");
    });

    it("formats CONNECTING and PAIRING statuses correctly", () => {
      const res1 = formatChannelStatus("connecting");
      expect(res1.variant).toBe("info");
      expect(res1.label).toBe("Conectando...");

      const res2 = formatChannelStatus("pairing");
      expect(res2.variant).toBe("info");
      expect(res2.label).toBe("Conectando...");
    });

    it("formats QR_READY status correctly", () => {
      const res = formatChannelStatus("qr_ready");
      expect(res.variant).toBe("warn");
      expect(res.label).toBe("Esperando escaneo");
      expect(res.dotColor).toBe("#f59f00");
    });

    it("formats DISCONNECTED status correctly", () => {
      const res = formatChannelStatus("disconnected");
      expect(res.variant).toBe("neutral");
      expect(res.label).toBe("Desconectado");
      expect(res.dotColor).toBe("#868e96");
    });

    it("formats ERROR and FAILED statuses correctly", () => {
      const res1 = formatChannelStatus("error");
      expect(res1.variant).toBe("danger");
      expect(res1.label).toBe("Error");

      const res2 = formatChannelStatus("FAILED");
      expect(res2.variant).toBe("danger");
      expect(res2.label).toBe("Error");
    });

    it("formats ARCHIVED and null/unknown statuses safely", () => {
      const res1 = formatChannelStatus("archived");
      expect(res1.variant).toBe("neutral");
      expect(res1.label).toBe("Archivado");

      const res2 = formatChannelStatus(null);
      expect(res2.variant).toBe("neutral");
      expect(res2.label).toBe("Desconocido");

      const res3 = formatChannelStatus("custom_state");
      expect(res3.variant).toBe("neutral");
      expect(res3.label).toBe("custom_state");
    });
  });

  describe("calculateQrTtlRemaining", () => {
    it("returns expired for null or empty timestamp", () => {
      const res1 = calculateQrTtlRemaining(null);
      expect(res1.isExpired).toBe(true);
      expect(res1.secondsRemaining).toBe(0);
      expect(res1.formattedCountdown).toBe("00:00");

      const res2 = calculateQrTtlRemaining("invalid-date");
      expect(res2.isExpired).toBe(true);
      expect(res2.secondsRemaining).toBe(0);
    });

    it("calculates countdown correctly when within 30s TTL", () => {
      const now = 1700000030000;
      const generatedAt = new Date(1700000020000).toISOString(); // 10 seconds ago

      const res = calculateQrTtlRemaining(generatedAt, now, 30);
      expect(res.isExpired).toBe(false);
      expect(res.secondsRemaining).toBe(20);
      expect(res.formattedCountdown).toBe("00:20");
    });

    it("detects expiration at or past 30 seconds", () => {
      const now = 1700000030000;
      const generatedAt30s = new Date(1700000000000).toISOString(); // exactly 30s ago
      const res1 = calculateQrTtlRemaining(generatedAt30s, now, 30);
      expect(res1.isExpired).toBe(true);
      expect(res1.secondsRemaining).toBe(0);
      expect(res1.formattedCountdown).toBe("00:00");

      const generatedAt45s = new Date(1699999985000).toISOString(); // 45s ago
      const res2 = calculateQrTtlRemaining(generatedAt45s, now, 30);
      expect(res2.isExpired).toBe(true);
      expect(res2.secondsRemaining).toBe(0);
    });
  });

  describe("formatLatency & formatSocketStatus & formatRelativeTime", () => {
    it("formats latency in ms with fallback", () => {
      expect(formatLatency(45.4)).toBe("45 ms");
      expect(formatLatency(0)).toBe("0 ms");
      expect(formatLatency(null)).toBe("—");
      expect(formatLatency(undefined)).toBe("—");
      expect(formatLatency(Number.NaN)).toBe("—");
    });

    it("formats socket status into Spanish", () => {
      expect(formatSocketStatus("open")).toBe("Abierto (Activo)");
      expect(formatSocketStatus("connecting")).toBe("Conectando...");
      expect(formatSocketStatus("closed")).toBe("Cerrado");
      expect(formatSocketStatus("unknown_sock")).toBe("unknown_sock");
      expect(formatSocketStatus(null)).toBe("Desconocido");
    });

    it("formats relative time strings in Spanish", () => {
      const now = 1700000000000;
      expect(formatRelativeTime(null, now)).toBe("Nunca");
      expect(formatRelativeTime("invalid", now)).toBe("—");

      const justNow = new Date(now - 10000).toISOString();
      expect(formatRelativeTime(justNow, now)).toBe("hace unos segundos");

      const fiveMinAgo = new Date(now - 5 * 60 * 1000).toISOString();
      expect(formatRelativeTime(fiveMinAgo, now)).toBe("hace 5 min");

      const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(twoHoursAgo, now)).toBe("hace 2 h");

      const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(threeDaysAgo, now)).toBe("hace 3 d");
    });
  });

  describe("REST API fetchers", () => {
    const apiBase = "http://localhost:3001";

    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("fetchChannels handles both object with items and array response", async () => {
      const mockItems = [
        {
          createdAt: "2026-08-20T00:00:00Z",
          displayName: "WhatsApp Ventas",
          id: "01912345-6789-7abc-def0-1234567890ab",
          isActive: true,
          phoneNumber: "+524771234567",
          providerType: "baileys",
          status: "connected",
          updatedAt: "2026-08-20T00:00:00Z",
        },
      ];

      // 1. Array response
      vi.mocked(fetch).mockResolvedValueOnce({
        json: async () => mockItems,
        ok: true,
        status: 200,
      } as Response);

      const res1 = await fetchChannels(apiBase);
      expect(res1).toEqual(mockItems);
      expect(fetch).toHaveBeenCalledWith(`${apiBase}/api/v1/channels`, expect.anything());

      // 2. Object with items response
      vi.mocked(fetch).mockResolvedValueOnce({
        json: async () => ({ items: mockItems }),
        ok: true,
        status: 200,
      } as Response);

      const res2 = await fetchChannels(apiBase);
      expect(res2).toEqual(mockItems);
    });

    it("fetchChannels parses HTTP errors properly", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        json: async () => ({ code: "FORBIDDEN", message: "Missing permissions" }),
        ok: false,
        status: 403,
      } as Response);

      await expect(fetchChannels(apiBase)).rejects.toThrow(ChannelApiError);
    });

    it("createChannel sends payload and returns created channel", async () => {
      const payload = {
        displayName: "Nueva Línea",
        organizationUnitId: "01912345-0000-7000-8000-000000000001",
        phoneNumber: "+524779998877",
        providerType: "baileys",
      };

      const mockCreated = {
        ...payload,
        createdAt: "2026-08-27T00:00:00Z",
        id: "01912345-6789-7abc-def0-1234567890cd",
        isActive: true,
        status: "disconnected",
        updatedAt: "2026-08-27T00:00:00Z",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        json: async () => mockCreated,
        ok: true,
        status: 201,
      } as Response);

      const res = await createChannel(apiBase, payload);
      expect(res).toEqual(mockCreated);
      expect(fetch).toHaveBeenCalledWith(
        `${apiBase}/api/v1/channels`,
        expect.objectContaining({
          method: "POST",
        }),
      );
      const callArgs = vi.mocked(fetch).mock.calls[0];
      const requestInit = callArgs ? (callArgs[1] as RequestInit) : undefined;
      const requestBody = typeof requestInit?.body === "string" ? requestInit.body : "{}";
      expect(JSON.parse(requestBody)).toEqual(payload);
    });

    it("initiateChannelPairing calls initiate endpoint", async () => {
      const channelId = "01912345-6789-7abc-def0-1234567890ab";
      const mockPairing = {
        channelAccountId: channelId,
        displayName: "WhatsApp Ventas",
        phoneNumber: null,
        status: "CONNECTING",
        updatedAt: "2026-08-27T00:00:00Z",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        json: async () => mockPairing,
        ok: true,
        status: 200,
      } as Response);

      const res = await initiateChannelPairing(apiBase, channelId);
      expect(res).toEqual(mockPairing);
      expect(fetch).toHaveBeenCalledWith(
        `${apiBase}/api/v1/channels/${channelId}/pair/initiate`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("fetchChannelQr gets QR code payload with TTL state", async () => {
      const channelId = "01912345-6789-7abc-def0-1234567890ab";
      const mockQr = {
        isExpired: false,
        qrGeneratedAt: "2026-08-27T10:00:00Z",
        qrRaw: "2@fake-qr-code-raw-string",
        status: "QR_READY",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        json: async () => mockQr,
        ok: true,
        status: 200,
      } as Response);

      const res = await fetchChannelQr(apiBase, channelId);
      expect(res).toEqual(mockQr);
      expect(fetch).toHaveBeenCalledWith(
        `${apiBase}/api/v1/channels/${channelId}/pair/qr`,
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("disconnectChannel sends disconnect mutation", async () => {
      const channelId = "01912345-6789-7abc-def0-1234567890ab";
      const mockDisconnect = {
        channelAccountId: channelId,
        displayName: "WhatsApp Ventas",
        phoneNumber: "+524771234567",
        status: "DISCONNECTED",
        updatedAt: "2026-08-27T00:00:00Z",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        json: async () => mockDisconnect,
        ok: true,
        status: 200,
      } as Response);

      const res = await disconnectChannel(apiBase, channelId, "Manual logout");
      expect(res).toEqual(mockDisconnect);
      expect(fetch).toHaveBeenCalledWith(
        `${apiBase}/api/v1/channels/${channelId}/disconnect`,
        expect.objectContaining({
          body: JSON.stringify({ reason: "Manual logout" }),
          method: "POST",
        }),
      );
    });

    it("fetchChannelHealth returns diagnostic telemetry", async () => {
      const channelId = "01912345-6789-7abc-def0-1234567890ab";
      const mockHealth = {
        isDegraded: false,
        isHealthy: true,
        lastHeartbeatAt: "2026-08-27T10:30:00Z",
        lastLatencyMs: 32,
        reconnectAttempts: 0,
        socketStatus: "open" as const,
        status: "connected",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        json: async () => mockHealth,
        ok: true,
        status: 200,
      } as Response);

      const res = await fetchChannelHealth(apiBase, channelId);
      expect(res).toEqual(mockHealth);
      expect(fetch).toHaveBeenCalledWith(
        `${apiBase}/api/v1/channels/${channelId}/health`,
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("handles 404 cross-tenant isolation and 409 conflict correctly", async () => {
      const channelId = "01912345-6789-7abc-def0-123456789099";

      // 404
      vi.mocked(fetch).mockResolvedValueOnce({
        json: async () => ({ message: "Channel not found" }),
        ok: false,
        status: 404,
      } as Response);

      await expect(fetchChannelHealth(apiBase, channelId)).rejects.toThrow("Canal no encontrado");

      // 409
      vi.mocked(fetch).mockResolvedValueOnce({
        json: async () => ({
          code: "CHANNEL_ALREADY_CONNECTED",
          message: "Channel account is already connected",
        }),
        ok: false,
        status: 409,
      } as Response);

      await expect(initiateChannelPairing(apiBase, channelId)).rejects.toMatchObject({
        code: "CHANNEL_ALREADY_CONNECTED",
        statusCode: 409,
      });
    });
  });
});
