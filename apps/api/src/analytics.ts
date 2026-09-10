import {
  applyDecorators,
  BadRequestException,
  Controller,
  Get,
  Inject,
  Injectable,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  type AnalyticsDatabase,
  AnalyticsDateRangeInvalidError,
  getTenantMessageTimeSeries,
  getTenantOperationalOverview,
  type MessageTimeSeriesBucket,
  type TenantContext,
  type TenantOperationalOverviewResult,
} from "@whatsapp-platform/database";
import type { PermissionKey } from "@whatsapp-platform/rbac";
import { TenantUserSessionGuard } from "./tenant-auth";
import { CurrentTenantContext, TenantContextGuard } from "./tenant-context";
import { RequireEntitlements, TenantEntitlementGuard } from "./tenant-entitlements";
import { RequirePermissions, TenantPermissionGuard } from "./tenant-rbac";

export const ANALYTICS_DATABASE = Symbol("ANALYTICS_DATABASE");

function analyticsAuthorized(...permissions: PermissionKey[]): MethodDecorator & ClassDecorator {
  return applyDecorators(
    RequirePermissions(...permissions),
    UseGuards(
      TenantUserSessionGuard,
      TenantContextGuard,
      TenantPermissionGuard,
      TenantEntitlementGuard,
    ),
  );
}

export interface AnalyticsQueryDto {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface TimeSeriesQueryDto extends AnalyticsQueryDto {
  readonly interval?: string | undefined;
}

function parseQueryDate(value: string | undefined, defaultValue: Date, paramName: string): Date {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Invalid date format for '${paramName}'`);
  }
  return parsed;
}

function resolveDateRange(query: AnalyticsQueryDto): { from: Date; to: Date } {
  const now = new Date();
  const defaultTo = now;
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const from = parseQueryDate(query.from, defaultFrom, "from");
  const to = parseQueryDate(query.to, defaultTo, "to");

  if (from.getTime() > to.getTime()) {
    throw new BadRequestException("The 'from' date must be before or equal to 'to' date");
  }

  return { from, to };
}

@Injectable()
export class AnalyticsService {
  constructor(@Inject(ANALYTICS_DATABASE) private readonly database: AnalyticsDatabase) {}

  async getOperationalOverview(
    context: TenantContext,
    from: Date,
    to: Date,
  ): Promise<TenantOperationalOverviewResult> {
    try {
      return await getTenantOperationalOverview(this.database, {
        from,
        tenantId: context.tenantId,
        to,
      });
    } catch (err: unknown) {
      if (err instanceof AnalyticsDateRangeInvalidError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  async getMessageTimeSeries(
    context: TenantContext,
    from: Date,
    to: Date,
    interval: "day" | "hour",
  ): Promise<readonly MessageTimeSeriesBucket[]> {
    try {
      return await getTenantMessageTimeSeries(this.database, {
        from,
        interval,
        tenantId: context.tenantId,
        to,
      });
    } catch (err: unknown) {
      if (err instanceof AnalyticsDateRangeInvalidError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }
}

@Controller("api/v1/analytics")
@RequireEntitlements("module.reports")
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get("overview")
  @analyticsAuthorized("reports.read")
  async getOverview(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: AnalyticsQueryDto,
  ) {
    const { from, to } = resolveDateRange(query);
    const data = await this.service.getOperationalOverview(context, from, to);
    return { success: true, data };
  }

  @Get("time-series")
  @analyticsAuthorized("reports.read")
  async getTimeSeries(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: TimeSeriesQueryDto,
  ) {
    const rawInterval = query.interval ?? "day";
    if (rawInterval !== "day" && rawInterval !== "hour") {
      throw new BadRequestException("Invalid interval. Must be 'day' or 'hour'");
    }
    const interval = rawInterval as "day" | "hour";
    const { from, to } = resolveDateRange(query);
    const data = await this.service.getMessageTimeSeries(context, from, to, interval);
    return { success: true, data };
  }
}
