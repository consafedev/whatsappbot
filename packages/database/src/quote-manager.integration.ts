import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createPlatformDatabaseClient,
  Prisma,
  type PrismaClient,
  syncPermissionCatalog,
} from "./platform";
import { recalculateQuoteInTransaction } from "./quote-calculation";
import {
  createQuoteDraft,
  getQuoteById,
  QUOTE_DRAFT_LIMITS,
  QuoteCommandConflictError,
  type QuoteDraftInput,
  QuoteNotFoundError,
  QuoteRevisionConflictError,
  QuoteValidationError,
  updateQuoteDraft,
} from "./quote-manager";
import { createTenantContext } from "./tenant-context";
import { createTenantDataAccess } from "./tenant-data-access";
import { TenantModuleEntitlementRequiredError } from "./tenant-entitlements";

const prefix = "e15-s03-quote-manager";
let prisma: PrismaClient;
let tenantAId = "";
let tenantBId = "";
let unitAId = "";
let unitBId = "";
let contactAId = "";
let contactBId = "";
let actorAId = "";
let actorA2Id = "";
let actorBId = "";
let productAId = "";
let productBId = "";
let quoteRoleAId = "";

const metadata = (actorUserId: string, suffix: string) => ({
  actorUserId,
  requestId: `${prefix}-${suffix}`,
});

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.quoteCommercialContributor.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.quoteCommandReceipt.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.quoteItem.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.quote.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.contact.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userRole.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: ids } } } });
  await prisma.role.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

async function createActor(
  tenantId: string,
  marker: string,
  displayName = `Sales ${marker}`,
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${prefix}-${marker}@example.invalid`,
      displayName,
      passwordHash: "integration-only-not-a-real-password-hash",
      locale: "es-MX",
      timezone: "UTC",
    },
  });
  return user.id;
}

function input(
  key: string,
  productId = productAId,
  contactId = contactAId,
  organizationUnitId = unitAId,
): QuoteDraftInput {
  return {
    idempotencyKey: key,
    organizationUnitId,
    contactId,
    currency: "USD",
    shippingTotal: "0",
    lines: [{ productId, quantity: "2.5", discount: { kind: "percent", value: "10" } }],
  };
}

async function createProduct(
  tenantId: string,
  organizationUnitId: string | null,
  sku: string,
  name: string,
  price: string,
) {
  return prisma.product.create({
    data: {
      tenantId,
      organizationUnitId,
      sku,
      normalizedSku: sku.toUpperCase(),
      name,
      description: `${name} description`,
      unit: "piece",
      price: new Prisma.Decimal(price),
      currency: "USD",
      taxCode: "TAX-8",
      taxRate: new Prisma.Decimal("8"),
    },
  });
}

async function waitForAdvisoryLockWait(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [waiting] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count
      FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND state = 'active'
        AND query LIKE '%pg_advisory_xact_lock%'
    `;
    if ((waiting?.count ?? 0n) > 0n) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Quote command did not appear waiting on a PostgreSQL advisory lock");
}

function failNextOutboxWriteDatabase() {
  let fail = true;
  return {
    $transaction: <T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>) =>
      prisma.$transaction((transaction) =>
        callback(
          new Proxy(transaction, {
            get(target, property) {
              if (property === "domainEventOutbox") {
                return new Proxy(target.domainEventOutbox, {
                  get(delegate, method) {
                    if (method === "create")
                      return async (args: Parameters<typeof delegate.create>[0]) => {
                        if (fail) {
                          fail = false;
                          throw new Error("injected Outbox failure");
                        }
                        return delegate.create(args);
                      };
                    const value = Reflect.get(delegate, method, delegate) as unknown;
                    return typeof value === "function" ? value.bind(delegate) : value;
                  },
                });
              }
              const value = Reflect.get(target, property, target) as unknown;
              return typeof value === "function" ? value.bind(target) : value;
            },
          }) as Prisma.TransactionClient,
        ),
      ),
  };
}

describe.sequential("E15-S03 quote draft calculation", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    const [tenantA, tenantB] = await Promise.all(
      ["a", "b"].map((marker) =>
        prisma.tenant.create({
          data: {
            defaultCurrency: "USD",
            defaultLocale: "en-US",
            defaultTimezone: "UTC",
            displayName: `Quote ${marker}`,
            legalName: `Quote ${marker}`,
            slug: `${prefix}-${marker}`,
            status: "active",
          },
        }),
      ),
    );
    if (tenantA === undefined || tenantB === undefined)
      throw new Error("Quote tenant fixtures failed");
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    const [unitA, unitB, contactA, contactB] = await Promise.all([
      prisma.organizationUnit.create({
        data: { tenantId: tenantAId, name: "North Unit", type: "branch" },
      }),
      prisma.organizationUnit.create({
        data: { tenantId: tenantBId, name: "Other Unit", type: "branch" },
      }),
      prisma.contact.create({
        data: {
          tenantId: tenantAId,
          name: "Ada Customer",
          phoneNumber: "+15550000001",
          customAttributes: { mustNotRead: true },
        },
      }),
      prisma.contact.create({
        data: { tenantId: tenantBId, name: "Foreign Customer", phoneNumber: "+15550000002" },
      }),
    ]);
    unitAId = unitA.id;
    unitBId = unitB.id;
    contactAId = contactA.id;
    contactBId = contactB.id;
    [actorAId, actorA2Id, actorBId] = await Promise.all([
      createActor(tenantAId, "actor-a", "Trusted Salesperson"),
      createActor(tenantAId, "actor-a2", "Second Salesperson"),
      createActor(tenantBId, "actor-b"),
    ]);
    for (const [tenantId, actorIds, marker] of [
      [tenantAId, [actorAId, actorA2Id], "a"],
      [tenantBId, [actorBId], "b"],
    ] as const) {
      const access = createTenantDataAccess(createTenantContext(tenantId), prisma);
      const role = await access.roles.createCustom({
        key: `quote-drafts-${marker}`,
        name: "Quote Drafts",
      });
      if (marker === "a") quoteRoleAId = role.id;
      await access.rolePermissions.grant(role.id, "quotes.create");
      for (const userId of actorIds) await access.userRoles.assign({ roleId: role.id, userId });
      await Promise.all(
        ["module.quotes", "module.crm_lite", "module.catalog"].map((entitlementKey) =>
          prisma.tenantEntitlement.create({
            data: { tenantId, entitlementKey, enabled: true, source: "contract" },
          }),
        ),
      );
    }
    const [productA, productB] = await Promise.all([
      createProduct(tenantAId, unitAId, "SKU-A", "Service Part", "125.5000"),
      createProduct(tenantBId, unitBId, "SKU-B", "Foreign Part", "9.0000"),
    ]);
    productAId = productA.id;
    productBId = productB.id;
  });

  afterAll(async () => {
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    await prisma.product.update({
      where: { tenantId_id: { tenantId: tenantAId, id: productAId } },
      data: {
        description: "Service Part description",
        name: "Service Part",
        price: new Prisma.Decimal("125.5000"),
        active: true,
      },
    });
  });

  it("allocates tenant-local numbers, snapshots trusted rows, and persists exact calculation results", async () => {
    const first = await createQuoteDraft(
      createTenantContext(tenantAId),
      prisma,
      input("create-one"),
      metadata(actorAId, "first"),
    );
    const second = await createQuoteDraft(
      createTenantContext(tenantAId),
      prisma,
      input("create-two"),
      metadata(actorAId, "second"),
    );
    const otherTenant = await createQuoteDraft(
      createTenantContext(tenantBId),
      prisma,
      input("create-other", productBId, contactBId, unitBId),
      metadata(actorBId, "other"),
    );
    expect(first.current).toMatchObject({
      number: "Q-000001",
      revision: 1,
      status: "draft",
      autonomyLevel: 0,
      currencyPrecision: 2,
      subtotal: "313.75",
      discountTotal: "31.38",
      taxTotal: "22.59",
      total: "304.96",
      customerNameSnapshot: "Ada Customer",
      customerPhoneSnapshot: "+15550000001",
      organizationUnitNameSnapshot: "North Unit",
      salespersonNameSnapshot: "Trusted Salesperson",
    });
    expect(first.current.lines[0]).toMatchObject({
      sku: "SKU-A",
      description: "Service Part description",
      unit: "piece",
      unitPrice: "125.5000",
      taxRate: "8.0000",
      discountKind: "percent",
      discountValue: "10.0000",
      source: "catalog",
    });
    expect(second.current.number).toBe("Q-000002");
    expect(otherTenant.current.number).toBe("Q-000001");
    expect(first.current.shippingTotal).toBe("0.0000");
    expect(first.current.calculatedRevision).toBe(1);
    expect(first.current.calculationInputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.current.lines[0]).toMatchObject({
      grossTotal: "313.75",
      discountTotal: "31.38",
      netTotal: "282.37",
      taxTotal: "22.59",
      lineTotal: "304.96",
    });
    const contributor = await prisma.quoteCommercialContributor.findUnique({
      where: {
        tenantId_quoteId_userId: {
          tenantId: tenantAId,
          quoteId: first.current.id,
          userId: actorAId,
        },
      },
    });
    expect(contributor).not.toBeNull();
  });

  it("rejects partial calculation markers with the applied PostgreSQL CHECK", async () => {
    const quote = await prisma.quote.findFirstOrThrow({ where: { tenantId: tenantAId } });
    await expect(
      prisma.$executeRaw(
        Prisma.sql`UPDATE "quotes" SET "calculated_revision" = NULL WHERE "tenant_id" = ${tenantAId}::uuid AND "id" = ${quote.id}::uuid`,
      ),
    ).rejects.toThrow();
    const unchanged = await prisma.quote.findUniqueOrThrow({
      where: { tenantId_id: { tenantId: tenantAId, id: quote.id } },
    });
    expect(unchanged.calculatedRevision).toBe(1);
    expect(unchanged.calculationInputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rolls back invalid calculations and keeps recalculation inside the caller transaction", async () => {
    const context = createTenantContext(tenantAId);
    const before = {
      quotes: await prisma.quote.count({ where: { tenantId: tenantAId } }),
      items: await prisma.quoteItem.count({ where: { tenantId: tenantAId } }),
      receipts: await prisma.quoteCommandReceipt.count({ where: { tenantId: tenantAId } }),
      contributors: await prisma.quoteCommercialContributor.count({
        where: { tenantId: tenantAId },
      }),
      audits: await prisma.auditLog.count({ where: { tenantId: tenantAId } }),
      outbox: await prisma.domainEventOutbox.count({ where: { tenantId: tenantAId } }),
    };
    const invalidLines = [
      {
        productId: null,
        description: "Missing tax input",
        unit: "piece",
        quantity: "1",
        unitPrice: "1",
        currency: "USD",
        taxRate: null,
      },
      {
        productId: null,
        description: "Fixed discount currency excess",
        unit: "piece",
        quantity: "1",
        unitPrice: "1",
        currency: "USD",
        taxRate: "0",
        discount: { kind: "fixed", value: "0.001" },
      },
    ] as const;
    for (const [index, line] of invalidLines.entries()) {
      const key = `invalid-calculation-${index}`;
      await expect(
        createQuoteDraft(
          context,
          prisma,
          { ...input(key), lines: [line] } as QuoteDraftInput,
          metadata(actorAId, key),
        ),
      ).rejects.toBeInstanceOf(QuoteValidationError);
      expect(
        await prisma.quoteCommandReceipt.count({
          where: { tenantId: tenantAId, idempotencyKey: key },
        }),
      ).toBe(0);
    }
    expect({
      quotes: await prisma.quote.count({ where: { tenantId: tenantAId } }),
      items: await prisma.quoteItem.count({ where: { tenantId: tenantAId } }),
      receipts: await prisma.quoteCommandReceipt.count({ where: { tenantId: tenantAId } }),
      contributors: await prisma.quoteCommercialContributor.count({
        where: { tenantId: tenantAId },
      }),
      audits: await prisma.auditLog.count({ where: { tenantId: tenantAId } }),
      outbox: await prisma.domainEventOutbox.count({ where: { tenantId: tenantAId } }),
    }).toEqual(before);

    const created = await createQuoteDraft(
      context,
      prisma,
      input("invalid-shipping-source"),
      metadata(actorAId, "invalid-shipping-source"),
    );
    const originalLine = await prisma.quoteItem.findFirstOrThrow({
      where: { tenantId: tenantAId, quoteId: created.current.id },
    });
    const originalAuditCount = await prisma.auditLog.count({
      where: { tenantId: tenantAId, entityId: created.current.id },
    });
    const originalOutboxCount = await prisma.domainEventOutbox.count({
      where: { tenantId: tenantAId, aggregateId: created.current.id },
    });
    await expect(
      updateQuoteDraft(
        context,
        prisma,
        created.current.id,
        1,
        { idempotencyKey: "invalid-shipping-edit", metadata: { shippingTotal: "0.001" } },
        metadata(actorAId, "invalid-shipping-edit"),
      ),
    ).rejects.toBeInstanceOf(QuoteValidationError);
    expect(
      await prisma.quoteCommandReceipt.count({
        where: { tenantId: tenantAId, idempotencyKey: "invalid-shipping-edit" },
      }),
    ).toBe(0);
    const afterRejectedEdit = await getQuoteById(context, prisma, created.current.id);
    expect(afterRejectedEdit).toMatchObject({
      revision: 1,
      calculatedRevision: 1,
      calculationInputHash: created.current.calculationInputHash,
      total: created.current.total,
    });
    expect(afterRejectedEdit.lines[0]?.id).toBe(originalLine.id);
    expect(
      await prisma.auditLog.count({ where: { tenantId: tenantAId, entityId: created.current.id } }),
    ).toBe(originalAuditCount);
    expect(
      await prisma.domainEventOutbox.count({
        where: { tenantId: tenantAId, aggregateId: created.current.id },
      }),
    ).toBe(originalOutboxCount);

    const rollback = new Error("caller rollback sentinel");
    await expect(
      prisma.$transaction(async (transaction) => {
        await recalculateQuoteInTransaction(transaction, tenantAId, created.current.id, 2);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(
      await prisma.quote.findUniqueOrThrow({
        where: { tenantId_id: { tenantId: tenantAId, id: created.current.id } },
      }),
    ).toMatchObject({
      calculatedRevision: 1,
      calculationInputHash: created.current.calculationInputHash,
    });
  });

  it("rejects foreign Contact, Product, OrganizationUnit, and cross-tenant historical reads", async () => {
    const context = createTenantContext(tenantAId);
    const beforeCount = await prisma.quote.count({ where: { tenantId: tenantAId } });
    await expect(
      createQuoteDraft(
        context,
        prisma,
        input("foreign-contact", productAId, contactBId),
        metadata(actorAId, "foreign-contact"),
      ),
    ).rejects.toBeInstanceOf(QuoteValidationError);
    await expect(
      createQuoteDraft(
        context,
        prisma,
        input("foreign-product", productBId),
        metadata(actorAId, "foreign-product"),
      ),
    ).rejects.toBeInstanceOf(QuoteValidationError);
    await expect(
      createQuoteDraft(
        context,
        prisma,
        input("foreign-unit", productAId, contactAId, unitBId),
        metadata(actorAId, "foreign-unit"),
      ),
    ).rejects.toBeInstanceOf(QuoteValidationError);
    expect(await prisma.quote.count({ where: { tenantId: tenantAId } })).toBe(beforeCount);
    const existing = await prisma.quote.findFirstOrThrow({ where: { tenantId: tenantAId } });
    await expect(
      getQuoteById(createTenantContext(tenantBId), prisma, existing.id),
    ).rejects.toBeInstanceOf(QuoteNotFoundError);
  });

  it("rejects unknown authority/product overrides, over-limit line count and oversized normalized input", async () => {
    const context = createTenantContext(tenantAId);
    const beforeCount = await prisma.quote.count({ where: { tenantId: tenantAId } });
    const overridden = {
      ...input("override"),
      lines: [{ productId: productAId, quantity: "1", unitPrice: "0.01" }],
    } as unknown as QuoteDraftInput;
    await expect(
      createQuoteDraft(context, prisma, overridden, metadata(actorAId, "override")),
    ).rejects.toBeInstanceOf(QuoteValidationError);
    const forgedAuthority = {
      ...input("authority"),
      tenantId: tenantBId,
    } as unknown as QuoteDraftInput;
    await expect(
      createQuoteDraft(context, prisma, forgedAuthority, metadata(actorAId, "authority")),
    ).rejects.toBeInstanceOf(QuoteValidationError);
    const tooMany = {
      ...input("too-many"),
      lines: Array.from({ length: 201 }, () => ({ productId: productAId, quantity: "1" })),
    } as QuoteDraftInput;
    await expect(
      createQuoteDraft(context, prisma, tooMany, metadata(actorAId, "too-many")),
    ).rejects.toBeInstanceOf(QuoteValidationError);
    const metadataBlock = "x".repeat(15_000);
    const tooLarge = {
      ...input("too-large"),
      lines: Array.from({ length: 18 }, (_, index) => ({
        productId: null,
        description: "Manual line",
        unit: "piece",
        quantity: "1",
        unitPrice: "1",
        currency: "USD",
        metadata: { block: `${metadataBlock}${index}` },
      })),
    } as QuoteDraftInput;
    await expect(
      createQuoteDraft(context, prisma, tooLarge, metadata(actorAId, "too-large")),
    ).rejects.toBeInstanceOf(QuoteValidationError);
    expect(await prisma.quote.count({ where: { tenantId: tenantAId } })).toBe(beforeCount);
  });

  it("rejects accessors in manual metadata before JSON serialization or writes", async () => {
    let getterCalled = false;
    const metadataValue = Object.defineProperty({}, "unsafe", {
      enumerable: true,
      get: () => {
        getterCalled = true;
        return "value";
      },
    });
    const request = {
      ...input("metadata-accessor"),
      lines: [
        {
          productId: null,
          description: "Manual",
          unit: "piece",
          quantity: "1",
          unitPrice: "1",
          currency: "USD",
          metadata: metadataValue,
        },
      ],
    } as QuoteDraftInput;
    const beforeCount = await prisma.quote.count({ where: { tenantId: tenantAId } });
    await expect(
      createQuoteDraft(
        createTenantContext(tenantAId),
        prisma,
        request,
        metadata(actorAId, "metadata-accessor"),
      ),
    ).rejects.toBeInstanceOf(QuoteValidationError);
    expect(getterCalled).toBe(false);
    expect(await prisma.quote.count({ where: { tenantId: tenantAId } })).toBe(beforeCount);
  });

  it("preserves catalog snapshots on metadata edit and refreshes only on explicit reselect", async () => {
    const context = createTenantContext(tenantAId);
    const created = await createQuoteDraft(
      context,
      prisma,
      input("snapshot-source"),
      metadata(actorAId, "snapshot-source"),
    );
    const originalCalculationHash = created.current.calculationInputHash;
    await prisma.product.update({
      where: { tenantId_id: { tenantId: tenantAId, id: productAId } },
      data: {
        description: "Revised description",
        name: "Revised Part",
        price: new Prisma.Decimal("140.0000"),
      },
    });
    const edited = await updateQuoteDraft(
      context,
      prisma,
      created.current.id,
      1,
      { idempotencyKey: "metadata-edit", metadata: { terms: "Payment due in 30 days" } },
      metadata(actorAId, "metadata-edit"),
    );
    expect(edited.current).toMatchObject({
      revision: 2,
      terms: "Payment due in 30 days",
      salespersonNameSnapshot: "Trusted Salesperson",
      calculatedRevision: 2,
      calculationInputHash: originalCalculationHash,
      subtotal: "313.75",
      discountTotal: "31.38",
      taxTotal: "22.59",
      total: "304.96",
    });
    expect(edited.current.lines[0]).toMatchObject({
      description: "Service Part description",
      unitPrice: "125.5000",
      grossTotal: "313.75",
      lineTotal: "304.96",
    });
    const refreshed = await updateQuoteDraft(
      context,
      prisma,
      created.current.id,
      2,
      {
        idempotencyKey: "explicit-reselect",
        replaceLines: [
          { productId: productAId, quantity: "2.5", discount: { kind: "fixed", value: "1.00" } },
        ],
      },
      metadata(actorAId, "reselect"),
    );
    expect(refreshed.current.lines[0]).toMatchObject({
      description: "Revised description",
      unitPrice: "140.0000",
      discountKind: "fixed",
      discountValue: "1.0000",
    });
  });

  it("makes manual conversion explicit and records the contributor", async () => {
    const context = createTenantContext(tenantAId);
    const created = await createQuoteDraft(
      context,
      prisma,
      input("manual-source"),
      metadata(actorAId, "manual-source"),
    );
    const converted = await updateQuoteDraft(
      context,
      prisma,
      created.current.id,
      1,
      {
        idempotencyKey: "convert-manual",
        convertToManual: [
          {
            position: 0,
            snapshot: {
              sku: "CUSTOM-1",
              description: "Manually reviewed item",
              unit: "piece",
              unitPrice: "90.0000",
              currency: "USD",
              taxRate: "0",
            },
          },
        ],
      },
      metadata(actorA2Id, "convert-manual"),
    );
    expect(converted.current.lines[0]).toMatchObject({
      productId: null,
      source: "manual",
      isExceptional: true,
      description: "Manually reviewed item",
      unitPrice: "90.0000",
    });
    expect(
      await prisma.quoteCommercialContributor.findUnique({
        where: {
          tenantId_quoteId_userId: {
            tenantId: tenantAId,
            quoteId: created.current.id,
            userId: actorA2Id,
          },
        },
      }),
    ).not.toBeNull();
  });

  it("falls back to Product name for a null or empty description", async () => {
    const context = createTenantContext(tenantAId);
    await prisma.product.update({
      where: { tenantId_id: { tenantId: tenantAId, id: productAId } },
      data: { description: "" },
    });
    const empty = await createQuoteDraft(
      context,
      prisma,
      input("empty-description"),
      metadata(actorAId, "empty-description"),
    );
    expect(empty.current.lines[0]?.description).toBe("Service Part");
    await prisma.product.update({
      where: { tenantId_id: { tenantId: tenantAId, id: productAId } },
      data: { description: null },
    });
    const nil = await createQuoteDraft(
      context,
      prisma,
      input("null-description"),
      metadata(actorAId, "null-description"),
    );
    expect(nil.current.lines[0]?.description).toBe("Service Part");
  });

  it("rejects conversion snapshots that try to replace stored quantity or discount", async () => {
    const created = await createQuoteDraft(
      createTenantContext(tenantAId),
      prisma,
      input("convert-spoof-source"),
      metadata(actorAId, "convert-spoof-source"),
    );
    const beforeCount = await prisma.quoteItem.count({
      where: { tenantId: tenantAId, quoteId: created.current.id },
    });
    await expect(
      updateQuoteDraft(
        createTenantContext(tenantAId),
        prisma,
        created.current.id,
        1,
        {
          idempotencyKey: "convert-spoof",
          convertToManual: [
            {
              position: 0,
              snapshot: {
                description: "Manual",
                unit: "piece",
                unitPrice: "1",
                currency: "USD",
                quantity: "999",
                discount: { kind: "fixed", value: "0" },
              } as never,
            },
          ],
        },
        metadata(actorAId, "convert-spoof"),
      ),
    ).rejects.toBeInstanceOf(QuoteValidationError);
    expect(
      (await getQuoteById(createTenantContext(tenantAId), prisma, created.current.id)).revision,
    ).toBe(1);
    expect(
      await prisma.quoteItem.count({ where: { tenantId: tenantAId, quoteId: created.current.id } }),
    ).toBe(beforeCount);
  });

  it("hashes normalized update intent and checks the full merged commercial representation size", async () => {
    const context = createTenantContext(tenantAId);
    const created = await createQuoteDraft(
      context,
      prisma,
      input("normalized-update-source"),
      metadata(actorAId, "normalized-update-source"),
    );
    const first = await updateQuoteDraft(
      context,
      prisma,
      created.current.id,
      1,
      { idempotencyKey: "normalized-update", metadata: { shippingTotal: "0" } },
      metadata(actorAId, "normalized-update"),
    );
    const replay = await updateQuoteDraft(
      context,
      prisma,
      created.current.id,
      1,
      { idempotencyKey: "normalized-update", metadata: { shippingTotal: "0.0000" } },
      metadata(actorAId, "normalized-update-replay"),
    );
    expect(first.current.revision).toBe(1);
    expect(replay.replayed).toBe(true);

    const largeLines = Array.from({ length: 17 }, (_, index) => ({
      productId: null,
      description: `Manual ${index}`,
      unit: "piece",
      quantity: "1",
      unitPrice: "1",
      currency: "USD",
      taxRate: "0",
      metadata: { block: "x".repeat(14_500) },
    }));
    const large = await createQuoteDraft(
      context,
      prisma,
      { ...input("merged-size-source"), lines: largeLines },
      metadata(actorAId, "merged-size-source"),
    );
    await expect(
      updateQuoteDraft(
        context,
        prisma,
        large.current.id,
        1,
        {
          idempotencyKey: "merged-size-reject",
          metadata: {
            terms: "t".repeat(QUOTE_DRAFT_LIMITS.terms),
            notes: "n".repeat(QUOTE_DRAFT_LIMITS.notes),
          },
        },
        metadata(actorAId, "merged-size-reject"),
      ),
    ).rejects.toBeInstanceOf(QuoteValidationError);
    expect((await getQuoteById(context, prisma, large.current.id)).revision).toBe(1);
    expect(
      await prisma.quoteCommandReceipt.count({
        where: { tenantId: tenantAId, idempotencyKey: "merged-size-reject" },
      }),
    ).toBe(0);
  });

  it("writes one transactional Outbox event and rolls back all create state when Outbox fails", async () => {
    const request = input("outbox-create-retry");
    const before = {
      quotes: await prisma.quote.count({ where: { tenantId: tenantAId } }),
      items: await prisma.quoteItem.count({ where: { tenantId: tenantAId } }),
      receipts: await prisma.quoteCommandReceipt.count({ where: { tenantId: tenantAId } }),
      audit: await prisma.auditLog.count({ where: { tenantId: tenantAId } }),
      outbox: await prisma.domainEventOutbox.count({ where: { tenantId: tenantAId } }),
      contributors: await prisma.quoteCommercialContributor.count({
        where: { tenantId: tenantAId },
      }),
    };
    await expect(
      createQuoteDraft(
        createTenantContext(tenantAId),
        failNextOutboxWriteDatabase() as never,
        request,
        metadata(actorAId, "outbox-fail"),
      ),
    ).rejects.toThrow("injected Outbox failure");
    expect(await prisma.quote.count({ where: { tenantId: tenantAId } })).toBe(before.quotes);
    expect(await prisma.quoteItem.count({ where: { tenantId: tenantAId } })).toBe(before.items);
    expect(await prisma.quoteCommandReceipt.count({ where: { tenantId: tenantAId } })).toBe(
      before.receipts,
    );
    expect(await prisma.auditLog.count({ where: { tenantId: tenantAId } })).toBe(before.audit);
    expect(await prisma.domainEventOutbox.count({ where: { tenantId: tenantAId } })).toBe(
      before.outbox,
    );
    expect(await prisma.quoteCommercialContributor.count({ where: { tenantId: tenantAId } })).toBe(
      before.contributors,
    );
    const retry = await createQuoteDraft(
      createTenantContext(tenantAId),
      prisma,
      request,
      metadata(actorAId, "outbox-retry"),
    );
    expect(retry.replayed).toBe(false);
    expect(
      await prisma.quoteCommandReceipt.count({
        where: { tenantId: tenantAId, idempotencyKey: request.idempotencyKey },
      }),
    ).toBe(1);
    expect(
      await prisma.domainEventOutbox.count({
        where: {
          tenantId: tenantAId,
          aggregateId: retry.current.id,
          eventType: "quote.draft_created",
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { tenantId: tenantAId, entityId: retry.current.id } }),
    ).toBe(1);
    const patch = {
      idempotencyKey: "outbox-update-retry",
      metadata: { notes: "Update with Outbox" },
    };
    await expect(
      updateQuoteDraft(
        createTenantContext(tenantAId),
        failNextOutboxWriteDatabase() as never,
        retry.current.id,
        1,
        patch,
        metadata(actorAId, "outbox-update-fail"),
      ),
    ).rejects.toThrow("injected Outbox failure");
    expect(
      (await getQuoteById(createTenantContext(tenantAId), prisma, retry.current.id)).revision,
    ).toBe(1);
    expect(
      await prisma.quoteCommandReceipt.count({
        where: { tenantId: tenantAId, idempotencyKey: patch.idempotencyKey },
      }),
    ).toBe(0);
    expect(
      await prisma.domainEventOutbox.count({
        where: {
          tenantId: tenantAId,
          aggregateId: retry.current.id,
          eventType: "quote.draft_updated",
        },
      }),
    ).toBe(0);
    const updateRetry = await updateQuoteDraft(
      createTenantContext(tenantAId),
      prisma,
      retry.current.id,
      1,
      patch,
      metadata(actorAId, "outbox-update-retry"),
    );
    expect(updateRetry.current).toMatchObject({ revision: 2, notes: "Update with Outbox" });
    expect(
      await prisma.quoteCommandReceipt.count({
        where: { tenantId: tenantAId, idempotencyKey: patch.idempotencyKey },
      }),
    ).toBe(1);
    expect(
      await prisma.domainEventOutbox.count({
        where: {
          tenantId: tenantAId,
          aggregateId: retry.current.id,
          eventType: "quote.draft_updated",
        },
      }),
    ).toBe(1);
  });

  it("serializes concurrent same-key commands and distinct tenant number allocations", async () => {
    const context = createTenantContext(tenantAId);
    const [sameOne, sameTwo] = await Promise.all([
      createQuoteDraft(
        context,
        prisma,
        input("concurrent-same-key"),
        metadata(actorAId, "concurrent-same-a"),
      ),
      createQuoteDraft(
        context,
        prisma,
        input("concurrent-same-key"),
        metadata(actorAId, "concurrent-same-b"),
      ),
    ]);
    expect(sameOne.current.id).toBe(sameTwo.current.id);
    expect([sameOne.replayed, sameTwo.replayed].sort()).toEqual([false, true]);
    const [left, right] = await Promise.all([
      createQuoteDraft(
        context,
        prisma,
        input("concurrent-number-left"),
        metadata(actorAId, "concurrent-number-left"),
      ),
      createQuoteDraft(
        context,
        prisma,
        input("concurrent-number-right"),
        metadata(actorAId, "concurrent-number-right"),
      ),
    ]);
    expect(left.current.number).not.toBe(right.current.number);
    expect(new Set([sameOne.current.number, left.current.number, right.current.number]).size).toBe(
      3,
    );
  });

  it("revalidates current permission after a PostgreSQL advisory lock wait for mutation and replay", async () => {
    const context = createTenantContext(tenantAId);
    const startBlocker = async () => {
      let release!: () => void;
      let signal!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const locked = new Promise<void>((resolve) => {
        signal = resolve;
      });
      const holder = prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`quotes:tenant-policy:${tenantAId}`}, 0))`;
        signal();
        await released;
      });
      await locked;
      return { holder, release };
    };
    const runBlockedAndRevoke = async (key: string, replay: boolean) => {
      const request = input(key);
      if (replay)
        await createQuoteDraft(context, prisma, request, metadata(actorAId, `${key}-seed`));
      const blocker = await startBlocker();
      const pending = createQuoteDraft(
        context,
        prisma,
        request,
        metadata(actorAId, `${key}-blocked`),
      );
      await waitForAdvisoryLockWait();
      const access = createTenantDataAccess(context, prisma);
      await access.rolePermissions.revoke(quoteRoleAId, "quotes.create");
      blocker.release();
      await blocker.holder;
      await expect(pending).rejects.toThrow("quotes.create");
      await access.rolePermissions.grant(quoteRoleAId, "quotes.create");
    };
    await runBlockedAndRevoke("permission-wait-mutation", false);
    await runBlockedAndRevoke("permission-wait-replay", true);
  });

  it("revalidates module entitlement, tenant status, and target OU after a PostgreSQL lock wait", async () => {
    const context = createTenantContext(tenantAId);
    const startBlocker = async () => {
      let release!: () => void;
      let signal!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const locked = new Promise<void>((resolve) => {
        signal = resolve;
      });
      const holder = prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`quotes:tenant-policy:${tenantAId}`}, 0))`;
        signal();
        await released;
      });
      await locked;
      return { holder, release };
    };
    const run = async (
      key: string,
      replay: boolean,
      revoke: () => Promise<void>,
      restore: () => Promise<void>,
      message: string,
    ) => {
      const request = input(key);
      if (replay)
        await createQuoteDraft(context, prisma, request, metadata(actorAId, `${key}-seed`));
      const blocker = await startBlocker();
      const pending = createQuoteDraft(
        context,
        prisma,
        request,
        metadata(actorAId, `${key}-blocked`),
      );
      await waitForAdvisoryLockWait();
      await revoke();
      blocker.release();
      await blocker.holder;
      try {
        await expect(pending).rejects.toThrow(message);
      } finally {
        await restore();
      }
    };
    await run(
      "entitlement-wait-replay",
      true,
      async () => {
        await prisma.tenantEntitlement.update({
          where: {
            tenantId_entitlementKey: { tenantId: tenantAId, entitlementKey: "module.quotes" },
          },
          data: { enabled: false },
        });
      },
      async () => {
        await prisma.tenantEntitlement.update({
          where: {
            tenantId_entitlementKey: { tenantId: tenantAId, entitlementKey: "module.quotes" },
          },
          data: { enabled: true },
        });
      },
      "module.quotes",
    );
    await run(
      "tenant-status-wait",
      false,
      async () => {
        await prisma.tenant.update({ where: { id: tenantAId }, data: { status: "suspended" } });
      },
      async () => {
        await prisma.tenant.update({ where: { id: tenantAId }, data: { status: "active" } });
      },
      "Tenant is not operational",
    );
    await run(
      "resource-wait",
      false,
      async () => {
        await prisma.organizationUnit.update({
          where: { tenantId_id: { tenantId: tenantAId, id: unitAId } },
          data: { active: false },
        });
      },
      async () => {
        await prisma.organizationUnit.update({
          where: { tenantId_id: { tenantId: tenantAId, id: unitAId } },
          data: { active: true },
        });
      },
      "Organization unit must be active",
    );
    await run(
      "actor-status-wait",
      false,
      async () => {
        await prisma.user.update({
          where: { tenantId_id: { tenantId: tenantAId, id: actorAId } },
          data: { status: "disabled" },
        });
      },
      async () => {
        await prisma.user.update({
          where: { tenantId_id: { tenantId: tenantAId, id: actorAId } },
          data: { status: "active" },
        });
      },
      "Authenticated actor is not active",
    );
  });

  it("replays the original receipt after Product changes while exposing current quote state separately", async () => {
    const context = createTenantContext(tenantAId);
    const requested = input("replay-create");
    const first = await createQuoteDraft(
      context,
      prisma,
      requested,
      metadata(actorAId, "replay-create"),
    );
    const later = await updateQuoteDraft(
      context,
      prisma,
      first.current.id,
      1,
      { idempotencyKey: "replay-edit", metadata: { notes: "Later state" } },
      metadata(actorAId, "replay-edit"),
    );
    await prisma.product.update({
      where: { tenantId_id: { tenantId: tenantAId, id: productAId } },
      data: { price: new Prisma.Decimal("200.0000") },
    });
    const replay = await createQuoteDraft(
      context,
      prisma,
      requested,
      metadata(actorAId, "replay-create-again"),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.recordedOutcome).toEqual({
      quoteId: first.current.id,
      number: first.current.number,
      status: "draft",
      revision: 1,
    });
    expect(replay.current).toMatchObject({
      revision: later.current.revision,
      notes: "Later state",
    });
    expect(replay.current.lines[0]?.unitPrice).toBe("125.5000");
  });

  it("requires CRM only for contact selection, not metadata edits over owned snapshots", async () => {
    const context = createTenantContext(tenantAId);
    const crmUpdateQuote = await createQuoteDraft(
      context,
      prisma,
      input("crm-contact-edit-source"),
      metadata(actorAId, "crm-contact-edit-source"),
    );
    const contactSelection = await updateQuoteDraft(
      context,
      prisma,
      crmUpdateQuote.current.id,
      1,
      {
        idempotencyKey: "crm-contact-selection",
        metadata: { contactId: contactAId, terms: "Contact explicitly reselected" },
      },
      metadata(actorAId, "crm-contact-selection"),
    );
    expect(contactSelection.current).toMatchObject({
      revision: 2,
      terms: "Contact explicitly reselected",
    });

    const createReplaySource = await createQuoteDraft(
      context,
      prisma,
      input("crm-create-replay-source"),
      metadata(actorAId, "crm-create-replay-source"),
    );
    const snapshotQuote = await createQuoteDraft(
      context,
      prisma,
      input("crm-snapshot-source"),
      metadata(actorAId, "crm-snapshot-source"),
    );
    const previousEntitlement = await prisma.tenantEntitlement.findUniqueOrThrow({
      where: {
        tenantId_entitlementKey: { tenantId: tenantAId, entitlementKey: "module.crm_lite" },
      },
    });
    await prisma.tenantEntitlement.update({
      where: {
        tenantId_entitlementKey: { tenantId: tenantAId, entitlementKey: "module.crm_lite" },
      },
      data: { enabled: false },
    });
    try {
      const metadataEdit = await updateQuoteDraft(
        context,
        prisma,
        snapshotQuote.current.id,
        1,
        {
          idempotencyKey: "crm-snapshot-metadata-edit",
          metadata: { notes: "Owned snapshot remains editable" },
        },
        metadata(actorAId, "crm-snapshot-metadata-edit"),
      );
      expect(metadataEdit.current).toMatchObject({
        revision: 2,
        notes: "Owned snapshot remains editable",
      });
      const metadataReplay = await updateQuoteDraft(
        context,
        prisma,
        snapshotQuote.current.id,
        1,
        {
          idempotencyKey: "crm-snapshot-metadata-edit",
          metadata: { notes: "Owned snapshot remains editable" },
        },
        metadata(actorAId, "crm-snapshot-metadata-replay"),
      );
      expect(metadataReplay.replayed).toBe(true);
      expect(metadataReplay.current.revision).toBe(2);

      await expect(
        createQuoteDraft(
          context,
          prisma,
          input("crm-create-disabled"),
          metadata(actorAId, "crm-create-disabled"),
        ),
      ).rejects.toBeInstanceOf(TenantModuleEntitlementRequiredError);
      await expect(
        createQuoteDraft(
          context,
          prisma,
          input("crm-create-replay-source"),
          metadata(actorAId, "crm-create-replay-disabled"),
        ),
      ).rejects.toBeInstanceOf(TenantModuleEntitlementRequiredError);
      await expect(
        updateQuoteDraft(
          context,
          prisma,
          crmUpdateQuote.current.id,
          2,
          {
            idempotencyKey: "crm-contact-selection-new",
            metadata: { contactId: contactAId, notes: "Cannot reselect without CRM" },
          },
          metadata(actorAId, "crm-contact-selection-new"),
        ),
      ).rejects.toBeInstanceOf(TenantModuleEntitlementRequiredError);
      await expect(
        updateQuoteDraft(
          context,
          prisma,
          crmUpdateQuote.current.id,
          1,
          {
            idempotencyKey: "crm-contact-selection",
            metadata: { contactId: contactAId, terms: "Contact explicitly reselected" },
          },
          metadata(actorAId, "crm-contact-selection-replay-disabled"),
        ),
      ).rejects.toBeInstanceOf(TenantModuleEntitlementRequiredError);
    } finally {
      await prisma.tenantEntitlement.update({
        where: {
          tenantId_entitlementKey: { tenantId: tenantAId, entitlementKey: "module.crm_lite" },
        },
        data: { enabled: previousEntitlement.enabled },
      });
    }
    expect(await getQuoteById(context, prisma, createReplaySource.current.id)).toMatchObject({
      revision: 1,
    });
  });

  it("preserves stored currency precision unless the currency code changes", async () => {
    const context = createTenantContext(tenantAId);
    const created = await createQuoteDraft(
      context,
      prisma,
      input("precision-stored-source"),
      metadata(actorAId, "precision-stored-source"),
    );
    await prisma.quote.update({
      where: { tenantId_id: { tenantId: tenantAId, id: created.current.id } },
      data: { currencyPrecision: 0 },
    });
    const edited = await updateQuoteDraft(
      context,
      prisma,
      created.current.id,
      1,
      {
        idempotencyKey: "precision-no-code-change",
        metadata: { currency: "USD", terms: "Keep persisted precision" },
      },
      metadata(actorAId, "precision-no-code-change"),
    );
    expect(edited.current).toMatchObject({
      currency: "USD",
      currencyPrecision: 0,
      terms: "Keep persisted precision",
    });
    const changed = await updateQuoteDraft(
      context,
      prisma,
      created.current.id,
      2,
      {
        idempotencyKey: "precision-real-code-change",
        metadata: { currency: "GBP" },
        replaceLines: [
          {
            productId: null,
            description: "Manual GBP line",
            unit: "piece",
            quantity: "1",
            unitPrice: "1",
            currency: "GBP",
            taxRate: "0",
          },
        ],
      },
      metadata(actorAId, "precision-real-code-change"),
    );
    expect(changed.current).toMatchObject({ currency: "GBP", currencyPrecision: 2 });
  });

  it("records semantic no-ops without revision, contributor, audit, Outbox, or line rewrite", async () => {
    const context = createTenantContext(tenantAId);
    const created = await createQuoteDraft(
      context,
      prisma,
      input("noop-source"),
      metadata(actorAId, "noop-source"),
    );
    const lineId = created.current.lines[0]?.id;
    const auditCount = await prisma.auditLog.count({
      where: { tenantId: tenantAId, entityId: created.current.id },
    });
    const outboxCount = await prisma.domainEventOutbox.count({
      where: { tenantId: tenantAId, aggregateId: created.current.id },
    });
    const noOp = await updateQuoteDraft(
      context,
      prisma,
      created.current.id,
      1,
      {
        idempotencyKey: "noop-same-input",
        metadata: { terms: null, notes: null, shippingTotal: "0.0000" },
      },
      metadata(actorA2Id, "noop-same-input"),
    );
    expect(noOp).toMatchObject({
      replayed: false,
      recordedOutcome: { revision: 1 },
      current: { revision: 1 },
    });
    expect(noOp.current.lines[0]?.id).toBe(lineId);
    expect(
      await prisma.quoteCommercialContributor.findUnique({
        where: {
          tenantId_quoteId_userId: {
            tenantId: tenantAId,
            quoteId: created.current.id,
            userId: actorA2Id,
          },
        },
      }),
    ).toBeNull();
    expect(
      await prisma.auditLog.count({ where: { tenantId: tenantAId, entityId: created.current.id } }),
    ).toBe(auditCount);
    expect(
      await prisma.domainEventOutbox.count({
        where: { tenantId: tenantAId, aggregateId: created.current.id },
      }),
    ).toBe(outboxCount);

    const actualEdit = await updateQuoteDraft(
      context,
      prisma,
      created.current.id,
      1,
      {
        idempotencyKey: "noop-later-real-edit",
        metadata: { notes: "Later real edit" },
      },
      metadata(actorAId, "noop-later-real-edit"),
    );
    expect(actualEdit.current.revision).toBe(2);
    const receiptReplay = await updateQuoteDraft(
      context,
      prisma,
      created.current.id,
      1,
      {
        idempotencyKey: "noop-same-input",
        metadata: { terms: null, notes: null, shippingTotal: "0" },
      },
      metadata(actorA2Id, "noop-replay-after-edit"),
    );
    expect(receiptReplay).toMatchObject({
      replayed: true,
      recordedOutcome: { revision: 1 },
      current: { revision: 2, notes: "Later real edit" },
    });
    await expect(
      updateQuoteDraft(
        context,
        prisma,
        created.current.id,
        1,
        {
          idempotencyKey: "noop-stale-new-key",
          metadata: { shippingTotal: "0.0000" },
        },
        metadata(actorA2Id, "noop-stale-new-key"),
      ),
    ).rejects.toBeInstanceOf(QuoteRevisionConflictError);
  });

  it("rejects operation-less updates without consuming their idempotency key", async () => {
    const context = createTenantContext(tenantAId);
    const created = await createQuoteDraft(
      context,
      prisma,
      input("operation-shape-source"),
      metadata(actorAId, "operation-shape-source"),
    );
    const key = "operation-shape-reusable";
    const auditCount = await prisma.auditLog.count({
      where: { tenantId: tenantAId, entityId: created.current.id },
    });
    const outboxCount = await prisma.domainEventOutbox.count({
      where: { tenantId: tenantAId, aggregateId: created.current.id },
    });

    await expect(
      updateQuoteDraft(
        context,
        prisma,
        created.current.id,
        1,
        { idempotencyKey: key },
        metadata(actorA2Id, key),
      ),
    ).rejects.toBeInstanceOf(QuoteValidationError);
    await expect(
      updateQuoteDraft(
        context,
        prisma,
        created.current.id,
        1,
        { idempotencyKey: key, metadata: {} },
        metadata(actorA2Id, key),
      ),
    ).rejects.toBeInstanceOf(QuoteValidationError);

    expect((await getQuoteById(context, prisma, created.current.id)).revision).toBe(1);
    expect(
      await prisma.quoteCommandReceipt.count({
        where: { tenantId: tenantAId, idempotencyKey: key },
      }),
    ).toBe(0);
    expect(
      await prisma.quoteCommercialContributor.findUnique({
        where: {
          tenantId_quoteId_userId: {
            tenantId: tenantAId,
            quoteId: created.current.id,
            userId: actorA2Id,
          },
        },
      }),
    ).toBeNull();
    expect(
      await prisma.auditLog.count({ where: { tenantId: tenantAId, entityId: created.current.id } }),
    ).toBe(auditCount);
    expect(
      await prisma.domainEventOutbox.count({
        where: { tenantId: tenantAId, aggregateId: created.current.id },
      }),
    ).toBe(outboxCount);

    const valid = await updateQuoteDraft(
      context,
      prisma,
      created.current.id,
      1,
      { idempotencyKey: key, metadata: { notes: "Valid operation after rejection" } },
      metadata(actorA2Id, key),
    );
    expect(valid.current).toMatchObject({ revision: 2, notes: "Valid operation after rejection" });
    expect(
      await prisma.quoteCommandReceipt.count({
        where: { tenantId: tenantAId, idempotencyKey: key },
      }),
    ).toBe(1);
  });

  it("conflicts on changed request or actor and checks optimistic revision", async () => {
    const context = createTenantContext(tenantAId);
    const requested = input("conflict-key");
    const first = await createQuoteDraft(
      context,
      prisma,
      requested,
      metadata(actorAId, "conflict-key"),
    );
    await expect(
      createQuoteDraft(
        context,
        prisma,
        { ...requested, notes: "changed request" },
        metadata(actorAId, "conflict-request"),
      ),
    ).rejects.toBeInstanceOf(QuoteCommandConflictError);
    await expect(
      createQuoteDraft(context, prisma, requested, metadata(actorA2Id, "conflict-actor")),
    ).rejects.toBeInstanceOf(QuoteCommandConflictError);
    await expect(
      updateQuoteDraft(
        context,
        prisma,
        first.current.id,
        99,
        { idempotencyKey: "stale-revision", metadata: { notes: "stale" } },
        metadata(actorAId, "stale"),
      ),
    ).rejects.toBeInstanceOf(QuoteRevisionConflictError);
  });

  it("allocates Q-1000000 across the six-digit boundary and rejects the next allocation after the maximum", async () => {
    const context = createTenantContext(tenantBId);
    const maxQuote = await createQuoteDraft(
      context,
      prisma,
      input("number-max", productBId, contactBId, unitBId),
      metadata(actorBId, "number-max"),
    );
    await prisma.quote.update({
      where: { tenantId_id: { tenantId: tenantBId, id: maxQuote.current.id } },
      data: { numberSequence: 999999n, number: "Q-999999" },
    });
    const crossed = await createQuoteDraft(
      context,
      prisma,
      input("number-crossed", productBId, contactBId, unitBId),
      metadata(actorBId, "number-crossed"),
    );
    expect(crossed.current.number).toBe("Q-1000000");
    await prisma.quote.update({
      where: { tenantId_id: { tenantId: tenantBId, id: crossed.current.id } },
      data: { numberSequence: 9999999999n, number: "Q-9999999999" },
    });
    const count = await prisma.quote.count({ where: { tenantId: tenantBId } });
    await expect(
      createQuoteDraft(
        context,
        prisma,
        input("number-overflow", productBId, contactBId, unitBId),
        metadata(actorBId, "number-overflow"),
      ),
    ).rejects.toBeInstanceOf(QuoteValidationError);
    expect(await prisma.quote.count({ where: { tenantId: tenantBId } })).toBe(count);
    expect(
      await prisma.quoteCommandReceipt.count({
        where: { tenantId: tenantBId, idempotencyKey: "number-overflow" },
      }),
    ).toBe(0);
  });
});
