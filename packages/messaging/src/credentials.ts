import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface MessagingCredentialCipher {
  encrypt(credentials: Readonly<Record<string, unknown>>): string;
  decrypt(ciphertext: string): Readonly<Record<string, unknown>>;
}

export class MessagingCredentialCipherError extends Error {
  override readonly name = "MessagingCredentialCipherError";
}

export function createMessagingCredentialCipher(key: Uint8Array): MessagingCredentialCipher {
  if (key.byteLength !== 32) {
    throw new MessagingCredentialCipherError("Messaging credentials key must be 32 bytes");
  }
  return Object.freeze({
    decrypt(ciphertext: string): Readonly<Record<string, unknown>> {
      try {
        const parts = ciphertext.split(".");
        const [version, ivEncoded, tagEncoded, valueEncoded] = parts;
        if (
          parts.length !== 4 ||
          version !== "v1" ||
          ivEncoded === undefined ||
          tagEncoded === undefined ||
          valueEncoded === undefined
        ) {
          throw new Error("Invalid ciphertext version");
        }
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivEncoded, "base64url"));
        decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
        const value =
          decipher.update(Buffer.from(valueEncoded, "base64url"), undefined, "utf8") +
          decipher.final("utf8");
        const parsed: unknown = JSON.parse(value);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Invalid credential payload");
        }
        return parsed as Record<string, unknown>;
      } catch {
        throw new MessagingCredentialCipherError("Unable to decrypt messaging credentials");
      }
    },
    encrypt(credentials: Readonly<Record<string, unknown>>): string {
      try {
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        const value =
          cipher.update(JSON.stringify(credentials), "utf8", "base64url") +
          cipher.final("base64url");
        return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${value}`;
      } catch {
        throw new MessagingCredentialCipherError("Unable to encrypt messaging credentials");
      }
    },
  });
}
