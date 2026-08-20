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

const prefix = "e06-s01-contact-api";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl = "";
let tenantAId = "";
let tenantBId = "";
let ownerAId = "";
let ownerBId = "";
let ownerACookie = "";
let ownerBCookie = "";
let contactAId = "";

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

async function provision(marker: string): Promise<{ ownerId: string; tenantId: string }> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Contacts API ${marker}`,
    enabledModules: [],
    legalName: `Contacts API ${marker} SA`,
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
): Promise<Response> {
  return request(path, cookie, { body: JSON.stringify(body), method });
}

describe.sequential("E06-S01 contacts API", () => {
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
    app = await createApiApplication(loadNonSecretConfig({ NODE_ENV: "test" }));
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await prisma?.$disconnect();
  });

  it("creates contacts with normalized E.164 phone and returns 409 on duplicate", async () => {
    const created = await jsonRequest("/api/v1/contacts", ownerACookie, "POST", {
      email: "person@example.com",
      name: "Persona API",
      phoneNumber: "+5215512345678",
      tags: ["lead"],
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string; phoneNumber: string; status: string };
    contactAId = body.id;
    expect(body).toMatchObject({ phoneNumber: "+525512345678", status: "ACTIVE" });
    const duplicate = await jsonRequest("/api/v1/contacts", ownerACookie, "POST", {
      phoneNumber: "55 1234 5678",
    });
    expect(duplicate.status).toBe(409);
  });

  it("lists by search/tag, updates tags and archives with DELETE", async () => {
    const list = await request("/api/v1/contacts?search=persona&tag=lead", ownerACookie);
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: contactAId })],
    });
    const updated = await jsonRequest(`/api/v1/contacts/${contactAId}`, ownerACookie, "PATCH", {
      tags: ["customer", "vip"],
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      status: "ACTIVE",
      tags: ["customer", "vip"],
    });
    const archived = await request(`/api/v1/contacts/${contactAId}`, ownerACookie, {
      method: "DELETE",
    });
    expect(archived.status).toBe(200);
    await expect(archived.json()).resolves.toMatchObject({ id: contactAId, status: "ARCHIVED" });
  });

  it("rejects malformed phones and cross-tenant access with 400/404", async () => {
    const invalid = await jsonRequest("/api/v1/contacts", ownerACookie, "POST", {
      phoneNumber: "abc-not-a-phone",
    });
    const crossTenantGet = await request(`/api/v1/contacts/${contactAId}`, ownerBCookie);
    const crossTenantPatch = await jsonRequest(
      `/api/v1/contacts/${contactAId}`,
      ownerBCookie,
      "PATCH",
      {
        name: "Escape",
      },
    );
    expect(invalid.status).toBe(400);
    expect(crossTenantGet.status).toBe(404);
    expect(crossTenantPatch.status).toBe(404);
    expect(tenantAId).not.toBe(tenantBId);
  });
});
