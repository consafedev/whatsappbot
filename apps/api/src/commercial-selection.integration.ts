import { generateOpaqueToken, hashOpaqueToken } from "@whatsapp-platform/auth";
import { loadDatabaseConfig, loadNonSecretConfig } from "@whatsapp-platform/config";
import {
  createPlatformDatabaseClient,
  type PrismaClient,
  syncPermissionCatalog,
} from "@whatsapp-platform/database/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "./app";

const prefix = "e15-s06-commercial-selection-api";
const binary = (value: Buffer) => new Uint8Array(value);

describe.sequential("E15-S06 commercial selection API", () => {
  let app: Awaited<ReturnType<typeof createApiApplication>>;
  let prisma: PrismaClient;
  let baseUrl = "";
  let tenantId = "";
  let quoteCookie = "";
  let catalogCookie = "";
  let scopedCookie = "";
  let noPermissionCookie = "";
  let contactId = "";
  let organizationUnitId = "";

  async function cleanup(): Promise<void> {
    const tenants = await prisma.tenant.findMany({
      select: { id: true },
      where: { slug: { startsWith: prefix } },
    });
    const ids = tenants.map(({ id }) => id);
    if (ids.length === 0) return;
    await prisma.userSession.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.userRole.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: ids } } } });
    await prisma.role.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.contact.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  }

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
        displayName: "Commercial selection tenant",
        legalName: "Commercial selection tenant",
        slug: `${prefix}-tenant`,
        status: "active",
      },
    });
    tenantId = tenant.id;
    const [contact, organizationUnit] = await Promise.all([
      prisma.contact.create({
        data: {
          customAttributes: { private: "must not project" },
          email: "private@example.invalid",
          name: "Commercial customer",
          phoneNumber: "+525500001234",
          tags: ["private"],
          tenantId,
        },
      }),
      prisma.organizationUnit.create({
        data: {
          address: { private: "must not project" },
          code: "SALES-1",
          name: "Sales unit",
          settings: { private: "must not project" },
          tenantId,
          type: "branch",
        },
      }),
    ]);
    contactId = contact.id;
    organizationUnitId = organizationUnit.id;
    await Promise.all(
      ["module.quotes", "module.crm_lite", "module.catalog"].map((entitlementKey) =>
        prisma.tenantEntitlement.create({
          data: { enabled: true, entitlementKey, source: "contract", tenantId },
        }),
      ),
    );
    const createActor = async (marker: string, permissionKey?: string, scopedUnitId?: string) => {
      const user = await prisma.user.create({
        data: {
          displayName: `Commercial selector ${marker}`,
          email: `${prefix}-${marker}@example.invalid`,
          locale: "es-MX",
          passwordHash: "integration-only-not-a-real-password-hash",
          tenantId,
          timezone: "America/Mexico_City",
        },
      });
      if (permissionKey !== undefined) {
        const role = await prisma.role.create({
          data: { key: `${prefix}-${marker}`, name: `Commercial selector ${marker}`, tenantId },
        });
        const permission = await prisma.permission.findUnique({ where: { key: permissionKey } });
        if (permission === null) throw new Error(`Missing canonical permission: ${permissionKey}`);
        await prisma.rolePermission.create({
          data: { permissionId: permission.id, roleId: role.id },
        });
        await prisma.userRole.create({
          data: {
            organizationUnitId: scopedUnitId ?? null,
            roleId: role.id,
            tenantId,
            userId: user.id,
          },
        });
      }
      const token = generateOpaqueToken();
      await prisma.userSession.create({
        data: {
          expiresAt: new Date(Date.now() + 3_600_000),
          tenantId,
          tokenHash: binary(hashOpaqueToken(token)),
          userId: user.id,
        },
      });
      return `tenant_session=${token}`;
    };
    [quoteCookie, catalogCookie, scopedCookie, noPermissionCookie] = await Promise.all([
      createActor("quotes-create", "quotes.create"),
      createActor("catalog-manage", "catalog.manage"),
      createActor("quotes-ou-scoped", "quotes.create", organizationUnitId),
      createActor("no-permission"),
    ]);
    app = await createApiApplication(loadNonSecretConfig());
    await app.listen(0);
    const address = app.getHttpServer().address();
    if (address === null || typeof address === "string") {
      throw new Error("API did not bind a TCP port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("serves contact options to an authenticated quote creator", async () => {
    const before = {
      audits: await prisma.auditLog.count({ where: { tenantId } }),
      outbox: await prisma.domainEventOutbox.count({ where: { tenantId } }),
      receipts: await prisma.quoteCommandReceipt.count({ where: { tenantId } }),
    };
    const response = await fetch(`${baseUrl}/api/v1/quotes/options/contacts`, {
      headers: { cookie: quoteCookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        items: [{ id: contactId, name: "Commercial customer", phoneNumber: "+525500001234" }],
        nextCursor: null,
        limit: 20,
      },
    });
    expect({
      audits: await prisma.auditLog.count({ where: { tenantId } }),
      outbox: await prisma.domainEventOutbox.count({ where: { tenantId } }),
      receipts: await prisma.quoteCommandReceipt.count({ where: { tenantId } }),
    }).toEqual(before);
  });

  it("guards each option route by its own operation capability and module", async () => {
    expect((await fetch(`${baseUrl}/api/v1/quotes/options/contacts`)).status).toBe(401);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/quotes/options/contacts`, {
          headers: { cookie: noPermissionCookie },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/quotes/options/organization-units`, {
          headers: { cookie: scopedCookie },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/quotes/options/organization-units`, {
          headers: { cookie: quoteCookie },
        })
      ).status,
    ).toBe(200);
    const quoteUnits = await fetch(`${baseUrl}/api/v1/quotes/options/organization-units`, {
      headers: { cookie: quoteCookie },
    });
    expect(await quoteUnits.json()).toEqual({
      success: true,
      data: {
        items: [{ id: organizationUnitId, name: "Sales unit", code: "SALES-1" }],
        nextCursor: null,
        limit: 20,
      },
    });
    const productUnits = await fetch(`${baseUrl}/api/v1/products/options/organization-units`, {
      headers: { cookie: catalogCookie },
    });
    expect(productUnits.status).toBe(200);
    expect(await productUnits.json()).toEqual({
      success: true,
      data: {
        items: [{ id: organizationUnitId, name: "Sales unit", code: "SALES-1" }],
        nextCursor: null,
        limit: 20,
      },
    });
    await prisma.tenantEntitlement.update({
      data: { enabled: false },
      where: { tenantId_entitlementKey: { entitlementKey: "module.crm_lite", tenantId } },
    });
    expect(
      (
        await fetch(`${baseUrl}/api/v1/quotes/options/contacts`, {
          headers: { cookie: quoteCookie },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/quotes/options/organization-units`, {
          headers: { cookie: quoteCookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/products/options/organization-units`, {
          headers: { cookie: catalogCookie },
        })
      ).status,
    ).toBe(200);
    await prisma.tenantEntitlement.update({
      data: { enabled: false },
      where: { tenantId_entitlementKey: { entitlementKey: "module.quotes", tenantId } },
    });
    expect(
      (
        await fetch(`${baseUrl}/api/v1/quotes/options/organization-units`, {
          headers: { cookie: quoteCookie },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/products/options/organization-units`, {
          headers: { cookie: catalogCookie },
        })
      ).status,
    ).toBe(200);
    await prisma.tenantEntitlement.update({
      data: { enabled: true },
      where: { tenantId_entitlementKey: { entitlementKey: "module.quotes", tenantId } },
    });
    await prisma.tenantEntitlement.update({
      data: { enabled: true },
      where: { tenantId_entitlementKey: { entitlementKey: "module.crm_lite", tenantId } },
    });
    await prisma.tenantEntitlement.update({
      data: { enabled: false },
      where: { tenantId_entitlementKey: { entitlementKey: "module.catalog", tenantId } },
    });
    expect(
      (
        await fetch(`${baseUrl}/api/v1/products/options/organization-units`, {
          headers: { cookie: catalogCookie },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/quotes/options/organization-units`, {
          headers: { cookie: quoteCookie },
        })
      ).status,
    ).toBe(200);
    await prisma.tenantEntitlement.update({
      data: { enabled: true },
      where: { tenantId_entitlementKey: { entitlementKey: "module.catalog", tenantId } },
    });
  });

  it("rejects malformed and unknown option query fields", async () => {
    const base = `${baseUrl}/api/v1/quotes/options/contacts`;
    for (const search of ["x".repeat(101), "x\ny", "x\u0000y"]) {
      const response = await fetch(`${base}?search=${encodeURIComponent(search)}`, {
        headers: { cookie: quoteCookie },
      });
      expect(response.status).toBe(400);
    }
    for (const query of ["cursor=not-a-uuid", "limit=0", "limit=51", "limit=1.5", "surprise=1"]) {
      const response = await fetch(`${base}?${query}`, { headers: { cookie: quoteCookie } });
      expect(response.status).toBe(400);
    }
    const repeated = await fetch(`${base}?limit=1&limit=2`, {
      headers: { cookie: quoteCookie },
    });
    expect(repeated.status).toBe(400);
  });
});
