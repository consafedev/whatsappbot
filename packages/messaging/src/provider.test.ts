import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMessagingCredentialCipher } from "./credentials";
import { MockMessagingProvider } from "./mock-provider";
import { MessageStatusEnum, MessagingProvider } from "./provider";
import { getMessagingProvider } from "./provider-factory";

const key = new Uint8Array(32).fill(7);

describe("messaging provider SPI", () => {
  it("keeps the mock provider framework-agnostic and records successful outbound messages", async () => {
    const provider = new MockMessagingProvider();
    expect(provider).toBeInstanceOf(MessagingProvider);
    const result = await provider.sendText("+5215512345678", "hola", { actor: "test" });
    expect(result).toMatchObject({ status: MessageStatusEnum.SENT });
    expect(provider.sentMessages).toHaveLength(1);
    expect(provider.sentMessages[0]?.message).toBe("hola");
  });

  it.each(["network", "rate_limit", "invalid_number"] as const)(
    "normalizes configured %s failures",
    async (failure) => {
      const result = await new MockMessagingProvider({ failure }).sendText(
        "+5215512345678",
        "hola",
        {},
      );
      expect(result.status).toBe(MessageStatusEnum.FAILED);
      expect(result.providerMessageId).toBeNull();
      expect(result.errorCode).toBeDefined();
    },
  );

  it("normalizes inbound payloads and verifies HMAC signatures", async () => {
    const provider = new MockMessagingProvider();
    const body = Buffer.from('{"text":"hola"}', "utf8");
    const signature = createHmac("sha256", "secret").update(body).digest("hex");
    expect(
      provider.verifyWebhookSignature({ "x-signature": `sha256=${signature}` }, body, "secret"),
    ).toBe(true);
    expect(provider.verifyWebhookSignature({ "x-signature": "bad" }, body, "secret")).toBe(false);
    await expect(
      provider.normalizeInboundPayload({ from: "+5215512345678", text: "hola" }),
    ).resolves.toMatchObject({
      contactPoint: "+5215512345678",
      direction: "inbound",
      origin: "customer",
      textBody: "hola",
    });
  });

  it("uses the mock registry and fails closed for unimplemented providers", async () => {
    expect(getMessagingProvider({ providerType: "mock" })).toBeInstanceOf(MockMessagingProvider);
    expect(() => getMessagingProvider({ providerType: "baileys" })).toThrow(
      "not implemented in this release",
    );
  });

  it("encrypts credentials with authenticated ciphertext and never returns plaintext", () => {
    const cipher = createMessagingCredentialCipher(key);
    const ciphertext = cipher.encrypt({ token: "secret-token" });
    expect(ciphertext).toMatch(/^v1\./);
    expect(ciphertext).not.toContain("secret-token");
    expect(cipher.decrypt(ciphertext)).toEqual({ token: "secret-token" });
    expect(() => cipher.decrypt(`${ciphertext}.tampered`)).toThrow("Unable to decrypt");
  });
});
