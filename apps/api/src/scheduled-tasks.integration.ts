import { ForbiddenException } from "@nestjs/common";
import { generateOpaqueToken, hashOpaqueToken } from "@whatsapp-platform/auth";
import { loadNonSecretConfig } from "@whatsapp-platform/config";
import type { ModuleEntitlementKey, ScheduledTask } from "@whatsapp-platform/database";
import { createTenantContext } from "@whatsapp-platform/database";
import {
  createPlatformDatabaseClient,
  createPlatformTenantProvisioningRepository,
  type PrismaClient,
  syncPermissionCatalog,
} from "@whatsapp-platform/database/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "./app";
import { ScheduledTasksService } from "./scheduled-tasks";
import type { ScheduledTaskQueue } from "./scheduled-tasks-queue";

const prefix = "e13-s01-scheduled-task-api";
let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof createApiApplication>>;
let baseUrl = "";
let tenantAId = "";
let tenantBId = "";
let tenantNoModuleId = "";
let tenantSuspendedId = "";
let ownerACookie = "";
let ownerBCookie = "";
let noModuleCookie = "";
let suspendedCookie = "";
let viewerACookie = "";

class RecordingScheduledTaskQueue implements ScheduledTaskQueue {
  readonly enqueued: Array<Pick<ScheduledTask, "id" | "tenantId" | "scheduledFor">> = [];

  async enqueue(task: Pick<ScheduledTask, "id" | "tenantId" | "scheduledFor">): Promise<void> {
    this.enqueued.push(task);
  }

  async close(): Promise<void> {}
}

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

  await prisma.scheduledTask.deleteMany({ where: { tenantId: { in: ids } } });
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
): Promise<{ ownerId: string; tenantId: string }> {
  const result = await createPlatformTenantProvisioningRepository(prisma).provision({
    actorPlatformAdminId: "019c0000-0000-7000-8000-000000000001",
    defaultCurrency: "MXN",
    defaultLocale: "es-MX",
    defaultTimezone: "America/Mexico_City",
    deploymentId: null,
    displayName: `Scheduled Task API ${marker}`,
    enabledModules,
    legalName: `Scheduled Task API ${marker} SA de CV`,
    limits: {
      channelAccounts: 1,
      monthlyAiBudget: null,
      organizationUnits: 1,
      storageBytes: 1024,
      users: 3,
    },
    owner: {
      displayName: `Scheduled Task API Owner ${marker}`,
      email: `${prefix}-${marker}@example.invalid`,
      locale: "es-MX",
      passwordHash: "$argon2id$test-hash-not-reversible",
      timezone: "America/Mexico_City",
    },
    requestId: `${prefix}-${marker}`,
    slug: `${prefix}-${marker}`,
  });
  return { ownerId: result.owner.id, tenantId: result.tenant.id };
}

describe.sequential("Scheduled Tasks API Integration", () => {
  let taskAId = "";
  const scheduledTaskQueue = new RecordingScheduledTaskQueue();

  beforeAll(async () => {
    prisma = createPlatformDatabaseClient({
      databaseUrl:
        process.env.DATABASE_URL ??
        "postgresql://whatsapp_platform_dev:replace-with-a-local-development-password@localhost:5432/whatsapp_platform_dev",
    });
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);

    const tenantA = await provision("a", ["module.scheduling"]);
    const tenantB = await provision("b", ["module.scheduling"]);
    const tenantNoModule = await provision("no-module", []);
    const tenantSuspended = await provision("suspended", ["module.scheduling"]);
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;
    tenantNoModuleId = tenantNoModule.tenantId;
    tenantSuspendedId = tenantSuspended.tenantId;
    ownerACookie = await session(tenantAId, tenantA.ownerId);
    ownerBCookie = await session(tenantBId, tenantB.ownerId);
    noModuleCookie = await session(tenantNoModuleId, tenantNoModule.ownerId);
    suspendedCookie = await session(tenantSuspendedId, tenantSuspended.ownerId);
    await prisma.tenant.update({
      data: { status: "suspended" },
      where: { id: tenantSuspendedId },
    });

    const viewerRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { key: "viewer", tenantId: tenantAId } },
    });
    const viewer = await prisma.user.create({
      data: {
        displayName: "Scheduling Viewer",
        email: `${prefix}-viewer@example.invalid`,
        locale: "es-MX",
        passwordHash: "$argon2id$test-hash-not-reversible",
        tenantId: tenantAId,
        timezone: "America/Mexico_City",
      },
    });
    await prisma.userRole.create({
      data: {
        roleId: viewerRole.id,
        tenantId: tenantAId,
        userId: viewer.id,
      },
    });
    viewerACookie = await session(tenantAId, viewer.id);

    app = await createApiApplication(loadNonSecretConfig({ NODE_ENV: "test" }), {
      scheduledTaskQueue,
    });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await prisma?.$disconnect();
  });

  it("requires a tenant session for scheduled task listing", async () => {
    const response = await fetch(`${baseUrl}/api/v1/scheduled-tasks`);
    expect(response.status).toBe(401);
  });

  it("rejects suspended-tenant sessions at the guard with 401", async () => {
    const create = await fetch(`${baseUrl}/api/v1/scheduled-tasks`, {
      body: JSON.stringify({
        name: "Suspended tenant task",
        scheduledFor: new Date(Date.now() + 600_000).toISOString(),
        taskType: "send.reminder",
      }),
      headers: {
        "content-type": "application/json",
        cookie: suspendedCookie,
        "x-tenant-id": tenantSuspendedId,
      },
      method: "POST",
    });
    expect(create.status).toBe(401);
  });

  it("maps a non-operational tenant reached past the guard to 403 TENANT_NOT_OPERATIONAL", async () => {    const service = app.get(ScheduledTasksService);
    const suspendedContext = createTenantContext(tenantSuspendedId);
    await expect(
      service.cancel(suspendedContext, "019c0000-0000-7000-8000-0000000000ff"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.create(suspendedContext, {
          name: "Suspended task",
          scheduledFor: new Date(Date.now() + 600_000).toISOString(),
          taskType: "send.reminder",
        },
      ),
    ).rejects.toMatchObject({ response: { code: "TENANT_NOT_OPERATIONAL", statusCode: 403 } });
  });

  it("lists and creates scheduled tasks with the standard envelope", async () => {
    const list = await fetch(`${baseUrl}/api/v1/scheduled-tasks`, {
      headers: { cookie: ownerACookie, "x-tenant-id": tenantAId },
    });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      success: boolean;
      data: { tasks: unknown[]; total: number; limit: number; offset: number };
    };
    expect(listBody).toMatchObject({ success: true, data: { limit: 20, offset: 0, total: 0 } });

    const create = await fetch(`${baseUrl}/api/v1/scheduled-tasks`, {
      body: JSON.stringify({
        name: "API reminder",
        payload: { source: "api-test" },
        scheduledFor: new Date(Date.now() + 600_000).toISOString(),
        taskType: "send.reminder",
      }),
      headers: {
        "content-type": "application/json",
        cookie: ownerACookie,
        "x-tenant-id": tenantAId,
      },
      method: "POST",
    });
    expect(create.status).toBe(201);
    const createBody = (await create.json()) as {
      success: boolean;
      data: { id: string; status: string; tenantId: string };
    };
    expect(createBody.success).toBe(true);
    expect(createBody.data.status).toBe("PENDING");
    expect(createBody.data.tenantId).toBe(tenantAId);
    taskAId = createBody.data.id;
    expect(scheduledTaskQueue.enqueued).toHaveLength(1);
    expect(scheduledTaskQueue.enqueued[0]).toMatchObject({
      id: taskAId,
      tenantId: tenantAId,
    });
  });

  it("enforces module and permission gates", async () => {
    const noModule = await fetch(`${baseUrl}/api/v1/scheduled-tasks`, {
      headers: { cookie: noModuleCookie, "x-tenant-id": tenantNoModuleId },
    });
    expect(noModule.status).toBe(403);

    const noPermission = await fetch(`${baseUrl}/api/v1/scheduled-tasks`, {
      headers: { cookie: viewerACookie, "x-tenant-id": tenantAId },
    });
    expect(noPermission.status).toBe(403);
  });

  it("returns 404 for cross-tenant cancellation", async () => {
    const response = await fetch(`${baseUrl}/api/v1/scheduled-tasks/${taskAId}`, {
      headers: { cookie: ownerBCookie, "x-tenant-id": tenantBId },
      method: "DELETE",
    });
    expect(response.status).toBe(404);
  });
});
