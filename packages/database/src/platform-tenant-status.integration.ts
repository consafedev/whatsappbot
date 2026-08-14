import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlatformDatabaseClient, type Prisma, type PrismaClient } from "./platform";
import {
  createPlatformTenantStatusWriter,
  type PlatformTenantStatusDatabase,
} from "./platform-tenant-status";
import { createTenantContext } from "./tenant-context";
import { assertTenantOperational, TenantNotOperationalError } from "./tenant-operational";

const prefix = "e03-s05-database";
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

function failingOutboxDatabase(): PlatformTenantStatusDatabase {
  return {
    auditLog: prisma.auditLog,
    domainEventOutbox: prisma.domainEventOutbox,
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
      )) as PlatformTenantStatusDatabase["$transaction"],
  };
}

describe.sequential("Platform tenant status writer", () => {
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
            defaultTimezone: "UTC",
            displayName: `${prefix}-${marker}`,
            legalName: `${prefix}-${marker}`,
            slug: `${prefix}-${marker}`,
            status: "active",
          },
        }),
      ),
    );
    if (tenantA === undefined || tenantB === undefined) throw new Error("Fixture failure");
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    await prisma.tenantEntitlement.create({
      data: {
        config: { preserved: true },
        enabled: true,
        entitlementKey: "module.quotes",
        source: "manual_override",
        tenantId: tenantAId,
      },
    });
  });

  afterAll(async () => {
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("transitions atomically, is idempotent and preserves tenant configuration", async () => {
    const writer = createPlatformTenantStatusWriter(prisma);
    const suspendedAt = new Date("2026-08-14T12:00:00.000Z");
    const first = await writer.suspend(
      tenantAId,
      { actorPlatformAdminId: "admin-e03-s05", requestId: `${prefix}-suspend` },
      suspendedAt,
    );
    expect(first).toEqual({
      changed: true,
      tenant: { id: tenantAId, status: "suspended", suspendedAt },
    });
    const duplicate = await writer.suspend(
      tenantAId,
      { actorPlatformAdminId: "admin-e03-s05", requestId: `${prefix}-suspend-repeat` },
      new Date("2026-08-14T13:00:00.000Z"),
    );
    expect(duplicate).toEqual({
      changed: false,
      tenant: { id: tenantAId, status: "suspended", suspendedAt },
    });
    expect(
      await prisma.auditLog.count({ where: { action: "tenant.suspended", tenantId: tenantAId } }),
    ).toBe(1);
    expect(
      await prisma.domainEventOutbox.count({
        where: { eventType: "tenant.suspended", tenantId: tenantAId },
      }),
    ).toBe(1);
    expect(
      await prisma.tenantEntitlement.findUniqueOrThrow({
        where: {
          tenantId_entitlementKey: { entitlementKey: "module.quotes", tenantId: tenantAId },
        },
      }),
    ).toMatchObject({ config: { preserved: true }, enabled: true });

    const reactivated = await writer.reactivate(tenantAId, {
      actorPlatformAdminId: "admin-e03-s05",
      requestId: `${prefix}-reactivate`,
    });
    expect(reactivated).toMatchObject({
      changed: true,
      tenant: { status: "active", suspendedAt: null },
    });
    const repeatedReactivate = await writer.reactivate(tenantAId, {
      actorPlatformAdminId: "admin-e03-s05",
      requestId: `${prefix}-reactivate-repeat`,
    });
    expect(repeatedReactivate).toMatchObject({
      changed: false,
      tenant: { status: "active", suspendedAt: null },
    });
    expect(
      await prisma.auditLog.count({ where: { action: "tenant.reactivated", tenantId: tenantAId } }),
    ).toBe(1);
    expect(
      await prisma.domainEventOutbox.count({
        where: { eventType: "tenant.reactivated", tenantId: tenantAId },
      }),
    ).toBe(1);
    const reSuspendedAt = new Date("2026-08-14T14:00:00.000Z");
    const reSuspended = await writer.suspend(
      tenantAId,
      { actorPlatformAdminId: "admin-e03-s05", requestId: `${prefix}-resuspend` },
      reSuspendedAt,
    );
    expect(reSuspended).toEqual({
      changed: true,
      tenant: { id: tenantAId, status: "suspended", suspendedAt: reSuspendedAt },
    });
    expect(
      await prisma.domainEventOutbox.count({
        where: { eventType: "tenant.suspended", tenantId: tenantAId },
      }),
    ).toBe(2);
  });

  it("fails closed operational checks and rejects invalid/concurrent transitions", async () => {
    const writer = createPlatformTenantStatusWriter(prisma);
    await writer.suspend(tenantAId, {
      actorPlatformAdminId: "admin-e03-s05",
      requestId: `${prefix}-operational-suspend`,
    });
    await expect(
      assertTenantOperational(createTenantContext(tenantAId), prisma),
    ).rejects.toBeInstanceOf(TenantNotOperationalError);
    await expect(
      assertTenantOperational(createTenantContext(tenantBId), prisma),
    ).resolves.toBeUndefined();
    await prisma.tenant.update({ data: { status: "archived" }, where: { id: tenantAId } });
    await expect(
      writer.reactivate(tenantAId, {
        actorPlatformAdminId: "admin-e03-s05",
        requestId: `${prefix}-archived`,
      }),
    ).rejects.toMatchObject({ name: "PlatformTenantStatusTransitionError" });
    await Promise.all([
      writer.suspend(tenantBId, {
        actorPlatformAdminId: "admin-e03-s05",
        requestId: `${prefix}-race-a`,
      }),
      writer.suspend(tenantBId, {
        actorPlatformAdminId: "admin-e03-s05",
        requestId: `${prefix}-race-b`,
      }),
    ]);
    expect(
      await prisma.auditLog.count({ where: { action: "tenant.suspended", tenantId: tenantBId } }),
    ).toBe(1);
  });

  it("rolls back a status transition when Outbox persistence fails", async () => {
    await prisma.tenant.update({
      data: { status: "active", suspendedAt: null },
      where: { id: tenantAId },
    });
    const writer = createPlatformTenantStatusWriter(failingOutboxDatabase());
    await expect(
      writer.suspend(tenantAId, {
        actorPlatformAdminId: "admin-e03-s05",
        requestId: `${prefix}-rollback`,
      }),
    ).rejects.toThrow("forced outbox failure");
    expect(await prisma.tenant.findUniqueOrThrow({ where: { id: tenantAId } })).toMatchObject({
      status: "active",
      suspendedAt: null,
    });
    expect(await prisma.auditLog.count({ where: { requestId: `${prefix}-rollback` } })).toBe(0);
    expect(
      await prisma.domainEventOutbox.count({
        where: { eventType: "tenant.suspended", tenantId: tenantAId },
      }),
    ).toBe(2);
  });
});
