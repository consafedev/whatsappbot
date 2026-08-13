import { createHash, randomBytes } from "node:crypto";
import { argon2id, hash, verify } from "argon2";

export const PLATFORM_SESSION_ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000;
export const PLATFORM_SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
export const PLATFORM_SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
export const PLATFORM_PASSWORD_MIN_LENGTH = 15;
export const PLATFORM_PASSWORD_MAX_LENGTH = 128;

export type PlatformCookieConfig = Readonly<{
  name: "__Host-platform_session" | "platform_session";
  secure: boolean;
}>;

export class InvalidPlatformPasswordError extends Error {
  override readonly name = "InvalidPlatformPasswordError";
}

export function normalizePlatformAdminEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-US");
}

export function validatePlatformPassword(password: string): void {
  const length = Array.from(password).length;
  if (length < PLATFORM_PASSWORD_MIN_LENGTH || length > PLATFORM_PASSWORD_MAX_LENGTH) {
    throw new InvalidPlatformPasswordError(
      `Password must contain between ${PLATFORM_PASSWORD_MIN_LENGTH} and ${PLATFORM_PASSWORD_MAX_LENGTH} characters`,
    );
  }
}

export class PlatformPasswordHasher {
  async hash(password: string): Promise<string> {
    validatePlatformPassword(password);
    return hash(password, {
      hashLength: 32,
      memoryCost: 19_456,
      parallelism: 1,
      salt: randomBytes(16),
      timeCost: 2,
      type: argon2id,
    });
  }

  verify(encodedHash: string, password: string): Promise<boolean> {
    return verify(encodedHash, password);
  }
}

export function generatePlatformSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPlatformSessionToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function hashPlatformClientAddress(address: string): Buffer {
  return createHash("sha256").update(address, "utf8").digest();
}

export function platformCookieConfig(environment: string): PlatformCookieConfig {
  const secure = environment === "production";
  return {
    name: secure ? "__Host-platform_session" : "platform_session",
    secure,
  };
}

export function serializePlatformSessionCookie(
  token: string,
  config: PlatformCookieConfig,
): string {
  const secure = config.secure ? "; Secure" : "";
  return `${config.name}=${token}; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=${Math.floor(
    PLATFORM_SESSION_ABSOLUTE_TTL_MS / 1000,
  )}`;
}

export function serializeClearedPlatformSessionCookie(config: PlatformCookieConfig): string {
  const secure = config.secure ? "; Secure" : "";
  return `${config.name}=; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=0`;
}

export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (cookieHeader === undefined) return null;
  for (const item of cookieHeader.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}
