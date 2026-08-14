import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { TenantStatus } from "@whatsapp-platform/database";
import type {
  PlatformTenantAuditPage,
  PlatformTenantDetail,
  PlatformTenantDetailQueryService,
  PlatformTenantListResult,
  PlatformTenantQueryService,
  PlatformTenantUserPage,
} from "@whatsapp-platform/database/platform";
import { PlatformTenantNotFoundError } from "@whatsapp-platform/database/platform";
import { PlatformAdminSessionGuard } from "./platform-auth";
import {
  PlatformTenantProvisioningService,
  parsePlatformTenantProvisioning,
  platformProvisioningRequestId,
  requirePlatformProvisioningJson,
} from "./platform-tenant-provisioning";

export const PLATFORM_TENANT_QUERY = Symbol("PLATFORM_TENANT_QUERY");
export const PLATFORM_TENANT_DETAIL_QUERY = Symbol("PLATFORM_TENANT_DETAIL_QUERY");

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

function parseTenantPageQuery(query: TenantListHttpQuery) {
  const allowed = new Set(["page", "pageSize"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) {
    throw new BadRequestException("Invalid tenant detail query");
  }
  const page = positiveInteger(query.page, "page", 1);
  const pageSize = positiveInteger(query.pageSize, "pageSize", 25);
  if (pageSize > 100) throw new BadRequestException("Invalid pageSize");
  return { page, pageSize };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseTenantId(value: string): string {
  if (!uuidPattern.test(value)) throw new BadRequestException("Invalid tenantId");
  return value;
}

async function tenantResult<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof PlatformTenantNotFoundError)
      throw new NotFoundException("Tenant not found");
    throw error;
  }
}

@Controller("platform/tenants")
@UseGuards(PlatformAdminSessionGuard)
export class PlatformTenantsController {
  constructor(
    @Inject(PLATFORM_TENANT_QUERY)
    private readonly queryService: PlatformTenantQueryService,
    @Inject(PLATFORM_TENANT_DETAIL_QUERY)
    private readonly detailQueryService: PlatformTenantDetailQueryService,
    @Inject(PlatformTenantProvisioningService)
    private readonly provisioningService: PlatformTenantProvisioningService,
  ) {}

  @Get()
  list(@Query() query: TenantListHttpQuery): Promise<PlatformTenantListResult> {
    return this.queryService.list(parseTenantListQuery(query));
  }

  @Get(":tenantId")
  detail(@Param("tenantId") tenantId: string): Promise<PlatformTenantDetail> {
    return tenantResult(this.detailQueryService.detail(parseTenantId(tenantId)));
  }

  @Get(":tenantId/users")
  users(
    @Param("tenantId") tenantId: string,
    @Query() query: TenantListHttpQuery,
  ): Promise<PlatformTenantUserPage> {
    return tenantResult(
      this.detailQueryService.users(parseTenantId(tenantId), parseTenantPageQuery(query)),
    );
  }

  @Get(":tenantId/audit")
  audit(
    @Param("tenantId") tenantId: string,
    @Query() query: TenantListHttpQuery,
  ): Promise<PlatformTenantAuditPage> {
    return tenantResult(
      this.detailQueryService.audit(parseTenantId(tenantId), parseTenantPageQuery(query)),
    );
  }

  @Post()
  create(
    @Body() body: unknown,
    @Req()
    request: Parameters<typeof requirePlatformProvisioningJson>[0],
  ) {
    requirePlatformProvisioningJson(request);
    const identity = request.platformIdentity;
    if (identity === undefined) throw new Error("Platform identity was not resolved");
    return this.provisioningService.provision(
      parsePlatformTenantProvisioning(body),
      identity,
      platformProvisioningRequestId(request),
    );
  }
}
