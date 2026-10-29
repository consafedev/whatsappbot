import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  archiveCatalogProduct,
  CatalogProductConflictError,
  type CatalogProductInput,
  CatalogProductValidationError,
  createCatalogProduct,
  createTenantContext,
  listCatalogProducts,
  updateCatalogProduct,
} from "./index";
import { createPlatformDatabaseClient, type PrismaClient } from "./platform";

const prefix = "e15-s01-product-manager";
const requestMetadata = {
  actorUserId: "00000000-0000-7000-8000-000000000001",
  requestId: `${prefix}-mutation`,
};
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";
let actorUserId = "";
let actorUserBId = "";
let unitAId = "";
let unitBId = "";

const contextA = () => createTenantContext(tenantAId);
const contextB = () => createTenantContext(tenantBId);

function productInput(overrides: Partial<CatalogProductInput> = {}): CatalogProductInput {
  return {
    currency: "MXN",
    name: "Catalog product",
    price: "125.5000",
    sku: "CAT-001",
    unit: "piece",
    ...overrides,
  };
}

async function createProduct(
  overrides: Partial<CatalogProductInput> = {},
  requestId = `${prefix}-create`,
) {
  return createCatalogProduct(contextA(), prisma, productInput(overrides), {
    actorUserId,
    requestId,
  });
}

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userRole.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: ids } } } });
  await prisma.role.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

describe.sequential("E15-S01 Product catalog manager", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    const [tenantA, tenantB] = await Promise.all([
      prisma.tenant.create({
        data: {
          defaultCurrency: "MXN",
          defaultLocale: "es-MX",
          defaultTimezone: "America/Mexico_City",
          displayName: "E15 catalog a",
          legalName: "E15 catalog a",
          slug: `${prefix}-a`,
          status: "active",
        },
      }),
      prisma.tenant.create({
        data: {
          defaultCurrency: "MXN",
          defaultLocale: "es-MX",
          defaultTimezone: "America/Mexico_City",
          displayName: "E15 catalog b",
          legalName: "E15 catalog b",
          slug: `${prefix}-b`,
          status: "active",
        },
      }),
    ]);
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    const user = await prisma.user.create({
      data: {
        displayName: "Catalog actor",
        email: `${prefix}@example.invalid`,
        locale: "es-MX",
        passwordHash: "unused-test-hash",
        tenantId: tenantAId,
        timezone: "America/Mexico_City",
      },
    });
    actorUserId = user.id;
    const userB = await prisma.user.create({
      data: {
        displayName: "Catalog actor B",
        email: `${prefix}-b@example.invalid`,
        locale: "es-MX",
        passwordHash: "unused-test-hash",
        tenantId: tenantBId,
        timezone: "America/Mexico_City",
      },
    });
    actorUserBId = userB.id;
    const [unitA, unitB] = await Promise.all([
      prisma.organizationUnit.create({
        data: { name: "A branch", tenantId: tenantAId, type: "branch" },
      }),
      prisma.organizationUnit.create({
        data: { name: "B branch", tenantId: tenantBId, type: "branch" },
      }),
    ]);
    unitAId = unitA.id;
    unitBId = unitB.id;
  }, 60_000);

  afterAll(async () => {
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    const tenantIds = [tenantAId, tenantBId];
    await prisma.product.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: tenantIds } } });
  });

  it("normalizes SKU with NFKC and enforces tenant uniqueness", async () => {
    const created = await createProduct({ sku: "  ＡＢＣ-1  " });
    expect(created).toMatchObject({
      sku: "ＡＢＣ-1",
      normalizedSku: "ABC-1",
      price: "125.5000",
      taxRate: null,
    });
    await expect(createProduct({ sku: "abc-1" })).rejects.toBeInstanceOf(
      CatalogProductConflictError,
    );
    const tenantBProduct = await createCatalogProduct(
      contextB(),
      prisma,
      productInput({ sku: "abc-1" }),
      { ...requestMetadata, actorUserId: actorUserBId },
    );
    expect(tenantBProduct.normalizedSku).toBe("ABC-1");
  });

  it("enforces SKU, text and decimal bounds before writing", async () => {
    const invalid = [
      { sku: "x".repeat(65) },
      { sku: "\u0000bad" },
      { sku: "ﬃ".repeat(22) },
      { name: "x".repeat(151) },
      { description: "x".repeat(2001) },
      { category: "x".repeat(121) },
      { unit: "x".repeat(33) },
      { taxCode: "x".repeat(65) },
      { price: "1000000000.0000" },
      { price: "1.00000" },
      { taxRate: "100.0001" },
      { taxRate: "1.00000" },
      { taxRate: "-0.01" },
    ];
    for (const [index, input] of invalid.entries()) {
      await expect(createProduct(input, `${prefix}-invalid-${index}`)).rejects.toBeInstanceOf(
        CatalogProductValidationError,
      );
    }
    expect(await prisma.product.count({ where: { tenantId: tenantAId } })).toBe(0);
  });

  it("rejects a foreign organization unit", async () => {
    await expect(createProduct({ organizationUnitId: unitBId })).rejects.toBeInstanceOf(
      CatalogProductValidationError,
    );
    await expect(
      listCatalogProducts(contextA(), prisma, { organizationUnitId: unitBId }),
    ).rejects.toBeInstanceOf(CatalogProductValidationError);
    await expect(
      listCatalogProducts(contextA(), prisma, {
        organizationUnitId: "00000000-0000-7000-8000-000000000001",
      }),
    ).rejects.toBeInstanceOf(CatalogProductValidationError);
    expect(await prisma.product.count({ where: { tenantId: tenantAId } })).toBe(0);
    expect(unitAId).not.toBe(unitBId);
  });

  it("uses bounded keyset pagination and includes tenant-wide products for a unit filter", async () => {
    const unitProduct = await createProduct({ organizationUnitId: unitAId, sku: "UNIT-PRODUCT" });
    const globalProduct = await createProduct({ sku: "GLOBAL-PRODUCT" });
    const firstPage = await listCatalogProducts(contextA(), prisma, {
      limit: 1,
      organizationUnitId: unitAId,
    });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await listCatalogProducts(contextA(), prisma, {
      cursor: firstPage.nextCursor as string,
      limit: 1,
      organizationUnitId: unitAId,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    expect(new Set([firstPage.items[0]?.id, secondPage.items[0]?.id])).toEqual(
      new Set([unitProduct.id, globalProduct.id]),
    );
    await expect(listCatalogProducts(contextA(), prisma, { limit: 101 })).rejects.toBeInstanceOf(
      CatalogProductValidationError,
    );
  });

  it("validates bounded object custom values and prototype safety", async () => {
    const overDepth = { a: { b: { c: { d: { e: { f: { g: { h: { i: true } } } } } } } } };
    const unsafeKey = JSON.parse('{"safe":1,"__proto__":{"polluted":true}}') as unknown;
    const nonJsonValues = [
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      { value: undefined },
      { value: () => "ignored by JSON.stringify" },
      { value: { toJSON: () => ({ hidden: true }) } },
    ];
    const cases = [
      [],
      "root primitive",
      { value: "é".repeat(8193) },
      overDepth,
      unsafeKey,
      ...nonJsonValues,
    ];
    for (const [index, customValues] of cases.entries()) {
      await expect(
        createProduct({ customValues }, `${prefix}-custom-${index}`),
      ).rejects.toBeInstanceOf(CatalogProductValidationError);
    }
    const created = await createProduct({
      customValues: { dimensions: { length: "10", width: "4" } },
    });
    expect(created.customValues).toEqual({ dimensions: { length: "10", width: "4" } });
  });

  it("rejects JSONB-canonical custom values above the SQL byte limit", async () => {
    const customValues = Object.fromEntries(
      Array.from({ length: 520 }, (_, index) => [`k${index}`, "x".repeat(20)]),
    );
    const compactBytes = Buffer.byteLength(JSON.stringify(customValues), "utf8");
    const [postgresFootprint] = await prisma.$queryRaw<Array<{ bytes: number }>>`
      SELECT octet_length(${JSON.stringify(customValues)}::jsonb::text) AS bytes
    `;
    expect(compactBytes).toBeLessThanOrEqual(16 * 1024);
    expect(postgresFootprint?.bytes).toBeGreaterThan(16 * 1024);
    await expect(
      createProduct({ customValues, sku: "JSONB-BOUNDARY" }, `${prefix}-jsonb-boundary`),
    ).rejects.toBeInstanceOf(CatalogProductValidationError);
  });

  it("applies SQL price and tax rate checks", async () => {
    const insert = (price: string, taxRate: string) => prisma.$executeRaw`
      INSERT INTO "products" ("tenant_id", "sku", "normalized_sku", "name", "unit", "price", "currency", "tax_rate", "updated_at")
      VALUES (${tenantAId}::uuid, ${`sql-${price}-${taxRate}`}, ${`SQL-${price}-${taxRate}`}, 'SQL product', 'piece', ${price}::numeric, 'MXN', ${taxRate}::numeric, now())
    `;
    await expect(insert("1000000000.0000", "0")).rejects.toThrow();
    await expect(insert("1.0000", "100.0001")).rejects.toThrow();
    expect(await prisma.product.count({ where: { tenantId: tenantAId } })).toBe(0);
  });

  it("serializes partial patches and preserves independent fields", async () => {
    const created = await createProduct({ sku: "PATCH-1" });
    const [namePatch, categoryPatch] = await Promise.all([
      updateCatalogProduct(
        contextA(),
        prisma,
        created.id,
        { name: "Concurrent name" },
        { ...requestMetadata, actorUserId, requestId: `${prefix}-patch-name` },
      ),
      updateCatalogProduct(
        contextA(),
        prisma,
        created.id,
        { category: "Concurrent category" },
        { ...requestMetadata, actorUserId, requestId: `${prefix}-patch-category` },
      ),
    ]);
    expect([namePatch.name, categoryPatch.name]).toContain("Concurrent name");
    expect(
      await prisma.product.findFirstOrThrow({ where: { id: created.id, tenantId: tenantAId } }),
    ).toMatchObject({
      category: "Concurrent category",
      name: "Concurrent name",
    });
  });

  it("does not emit mutation records for a semantic no-op patch", async () => {
    const created = await createProduct({ sku: "NOOP-1" });
    await updateCatalogProduct(
      contextA(),
      prisma,
      created.id,
      { name: created.name, price: created.price },
      { ...requestMetadata, actorUserId, requestId: `${prefix}-noop` },
    );
    expect(
      await prisma.auditLog.count({
        where: { tenantId: tenantAId, entityId: created.id, action: "catalog_product.updated" },
      }),
    ).toBe(0);
    expect(
      await prisma.domainEventOutbox.count({
        where: {
          tenantId: tenantAId,
          aggregateId: created.id,
          eventType: "catalog_product.updated",
        },
      }),
    ).toBe(0);
  });

  it("archives idempotently and concurrent repeats emit one mutation", async () => {
    const created = await createProduct({ sku: "ARCHIVE-1" });
    const [first, second] = await Promise.all([
      archiveCatalogProduct(contextA(), prisma, created.id, {
        ...requestMetadata,
        actorUserId,
        requestId: `${prefix}-archive-a`,
      }),
      archiveCatalogProduct(contextA(), prisma, created.id, {
        ...requestMetadata,
        actorUserId,
        requestId: `${prefix}-archive-b`,
      }),
    ]);
    expect(first.active).toBe(false);
    expect(second.active).toBe(false);
    expect(await prisma.product.count({ where: { id: created.id, tenantId: tenantAId } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { tenantId: tenantAId, entityId: created.id, action: "catalog_product.archived" },
      }),
    ).toBe(1);
    expect(
      await prisma.domainEventOutbox.count({
        where: {
          tenantId: tenantAId,
          aggregateId: created.id,
          eventType: "catalog_product.archived",
        },
      }),
    ).toBe(1);
  });

  it("rolls back the product mutation when the outbox insert fails", async () => {
    const created = await createProduct({ sku: "ROLLBACK-1", name: "Before failure" });
    await prisma.$executeRawUnsafe(
      "CREATE FUNCTION e15_s01_reject_catalog_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'catalog_product.updated' THEN RAISE EXCEPTION 'injected catalog outbox failure'; END IF; RETURN NEW; END $$",
    );
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER e15_s01_reject_catalog_outbox BEFORE INSERT ON domain_event_outbox FOR EACH ROW EXECUTE FUNCTION e15_s01_reject_catalog_outbox()",
    );
    try {
      await expect(
        updateCatalogProduct(
          contextA(),
          prisma,
          created.id,
          { name: "Must roll back" },
          { ...requestMetadata, actorUserId, requestId: `${prefix}-rollback` },
        ),
      ).rejects.toThrow();
      expect(
        (await prisma.product.findFirstOrThrow({ where: { id: created.id, tenantId: tenantAId } }))
          .name,
      ).toBe("Before failure");
      expect(
        await prisma.auditLog.count({
          where: { tenantId: tenantAId, entityId: created.id, action: "catalog_product.updated" },
        }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS e15_s01_reject_catalog_outbox ON domain_event_outbox",
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS e15_s01_reject_catalog_outbox()");
    }
  });
});
