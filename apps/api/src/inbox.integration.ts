import { generateOpaqueToken, hashOpaqueToken } from "@whatsapp-platform/auth";
import { loadNonSecretConfig } from "@whatsapp-platform/config";
import type { ModuleEntitlementKey } from "@whatsapp-platform/database";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  type PrismaClient,
  syncPermissionCatalog,
} from "@whatsapp-platform/database/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "./app";

const prefix = "e07-s01-inbox-api";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl = "";
let tenantAId = "";
let tenantBId = "";
let tenantWithoutCrmId = "";
let ownerAId = "";
let ownerBId = "";
let ownerWithoutCrmId = "";
let ownerACookie = "";
let ownerBCookie = "";
let ownerWithoutCrmCookie = "";
let conversationAId = "";
let conversationBId = "";

function binary(value: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

async function session(tenantId: string, userId: string): Promise<string> {
  const token = generateOpaqueToken();
  await prisma.userSession.create({
    data: {
      expiresAt: new Date(Date.now() + 3_600_000),
      tenantId,
      tokenHash: binary(hashOpaqueToken(token)),
      userId,
    },
  });
  return `tenant_session=${token}`;
}

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  if (ids.length === 0) return;
  await prisma.message.deleteMany({ where: { tenantId: { in: ids } } });
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

async function provision(marker: string, enabledModules: readonly ModuleEntitlementKey[]) {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Inbox API ${marker}`,
    enabledModules,
    legalName: `Inbox API ${marker} SA`,
    limits: {
      channelAccounts: 2,
      monthlyAiBudget: null,
      organizationUnits: 3,
      storageBytes: 1_073_741_824,
      users: 5,
    },
    owner: {
      displayName: `Inbox API Owner ${marker}`,
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

function request(path: string, cookie?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: cookie === undefined ? {} : { Cookie: cookie },
  });
}

describe.sequential("E07-S01 inbox API", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient({ databaseUrl: process.env.DATABASE_URL ?? "" });
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
    ownerBId = tenantB.ownerId;
    ownerWithoutCrmId = tenantWithoutCrm.ownerId;
    [ownerACookie, ownerBCookie, ownerWithoutCrmCookie] = await Promise.all([
      session(tenantAId, ownerAId),
      session(tenantBId, ownerBId),
      session(tenantWithoutCrmId, ownerWithoutCrmId),
    ]);
    const [channelA, channelB] = await Promise.all([
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "Inbox API Channel A",
          providerType: "mock",
          status: "connected",
          tenantId: tenantAId,
        },
      }),
      prisma.channelAccount.create({
        data: {
          active: true,
          displayName: "Inbox API Channel B",
          providerType: "mock",
          status: "connected",
          tenantId: tenantBId,
        },
      }),
    ]);
    const [contactA, contactB] = await Promise.all([
      prisma.contact.create({
        data: { name: "API Contact A", phoneNumber: "+525566666666", tenantId: tenantAId },
      }),
      prisma.contact.create({
        data: { name: "API Contact B", phoneNumber: "+525577777777", tenantId: tenantBId },
      }),
    ]);
    await Promise.all([
      prisma.channelAccount.update({
        data: { phoneNumber: "+525500000002" },
        where: { id: channelA.id, tenantId: tenantAId },
      }),
      prisma.contact.update({
        data: {
          avatarUrl: "https://cdn.example.invalid/api-contact-a.png",
          customAttributes: { source: "api-integration" },
          email: "api-contact-a@example.invalid",
          tags: ["api", "priority"],
        },
        where: { id: contactA.id, tenantId: tenantAId },
      }),
    ]);
    const unitA = await prisma.organizationUnit.create({
      data: { name: "Inbox API Unit A", tenantId: tenantAId, type: "department" },
    });
    const [conversationA] = await Promise.all([
      prisma.conversation.create({
        data: {
          assignedUnitId: unitA.id,
          assignedUserId: ownerAId,
          channelAccountId: channelA.id,
          contactId: contactA.id,
          lastInboundAt: new Date("2026-08-21T12:00:00.000Z"),
          lastMessageAt: new Date("2026-08-21T12:00:00.000Z"),
          status: "open",
          tenantId: tenantAId,
        },
      }),
      prisma.conversation.create({
        data: {
          channelAccountId: channelA.id,
          contactId: contactA.id,
          lastMessageAt: new Date("2026-08-21T11:00:00.000Z"),
          status: "open",
          tenantId: tenantAId,
        },
      }),
      prisma.conversation.create({
        data: {
          channelAccountId: channelB.id,
          contactId: contactB.id,
          lastMessageAt: new Date("2026-08-21T13:00:00.000Z"),
          status: "open",
          tenantId: tenantBId,
        },
      }),
    ]);
    conversationAId = conversationA.id;
    conversationBId = (
      await prisma.conversation.findFirstOrThrow({
        select: { id: true },
        where: { channelAccountId: channelB.id, tenantId: tenantBId },
      })
    ).id;
    await prisma.message.createMany({
      data: [
        {
          actorId: contactA.id,
          actorType: "contact",
          channelAccountId: channelA.id,
          conversationId: conversationAId,
          createdAt: new Date("2026-08-21T10:00:00.000Z"),
          direction: "inbound",
          messageType: "text",
          origin: "customer",
          providerTimestamp: new Date("2026-08-21T10:00:00.000Z"),
          tenantId: tenantAId,
          textBody: "api first message",
        },
        {
          actorId: ownerAId,
          actorType: "tenant_user",
          channelAccountId: channelA.id,
          conversationId: conversationAId,
          createdAt: new Date("2026-08-21T10:01:00.000Z"),
          direction: "outbound",
          messageType: "image",
          origin: "human_app",
          providerTimestamp: new Date("2026-08-21T10:01:00.000Z"),
          structuredPayload: { mediaId: "api-media-1", mimeType: "image/png" },
          tenantId: tenantAId,
          textBody: "api image",
        },
        {
          actorId: null,
          actorType: "external_human_unknown",
          channelAccountId: channelA.id,
          conversationId: conversationAId,
          createdAt: new Date("2026-08-21T10:02:00.000Z"),
          direction: "outbound",
          messageType: "text",
          origin: "human_external_device",
          providerTimestamp: new Date("2026-08-21T10:02:00.000Z"),
          tenantId: tenantAId,
          textBody: "api external echo",
        },
      ],
    });
    app = await createApiApplication(loadNonSecretConfig({ NODE_ENV: "test" }));
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await prisma?.$disconnect();
  });

  it("returns a tenant-scoped list projection and next cursor", async () => {
    expect((await request("/auth/me", ownerACookie)).status).toBe(200);
    const response = await request(
      "/api/v1/inbox/conversations?status=active&limit=1",
      ownerACookie,
    );
    if (response.status !== 200) {
      throw new Error(`Inbox list returned ${response.status}: ${await response.text()}`);
    }
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["items", "nextCursor", "totalActive"]);
    expect(body).toMatchObject({ nextCursor: expect.any(String), totalActive: 2 });
    expect(body.items).toEqual([
      expect.objectContaining({
        contact: expect.objectContaining({ name: "API Contact A" }),
        id: conversationAId,
        unread: true,
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain(tenantAId);
  });

  it("returns conversation detail and a bidirectional message timeline without secrets", async () => {
    const detail = await request(`/api/v1/inbox/conversations/${conversationAId}`, ownerACookie);
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as Record<string, unknown>;
    expect(detailBody).toMatchObject({
      assignedUnit: { name: "Inbox API Unit A" },
      assignedUser: { email: expect.stringContaining("e07-s01-inbox-api-owner-a") },
      channelAccount: {
        id: expect.any(String),
        name: "Inbox API Channel A",
        phoneNumber: "+525500000002",
      },
      contact: {
        customAttributes: { source: "api-integration" },
        email: "api-contact-a@example.invalid",
        tags: ["api", "priority"],
      },
      id: conversationAId,
    });
    expect(JSON.stringify(detailBody)).not.toContain("tenantId");
    expect(JSON.stringify(detailBody)).not.toContain("credentialsCiphertext");
    expect(JSON.stringify(detailBody)).not.toContain("webhookSecret");

    const first = await request(
      `/api/v1/inbox/conversations/${conversationAId}/messages?limit=2`,
      ownerACookie,
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as Record<string, unknown>;
    expect(firstBody.items).toEqual([
      expect.objectContaining({ origin: "human_external_device", textBody: "api external echo" }),
      expect.objectContaining({
        textBody: "api image",
        structuredPayload: { mediaId: "api-media-1", mimeType: "image/png" },
      }),
    ]);
    expect(firstBody).toMatchObject({ nextCursor: expect.any(String), prevCursor: null });

    const cursor = firstBody.nextCursor;
    if (typeof cursor !== "string") throw new Error("Missing message cursor");
    const second = await request(
      `/api/v1/inbox/conversations/${conversationAId}/messages?cursor=${cursor}&direction=before&limit=2`,
      ownerACookie,
    );
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ origin: "customer", textBody: "api first message" })],
      nextCursor: null,
      prevCursor: expect.any(String),
    });

    const progressive = await request(
      `/api/v1/inbox/conversations/${conversationAId}/messages?direction=after&limit=2`,
      ownerACookie,
    );
    expect(progressive.status).toBe(200);
    await expect(progressive.json()).resolves.toMatchObject({
      items: [
        expect.objectContaining({ origin: "customer", textBody: "api first message" }),
        expect.objectContaining({ textBody: "api image" }),
      ],
      nextCursor: expect.any(String),
      prevCursor: null,
    });

    expect(
      (await request(`/api/v1/inbox/conversations/${conversationAId}`, ownerBCookie)).status,
    ).toBe(404);
    expect(
      (await request(`/api/v1/inbox/conversations/${conversationAId}/messages`, ownerBCookie))
        .status,
    ).toBe(404);
    expect(
      (await request(`/api/v1/inbox/conversations/${conversationBId}`, ownerACookie)).status,
    ).toBe(404);
  });

  it("supports search and fails closed for missing RBAC or entitlement", async () => {
    const search = await request("/api/v1/inbox/conversations?search=contact%20a", ownerACookie);
    expect(search.status).toBe(200);
    await expect(search.json()).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: conversationAId })]),
    });

    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key: "conversations.read" },
    });
    const ownerRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { key: "owner", tenantId: tenantAId } },
    });
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { permissionId: permission.id, roleId: ownerRole.id } },
    });
    expect((await request("/api/v1/inbox/conversations", ownerACookie)).status).toBe(403);
    expect((await request("/api/v1/inbox/conversations", ownerWithoutCrmCookie)).status).toBe(403);
  });

  it("derives tenant from session for the second tenant", async () => {
    const response = await request("/api/v1/inbox/conversations", ownerBCookie);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [
        expect.objectContaining({ contact: expect.objectContaining({ name: "API Contact B" }) }),
      ],
    });
  });
});
