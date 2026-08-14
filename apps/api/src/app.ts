import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { platformCookieConfig, tenantCookieConfig } from "@whatsapp-platform/auth";
import type { NonSecretConfig } from "@whatsapp-platform/config";
import {
  createPlatformAuthRepository,
  createPlatformTenantDetailQueryService,
  createPlatformTenantEntitlementAdminRepository,
  createPlatformTenantProvisioningRepository,
  createPlatformTenantQueryService,
  createPlatformTenantStatusWriter,
  createTenantAuthRepository,
  getPlatformDatabaseClient,
  type PlatformAuthRepository,
  type TenantAuthRepository,
} from "@whatsapp-platform/database/platform";
import { EntitlementTestProbeController } from "./entitlement-test-probe";
import {
  PLATFORM_AUTH_OPTIONS,
  PLATFORM_AUTH_REPOSITORY,
  PlatformAdminLogoutGuard,
  PlatformAdminSessionGuard,
  PlatformAuthController,
  type PlatformAuthOptions,
  PlatformAuthService,
  PlatformLoginRateLimiter,
  PlatformOriginGuard,
} from "./platform-auth";
import {
  PLATFORM_TENANT_ENTITLEMENT_ADMIN,
  PlatformTenantEntitlementService,
} from "./platform-tenant-entitlements";
import {
  PLATFORM_TENANT_PROVISIONING_REPOSITORY,
  PlatformTenantProvisioningService,
} from "./platform-tenant-provisioning";
import {
  PLATFORM_TENANT_STATUS_WRITER,
  PlatformTenantStatusService,
} from "./platform-tenant-status";
import {
  PLATFORM_TENANT_DETAIL_QUERY,
  PLATFORM_TENANT_QUERY,
  PlatformTenantsController,
} from "./platform-tenants";
import {
  PASSWORD_RESET_DELIVERY,
  type PasswordResetDelivery,
  TENANT_AUTH_OPTIONS,
  TENANT_AUTH_REPOSITORY,
  TenantAuthController,
  type TenantAuthOptions,
  TenantAuthRateLimiter,
  TenantAuthService,
  TenantLogoutGuard,
  TenantOriginGuard,
  TenantUserSessionGuard,
  UnavailablePasswordResetDelivery,
} from "./tenant-auth";
import {
  TENANT_DATA_ACCESS_DATABASE,
  TenantContextGuard,
  TenantDataAccessFactory,
} from "./tenant-context";
import { TenantEntitlementGuard } from "./tenant-entitlements";
import { TenantPermissionGuard } from "./tenant-rbac";

@Controller()
class HealthController {
  @Get("health")
  health(): { service: "api"; status: "ok" } {
    return { service: "api", status: "ok" };
  }
}

export async function createApiApplication(
  config: Readonly<NonSecretConfig>,
  dependencies: { passwordResetDelivery?: PasswordResetDelivery } = {},
) {
  const options: PlatformAuthOptions = {
    cookie: platformCookieConfig(config.environment),
    webOrigin: config.platformWebOrigin,
  };
  const tenantOptions: TenantAuthOptions = {
    cookie: tenantCookieConfig(config.environment),
    webOrigin: config.tenantWebOrigin,
  };
  @Module({
    controllers: [
      HealthController,
      PlatformAuthController,
      PlatformTenantsController,
      TenantAuthController,
      ...(config.environment === "test" ? [EntitlementTestProbeController] : []),
    ],
    providers: [
      PlatformAuthService,
      PlatformTenantProvisioningService,
      PlatformTenantEntitlementService,
      PlatformTenantStatusService,
      PlatformLoginRateLimiter,
      PlatformOriginGuard,
      PlatformAdminSessionGuard,
      PlatformAdminLogoutGuard,
      TenantAuthService,
      TenantAuthRateLimiter,
      TenantOriginGuard,
      TenantUserSessionGuard,
      TenantLogoutGuard,
      TenantContextGuard,
      TenantPermissionGuard,
      TenantEntitlementGuard,
      TenantDataAccessFactory,
      {
        provide: PLATFORM_TENANT_ENTITLEMENT_ADMIN,
        useFactory: () =>
          createPlatformTenantEntitlementAdminRepository(getPlatformDatabaseClient()),
      },
      {
        provide: PLATFORM_TENANT_STATUS_WRITER,
        useFactory: () => createPlatformTenantStatusWriter(getPlatformDatabaseClient()),
      },
      {
        provide: PLATFORM_AUTH_REPOSITORY,
        useFactory: (): PlatformAuthRepository =>
          createPlatformAuthRepository(getPlatformDatabaseClient()),
      },
      { provide: PLATFORM_AUTH_OPTIONS, useValue: options },
      {
        provide: PLATFORM_TENANT_QUERY,
        useFactory: () => createPlatformTenantQueryService(getPlatformDatabaseClient()),
      },
      {
        provide: PLATFORM_TENANT_DETAIL_QUERY,
        useFactory: () => createPlatformTenantDetailQueryService(getPlatformDatabaseClient()),
      },
      {
        provide: PLATFORM_TENANT_PROVISIONING_REPOSITORY,
        useFactory: () => createPlatformTenantProvisioningRepository(getPlatformDatabaseClient()),
      },
      {
        provide: TENANT_AUTH_REPOSITORY,
        useFactory: (): TenantAuthRepository =>
          createTenantAuthRepository(getPlatformDatabaseClient()),
      },
      { provide: TENANT_AUTH_OPTIONS, useValue: tenantOptions },
      { provide: TENANT_DATA_ACCESS_DATABASE, useFactory: getPlatformDatabaseClient },
      {
        provide: PASSWORD_RESET_DELIVERY,
        useValue: dependencies.passwordResetDelivery ?? new UnavailablePasswordResetDelivery(),
      },
    ],
  })
  class AppModule {}

  const app = await NestFactory.create(AppModule);
  app.enableCors({
    credentials: true,
    origin: [...new Set([config.platformWebOrigin, config.tenantWebOrigin])],
  });
  return app;
}
