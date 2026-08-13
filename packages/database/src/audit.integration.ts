import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTenantContext,
  createTenantDataAccess,
  type TenantDataAccess,
  withTenantTransaction,
} from "./index";
import {
  createPlatformAuditWriter,
  createPlatformDatabaseClient,
  type PlatformAuditWriter,
  type PrismaClient,
} from "./platform";

const slugs = {
  tenantA: "e01-s05-tenant-a",
  tenantB: "e01-s05-tenant-b",
} as const;

let prisma: PrismaClient;
let platformAudit: PlatformAuditWriter;
let tenantA: TenantDataAccess;
let tenantB: TenantDataAccess;
let tenantAId: string;
let tenantBId: string;
let unitAId: string;
let unitBId: string;

async function cleanFixtures(): Promise<void> {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { requestId: { startsWith: "e01-s05-" } },
        { tenant: { slug: { in: [slugs.tenantA, slugs.tenantB] } } },
      ],
    },
  });
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { in: [slugs.tenantA, slugs.tenantB] } },
  });
  const tenantIds = tenants.map(({ id }) => id);

  if (tenantIds.length === 0) return;

  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}

describe.sequential("append-only audit integration", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    platformAudit = createPlatformAuditWriter(prisma);
    await cleanFixtures();

    const [createdTenantA, createdTenantB] = await Promise.all([
      prisma.tenant.create({
        data: {
          defaultCurrency: "MXN",
          defaultLocale: "es-MX",
          defaultTimezone: "America/Mexico_City",
          displayName: "E01-S05 Tenant A",
          legalName: "E01-S05 Tenant A SA de CV",
          slug: slugs.tenantA,
          status: "active",
        },
      }),
      prisma.tenant.create({
        data: {
          defaultCurrency: "MXN",
          defaultLocale: "es-MX",
          defaultTimezone: "America/Mexico_City",
          displayName: "E01-S05 Tenant B",
          legalName: "E01-S05 Tenant B SA de CV",
          slug: slugs.tenantB,
          status: "active",
        },
      }),
    ]);

    tenantAId = createdTenantA.id;
    tenantBId = createdTenantB.id;
    tenantA = createTenantDataAccess(createTenantContext(tenantAId), prisma);
    tenantB = createTenantDataAccess(createTenantContext(tenantBId), prisma);
    [unitAId, unitBId] = await Promise.all([
      tenantA.organizationUnits
        .create({ name: "Tenant A Company", type: "company" })
        .then(({ id }) => id),
      tenantB.organizationUnits
        .create({ name: "Tenant B Company", type: "company" })
        .then(({ id }) => id),
    ]);
  });

  afterAll(async () => {
    if (prisma === undefined) return;
    await cleanFixtures();
    await prisma.$disconnect();
  });

  it("uses the required PostgreSQL physical fields and defaults", async () => {
    const columns = await prisma.$queryRaw<
      Array<{
        column_default: string | null;
        column_name: string;
        data_type: string;
        datetime_precision: number | null;
        is_nullable: "NO" | "YES";
        udt_name: string;
      }>
    >`
      SELECT column_name, data_type, udt_name, is_nullable, column_default, datetime_precision
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'audit_log'
      ORDER BY ordinal_position
    `;

    expect(columns).toEqual([
      expect.objectContaining({
        column_default: "uuidv7()",
        column_name: "id",
        data_type: "uuid",
        is_nullable: "NO",
      }),
      expect.objectContaining({ column_name: "tenant_id", data_type: "uuid", is_nullable: "YES" }),
      expect.objectContaining({ column_name: "actor_type", data_type: "text", is_nullable: "NO" }),
      expect.objectContaining({ column_name: "actor_id", data_type: "text", is_nullable: "YES" }),
      expect.objectContaining({ column_name: "action", data_type: "text", is_nullable: "NO" }),
      expect.objectContaining({ column_name: "entity_type", data_type: "text", is_nullable: "NO" }),
      expect.objectContaining({ column_name: "entity_id", data_type: "text", is_nullable: "NO" }),
      expect.objectContaining({
        column_name: "organization_unit_id",
        data_type: "uuid",
        is_nullable: "YES",
      }),
      expect.objectContaining({
        column_name: "before_summary",
        is_nullable: "YES",
        udt_name: "jsonb",
      }),
      expect.objectContaining({
        column_name: "after_summary",
        is_nullable: "YES",
        udt_name: "jsonb",
      }),
      expect.objectContaining({ column_name: "request_id", data_type: "text", is_nullable: "NO" }),
      expect.objectContaining({
        column_name: "ip_metadata",
        is_nullable: "YES",
        udt_name: "jsonb",
      }),
      expect.objectContaining({
        column_default: "CURRENT_TIMESTAMP",
        column_name: "occurred_at",
        data_type: "timestamp with time zone",
        datetime_precision: 3,
        is_nullable: "NO",
      }),
    ]);
  });

  it("injects and isolates tenant audit with summaries and request metadata", async () => {
    const [auditA, auditB] = await Promise.all([
      tenantA.audit.append({
        action: "tenant.entitlement.updated",
        actorId: "01989f20-5000-7000-8000-000000000001",
        actorType: "user",
        afterSummary: { enabled: true },
        beforeSummary: { enabled: false },
        entityId: tenantAId,
        entityType: "TenantEntitlement",
        ipMetadata: { address: "192.0.2.10", source: "direct" },
        organizationUnitId: unitAId,
        requestId: "e01-s05-tenant-a-append",
      }),
      tenantB.audit.append({
        action: "organization_unit.updated",
        actorType: "system",
        entityId: unitBId,
        entityType: "OrganizationUnit",
        organizationUnitId: unitBId,
        requestId: "e01-s05-tenant-b-append",
      }),
    ]);

    expect(auditA).toMatchObject({
      actorType: "user",
      afterSummary: { enabled: true },
      beforeSummary: { enabled: false },
      ipMetadata: { address: "192.0.2.10", source: "direct" },
      tenantId: tenantAId,
    });
    expect(auditB).toMatchObject({ actorId: null, ipMetadata: null, tenantId: tenantBId });
  });

  it("supports actor variants without creating actor records", async () => {
    const [userAudit, systemAudit, externalAudit] = await Promise.all([
      tenantA.audit.append({
        action: "actor.user",
        actorId: "user-42",
        actorType: "user",
        entityId: tenantAId,
        entityType: "Tenant",
        requestId: "e01-s05-actor-user",
      }),
      tenantA.audit.append({
        action: "actor.system",
        actorType: "system",
        entityId: tenantAId,
        entityType: "Tenant",
        requestId: "e01-s05-actor-system",
      }),
      tenantA.audit.append({
        action: "actor.external",
        actorType: "external_human_unknown",
        entityId: tenantAId,
        entityType: "Tenant",
        requestId: "e01-s05-actor-external",
      }),
    ]);

    expect(userAudit.actorId).toBe("user-42");
    expect(systemAudit.actorId).toBeNull();
    expect(externalAudit.actorId).toBeNull();
  });

  it("rejects an organization unit owned by another tenant", async () => {
    await expect(
      tenantA.audit.append({
        action: "organization_unit.cross_tenant",
        actorType: "system",
        entityId: unitBId,
        entityType: "OrganizationUnit",
        organizationUnitId: unitBId,
        requestId: "e01-s05-cross-tenant-ou",
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    await expect(
      prisma.auditLog.count({ where: { requestId: "e01-s05-cross-tenant-ou" } }),
    ).resolves.toBe(0);
  });

  it("creates pure and tenant-related audit only through the platform writer", async () => {
    const [purePlatform, tenantRelated] = await Promise.all([
      platformAudit.append({
        action: "platform_feature_flag.updated",
        actorType: "system",
        afterSummary: { enabled: true },
        entityId: "foundation.preview",
        entityType: "PlatformFeatureFlag",
        requestId: "e01-s05-platform-pure",
      }),
      platformAudit.append({
        action: "tenant.reviewed",
        actorType: "system",
        entityId: tenantAId,
        entityType: "Tenant",
        requestId: "e01-s05-platform-tenant",
        tenantId: tenantAId,
      }),
    ]);

    expect(purePlatform).toMatchObject({ organizationUnitId: null, tenantId: null });
    expect(tenantRelated.tenantId).toBe(tenantAId);
    const [version] = await prisma.$queryRaw<Array<{ version: number }>>`
      SELECT uuid_extract_version(${purePlatform.id}::uuid) AS version
    `;
    expect(version?.version).toBe(7);
    expect(purePlatform.occurredAt).toBeInstanceOf(Date);
  });

  it("rejects an organization unit on pure platform audit", async () => {
    await expect(
      platformAudit.append({
        action: "platform.invalid_organization_unit",
        actorType: "system",
        entityId: unitAId,
        entityType: "OrganizationUnit",
        organizationUnitId: unitAId,
        requestId: "e01-s05-platform-invalid-ou",
      }),
    ).rejects.toThrow();
  });

  it("commits domain, audit, and outbox in one tenant transaction", async () => {
    const result = await withTenantTransaction(
      createTenantContext(tenantAId),
      prisma,
      async (data) => {
        const entitlement = await data.entitlements.create({
          entitlementKey: "module.audit-commit",
          source: "contract",
        });
        const audit = await data.audit.append({
          action: "tenant.entitlement.created",
          actorType: "system",
          afterSummary: { enabled: false },
          entityId: entitlement.id,
          entityType: "TenantEntitlement",
          requestId: "e01-s05-transaction-commit",
        });
        const event = await data.outbox.append({
          aggregateId: entitlement.id,
          aggregateType: "TenantEntitlement",
          eventType: "tenant.entitlement.created",
          payload: { enabled: false },
        });
        return { audit, entitlement, event };
      },
    );

    expect(result.audit).toMatchObject({ entityId: result.entitlement.id, tenantId: tenantAId });
    expect(result.event).toMatchObject({ aggregateId: result.entitlement.id, tenantId: tenantAId });
    await expect(
      prisma.tenantEntitlement.count({ where: { id: result.entitlement.id } }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({ where: { requestId: "e01-s05-transaction-commit" } }),
    ).resolves.toBe(1);
    await expect(prisma.domainEventOutbox.count({ where: { id: result.event.id } })).resolves.toBe(
      1,
    );
  });

  it("rolls back domain, audit, and outbox when the transaction callback fails", async () => {
    const entitlementKey = "module.audit-forced-rollback";
    await expect(
      withTenantTransaction(createTenantContext(tenantAId), prisma, async (data) => {
        const entitlement = await data.entitlements.create({ entitlementKey, source: "contract" });
        await data.audit.append({
          action: "tenant.entitlement.created.rollback",
          actorType: "system",
          entityId: entitlement.id,
          entityType: "TenantEntitlement",
          requestId: "e01-s05-transaction-rollback",
        });
        await data.outbox.append({
          aggregateId: entitlement.id,
          aggregateType: "TenantEntitlement",
          eventType: "tenant.entitlement.created.rollback",
          payload: { entitlementKey },
        });
        throw new Error("intentional audit transaction rollback");
      }),
    ).rejects.toThrow("intentional audit transaction rollback");

    await expect(
      prisma.tenantEntitlement.count({ where: { entitlementKey, tenantId: tenantAId } }),
    ).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({ where: { requestId: "e01-s05-transaction-rollback" } }),
    ).resolves.toBe(0);
    await expect(
      prisma.domainEventOutbox.count({
        where: { eventType: "tenant.entitlement.created.rollback", tenantId: tenantAId },
      }),
    ).resolves.toBe(0);
  });

  it("rolls back the domain change when audit persistence fails", async () => {
    const entitlementKey = "module.audit-invalid-entry";
    await expect(
      withTenantTransaction(createTenantContext(tenantAId), prisma, async (data) => {
        const entitlement = await data.entitlements.create({ entitlementKey, source: "contract" });
        await data.audit.append({
          action: "tenant.entitlement.invalid",
          actorType: "system",
          entityId: entitlement.id,
          entityType: "TenantEntitlement",
          organizationUnitId: "not-a-uuid",
          requestId: "e01-s05-audit-failure",
        });
      }),
    ).rejects.toThrow();

    await expect(
      prisma.tenantEntitlement.count({ where: { entitlementKey, tenantId: tenantAId } }),
    ).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({ where: { requestId: "e01-s05-audit-failure" } }),
    ).resolves.toBe(0);
  });
});
