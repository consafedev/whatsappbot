import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { PermissionKey } from "@whatsapp-platform/rbac";
import { TenantUserSessionGuard } from "./tenant-auth";
import {
  type TenantAuthenticationRequest,
  TenantContextGuard,
  TenantDataAccessFactory,
} from "./tenant-context";

const REQUIRED_PERMISSIONS = Symbol("REQUIRED_PERMISSIONS");

export function RequirePermissions(
  ...permissions: readonly PermissionKey[]
): MethodDecorator & ClassDecorator {
  return SetMetadata(REQUIRED_PERMISSIONS, Object.freeze([...permissions]));
}

@Injectable()
export class TenantPermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(TenantDataAccessFactory)
    private readonly dataAccessFactory: TenantDataAccessFactory,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<readonly PermissionKey[]>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    if (required === undefined || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<TenantAuthenticationRequest>();
    if (request.auth === undefined || request.tenantContext === undefined) {
      throw new UnauthorizedException("Authentication required");
    }

    const effective = await this.dataAccessFactory
      .create(request.tenantContext)
      .permissions.resolveForUser(request.auth.userId);
    if (!required.every((permission) => effective.has(permission))) {
      throw new ForbiddenException("Forbidden");
    }
    return true;
  }
}

export function TenantAuthorized(
  ...permissions: readonly PermissionKey[]
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    RequirePermissions(...permissions),
    UseGuards(TenantUserSessionGuard, TenantContextGuard, TenantPermissionGuard),
  );
}
