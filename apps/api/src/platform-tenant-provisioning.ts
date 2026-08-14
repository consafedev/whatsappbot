import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import {
  InvalidPlatformPasswordError,
  normalizeTenantSlug,
  normalizeTenantUserEmail,
  PlatformPasswordHasher,
} from "@whatsapp-platform/auth";
import type { PlatformSessionIdentity } from "@whatsapp-platform/database/platform";
import {
  PLATFORM_TENANT_MODULE_KEYS,
  PlatformTenantDeploymentNotFoundError,
  PlatformTenantPermissionCatalogError,
  type PlatformTenantProvisioningRepository,
  type PlatformTenantProvisioningResult,
  PlatformTenantSlugConflictError,
} from "@whatsapp-platform/database/platform";

export const PLATFORM_TENANT_PROVISIONING_REPOSITORY = Symbol(
  "PLATFORM_TENANT_PROVISIONING_REPOSITORY",
);

const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));

type ProvisioningRequest = {
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  platformIdentity?: PlatformSessionIdentity;
};

type ParsedProvisioningRequest = Readonly<{
  legalName: string;
  displayName: string;
  slug: string;
  defaultTimezone: string;
  defaultLocale: string;
  defaultCurrency: string;
  deploymentId: string | null;
  owner: Readonly<{
    email: string;
    password: string;
    displayName: string;
    locale: string;
    timezone: string;
  }>;
  enabledModules: (typeof PLATFORM_TENANT_MODULE_KEYS)[number][];
  limits: Readonly<{
    channelAccounts: number;
    users: number;
    organizationUnits: number;
    storageBytes: number;
    monthlyAiBudget: number | null;
  }>;
}>;

function header(request: ProvisioningRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function platformProvisioningRequestId(request: ProvisioningRequest): string {
  const supplied = header(request, "x-request-id");
  return supplied !== undefined && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
    ? supplied
    : randomUUID();
}

export function requirePlatformProvisioningJson(request: ProvisioningRequest): void {
  if (!(header(request, "content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new UnsupportedMediaTypeException("Content-Type must be application/json");
  }
}

function plainObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Invalid tenant provisioning request");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) {
    throw new BadRequestException("Invalid tenant provisioning request");
  }
}

function requiredText(value: unknown, maximum: number): string {
  if (typeof value !== "string")
    throw new BadRequestException("Invalid tenant provisioning request");
  const result = value.trim();
  if (result.length === 0 || result.length > maximum) {
    throw new BadRequestException("Invalid tenant provisioning request");
  }
  return result;
}

function email(value: unknown): string {
  const result = normalizeTenantUserEmail(requiredText(value, 320));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) {
    throw new BadRequestException("Invalid tenant provisioning request");
  }
  return result;
}

function slug(value: unknown): string {
  const supplied = requiredText(value, 63);
  const result = normalizeTenantSlug(supplied);
  if (result.length < 3 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) {
    throw new BadRequestException("Invalid tenant slug");
  }
  return result;
}

function timezone(value: unknown): string {
  const result = requiredText(value, 100);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: result }).format(new Date(0));
  } catch {
    throw new BadRequestException("Invalid timezone");
  }
  return result;
}

function locale(value: unknown): string {
  const result = requiredText(value, 35);
  try {
    const [canonical] = Intl.getCanonicalLocales(result);
    if (canonical === undefined) throw new Error("Missing locale");
    return canonical;
  } catch {
    throw new BadRequestException("Invalid locale");
  }
}

function currency(value: unknown): string {
  const result = requiredText(value, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(result) || !supportedCurrencies.has(result)) {
    throw new BadRequestException("Invalid currency");
  }
  return result;
}

function uuidOrNull(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new BadRequestException("Invalid deploymentId");
  }
  return value.toLowerCase();
}

function integerLimit(value: unknown, minimum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw new BadRequestException("Invalid tenant limit");
  }
  return value;
}

function aiBudget(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER ||
    Math.round(value * 10_000) !== value * 10_000
  ) {
    throw new BadRequestException("Invalid tenant limit");
  }
  return value;
}

export function parsePlatformTenantProvisioning(body: unknown): ParsedProvisioningRequest {
  const value = plainObject(body);
  exactKeys(value, [
    "legalName",
    "displayName",
    "slug",
    "defaultTimezone",
    "defaultLocale",
    "defaultCurrency",
    "deploymentId",
    "owner",
    "enabledModules",
    "limits",
  ]);
  const owner = plainObject(value.owner);
  exactKeys(owner, ["email", "password", "displayName", "locale", "timezone"]);
  const limits = plainObject(value.limits);
  exactKeys(limits, [
    "channelAccounts",
    "users",
    "organizationUnits",
    "storageBytes",
    "monthlyAiBudget",
  ]);
  if (!Array.isArray(value.enabledModules)) {
    throw new BadRequestException("Invalid enabledModules");
  }
  const allowedModules = new Set<string>(PLATFORM_TENANT_MODULE_KEYS);
  if (
    value.enabledModules.some((key) => typeof key !== "string" || !allowedModules.has(key)) ||
    new Set(value.enabledModules).size !== value.enabledModules.length
  ) {
    throw new BadRequestException("Invalid enabledModules");
  }
  if (typeof owner.password !== "string" || owner.password.length > 128) {
    throw new BadRequestException("Invalid owner password");
  }
  const defaultLocale = locale(value.defaultLocale);
  const defaultTimezone = timezone(value.defaultTimezone);
  return {
    defaultCurrency: currency(value.defaultCurrency),
    defaultLocale,
    defaultTimezone,
    deploymentId: uuidOrNull(value.deploymentId),
    displayName: requiredText(value.displayName, 200),
    enabledModules: value.enabledModules as (typeof PLATFORM_TENANT_MODULE_KEYS)[number][],
    legalName: requiredText(value.legalName, 250),
    limits: {
      channelAccounts: integerLimit(limits.channelAccounts, 0),
      monthlyAiBudget: aiBudget(limits.monthlyAiBudget),
      organizationUnits: integerLimit(limits.organizationUnits, 1),
      storageBytes: integerLimit(limits.storageBytes, 0),
      users: integerLimit(limits.users, 1),
    },
    owner: {
      displayName: requiredText(owner.displayName, 200),
      email: email(owner.email),
      locale: owner.locale === undefined ? defaultLocale : locale(owner.locale),
      password: owner.password,
      timezone: owner.timezone === undefined ? defaultTimezone : timezone(owner.timezone),
    },
    slug: slug(value.slug),
  };
}

@Injectable()
export class PlatformTenantProvisioningService {
  private readonly hasher = new PlatformPasswordHasher();

  constructor(
    @Inject(PLATFORM_TENANT_PROVISIONING_REPOSITORY)
    private readonly repository: PlatformTenantProvisioningRepository,
  ) {}

  async provision(
    input: ParsedProvisioningRequest,
    identity: PlatformSessionIdentity,
    requestId: string,
  ): Promise<PlatformTenantProvisioningResult> {
    let passwordHash: string;
    try {
      passwordHash = await this.hasher.hash(input.owner.password);
    } catch (error) {
      if (error instanceof InvalidPlatformPasswordError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    try {
      return await this.repository.provision({
        ...input,
        actorPlatformAdminId: identity.admin.id,
        owner: { ...input.owner, passwordHash },
        requestId,
      });
    } catch (error) {
      if (error instanceof PlatformTenantSlugConflictError) {
        throw new ConflictException("Tenant slug already exists");
      }
      if (error instanceof PlatformTenantDeploymentNotFoundError) {
        throw new UnprocessableEntityException("Deployment is not available");
      }
      if (error instanceof PlatformTenantPermissionCatalogError) {
        throw new HttpException(
          "Tenant provisioning is temporarily unavailable",
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw error;
    }
  }
}
