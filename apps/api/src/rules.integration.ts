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

const prefix = "e08-s01-rules-api";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl = "";
let tenantAId = "";
let tenantBId = "";
let tenantNoEntitlementId = "";
let tenantNoAppointmentsId = "";
let ownerAId = "";
let ownerBId = "";
let ownerNoEntitlementId = "";
let ownerNoAppointmentsId = "";
let viewerAId = "";
let rulesManagerAId = "";
let ownerACookie = "";
let ownerBCookie = "";
let ownerNoEntitlementCookie = "";
let ownerNoAppointmentsCookie = "";
let viewerACookie = "";
let rulesManagerACookie = "";
let ruleAId = "";
let bookingRuleAId = "";
let channelAId = "";
let serviceAId = "";
let resourceAId = "";

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
  await prisma.rule.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentService.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointmentResource.deleteMany({ where: { tenantId: { in: ids } } });
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
  modules: readonly ModuleEntitlementKey[] = ["module.messaging.basic", "module.automation.basic"],
): Promise<{ ownerId: string; rootId: string; tenantId: string }> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Rules API ${marker}`,
    enabledModules: modules,
    legalName: `Rules API ${marker} SA`,
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
  return {
    ownerId: result.owner.id,
    rootId: result.organizationRoot.id,
    tenantId: result.tenant.id,
  };
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

async function waitForDatabaseLockWait(): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT COUNT(*)::int AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND pid <> pg_backend_pid()`;
    if ((rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Rules API manager did not wait on the locked rule row");
}

function bookingRuleInput(name = "WhatsApp appointment booking"): Record<string, unknown> {
  return {
    actions: [
      {
        actionType: "start_appointment_booking",
        parameters: { resourceIds: [resourceAId], serviceIds: [serviceAId] },
      },
    ],
    conditions: [],
    executionMode: "first_match_stop",
    name,
    status: "active",
    triggerType: "ON_MESSAGE_RECEIVED",
  };
}

describe.sequential("E08-S01 rules REST API", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient({ databaseUrl: process.env.DATABASE_URL ?? "" });
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);

    const [a, b, noEntitlement, noAppt] = await Promise.all([
      provision("a", ["module.messaging.basic", "module.automation.basic", "module.appointments"]),
      provision("b"),
      provision("no-ent", ["module.messaging.basic"]), // missing module.automation.basic
      provision("no-appt", ["module.messaging.basic", "module.automation.basic"]),
    ]);

    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
    tenantNoEntitlementId = noEntitlement.tenantId;
    tenantNoAppointmentsId = noAppt.tenantId;

    ownerAId = a.ownerId;
    ownerBId = b.ownerId;
    ownerNoEntitlementId = noEntitlement.ownerId;
    ownerNoAppointmentsId = noAppt.ownerId;

    // Create a Viewer user for Tenant A (only has rules.read or no rules.manage)
    const viewerUser = await prisma.user.create({
      data: {
        displayName: "Viewer User",
        email: `${prefix}-viewer-a@example.invalid`,
        locale: "es-MX",
        passwordHash: "$argon2id$test-hash-not-reversible",
        tenantId: tenantAId,
        timezone: "America/Mexico_City",
      },
    });
    viewerAId = viewerUser.id;

    // Find the viewer role in Tenant A
    const viewerRole = await prisma.role.findFirstOrThrow({
      where: { key: "viewer", tenantId: tenantAId },
    });

    // Assign viewer role
    await prisma.userRole.create({
      data: {
        roleId: viewerRole.id,
        tenantId: tenantAId,
        userId: viewerAId,
      },
    });

    // Give viewer role 'rules.read' permission only
    const rulesReadPermission = await prisma.permission.findFirstOrThrow({
      where: { key: "rules.read" },
    });
    await prisma.rolePermission.create({
      data: {
        permissionId: rulesReadPermission.id,
        roleId: viewerRole.id,
      },
    });

    const rulesManager = await prisma.user.create({
      data: {
        displayName: "Rules Manager without Appointments",
        email: `${prefix}-rules-manager-a@example.invalid`,
        locale: "es-MX",
        passwordHash: "$argon2id$test-hash-not-reversible",
        tenantId: tenantAId,
        timezone: "America/Mexico_City",
      },
    });
    rulesManagerAId = rulesManager.id;
    const rulesManagerRole = await prisma.role.create({
      data: {
        key: "appointment-configurator",
        name: "Appointment Configurator",
        tenantId: tenantAId,
      },
    });
    await prisma.userRole.create({
      data: { roleId: rulesManagerRole.id, tenantId: tenantAId, userId: rulesManagerAId },
    });
    const [rulesManagePermission, rulesManagerReadPermission] = await Promise.all([
      prisma.permission.findFirstOrThrow({ where: { key: "rules.manage" } }),
      prisma.permission.findFirstOrThrow({ where: { key: "rules.read" } }),
    ]);
    await prisma.rolePermission.createMany({
      data: [rulesManagePermission, rulesManagerReadPermission].map((permission) => ({
        permissionId: permission.id,
        roleId: rulesManagerRole.id,
      })),
    });

    // Create a ChannelAccount in Tenant A
    const channelA = await prisma.channelAccount.create({
      data: {
        displayName: "WhatsApp Principal",
        organizationUnitId: a.rootId,
        phoneNumber: "+525500001111",
        providerType: "mock",
        tenantId: tenantAId,
      },
    });
    channelAId = channelA.id;

    const [serviceA, resourceA] = await Promise.all([
      prisma.appointmentService.create({
        data: {
          durationMinutes: 30,
          name: "Rules API service",
          organizationUnitId: a.rootId,
          tenantId: tenantAId,
        },
      }),
      prisma.appointmentResource.create({
        data: {
          name: "Rules API resource",
          organizationUnitId: a.rootId,
          tenantId: tenantAId,
        },
      }),
    ]);
    serviceAId = serviceA.id;
    resourceAId = resourceA.id;

    ownerACookie = await session(tenantAId, ownerAId);
    ownerBCookie = await session(tenantBId, ownerBId);
    ownerNoEntitlementCookie = await session(tenantNoEntitlementId, ownerNoEntitlementId);
    ownerNoAppointmentsCookie = await session(tenantNoAppointmentsId, ownerNoAppointmentsId);
    viewerACookie = await session(tenantAId, viewerAId);
    rulesManagerACookie = await session(tenantAId, rulesManagerAId);

    app = await createApiApplication(loadNonSecretConfig({ NODE_ENV: "test" }));
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await prisma?.$disconnect();
  });

  it("POST /api/v1/rules creates a new rule with 201 Created and persists audit log", async () => {
    const res = await jsonRequest("/api/v1/rules", ownerACookie, "POST", {
      actions: [
        {
          actionType: "send_message",
          parameters: { text: "Bienvenido a nuestro soporte" },
        },
      ],
      channelAccountId: channelAId,
      conditions: [
        {
          field: "message.body",
          operator: "contains",
          value: "precio",
        },
      ],
      cooldownSeconds: 120,
      description: "Auto-respuesta de precios",
      executionMode: "first_match_stop",
      name: "Respuesta de Precios",
      priority: 50,
      status: "active",
      triggerType: "ON_MESSAGE_RECEIVED",
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      name: string;
      priority: number;
      status: string;
      triggerType: string;
      channelAccountId: string;
      conditions: Array<{ field: string; operator: string; value: string }>;
      actions: Array<{ actionType: string }>;
    };

    ruleAId = body.id;
    expect(body).toMatchObject({
      channelAccountId: channelAId,
      name: "Respuesta de Precios",
      priority: 50,
      status: "active",
      triggerType: "ON_MESSAGE_RECEIVED",
    });
    expect(body.conditions).toHaveLength(1);
    expect(body.actions).toHaveLength(1);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "rule.created", entityId: ruleAId, tenantId: tenantAId },
    });
    expect(audit.actorType).toBe("tenant_user");
  });

  it("GET /api/v1/rules lists rules for the tenant with query filters", async () => {
    const res = await request(
      "/api/v1/rules?triggerType=ON_MESSAGE_RECEIVED&status=active",
      ownerACookie,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<{ id: string; name: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((r) => r.id === ruleAId)).toBe(true);
  });

  it("GET /api/v1/rules/:ruleId returns rule detail for owner and 404 for cross-tenant", async () => {
    const resOwner = await request(`/api/v1/rules/${ruleAId}`, ownerACookie);
    expect(resOwner.status).toBe(200);
    const body = (await resOwner.json()) as { id: string; name: string };
    expect(body.id).toBe(ruleAId);

    // Cross-tenant access from Tenant B
    const resCrossTenant = await request(`/api/v1/rules/${ruleAId}`, ownerBCookie);
    expect(resCrossTenant.status).toBe(404);
  });

  it("PUT /api/v1/rules/:ruleId updates rule configuration and 404 for cross-tenant", async () => {
    const res = await jsonRequest(`/api/v1/rules/${ruleAId}`, ownerACookie, "PUT", {
      actions: [
        {
          actionType: "send_message",
          parameters: { text: "Nuevo mensaje de precios actualizado" },
        },
      ],
      name: "Respuesta de Precios V2",
      priority: 25,
      status: "draft",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      name: string;
      priority: number;
      status: string;
    };
    expect(body).toMatchObject({
      id: ruleAId,
      name: "Respuesta de Precios V2",
      priority: 25,
      status: "draft",
    });

    // Cross-tenant PUT
    const crossRes = await jsonRequest(`/api/v1/rules/${ruleAId}`, ownerBCookie, "PUT", {
      name: "Hacked rule",
    });
    expect(crossRes.status).toBe(404);
  });

  it("enforces RBAC permissions (viewer with rules.read can GET but cannot POST/PUT/DELETE)", async () => {
    // Viewer can GET list and detail
    const getListRes = await request("/api/v1/rules", viewerACookie);
    expect(getListRes.status).toBe(200);

    const getDetailRes = await request(`/api/v1/rules/${ruleAId}`, viewerACookie);
    expect(getDetailRes.status).toBe(200);

    // Viewer cannot POST (needs rules.manage)
    const postRes = await jsonRequest("/api/v1/rules", viewerACookie, "POST", {
      actions: [{ actionType: "send_message" }],
      conditions: [],
      name: "Unauthorized Rule",
      triggerType: "ON_MESSAGE_RECEIVED",
    });
    expect(postRes.status).toBe(403);

    // Viewer cannot PUT
    const putRes = await jsonRequest(`/api/v1/rules/${ruleAId}`, viewerACookie, "PUT", {
      name: "Unauthorized Edit",
    });
    expect(putRes.status).toBe(403);

    // Viewer cannot DELETE
    const deleteRes = await request(`/api/v1/rules/${ruleAId}`, viewerACookie, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(403);
  });

  it("enforces module entitlement guard (403 when module.automation.basic is not enabled)", async () => {
    const res = await request("/api/v1/rules", ownerNoEntitlementCookie);
    expect(res.status).toBe(403);
  });

  it("validates request payloads and returns 400 Bad Request on invalid fields or operators", async () => {
    const invalidTrigger = await jsonRequest("/api/v1/rules", ownerACookie, "POST", {
      actions: [{ actionType: "send_message" }],
      conditions: [],
      name: "Test Invalid",
      triggerType: "NON_EXISTENT_TRIGGER",
    });
    expect(invalidTrigger.status).toBe(400);

    const invalidOperator = await jsonRequest("/api/v1/rules", ownerACookie, "POST", {
      actions: [{ actionType: "send_message" }],
      conditions: [{ field: "msg", operator: "hack_op" }],
      name: "Test Invalid Op",
      triggerType: "ON_MESSAGE_RECEIVED",
    });
    expect(invalidOperator.status).toBe(400);

    const unexpectedField = await jsonRequest("/api/v1/rules", ownerACookie, "POST", {
      actions: [{ actionType: "send_message" }],
      conditions: [],
      maliciousField: "injection",
      name: "Test Injected Field",
      triggerType: "ON_MESSAGE_RECEIVED",
    });
    expect(unexpectedField.status).toBe(400);
  });

  it("requires booking entitlements for configuration while allowing reduction", async () => {
    const created = await jsonRequest("/api/v1/rules", ownerACookie, "POST", bookingRuleInput());
    expect(created.status, JSON.stringify(await created.clone().json())).toBe(201);
    const createdBody = (await created.json()) as {
      id: string;
      actions: Array<{ actionType: string; parameters: Record<string, unknown> }>;
    };
    bookingRuleAId = createdBody.id;
    expect(createdBody.actions[0]).toMatchObject({ actionType: "start_appointment_booking" });

    const reminderPolicy = await jsonRequest("/api/v1/rules", ownerACookie, "POST", {
      ...bookingRuleInput("Denied missing scheduling"),
      actions: [
        {
          actionType: "start_appointment_booking",
          parameters: {
            resourceIds: [resourceAId],
            serviceIds: [serviceAId],
            reminderOffsetsMinutes: [60],
          },
        },
      ],
    });
    expect(reminderPolicy.status).toBe(403);

    const reminderPolicyUpdate = await jsonRequest(
      `/api/v1/rules/${bookingRuleAId}`,
      ownerACookie,
      "PUT",
      {
        actions: [
          {
            actionType: "start_appointment_booking",
            parameters: {
              resourceIds: [resourceAId],
              serviceIds: [serviceAId],
              reminderOffsetsMinutes: [60],
            },
          },
        ],
      },
    );
    expect(reminderPolicyUpdate.status).toBe(403);

    const rulesManagerCreate = await jsonRequest(
      "/api/v1/rules",
      rulesManagerACookie,
      "POST",
      bookingRuleInput("Denied appointment configuration"),
    );
    expect(rulesManagerCreate.status).toBe(403);

    const rulesManagerDowngrade = await jsonRequest(
      `/api/v1/rules/${bookingRuleAId}`,
      rulesManagerACookie,
      "PUT",
      { actions: [{ actionType: "send_message", parameters: { text: "Downgrade" } }] },
    );
    expect(rulesManagerDowngrade.status).toBe(403);
    expect(
      await prisma.rule.findFirstOrThrow({
        select: { actions: true },
        where: { id: bookingRuleAId, tenantId: tenantAId },
      }),
    ).toMatchObject({
      actions: [expect.objectContaining({ actionType: "start_appointment_booking" })],
    });

    const noAppointmentsModule = await jsonRequest(
      "/api/v1/rules",
      ownerNoAppointmentsCookie,
      "POST",
      bookingRuleInput("Denied missing module"),
    );
    expect(noAppointmentsModule.status).toBe(403);

    const rulesManagerEdit = await jsonRequest(
      `/api/v1/rules/${bookingRuleAId}`,
      rulesManagerACookie,
      "PUT",
      { priority: 10 },
    );
    expect(rulesManagerEdit.status).toBe(403);

    const rulesManagerDeactivate = await jsonRequest(
      `/api/v1/rules/${bookingRuleAId}`,
      rulesManagerACookie,
      "PUT",
      { status: "inactive" },
    );
    expect(rulesManagerDeactivate.status).toBe(200);

    const rulesManagerDelete = await request(
      `/api/v1/rules/${bookingRuleAId}`,
      rulesManagerACookie,
      {
        method: "DELETE",
      },
    );
    expect(rulesManagerDelete.status).toBe(200);
  });

  it("rechecks current booking authority after waiting for a concurrent rule update", async () => {
    const created = await jsonRequest("/api/v1/rules", ownerACookie, "POST", {
      actions: [{ actionType: "send_message", parameters: { text: "Legacy action" } }],
      conditions: [],
      name: "Concurrent rule authorization",
      triggerType: "ON_MESSAGE_RECEIVED",
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    let signalRowLocked: () => void = () => undefined;
    const rowLocked = new Promise<void>((resolve) => {
      signalRowLocked = resolve;
    });
    let releaseBlocker: () => void = () => undefined;
    const blockerRelease = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blocker = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "rule"
        WHERE tenant_id = ${tenantAId}::uuid AND id = ${id}::uuid
        FOR UPDATE`;
      signalRowLocked();
      await blockerRelease;
      await transaction.rule.update({
        data: {
          actions: [
            {
              actionType: "start_appointment_booking",
              parameters: { resourceIds: [resourceAId], serviceIds: [serviceAId] },
            },
          ] as never,
        },
        where: { tenantId_id: { id, tenantId: tenantAId } },
      });
    });

    await rowLocked;
    const updateRequest = jsonRequest(`/api/v1/rules/${id}`, rulesManagerACookie, "PUT", {
      name: "Unauthorized after booking transition",
    });
    try {
      await waitForDatabaseLockWait();
    } finally {
      releaseBlocker();
    }
    await blocker;
    const response = await updateRequest;

    expect(response.status).toBe(403);
    await expect(
      prisma.rule.findFirstOrThrow({
        select: { actions: true, name: true },
        where: { id, tenantId: tenantAId },
      }),
    ).resolves.toMatchObject({ name: "Concurrent rule authorization" });
  });

  it("DELETE /api/v1/rules/:ruleId deletes rule and returns 200 OK, with 404 on subsequent get", async () => {
    const res = await request(`/api/v1/rules/${ruleAId}`, ownerACookie, { method: "DELETE" });
    expect(res.status).toBe(200);

    const checkGet = await request(`/api/v1/rules/${ruleAId}`, ownerACookie);
    expect(checkGet.status).toBe(404);
  });
});
