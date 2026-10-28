import { createHash } from "node:crypto";

export type AppointmentBookingPolicy = Readonly<{
  serviceIds: readonly string[];
  resourceIds: readonly string[];
  reminderOffsetsMinutes?: readonly number[];
}>;

export type AppointmentBookingRuleDefinition = Readonly<{
  id?: string;
  name?: string;
  description?: string | null;
  executionCount?: number;
  lastExecutedAt?: Date | null;
  updatedAt?: Date;
  actions: unknown;
  channelAccountId: string | null;
  conditions: unknown;
  cooldownSeconds: number;
  executionMode: string;
  organizationUnitId: string | null;
  priority: number;
  status: string;
  triggerType: string;
}>;

export class AppointmentBookingValidationError extends Error {
  override readonly name = "AppointmentBookingValidationError";
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POLICY_KEYS = new Set(["serviceIds", "resourceIds", "reminderOffsetsMinutes"]);

function normalizeIdList(value: unknown, field: "serviceIds" | "resourceIds"): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10)
    throw new AppointmentBookingValidationError(`${field} must contain 1 to 10 UUIDv7 values`);
  const normalized = value.map((item) => {
    if (typeof item !== "string" || !UUID_V7.test(item.trim()))
      throw new AppointmentBookingValidationError(`${field} must contain UUIDv7 values`);
    return item.trim().toLowerCase();
  });
  if (new Set(normalized).size !== normalized.length)
    throw new AppointmentBookingValidationError(`${field} must not contain duplicates`);
  return normalized.sort();
}

function normalizeOffsets(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 3)
    throw new AppointmentBookingValidationError(
      "reminderOffsetsMinutes must contain 1 to 3 values",
    );
  if (
    value.some(
      (offset) =>
        !Number.isInteger(offset) || (offset as number) < 1 || (offset as number) > 10_080,
    )
  ) {
    throw new AppointmentBookingValidationError(
      "reminderOffsetsMinutes values must be integers between 1 and 10080",
    );
  }
  const offsets = [...(value as number[])];
  if (new Set(offsets).size !== offsets.length)
    throw new AppointmentBookingValidationError(
      "reminderOffsetsMinutes must not contain duplicates",
    );
  return offsets.sort((left, right) => left - right);
}

export function normalizeAppointmentBookingPolicy(value: unknown): AppointmentBookingPolicy {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new AppointmentBookingValidationError("Booking action parameters must be an object");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!POLICY_KEYS.has(key))
      throw new AppointmentBookingValidationError(`Unsupported booking policy field: ${key}`);
  }
  const normalized: {
    serviceIds: readonly string[];
    resourceIds: readonly string[];
    reminderOffsetsMinutes?: readonly number[];
  } = {
    resourceIds: normalizeIdList(record.resourceIds, "resourceIds"),
    serviceIds: normalizeIdList(record.serviceIds, "serviceIds"),
  };
  const offsets = normalizeOffsets(record.reminderOffsetsMinutes);
  if (offsets !== undefined) normalized.reminderOffsetsMinutes = offsets;
  return Object.freeze(normalized);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function hashAppointmentBookingRuleDefinition(
  definition: AppointmentBookingRuleDefinition,
): string {
  const policyInputs = {
    actions: definition.actions,
    channelAccountId: definition.channelAccountId?.toLowerCase() ?? null,
    conditions: definition.conditions,
    cooldownSeconds: definition.cooldownSeconds,
    executionMode: definition.executionMode,
    id: definition.id?.toLowerCase() ?? null,
    organizationUnitId: definition.organizationUnitId?.toLowerCase() ?? null,
    priority: definition.priority,
    status: definition.status,
    triggerType: definition.triggerType,
  };
  return createHash("sha256").update(canonicalJson(policyInputs)).digest("hex");
}
