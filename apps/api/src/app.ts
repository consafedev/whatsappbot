import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { platformCookieConfig, tenantCookieConfig } from "@whatsapp-platform/auth";
import type { NonSecretConfig } from "@whatsapp-platform/config";
import {
  createPlatformAuthRepository,
  createTenantAuthRepository,
  getPlatformDatabaseClient,
  type PlatformAuthRepository,
  type TenantAuthRepository,
} from "@whatsapp-platform/database/platform";
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
    controllers: [HealthController, PlatformAuthController, TenantAuthController],
    providers: [
      PlatformAuthService,
      PlatformLoginRateLimiter,
      PlatformOriginGuard,
      PlatformAdminSessionGuard,
      PlatformAdminLogoutGuard,
      TenantAuthService,
      TenantAuthRateLimiter,
      TenantOriginGuard,
      TenantUserSessionGuard,
      TenantLogoutGuard,
      {
        provide: PLATFORM_AUTH_REPOSITORY,
        useFactory: (): PlatformAuthRepository =>
          createPlatformAuthRepository(getPlatformDatabaseClient()),
      },
      { provide: PLATFORM_AUTH_OPTIONS, useValue: options },
      {
        provide: TENANT_AUTH_REPOSITORY,
        useFactory: (): TenantAuthRepository =>
          createTenantAuthRepository(getPlatformDatabaseClient()),
      },
      { provide: TENANT_AUTH_OPTIONS, useValue: tenantOptions },
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
