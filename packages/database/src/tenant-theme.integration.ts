import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlatformDatabaseClient, type Prisma, type PrismaClient } from "./platform";
import { createTenantContext } from "./tenant-context";
import {
  createTenantThemeRepository,
  type TenantThemeDatabase,
  TenantThemeNotFoundError,
} from "./tenant-theme";

const prefix = "e04-s02-theme";
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.userSession.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userRole.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: ids } } } });
  await prisma.role.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

function failingOutboxDatabase(): TenantThemeDatabase {
  return {
    tenant: prisma.tenant,
    $transaction: ((callback: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
      prisma.$transaction((transaction) =>
        callback(
          new Proxy(transaction, {
            get(target, property, receiver) {
              if (property === "domainEventOutbox") {
                return { create: async () => Promise.reject(new Error("forced outbox failure")) };
              }
              return Reflect.get(target, property, receiver);
            },
          }),
        ),
      )) as TenantThemeDatabase["$transaction"],
  };
}

describe.sequential("Tenant theme repository", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    const [tenantA, tenantB] = await Promise.all(
      ["a", "b"].map((marker) =>
        prisma.tenant.create({
          data: {
            defaultCurrency: "MXN",
            defaultLocale: "es-MX",
            defaultTimezone: "America/Mexico_City",
            displayName: `Theme ${marker}`,
            legalName: `Theme ${marker}`,
            slug: `${prefix}-${marker}`,
            status: "active",
          },
        }),
      ),
    );
    if (tenantA === undefined || tenantB === undefined) throw new Error("Fixture failure");
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
  });

  afterAll(async () => {
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("resolves the default theme for an empty configuration", async () => {
    const repository = createTenantThemeRepository(prisma);
    const theme = await repository.get(createTenantContext(tenantAId));
    expect(theme.config).toEqual({
      version: 1,
      preset: "corporate-blue",
      colorMode: "light",
      logo: null,
    });
    expect(theme.branding).toMatchObject({
      colorMode: "light",
      logo: null,
      preset: "corporate-blue",
      tokens: { primary: "#294f7c", surface: "#ffffff" },
    });
  });

  it("persists a preset theme atomically with audit and outbox events", async () => {
    const repository = createTenantThemeRepository(prisma);
    const updated = await repository.update(
      createTenantContext(tenantAId),
      { version: 1, preset: "premium-minimal", colorMode: "dark" },
      { actorUserId: "user-e04-s02", requestId: `${prefix}-update` },
    );
    expect(updated.config).toEqual({ version: 1, preset: "premium-minimal", colorMode: "dark" });
    expect(updated.branding.tokens.primary).toBe("#e8e4da");

    const audit = await prisma.auditLog.findFirst({
      orderBy: { occurredAt: "desc" },
      where: { tenantId: tenantAId, action: "tenant.theme.updated" },
    });
    expect(audit).toMatchObject({
      actorId: "user-e04-s02",
      actorType: "tenant_user",
      entityId: tenantAId,
      entityType: "Tenant",
      requestId: `${prefix}-update`,
      beforeSummary: null,
      afterSummary: { version: 1, preset: "premium-minimal", colorMode: "dark", logoKind: null },
    });

    const outbox = await prisma.domainEventOutbox.findFirst({
      orderBy: { occurredAt: "desc" },
      where: { tenantId: tenantAId, eventType: "tenant.theme.updated" },
    });
    expect(outbox).toMatchObject({
      aggregateId: tenantAId,
      aggregateType: "Tenant",
      eventType: "tenant.theme.updated",
    });
    expect(JSON.stringify(outbox?.payload ?? {})).not.toMatch(/cdn\.example|logo\.png/i);
  });

  it("persists custom colors and a logo, keeping audit summaries free of the logo URL", async () => {
    const repository = createTenantThemeRepository(prisma);
    const updated = await repository.update(
      createTenantContext(tenantAId),
      {
        version: 1,
        preset: "custom",
        colorMode: "light",
        colors: { primary: "#0b5394", secondary: "#1e8449", accent: "#7b3fa0" },
        logo: { kind: "url", url: "https://cdn.example.com/logo.png" },
      },
      { actorUserId: "user-e04-s02", requestId: `${prefix}-custom` },
    );
    expect(updated.config.colors).toEqual({
      primary: "#0b5394",
      secondary: "#1e8449",
      accent: "#7b3fa0",
    });
    expect(updated.branding.preset).toBe("custom");
    expect(updated.branding.logo).toEqual({ kind: "url", url: "https://cdn.example.com/logo.png" });

    const stored = await prisma.tenant.findUnique({
      select: { brandingConfig: true },
      where: { id: tenantAId },
    });
    expect(stored?.brandingConfig).toMatchObject({ version: 1, preset: "custom" });

    const audit = await prisma.auditLog.findFirst({
      orderBy: { occurredAt: "desc" },
      where: { tenantId: tenantAId, action: "tenant.theme.updated" },
    });
    expect(JSON.stringify(audit?.afterSummary)).not.toMatch(/cdn\.example|logo\.png/i);
    expect(JSON.stringify(audit?.beforeSummary)).toMatch(/premium-minimal/);
  });

  it("keeps tenant themes isolated between tenants", async () => {
    const repository = createTenantThemeRepository(prisma);
    const other = await repository.get(createTenantContext(tenantBId));
    expect(other.branding.preset).toBe("corporate-blue");
    expect(other.branding.tokens.primary).toBe("#294f7c");
  });

  it("restores the default when the configuration is reset to an empty object", async () => {
    const repository = createTenantThemeRepository(prisma);
    const updated = await repository.update(
      createTenantContext(tenantAId),
      { version: 1, preset: "corporate-blue", colorMode: "light" },
      { actorUserId: "user-e04-s02", requestId: `${prefix}-reset` },
    );
    expect(updated.branding.tokens.primary).toBe("#294f7c");
    expect(updated.branding.logo).toBeNull();
  });

  it("rolls back the branding change when the outbox write fails", async () => {
    const repository = createTenantThemeRepository(failingOutboxDatabase());
    await expect(
      repository.update(
        createTenantContext(tenantAId),
        { version: 1, preset: "modern-dark", colorMode: "light" },
        { actorUserId: "user-e04-s02", requestId: `${prefix}-rollback` },
      ),
    ).rejects.toThrow("forced outbox failure");
    const stored = await prisma.tenant.findUnique({
      select: { brandingConfig: true },
      where: { id: tenantAId },
    });
    expect(stored?.brandingConfig).toMatchObject({ preset: "corporate-blue" });
  });

  it("fails for an unknown tenant", async () => {
    const repository = createTenantThemeRepository(prisma);
    const missing = createTenantContext("00000000-0000-7000-8000-000000000000");
    await expect(repository.get(missing)).rejects.toBeInstanceOf(TenantThemeNotFoundError);
    await expect(
      repository.update(
        missing,
        { version: 1, preset: "corporate-blue", colorMode: "light" },
        { actorUserId: "user-e04-s02", requestId: `${prefix}-missing` },
      ),
    ).rejects.toBeInstanceOf(TenantThemeNotFoundError);
  });
});
