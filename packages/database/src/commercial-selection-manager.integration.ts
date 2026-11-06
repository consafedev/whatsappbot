import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  listCommercialContactOptions,
  listCommercialOrganizationUnitOptions,
} from "./commercial-selection-manager";
import { createPlatformDatabaseClient, type PrismaClient } from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e15-s06-commercial-selection-db";

describe.sequential("E15-S06 commercial selection manager", () => {
  let prisma: PrismaClient;
  let tenantAId = "";
  let tenantBId = "";

  async function cleanup(): Promise<void> {
    const tenants = await prisma.tenant.findMany({
      select: { id: true },
      where: { slug: { startsWith: prefix } },
    });
    const ids = tenants.map(({ id }) => id);
    if (ids.length === 0) return;
    await prisma.contact.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  }

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
            displayName: `Commercial selector ${marker}`,
            legalName: `Commercial selector ${marker}`,
            slug: `${prefix}-${marker}`,
            status: "active",
          },
        }),
      ),
    );
    if (tenantA === undefined || tenantB === undefined) {
      throw new Error("Commercial selection tenant fixtures failed");
    }
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
  }, 60_000);

  afterAll(async () => {
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("returns active owned contacts as a minimal bounded cursor page", async () => {
    const contacts = await Promise.all(
      ["Northwind ACME", "Contoso ACME", "Inactive ACME"].map((name, index) =>
        prisma.contact.create({
          data: {
            customAttributes: { private: "must not project" },
            email: `selector-${index}@example.invalid`,
            name,
            phoneNumber: `+5255000${index}001`,
            status: index === 2 ? "INACTIVE" : "ACTIVE",
            tags: ["private"],
            tenantId: tenantAId,
          },
        }),
      ),
    );
    await prisma.contact.create({
      data: {
        name: "Foreign ACME",
        phoneNumber: "+52550009999",
        tenantId: tenantBId,
      },
    });
    const context = createTenantContext(tenantAId);
    const first = await listCommercialContactOptions(context, prisma, {
      limit: 1,
      search: " ACME ",
    });
    expect(first.items).toHaveLength(1);
    expect(first.limit).toBe(1);
    expect(first.nextCursor).toBe(first.items[0]?.id);
    expect(Object.keys(first.items[0] ?? {}).sort()).toEqual(["id", "name", "phoneNumber"]);
    const second = await listCommercialContactOptions(context, prisma, {
      ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }),
      limit: 1,
      search: "ACME",
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map(({ id }) => id)).toEqual(
      contacts
        .filter(({ status }) => status === "ACTIVE")
        .map(({ id }) => id)
        .sort(),
    );
    expect([...first.items, ...second.items].some(({ id }) => id === contacts[2]?.id)).toBe(false);
    expect([...first.items, ...second.items].some(({ id }) => id === contacts[0]?.id)).toBe(true);
  });

  it("returns active owned organization units as a minimal bounded cursor page", async () => {
    const units = await Promise.all(
      ["Northwind branch", "Contoso branch", "Inactive branch"].map((name, index) =>
        prisma.organizationUnit.create({
          data: {
            active: index !== 2,
            address: { private: "must not project" },
            code: `S06-${index}`,
            name,
            settings: { private: "must not project" },
            tenantId: tenantAId,
            type: "branch",
          },
        }),
      ),
    );
    await prisma.organizationUnit.create({
      data: { code: "FOREIGN", name: "Foreign branch", tenantId: tenantBId, type: "branch" },
    });
    const context = createTenantContext(tenantAId);
    const first = await listCommercialOrganizationUnitOptions(context, prisma, {
      limit: 1,
      search: " branch ",
    });
    const second = await listCommercialOrganizationUnitOptions(context, prisma, {
      ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }),
      limit: 1,
      search: "branch",
    });
    expect(first.items).toHaveLength(1);
    expect(first.limit).toBe(1);
    expect(first.nextCursor).toBe(first.items[0]?.id);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(Object.keys(first.items[0] ?? {}).sort()).toEqual(["code", "id", "name"]);
    expect([...first.items, ...second.items].map(({ id }) => id)).toEqual(
      units
        .filter(({ active }) => active)
        .map(({ id }) => id)
        .sort(),
    );
  });

  it("validates manager filters even when bypassing the HTTP parser", async () => {
    const context = createTenantContext(tenantAId);
    await expect(
      listCommercialContactOptions(context, prisma, { search: "x".repeat(101) }),
    ).rejects.toThrow();
    await expect(
      listCommercialContactOptions(context, prisma, { search: "x\n" }),
    ).rejects.toThrow();
    await expect(
      listCommercialContactOptions(context, prisma, {
        cursor: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow();
    await expect(
      listCommercialOrganizationUnitOptions(context, prisma, { limit: 0 }),
    ).rejects.toThrow();
    await expect(
      listCommercialOrganizationUnitOptions(context, prisma, { limit: 51 }),
    ).rejects.toThrow();
    await expect(
      listCommercialOrganizationUnitOptions(context, prisma, { surprise: true } as never),
    ).rejects.toThrow();
  });
});
