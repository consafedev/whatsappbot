import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createTenantContext,
  createTenantDataAccess,
  type TenantContext,
  type TenantDataAccess,
  type TenantDataAccessDatabase,
} from "@whatsapp-platform/database";
import type { TenantSessionIdentity } from "@whatsapp-platform/database/platform";

export const TENANT_DATA_ACCESS_DATABASE = Symbol("TENANT_DATA_ACCESS_DATABASE");

export type TenantAuthenticationRequest = {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  readonly auth?: TenantSessionIdentity;
  readonly tenantContext?: TenantContext;
};

export type TenantAuthenticatedRequest = Omit<
  TenantAuthenticationRequest,
  "auth" | "tenantContext"
> &
  Readonly<{
    auth: TenantSessionIdentity;
    tenantContext: TenantContext;
  }>;

function authenticatedRequest(context: ExecutionContext): TenantAuthenticatedRequest {
  const request = context.switchToHttp().getRequest<TenantAuthenticationRequest>();
  if (request.auth === undefined || request.tenantContext === undefined) {
    throw new UnauthorizedException("Authentication required");
  }
  return request as TenantAuthenticatedRequest;
}

@Injectable()
export class TenantContextGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<TenantAuthenticationRequest>();
    if (request.auth === undefined) {
      throw new UnauthorizedException("Authentication required");
    }

    let tenantContext: TenantContext;
    try {
      tenantContext = createTenantContext(request.auth.tenantId);
    } catch {
      throw new UnauthorizedException("Authentication required");
    }

    Object.defineProperty(request, "tenantContext", {
      configurable: false,
      enumerable: false,
      value: tenantContext,
      writable: false,
    });
    return true;
  }
}

export const CurrentTenantContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantContext =>
    authenticatedRequest(context).tenantContext,
);

export const CurrentTenantIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantSessionIdentity =>
    authenticatedRequest(context).auth,
);

@Injectable()
export class TenantDataAccessFactory {
  constructor(
    @Inject(TENANT_DATA_ACCESS_DATABASE)
    private readonly database: TenantDataAccessDatabase,
  ) {}

  create(context: TenantContext): TenantDataAccess {
    return createTenantDataAccess(context, this.database);
  }
}
