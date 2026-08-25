import type { MessageEvent } from "@nestjs/common";
import { filter, firstValueFrom, take, timeout } from "rxjs";
import { describe, expect, it } from "vitest";
import { InboxRealtimeBroadcaster } from "./inbox-realtime.service";

const event = (tenantId: string) => ({
  aggregateId: "019c0000-0000-7000-8000-000000000010",
  aggregateType: "Conversation",
  data: { conversationId: "019c0000-0000-7000-8000-000000000010", newStatus: "pending" },
  eventId: `019c0000-0000-7000-8000-${tenantId}`,
  occurredAt: "2026-08-24T12:00:00.000Z",
  type: "inbox.conversation_status_updated" as const,
});

describe("InboxRealtimeBroadcaster", () => {
  it("publishes only to subscribers in the matching tenant", async () => {
    const broadcaster = new InboxRealtimeBroadcaster();
    const tenantA = broadcaster.subscribeTenantInboxEvents("tenant-a", 60_000);
    const tenantB = broadcaster.subscribeTenantInboxEvents("tenant-b", 60_000);
    const receivedA: MessageEvent[] = [];
    const receivedB: MessageEvent[] = [];
    const subscriptionA = tenantA.subscribe((value) => receivedA.push(value));
    const subscriptionB = tenantB.subscribe((value) => receivedB.push(value));

    broadcaster.publishTenantInboxEvent("tenant-a", event("000000000001"));

    expect(receivedA).toHaveLength(1);
    expect(receivedA[0]).toMatchObject({ type: "inbox.conversation_status_updated" });
    expect(JSON.parse(String(receivedA[0]?.data))).toMatchObject({ newStatus: "pending" });
    expect(receivedB).toHaveLength(0);
    expect(broadcaster.subscriberCount("tenant-a")).toBe(1);
    expect(broadcaster.subscriberCount("tenant-b")).toBe(1);

    subscriptionA.unsubscribe();
    subscriptionB.unsubscribe();
    expect(broadcaster.subscriberCount("tenant-a")).toBe(0);
    expect(broadcaster.subscriberCount("tenant-b")).toBe(0);
  });

  it("emits a heartbeat and removes the listener when the stream is cancelled", async () => {
    const broadcaster = new InboxRealtimeBroadcaster();
    const stream = broadcaster.subscribeTenantInboxEvents("tenant-a", 5);

    const heartbeat = await firstValueFrom(
      stream.pipe(
        filter((value) => value.type === "ping"),
        take(1),
        timeout({ each: 500 }),
      ),
    );
    expect(heartbeat).toEqual({ data: "{}", type: "ping" });
    expect(broadcaster.subscriberCount("tenant-a")).toBe(0);

    const subscription = stream.subscribe();
    expect(broadcaster.subscriberCount("tenant-a")).toBe(1);
    subscription.unsubscribe();
    expect(broadcaster.subscriberCount("tenant-a")).toBe(0);
  });
});
