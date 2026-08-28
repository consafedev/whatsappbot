import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiAuthenticationError,
  AiRateLimitError,
  GoogleGeminiEmbeddingProvider,
  MockEmbeddingProvider,
  OpenAiCompatibleEmbeddingProvider,
  createEmbeddingProvider,
} from "./index";

describe("Embedding Providers Unit Tests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("MockEmbeddingProvider", () => {
    it("generates deterministic normalized unit vectors", async () => {
      const provider = new MockEmbeddingProvider();
      const res1 = await provider.generateEmbeddings(
        { input: "Hola mundo", dimensions: 64 },
        { apiKey: "mock-key" },
      );
      const res2 = await provider.generateEmbeddings(
        { input: "Hola mundo", dimensions: 64 },
        { apiKey: "mock-key" },
      );

      expect(res1.embeddings).toHaveLength(1);
      expect(res1.embeddings[0]).toHaveLength(64);
      expect(res1.embeddings[0]).toEqual(res2.embeddings[0]);
      expect(res1.provider).toBe("mock");
      expect(res1.totalTokens).toBeGreaterThan(0);

      // Verify L2 norm is approximately 1.0
      const vec = res1.embeddings[0] ?? [];
      const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
      expect(norm).toBeCloseTo(1.0, 2);
    });

    it("handles batch array inputs", async () => {
      const provider = new MockEmbeddingProvider();
      const res = await provider.generateEmbeddings(
        { input: ["Texto 1", "Texto 2", "Texto 3"], dimensions: 32 },
        { apiKey: "mock-key" },
      );

      expect(res.embeddings).toHaveLength(3);
      expect(res.embeddings[0]).not.toEqual(res.embeddings[1]);
    });
  });

  describe("OpenAiCompatibleEmbeddingProvider", () => {
    it("generates embeddings successfully from /v1/embeddings response", async () => {
      const provider = new OpenAiCompatibleEmbeddingProvider();

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            object: "list",
            data: [
              { object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] },
            ],
            model: "text-embedding-3-small",
            usage: { prompt_tokens: 5, total_tokens: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const res = await provider.generateEmbeddings(
        { input: "Prueba de embedding" },
        { apiKey: "sk-test" },
      );

      expect(res.embeddings).toEqual([[0.1, 0.2, 0.3]]);
      expect(res.totalTokens).toBe(5);
      expect(res.provider).toBe("openai_compatible");
    });

    it("throws AiRateLimitError on HTTP 429", async () => {
      const provider = new OpenAiCompatibleEmbeddingProvider();

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(
        provider.generateEmbeddings({ input: "Test" }, { apiKey: "sk-test" }),
      ).rejects.toThrow(AiRateLimitError);
    });

    it("throws AiAuthenticationError on HTTP 401", async () => {
      const provider = new OpenAiCompatibleEmbeddingProvider();

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(
        provider.generateEmbeddings({ input: "Test" }, { apiKey: "sk-test" }),
      ).rejects.toThrow(AiAuthenticationError);
    });
  });

  describe("GoogleGeminiEmbeddingProvider", () => {
    it("generates embeddings using batchEmbedContents", async () => {
      const provider = new GoogleGeminiEmbeddingProvider();

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            embeddings: [
              { values: [0.5, 0.6, 0.7] },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const res = await provider.generateEmbeddings(
        { input: "Gemini text" },
        { apiKey: "gemini-key" },
      );

      expect(res.embeddings).toEqual([[0.5, 0.6, 0.7]]);
      expect(res.modelId).toBe("text-embedding-004");
      expect(res.provider).toBe("google_gemini");
    });
  });

  describe("createEmbeddingProvider Factory", () => {
    it("instantiates correct provider by type name", () => {
      expect(createEmbeddingProvider("mock")).toBeInstanceOf(MockEmbeddingProvider);
      expect(createEmbeddingProvider("openai_compatible")).toBeInstanceOf(OpenAiCompatibleEmbeddingProvider);
      expect(createEmbeddingProvider("google_gemini")).toBeInstanceOf(GoogleGeminiEmbeddingProvider);
    });
  });
});
