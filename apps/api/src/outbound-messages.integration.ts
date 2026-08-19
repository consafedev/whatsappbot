import { generateOpaqueToken, hashOpaqueToken } from "@whatsapp-platform/auth";
import { loadNonSecretConfig } from "@whatsapp-platform/config";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  type PrismaClient,
  syncPermissionCatalog,
} from "@whatsapp-platform/database/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "./app";

const prefix = "e05-s03-outbound-api";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl = "";
let tenantAId = "";
let tenantBId = "";
let ownerAId = "";
let ownerBId = "";
let ownerACookie = "";
let ownerBCookie = "";
let channelAId = "";
let messageAId = "";

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
  await prisma.outboundMessage.deleteMany({ where: { tenantId: { in: ids } } });
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
    displayName: `Outbound API ${marker}`,
    enabledModules: ["module.messaging.basic"],
    legalName: `Outbound API ${marker} SA`,
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

function request(path: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      cookie,
      ...init.headers,
    },
  });
}

function jsonRequest(
  path: string,
  cookie: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return request(path, cookie, {
    body: JSON.stringify(body),
    headers,
    method,
  });
}

describe.sequential("E05-S03 outbound message API", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient({ databaseUrl: process.env.DATABASE_URL ?? "" });
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    const [a, b] = await Promise.all([provision("a"), provision("b")]);
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
    ownerAId = a.ownerId;
    ownerBId = b.ownerId;
    ownerACookie = await session(tenantAId, ownerAId);
    ownerBCookie = await session(tenantBId, ownerBId);
    const channel = await prisma.channelAccount.create({
      data: {
        active: true,
        displayName: "Outbound API A",
        providerType: "mock",
        status: "connected",
        tenantId: tenantAId,
      },
    });
    channelAId = channel.id;
    app = await createApiApplication(loadNonSecretConfig({ NODE_ENV: "test" }));
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await prisma?.$disconnect();
  });

  it("returns 202, persists PENDING, and exposes tenant-scoped status", async () => {
    const created = await jsonRequest(
      `/api/v1/channels/${channelAId}/messages`,
      ownerACookie,
      "POST",
      {
        content: { text: "hola desde API" },
        messageType: "text",
        recipientPhone: "+52 155 1234 5678",
      },
      { "idempotency-key": "e05-s03-api-message-1" },
    );
    expect(created.status).toBe(202);
    const createdBody = (await created.json()) as { messageId: string; status: string };
    messageAId = createdBody.messageId;
    expect(createdBody.status).toBe("PENDING");
    await expect(
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: messageAId } }),
    ).resolves.toMatchObject({
      actorUserId: ownerAId,
      recipientPhone: "+5215512345678",
      status: "PENDING",
      tenantId: tenantAId,
    });

    const state = await request(
      `/api/v1/channels/${channelAId}/messages/${messageAId}`,
      ownerACookie,
    );
    expect(state.status).toBe(200);
    await expect(state.json()).resolves.toMatchObject({ messageId: messageAId, status: "PENDING" });
  });

  it("rejects invalid phone and empty payload with 400", async () => {
    const invalidPhone = await jsonRequest(
      `/api/v1/channels/${channelAId}/messages`,
      ownerACookie,
      "POST",
      { content: { text: "no" }, messageType: "text", recipientPhone: "not-a-phone" },
    );
    const empty = await jsonRequest(
      `/api/v1/channels/${channelAId}/messages`,
      ownerACookie,
      "POST",
      {},
    );
    expect(invalidPhone.status).toBe(400);
    expect(empty.status).toBe(400);
  });

  it("returns 404 for cross-tenant enqueue and status queries", async () => {
    const enqueue = await jsonRequest(
      `/api/v1/channels/${channelAId}/messages`,
      ownerBCookie,
      "POST",
      {
        content: { text: "no cross tenant" },
        messageType: "text",
        recipientPhone: "+5215512345678",
      },
    );
    const state = await request(
      `/api/v1/channels/${channelAId}/messages/${messageAId}`,
      ownerBCookie,
    );
    expect(enqueue.status).toBe(404);
    expect(state.status).toBe(404);
  });
});
