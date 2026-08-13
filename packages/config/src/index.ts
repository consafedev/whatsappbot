import { z } from "zod";

const portSchema = z.coerce.number().int().min(1).max(65_535);

const nonSecretEnvironmentSchema = z.object({
  API_PORT: portSchema.default(3001),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PLATFORM_WEB_ORIGIN: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
  TENANT_WEB_ORIGIN: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
  WEB_PORT: portSchema.default(3000),
});

const secretEnvironmentSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^redis(s)?$/ }),
});

const databaseEnvironmentSchema = secretEnvironmentSchema.pick({ DATABASE_URL: true });

export interface NonSecretConfig {
  readonly apiPort: number;
  readonly environment: "development" | "test" | "production";
  readonly logLevel: "debug" | "info" | "warn" | "error";
  readonly platformWebOrigin: string;
  readonly tenantWebOrigin: string;
  readonly webPort: number;
}

export interface SecretConfig {
  readonly databaseUrl: string;
  readonly redisUrl: string;
}

export interface DatabaseConfig {
  readonly databaseUrl: string;
}

export type RuntimeConfig = NonSecretConfig & SecretConfig;

export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
}

function parseOrThrow<T>(schema: z.ZodType<T>, environment: NodeJS.ProcessEnv): T {
  const result = schema.safeParse(environment);

  if (!result.success) {
    throw new ConfigurationError(
      `Invalid application configuration: ${formatIssues(result.error)}`,
    );
  }

  return result.data;
}

export function loadNonSecretConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Readonly<NonSecretConfig> {
  const values = parseOrThrow(nonSecretEnvironmentSchema, environment);

  return Object.freeze({
    apiPort: values.API_PORT,
    environment: values.NODE_ENV,
    logLevel: values.LOG_LEVEL,
    platformWebOrigin: values.PLATFORM_WEB_ORIGIN,
    tenantWebOrigin: values.TENANT_WEB_ORIGIN,
    webPort: values.WEB_PORT,
  });
}

export function loadSecretConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Readonly<SecretConfig> {
  const values = parseOrThrow(secretEnvironmentSchema, environment);

  return Object.freeze({
    databaseUrl: values.DATABASE_URL,
    redisUrl: values.REDIS_URL,
  });
}

export function loadDatabaseConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Readonly<DatabaseConfig> {
  const values = parseOrThrow(databaseEnvironmentSchema, environment);

  return Object.freeze({ databaseUrl: values.DATABASE_URL });
}

export function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Readonly<RuntimeConfig> {
  return Object.freeze({
    ...loadNonSecretConfig(environment),
    ...loadSecretConfig(environment),
  });
}
