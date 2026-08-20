import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ContactManager, createContactManager } from "./contact-manager";
import type { PrismaClient } from "./generated/prisma/client";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e06-s01-contact-db";
const metadata = { actorUserId: "e06-s01-actor", requestId: `${prefix}-request` };
let prisma: PrismaClient;
let manager: ContactManager;
let tenantAId = "";
let tenantBId = "";
let contactAId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.contact.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userSession.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userPasswordResetToken.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userRole.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: ids } } } });
  await prisma.role.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

async function provision(marker: string): Promise<string> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Contacts ${marker}`,
    enabledModules: [],
    legalName: `Contacts ${marker} SA`,
    limits: {
      channelAccounts: 2,
      monthlyAiBudget: null,
      organizationUnits: 3,
      storageBytes: 1_073_741_824,
      users: 5,
    },
    owner: {
      displayName: `Owner ${marker}`,
      email: `${prefix}-owner-${marker}@example.invalid`,
      locale: "es-MX",
      passwordHash: "$argon2id$test-hash-not-reversible",
      timezone: "America/Mexico_City",
    },
    requestId: `${prefix}-${marker}`,
    slug: `${prefix}-${marker}`,
  });
  return result.tenant.id;
}

describe.sequential("E06-S01 contact manager", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    [tenantAId, tenantBId] = await Promise.all([provision("a"), provision("b")]);
    manager = createContactManager(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("creates a normalized tenant contact with tags, attributes, Audit and Outbox", async () => {
    const contact = await manager.create(
      createTenantContext(tenantAId),
      {
        customAttributes: { source: "manual", score: 3 },
        email: "  PERSON@Example.COM ",
        name: "Persona A",
        phoneNumber: "+5215512345678",
        tags: ["lead", "VIP", "lead"],
      },
      metadata,
    );
    contactAId = contact.id;
    expect(contact).toMatchObject({
      email: "person@example.com",
      name: "Persona A",
      phoneNumber: "+525512345678",
      status: "ACTIVE",
      tags: ["lead", "VIP"],
    });
    expect(contact.customAttributes).toEqual({ source: "manual", score: 3 });
    await expect(
      prisma.auditLog.findFirstOrThrow({
        where: { action: "contact.created", entityId: contact.id },
      }),
    ).resolves.toMatchObject({ entityType: "Contact", tenantId: tenantAId });
    await expect(
      prisma.domainEventOutbox.findFirstOrThrow({
        where: { aggregateId: contact.id, eventType: "crm.contact.created" },
      }),
    ).resolves.toMatchObject({ tenantId: tenantAId });
  });

  it("finds or creates one contact atomically and supports search/status transitions", async () => {
    const [first, second] = await Promise.all([
      manager.findOrCreateContactByPhone(createTenantContext(tenantAId), "55 1234 5680", "Auto A"),
      manager.findOrCreateContactByPhone(createTenantContext(tenantAId), "+525512345680", "Auto B"),
    ]);
    expect(first.id).toBe(second.id);
    const page = await manager.list(createTenantContext(tenantAId), {
      limit: 10,
      page: 1,
      search: "auto",
    });
    expect(page.items.map(({ id }) => id)).toContain(first.id);
    const blocked = await manager.block(createTenantContext(tenantAId), first.id, metadata);
    expect(blocked.status).toBe("BLOCKED");
    const archived = await manager.archive(createTenantContext(tenantAId), first.id, metadata);
    expect(archived.status).toBe("ARCHIVED");
  });

  it("rejects duplicate phone identity within the same tenant", async () => {
    await expect(
      manager.create(createTenantContext(tenantAId), { phoneNumber: "+525512345678" }, metadata),
    ).rejects.toThrow("contact already uses this phone number");
  });

  it("fails closed for cross-tenant reads and writes", async () => {
    expect(await manager.findById(createTenantContext(tenantBId), contactAId)).toBeNull();
    await expect(
      manager.update(createTenantContext(tenantBId), contactAId, { name: "Escape" }, metadata),
    ).rejects.toThrow("Contact was not found");
    expect(tenantAId).not.toBe(tenantBId);
  });

  it("revalidates tenant operational status before reads", async () => {
    await prisma.tenant.update({ data: { status: "suspended" }, where: { id: tenantBId } });
    try {
      await expect(manager.findById(createTenantContext(tenantBId), contactAId)).rejects.toThrow(
        "Tenant is not operational",
      );
      await expect(manager.list(createTenantContext(tenantBId))).rejects.toThrow(
        "Tenant is not operational",
      );
    } finally {
      await prisma.tenant.update({ data: { status: "active" }, where: { id: tenantBId } });
    }
  });
});
