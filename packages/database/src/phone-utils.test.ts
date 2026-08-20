import { describe, expect, it } from "vitest";
import { isE164PhoneNumber, normalizePhoneNumber, PhoneNumberInvalidError } from "./phone-utils";

describe("phone normalization", () => {
  it("normalizes Mexican local and national input to E.164", () => {
    expect(normalizePhoneNumber("55 1234 5678")).toBe("+525512345678");
    expect(normalizePhoneNumber("01 (55) 1234-5678")).toBe("+525512345678");
    expect(normalizePhoneNumber("5512345678", { defaultCountryCode: "52" })).toBe("+525512345678");
  });

  it("normalizes international and legacy Mexico WhatsApp prefixes", () => {
    expect(normalizePhoneNumber("+1 (415) 555-2671")).toBe("+14155552671");
    expect(normalizePhoneNumber("+5215512345678")).toBe("+525512345678");
    expect(normalizePhoneNumber("00525512345678")).toBe("+525512345678");
    expect(isE164PhoneNumber("+525512345678")).toBe(true);
  });

  it("rejects alphanumeric, incomplete and malformed input", () => {
    for (const input of ["abc5512345678", "+52-", "123", "+0123456789", "+52551234567890123"]) {
      expect(() => normalizePhoneNumber(input)).toThrow(PhoneNumberInvalidError);
    }
    expect(isE164PhoneNumber("5512345678")).toBe(false);
  });
});
