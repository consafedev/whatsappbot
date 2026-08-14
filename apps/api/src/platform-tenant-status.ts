import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PlatformSessionIdentity } from "@whatsapp-platform/database/platform";
import {
  PlatformTenantStatusNotFoundError,
  PlatformTenantStatusTransitionError,
  type PlatformTenantStatusWriter,
} from "@whatsapp-platform/database/platform";

export const PLATFORM_TENANT_STATUS_WRITER = Symbol("PLATFORM_TENANT_STATUS_WRITER");

@Injectable()
export class PlatformTenantStatusService {
  constructor(
    @Inject(PLATFORM_TENANT_STATUS_WRITER)
    private readonly writer: PlatformTenantStatusWriter,
  ) {}

  private async result<T>(operation: Promise<T>): Promise<T> {
    try {
      return await operation;
    } catch (error) {
      if (error instanceof PlatformTenantStatusNotFoundError) {
        throw new NotFoundException("Tenant not found");
      }
      if (error instanceof PlatformTenantStatusTransitionError) {
        throw new ConflictException("Tenant status transition is not allowed");
      }
      throw error;
    }
  }

  reactivate(identity: PlatformSessionIdentity, requestId: string, tenantId: string) {
    return this.result(
      this.writer.reactivate(tenantId, {
        actorPlatformAdminId: identity.admin.id,
        requestId,
      }),
    );
  }

  suspend(identity: PlatformSessionIdentity, requestId: string, tenantId: string) {
    return this.result(
      this.writer.suspend(tenantId, {
        actorPlatformAdminId: identity.admin.id,
        requestId,
      }),
    );
  }
}
