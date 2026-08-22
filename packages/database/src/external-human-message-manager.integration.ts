import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ModuleEntitlementKey } from "./entitlement-catalog";
import {
  createExternalHumanMessageManager,
  ExternalHumanMessageEventNotFoundError,
  type ExternalHumanMessageInput,
  type ExternalHumanMessageManager,
} from "./external-human-message-manager";
import type { PrismaClient } from "./generated/prisma/client";
import {
  createInboundEventDispatcher,
  type InboundEventDispatcher,
} from "./inbound-event-dispatcher";
import { createInboundEventManager, type InboundEventManager } from "./inbound-event-manager";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  syncPermissionCatalog,
} from "./platform";
import { createTenantContext } from "./tenant-context";
import type { TenantModuleEntitlementRequiredError } from "./tenant-entitlements";
import { TenantNotOperationalError } from "./tenant-operational";

const prefix = "e06-s06-external-human";
let prisma: PrismaClient;
let inboundEvents: InboundEventManager;
let externalHumans: ExternalHumanMessageManager;
let dispatcher: InboundEventDispatcher;
let tenantAId = "";
let tenantBId = "";
let tenantWithoutCrmId = "";
let channelAId = "";
let channelWithoutCrmId = "";

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

async function provision(
  marker: string,
  enabledModules: readonly ModuleEntitlementKey[],
): Promise<string> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `External human ${marker}`,
    enabledModules,
    legalName: `External human ${marker} SA`,
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

async function recordExternalEvent(
  tenantId: string,
  channelAccountId: string,
  providerMessageId: string,
  recipientPhone = "+5215512345678",
): Promise<{ event: Awaited<ReturnType<InboundEventManager["recordInboundEvent"]>>["event"] }> {
  return inboundEvents.recordInboundEvent(createTenantContext(tenantId), {
    channelAccountId,
    eventType: "MESSAGE_RECEIVED",
    messageType: "text",
    normalizedData: {
      fromMe: true,
      origin: "human_external_device",
      providerTimestamp: "2026-08-21T12:00:00.000Z",
      textBody: "mensaje escrito desde el teléfono",
    },
    payload: { body: "mensaje escrito desde el teléfono", fromMe: true },
    providerMessageId,
    recipientPhone,
    senderPhone: "+5215511111111",
  });
}

function inputFor(
  event: Awaited<ReturnType<InboundEventManager["recordInboundEvent"]>>["event"],
  channelAccountId: string,
): ExternalHumanMessageInput {
  return {
    channelAccountId,
    inboundEventId: event.id,
    providerMessageId: event.providerMessageId ?? "",
    providerTimestamp: new Date("2026-08-21T12:00:00.000Z"),
    recipientPhone: event.recipientPhone,
    structuredPayload: { source: "phone" },
    textBody: "mensaje escrito desde el teléfono",
  };
}

describe.sequential("E06-S06 external human message detection", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    [tenantAId, tenantBId, tenantWithoutCrmId] = await Promise.all([
      provision("a", ["module.messaging.basic", "module.crm_lite"]),
      provision("b", ["module.messaging.basic", "module.crm_lite"]),
      provision("without-crm", ["module.messaging.basic"]),
    ]);
    const [channelA, channelWithoutCrm] = await Promise.all([
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "External human A",
          providerType: "mock",
          status: "connected",
          tenantId: tenantAId,
        },
      }),
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "External human without CRM",
          providerType: "mock",
          status: "connected",
          tenantId: tenantWithoutCrmId,
        },
      }),
    ]);
    channelAId = channelA.id;
    channelWithoutCrmId = channelWithoutCrm.id;
    inboundEvents = createInboundEventManager(prisma);
    externalHumans = createExternalHumanMessageManager(prisma);
    dispatcher = createInboundEventDispatcher(prisma);
  });

  afterAll(async () => {
    await cleanup();
    await prisma?.$disconnect();
  });

  it("persists the canonical external message, contact, conversation projection and outbox atomically", async () => {
    const recorded = await recordExternalEvent(tenantAId, channelAId, "provider-external-human-1");
    const input = inputFor(recorded.event, channelAId);
    const result = await externalHumans.reconcileExternalHumanMessage(
      createTenantContext(tenantAId),
      input,
    );

    expect(result).toMatchObject({
      conversationId: expect.any(String),
      duplicate: false,
      message: {
        actorId: null,
        actorType: "external_human_unknown",
        deliveryStatus: "sent",
        direction: "outbound",
        inboundEventId: recorded.event.id,
        origin: "human_external_device",
        providerMessageId: "provider-external-human-1",
        providerTimestamp: new Date("2026-08-21T12:00:00.000Z"),
        structuredPayload: { source: "phone" },
        tenantId: tenantAId,
        textBody: "mensaje escrito desde el teléfono",
      },
    });
    const contact = await prisma.contact.findUniqueOrThrow({
      where: { tenantId_phoneNumber: { phoneNumber: "+525512345678", tenantId: tenantAId } },
    });
    expect(contact.name).toBe("Sin Nombre");
    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: result.conversationId } }),
    ).resolves.toMatchObject({
      contactId: contact.id,
      lastHumanMessageAt: new Date("2026-08-21T12:00:00.000Z"),
      lastMessageAt: new Date("2026-08-21T12:00:00.000Z"),
      lastOutboundAt: new Date("2026-08-21T12:00:00.000Z"),
      status: "open",
      tenantId: tenantAId,
    });
    await expect(
      prisma.inboundMessageEvent.findUniqueOrThrow({ where: { id: recorded.event.id } }),
    ).resolves.toMatchObject({ processedStatus: "PROCESSED", tenantId: tenantAId });
    await expect(
      prisma.domainEventOutbox.count({
        where: {
          aggregateId: result.message.id,
          eventType: "message.external_human_detected",
          tenantId: tenantAId,
        },
      }),
    ).resolves.toBe(1);

    await expect(
      externalHumans.reconcileExternalHumanMessage(createTenantContext(tenantAId), input),
    ).resolves.toMatchObject({ duplicate: true, message: { id: result.message.id } });
    await expect(
      prisma.domainEventOutbox.count({
        where: { eventType: "message.external_human_detected", tenantId: tenantAId },
      }),
    ).resolves.toBe(1);
  });

  it("dispatches unmatched fromMe through E06-S05 first and then the external-human fallback", async () => {
    const recorded = await recordExternalEvent(
      tenantAId,
      channelAId,
      "provider-external-human-dispatcher-1",
    );
    await expect(
      dispatcher.dispatch(createTenantContext(tenantAId), { inboundEventId: recorded.event.id }),
    ).resolves.toMatchObject({
      kind: "external_human",
      result: { duplicate: false, message: { origin: "human_external_device" } },
    });
  });

  it("fails closed for tenant isolation", async () => {
    const recorded = await recordExternalEvent(
      tenantAId,
      channelAId,
      "provider-external-human-isolation-1",
    );
    await expect(
      externalHumans.reconcileExternalHumanMessage(
        createTenantContext(tenantBId),
        inputFor(recorded.event, channelAId),
      ),
    ).rejects.toBeInstanceOf(ExternalHumanMessageEventNotFoundError);
    await expect(
      prisma.inboundMessageEvent.findUniqueOrThrow({ where: { id: recorded.event.id } }),
    ).resolves.toMatchObject({ processedStatus: "PENDING", tenantId: tenantAId });
  });

  it("rejects suspended tenants without mutating the source event", async () => {
    const recorded = await recordExternalEvent(
      tenantAId,
      channelAId,
      "provider-external-human-suspended-1",
    );
    await prisma.tenant.update({ data: { status: "suspended" }, where: { id: tenantAId } });
    try {
      await expect(
        externalHumans.reconcileExternalHumanMessage(
          createTenantContext(tenantAId),
          inputFor(recorded.event, channelAId),
        ),
      ).rejects.toBeInstanceOf(TenantNotOperationalError);
    } finally {
      await prisma.tenant.update({ data: { status: "active" }, where: { id: tenantAId } });
    }
    await expect(
      prisma.inboundMessageEvent.findUniqueOrThrow({ where: { id: recorded.event.id } }),
    ).resolves.toMatchObject({ processedStatus: "PENDING" });
  });

  it("requires CRM Lite entitlement", async () => {
    const recorded = await recordExternalEvent(
      tenantWithoutCrmId,
      channelWithoutCrmId,
      "provider-external-human-without-crm-1",
    );
    await expect(
      externalHumans.reconcileExternalHumanMessage(
        createTenantContext(tenantWithoutCrmId),
        inputFor(recorded.event, channelWithoutCrmId),
      ),
    ).rejects.toMatchObject({
      moduleKey: "module.crm_lite",
      name: "TenantModuleEntitlementRequiredError",
    } satisfies Partial<TenantModuleEntitlementRequiredError>);
    await expect(
      prisma.inboundMessageEvent.findUniqueOrThrow({ where: { id: recorded.event.id } }),
    ).resolves.toMatchObject({ processedStatus: "PENDING" });
  });
});
