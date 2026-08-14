import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { TenantUserSessionGuard } from "./tenant-auth";
import { TenantContextGuard } from "./tenant-context";
import { RequireEntitlements, TenantEntitlementGuard } from "./tenant-entitlements";
import { RequirePermissions, TenantPermissionGuard } from "./tenant-rbac";

/** Registered only when NODE_ENV=test; it is not a product endpoint. */
@Controller("__test/entitlements")
export class EntitlementTestProbeController {
  @Get("quotes-create")
  @RequirePermissions("quotes.create")
  @RequireEntitlements("module.quotes")
  @UseGuards(
    TenantUserSessionGuard,
    TenantContextGuard,
    TenantPermissionGuard,
    TenantEntitlementGuard,
  )
  quotesCreate(): { allowed: true } {
    return { allowed: true };
  }

  @Post("quotes-create")
  @RequirePermissions("quotes.create")
  @RequireEntitlements("module.quotes")
  @UseGuards(
    TenantUserSessionGuard,
    TenantContextGuard,
    TenantPermissionGuard,
    TenantEntitlementGuard,
  )
  quotesCreatePost(): { allowed: true } {
    return { allowed: true };
  }
}
