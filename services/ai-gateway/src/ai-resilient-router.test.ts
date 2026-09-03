import { afterEach, describe, expect, it, vi } from "vitest";
import { AiAllProvidersFailedError, AiResilientRouter, type AiResolvedRoute } from "./index";

describe("AiResilientRouter Unit Tests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("completes successfully on primary route on first attempt", async () => {
    const router = new AiResilientRouter();

    const routes: AiResolvedRoute[] = [
      {
        routeId: "route-primary",
        targetModelId: "mock-fast-model",
        priority: 1,
        timeoutMs: 5000,
        maxRetries: 2,
        providerType: "mock",
        providerConfigId: "config-1",
        keys: [
          {
            id: "key-1",
            encryptedKey: "enc-1",
            keyMask: "sk-...1111",
            rawApiKey: "valid-key-1",
            status: "active",
            priority: 1,
            totalCalls: 0,
          },
        ],
      },
      {
        routeId: "route-secondary",
        targetModelId: "mock-fallback-model",
        priority: 2,
        timeoutMs: 5000,
        maxRetries: 1,
        providerType: "mock",
        providerConfigId: "config-2",
        keys: [
          {
            id: "key-2",
            encryptedKey: "enc-2",
            keyMask: "sk-...2222",
            rawApiKey: "valid-key-2",
            status: "active",
            priority: 1,
            totalCalls: 0,
          },
        ],
      },
    ];

    const result = await router.routeCompletion({
      aliasKey: "platform-fast",
      messages: [{ role: "user", content: "Hello world" }],
      routes,
    });

    expect(result.content).toContain("Hello world");
    expect(result.modelUsed).toBe("mock-fast-model");
    expect(result.providerUsed).toBe("mock");
    expect(result.attemptsCount).toBe(1);
    expect(result.routingAttempts).toHaveLength(1);
    expect(result.routingAttempts[0]?.status).toBe("success");
    expect(result.routingAttempts[0]?.keyId).toBe("key-1");
  });

  it("rotates API key on 429 rate limit and succeeds on second key in same route", async () => {
    const onKeyRateLimited = vi.fn();
    const router = new AiResilientRouter({ onKeyRateLimited });

    // Mock fetch to simulate 429 on key-1 and 200 on key-2
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const authHeader = init?.headers
        ? (init.headers as Record<string, string>).Authorization
        : "";
      if (authHeader?.includes("rate-limited-key")) {
        return new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          model: "gpt-4o-mini",
          choices: [{ message: { role: "assistant", content: "Recovered with key 2" } }],
          usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const routes: AiResolvedRoute[] = [
      {
        routeId: "route-openai-1",
        targetModelId: "gpt-4o-mini",
        priority: 1,
        timeoutMs: 5000,
        maxRetries: 2,
        providerType: "openai_compatible",
        providerConfigId: "config-openai",
        baseUrl: "https://api.openai.com/v1",
        keys: [
          {
            id: "key-rate-limited",
            encryptedKey: "enc-1",
            keyMask: "sk-...1111",
            rawApiKey: "rate-limited-key",
            status: "active",
            priority: 2, // higher priority, selected first
            totalCalls: 5,
          },
          {
            id: "key-backup",
            encryptedKey: "enc-2",
            keyMask: "sk-...2222",
            rawApiKey: "good-key",
            status: "active",
            priority: 1,
            totalCalls: 10,
          },
        ],
      },
    ];

    const result = await router.routeCompletion({
      aliasKey: "platform-fast",
      messages: [{ role: "user", content: "Test key rotation" }],
      routes,
    });

    globalThis.fetch = originalFetch;

    expect(result.content).toBe("Recovered with key 2");
    expect(result.attemptsCount).toBe(2);
    expect(result.routingAttempts[0]?.status).toBe("rate_limited");
    expect(result.routingAttempts[0]?.keyId).toBe("key-rate-limited");
    expect(result.routingAttempts[1]?.status).toBe("success");
    expect(result.routingAttempts[1]?.keyId).toBe("key-backup");
    expect(onKeyRateLimited).toHaveBeenCalledWith("key-rate-limited", expect.any(Date));
  });

  it("fails over to secondary route when primary route fails with 500 error", async () => {
    const router = new AiResilientRouter();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("broken-provider")) {
        return new Response(JSON.stringify({ error: { message: "Internal server error" } }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          id: "chatcmpl-fallback",
          model: "gemini-2.0-flash",
          choices: [{ message: { role: "assistant", content: "Secondary fallback response" } }],
          usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const routes: AiResolvedRoute[] = [
      {
        routeId: "route-primary-broken",
        targetModelId: "gpt-4o",
        priority: 1,
        timeoutMs: 5000,
        maxRetries: 1,
        providerType: "openai_compatible",
        providerConfigId: "config-broken",
        baseUrl: "https://broken-provider.local/v1",
        keys: [
          {
            id: "key-broken",
            encryptedKey: "enc",
            keyMask: "sk-...0000",
            rawApiKey: "broken-key",
            status: "active",
            priority: 1,
            totalCalls: 0,
          },
        ],
      },
      {
        routeId: "route-secondary-fallback",
        targetModelId: "gemini-2.0-flash",
        priority: 2,
        timeoutMs: 5000,
        maxRetries: 1,
        providerType: "openai_compatible",
        providerConfigId: "config-gemini",
        baseUrl: "https://fallback-provider.local/v1",
        keys: [
          {
            id: "key-fallback",
            encryptedKey: "enc-fb",
            keyMask: "sk-...9999",
            rawApiKey: "fallback-key",
            status: "active",
            priority: 1,
            totalCalls: 0,
          },
        ],
      },
    ];

    const result = await router.routeCompletion({
      aliasKey: "platform-smart",
      messages: [{ role: "user", content: "Test failover" }],
      routes,
    });

    globalThis.fetch = originalFetch;

    expect(result.content).toBe("Secondary fallback response");
    expect(result.attemptsCount).toBe(2);
    expect(result.routingAttempts[0]?.priority).toBe(1);
    expect(result.routingAttempts[0]?.status).toBe("error");
    expect(result.routingAttempts[1]?.priority).toBe(2);
    expect(result.routingAttempts[1]?.status).toBe("success");
  });

  it("throws AiAllProvidersFailedError when all routes fail", async () => {
    const router = new AiResilientRouter();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ error: { message: "Service unavailable" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    });

    const routes: AiResolvedRoute[] = [
      {
        routeId: "route-1",
        targetModelId: "model-1",
        priority: 1,
        timeoutMs: 5000,
        maxRetries: 0,
        providerType: "openai_compatible",
        providerConfigId: "config-1",
        baseUrl: "https://api1.local/v1",
        keys: [
          {
            id: "key-1",
            encryptedKey: "enc-1",
            keyMask: "sk-...1",
            rawApiKey: "key-1",
            status: "active",
            priority: 1,
            totalCalls: 0,
          },
        ],
      },
      {
        routeId: "route-2",
        targetModelId: "model-2",
        priority: 2,
        timeoutMs: 5000,
        maxRetries: 0,
        providerType: "openai_compatible",
        providerConfigId: "config-2",
        baseUrl: "https://api2.local/v1",
        keys: [
          {
            id: "key-2",
            encryptedKey: "enc-2",
            keyMask: "sk-...2",
            rawApiKey: "key-2",
            status: "active",
            priority: 1,
            totalCalls: 0,
          },
        ],
      },
    ];

    await expect(
      router.routeCompletion({
        aliasKey: "platform-reasoning",
        messages: [{ role: "user", content: "Test total failure" }],
        routes,
      }),
    ).rejects.toThrow(AiAllProvidersFailedError);

    globalThis.fetch = originalFetch;
  });

  it("throws AiAllProvidersFailedError if routes list is empty", async () => {
    const router = new AiResilientRouter();
    await expect(
      router.routeCompletion({
        aliasKey: "empty-alias",
        messages: [{ role: "user", content: "Hello" }],
        routes: [],
      }),
    ).rejects.toThrow(AiAllProvidersFailedError);
  });
});
