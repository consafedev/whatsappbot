import { RequirePermissions, TenantAuthorized } from "./tenant-rbac";

RequirePermissions("channels.manage", "audit.read");
TenantAuthorized("tenant.roles.manage");

// @ts-expect-error permission typos must fail at compile time
RequirePermissions("channels.mange");

// @ts-expect-error arbitrary permission strings are not accepted
TenantAuthorized("platform.tenants.manage");
