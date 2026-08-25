import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/prisma/client";
import {
  ActiveTenantUserNotFoundError,
  ConversationNotFoundError,
  createInboxMutationManager,
  type InboxMutationManager,
  InvalidConversationStateTransitionError,
} from "./index";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e07-s04-inbox-mutation-db";
let prisma: PrismaClient;
let manager: InboxMutationManager;
let tenantAId = "";
let tenantBId = "";
let ownerAId = "";
let ownerBId = "";
let inactiveUserAId = "";
let unitAId = "";
let conversationAId = "";
let conversationBId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length === 0) return;
  await prisma.message.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.outboundMessage.deleteMany({ where: { tenantId: { in: ids } } });
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

async function provision(marker: string): Promise<{ ownerId: string; tenantId: string }> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Inbox mutation ${marker}`,
    enabledModules: ["module.messaging.basic", "module.crm_lite"],
    legalName: `Inbox mutation ${marker} SA`,
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
  return { ownerId: result.owner.id, tenantId: result.tenant.id };
}

describe.sequential("E07-S04 inbox mutation manager", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    const [tenantA, tenantB] = await Promise.all([provision("a"), provision("b")]);
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;
    ownerAId = tenantA.ownerId;
    ownerBId = tenantB.ownerId;

    const [channelA, channelB, unitA] = await Promise.all([
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "Inbox mutation channel A",
          providerType: "mock",
          status: "connected",
          tenantId: tenantAId,
        },
      }),
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "Inbox mutation channel B",
          providerType: "mock",
          status: "connected",
          tenantId: tenantBId,
        },
      }),
      prisma.organizationUnit.create({
        data: { name: "Inbox mutation unit A", tenantId: tenantAId, type: "department" },
      }),
    ]);
    unitAId = unitA.id;
    const [contactA, contactB] = await Promise.all([
      prisma.contact.create({
        data: {
          name: "Inbox mutation contact A",
          phoneNumber: "+525588888881",
          tenantId: tenantAId,
        },
      }),
      prisma.contact.create({
        data: {
          name: "Inbox mutation contact B",
          phoneNumber: "+525588888882",
          tenantId: tenantBId,
        },
      }),
    ]);
    const [conversationA, conversationB] = await Promise.all([
      prisma.conversation.create({
        data: {
          channelAccountId: channelA.id,
          contactId: contactA.id,
          status: "open",
          tenantId: tenantAId,
        },
      }),
      prisma.conversation.create({
        data: {
          channelAccountId: channelB.id,
          contactId: contactB.id,
          status: "open",
          tenantId: tenantBId,
        },
      }),
    ]);
    conversationAId = conversationA.id;
    conversationBId = conversationB.id;
    const inactiveUser = await prisma.user.create({
      data: {
        displayName: "Inactive inbox mutation user",
        email: `${prefix}-inactive-a@example.invalid`,
        locale: "es-MX",
        mfaState: "disabled",
        passwordHash: "$argon2id$test-hash-not-reversible",
        status: "disabled",
        tenantId: tenantAId,
        timezone: "America/Mexico_City",
      },
    });
    inactiveUserAId = inactiveUser.id;
    manager = createInboxMutationManager(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma?.$disconnect();
  });

  it("applies the lifecycle matrix and closedAt projection", async () => {
    const pending = await manager.updateConversationStatus(
      createTenantContext(tenantAId),
      conversationAId,
      ownerAId,
      "pending",
      "awaiting customer",
      `${prefix}-pending`,
    );
    expect(pending).toMatchObject({ closedAt: null, status: "pending", tenantId: tenantAId });

    const closed = await manager.updateConversationStatus(
      createTenantContext(tenantAId),
      conversationAId,
      ownerAId,
      "closed",
      "resolved",
      `${prefix}-closed`,
    );
    expect(closed).toMatchObject({ status: "closed", tenantId: tenantAId });
    expect(closed.closedAt).toBeInstanceOf(Date);

    const reopened = await manager.updateConversationStatus(
      createTenantContext(tenantAId),
      conversationAId,
      ownerAId,
      "open",
      undefined,
      `${prefix}-reopened`,
    );
    expect(reopened).toMatchObject({ closedAt: null, status: "open", tenantId: tenantAId });

    await expect(
      prisma.auditLog.count({
        where: {
          action: "conversation.status_updated",
          entityId: conversationAId,
          tenantId: tenantAId,
        },
      }),
    ).resolves.toBe(3);
    await expect(
      prisma.domainEventOutbox.count({
        where: {
          aggregateId: conversationAId,
          eventType: "conversation.status_updated",
          tenantId: tenantAId,
        },
      }),
    ).resolves.toBe(3);
    await expect(
      prisma.auditLog.findFirstOrThrow({
        orderBy: { occurredAt: "desc" },
        where: { action: "conversation.status_updated", entityId: conversationAId },
      }),
    ).resolves.toMatchObject({
      actorId: ownerAId,
      requestId: `${prefix}-reopened`,
    });
  });

  it("rejects invalid and identical lifecycle transitions", async () => {
    await expect(
      manager.updateConversationStatus(
        createTenantContext(tenantAId),
        conversationAId,
        ownerAId,
        "open",
      ),
    ).rejects.toBeInstanceOf(InvalidConversationStateTransitionError);
    await prisma.conversation.update({
      data: { status: "new", closedAt: null },
      where: { id: conversationAId, tenantId: tenantAId },
    });
    await expect(
      manager.updateConversationStatus(
        createTenantContext(tenantAId),
        conversationAId,
        ownerAId,
        "pending",
      ),
    ).rejects.toBeInstanceOf(InvalidConversationStateTransitionError);
    await prisma.conversation.update({
      data: { status: "open" },
      where: { id: conversationAId, tenantId: tenantAId },
    });
  });

  it("assigns active tenant relations and preserves omitted fields", async () => {
    const assigned = await manager.assignConversation(
      createTenantContext(tenantAId),
      conversationAId,
      ownerAId,
      { assignedUnitId: unitAId, assignedUserId: ownerAId },
      `${prefix}-assign`,
    );
    expect(assigned).toMatchObject({
      assignedUnitId: unitAId,
      assignedUserId: ownerAId,
      tenantId: tenantAId,
    });

    const unassignedUser = await manager.assignConversation(
      createTenantContext(tenantAId),
      conversationAId,
      ownerAId,
      { assignedUserId: null },
      `${prefix}-unassign-user`,
    );
    expect(unassignedUser).toMatchObject({ assignedUnitId: unitAId, assignedUserId: null });
    await expect(
      prisma.domainEventOutbox.findFirstOrThrow({
        orderBy: { occurredAt: "desc" },
        where: { aggregateId: conversationAId, eventType: "conversation.assigned" },
      }),
    ).resolves.toMatchObject({
      payload: expect.objectContaining({
        assignedUnitId: unitAId,
        assignedUserId: null,
        tenantId: tenantAId,
      }),
    });
  });

  it("rejects inactive and cross-tenant assignment users", async () => {
    await expect(
      manager.assignConversation(createTenantContext(tenantAId), conversationAId, ownerAId, {
        assignedUserId: inactiveUserAId,
      }),
    ).rejects.toBeInstanceOf(ActiveTenantUserNotFoundError);
    await expect(
      manager.assignConversation(createTenantContext(tenantAId), conversationAId, ownerAId, {
        assignedUserId: ownerBId,
      }),
    ).rejects.toBeInstanceOf(ActiveTenantUserNotFoundError);
  });

  it("fails closed for cross-tenant conversation mutations", async () => {
    await expect(
      manager.updateConversationStatus(
        createTenantContext(tenantBId),
        conversationAId,
        ownerBId,
        "pending",
      ),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);
    await expect(
      manager.assignConversation(createTenantContext(tenantAId), conversationBId, ownerAId, {
        assignedUserId: null,
      }),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);
    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: conversationAId } }),
    ).resolves.toMatchObject({ status: "open", assignedUserId: null, tenantId: tenantAId });
  });
});
