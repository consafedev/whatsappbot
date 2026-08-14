import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import type { TenantStatus } from "@whatsapp-platform/database";
import type {
  PlatformTenantListResult,
  PlatformTenantQueryService,
} from "@whatsapp-platform/database/platform";
import { PlatformAdminSessionGuard } from "./platform-auth";

export const PLATFORM_TENANT_QUERY = Symbol("PLATFORM_TENANT_QUERY");

type QueryValue = string | string[] | undefined;
type TenantListHttpQuery = Record<string, QueryValue>;

const tenantStatuses = new Set<TenantStatus>([
  "provisioning",
  "active",
  "suspended",
  "offboarding",
  "archived",
]);

function singleValue(value: QueryValue, field: string): string | undefined {
  if (Array.isArray(value)) throw new BadRequestException(`Invalid ${field}`);
  return value;
}

function positiveInteger(value: QueryValue, field: string, fallback: number): number {
  const raw = singleValue(value, field);
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) throw new BadRequestException(`Invalid ${field}`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new BadRequestException(`Invalid ${field}`);
  return parsed;
}

function parseTenantListQuery(query: TenantListHttpQuery) {
  const allowed = new Set(["page", "pageSize", "search", "status"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) {
    throw new BadRequestException("Invalid tenant list query");
  }
  const page = positiveInteger(query.page, "page", 1);
  const pageSize = positiveInteger(query.pageSize, "pageSize", 25);
  if (pageSize > 100) throw new BadRequestException("Invalid pageSize");

  const rawSearch = singleValue(query.search, "search");
  const search = rawSearch?.trim();
  if (search !== undefined && search.length > 200) {
    throw new BadRequestException("Invalid search");
  }

  const rawStatus = singleValue(query.status, "status");
  if (rawStatus !== undefined && !tenantStatuses.has(rawStatus as TenantStatus)) {
    throw new BadRequestException("Invalid status");
  }

  return {
    page,
    pageSize,
    ...(search === undefined || search.length === 0 ? {} : { search }),
    ...(rawStatus === undefined ? {} : { status: rawStatus as TenantStatus }),
  };
}

@Controller("platform/tenants")
@UseGuards(PlatformAdminSessionGuard)
export class PlatformTenantsController {
  constructor(
    @Inject(PLATFORM_TENANT_QUERY)
    private readonly queryService: PlatformTenantQueryService,
  ) {}

  @Get()
  list(@Query() query: TenantListHttpQuery): Promise<PlatformTenantListResult> {
    return this.queryService.list(parseTenantListQuery(query));
  }
}
