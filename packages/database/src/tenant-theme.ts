import type { TenantBranding } from "@whatsapp-platform/themes";
import {
  defaultTenantBranding,
  type ResolvedTenantTheme,
  resolveTenantTheme,
  tenantBrandingSchema,
} from "@whatsapp-platform/themes";
import type { Prisma } from "./generated/prisma/client";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess, type TenantTransactionDatabase } from "./tenant-data-access";

export type TenantThemeDatabase = TenantTransactionDatabase &
  Pick<Prisma.TransactionClient, "tenant">;

export type TenantThemeMutationMetadata = Readonly<{
  actorUserId: string;
  requestId: string;
}>;

export type TenantTheme = Readonly<{
  branding: ResolvedTenantTheme;
  config: TenantBranding;
}>;

export class TenantThemeNotFoundError extends Error {
  override readonly name = "TenantThemeNotFoundError";
}

export interface TenantThemeRepository {
  get(context: TenantContext): Promise<TenantTheme>;
  update(
    context: TenantContext,
    input: TenantBranding,
    metadata: TenantThemeMutationMetadata,
  ): Promise<TenantTheme>;
}

function brandingSummary(value: unknown): {
  version: number;
  preset: string;
  colorMode: string;
} | null {
  const parsed = tenantBrandingSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    version: parsed.data.version,
    preset: parsed.data.preset,
    colorMode: parsed.data.colorMode,
  };
}

function themeFor(config: unknown): TenantTheme {
  const parsed = tenantBrandingSchema.safeParse(config);
  const canonical = parsed.success ? parsed.data : defaultTenantBranding();
  return Object.freeze({
    branding: resolveTenantTheme(canonical),
    config: canonical,
  });
}

export function createTenantThemeRepository(database: TenantThemeDatabase): TenantThemeRepository {
  const get = async (context: TenantContext): Promise<TenantTheme> => {
    const tenantContext = createTenantContext(context.tenantId);
    const tenant = await database.tenant.findUnique({
      select: { brandingConfig: true },
      where: { id: tenantContext.tenantId },
    });
    if (tenant === null) throw new TenantThemeNotFoundError();
    return themeFor(tenant.brandingConfig);
  };

  const update = async (
    context: TenantContext,
    input: TenantBranding,
    metadata: TenantThemeMutationMetadata,
  ): Promise<TenantTheme> =>
    database.$transaction(async (transaction) => {
      const tenantContext = createTenantContext(context.tenantId);
      const current = await transaction.tenant.findUnique({
        select: { brandingConfig: true },
        where: { id: tenantContext.tenantId },
      });
      if (current === null) throw new TenantThemeNotFoundError();

      const updated = await transaction.tenant.updateMany({
        data: { brandingConfig: input },
        where: { id: tenantContext.tenantId },
      });
      if (updated.count === 0) throw new TenantThemeNotFoundError();

      const data = createTenantDataAccess(tenantContext, transaction);
      await data.audit.append({
        action: "tenant.theme.updated",
        actorId: metadata.actorUserId,
        actorType: "tenant_user",
        afterSummary: {
          version: input.version,
          preset: input.preset,
          colorMode: input.colorMode,
          logoKind: input.logo?.kind ?? null,
        },
        beforeSummary: brandingSummary(current.brandingConfig),
        entityId: tenantContext.tenantId,
        entityType: "Tenant",
        requestId: metadata.requestId,
      });
      await data.outbox.append({
        aggregateId: tenantContext.tenantId,
        aggregateType: "Tenant",
        eventType: "tenant.theme.updated",
        payload: {
          preset: input.preset,
          colorMode: input.colorMode,
          logoKind: input.logo?.kind ?? null,
          tenantId: tenantContext.tenantId,
        },
      });
      return themeFor(input);
    });

  return Object.freeze({ get, update });
}
