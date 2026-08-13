import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { platformCookieConfig } from "@whatsapp-platform/auth";
import type { NonSecretConfig } from "@whatsapp-platform/config";
import {
  createPlatformAuthRepository,
  getPlatformDatabaseClient,
  type PlatformAuthRepository,
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

@Controller()
class HealthController {
  @Get("health")
  health(): { service: "api"; status: "ok" } {
    return { service: "api", status: "ok" };
  }
}

export async function createApiApplication(config: Readonly<NonSecretConfig>) {
  const options: PlatformAuthOptions = {
    cookie: platformCookieConfig(config.environment),
    webOrigin: config.platformWebOrigin,
  };
  @Module({
    controllers: [HealthController, PlatformAuthController],
    providers: [
      PlatformAuthService,
      PlatformLoginRateLimiter,
      PlatformOriginGuard,
      PlatformAdminSessionGuard,
      PlatformAdminLogoutGuard,
      {
        provide: PLATFORM_AUTH_REPOSITORY,
        useFactory: (): PlatformAuthRepository =>
          createPlatformAuthRepository(getPlatformDatabaseClient()),
      },
      { provide: PLATFORM_AUTH_OPTIONS, useValue: options },
    ],
  })
  class AppModule {}

  const app = await NestFactory.create(AppModule);
  app.enableCors({ credentials: true, origin: config.platformWebOrigin });
  return app;
}
