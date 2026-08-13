import { describe, expect, it } from "vitest";
import {
  ConfigurationError,
  loadDatabaseConfig,
  loadNonSecretConfig,
  loadRuntimeConfig,
  loadSecretConfig,
} from "./index";

describe("configuration", () => {
  it("applies safe non-secret defaults and environment overrides", () => {
    const defaults = loadNonSecretConfig({});
    const overrides = loadNonSecretConfig({ API_PORT: "4100", LOG_LEVEL: "debug" });

    expect(defaults).toEqual({
      apiPort: 3001,
      environment: "development",
      logLevel: "info",
      platformWebOrigin: "http://localhost:3000",
      tenantWebOrigin: "http://localhost:3000",
      webPort: 3000,
    });
    expect(overrides.apiPort).toBe(4100);
    expect(overrides.logLevel).toBe("debug");
  });

  it("fails clearly when required secrets are missing", () => {
    expect(() => loadSecretConfig({})).toThrowError(ConfigurationError);
    expect(() => loadSecretConfig({})).toThrowError(/DATABASE_URL.*REDIS_URL/);
  });

  it("loads database configuration without requiring unrelated secrets", () => {
    expect(
      loadDatabaseConfig({
        DATABASE_URL: "postgresql://user:password@localhost:5432/platform",
      }),
    ).toEqual({ databaseUrl: "postgresql://user:password@localhost:5432/platform" });
  });

  it("loads validated secret and non-secret configuration together", () => {
    const config = loadRuntimeConfig({
      API_PORT: "3200",
      DATABASE_URL: "postgresql://user:password@localhost:5432/platform",
      NODE_ENV: "test",
      REDIS_URL: "redis://:password@localhost:6379",
    });

    expect(config).toMatchObject({
      apiPort: 3200,
      databaseUrl: "postgresql://user:password@localhost:5432/platform",
      environment: "test",
      redisUrl: "redis://:password@localhost:6379",
    });
  });
});
