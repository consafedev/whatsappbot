import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { platformCookieConfig, tenantCookieConfig } from "@whatsapp-platform/auth";
import type { NonSecretConfig } from "@whatsapp-platform/config";
import {
  createChannelAccountManager,
  createContactManager,
  createInboundEventManager,
  createInboxQueryManager,
  createOrganizationUnitManager,
  createOutboundConversationMessageManager,
  createOutboundMessageManager,
  createTenantThemeRepository,
  createUserManagementManager,
} from "@whatsapp-platform/database";
import {
  createInboundWebhookChannelResolver,
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
import { createMessagingCredentialCipher } from "@whatsapp-platform/messaging";
import { CONTACT_MANAGER, ContactsController, ContactsService } from "./contacts";
import { EntitlementTestProbeController } from "./entitlement-test-probe";
import {
  INBOUND_EVENT_MANAGER,
  INBOUND_WEBHOOK_CHANNEL_RESOLVER,
  INBOUND_WEBHOOK_OPTIONS,
  InboundWebhookController,
  InboundWebhookService,
} from "./inbound-webhooks";
import {
  INBOX_QUERY_MANAGER,
  InboxController,
  InboxService,
  OUTBOUND_CONVERSATION_MESSAGE_MANAGER,
} from "./inbox";
import {
  OUTBOUND_MESSAGE_MANAGER,
  OutboundMessagesController,
  OutboundMessagesService,
} from "./outbound-messages";
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
  TENANT_APP_BOOTSTRAP_DATABASE,
  TenantAppBootstrapController,
  TenantAppBootstrapService,
} from "./tenant-app-bootstrap";
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
  CHANNEL_ACCOUNT_MANAGER,
  MESSAGING_CREDENTIAL_CIPHER,
  TenantChannelsController,
  TenantChannelsService,
} from "./tenant-channels";
import {
  TENANT_DATA_ACCESS_DATABASE,
  TenantContextGuard,
  TenantDataAccessFactory,
} from "./tenant-context";
import { TenantEntitlementGuard } from "./tenant-entitlements";
import {
  ORGANIZATION_UNIT_MANAGER,
  TenantOrganizationUnitsController,
  TenantOrganizationUnitsService,
} from "./tenant-organization-units";
import { TenantPermissionGuard } from "./tenant-rbac";
import { TENANT_THEME_REPOSITORY, TenantThemeController, TenantThemeService } from "./tenant-theme";
import {
  TenantUserManagementController,
  TenantUserManagementService,
  USER_MANAGEMENT_MANAGER,
} from "./tenant-user-management";

@Controller()
class HealthController {
  @Get("health")
  health(): { service: "api"; status: "ok" } {
    return { service: "api", status: "ok" };
  }
}

export async function createApiApplication(
  config: Readonly<NonSecretConfig>,
  dependencies: {
    messagingCredentialsKey?: string;
    passwordResetDelivery?: PasswordResetDelivery;
  } = {},
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
      TenantAppBootstrapController,
      TenantThemeController,
      TenantOrganizationUnitsController,
      TenantUserManagementController,
      TenantChannelsController,
      ContactsController,
      OutboundMessagesController,
      InboxController,
      InboundWebhookController,
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
      TenantAppBootstrapService,
      TenantThemeService,
      TenantOrganizationUnitsService,
      TenantUserManagementService,
      TenantChannelsService,
      ContactsService,
      OutboundMessagesService,
      InboxService,
      InboundWebhookService,
      {
        provide: ORGANIZATION_UNIT_MANAGER,
        useFactory: () => createOrganizationUnitManager(getPlatformDatabaseClient()),
      },
      {
        provide: USER_MANAGEMENT_MANAGER,
        useFactory: () => createUserManagementManager(getPlatformDatabaseClient()),
      },
      {
        provide: CHANNEL_ACCOUNT_MANAGER,
        useFactory: () => createChannelAccountManager(getPlatformDatabaseClient()),
      },
      {
        provide: CONTACT_MANAGER,
        useFactory: () => createContactManager(getPlatformDatabaseClient()),
      },
      {
        provide: INBOUND_EVENT_MANAGER,
        useFactory: () => createInboundEventManager(getPlatformDatabaseClient()),
      },
      {
        provide: OUTBOUND_MESSAGE_MANAGER,
        useFactory: () => createOutboundMessageManager(getPlatformDatabaseClient()),
      },
      {
        provide: INBOX_QUERY_MANAGER,
        useFactory: () => createInboxQueryManager(getPlatformDatabaseClient()),
      },
      {
        provide: OUTBOUND_CONVERSATION_MESSAGE_MANAGER,
        useFactory: () => createOutboundConversationMessageManager(getPlatformDatabaseClient()),
      },
      {
        provide: INBOUND_WEBHOOK_CHANNEL_RESOLVER,
        useFactory: () => createInboundWebhookChannelResolver(getPlatformDatabaseClient()),
      },
      {
        provide: INBOUND_WEBHOOK_OPTIONS,
        useValue: { allowMock: config.environment !== "production" },
      },
      {
        provide: MESSAGING_CREDENTIAL_CIPHER,
        useValue:
          dependencies.messagingCredentialsKey === undefined
            ? null
            : createMessagingCredentialCipher(
                Buffer.from(dependencies.messagingCredentialsKey, "hex"),
              ),
      },
      {
        provide: TENANT_THEME_REPOSITORY,
        useFactory: () => createTenantThemeRepository(getPlatformDatabaseClient()),
      },
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
      { provide: TENANT_APP_BOOTSTRAP_DATABASE, useFactory: getPlatformDatabaseClient },
      {
        provide: PASSWORD_RESET_DELIVERY,
        useValue: dependencies.passwordResetDelivery ?? new UnavailablePasswordResetDelivery(),
      },
    ],
  })
  class AppModule {}

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.useBodyParser("json", { limit: "256kb" });
  app.enableCors({
    credentials: true,
    origin: [...new Set([config.platformWebOrigin, config.tenantWebOrigin])],
  });
  return app;
}
