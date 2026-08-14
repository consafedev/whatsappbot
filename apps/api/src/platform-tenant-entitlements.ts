import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  isLimitEntitlementKey,
  isModuleEntitlementKey,
  type LimitEntitlementKey,
  type ModuleEntitlementKey,
} from "@whatsapp-platform/database";
import type { PlatformSessionIdentity, Prisma } from "@whatsapp-platform/database/platform";
import {
  PlatformEntitlementDateRangeError,
  PlatformEntitlementTenantNotFoundError,
  type PlatformTenantEntitlementAdminRepository,
} from "@whatsapp-platform/database/platform";

export const PLATFORM_TENANT_ENTITLEMENT_ADMIN = Symbol("PLATFORM_TENANT_ENTITLEMENT_ADMIN");
export const PLATFORM_ENTITLEMENT_CONFIG_MAX_BYTES = 16 * 1024;
const CONFIG_MAX_DEPTH = 10;
const unsafeConfigKeys = new Set(["__proto__", "constructor", "prototype"]);

type ParsedModulePatch = Readonly<{
  enabled?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
  config?: Prisma.InputJsonObject;
}>;

type ParsedLimitPatch = Readonly<{
  value: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
}>;

function plainObject(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(message);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  message: string,
): void {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) throw new BadRequestException(message);
}

function optionalDate(value: unknown, field: string): Date | null | undefined {
  if (value === undefined || value === null) return value;
  if (
    typeof value !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return new Date(value);
}

function validateJson(value: unknown, depth = 0): void {
  if (depth > CONFIG_MAX_DEPTH) throw new BadRequestException("Entitlement config is too deep");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new BadRequestException("Invalid entitlement config");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) validateJson(item, depth + 1);
    return;
  }
  if (typeof value !== "object") throw new BadRequestException("Invalid entitlement config");
  for (const [key, item] of Object.entries(value)) {
    if (unsafeConfigKeys.has(key)) throw new BadRequestException("Unsafe entitlement config key");
    validateJson(item, depth + 1);
  }
}

function parseConfig(value: unknown): Prisma.InputJsonObject {
  const config = plainObject(value, "Entitlement config must be a JSON object");
  validateJson(config);
  if (Buffer.byteLength(JSON.stringify(config), "utf8") > PLATFORM_ENTITLEMENT_CONFIG_MAX_BYTES) {
    throw new BadRequestException("Entitlement config is too large");
  }
  return config as Prisma.InputJsonObject;
}

export function parseModuleEntitlementKey(value: string): ModuleEntitlementKey {
  if (!isModuleEntitlementKey(value)) throw new BadRequestException("Unknown module key");
  return value;
}

export function parseLimitEntitlementKey(value: string): LimitEntitlementKey {
  if (!isLimitEntitlementKey(value)) throw new BadRequestException("Unknown limit key");
  return value;
}

export function parsePlatformModuleEntitlementPatch(body: unknown): ParsedModulePatch {
  const value = plainObject(body, "Invalid module entitlement patch");
  exactKeys(value, ["enabled", "startsAt", "endsAt", "config"], "Invalid module entitlement patch");
  if (Object.keys(value).length === 0) throw new BadRequestException("Module patch is empty");
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new BadRequestException("Invalid enabled value");
  }
  const startsAt = optionalDate(value.startsAt, "startsAt");
  const endsAt = optionalDate(value.endsAt, "endsAt");
  return {
    ...(value.config === undefined ? {} : { config: parseConfig(value.config) }),
    ...(value.enabled === undefined ? {} : { enabled: value.enabled }),
    ...(startsAt === undefined ? {} : { startsAt }),
    ...(endsAt === undefined ? {} : { endsAt }),
  };
}

function decimalValue(value: unknown): string {
  let raw: string;
  if (typeof value === "string") raw = value;
  else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    raw = String(value);
  else throw new BadRequestException("Invalid limit value");
  if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,4})?$/.test(raw)) {
    throw new BadRequestException("Invalid limit value");
  }
  return raw;
}

export function parsePlatformLimitEntitlementPatch(body: unknown): ParsedLimitPatch {
  const value = plainObject(body, "Invalid limit entitlement patch");
  exactKeys(value, ["value", "startsAt", "endsAt"], "Invalid limit entitlement patch");
  if (!("value" in value)) throw new BadRequestException("Limit value is required");
  const startsAt = optionalDate(value.startsAt, "startsAt");
  const endsAt = optionalDate(value.endsAt, "endsAt");
  return {
    value: decimalValue(value.value),
    ...(startsAt === undefined ? {} : { startsAt }),
    ...(endsAt === undefined ? {} : { endsAt }),
  };
}

@Injectable()
export class PlatformTenantEntitlementService {
  constructor(
    @Inject(PLATFORM_TENANT_ENTITLEMENT_ADMIN)
    private readonly repository: PlatformTenantEntitlementAdminRepository,
  ) {}

  private async result<T>(operation: Promise<T>): Promise<T> {
    try {
      return await operation;
    } catch (error) {
      if (error instanceof PlatformEntitlementTenantNotFoundError) {
        throw new NotFoundException("Tenant not found");
      }
      if (error instanceof PlatformEntitlementDateRangeError) {
        throw new BadRequestException("endsAt must be after startsAt");
      }
      throw error;
    }
  }

  config(tenantId: string, key: ModuleEntitlementKey) {
    return this.result(this.repository.moduleConfig(tenantId, key)).then((config) => ({
      key,
      config,
    }));
  }

  patchModule(
    tenantId: string,
    key: ModuleEntitlementKey,
    patch: ParsedModulePatch,
    identity: PlatformSessionIdentity,
    requestId: string,
  ) {
    return this.result(
      this.repository.patchModule(tenantId, key, patch, {
        actorPlatformAdminId: identity.admin.id,
        requestId,
      }),
    );
  }

  patchLimit(
    tenantId: string,
    key: LimitEntitlementKey,
    patch: ParsedLimitPatch,
    identity: PlatformSessionIdentity,
    requestId: string,
  ) {
    return this.result(
      this.repository.patchLimit(tenantId, key, patch, {
        actorPlatformAdminId: identity.admin.id,
        requestId,
      }),
    );
  }
}
