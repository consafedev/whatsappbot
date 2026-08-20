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

const prefix = "e04-s04-um-api";
const password = "tenant user management api password";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl = "";
let tenantAId = "";
let tenantBId = "";
let tenantASlug = "";
let ownerAId = "";
let ownerBId = "";
let ownerACookie = "";
let ownerBCookie = "";
let userACookie = "";
let rootAId = "";
let branchAId = "";
let roleAgentAId = "";
let roleOwnerAId = "";
let roleViewerAId = "";
let roleAgentBId = "";
let createdUserId = "";

function binary(value: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

async function session(tenantId: string, userId: string) {
  const token = generateOpaqueToken();
  const row = await prisma.userSession.create({
    data: {
      expiresAt: new Date(Date.now() + 3_600_000),
      tenantId,
      tokenHash: binary(hashOpaqueToken(token)),
      userId,
    },
  });
  return { cookie: `tenant_session=${token}`, id: row.id };
}

async function createUser(
  tenantId: string,
  marker: string,
  roleId: string | null,
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      displayName: `Usuario ${marker}`,
      email: `${prefix}-${marker}@example.invalid`,
      locale: "es-MX",
      passwordHash: await new PlatformPasswordHasher().hash(password),
      tenantId,
      timezone: "America/Mexico_City",
    },
  });
  if (roleId !== null) {
    await prisma.userRole.create({ data: { roleId, tenantId, userId: user.id } });
  }
  return user.id;
}

async function roleWithPermission(tenantId: string, key: string): Promise<string> {
  const role = await prisma.role.create({
    data: {
      key: `custom-${prefix}-${key.replaceAll(".", "-")}`,
      name: `Custom ${prefix} ${key}`,
      tenantId,
    },
  });
  const permission = await prisma.permission.findUnique({ where: { key } });
  if (permission !== null) {
    await prisma.rolePermission.create({
      data: { permissionId: permission.id, roleId: role.id },
    });
  }
  return role.id;
}

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
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

async function provisionTenant(marker: string): Promise<{
  ownerId: string;
  rootId: string;
  slug: string;
  tenantId: string;
  roleAgentId: string;
  roleOwnerId: string;
  roleViewerId: string;
}> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `User Management API ${marker}`,
    enabledModules: [],
    legalName: `User Management API ${marker} SA`,
    limits: {
      channelAccounts: 2,
      monthlyAiBudget: null,
      organizationUnits: 5,
      storageBytes: 1_073_741_824,
      users: 20,
    },
    owner: {
      displayName: `API Owner ${marker}`,
      email: `${prefix}-owner-${marker}@example.invalid`,
      locale: "es-MX",
      passwordHash: "$argon2id$not-plaintext-test-value",
      timezone: "America/Mexico_City",
    },
    requestId: `${prefix}-provision-${marker}`,
    slug: `${prefix}-${marker}`,
  });
  const roles = await prisma.role.findMany({ where: { tenantId: result.tenant.id } });
  const byName = Object.fromEntries(roles.map((role) => [role.name, role.id]));
  return {
    ownerId: result.owner.id,
    roleAgentId: requiredRoleId(byName, "Agent"),
    roleOwnerId: requiredRoleId(byName, "Owner"),
    roleViewerId: requiredRoleId(byName, "Viewer"),
    rootId: result.organizationRoot.id,
    slug: result.tenant.slug,
    tenantId: result.tenant.id,
  };
}

function get(
  path: string,
  cookie: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { cookie, ...headers } });
}

function post(
  path: string,
  cookie: string,
  body: unknown,
  requestId = `${prefix}-post`,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { cookie, "content-type": "application/json", "x-request-id": requestId },
    method: "POST",
  });
}

function patch(
  path: string,
  cookie: string,
  body: unknown,
  requestId = `${prefix}-patch`,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { cookie, "content-type": "application/json", "x-request-id": requestId },
    method: "PATCH",
  });
}

function put(
  path: string,
  cookie: string,
  body: unknown,
  requestId = `${prefix}-put`,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { cookie, "content-type": "application/json", "x-request-id": requestId },
    method: "PUT",
  });
}

function login(slug: string, email: string): Promise<Response> {
  return fetch(`${baseUrl}/auth/tenants/${slug}/login`, {
    body: JSON.stringify({ email, password }),
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    method: "POST",
  });
}

function cookieFrom(response: Response): string {
  const cookie = response.headers.get("set-cookie");
  if (cookie === null || !cookie.startsWith("tenant_session="))
    throw new Error("Expected tenant cookie");
  return cookie.split(";", 1)[0] ?? "";
}

function requiredRoleId(byName: Record<string, string>, name: string): string {
  const roleId = byName[name];
  if (roleId === undefined) throw new Error(`Missing ${name} role`);
  return roleId;
}

describe.sequential("E04-S04 tenant user management API", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
    prisma = createPlatformDatabaseClient({ databaseUrl });
    await cleanup();
    await syncPermissionCatalog(prisma);
    const a = await provisionTenant("a");
    const b = await provisionTenant("b");
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
    tenantASlug = a.slug;
    ownerAId = a.ownerId;
    ownerBId = b.ownerId;
    rootAId = a.rootId;
    roleAgentAId = a.roleAgentId;
    roleOwnerAId = a.roleOwnerId;
    roleViewerAId = a.roleViewerId;
    roleAgentBId = b.roleAgentId;
    const branch = await prisma.organizationUnit.create({
      data: {
        active: true,
        name: "León API",
        parentId: rootAId,
        tenantId: tenantAId,
        type: "branch",
      },
    });
    branchAId = branch.id;
    ownerACookie = (await session(tenantAId, ownerAId)).cookie;
    ownerBCookie = (await session(tenantBId, b.ownerId)).cookie;
    const customRole = await roleWithPermission(tenantAId, "tenant.settings.manage");
    userACookie = (await session(tenantAId, await createUser(tenantAId, "no-perm", customRole)))
      .cookie;
    app = await createApiApplication(loadNonSecretConfig());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await prisma?.$disconnect();
  });

  it("fails closed for missing and revoked sessions and ignores hostile headers", async () => {
    expect((await get("/app/users", "")).status).toBe(401);
    expect((await get("/app/users", "platform_session=not-a-tenant-session")).status).toBe(401);
    const revoked = await session(tenantAId, ownerAId);
    await prisma.userSession.update({ data: { revokedAt: new Date() }, where: { id: revoked.id } });
    expect((await get("/app/users", revoked.cookie)).status).toBe(401);
    const hostile = await get("/app/users", ownerACookie, {
      "x-tenant-id": tenantBId,
      "x-workspace-id": tenantBId,
      "x-user-id": "019c0000-0000-7000-8000-000000000099",
      "x-request-id": "../evil",
    });
    expect(hostile.status).toBe(200);
    const body = (await hostile.json()) as { items: Array<{ email: string }> };
    expect(body.items.some(({ email }) => email.startsWith(`${prefix}-owner-b`))).toBe(false);
  });

  it("requires tenant.users.manage and tenant.roles.manage on every route", async () => {
    expect((await get("/app/users", userACookie)).status).toBe(403);
    expect((await get("/app/users/options", userACookie)).status).toBe(403);
    expect((await post("/app/users", userACookie, {})).status).toBe(403);
    expect((await patch("/app/users/some-id/status", userACookie, {})).status).toBe(403);
    expect((await put("/app/users/some-id/role-assignments", userACookie, {})).status).toBe(403);
    expect((await get("/app/roles", userACookie)).status).toBe(403);
    expect((await put("/app/roles/some-id/permissions", userACookie, {})).status).toBe(403);
    expect((await get("/app/roles", ownerACookie)).status).toBe(200);
  });

  it("creates a user with hashed password and least-data response", async () => {
    const response = await post("/app/users", ownerACookie, {
      displayName: "API Alice",
      email: "api-alice@example.invalid",
      password,
      roleAssignments: [{ roleId: roleAgentAId, organizationUnitId: null }],
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    createdUserId = body.id as string;
    expect(body).toMatchObject({
      displayName: "API Alice",
      email: "api-alice@example.invalid",
      status: "active",
    });
    expect(JSON.stringify(body)).not.toMatch(/password|tenantId|session|token/);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: createdUserId } });
    expect(stored.passwordHash).not.toContain(password);
  });

  it("rejects malformed bodies, normalizes emails and rejects short passwords", async () => {
    expect((await post("/app/users", ownerACookie, {})).status).toBe(400);
    expect(
      (
        await post("/app/users", ownerACookie, {
          displayName: "Bad",
          email: "api-alice@example.invalid",
          password,
          roleAssignments: [],
          extra: true,
        })
      ).status,
    ).toBe(400);
    const normalizedConflict = await post("/app/users", ownerACookie, {
      displayName: "Bad",
      email: "  API-ALICE@example.invalid ",
      password,
      roleAssignments: [],
    });
    expect(normalizedConflict.status).toBe(409);
    expect(((await normalizedConflict.json()) as { code?: string }).code).toBe(
      "USER_EMAIL_CONFLICT",
    );
    expect(
      (
        await post("/app/users", ownerACookie, {
          displayName: "Bad",
          email: "short@example.invalid",
          password: "short",
          roleAssignments: [],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post("/app/users", ownerACookie, {
          displayName: "Bad",
          email: "dup@example.invalid",
          password,
          roleAssignments: [{ roleId: roleAgentAId, organizationUnitId: null }],
        })
      ).status,
    ).toBe(201);
    const conflict = await post("/app/users", ownerACookie, {
      displayName: "Bad",
      email: "dup@example.invalid",
      password,
      roleAssignments: [],
    });
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { code?: string }).code).toBe("USER_EMAIL_CONFLICT");
    expect(
      (
        await post("/app/users", ownerACookie, {
          displayName: "Bad",
          email: "dup@example.invalid",
          password,
          roleAssignments: [{ roleId: roleAgentBId, organizationUnitId: null }],
        })
      ).status,
    ).toBe(404);
  });

  it("lists users with search, filters and active-seat usage", async () => {
    const response = await get("/app/users?page=1&pageSize=25&search=alice", ownerACookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<Record<string, unknown>>;
      total: number;
      usage: { used: number; limit: string };
    };
    expect(body.total).toBe(1);
    expect(body.items[0]?.email).toBe("api-alice@example.invalid");
    expect(JSON.stringify(body)).not.toMatch(/password|tenantId/);
    const filtered = (await (await get("/app/users?status=disabled", ownerACookie)).json()) as {
      usage: { used: number };
    };
    expect(filtered.usage.used).toBe(4);
    const bList = (await (await get("/app/users", ownerBCookie)).json()) as {
      items: Array<{ email: string }>;
      total: number;
    };
    expect(bList.total).toBe(1);
    expect(bList.items[0]?.email).toBe(`${prefix}-owner-b@example.invalid`);
    expect((await get("/app/users?page=0", ownerACookie)).status).toBe(400);
    expect((await get("/app/users?status=banana", ownerACookie)).status).toBe(400);
  });

  it("returns options with only tenant-scoped roles and units", async () => {
    const response = await get("/app/users/options", ownerACookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      organizationUnits: Array<{ id: string }>;
      roles: Array<{ key: string }>;
    };
    expect(body.roles.map(({ key }) => key).sort()).toEqual([
      "administrator",
      "agent",
      "custom-e04-s04-um-api-tenant-settings-manage",
      "operator",
      "owner",
      "supervisor",
      "viewer",
    ]);
    expect(body.organizationUnits.some(({ id }) => id === branchAId)).toBe(true);
  });

  it("enforces the active-seat limit with a conflict", async () => {
    const before = (await (await get("/app/users", ownerACookie)).json()) as {
      usage: { used: number; limit: string };
    };
    await prisma.tenantEntitlement.update({
      data: { enabled: true, limitValue: String(before.usage.used) },
      where: { tenantId_entitlementKey: { entitlementKey: "limit.users", tenantId: tenantAId } },
    });
    const response = await post("/app/users", ownerACookie, {
      displayName: "Over Limit",
      email: "over-limit@example.invalid",
      password,
      roleAssignments: [],
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code?: string }).code).toBe("USER_LIMIT_REACHED");
    await prisma.tenantEntitlement.update({
      data: { enabled: true, limitValue: "20" },
      where: { tenantId_entitlementKey: { entitlementKey: "limit.users", tenantId: tenantAId } },
    });
  });

  it("disables and reactivates users with session semantics", async () => {
    const targetEmail = `${prefix}-target@example.invalid`;
    const created = (await (
      await post("/app/users", ownerACookie, {
        displayName: "Target",
        email: targetEmail,
        password,
        roleAssignments: [{ roleId: roleAgentAId, organizationUnitId: null }],
      })
    ).json()) as { id: string };
    const targetCookie = cookieFrom(await login(tenantASlug, targetEmail));
    expect((await get("/auth/me", targetCookie)).status).toBe(200);
    const disabled = await patch(`/app/users/${created.id}/status`, ownerACookie, {
      status: "disabled",
    });
    expect(disabled.status).toBe(200);
    expect(((await disabled.json()) as { changed: boolean }).changed).toBe(true);
    expect((await get("/auth/me", targetCookie)).status).toBe(401);
    expect((await login(tenantASlug, targetEmail)).status).toBe(401);
    const reactivated = await patch(`/app/users/${created.id}/status`, ownerACookie, {
      status: "active",
    });
    expect(reactivated.status).toBe(200);
    expect((await login(tenantASlug, targetEmail)).status).toBe(200);
    const repeated = await patch(`/app/users/${created.id}/status`, ownerACookie, {
      status: "active",
    });
    expect(((await repeated.json()) as { changed: boolean }).changed).toBe(false);
  });

  it("protects the last active tenant-wide owner", async () => {
    const response = await patch(`/app/users/${ownerAId}/status`, ownerACookie, {
      status: "disabled",
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code?: string }).code).toBe("LAST_OWNER_REQUIRED");
    const replacement = await put(`/app/users/${ownerAId}/role-assignments`, ownerACookie, {
      assignments: [],
    });
    expect(replacement.status).toBe(409);
    const crossTenant = await patch(`/app/users/${ownerBId}/status`, ownerACookie, {
      status: "disabled",
    });
    expect(crossTenant.status).toBe(404);
  });

  it("replaces role assignments atomically with duplicate rejection", async () => {
    const response = await put(`/app/users/${createdUserId}/role-assignments`, ownerACookie, {
      assignments: [
        { roleId: roleViewerAId, organizationUnitId: null },
        { roleId: roleAgentAId, organizationUnitId: branchAId },
      ],
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { roleAssignments: Array<Record<string, unknown>> };
    expect(body.roleAssignments).toHaveLength(2);
    const duplicated = await put(`/app/users/${createdUserId}/role-assignments`, ownerACookie, {
      assignments: [
        { roleId: roleViewerAId, organizationUnitId: null },
        { roleId: roleViewerAId, organizationUnitId: null },
      ],
    });
    expect(duplicated.status).toBe(400);
    expect(((await duplicated.json()) as { code?: string }).code).toBe("DUPLICATE_ROLE_ASSIGNMENT");
    const foreign = await put(`/app/users/${createdUserId}/role-assignments`, ownerACookie, {
      assignments: [{ roleId: roleAgentBId, organizationUnitId: null }],
    });
    expect(foreign.status).toBe(404);
  });

  it("lists roles with permission keys and keeps the owner matrix read-only", async () => {
    const response = await get("/app/roles", ownerACookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      permissions: Array<{ key: string; description: string }>;
      roles: Array<{ id: string; key: string; permissionKeys: string[] }>;
    };
    const roles = body.roles;
    expect(roles).toHaveLength(6);
    expect(body.permissions).toHaveLength(31);
    expect(body.permissions.some(({ key }) => key === "tenant.users.manage")).toBe(true);
    const owner = roles.find(({ key }) => key === "owner");
    expect(owner?.permissionKeys).toHaveLength(31);
    const blocked = await put(`/app/roles/${roleOwnerAId}/permissions`, ownerACookie, {
      permissionKeys: [],
    });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { code?: string }).code).toBe("OWNER_ROLE_READ_ONLY");
    const agent = roles.find(({ key }) => key === "agent");
    if (agent === undefined) throw new Error("Agent role missing");
    const updated = await put(`/app/roles/${agent.id}/permissions`, ownerACookie, {
      permissionKeys: ["catalog.read", "catalog.read"],
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { permissionKeys: string[] }).permissionKeys).toEqual([
      "catalog.read",
    ]);
  });

  it("revokes permissions hot: next request is 403 and re-grant restores access", async () => {
    const role = roleAgentAId;
    const permission = await prisma.permission.findUnique({
      where: { key: "tenant.users.manage" },
    });
    if (permission === null) throw new Error("Permission missing");
    await prisma.rolePermission.create({ data: { permissionId: permission.id, roleId: role } });
    const memberId = await createUser(tenantAId, "hot", role);
    const memberCookie = (await session(tenantAId, memberId)).cookie;
    expect((await get("/app/users", memberCookie)).status).toBe(200);
    await put(`/app/roles/${role}/permissions`, ownerACookie, { permissionKeys: [] });
    expect((await get("/app/users", memberCookie)).status).toBe(403);
    await prisma.rolePermission.create({ data: { permissionId: permission.id, roleId: role } });
    expect((await get("/app/users", memberCookie)).status).toBe(200);
  });
});
