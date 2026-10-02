import { describe, expect, it } from "vitest";
import { parseMaxRetries, parsePayloadJson } from "./scheduled-task-create-validation";

describe("scheduled task create form validation", () => {
  it("parses an object payload and treats blank input as an empty object", () => {
    expect(parsePayloadJson('{"ruleId":"rule-1"}')).toEqual({ ruleId: "rule-1" });
    expect(parsePayloadJson("  ")).toEqual({});
  });

  it.each(["{invalid", "null", "[]", '"string"', "42"])(
    "rejects payload input that is not a JSON object: %s",
    (value) => {
      expect(() => parsePayloadJson(value)).toThrow("El payload debe ser un objeto JSON válido.");
    },
  );

  it("accepts a non-negative integer retry count", () => {
    expect(parseMaxRetries("0")).toBe(0);
    expect(parseMaxRetries("3")).toBe(3);
  });

  it.each(["", "-1", "1.5", "abc"])("rejects invalid retry count: %s", (value) => {
    expect(() => parseMaxRetries(value)).toThrow(
      "El límite de reintentos debe ser un entero no negativo.",
    );
  });
});
