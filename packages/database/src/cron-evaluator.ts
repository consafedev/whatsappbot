import { CronExpressionParser } from "cron-parser";

export class CronExpressionValidationError extends Error {
  override readonly name = "CronExpressionValidationError";
}

function assertFiveFields(expression: string): string {
  const normalized = expression.trim();
  if (normalized.startsWith("@") || normalized.split(/\s+/).length !== 5) {
    throw new CronExpressionValidationError("Cron expression must contain exactly five fields");
  }
  return normalized;
}

export function isValidCronExpression(expression: string): boolean {
  try {
    CronExpressionParser.parse(assertFiveFields(expression), { tz: "UTC" });
    return true;
  } catch {
    return false;
  }
}

export function calculateNextRun(expression: string, fromDate = new Date()): Date {
  if (Number.isNaN(fromDate.getTime()))
    throw new CronExpressionValidationError("fromDate must be valid");
  try {
    return CronExpressionParser.parse(assertFiveFields(expression), {
      currentDate: fromDate,
      tz: "UTC",
    })
      .next()
      .toDate();
  } catch {
    throw new CronExpressionValidationError("Invalid cron expression");
  }
}
