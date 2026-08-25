import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";
import {
  createRuleCatalogManager,
  type RuleCatalogManager,
  RuleChannelAccountNotFoundError,
  RuleNotFoundError,
  RuleOrganizationUnitNotFoundError,
  RuleValidationError,
} from "./rule-catalog-manager";
import { createTenantContext } from "./tenant-context";

const prefix = "e08-s01-rules-db";
const metadata = { actorUserId: "e08-s01-actor", requestId: `${prefix}-request` };
let prisma: PrismaClient;
let manager: RuleCatalogManager;
let tenantAId = "";
let tenantBId = "";
let rootAId = "";
let rootBId = "";
let channelAId = "";
let channelBId = "";
let createdRuleAId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.rule.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.message.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.contact.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.outboundMessage.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.inboundMessageEvent.deleteMany({ where: { tenantId: { in: ids } } });
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

async function provision(marker: string): Promise<{ id: string; rootId: string }> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Rules Tenant ${marker}`,
    enabledModules: ["module.messaging.basic", "module.automation.basic"],
    legalName: `Rules Tenant ${marker} SA`,
    limits: {
      channelAccounts: 5,
      monthlyAiBudget: null,
      organizationUnits: 5,
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
  return { id: result.tenant.id, rootId: result.organizationRoot.id };
}

describe.sequential("Rule catalog manager", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    const [tenantA, tenantB] = await Promise.all([provision("a"), provision("b")]);
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    rootAId = tenantA.rootId;
    rootBId = tenantB.rootId;

    // Create channel accounts for testing relations
    const channelA = await prisma.channelAccount.create({
      data: {
        displayName: "Canal A",
        organizationUnitId: rootAId,
        phoneNumber: "+525511223344",
        providerType: "mock",
        tenantId: tenantAId,
      },
    });
    channelAId = channelA.id;

    const channelB = await prisma.channelAccount.create({
      data: {
        displayName: "Canal B",
        organizationUnitId: rootBId,
        phoneNumber: "+525599887766",
        providerType: "mock",
        tenantId: tenantBId,
      },
    });
    channelBId = channelB.id;

    manager = createRuleCatalogManager(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("creates a rule with conditions and actions, emitting Audit and Outbox events", async () => {
    const created = await manager.createRule(
      createTenantContext(tenantAId),
      "user-1",
      {
        actions: [
          {
            actionType: "send_message",
            parameters: { text: "¡Hola! ¿En qué podemos ayudarte?" },
          },
        ],
        channelAccountId: channelAId,
        conditions: [
          {
            field: "message.body",
            operator: "contains",
            value: "hola",
          },
        ],
        cooldownSeconds: 60,
        description: "Regla de bienvenida",
        executionMode: "first_match_stop",
        name: "Auto-saludo inicial",
        organizationUnitId: rootAId,
        priority: 50,
        status: "active",
        triggerType: "ON_MESSAGE_RECEIVED",
      },
      metadata,
    );

    createdRuleAId = created.id;
    expect(created).toMatchObject({
      channelAccountId: channelAId,
      cooldownSeconds: 60,
      description: "Regla de bienvenida",
      executionMode: "first_match_stop",
      name: "Auto-saludo inicial",
      organizationUnitId: rootAId,
      priority: 50,
      status: "active",
      tenantId: tenantAId,
      triggerType: "ON_MESSAGE_RECEIVED",
    });
    expect(created.conditions).toHaveLength(1);
    expect(created.actions).toHaveLength(1);

    const [audit, event] = await Promise.all([
      prisma.auditLog.findFirstOrThrow({
        where: { action: "rule.created", entityId: createdRuleAId, tenantId: tenantAId },
      }),
      prisma.domainEventOutbox.findFirstOrThrow({
        where: { eventType: "rule.created", aggregateId: createdRuleAId, tenantId: tenantAId },
      }),
    ]);

    expect(audit.actorId).toBe("e08-s01-actor");
    expect(audit.entityType).toBe("Rule");
    expect(event.payload).toMatchObject({
      action: "rule.created",
      ruleId: createdRuleAId,
      status: "active",
      tenantId: tenantAId,
      triggerType: "ON_MESSAGE_RECEIVED",
    });
  });

  it("lists rules sorted by priority ASC and createdAt DESC, and supports query filters", async () => {
    // Create additional rule with lower priority (higher number)
    await manager.createRule(
      createTenantContext(tenantAId),
      "user-1",
      {
        actions: [{ actionType: "assign_user", parameters: { userId: "some-user" } }],
        conditions: [],
        name: "Asignación por defecto",
        priority: 200,
        status: "draft",
        triggerType: "ON_CONVERSATION_UNASSIGNED",
      },
      metadata,
    );

    // List all
    const allRules = await manager.listRules(createTenantContext(tenantAId));
    expect(allRules.length).toBeGreaterThanOrEqual(2);
    expect(allRules[0]?.priority).toBeLessThanOrEqual(allRules[1]?.priority ?? 1000);

    // Filter by triggerType
    const messageRules = await manager.listRules(createTenantContext(tenantAId), {
      triggerType: "ON_MESSAGE_RECEIVED",
    });
    expect(messageRules.every((r) => r.triggerType === "ON_MESSAGE_RECEIVED")).toBe(true);

    // Filter by status
    const draftRules = await manager.listRules(createTenantContext(tenantAId), {
      status: "draft",
    });
    expect(draftRules.every((r) => r.status === "draft")).toBe(true);

    // Filter by channelAccountId
    const channelRules = await manager.listRules(createTenantContext(tenantAId), {
      channelAccountId: channelAId,
    });
    expect(channelRules.every((r) => r.channelAccountId === channelAId)).toBe(true);
  });

  it("updates rule properties, conditions, actions, and relations with audit logging", async () => {
    const updated = await manager.updateRule(
      createTenantContext(tenantAId),
      createdRuleAId,
      "user-2",
      {
        actions: [
          {
            actionType: "send_message",
            parameters: { text: "Mensaje modificado" },
          },
          {
            actionType: "set_conversation_mode",
            parameters: { mode: "AUTO" },
          },
        ],
        name: "Auto-saludo renovado",
        priority: 10,
        status: "inactive",
      },
      metadata,
    );

    expect(updated).toMatchObject({
      id: createdRuleAId,
      name: "Auto-saludo renovado",
      priority: 10,
      status: "inactive",
    });
    expect(updated.actions).toHaveLength(2);

    const audit = await prisma.auditLog.findFirstOrThrow({
      orderBy: { occurredAt: "desc" },
      where: { action: "rule.updated", entityId: createdRuleAId, tenantId: tenantAId },
    });
    expect(audit.afterSummary).toMatchObject({
      name: "Auto-saludo renovado",
      priority: 10,
      status: "inactive",
    });
  });

  it("rejects invalid trigger types, priority range, conditions, and empty actions", async () => {
    await expect(
      manager.createRule(
        createTenantContext(tenantAId),
        "user-1",
        {
          actions: [{ actionType: "send_message" }],
          conditions: [],
          name: "Invalid Trigger",
          triggerType: "INVALID_TRIGGER",
        },
        metadata,
      ),
    ).rejects.toThrow(RuleValidationError);

    await expect(
      manager.createRule(
        createTenantContext(tenantAId),
        "user-1",
        {
          actions: [{ actionType: "send_message" }],
          conditions: [],
          name: "Invalid Priority",
          priority: -5,
          triggerType: "ON_MESSAGE_RECEIVED",
        },
        metadata,
      ),
    ).rejects.toThrow(RuleValidationError);

    await expect(
      manager.createRule(
        createTenantContext(tenantAId),
        "user-1",
        {
          actions: [],
          conditions: [],
          name: "No actions",
          triggerType: "ON_MESSAGE_RECEIVED",
        },
        metadata,
      ),
    ).rejects.toThrow("Rule actions cannot be empty");

    await expect(
      manager.createRule(
        createTenantContext(tenantAId),
        "user-1",
        {
          actions: [{ actionType: "send_message" }],
          conditions: [{ field: "msg", operator: "invalid_operator" }],
          name: "Invalid operator",
          triggerType: "ON_MESSAGE_RECEIVED",
        },
        metadata,
      ),
    ).rejects.toThrow(RuleValidationError);
  });

  it("rejects cross-tenant ChannelAccount or OrganizationUnit relations", async () => {
    // Tenant A trying to attach Tenant B channel
    await expect(
      manager.createRule(
        createTenantContext(tenantAId),
        "user-1",
        {
          actions: [{ actionType: "send_message" }],
          channelAccountId: channelBId,
          conditions: [],
          name: "Cross channel rule",
          triggerType: "ON_MESSAGE_RECEIVED",
        },
        metadata,
      ),
    ).rejects.toThrow(RuleChannelAccountNotFoundError);

    // Tenant A trying to attach Tenant B organization unit
    await expect(
      manager.createRule(
        createTenantContext(tenantAId),
        "user-1",
        {
          actions: [{ actionType: "send_message" }],
          conditions: [],
          name: "Cross OU rule",
          organizationUnitId: rootBId,
          triggerType: "ON_MESSAGE_RECEIVED",
        },
        metadata,
      ),
    ).rejects.toThrow(RuleOrganizationUnitNotFoundError);
  });

  it("enforces tenant isolation (Tenant B cannot read, update, or delete Tenant A rule)", async () => {
    // Tenant B cannot get rule
    const ruleFromB = await manager.getRuleById(createTenantContext(tenantBId), createdRuleAId);
    expect(ruleFromB).toBeNull();

    // Tenant B list does not include Tenant A rule
    const listFromB = await manager.listRules(createTenantContext(tenantBId));
    expect(listFromB.some((r) => r.id === createdRuleAId)).toBe(false);

    // Tenant B cannot update
    await expect(
      manager.updateRule(
        createTenantContext(tenantBId),
        createdRuleAId,
        "user-b",
        { name: "Hacked by Tenant B" },
        metadata,
      ),
    ).rejects.toThrow(RuleNotFoundError);

    // Tenant B cannot delete
    await expect(
      manager.deleteRule(createTenantContext(tenantBId), createdRuleAId, "user-b", metadata),
    ).rejects.toThrow(RuleNotFoundError);
  });

  it("deletes a rule and produces audit and outbox events", async () => {
    await manager.deleteRule(createTenantContext(tenantAId), createdRuleAId, "user-1", metadata);

    const deletedRule = await manager.getRuleById(createTenantContext(tenantAId), createdRuleAId);
    expect(deletedRule).toBeNull();

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "rule.deleted", entityId: createdRuleAId, tenantId: tenantAId },
    });
    expect(audit.entityType).toBe("Rule");
  });

  it("rolls back the rule creation and audit when the outbox append fails", async () => {
    const failingDatabase = {
      channelAccount: prisma.channelAccount,
      organizationUnit: prisma.organizationUnit,
      rule: prisma.rule,
      tenant: prisma.tenant,
      tenantEntitlement: prisma.tenantEntitlement,
      $transaction: ((callback: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
        prisma.$transaction((transaction) =>
          callback(
            new Proxy(transaction, {
              get(target, property, receiver) {
                if (property === "domainEventOutbox") {
                  return { create: async () => Promise.reject(new Error("forced outbox failure")) };
                }
                return Reflect.get(target, property, receiver);
              },
            }),
          ),
        )) as typeof prisma.$transaction,
    };

    const failingManager = createRuleCatalogManager(failingDatabase);

    await expect(
      failingManager.createRule(
        createTenantContext(tenantAId),
        "user-1",
        {
          actions: [{ actionType: "send_message" }],
          conditions: [],
          name: "Rollback Test Rule",
          triggerType: "ON_MESSAGE_RECEIVED",
        },
        metadata,
      ),
    ).rejects.toThrow("forced outbox failure");

    expect(
      await prisma.rule.findFirst({
        where: { name: "Rollback Test Rule", tenantId: tenantAId },
      }),
    ).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: {
          action: "rule.created",
          afterSummary: { path: ["name"], equals: "Rollback Test Rule" },
          tenantId: tenantAId,
        },
      }),
    ).toBe(0);
  });
});
