import { generateOpaqueToken, hashOpaqueToken } from "@whatsapp-platform/auth";
import { loadDatabaseConfig, loadNonSecretConfig } from "@whatsapp-platform/config";
import {
  createPlatformDatabaseClient,
  type PrismaClient,
  syncPermissionCatalog,
} from "@whatsapp-platform/database/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "./app";

const prefix = "e15-s02-quotes-api";
const binary = (value: Buffer) => new Uint8Array(value);

describe("E15-S02 quote drafts API", () => {
  let app: Awaited<ReturnType<typeof createApiApplication>>;
  let prisma: PrismaClient;
  let baseUrl = "";
  let tenantAId = "";
  let tenantBId = "";
  let unitAId = "";
  let contactAId = "";
  let readCookie = "";
  let createCookie = "";
  let noPermissionCookie = "";
  let foreignCookie = "";

  async function createActor(
    tenantId: string,
    marker: string,
    permissionKeys: readonly string[],
  ): Promise<Readonly<{ userId: string; cookie: string }>> {
    const user = await prisma.user.create({
      data: {
        tenantId,
        displayName: `Quote ${marker}`,
        email: `${prefix}-${marker}@example.invalid`,
        passwordHash: "integration-only-not-a-real-password-hash",
        locale: "es-MX",
        timezone: "UTC",
      },
    });
    const role = await prisma.role.create({
      data: { key: `${prefix}-${marker}`, name: `Quote ${marker}`, tenantId },
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
        tenantId,
        userId: user.id,
        tokenHash: binary(hashOpaqueToken(token)),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    return { userId: user.id, cookie: `tenant_session=${token}` };
  }

  async function cleanup(): Promise<void> {
    const tenants = await prisma.tenant.findMany({
      select: { id: true },
      where: { slug: { startsWith: prefix } },
    });
    const ids = tenants.map(({ id }) => id);
    await prisma.quoteCommercialContributor.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.quoteCommandReceipt.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.quoteItem.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.quote.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.userSession.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.userRole.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: ids } } } });
    await prisma.role.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.contact.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await syncPermissionCatalog(prisma);
    await cleanup();
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
      throw new Error("Quote API tenant fixtures failed");
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    const [unitA, contactA] = await Promise.all([
      prisma.organizationUnit.create({
        data: { tenantId: tenantAId, name: "Sales Unit", type: "branch" },
      }),
      prisma.contact.create({
        data: { tenantId: tenantAId, name: "API Customer", phoneNumber: "+15550000111" },
      }),
    ]);
    unitAId = unitA.id;
    contactAId = contactA.id;
    await Promise.all(
      ["module.quotes", "module.crm_lite", "module.catalog"].map((entitlementKey) =>
        prisma.tenantEntitlement.create({
          data: { tenantId: tenantAId, entitlementKey, enabled: true, source: "contract" },
        }),
      ),
    );
    const read = await createActor(tenantAId, "read", ["quotes.read"]);
    const create = await createActor(tenantAId, "create", ["quotes.read", "quotes.create"]);
    const none = await createActor(tenantAId, "none", []);
    const foreign = await createActor(tenantBId, "foreign", ["quotes.read"]);
    readCookie = read.cookie;
    createCookie = create.cookie;
    noPermissionCookie = none.cookie;
    foreignCookie = foreign.cookie;
    app = await createApiApplication(loadNonSecretConfig());
    await app.listen(0);
    const address = app.getHttpServer().address();
    if (address === null || typeof address === "string")
      throw new Error("API did not bind a TCP port");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("guards route, tenant, module and permission, then creates and reads an uncalculated snapshot", async () => {
    const url = `${baseUrl}/api/v1/quotes`;
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: { cookie: noPermissionCookie } })).status).toBe(403);
    expect((await fetch(url, { headers: { cookie: foreignCookie } })).status).toBe(403);
    const body = {
      idempotencyKey: "api-create-draft",
      organizationUnitId: unitAId,
      contactId: contactAId,
      currency: "USD",
      lines: [
        {
          productId: null,
          description: "Custom item",
          unit: "piece",
          quantity: "2.5",
          unitPrice: "10.0000",
          currency: "USD",
          discount: { kind: "fixed", value: "0" },
        },
      ],
    };
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: { cookie: createCookie, "content-type": "application/json" },
          body: JSON.stringify({ ...body, tenantId: tenantBId }),
        })
      ).status,
    ).toBe(400);
    await prisma.tenantEntitlement.update({
      where: {
        tenantId_entitlementKey: { tenantId: tenantAId, entitlementKey: "module.crm_lite" },
      },
      data: { enabled: false },
    });
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: { cookie: createCookie, "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(403);
    await prisma.tenantEntitlement.update({
      where: {
        tenantId_entitlementKey: { tenantId: tenantAId, entitlementKey: "module.crm_lite" },
      },
      data: { enabled: true },
    });
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: { cookie: createCookie, "content-type": "application/json" },
          body: JSON.stringify({ ...body, unknown: true }),
        })
      ).status,
    ).toBe(400);
    const product = await prisma.product.create({
      data: {
        tenantId: tenantAId,
        organizationUnitId: unitAId,
        sku: "API-SKU",
        normalizedSku: "API-SKU",
        name: "API Product",
        description: "API Product description",
        unit: "piece",
        price: "25.0000",
        currency: "USD",
        taxRate: "0",
      },
    });
    const catalogBody = {
      ...body,
      idempotencyKey: "api-catalog-draft",
      lines: [{ productId: product.id, quantity: "1" }],
    };
    await prisma.tenantEntitlement.update({
      where: { tenantId_entitlementKey: { tenantId: tenantAId, entitlementKey: "module.catalog" } },
      data: { enabled: false },
    });
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: { cookie: createCookie, "content-type": "application/json" },
          body: JSON.stringify(catalogBody),
        })
      ).status,
    ).toBe(403);
    await prisma.tenantEntitlement.update({
      where: { tenantId_entitlementKey: { tenantId: tenantAId, entitlementKey: "module.catalog" } },
      data: { enabled: true },
    });
    const catalogCreated = await fetch(url, {
      method: "POST",
      headers: { cookie: createCookie, "content-type": "application/json" },
      body: JSON.stringify(catalogBody),
    });
    expect(catalogCreated.status).toBe(201);
    const catalogResult = (await catalogCreated.json()) as {
      data: { current: { lines: Array<{ source: string; unitPrice: string }> } };
    };
    expect(catalogResult.data.current.lines[0]).toMatchObject({
      source: "catalog",
      unitPrice: "25.0000",
    });
    const created = await fetch(url, {
      method: "POST",
      headers: { cookie: createCookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(created.status).toBe(201);
    const result = (await created.json()) as {
      success: boolean;
      data: {
        replayed: boolean;
        recordedOutcome: { revision: number };
        current: {
          id: string;
          number: string;
          revision: number;
          subtotal: string | null;
          lines: Array<{ source: string; isExceptional: boolean }>;
        };
      };
    };
    expect(result).toMatchObject({
      success: true,
      data: {
        replayed: false,
        recordedOutcome: { revision: 1 },
        current: {
          number: "Q-000002",
          revision: 1,
          subtotal: null,
          lines: [{ source: "manual", isExceptional: true }],
        },
      },
    });
    const patchBody = {
      expectedRevision: 1,
      idempotencyKey: "api-update-draft",
      metadata: { terms: "Payment in 30 days" },
    };
    const updated = await fetch(`${url}/${result.data.current.id}`, {
      method: "PATCH",
      headers: { cookie: createCookie, "content-type": "application/json" },
      body: JSON.stringify(patchBody),
    });
    expect(updated.status).toBe(200);
    const updatedBody = (await updated.json()) as {
      data: {
        replayed: boolean;
        recordedOutcome: { revision: number };
        current: { revision: number; terms: string | null };
      };
    };
    expect(updatedBody).toMatchObject({
      data: {
        replayed: false,
        recordedOutcome: { revision: 2 },
        current: { revision: 2, terms: "Payment in 30 days" },
      },
    });
    const replay = await fetch(`${url}/${result.data.current.id}`, {
      method: "PATCH",
      headers: { cookie: createCookie, "content-type": "application/json" },
      body: JSON.stringify(patchBody),
    });
    expect(replay.status).toBe(200);
    expect(
      ((await replay.json()) as { data: { replayed: boolean; current: { revision: number } } })
        .data,
    ).toMatchObject({ replayed: true, current: { revision: 2 } });
    expect(
      (
        await fetch(`${url}/${result.data.current.id}`, {
          method: "PATCH",
          headers: { cookie: createCookie, "content-type": "application/json" },
          body: JSON.stringify({ ...patchBody, idempotencyKey: "api-stale-update" }),
        })
      ).status,
    ).toBe(409);
    expect(
      (await fetch(`${url}/${result.data.current.id}`, { headers: { cookie: readCookie } })).status,
    ).toBe(200);
    expect(
      (await fetch(`${url}/${result.data.current.id}`, { headers: { cookie: noPermissionCookie } }))
        .status,
    ).toBe(403);
    await prisma.tenantEntitlement.update({
      where: { tenantId_entitlementKey: { tenantId: tenantAId, entitlementKey: "module.quotes" } },
      data: { enabled: false },
    });
    expect((await fetch(url, { headers: { cookie: readCookie } })).status).toBe(403);
    await prisma.tenantEntitlement.update({
      where: { tenantId_entitlementKey: { tenantId: tenantAId, entitlementKey: "module.quotes" } },
      data: { enabled: true },
    });
  });
});
