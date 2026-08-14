import { Controller, Get, Inject, Injectable } from "@nestjs/common";
import type {
  TenantAppBootstrap,
  TenantAppBootstrapDatabase,
  TenantContext,
} from "@whatsapp-platform/database";
import { createTenantAppBootstrap } from "@whatsapp-platform/database";
import type { TenantSessionIdentity } from "@whatsapp-platform/database/platform";
import { TenantAuthenticated } from "./tenant-auth";
import { CurrentTenantContext, CurrentTenantIdentity } from "./tenant-context";

export const TENANT_APP_BOOTSTRAP_DATABASE = Symbol("TENANT_APP_BOOTSTRAP_DATABASE");

@Injectable()
export class TenantAppBootstrapService {
  constructor(
    @Inject(TENANT_APP_BOOTSTRAP_DATABASE)
    private readonly database: TenantAppBootstrapDatabase,
  ) {}

  get(context: TenantContext, identity: TenantSessionIdentity): Promise<TenantAppBootstrap> {
    return createTenantAppBootstrap(context, identity.userId, this.database);
  }
}

@Controller("app")
export class TenantAppBootstrapController {
  constructor(private readonly service: TenantAppBootstrapService) {}

  @Get("bootstrap")
  @TenantAuthenticated()
  bootstrap(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
  ): Promise<TenantAppBootstrap> {
    return this.service.get(context, identity);
  }
}
