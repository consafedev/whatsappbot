import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class AiCryptoError extends Error {
  override readonly name = "AiCryptoError";
}

function normalizeKey(secret: Uint8Array | string): Buffer {
  if (typeof secret === "string") {
    return createHash("sha256").update(secret, "utf8").digest();
  }
  if (secret.byteLength === 32) {
    return Buffer.from(secret);
  }
  return createHash("sha256").update(secret).digest();
}

export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed.length <= 8) {
    return `***${trimmed.slice(-2)}`;
  }
  if (trimmed.startsWith("sk-")) {
    return `sk-...${trimmed.slice(-4)}`;
  }
  if (trimmed.startsWith("AIza")) {
    return `AIza...${trimmed.slice(-4)}`;
  }
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`;
}

export function encryptApiKey(apiKey: string, secret: Uint8Array | string): string {
  try {
    const key = normalizeKey(secret);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const value =
      cipher.update(JSON.stringify({ apiKey }), "utf8", "base64url") + cipher.final("base64url");
    const tag = cipher.getAuthTag().toString("base64url");
    return `v1.${iv.toString("base64url")}.${tag}.${value}`;
  } catch (error) {
    throw new AiCryptoError("Failed to encrypt API key", { cause: error });
  }
}

export function decryptApiKey(encryptedKey: string, secret: Uint8Array | string): string {
  try {
    const key = normalizeKey(secret);
    const parts = encryptedKey.split(".");
    const [version, ivEncoded, tagEncoded, valueEncoded] = parts;
    if (
      parts.length !== 4 ||
      version !== "v1" ||
      ivEncoded === undefined ||
      tagEncoded === undefined ||
      valueEncoded === undefined
    ) {
      throw new Error("Invalid ciphertext structure");
    }
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivEncoded, "base64url"));
    decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
    const raw =
      decipher.update(Buffer.from(valueEncoded, "base64url"), undefined, "utf8") +
      decipher.final("utf8");
    const parsed = JSON.parse(raw) as { apiKey?: unknown };
    if (typeof parsed.apiKey !== "string") {
      throw new Error("Payload missing apiKey string");
    }
    return parsed.apiKey;
  } catch (error) {
    throw new AiCryptoError("Failed to decrypt API key", { cause: error });
  }
}
