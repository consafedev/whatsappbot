declare const tenantIdBrand: unique symbol;

export type TenantId = string & { readonly [tenantIdBrand]: "TenantId" };

export type TenantContext = Readonly<{
  tenantId: TenantId;
}>;

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createTenantContext(tenantId: string): TenantContext {
  if (!uuidV7Pattern.test(tenantId)) {
    throw new TypeError("tenantId must be a valid UUIDv7");
  }

  return Object.freeze({ tenantId: tenantId as TenantId });
}
