import { describe, expect, it } from "vitest";
import { normalizeInboundPayload } from "./inbound-normalizer";

const context = {
  channelId: "019c0000-0000-7000-8000-000000000010",
  providerType: "mock" as const,
  tenantId: "019c0000-0000-7000-8000-000000000011",
};

describe("inbound normalizer", () => {
  it("normalizes a generic text message with trusted tenant and channel context", () => {
    const event = normalizeInboundPayload(
      "mock",
      {
        from: "+5215512345678",
        id: "mock-message-1",
        text: "Hola desde WhatsApp",
        timestamp: 1_724_000_000,
        to: "+5215587654321",
      },
      context,
    );

    expect(event).toMatchObject({
      channelId: context.channelId,
      eventType: "MESSAGE_RECEIVED",
      messageType: "text",
      providerMessageId: "mock-message-1",
      providerType: "mock",
      recipientPhone: "+5215587654321",
      senderPhone: "+5215512345678",
      tenantId: context.tenantId,
      textBody: "Hola desde WhatsApp",
    });
    expect(event.direction).toBe("inbound");
    expect(event.timestamp).toEqual(new Date(1_724_000_000_000));
  });

  it("normalizes Meta image messages and delivery statuses", () => {
    const image = normalizeInboundPayload(
      "meta",
      {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "+5215512345678",
                      id: "wamid.image-1",
                      image: {
                        caption: "Factura",
                        id: "media-1",
                        mime_type: "image/jpeg",
                      },
                      timestamp: "1724000000",
                      type: "image",
                    },
                  ],
                  metadata: { display_phone_number: "+5215587654321" },
                },
              },
            ],
          },
        ],
      },
      { ...context, providerType: "meta" },
    );
    expect(image).toMatchObject({
      eventType: "MESSAGE_RECEIVED",
      messageType: "image",
      media: { caption: "Factura", mimeType: "image/jpeg", url: "media-1" },
      providerMessageId: "wamid.image-1",
      recipientPhone: "+5215587654321",
      senderPhone: "+5215512345678",
    });
    expect(image.timestamp).toEqual(new Date(1_724_000_000_000));

    const receipt = normalizeInboundPayload(
      "meta",
      {
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [
                    {
                      id: "wamid.image-1",
                      recipient_id: "+5215512345678",
                      status: "delivered",
                      errorMessage: "provider detail",
                      timestamp: "1724000001",
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      { ...context, providerType: "meta" },
    );
    expect(receipt).toMatchObject({
      eventType: "DELIVERY_RECEIPT",
      eventId: "receipt:wamid.image-1:delivered:2024-08-18T16:53:21.000Z",
      providerMessageId: "wamid.image-1",
      statusUpdate: { errorMessage: "provider detail", status: "delivered" },
    });
    expect(receipt.statusUpdate?.timestamp).toEqual(new Date(1_724_000_001_000));
  });

  it("fails closed to an explicit unknown event without throwing on malformed input", () => {
    const event = normalizeInboundPayload("mock", {}, context);
    expect(event).toMatchObject({
      eventType: "UNKNOWN",
      messageType: "unknown",
      providerMessageId: null,
      senderPhone: null,
      tenantId: context.tenantId,
    });
    expect(() =>
      normalizeInboundPayload("meta", { entry: [] }, { ...context, providerType: "meta" }),
    ).not.toThrow();
  });
});
