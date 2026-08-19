import { createHmac } from "node:crypto";
import { loadNonSecretConfig } from "@whatsapp-platform/config";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  type PlatformTenantModuleKey,
  type PrismaClient,
  syncPermissionCatalog,
} from "@whatsapp-platform/database/platform";
import { createMessagingCredentialCipher } from "@whatsapp-platform/messaging";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "./app";

const prefix = "e05-s02-inbound-api";
const credentialKey = "07".repeat(32);
const webhookSecret = "webhook-secret";
const verifyToken = "verify-token";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl = "";
let tenantAId = "";
let tenantWithoutMessagingId = "";
let channelAId = "";
let inactiveChannelId = "";
let disabledChannelId = "";

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
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

async function provision(
  marker: string,
  enabledModules: readonly PlatformTenantModuleKey[],
): Promise<string> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Inbound API ${marker}`,
    enabledModules,
    legalName: `Inbound API ${marker} SA`,
    limits: {
      channelAccounts: 4,
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

function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, init);
}

function signedHeaders(body: string): Record<string, string> {
  const signature = createHmac("sha256", webhookSecret).update(body).digest("hex");
  return {
    "content-type": "application/json",
    "x-signature": `sha256=${signature}`,
  };
}

describe.sequential("E05-S02 inbound webhook API", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient({
      databaseUrl: process.env.DATABASE_URL ?? "",
    });
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    [tenantAId, tenantWithoutMessagingId] = await Promise.all([
      provision("a", ["module.messaging.basic"]),
      provision("disabled", []),
    ]);

    const cipher = createMessagingCredentialCipher(
      new Uint8Array(Buffer.from(credentialKey, "hex")),
    );
    const credentialsCiphertext = cipher.encrypt({ verifyToken, webhookSecret });
    const [channelA, inactiveChannel, disabledChannel] = await Promise.all([
      prisma.channelAccount.create({
        data: {
          active: true,
          credentialsCiphertext,
          displayName: "Webhook A",
          providerType: "mock",
          status: "connected",
          tenantId: tenantAId,
        },
      }),
      prisma.channelAccount.create({
        data: {
          active: false,
          credentialsCiphertext,
          displayName: "Webhook inactive",
          providerType: "mock",
          status: "archived",
          tenantId: tenantAId,
        },
      }),
      prisma.channelAccount.create({
        data: {
          active: true,
          credentialsCiphertext,
          displayName: "Webhook disabled",
          providerType: "mock",
          status: "connected",
          tenantId: tenantWithoutMessagingId,
        },
      }),
    ]);
    channelAId = channelA.id;
    inactiveChannelId = inactiveChannel.id;
    disabledChannelId = disabledChannel.id;
    app = await createApiApplication(loadNonSecretConfig({ NODE_ENV: "test" }), {
      messagingCredentialsKey: credentialKey,
    });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await prisma?.$disconnect();
  });

  it("answers the Meta verification handshake and rejects invalid tokens", async () => {
    const valid = await request(
      `/api/v1/webhooks/whatsapp/${channelAId}?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=challenge-123`,
    );
    expect(valid.status).toBe(200);
    expect(valid.headers.get("content-type")).toContain("text/plain");
    expect(await valid.text()).toBe("challenge-123");

    const invalid = await request(
      `/api/v1/webhooks/whatsapp/${channelAId}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123`,
    );
    expect(invalid.status).toBe(403);
  });

  it("validates the raw-body signature before persisting inbound events", async () => {
    const payload = JSON.stringify({
      from: "+5215512345678",
      id: "api-message-1",
      text: "hola API",
      timestamp: 1_724_000_000,
    });
    const invalid = await request(`/api/v1/webhooks/whatsapp/${channelAId}`, {
      body: payload,
      headers: { "content-type": "application/json", "x-signature": "sha256=bad" },
      method: "POST",
    });
    expect(invalid.status).toBe(401);
    await expect(
      prisma.inboundMessageEvent.count({ where: { providerMessageId: "api-message-1" } }),
    ).resolves.toBe(0);

    const accepted = await request(`/api/v1/webhooks/whatsapp/${channelAId}`, {
      body: payload,
      headers: signedHeaders(payload),
      method: "POST",
    });
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toMatchObject({ status: "accepted", success: true });
    await expect(
      prisma.inboundMessageEvent.findFirstOrThrow({
        where: { channelAccountId: channelAId, providerMessageId: "api-message-1" },
      }),
    ).resolves.toMatchObject({
      eventType: "MESSAGE_RECEIVED",
      messageType: "text",
      senderPhone: "+5215512345678",
      tenantId: tenantAId,
    });
  });

  it("ACKs duplicate provider messages without duplicating persistence or outbox work", async () => {
    const payload = JSON.stringify({
      from: "+5215512345678",
      id: "api-message-1",
      text: "reintento",
    });
    const response = await request(`/api/v1/webhooks/whatsapp/${channelAId}`, {
      body: payload,
      headers: signedHeaders(payload),
      method: "POST",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "duplicate_ignored",
      success: true,
    });
    await expect(
      prisma.inboundMessageEvent.count({
        where: { channelAccountId: channelAId, providerMessageId: "api-message-1" },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.domainEventOutbox.count({
        where: {
          eventType: "messaging.inbound.event_received",
          aggregateType: "InboundMessageEvent",
        },
      }),
    ).resolves.toBe(1);
  });

  it("fails closed for inactive, unknown, and non-entitled channels and supports the mock route", async () => {
    const body = JSON.stringify({ from: "+5215512345678", id: "mock-route-1", text: "mock" });
    await expect(
      request(`/api/v1/webhooks/whatsapp/${inactiveChannelId}`, {
        body,
        headers: signedHeaders(body),
        method: "POST",
      }),
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      request("/api/v1/webhooks/whatsapp/019c0000-0000-7000-8000-000000000099", {
        body,
        headers: signedHeaders(body),
        method: "POST",
      }),
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      request(`/api/v1/webhooks/whatsapp/${disabledChannelId}`, {
        body,
        headers: signedHeaders(body),
        method: "POST",
      }),
    ).resolves.toMatchObject({ status: 403 });

    const mockResponse = await request(`/api/v1/webhooks/whatsapp/mock/${channelAId}`, {
      body,
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(mockResponse.status).toBe(200);
    await expect(mockResponse.json()).resolves.toMatchObject({ status: "accepted", success: true });
  });
});
