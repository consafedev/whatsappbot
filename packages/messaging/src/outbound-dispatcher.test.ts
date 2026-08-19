import { describe, expect, it } from "vitest";
import { MockMessagingProvider } from "./mock-provider";
import { calculateOutboundBackoff, OutboundMessageDispatcher } from "./outbound-dispatcher";

const channel = { active: true, providerType: "mock", status: "connected" } as const;

function dispatcher(provider: MockMessagingProvider): OutboundMessageDispatcher {
  return new OutboundMessageDispatcher({
    assertMessagingEntitled: async () => undefined,
    assertTenantOperational: async () => undefined,
    findChannel: async () => channel,
    now: () => new Date("2026-08-19T12:00:00.000Z"),
    providerFactory: () => provider,
  });
}

describe("OutboundMessageDispatcher", () => {
  it("sends text and media through the provider contract", async () => {
    const provider = new MockMessagingProvider();
    const subject = dispatcher(provider);
    const text = await subject.dispatch({
      channelAccountId: "019c0000-0000-7000-8000-000000000001",
      content: { text: "hola" },
      id: "019c0000-0000-7000-8000-000000000010",
      maxRetries: 3,
      messageType: "text",
      recipientPhone: "+5215512345678",
      retryCount: 0,
      tenantId: "019c0000-0000-7000-8000-000000000002",
    });
    const media = await subject.dispatch({
      channelAccountId: "019c0000-0000-7000-8000-000000000001",
      content: { caption: "foto", mediaUrl: "https://cdn.example.invalid/photo.jpg" },
      id: "019c0000-0000-7000-8000-000000000011",
      maxRetries: 3,
      messageType: "media",
      recipientPhone: "+5215512345678",
      retryCount: 0,
      tenantId: "019c0000-0000-7000-8000-000000000002",
    });

    expect(text.kind).toBe("sent");
    expect(media.kind).toBe("sent");
    expect(provider.sentMessages).toMatchObject([
      { kind: "text", message: "hola", to: "+5215512345678" },
      { caption: "foto", kind: "media", mediaUrl: "https://cdn.example.invalid/photo.jpg" },
    ]);
  });

  it("classifies transient provider errors for retry and permanent errors without retry", async () => {
    const transient = await dispatcher(new MockMessagingProvider({ failure: "network" })).dispatch({
      channelAccountId: "019c0000-0000-7000-8000-000000000001",
      content: { text: "reintentar" },
      id: "019c0000-0000-7000-8000-000000000012",
      maxRetries: 3,
      messageType: "text",
      recipientPhone: "+5215512345678",
      retryCount: 1,
      tenantId: "019c0000-0000-7000-8000-000000000002",
    });
    const permanent = await dispatcher(
      new MockMessagingProvider({ failure: "invalid_number" }),
    ).dispatch({
      channelAccountId: "019c0000-0000-7000-8000-000000000001",
      content: { text: "no enviar" },
      id: "019c0000-0000-7000-8000-000000000013",
      maxRetries: 3,
      messageType: "text",
      recipientPhone: "+5215512345678",
      retryCount: 0,
      tenantId: "019c0000-0000-7000-8000-000000000002",
    });

    expect(transient).toMatchObject({ failureKind: "transient", kind: "failed" });
    expect(permanent).toMatchObject({
      failureKind: "permanent",
      kind: "failed",
      nextRetryAt: null,
    });
  });

  it("calculates deterministic exponential backoff with a cap", () => {
    expect(calculateOutboundBackoff(0)).toBe(1_000);
    expect(calculateOutboundBackoff(1)).toBe(2_000);
    expect(calculateOutboundBackoff(3)).toBe(8_000);
    expect(calculateOutboundBackoff(10)).toBe(60_000);
  });
});
