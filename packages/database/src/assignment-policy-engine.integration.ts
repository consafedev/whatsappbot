import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/prisma/client";
import {
  type AssignmentPolicyEngine,
  ConversationNotFoundError,
  createAssignmentPolicyEngine,
} from "./index";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";
import { createTenantContext } from "./tenant-context";

const prefix = "e08-s05-assign-db";
let prisma: PrismaClient;
let engine: AssignmentPolicyEngine;

let tenantAId = "";
let tenantBId = "";
let agentA1Id = "";
let agentA2Id = "";
let unitAId = "";
let channelAId = "";
let channelBId = "";
let contactA1Id = "";
let contactA2Id = "";
let conversationA1Id = "";
let conversationA2Id = "";
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
  await prisma.inboundMessageEvent.deleteMany({ where: { tenantId: { in: ids } } });
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
    displayName: `Assignment ${marker}`,
    enabledModules: ["module.messaging.basic", "module.crm_lite", "module.automation.basic"],
    legalName: `Assignment ${marker} SA`,
    limits: {
      channelAccounts: 2,
      monthlyAiBudget: null,
      organizationUnits: 3,
      storageBytes: 1_073_741_824,
      users: 10,
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

describe.sequential("E08-S05 assignment policy engine integration", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);

    engine = createAssignmentPolicyEngine(prisma);

    const [tenantA, tenantB] = await Promise.all([provision("a"), provision("b")]);
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    // Create 2 additional agents for Tenant A
    const [agent1, agent2] = await Promise.all([
      prisma.user.create({
        data: {
          displayName: "Agent A1",
          email: `${prefix}-agent1-a@example.invalid`,
          locale: "es-MX",
          passwordHash: "$argon2id$test",
          status: "active",
          tenantId: tenantAId,
          timezone: "America/Mexico_City",
        },
      }),
      prisma.user.create({
        data: {
          displayName: "Agent A2",
          email: `${prefix}-agent2-a@example.invalid`,
          locale: "es-MX",
          passwordHash: "$argon2id$test",
          status: "active",
          tenantId: tenantAId,
          timezone: "America/Mexico_City",
        },
      }),
    ]);
    agentA1Id = agent1.id;
    agentA2Id = agent2.id;

    // Organization unit for Tenant A
    const unitA = await prisma.organizationUnit.create({
      data: {
        active: true,
        name: "Support Unit A",
        tenantId: tenantAId,
        type: "department",
      },
    });
    unitAId = unitA.id;

    // Assign Agent A2 to Unit A
    const defaultRole = await prisma.role.findFirstOrThrow({
      where: { name: "Agent", tenantId: tenantAId },
    });
    await prisma.userRole.create({
      data: {
        organizationUnitId: unitAId,
        roleId: defaultRole.id,
        tenantId: tenantAId,
        userId: agentA2Id,
      },
    });

    const [channelA, channelB] = await Promise.all([
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "Channel A",
          providerType: "mock",
          status: "connected",
          tenantId: tenantAId,
        },
      }),
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "Channel B",
          providerType: "mock",
          status: "connected",
          tenantId: tenantBId,
        },
      }),
    ]);
    channelAId = channelA.id;
    channelBId = channelB.id;

    const [contact1, contact2, contactB] = await Promise.all([
      prisma.contact.create({
        data: {
          name: "Contact A1",
          phoneNumber: "+525533333331",
          tenantId: tenantAId,
        },
      }),
      prisma.contact.create({
        data: {
          name: "Contact A2",
          phoneNumber: "+525533333332",
          tenantId: tenantAId,
        },
      }),
      prisma.contact.create({
        data: {
          name: "Contact B1",
          phoneNumber: "+525544444441",
          tenantId: tenantBId,
        },
      }),
    ]);
    contactA1Id = contact1.id;
    contactA2Id = contact2.id;

    const [conv1, conv2, convB] = await Promise.all([
      prisma.conversation.create({
        data: {
          automationMode: "AUTO",
          channelAccountId: channelAId,
          contactId: contactA1Id,
          status: "open",
          tenantId: tenantAId,
        },
      }),
      prisma.conversation.create({
        data: {
          automationMode: "AUTO",
          channelAccountId: channelAId,
          contactId: contactA2Id,
          status: "open",
          tenantId: tenantAId,
        },
      }),
      prisma.conversation.create({
        data: {
          automationMode: "AUTO",
          channelAccountId: channelBId,
          contactId: contactB.id,
          status: "open",
          tenantId: tenantBId,
        },
      }),
    ]);
    conversationA1Id = conv1.id;
    conversationA2Id = conv2.id;
    conversationBId = convB.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("ROUND_ROBIN policy rotates assignment across eligible agents", async () => {
    const tenantA = createTenantContext(tenantAId);

    // Initial assignment
    const res1 = await engine.resolveAssignmentByPolicy(tenantA, conversationA1Id, "ROUND_ROBIN");
    expect(res1.assignedUserId).toBeDefined();
    expect(res1.policyUsed).toBe("ROUND_ROBIN");

    // Second assignment should pick a different or next agent
    const res2 = await engine.resolveAssignmentByPolicy(tenantA, conversationA2Id, "ROUND_ROBIN");
    expect(res2.assignedUserId).toBeDefined();
    expect(res2.policyUsed).toBe("ROUND_ROBIN");
    expect(res2.assignedUserId).not.toBe(res1.assignedUserId);
  });

  it("LEAST_BUSY policy assigns the agent with fewest open conversations", async () => {
    const tenantA = createTenantContext(tenantAId);

    // Give agent A1 3 open conversations
    await prisma.conversation.createMany({
      data: [
        {
          assignedUserId: agentA1Id,
          channelAccountId: channelAId,
          contactId: contactA1Id,
          status: "open",
          tenantId: tenantAId,
        },
        {
          assignedUserId: agentA1Id,
          channelAccountId: channelAId,
          contactId: contactA1Id,
          status: "open",
          tenantId: tenantAId,
        },
      ],
    });

    // Reset conversationA1 assignedUserId to null
    await prisma.conversation.update({
      data: { assignedUserId: null },
      where: { id: conversationA1Id },
    });

    const result = await engine.resolveAssignmentByPolicy(tenantA, conversationA1Id, "LEAST_BUSY");
    expect(result.assignedUserId).toBeDefined();
    expect(result.policyUsed).toBe("LEAST_BUSY");
    // Agent A1 has 2+ open conversations, so LEAST_BUSY should select ownerA or agentA2
    expect(result.assignedUserId).not.toBe(agentA1Id);
  });

  it("STICKY_AGENT policy prioritizes previous agent who handled the contact", async () => {
    const tenantA = createTenantContext(tenantAId);

    // Create a previous closed conversation with contactA1 assigned to Agent A1
    await prisma.conversation.create({
      data: {
        assignedUserId: agentA1Id,
        channelAccountId: channelAId,
        contactId: contactA1Id,
        status: "closed",
        tenantId: tenantAId,
      },
    });

    // Reset conversationA1
    await prisma.conversation.update({
      data: { assignedUserId: null },
      where: { id: conversationA1Id },
    });

    const result = await engine.resolveAssignmentByPolicy(
      tenantA,
      conversationA1Id,
      "STICKY_AGENT",
    );
    expect(result.assignedUserId).toBe(agentA1Id);
    expect(result.policyUsed).toBe("STICKY_AGENT");
  });

  it("filters eligible agents by organization unit if unitId is provided", async () => {
    const tenantA = createTenantContext(tenantAId);

    const result = await engine.resolveAssignmentByPolicy(
      tenantA,
      conversationA1Id,
      "ROUND_ROBIN",
      { unitId: unitAId },
    );

    // Only Agent A2 has role assignment in unitAId
    expect(result.assignedUserId).toBe(agentA2Id);
  });

  it("enforces strict A/B isolation: Tenant A cannot assign Tenant B conversation", async () => {
    const tenantA = createTenantContext(tenantAId);

    await expect(
      engine.resolveAssignmentByPolicy(tenantA, conversationBId, "ROUND_ROBIN"),
    ).rejects.toThrow(ConversationNotFoundError);
  });
});
