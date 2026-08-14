import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "./generated/prisma/client";
import { createPlatformDatabaseClient, type PrismaClient } from "./platform";
import {
  createPlatformTenantEntitlementAdminRepository,
  type PlatformTenantEntitlementAdminDatabase,
} from "./platform-tenant-entitlement-admin";

const prefix = "e03-s04-database";
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

function failingOutboxDatabase(): PlatformTenantEntitlementAdminDatabase {
  return {
    tenant: prisma.tenant,
    tenantEntitlement: prisma.tenantEntitlement,
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
      )) as PlatformTenantEntitlementAdminDatabase["$transaction"],
  };
}

describe.sequential("Platform tenant entitlement admin repository", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    const [a, b] = await Promise.all(
      ["a", "b"].map((marker) =>
        prisma.tenant.create({
          data: {
            defaultCurrency: "MXN",
            defaultLocale: "es-MX",
            defaultTimezone: "UTC",
            displayName: `${prefix}-${marker}`,
            legalName: `${prefix}-${marker}`,
            slug: `${prefix}-${marker}`,
            status: "active",
          },
        }),
      ),
    );
    if (a === undefined || b === undefined) throw new Error("Fixture failure");
    tenantAId = a.id;
    tenantBId = b.id;
  });

  afterAll(async () => {
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("commits module row, safe Audit and Outbox atomically while preserving tenant B", async () => {
    const repository = createPlatformTenantEntitlementAdminRepository(prisma);
    const result = await repository.patchModule(
      tenantAId,
      "module.quotes",
      { config: { nested: { enabled: true } }, enabled: true },
      { actorPlatformAdminId: "admin-e03-s04", requestId: `${prefix}-module-commit` },
    );
    expect(result).toMatchObject({ effective: true, source: "manual_override" });
    const [row, audit, event, tenantBRows] = await Promise.all([
      prisma.tenantEntitlement.findUnique({
        where: {
          tenantId_entitlementKey: { entitlementKey: "module.quotes", tenantId: tenantAId },
        },
      }),
      prisma.auditLog.findFirst({ where: { requestId: `${prefix}-module-commit` } }),
      prisma.domainEventOutbox.findFirst({
        where: { eventType: "tenant.entitlement.changed", tenantId: tenantAId },
      }),
      prisma.tenantEntitlement.count({ where: { tenantId: tenantBId } }),
    ]);
    expect(row?.config).toEqual({ nested: { enabled: true } });
    expect(audit).toMatchObject({ action: "tenant.entitlement.changed", entityId: row?.id });
    expect(JSON.stringify(audit)).not.toContain("nested");
    expect(event).toMatchObject({ aggregateId: row?.id, aggregateType: "TenantEntitlement" });
    expect(JSON.stringify(event)).not.toContain("nested");
    expect(tenantBRows).toBe(0);
  });

  it("rolls back module and limit mutations when Outbox persistence fails", async () => {
    const repository = createPlatformTenantEntitlementAdminRepository(failingOutboxDatabase());
    const before = await prisma.tenantEntitlement.findUniqueOrThrow({
      where: { tenantId_entitlementKey: { entitlementKey: "module.quotes", tenantId: tenantAId } },
    });
    await expect(
      repository.patchModule(
        tenantAId,
        "module.quotes",
        { enabled: false },
        { actorPlatformAdminId: "admin", requestId: `${prefix}-module-rollback` },
      ),
    ).rejects.toThrow("forced outbox failure");
    const after = await prisma.tenantEntitlement.findUniqueOrThrow({
      where: { tenantId_entitlementKey: { entitlementKey: "module.quotes", tenantId: tenantAId } },
    });
    expect(after.enabled).toBe(before.enabled);
    expect(await prisma.auditLog.count({ where: { requestId: `${prefix}-module-rollback` } })).toBe(
      0,
    );
    await expect(
      repository.patchLimit(
        tenantAId,
        "limit.storage_bytes",
        { value: "9007199254740993" },
        { actorPlatformAdminId: "admin", requestId: `${prefix}-limit-rollback` },
      ),
    ).rejects.toThrow("forced outbox failure");
    expect(
      await prisma.tenantEntitlement.count({
        where: { entitlementKey: "limit.storage_bytes", tenantId: tenantAId },
      }),
    ).toBe(0);
    expect(await prisma.auditLog.count({ where: { requestId: `${prefix}-limit-rollback` } })).toBe(
      0,
    );
  });

  it("stores exact Decimal values and concurrent upserts cannot create duplicates", async () => {
    const repository = createPlatformTenantEntitlementAdminRepository(prisma);
    const limit = await repository.patchLimit(
      tenantAId,
      "limit.storage_bytes",
      { value: "9007199254740993" },
      { actorPlatformAdminId: "admin", requestId: `${prefix}-limit-commit` },
    );
    expect(limit.value).toBe("9007199254740993.0000");
    await Promise.all([
      repository.patchModule(
        tenantBId,
        "module.quotes",
        { enabled: true },
        { actorPlatformAdminId: "admin", requestId: `${prefix}-concurrent-a` },
      ),
      repository.patchModule(
        tenantBId,
        "module.quotes",
        { enabled: false },
        { actorPlatformAdminId: "admin", requestId: `${prefix}-concurrent-b` },
      ),
    ]);
    expect(
      await prisma.tenantEntitlement.count({
        where: { entitlementKey: "module.quotes", tenantId: tenantBId },
      }),
    ).toBe(1);
  });
});
