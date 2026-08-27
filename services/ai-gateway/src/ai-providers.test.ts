import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiAuthenticationError,
  AiRateLimitError,
  GoogleGeminiProvider,
  KeyPoolSelector,
  MockAiProvider,
  OpenAiCompatibleProvider,
  createAiProvider,
  decryptApiKey,
  encryptApiKey,
  maskApiKey,
} from "./index";

describe("services/ai-gateway", () => {
  describe("Crypto utilities", () => {
    const secret = "test-secret-key-32-bytes-long!!";

    it("masks API keys properly according to their format", () => {
      expect(maskApiKey("")).toBe("");
      expect(maskApiKey("12345")).toBe("***45");
      expect(maskApiKey("sk-1234567890abcdef1234")).toBe("sk-...1234");
      expect(maskApiKey("AIzaSyD1234567890abcdef")).toBe("AIza...cdef");
      expect(maskApiKey("custom_api_key_value_9999")).toBe("cus...9999");
    });

    it("encrypts and decrypts API keys symmetrically with AES-256-GCM", () => {
      const apiKey = "sk-live-test-secret-key-999";
      const encrypted = encryptApiKey(apiKey, secret);
      expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      const decrypted = decryptApiKey(encrypted, secret);
      expect(decrypted).toBe(apiKey);
    });

    it("throws on corrupted ciphertext", () => {
      expect(() => decryptApiKey("invalid.cipher.text", secret)).toThrow();
    });
  });

  describe("KeyPoolSelector", () => {
    it("selects the active key with the highest priority and fewest calls", () => {
      const keys = [
        {
          id: "k1",
          encryptedKey: "enc1",
          keyMask: "sk-...1",
          status: "active",
          priority: 1,
          totalCalls: 5,
        },
        {
          id: "k2",
          encryptedKey: "enc2",
          keyMask: "sk-...2",
          status: "active",
          priority: 2,
          totalCalls: 10,
        },
        {
          id: "k3",
          encryptedKey: "enc3",
          keyMask: "sk-...3",
          status: "active",
          priority: 2,
          totalCalls: 2,
        },
      ];

      const selected = KeyPoolSelector.selectNextKey(keys);
      expect(selected?.id).toBe("k3"); // priority 2, lowest calls (2 < 10)
    });

    it("excludes disabled keys", () => {
      const keys = [
        {
          id: "k1",
          encryptedKey: "enc1",
          keyMask: "sk-...1",
          status: "disabled",
          priority: 5,
          totalCalls: 0,
        },
      ];

      expect(KeyPoolSelector.selectNextKey(keys)).toBeNull();
    });

    it("excludes rate-limited keys unless cooldown has expired", () => {
      const now = new Date("2026-08-27T12:00:00Z");
      const keys = [
        {
          id: "k-future",
          encryptedKey: "enc1",
          keyMask: "sk-...1",
          status: "rate_limited",
          rateLimitedUntil: new Date("2026-08-27T12:05:00Z"), // in 5 mins
          priority: 1,
          totalCalls: 0,
        },
        {
          id: "k-expired",
          encryptedKey: "enc2",
          keyMask: "sk-...2",
          status: "rate_limited",
          rateLimitedUntil: new Date("2026-08-27T11:55:00Z"), // 5 mins ago
          priority: 1,
          totalCalls: 0,
        },
      ];

      const selected = KeyPoolSelector.selectNextKey(keys, now);
      expect(selected?.id).toBe("k-expired");
    });
  });

  describe("MockAiProvider", () => {
    const provider = new MockAiProvider();

    it("generates deterministic completion response", async () => {
      const res = await provider.generateCompletion(
        {
          model: "mock-model",
          messages: [{ role: "user", content: "Hola mundo" }],
        },
        { apiKey: "mock-key" },
      );

      expect(res.content).toContain("Hola mundo");
      expect(res.model).toBe("mock-model");
      expect(res.usage.promptTokens).toBeGreaterThan(0);
      expect(res.usage.completionTokens).toBe(16);
      expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns available mock models", async () => {
      const models = await provider.fetchAvailableModels({ apiKey: "mock-key" });
      expect(models).toEqual(["mock-gpt-4o", "mock-gemini-pro", "mock-llama-3"]);
    });
  });

  describe("OpenAiCompatibleProvider", () => {
    const provider = new OpenAiCompatibleProvider({ timeoutMs: 2000 });
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("generates completion against standard OpenAI endpoint", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "chatcmpl-123",
          model: "gpt-4o",
          choices: [
            {
              message: { content: "Respuesta de prueba" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 15,
            completion_tokens: 25,
            total_tokens: 40,
          },
        }),
      } as unknown as Response);

      const res = await provider.generateCompletion(
        {
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hola" }],
        },
        { apiKey: "sk-test", baseUrl: "https://api.openai.com/v1" },
      );

      expect(res.content).toBe("Respuesta de prueba");
      expect(res.model).toBe("gpt-4o");
      expect(res.usage.totalTokens).toBe(40);
    });

    it("fetches available models from /v1/models", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "gpt-4o" }, { id: "deepseek-chat" }, { id: "llama-3-70b" }],
        }),
      } as unknown as Response);

      const models = await provider.fetchAvailableModels({ apiKey: "sk-test" });
      expect(models).toEqual(["gpt-4o", "deepseek-chat", "llama-3-70b"]);
    });

    it("throws AiAuthenticationError on 401", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { message: "Invalid API key" } }),
      } as unknown as Response);

      await expect(
        provider.generateCompletion(
          { model: "gpt-4o", messages: [{ role: "user", content: "Hola" }] },
          { apiKey: "invalid-key" },
        ),
      ).rejects.toThrow(AiAuthenticationError);
    });

    it("throws AiRateLimitError on 429", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: { message: "Rate limit exceeded" } }),
      } as unknown as Response);

      await expect(
        provider.generateCompletion(
          { model: "gpt-4o", messages: [{ role: "user", content: "Hola" }] },
          { apiKey: "rate-limited-key" },
        ),
      ).rejects.toThrow(AiRateLimitError);
    });
  });

  describe("GoogleGeminiProvider", () => {
    const provider = new GoogleGeminiProvider({ timeoutMs: 2000 });
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("generates completion against Gemini generateContent endpoint", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Respuesta desde Gemini" }],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 18,
            totalTokenCount: 30,
          },
        }),
      } as unknown as Response);

      const res = await provider.generateCompletion(
        {
          model: "gemini-1.5-flash",
          messages: [{ role: "user", content: "Explica la fotosíntesis" }],
        },
        { apiKey: "AIzaTestKey" },
      );

      expect(res.content).toBe("Respuesta desde Gemini");
      expect(res.usage.totalTokens).toBe(30);
    });

    it("fetches available models from Gemini endpoint", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            { name: "models/gemini-1.5-flash", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemini-1.5-pro", supportedGenerationMethods: ["generateContent"] },
          ],
        }),
      } as unknown as Response);

      const models = await provider.fetchAvailableModels({ apiKey: "AIzaTestKey" });
      expect(models).toEqual(["gemini-1.5-flash", "gemini-1.5-pro"]);
    });

    it("throws AiRateLimitError on 429 quota exhaustion", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: { message: "RESOURCE_EXHAUSTED" } }),
      } as unknown as Response);

      await expect(
        provider.generateCompletion(
          { model: "gemini-1.5-flash", messages: [{ role: "user", content: "Hola" }] },
          { apiKey: "AIzaTestKey" },
        ),
      ).rejects.toThrow(AiRateLimitError);
    });
  });

  describe("Provider Factory", () => {
    it("creates the correct provider instances", () => {
      expect(createAiProvider("mock")).toBeInstanceOf(MockAiProvider);
      expect(createAiProvider("openai_compatible")).toBeInstanceOf(OpenAiCompatibleProvider);
      expect(createAiProvider("google_gemini")).toBeInstanceOf(GoogleGeminiProvider);
    });
  });
});
