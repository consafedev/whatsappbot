import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/prisma/client";
import {
  createInboxQueryManager,
  type InboxQueryManager,
  InboxQueryValidationError,
  TenantModuleEntitlementRequiredError,
  TenantNotOperationalError,
} from "./index";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  type PlatformTenantModuleKey,
  syncPermissionCatalog,
} from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e07-s01-inbox-query-db";
let prisma: PrismaClient;
let manager: InboxQueryManager;
let tenantAId = "";
let tenantBId = "";
let tenantWithoutCrmId = "";
let ownerAId = "";
let channelAId = "";
let conversationA1Id = "";
let conversationA4Id = "";
let unitAId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length === 0) return;
  await prisma.conversation.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.contact.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.channelAccount.deleteMany({ where: { tenantId: { in: ids } } });
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

async function provision(
  marker: string,
  enabledModules: readonly PlatformTenantModuleKey[],
): Promise<{ ownerId: string; tenantId: string }> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Inbox query ${marker}`,
    enabledModules,
    legalName: `Inbox query ${marker} SA`,
    limits: {
      channelAccounts: 3,
      monthlyAiBudget: null,
      organizationUnits: 3,
      storageBytes: 1_073_741_824,
      users: 5,
    },
    owner: {
      displayName: `Inbox Owner ${marker}`,
      email: `${prefix}-owner-${marker}@example.invalid`,
      locale: "es-MX",
      passwordHash: "$argon2id$test-hash-not-reversible",
      timezone: "America/Mexico_City",
    },
    requestId: `${prefix}-${marker}`,
    slug: `${prefix}-${marker}`,
  });
  return { ownerId: result.owner.id, tenantId: result.tenant.id };
}

describe.sequential("E07-S01 inbox query manager", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    const [tenantA, tenantB, tenantWithoutCrm] = await Promise.all([
      provision("a", ["module.messaging.basic", "module.crm_lite"]),
      provision("b", ["module.messaging.basic", "module.crm_lite"]),
      provision("without-crm", ["module.messaging.basic"]),
    ]);
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;
    tenantWithoutCrmId = tenantWithoutCrm.tenantId;
    ownerAId = tenantA.ownerId;
    const [channelA, channelB, unitA] = await Promise.all([
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "Inbox Channel A",
          providerType: "mock",
          status: "connected",
          tenantId: tenantAId,
        },
      }),
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "Inbox Channel B",
          providerType: "mock",
          status: "connected",
          tenantId: tenantBId,
        },
      }),
      prisma.organizationUnit.create({
        data: { name: "Inbox Unit A", tenantId: tenantAId, type: "department" },
      }),
    ]);
    channelAId = channelA.id;
    unitAId = unitA.id;
    const contacts = await Promise.all([
      prisma.contact.create({
        data: { name: "Alice A", phoneNumber: "+525511111111", tenantId: tenantAId },
      }),
      prisma.contact.create({
        data: { name: "Bob A", phoneNumber: "+525522222222", tenantId: tenantAId },
      }),
      prisma.contact.create({
        data: { name: "Carol A", phoneNumber: "+525533333333", tenantId: tenantAId },
      }),
      prisma.contact.create({
        data: { name: "Closed A", phoneNumber: "+525544444444", tenantId: tenantAId },
      }),
      prisma.contact.create({
        data: { name: "Tenant B", phoneNumber: "+525555555555", tenantId: tenantBId },
      }),
    ]);
    const [alice, bob, carol, closed, tenantBContact] = contacts;
    const conversations = await Promise.all([
      prisma.conversation.create({
        data: {
          assignedUnitId: unitAId,
          assignedUserId: ownerAId,
          channelAccountId: channelAId,
          contactId: alice.id,
          lastHumanMessageAt: new Date("2026-08-21T11:00:00.000Z"),
          lastInboundAt: new Date("2026-08-21T12:00:00.000Z"),
          lastMessageAt: new Date("2026-08-21T12:00:00.000Z"),
          status: "open",
          tenantId: tenantAId,
        },
      }),
      prisma.conversation.create({
        data: {
          channelAccountId: channelAId,
          contactId: bob.id,
          lastInboundAt: new Date("2026-08-21T11:00:00.000Z"),
          lastMessageAt: new Date("2026-08-21T11:00:00.000Z"),
          status: "pending",
          tenantId: tenantAId,
        },
      }),
      prisma.conversation.create({
        data: {
          channelAccountId: channelAId,
          contactId: carol.id,
          status: "new",
          tenantId: tenantAId,
        },
      }),
      prisma.conversation.create({
        data: {
          channelAccountId: channelAId,
          contactId: closed.id,
          lastMessageAt: new Date("2026-08-21T10:00:00.000Z"),
          status: "closed",
          tenantId: tenantAId,
        },
      }),
      prisma.conversation.create({
        data: {
          channelAccountId: channelB.id,
          contactId: tenantBContact.id,
          lastMessageAt: new Date("2026-08-21T13:00:00.000Z"),
          status: "open",
          tenantId: tenantBId,
        },
      }),
    ]);
    conversationA1Id = conversations[0].id;
    conversationA4Id = conversations[3].id;
    manager = createInboxQueryManager(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma?.$disconnect();
  });

  it("orders by last message with nulls last and derives unread", async () => {
    const result = await manager.listInboxConversations(createTenantContext(tenantAId));
    expect(result.items.map(({ id }) => id)).toEqual([
      conversationA1Id,
      expect.any(String),
      conversationA4Id,
      expect.any(String),
    ]);
    expect(result.items[0]).toMatchObject({ status: "open", unread: true });
    expect(result.items[2]).toMatchObject({ id: conversationA4Id, status: "closed" });
    expect(result.items[3]).toMatchObject({ lastMessageAt: null, status: "new" });
    expect(result.totalActive).toBe(3);
  });

  it("supports active, status, assignment, unassigned and contact search filters", async () => {
    const active = await manager.listInboxConversations(createTenantContext(tenantAId), {
      status: "active",
    });
    expect(active.items).toHaveLength(3);
    const closed = await manager.listInboxConversations(createTenantContext(tenantAId), {
      status: "closed",
    });
    expect(closed.items.map(({ id }) => id)).toEqual([conversationA4Id]);
    const assigned = await manager.listInboxConversations(createTenantContext(tenantAId), {
      assignedUserId: ownerAId,
      assignedUnitId: unitAId,
    });
    expect(assigned.items).toHaveLength(1);
    const unassigned = await manager.listInboxConversations(createTenantContext(tenantAId), {
      assignedUserId: "unassigned",
    });
    expect(unassigned.items).toHaveLength(3);
    await expect(
      manager.listInboxConversations(createTenantContext(tenantAId), { search: "22222222" }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ contactId: expect.any(String) })],
    });
  });

  it("paginates without overlaps and rejects malformed cursors", async () => {
    const first = await manager.listInboxConversations(createTenantContext(tenantAId), {
      limit: 2,
    });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await manager.listInboxConversations(createTenantContext(tenantAId), {
      ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }),
      limit: 2,
    });
    expect(second.items).toHaveLength(2);
    expect(second.items.map(({ id }) => id)).not.toEqual(first.items.map(({ id }) => id));
    expect(second.nextCursor).toBeNull();
    await expect(
      manager.listInboxConversations(createTenantContext(tenantAId), { cursor: "not-a-cursor" }),
    ).rejects.toBeInstanceOf(InboxQueryValidationError);
  });

  it("enforces tenant isolation, entitlements and operational status", async () => {
    const tenantB = await manager.listInboxConversations(createTenantContext(tenantBId));
    expect(tenantB.items).toHaveLength(1);
    expect(tenantB.items[0]).not.toHaveProperty("tenantId");
    await expect(
      manager.listInboxConversations(createTenantContext(tenantWithoutCrmId)),
    ).rejects.toBeInstanceOf(TenantModuleEntitlementRequiredError);
    await prisma.tenant.update({ data: { status: "suspended" }, where: { id: tenantAId } });
    await expect(
      manager.listInboxConversations(createTenantContext(tenantAId)),
    ).rejects.toBeInstanceOf(TenantNotOperationalError);
    await prisma.tenant.update({ data: { status: "active" }, where: { id: tenantAId } });
  });
});
