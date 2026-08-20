export type PhoneNormalizationOptions = Readonly<{
  /** Country calling code used for local/national input. The MVP default is Mexico. */
  defaultCountryCode?: string;
}>;

export class PhoneNumberInvalidError extends Error {
  override readonly name = "PhoneNumberInvalidError";

  constructor() {
    super("Phone number must be a valid E.164 number");
  }
}

const DEFAULT_COUNTRY_CODE = "52";
const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const SEPARATOR_PATTERN = /[\s().-]/g;

function invalid(): never {
  throw new PhoneNumberInvalidError();
}

function countryCode(value: string): string {
  if (!/^[1-9][0-9]{0,2}$/.test(value)) invalid();
  return value;
}

/**
 * Normalizes local, national and international input to one E.164 projection.
 * The default country is explicit in the function contract so future callers
 * can provide tenant/locale-specific country resolution without changing the
 * persisted representation.
 */
export function normalizePhoneNumber(
  value: string,
  options: PhoneNormalizationOptions | string = {},
): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 64) invalid();

  const configuredCountryCode =
    typeof options === "string" ? options : (options.defaultCountryCode ?? DEFAULT_COUNTRY_CODE);
  const defaultCountryCode = countryCode(configuredCountryCode);
  let normalized = value.trim().replace(SEPARATOR_PATTERN, "");

  if (normalized.startsWith("00")) normalized = `+${normalized.slice(2)}`;
  if (!/^\+?[0-9]+$/.test(normalized)) invalid();

  const hadInternationalPrefix = normalized.startsWith("+");
  let digits = hadInternationalPrefix ? normalized.slice(1) : normalized;

  if (!hadInternationalPrefix) {
    if (defaultCountryCode === "52" && /^(?:01|044|045)/.test(digits)) {
      digits = digits.replace(/^(?:01|044|045)/, "");
    } else if (digits.startsWith("0")) {
      digits = digits.slice(1);
    }
    digits = `${defaultCountryCode}${digits}`;
  }

  // Mexico's legacy WhatsApp mobile form +521XXXXXXXXXX is normalized to +52XXXXXXXXXX.
  if (defaultCountryCode === "52" && digits.startsWith("521") && digits.slice(3).length === 10) {
    digits = `52${digits.slice(3)}`;
  }

  const result = `+${digits}`;
  if (!E164_PATTERN.test(result)) invalid();
  return result;
}

export function isE164PhoneNumber(value: string): boolean {
  return typeof value === "string" && E164_PATTERN.test(value);
}
