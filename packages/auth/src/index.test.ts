import { describe, expect, it } from "vitest";
import {
  generatePlatformSessionToken,
  hashPlatformSessionToken,
  InvalidPlatformPasswordError,
  PlatformPasswordHasher,
  platformCookieConfig,
  readCookie,
  serializePlatformSessionCookie,
  serializeTenantSessionCookie,
  tenantCookieConfig,
} from "./index";

describe("platform admin authentication primitives", () => {
  it("hashes with Argon2id and verifies without retaining the password", async () => {
    const hasher = new PlatformPasswordHasher();
    const password = "correct horse battery staple";
    const encoded = await hasher.hash(password);
    const secondEncoded = await hasher.hash(password);

    expect(encoded).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(encoded).not.toContain(password);
    expect(secondEncoded).not.toBe(encoded);
    await expect(hasher.verify(encoded, password)).resolves.toBe(true);
    await expect(hasher.verify(encoded, "incorrect password value")).resolves.toBe(false);
  });

  it("enforces the bootstrap password length policy", async () => {
    const hasher = new PlatformPasswordHasher();
    const password = "too short";
    const error = await hasher.hash(password).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvalidPlatformPasswordError);
    expect(String(error)).not.toContain(password);
  });

  it("creates opaque random tokens and stores deterministic SHA-256 hashes", () => {
    const first = generatePlatformSessionToken();
    const second = generatePlatformSessionToken();
    expect(first).not.toBe(second);
    expect(Buffer.from(first, "base64url")).toHaveLength(32);
    expect(hashPlatformSessionToken(first)).toHaveLength(32);
    expect(hashPlatformSessionToken(first).equals(hashPlatformSessionToken(first))).toBe(true);
  });

  it("uses a __Host cookie only in production", () => {
    const config = platformCookieConfig("production");
    const cookie = serializePlatformSessionCookie("opaque", config);
    expect(cookie).toContain("__Host-platform_session=opaque");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain("Domain=");
    expect(readCookie(cookie, config.name)).toBe("opaque");
  });

  it("keeps the production tenant cookie separate from the platform cookie", () => {
    const cookie = serializeTenantSessionCookie("opaque", tenantCookieConfig("production"));
    expect(cookie).toContain("__Host-tenant_session=opaque");
    expect(cookie).toContain("HttpOnly; Secure; SameSite=Strict; Path=/");
    expect(cookie).not.toContain("Domain=");
    expect(cookie).not.toContain("platform_session");
  });
});
