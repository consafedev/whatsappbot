import {
  generateOpaqueToken,
  hashOpaqueToken,
  PlatformPasswordHasher,
} from "@whatsapp-platform/auth";
import { loadNonSecretConfig } from "@whatsapp-platform/config";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  type PrismaClient,
  syncPermissionCatalog,
} from "@whatsapp-platform/database/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "./app";

const prefix = "e05-s01-channel-api";
const password = "e05-s01-api-password";
const credentialKey = "07".repeat(32);
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

async function provision(marker: string): Promise<{ tenantId: string; ownerId: string }> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Channels API ${marker}`,
    enabledModules: ["module.messaging.basic"],
    legalName: `Channels API ${marker} SA`,
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
      passwordHash: await new PlatformPasswordHasher().hash(password),
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
): Promise<Response> {
  return request(path, cookie, { body: JSON.stringify(body), method });
}

describe.sequential("E05-S01 tenant channels API", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
    prisma = createPlatformDatabaseClient({ databaseUrl });
    await cleanup();
    await syncPermissionCatalog(prisma);
    const [a, b] = await Promise.all([provision("a"), provision("b")]);
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
    ownerAId = a.ownerId;
    ownerBId = b.ownerId;
    ownerACookie = await session(tenantAId, ownerAId);
    ownerBCookie = await session(tenantBId, ownerBId);
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

  it("creates a channel, encrypts credentials, and tests the mock connection", async () => {
    const created = await jsonRequest("/api/v1/channels", ownerACookie, "POST", {
      credentials: { accessToken: "do-not-return" },
      name: "Línea Ventas",
      phoneNumber: "+52 155 1234 5678",
      providerType: "MOCK",
      settings: { autoReply: false },
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as Record<string, unknown>;
    channelAId = body.id as string;
    expect(body).toMatchObject({
      displayName: "Línea Ventas",
      isActive: true,
      name: "Línea Ventas",
      phoneNumber: "+5215512345678",
      providerType: "mock",
    });
    expect(body.credentialsConfigured).toBe(true);
    expect(JSON.stringify(body)).not.toContain("do-not-return");
    const stored = await prisma.channelAccount.findUniqueOrThrow({ where: { id: channelAId } });
    expect(stored.credentialsCiphertext).not.toBeNull();
    expect(stored.credentialsCiphertext).not.toContain("do-not-return");
    const health = await request(`/api/v1/channels/${channelAId}/test-connection`, ownerACookie, {
      method: "POST",
    });
    expect(health.status).toBe(201);
    expect(await health.json()).toMatchObject({ status: "OK" });
  });

  it("lists only the current tenant and rejects duplicate active phones", async () => {
    const listA = await request("/app/channels", ownerACookie);
    const listB = await request("/app/channels", ownerBCookie);
    expect(listA.status).toBe(200);
    expect(listB.status).toBe(200);
    expect(((await listA.json()) as { items: unknown[] }).items).toHaveLength(1);
    expect(((await listB.json()) as { items: unknown[] }).items).toHaveLength(0);
    const duplicate = await jsonRequest("/app/channels", ownerACookie, "POST", {
      phoneNumber: "+5215512345678",
      providerType: "mock",
      name: "Duplicado",
    });
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { code?: string }).code).toBe("CHANNEL_PHONE_CONFLICT");
  });

  it("returns 404 for Tenant B on every channel mutation/read", async () => {
    expect((await request(`/app/channels/${channelAId}`, ownerBCookie)).status).toBe(404);
    expect(
      (
        await jsonRequest(`/app/channels/${channelAId}`, ownerBCookie, "PATCH", {
          name: "cross-tenant",
        })
      ).status,
    ).toBe(404);
    expect(
      (await request(`/app/channels/${channelAId}`, ownerBCookie, { method: "DELETE" })).status,
    ).toBe(404);
  });

  it("supports update and soft delete without exposing raw credentials", async () => {
    const updated = await jsonRequest(`/app/channels/${channelAId}`, ownerACookie, "PATCH", {
      name: "Ventas actualizadas",
      status: "ACTIVE",
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ isActive: true, name: "Ventas actualizadas" });
    const archived = await request(`/app/channels/${channelAId}`, ownerACookie, {
      method: "DELETE",
    });
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({ isActive: false, status: "archived" });
    expect(
      (await prisma.channelAccount.findUniqueOrThrow({ where: { id: channelAId } })).active,
    ).toBe(false);
  });

  it("rejects malformed input and an unsupported real provider without pretending it is connected", async () => {
    expect((await jsonRequest("/app/channels", ownerAId, "POST", { name: "bad" })).status).not.toBe(
      201,
    );
    const created = await jsonRequest("/app/channels", ownerACookie, "POST", {
      name: "Future Provider",
      phoneNumber: "+5215512345688",
      providerType: "wppconnect",
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string };
    const health = await request(`/app/channels/${body.id}/test-connection`, ownerACookie, {
      method: "POST",
    });
    expect(health.status).toBe(409);
  });
});
