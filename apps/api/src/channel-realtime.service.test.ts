import type { MessageEvent } from "@nestjs/common";
import { filter, firstValueFrom, take, timeout } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
  type ChannelRealtimeEvent,
  type ChannelRealtimeHttpResponse,
  ChannelRealtimeService,
  parseChannelOutboxEvent,
} from "./channel-realtime.service";

const sampleQrEvent = (tenantId: string): ChannelRealtimeEvent => ({
  aggregateId: "019c0000-0000-7000-8000-000000000001",
  aggregateType: "ChannelAccount",
  data: {
    channelAccountId: "019c0000-0000-7000-8000-000000000001",
    qrGeneratedAt: "2026-08-27T12:00:00.000Z",
    qrRaw: "2@fake-qr-code-raw-string",
    ttlSeconds: 30,
  },
  eventId: `019c0000-0000-7000-8000-${tenantId}`,
  occurredAt: "2026-08-27T12:00:00.000Z",
  type: "channel.qr_generated",
});

describe("ChannelRealtimeService", () => {
  it("publishes only to subscribers in the matching tenant (strict isolation)", async () => {
    const service = new ChannelRealtimeService();
    const tenantA = service.subscribeTenantChannelEvents("tenant-a", 60_000);
    const tenantB = service.subscribeTenantChannelEvents("tenant-b", 60_000);
    const receivedA: MessageEvent[] = [];
    const receivedB: MessageEvent[] = [];
    const subscriptionA = tenantA.subscribe((value) => receivedA.push(value));
    const subscriptionB = tenantB.subscribe((value) => receivedB.push(value));

    service.broadcastToTenant("tenant-a", sampleQrEvent("000000000001"));

    // Tenant A gets initial 'connected' event + 'channel.qr_generated'
    expect(receivedA.length).toBeGreaterThanOrEqual(2);
    expect(receivedA[0]).toMatchObject({ type: "connected" });
    expect(receivedA[1]).toMatchObject({ type: "channel.qr_generated" });
    expect(JSON.parse(String(receivedA[1]?.data))).toMatchObject({
      qrRaw: "2@fake-qr-code-raw-string",
      ttlSeconds: 30,
    });

    // Tenant B gets only initial 'connected' event, NOT Tenant A's QR event
    expect(receivedB).toHaveLength(1);
    expect(receivedB[0]).toMatchObject({ type: "connected" });

    expect(service.subscriberCount("tenant-a")).toBe(1);
    expect(service.subscriberCount("tenant-b")).toBe(1);

    subscriptionA.unsubscribe();
    subscriptionB.unsubscribe();
    expect(service.subscriberCount("tenant-a")).toBe(0);
    expect(service.subscriberCount("tenant-b")).toBe(0);
  });

  it("emits a heartbeat ping and cleans up listener when stream is cancelled", async () => {
    const service = new ChannelRealtimeService();
    const stream = service.subscribeTenantChannelEvents("tenant-a", 5);

    const heartbeat = await firstValueFrom(
      stream.pipe(
        filter((value) => value.type === "ping"),
        take(1),
        timeout({ each: 500 }),
      ),
    );
    expect(heartbeat).toEqual({ data: "{}", type: "ping" });
    expect(service.subscriberCount("tenant-a")).toBe(0);

    const subscription = stream.subscribe();
    expect(service.subscriberCount("tenant-a")).toBe(1);
    subscription.unsubscribe();
    expect(service.subscriberCount("tenant-a")).toBe(0);
  });

  it("addClient registers direct HTTP response stream, sends connected and broadcast events, cleans up on close", () => {
    const service = new ChannelRealtimeService();
    const writtenData: string[] = [];
    const closeHandlers: (() => void)[] = [];

    const mockRes = {
      on: vi.fn((event: string, handler: () => void) => {
        if (event === "close") closeHandlers.push(handler);
        return mockRes;
      }),
      write: vi.fn((data: string) => {
        writtenData.push(data);
        return true;
      }),
    } as unknown as ChannelRealtimeHttpResponse;

    const cleanup = service.addClient("tenant-a", mockRes);
    expect(service.subscriberCount("tenant-a")).toBe(1);
    expect(writtenData[0]).toContain("event: connected");

    // Broadcast connected event to tenant-a
    service.broadcastToTenant("tenant-a", {
      aggregateId: "channel-1",
      aggregateType: "ChannelAccount",
      data: {
        channelAccountId: "channel-1",
        connectedAt: "2026-08-27T12:00:00.000Z",
        phoneNumber: "+524771234567",
      },
      eventId: "event-1",
      occurredAt: "2026-08-27T12:00:00.000Z",
      type: "channel.connected",
    });

    expect(writtenData.some((w) => w.includes("channel.connected"))).toBe(true);

    // Clean up
    cleanup();
    expect(service.subscriberCount("tenant-a")).toBe(0);
  });

  describe("parseChannelOutboxEvent", () => {
    it("parses channel.qr_generated outbox event", () => {
      const parsed = parseChannelOutboxEvent({
        aggregateId: "019c0000-0000-7000-8000-000000000001",
        aggregateType: "ChannelAccount",
        eventType: "channel.qr_generated",
        id: "outbox-1",
        occurredAt: new Date("2026-08-27T12:00:00.000Z"),
        payload: {
          channelAccountId: "019c0000-0000-7000-8000-000000000001",
          qrRaw: "2@sample-qr",
          timestamp: "2026-08-27T12:00:00.000Z",
        },
        tenantId: "tenant-1",
      });

      expect(parsed).toEqual({
        aggregateId: "019c0000-0000-7000-8000-000000000001",
        aggregateType: "ChannelAccount",
        data: {
          channelAccountId: "019c0000-0000-7000-8000-000000000001",
          qrGeneratedAt: "2026-08-27T12:00:00.000Z",
          qrRaw: "2@sample-qr",
          ttlSeconds: 30,
        },
        eventId: "outbox-1",
        occurredAt: "2026-08-27T12:00:00.000Z",
        type: "channel.qr_generated",
      });
    });

    it("parses channel.connected outbox event", () => {
      const parsed = parseChannelOutboxEvent({
        aggregateId: "019c0000-0000-7000-8000-000000000001",
        aggregateType: "ChannelAccount",
        eventType: "channel.connected",
        id: "outbox-2",
        occurredAt: new Date("2026-08-27T12:00:00.000Z"),
        payload: {
          channelAccountId: "019c0000-0000-7000-8000-000000000001",
          phoneNumber: "+524771234567",
          timestamp: "2026-08-27T12:00:00.000Z",
        },
        tenantId: "tenant-1",
      });

      expect(parsed?.type).toBe("channel.connected");
      expect(parsed?.data.phoneNumber).toBe("+524771234567");
    });

    it("parses channel.disconnected outbox event", () => {
      const parsed = parseChannelOutboxEvent({
        aggregateId: "019c0000-0000-7000-8000-000000000001",
        aggregateType: "ChannelAccount",
        eventType: "channel.disconnected",
        id: "outbox-3",
        occurredAt: new Date("2026-08-27T12:00:00.000Z"),
        payload: {
          channelAccountId: "019c0000-0000-7000-8000-000000000001",
          reason: "401 Logged Out",
          statusCode: 401,
          timestamp: "2026-08-27T12:00:00.000Z",
        },
        tenantId: "tenant-1",
      });

      expect(parsed?.type).toBe("channel.disconnected");
      expect(parsed?.data.disconnectReason).toBe("401 Logged Out");
      expect(parsed?.data.statusCode).toBe(401);
    });

    it("parses channel.reconnecting outbox event", () => {
      const parsed = parseChannelOutboxEvent({
        aggregateId: "019c0000-0000-7000-8000-000000000001",
        aggregateType: "ChannelAccount",
        eventType: "channel.reconnecting",
        id: "outbox-4",
        occurredAt: new Date("2026-08-27T12:00:00.000Z"),
        payload: {
          attemptCount: 3,
          channelAccountId: "019c0000-0000-7000-8000-000000000001",
          reason: "503 Service Unavailable",
          statusCode: 503,
          timestamp: "2026-08-27T12:00:00.000Z",
        },
        tenantId: "tenant-1",
      });

      expect(parsed?.type).toBe("channel.reconnecting");
      expect(parsed?.data.attemptCount).toBe(3);
      expect(parsed?.data.reason).toBe("503 Service Unavailable");
    });

    it("returns null for unknown outbox event types", () => {
      const parsed = parseChannelOutboxEvent({
        aggregateId: "conv-1",
        aggregateType: "Conversation",
        eventType: "conversation.created",
        id: "outbox-5",
        occurredAt: new Date(),
        payload: {},
        tenantId: "tenant-1",
      });

      expect(parsed).toBeNull();
    });
  });
});
