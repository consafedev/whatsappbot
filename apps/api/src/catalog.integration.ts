import {
  generateOpaqueToken,
  hashOpaqueToken,
  PlatformPasswordHasher,
} from "@whatsapp-platform/auth";
import { loadDatabaseConfig, loadNonSecretConfig } from "@whatsapp-platform/config";
import {
  createPlatformDatabaseClient,
  type PrismaClient,
  syncPermissionCatalog,
} from "@whatsapp-platform/database/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "./app";

const prefix = "e15-s01-catalog-api";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl = "";
let tenantId = "";
let managerCookie = "";
let readCookie = "";
let noPermissionCookie = "";

function binary(value: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.userSession.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userRole.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: ids } } } });
  await prisma.role.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

describe.sequential("E15-S01 catalog API", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    const tenant = await prisma.tenant.create({
      data: {
        defaultCurrency: "MXN",
        defaultLocale: "es-MX",
        defaultTimezone: "America/Mexico_City",
        displayName: "Catalog API tenant",
        legalName: "Catalog API tenant",
        slug: `${prefix}-tenant`,
        status: "active",
      },
    });
    tenantId = tenant.id;
    await prisma.tenantEntitlement.create({
      data: {
        enabled: true,
        entitlementKey: "module.catalog",
        source: "contract",
        tenantId,
      },
    });
    const createSessionFor = async (marker: string, permissionKeys: readonly string[]) => {
      const user = await prisma.user.create({
        data: {
          displayName: `Catalog ${marker}`,
          email: `${prefix}-${marker}@example.invalid`,
          locale: "es-MX",
          passwordHash: await new PlatformPasswordHasher().hash("catalog API integration password"),
          tenantId,
          timezone: "America/Mexico_City",
        },
      });
      const role = await prisma.role.create({
        data: { key: `e15-catalog-${marker}`, name: `Catalog ${marker}`, tenantId },
      });
      for (const key of permissionKeys) {
        const permission = await prisma.permission.findUnique({ where: { key } });
        if (permission === null) throw new Error(`Missing canonical permission: ${key}`);
        await prisma.rolePermission.create({
          data: { permissionId: permission.id, roleId: role.id },
        });
      }
      await prisma.userRole.create({ data: { roleId: role.id, tenantId, userId: user.id } });
      const token = generateOpaqueToken();
      await prisma.userSession.create({
        data: {
          expiresAt: new Date(Date.now() + 3_600_000),
          tenantId,
          tokenHash: binary(hashOpaqueToken(token)),
          userId: user.id,
        },
      });
      return { cookie: `tenant_session=${token}`, userId: user.id };
    };
    const [manager, reader, none] = await Promise.all([
      createSessionFor("manager", ["catalog.manage", "catalog.read"]),
      createSessionFor("reader", ["catalog.read"]),
      createSessionFor("none", []),
    ]);
    managerCookie = manager.cookie;
    readCookie = reader.cookie;
    noPermissionCookie = none.cookie;
    app = await createApiApplication(loadNonSecretConfig({ NODE_ENV: "test" }));
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("creates a product for an authenticated catalog manager", async () => {
    const response = await fetch(`${baseUrl}/api/v1/products`, {
      body: JSON.stringify({
        currency: "MXN",
        name: "S01 RED product",
        price: "125.5000",
        sku: "s01-red-1",
        unit: "piece",
      }),
      headers: { cookie: managerCookie, "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      data: {
        active: boolean;
        currency: string;
        id: string;
        price: string;
        sku: string;
        taxRate: string | null;
      };
      success: boolean;
    };
    expect(created).toMatchObject({
      data: { active: true, currency: "MXN", price: "125.5000", sku: "s01-red-1", taxRate: null },
      success: true,
    });
    const detail = await fetch(`${baseUrl}/api/v1/products/${created.data.id}`, {
      headers: { cookie: readCookie },
    });
    expect(detail.status).toBe(200);
    const list = await fetch(`${baseUrl}/api/v1/products?limit=1&search=red`, {
      headers: { cookie: readCookie },
    });
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      data: { items: [{ id: created.data.id }] },
      success: true,
    });
    const duplicate = await fetch(`${baseUrl}/api/v1/products`, {
      body: JSON.stringify({
        currency: "MXN",
        name: "Duplicate",
        price: "1",
        sku: "S01-RED-1",
        unit: "piece",
      }),
      headers: { cookie: managerCookie, "content-type": "application/json" },
      method: "POST",
    });
    expect(duplicate.status).toBe(409);
    const archived = await fetch(`${baseUrl}/api/v1/products/${created.data.id}/archive`, {
      headers: { cookie: managerCookie },
      method: "POST",
    });
    expect(archived.status).toBe(200);
    const repeatedArchive = await fetch(`${baseUrl}/api/v1/products/${created.data.id}/archive`, {
      headers: { cookie: managerCookie },
      method: "POST",
    });
    expect(repeatedArchive.status).toBe(200);
    const archiveWithAuthority = await fetch(
      `${baseUrl}/api/v1/products/${created.data.id}/archive`,
      {
        body: JSON.stringify({ tenantId }),
        headers: { cookie: managerCookie, "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(archiveWithAuthority.status).toBe(400);
    expect(await prisma.product.count({ where: { id: created.data.id, tenantId } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { entityId: created.data.id, action: "catalog_product.archived" },
      }),
    ).toBe(1);
    expect(
      await prisma.domainEventOutbox.count({
        where: { aggregateId: created.data.id, eventType: "catalog_product.archived" },
      }),
    ).toBe(1);
  });

  it("requires catalog entitlement and permission, rejects duplicate query fields and unknown authority input", async () => {
    expect((await fetch(`${baseUrl}/api/v1/products`)).status).toBe(401);
    expect(
      (await fetch(`${baseUrl}/api/v1/products`, { headers: { cookie: noPermissionCookie } }))
        .status,
    ).toBe(403);
    expect(
      (await fetch(`${baseUrl}/api/v1/products`, { headers: { cookie: managerCookie } })).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/products?search=a&search=b`, {
          headers: { cookie: readCookie },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/products?tenantId=${tenantId}`, {
          headers: { cookie: readCookie },
        })
      ).status,
    ).toBe(400);
    const unauthorizedWrite = await fetch(`${baseUrl}/api/v1/products`, {
      body: JSON.stringify({
        currency: "MXN",
        name: "Reader write",
        price: "1",
        sku: "READER",
        unit: "piece",
      }),
      headers: { cookie: readCookie, "content-type": "application/json" },
      method: "POST",
    });
    expect(unauthorizedWrite.status).toBe(403);
    const unknown = await fetch(`${baseUrl}/api/v1/products`, {
      body: JSON.stringify({
        currency: "MXN",
        name: "Unknown key",
        price: "1",
        sku: "UNKNOWN",
        tenantId,
        unit: "piece",
      }),
      headers: { cookie: managerCookie, "content-type": "application/json" },
      method: "POST",
    });
    expect(unknown.status).toBe(400);
    for (const [index, product] of [
      { currency: "MXN", name: "Numeric price", price: 1.25, sku: "NUMERIC-PRICE", unit: "piece" },
      {
        currency: "MXN",
        name: "High tax",
        price: "1",
        sku: "HIGH-TAX",
        taxRate: "100.0001",
        unit: "piece",
      },
      {
        currency: "MXN",
        name: "High price",
        price: "1000000000",
        sku: "HIGH-PRICE",
        unit: "piece",
      },
    ].entries()) {
      const invalid = await fetch(`${baseUrl}/api/v1/products`, {
        body: JSON.stringify(product),
        headers: {
          cookie: managerCookie,
          "content-type": "application/json",
          "x-request-id": `${prefix}-invalid-${index}`,
        },
        method: "POST",
      });
      expect(invalid.status).toBe(400);
    }
    const customValues = Object.fromEntries(
      Array.from({ length: 520 }, (_, index) => [`k${index}`, "x".repeat(20)]),
    );
    const jsonbLimit = await fetch(`${baseUrl}/api/v1/products`, {
      body: JSON.stringify({
        currency: "MXN",
        customValues,
        name: "JSONB limit",
        price: "1",
        sku: "JSONB-LIMIT",
        unit: "piece",
      }),
      headers: {
        cookie: managerCookie,
        "content-type": "application/json",
        "x-request-id": `${prefix}-jsonb-limit`,
      },
      method: "POST",
    });
    expect(jsonbLimit.status).toBe(400);
    expect(await prisma.product.count({ where: { tenantId } })).toBe(1);
    await prisma.tenantEntitlement.update({
      data: { enabled: false },
      where: { tenantId_entitlementKey: { entitlementKey: "module.catalog", tenantId } },
    });
    expect(
      (await fetch(`${baseUrl}/api/v1/products`, { headers: { cookie: readCookie } })).status,
    ).toBe(403);
    await prisma.tenantEntitlement.update({
      data: { enabled: true },
      where: { tenantId_entitlementKey: { entitlementKey: "module.catalog", tenantId } },
    });
  });

  it("returns tenant-scoped detail and hides a foreign product", async () => {
    const tenantB = await prisma.tenant.create({
      data: {
        defaultCurrency: "MXN",
        defaultLocale: "es-MX",
        defaultTimezone: "America/Mexico_City",
        displayName: "Catalog API tenant B",
        legalName: "Catalog API tenant B",
        slug: `${prefix}-foreign`,
        status: "active",
      },
    });
    const foreignUnit = await prisma.organizationUnit.create({
      data: { name: "Foreign branch", tenantId: tenantB.id, type: "branch" },
    });
    expect(
      (
        await fetch(`${baseUrl}/api/v1/products?organizationUnitId=${foreignUnit.id}`, {
          headers: { cookie: readCookie },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(
          `${baseUrl}/api/v1/products?organizationUnitId=00000000-0000-7000-8000-000000000001`,
          { headers: { cookie: readCookie } },
        )
      ).status,
    ).toBe(400);
    const foreign = await prisma.product.create({
      data: {
        currency: "MXN",
        name: "Foreign product",
        normalizedSku: "FOREIGN-1",
        price: "1.0000",
        sku: "foreign-1",
        unit: "piece",
        tenantId: tenantB.id,
      },
    });
    expect(
      (await fetch(`${baseUrl}/api/v1/products/${foreign.id}`, { headers: { cookie: readCookie } }))
        .status,
    ).toBe(404);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/products/${foreign.id}`, {
          body: JSON.stringify({ name: "Hijacked" }),
          headers: { cookie: managerCookie, "content-type": "application/json" },
          method: "PATCH",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/products/${foreign.id}/archive`, {
          headers: { cookie: managerCookie },
          method: "POST",
        })
      ).status,
    ).toBe(404);
    await prisma.product.deleteMany({ where: { tenantId: tenantB.id } });
    await prisma.organizationUnit.delete({ where: { id: foreignUnit.id } });
    await prisma.tenant.delete({ where: { id: tenantB.id } });
  });
});
