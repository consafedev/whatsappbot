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
  let policyWriteCookie = "";
  let policyOnePermissionCookie = "";

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
    await prisma.quote.updateMany({
      where: { tenantId: { in: ids } },
      data: { currentApprovalId: null },
    });
    await prisma.quoteApproval.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.quoteCommercialContributor.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.quoteCommandReceipt.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.quotePolicy.deleteMany({ where: { tenantId: { in: ids } } });
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
    const policyWrite = await createActor(tenantAId, "policy-write", [
      "tenant.settings.manage",
      "quotes.approve",
    ]);
    const policyOnePermission = await createActor(tenantAId, "policy-one", ["quotes.approve"]);
    readCookie = read.cookie;
    createCookie = create.cookie;
    noPermissionCookie = none.cookie;
    foreignCookie = foreign.cookie;
    policyWriteCookie = policyWrite.cookie;
    policyOnePermissionCookie = policyOnePermission.cookie;
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

  it("guards route, tenant, module and permission, and calculates a quote from configured inputs", async () => {
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
    const beforeMissingTax = {
      quotes: await prisma.quote.count({ where: { tenantId: tenantAId } }),
      items: await prisma.quoteItem.count({ where: { tenantId: tenantAId } }),
      receipts: await prisma.quoteCommandReceipt.count({ where: { tenantId: tenantAId } }),
      contributors: await prisma.quoteCommercialContributor.count({
        where: { tenantId: tenantAId },
      }),
      audits: await prisma.auditLog.count({ where: { tenantId: tenantAId } }),
      outbox: await prisma.domainEventOutbox.count({ where: { tenantId: tenantAId } }),
    };
    const missingTax = await fetch(url, {
      method: "POST",
      headers: { cookie: createCookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(missingTax.status).toBe(400);
    expect({
      quotes: await prisma.quote.count({ where: { tenantId: tenantAId } }),
      items: await prisma.quoteItem.count({ where: { tenantId: tenantAId } }),
      receipts: await prisma.quoteCommandReceipt.count({ where: { tenantId: tenantAId } }),
      contributors: await prisma.quoteCommercialContributor.count({
        where: { tenantId: tenantAId },
      }),
      audits: await prisma.auditLog.count({ where: { tenantId: tenantAId } }),
      outbox: await prisma.domainEventOutbox.count({ where: { tenantId: tenantAId } }),
    }).toEqual(beforeMissingTax);
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
    const validBody = {
      ...body,
      lines: body.lines.map((line) => ({ ...line, taxRate: "0" })),
    };
    const created = await fetch(url, {
      method: "POST",
      headers: { cookie: createCookie, "content-type": "application/json" },
      body: JSON.stringify(validBody),
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
          subtotal: string;
          discountTotal: string;
          taxTotal: string;
          total: string;
          calculatedRevision: number;
          lines: Array<{
            source: string;
            isExceptional: boolean;
            grossTotal: string | null;
            discountTotal: string | null;
            netTotal: string | null;
            taxTotal: string | null;
            lineTotal: string | null;
          }>;
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
          subtotal: "25.00",
          discountTotal: "0.00",
          taxTotal: "0.00",
          total: "25.00",
          calculatedRevision: 1,
          lines: [
            {
              source: "manual",
              isExceptional: true,
              grossTotal: "25.00",
              discountTotal: "0.00",
              netTotal: "25.00",
              taxTotal: "0.00",
              lineTotal: "25.00",
            },
          ],
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

    const missingPermission = await fetch(`${url}/${result.data.current.id}/approval-request`, {
      method: "POST",
      headers: { cookie: policyOnePermissionCookie, "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "api-approval-no-create", expectedRevision: 2 }),
    });
    expect(missingPermission.status).toBe(403);
    const approvalRequest = await fetch(`${url}/${result.data.current.id}/approval-request`, {
      method: "POST",
      headers: { cookie: createCookie, "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "api-approval-request", expectedRevision: 2 }),
    });
    expect(approvalRequest.status).toBe(201);
    const requestBody = (await approvalRequest.json()) as {
      data: { current: { revision: number; quoteStatus: string; id: string } };
    };
    expect(requestBody.data.current).toMatchObject({
      revision: 3,
      quoteStatus: "pending_approval",
    });
    const approvalPermissionDenied = await fetch(`${url}/${result.data.current.id}/approve`, {
      method: "POST",
      headers: { cookie: createCookie, "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "api-approve-no-permission",
        expectedRevision: 3,
        reasonCode: "reviewed",
      }),
    });
    expect(approvalPermissionDenied.status).toBe(403);
    await prisma.tenantEntitlement.update({
      where: {
        tenantId_entitlementKey: { tenantId: tenantAId, entitlementKey: "module.crm_lite" },
      },
      data: { enabled: false },
    });
    const cancelled = await fetch(`${url}/${result.data.current.id}/cancel`, {
      method: "POST",
      headers: { cookie: createCookie, "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "api-cancel-without-crm", expectedRevision: 3 }),
    });
    expect(cancelled.status).toBe(201);
    expect(await cancelled.json()).toMatchObject({
      data: { current: { status: "cancelled", revision: 4 } },
    });
    await prisma.tenantEntitlement.update({
      where: {
        tenantId_entitlementKey: { tenantId: tenantAId, entitlementKey: "module.crm_lite" },
      },
      data: { enabled: true },
    });
  });

  it("serves the static policy route with dual write permission and strict normalized input", async () => {
    const url = `${baseUrl}/api/v1/quotes/policy`;
    const readsBefore = await prisma.quotePolicy.count({ where: { tenantId: tenantAId } });
    const absentReceiptsBefore = await prisma.quoteCommandReceipt.count({
      where: { tenantId: tenantAId },
    });
    const read = await fetch(url, { headers: { cookie: readCookie } });
    expect(read.status).toBe(200);
    const defaultBody = (await read.json()) as {
      success: boolean;
      data: { autonomyLevel: number; revision: number; contentHash: string };
    };
    expect(defaultBody).toMatchObject({
      success: true,
      data: { autonomyLevel: 0, revision: 0 },
    });
    expect(defaultBody.data.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await prisma.quotePolicy.count({ where: { tenantId: tenantAId } })).toBe(readsBefore);
    expect(await prisma.quoteCommandReceipt.count({ where: { tenantId: tenantAId } })).toBe(
      absentReceiptsBefore,
    );
    expect((await fetch(url, { headers: { cookie: noPermissionCookie } })).status).toBe(403);

    const body = {
      idempotencyKey: "api-policy-update",
      expectedRevision: 0,
      autonomyLevel: 2,
      maxAutoSendAmount: "1000.0000",
      maxAutoSendCurrency: "USD",
      maxDiscountPercent: "25.0000",
    };
    const denied = await fetch(url, {
      method: "PUT",
      headers: { cookie: policyOnePermissionCookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(denied.status).toBe(403);
    const unknown = await fetch(url, {
      method: "PUT",
      headers: { cookie: policyWriteCookie, "content-type": "application/json" },
      body: JSON.stringify({ ...body, actorUserId: "untrusted" }),
    });
    expect(unknown.status).toBe(400);
    const beforeInvalidAutonomy = {
      policies: await prisma.quotePolicy.count({ where: { tenantId: tenantAId } }),
      receipts: await prisma.quoteCommandReceipt.count({ where: { tenantId: tenantAId } }),
      audits: await prisma.auditLog.count({ where: { tenantId: tenantAId } }),
      outbox: await prisma.domainEventOutbox.count({ where: { tenantId: tenantAId } }),
    };
    for (const autonomyLevel of ["2", null, false, [], ""] as const) {
      const invalid = await fetch(url, {
        method: "PUT",
        headers: { cookie: policyWriteCookie, "content-type": "application/json" },
        body: JSON.stringify({ ...body, autonomyLevel }),
      });
      expect(invalid.status).toBe(400);
      expect({
        policies: await prisma.quotePolicy.count({ where: { tenantId: tenantAId } }),
        receipts: await prisma.quoteCommandReceipt.count({ where: { tenantId: tenantAId } }),
        audits: await prisma.auditLog.count({ where: { tenantId: tenantAId } }),
        outbox: await prisma.domainEventOutbox.count({ where: { tenantId: tenantAId } }),
      }).toEqual(beforeInvalidAutonomy);
    }
    const updated = await fetch(url, {
      method: "PUT",
      headers: { cookie: policyWriteCookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      success: true,
      data: {
        replayed: false,
        recordedOutcome: { tenantId: tenantAId, policy: { autonomyLevel: 2, revision: 1 } },
        current: {
          autonomyLevel: 2,
          maxAutoSendAmount: "1000",
          maxAutoSendCurrency: "USD",
          maxDiscountPercent: "25",
          newCustomerRequiresApproval: true,
          exceptionalProductRequiresApproval: true,
          revision: 1,
        },
      },
    });
    expect((await fetch(url, { headers: { cookie: readCookie } })).status).toBe(200);
  });
});
