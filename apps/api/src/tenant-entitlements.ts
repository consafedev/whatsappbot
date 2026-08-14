import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ModuleEntitlementKey } from "@whatsapp-platform/database";
import type { TenantAuthenticationRequest } from "./tenant-context";
import { TenantDataAccessFactory } from "./tenant-context";

const REQUIRED_ENTITLEMENTS = Symbol("REQUIRED_ENTITLEMENTS");

export function RequireEntitlements(
  ...moduleKeys: readonly ModuleEntitlementKey[]
): MethodDecorator & ClassDecorator {
  return SetMetadata(REQUIRED_ENTITLEMENTS, Object.freeze([...moduleKeys]));
}

@Injectable()
export class TenantEntitlementGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(TenantDataAccessFactory)
    private readonly dataAccessFactory: TenantDataAccessFactory,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<readonly ModuleEntitlementKey[]>(
      REQUIRED_ENTITLEMENTS,
      [context.getHandler(), context.getClass()],
    );
    if (required === undefined || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<TenantAuthenticationRequest>();
    if (request.auth === undefined || request.tenantContext === undefined) {
      throw new UnauthorizedException("Authentication required");
    }
    const resolver = this.dataAccessFactory.create(request.tenantContext).entitlements;
    for (const moduleKey of required) {
      if (!(await resolver.isModuleEnabled(moduleKey))) {
        throw new ForbiddenException({
          code: "ENTITLEMENT_REQUIRED",
          error: "Forbidden",
          message: "Module entitlement required",
          moduleKey,
          statusCode: 403,
        });
      }
    }
    return true;
  }
}
