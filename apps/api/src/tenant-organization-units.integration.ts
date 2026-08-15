import {
  generateOpaqueToken,
  hashOpaqueToken,
  PlatformPasswordHasher,
} from "@whatsapp-platform/auth";
import { loadNonSecretConfig } from "@whatsapp-platform/config";
import {
  createPlatformDatabaseClient,
  type PrismaClient,
  syncPermissionCatalog,
} from "@whatsapp-platform/database/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "./app";

const prefix = "e04-s03-ou-api";
const password = "tenant organization units api password";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl = "";
let tenantAId = "";
let tenantBId = "";
let userAId = "";
let userBId = "";
let userCId = "";
let tenantACookie = "";
let tenantBCookie = "";
let userCCookie = "";
let rootAId = "";
let rootBId = "";

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

async function createUser(tenantId: string, marker: string, roleId: string): Promise<string> {
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
  if (roleId !== "") {
    await prisma.userRole.create({ data: { roleId, tenantId, userId: user.id } });
  }
  return user.id;
}

async function roleWithSettings(tenantId: string): Promise<string> {
  const role = await prisma.role.create({
    data: { key: "settings", name: "Settings", tenantId },
  });
  const permission = await prisma.permission.findUnique({
    where: { key: "tenant.settings.manage" },
  });
  if (permission !== null) {
    await prisma.rolePermission.create({
      data: { permissionId: permission.id, roleId: role.id },
    });
  }
  return role.id;
}

function get(cookie = tenantACookie): Promise<Response> {
  return fetch(`${baseUrl}/app/organization-units`, {
    headers: { cookie, "x-tenant-id": tenantBId, "x-workspace-id": tenantBId },
  });
}

function post(cookie: string, body: unknown, requestId = `${prefix}-post`): Promise<Response> {
  return fetch(`${baseUrl}/app/organization-units`, {
    body: JSON.stringify(body),
    headers: { cookie, "content-type": "application/json", "x-request-id": requestId },
    method: "POST",
  });
}

function patch(
  cookie: string,
  unitId: string,
  body: unknown,
  requestId = `${prefix}-patch`,
): Promise<Response> {
  return fetch(`${baseUrl}/app/organization-units/${unitId}`, {
    body: JSON.stringify(body),
    headers: { cookie, "content-type": "application/json", "x-request-id": requestId },
    method: "PATCH",
  });
}

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.userSession.deleteMany({ where: { tenantId: { in: ids } } });
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

async function createRoot(tenantId: string, name: string): Promise<string> {
  const root = await prisma.organizationUnit.create({
    data: { name, tenantId, type: "company" },
  });
  return root.id;
}

describe.sequential("E04-S03 tenant organization units API", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
    prisma = createPlatformDatabaseClient({ databaseUrl });
    await cleanup();
    await syncPermissionCatalog(prisma);
    const [tenantA, tenantB] = await Promise.all(
      ["a", "b"].map((marker) =>
        prisma.tenant.create({
          data: {
            defaultCurrency: "MXN",
            defaultLocale: "es-MX",
            defaultTimezone: "America/Mexico_City",
            displayName: `Organization Units API ${marker}`,
            legalName: `Organization Units API ${marker}`,
            slug: `${prefix}-${marker}`,
            status: "active",
          },
        }),
      ),
    );
    if (tenantA === undefined || tenantB === undefined) throw new Error("Tenant fixtures failed");
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    rootAId = await createRoot(tenantAId, "Root A");
    rootBId = await createRoot(tenantBId, "Root B");
    const roleA = await roleWithSettings(tenantAId);
    const roleB = await roleWithSettings(tenantBId);
    userAId = await createUser(tenantAId, "a", roleA);
    userBId = await createUser(tenantBId, "b", roleB);
    userCId = await createUser(tenantAId, "c", "");
    tenantACookie = (await session(tenantAId, userAId)).cookie;
    tenantBCookie = (await session(tenantBId, userBId)).cookie;
    userCCookie = (await session(tenantAId, userCId)).cookie;
    app = await createApiApplication(loadNonSecretConfig());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await prisma?.$disconnect();
  });

  it("fails closed for missing, platform, revoked and suspended sessions", async () => {
    expect((await get("")).status).toBe(401);
    expect((await get("platform_session=not-a-tenant-session")).status).toBe(401);
    const revoked = await session(tenantAId, userAId);
    await prisma.userSession.update({ data: { revokedAt: new Date() }, where: { id: revoked.id } });
    expect((await get(revoked.cookie)).status).toBe(401);
    await prisma.tenant.update({
      data: { status: "suspended", suspendedAt: new Date() },
      where: { id: tenantAId },
    });
    expect((await post(tenantACookie, {})).status).toBe(401);
    await prisma.tenant.update({
      data: { status: "active", suspendedAt: null },
      where: { id: tenantAId },
    });
    expect((await get()).status).toBe(200);
  });

  it("requires the settings permission for reads and writes", async () => {
    expect((await get(userCCookie)).status).toBe(403);
    expect(
      (await post(userCCookie, { parentId: rootAId, name: "Nope", type: "branch" })).status,
    ).toBe(403);
    expect((await patch(userCCookie, rootAId, { name: "Nope" })).status).toBe(403);
  });

  it("lists only the structural root when the tree is empty", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<Record<string, unknown>>;
      usage: { used: number; limit: string | null };
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: rootAId,
      parentId: null,
      type: "company",
      name: "Root A",
      active: true,
    });
    expect(Object.keys(body.items[0] ?? {}).sort()).toEqual([
      "active",
      "code",
      "createdAt",
      "id",
      "name",
      "parentId",
      "timezone",
      "type",
      "updatedAt",
    ]);
    expect(body.usage).toEqual({ used: 1, limit: null });
  });

  it("rejects malformed create and update requests", async () => {
    const invalidCreates: unknown[] = [
      {},
      { parentId: rootAId, name: "X", type: "branch", extra: "y" },
      { parentId: "not-a-uuid", name: "X", type: "branch" },
      { parentId: rootAId, name: "", type: "branch" },
      { parentId: rootAId, name: " ".repeat(50), type: "branch" },
      { parentId: rootAId, name: "X".repeat(121), type: "branch" },
      { parentId: rootAId, name: "X", type: "branch", code: "C".repeat(41) },
      { parentId: rootAId, name: "X", type: "branch", timezone: "Mars/Olympus" },
      { parentId: rootAId, name: "X", type: "holding" },
      { parentId: rootAId, name: "X", type: "company" },
      { parentId: rootAId, name: "X", type: "branch", active: "yes" },
      { parentId: 42, name: "X", type: "branch" },
    ];
    for (const body of invalidCreates) {
      const response = await post(tenantACookie, body, `${prefix}-invalid`);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    const invalidPatches: Array<[string, unknown]> = [
      [rootAId, {}],
      [rootAId, { name: "X", extra: "y" }],
      [rootAId, { active: 1 }],
      ["not-a-uuid", { name: "X" }],
    ];
    for (const [unitId, body] of invalidPatches) {
      const response = await patch(tenantACookie, unitId, body, `${prefix}-invalid`);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("creates a child unit and reflects it in the tree with audit and outbox", async () => {
    const response = await post(
      tenantACookie,
      { code: "NTE", name: "Sucursal Norte", parentId: rootAId, type: "branch" },
      `${prefix}-create`,
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      parentId: rootAId,
      type: "branch",
      name: "Sucursal Norte",
      code: "NTE",
      active: true,
    });
    expect(Object.keys(body).sort()).toEqual([
      "active",
      "code",
      "createdAt",
      "id",
      "name",
      "parentId",
      "timezone",
      "type",
      "updatedAt",
    ]);

    const tree = (await (await get()).json()) as { items: Array<{ id: string }> };
    expect(tree.items.map(({ id }) => id)).toContain(body.id);

    const audit = await prisma.auditLog.findFirst({
      orderBy: { occurredAt: "desc" },
      where: { tenantId: tenantAId, action: "organization_unit.created" },
    });
    expect(audit).toMatchObject({
      actorId: userAId,
      actorType: "tenant_user",
      entityId: body.id,
      entityType: "OrganizationUnit",
      requestId: `${prefix}-create`,
    });
    expect(JSON.stringify(audit?.afterSummary)).not.toMatch(/tenantId|settings|address/i);
    const outbox = await prisma.domainEventOutbox.findFirst({
      orderBy: { occurredAt: "desc" },
      where: { tenantId: tenantAId, eventType: "organization_unit.created" },
    });
    expect(outbox?.aggregateId).toBe(body.id);
  });

  it("updates a child unit and keeps the before and after summaries", async () => {
    const created = (await (
      await post(
        tenantACookie,
        { name: "Ventas", parentId: rootAId, type: "department" },
        `${prefix}-update-target`,
      )
    ).json()) as { id: string };
    const response = await patch(
      tenantACookie,
      created.id,
      { name: "Ventas Digitales", active: false, timezone: "America/Argentina/Buenos_Aires" },
      `${prefix}-update`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: created.id,
      name: "Ventas Digitales",
      active: false,
      timezone: "America/Argentina/Buenos_Aires",
    });
    const audit = await prisma.auditLog.findFirst({
      orderBy: { occurredAt: "desc" },
      where: { tenantId: tenantAId, action: "organization_unit.updated", entityId: created.id },
    });
    expect(audit?.beforeSummary).toMatchObject({ name: "Ventas", active: true, timezone: null });
    expect(audit?.afterSummary).toMatchObject({
      name: "Ventas Digitales",
      active: false,
      timezone: "America/Argentina/Buenos_Aires",
    });
  });

  it("keeps the structural root immutable and allows only safe root edits", async () => {
    const deactivate = await patch(tenantACookie, rootAId, { active: false }, `${prefix}-root-1`);
    expect(deactivate.status).toBe(409);
    const move = await patch(
      tenantACookie,
      rootAId,
      { parentId: "01989f20-0007-7000-8000-000000000099" },
      `${prefix}-root-2`,
    );
    expect(move.status).toBe(409);
    const retype = await patch(tenantACookie, rootAId, { type: "other" }, `${prefix}-root-3`);
    expect(retype.status).toBe(409);
    const rename = await patch(
      tenantACookie,
      rootAId,
      { name: "Root A Renamed" },
      `${prefix}-root-4`,
    );
    expect(rename.status).toBe(200);
    const body = (await rename.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: rootAId,
      name: "Root A Renamed",
      parentId: null,
      active: true,
    });
  });

  it("rejects non-root moves to null, self and descendant parents", async () => {
    const created = (await (
      await post(
        tenantACookie,
        { name: "Operaciones", parentId: rootAId, type: "department" },
        `${prefix}-cycle-target`,
      )
    ).json()) as { id: string };
    const child = (await (
      await post(
        tenantACookie,
        { name: "Mesa", parentId: created.id, type: "team" },
        `${prefix}-cycle-child`,
      )
    ).json()) as { id: string };
    expect((await patch(tenantACookie, created.id, { parentId: null })).status).toBe(409);
    expect((await patch(tenantACookie, created.id, { parentId: created.id })).status).toBe(409);
    expect((await patch(tenantACookie, created.id, { parentId: child.id })).status).toBe(409);
    const body = (await (await get()).json()) as {
      items: Array<{ id: string; parentId: string | null }>;
    };
    const stored = body.items.find(({ id }) => id === created.id);
    expect(stored?.parentId).toBe(rootAId);
  });

  it("rejects units beyond the maximum depth with a conflict", async () => {
    let parent = rootBId;
    for (let depth = 1; depth <= 10; depth += 1) {
      const unit = await prisma.organizationUnit.create({
        data: {
          name: `B Depth ${depth}`,
          parentId: parent,
          tenantId: tenantBId,
          type: "department",
        },
      });
      parent = unit.id;
    }
    const response = await post(
      tenantBCookie,
      { name: "Too Deep", parentId: parent, type: "department" },
      `${prefix}-depth`,
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { code?: unknown };
    expect(body.code).toBe("ORGANIZATION_UNIT_DEPTH_EXCEEDED");
  });

  it("enforces the effective limit with a conflict code", async () => {
    await prisma.auditLog.deleteMany({
      where: { tenantId: tenantAId, organizationUnitId: { not: rootAId } },
    });
    await prisma.organizationUnit.deleteMany({
      where: { tenantId: tenantAId, id: { not: rootAId } },
    });
    await prisma.tenantEntitlement.create({
      data: {
        enabled: true,
        entitlementKey: "limit.organization_units",
        limitValue: 2,
        source: "contract",
        tenantId: tenantAId,
      },
    });
    expect(
      (await post(tenantACookie, { name: "Limit One", parentId: rootAId, type: "branch" })).status,
    ).toBe(201);
    const denied = await post(
      tenantACookie,
      { name: "Limit Two", parentId: rootAId, type: "branch" },
      `${prefix}-limit`,
    );
    expect(denied.status).toBe(409);
    const body = (await denied.json()) as { code?: unknown };
    expect(body.code).toBe("ORGANIZATION_UNIT_LIMIT_REACHED");

    const tree = (await (await get()).json()) as { usage: { used: number; limit: string | null } };
    expect(tree.usage).toEqual({ used: 2, limit: "2" });

    await prisma.tenantEntitlement.update({
      data: { enabled: false },
      where: {
        tenantId_entitlementKey: {
          entitlementKey: "limit.organization_units",
          tenantId: tenantAId,
        },
      },
    });
    expect(
      (await post(tenantACookie, { name: "After Disable", parentId: rootAId, type: "branch" }))
        .status,
    ).toBe(201);
  });

  it("never mutates or reveals another tenant tree", async () => {
    const foreign = await post(
      tenantACookie,
      { name: "Foreign", parentId: rootBId, type: "branch" },
      `${prefix}-foreign-parent`,
    );
    expect(foreign.status).toBe(404);

    const tree = (await (await get(tenantBCookie)).json()) as { items: Array<{ id: string }> };
    expect(tree.items.map(({ id }) => id)).not.toContain(rootAId);
    expect(tree.items.map(({ id }) => id)).toContain(rootBId);

    expect(
      (await patch(tenantACookie, rootBId, { name: "Hijack" }, `${prefix}-foreign-unit`)).status,
    ).toBe(404);
    const b = (await (await get(tenantBCookie)).json()) as { items: Array<{ name: string }> };
    expect(b.items.some(({ name }) => name === "Hijack")).toBe(false);
  });

  it("treats hostile tenant headers as invalid and keeps the session tenant", async () => {
    await post(
      tenantACookie,
      { name: "Propia", parentId: rootAId, type: "branch" },
      `${prefix}-hostile`,
    );
    const a = (await (await get(tenantACookie)).json()) as { items: Array<{ name: string }> };
    expect(a.items.some(({ name }) => name === "Propia")).toBe(true);
    const b = (await (await get(tenantBCookie)).json()) as { items: Array<{ name: string }> };
    expect(b.items.some(({ name }) => name === "Propia")).toBe(false);
  });
});
