import { expect, it } from "vitest";
import { calculateNextRun, isValidCronExpression } from "./cron-evaluator";

it("accepts only valid five-field expressions", () => {
  expect(isValidCronExpression("*/15 9-17 * * 1-5")).toBe(true);
  expect(isValidCronExpression("0 0 1 * *")).toBe(true);
  expect(isValidCronExpression("@hourly")).toBe(false);
  expect(isValidCronExpression("* * * * * *")).toBe(false);
  expect(isValidCronExpression("60 * * * *")).toBe(false);
});

it("calculates the next UTC run deterministically", () => {
  expect(calculateNextRun("0 9 * * 1-5", new Date("2026-01-05T08:15:00.000Z"))).toEqual(
    new Date("2026-01-05T09:00:00.000Z"),
  );
});
