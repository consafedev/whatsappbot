import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTenantContext,
  createTenantDataAccess,
  type TenantDataAccess,
  withTenantTransaction,
} from "./index";
import { createPlatformDatabaseClient, type PrismaClient } from "./platform";

const slugs = {
  tenantA: "e01-s04-tenant-a",
  tenantB: "e01-s04-tenant-b",
} as const;

let prisma: PrismaClient;
let tenantA: TenantDataAccess;
let tenantB: TenantDataAccess;
let tenantAId: string;
let tenantBId: string;
let unitBId: string;

async function cleanFixtures(): Promise<void> {
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

describe.sequential("transactional outbox integration", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanFixtures();

    const [createdTenantA, createdTenantB] = await Promise.all([
      prisma.tenant.create({
        data: {
          defaultCurrency: "MXN",
          defaultLocale: "es-MX",
          defaultTimezone: "America/Mexico_City",
          displayName: "E01-S04 Tenant A",
          legalName: "E01-S04 Tenant A SA de CV",
          slug: slugs.tenantA,
          status: "active",
        },
      }),
      prisma.tenant.create({
        data: {
          defaultCurrency: "MXN",
          defaultLocale: "es-MX",
          defaultTimezone: "America/Mexico_City",
          displayName: "E01-S04 Tenant B",
          legalName: "E01-S04 Tenant B SA de CV",
          slug: slugs.tenantB,
          status: "active",
        },
      }),
    ]);

    tenantAId = createdTenantA.id;
    tenantBId = createdTenantB.id;
    tenantA = createTenantDataAccess(createTenantContext(tenantAId), prisma);
    tenantB = createTenantDataAccess(createTenantContext(tenantBId), prisma);
    unitBId = (
      await tenantB.organizationUnits.create({ name: "Tenant B Aggregate", type: "company" })
    ).id;
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
      WHERE table_schema = current_schema() AND table_name = 'domain_event_outbox'
      ORDER BY ordinal_position
    `;

    expect(columns).toEqual([
      expect.objectContaining({
        column_default: "uuidv7()",
        column_name: "id",
        data_type: "uuid",
        is_nullable: "NO",
      }),
      expect.objectContaining({ column_name: "tenant_id", data_type: "uuid", is_nullable: "NO" }),
      expect.objectContaining({ column_name: "event_type", data_type: "text", is_nullable: "NO" }),
      expect.objectContaining({
        column_name: "aggregate_type",
        data_type: "text",
        is_nullable: "NO",
      }),
      expect.objectContaining({
        column_name: "aggregate_id",
        data_type: "uuid",
        is_nullable: "NO",
      }),
      expect.objectContaining({ column_name: "payload", is_nullable: "NO", udt_name: "jsonb" }),
      expect.objectContaining({
        column_default: "CURRENT_TIMESTAMP",
        column_name: "occurred_at",
        data_type: "timestamp with time zone",
        datetime_precision: 3,
        is_nullable: "NO",
      }),
      expect.objectContaining({
        column_name: "published_at",
        data_type: "timestamp with time zone",
        datetime_precision: 3,
        is_nullable: "YES",
      }),
      expect.objectContaining({
        column_default: "0",
        column_name: "attempts",
        data_type: "integer",
        is_nullable: "NO",
      }),
      expect.objectContaining({ column_name: "last_error", data_type: "text", is_nullable: "YES" }),
    ]);
  });

  it("commits a domain write and its outbox event atomically", async () => {
    const result = await withTenantTransaction(
      createTenantContext(tenantAId),
      prisma,
      async (data) => {
        const unit = await data.organizationUnits.create({ name: "Outbox commit", type: "team" });
        const event = await data.outbox.append({
          aggregateId: unit.id,
          aggregateType: "OrganizationUnit",
          eventType: "tenant.organization_unit.created",
          payload: {
            enabled: true,
            metadata: { origin: "integration-test", tags: ["foundation", "outbox"] },
            nullableValue: null,
            priority: 1,
          },
        });
        return { event, unit };
      },
    );

    await expect(
      prisma.organizationUnit.findUnique({ where: { id: result.unit.id } }),
    ).resolves.toBeTruthy();
    await expect(
      prisma.domainEventOutbox.findUnique({ where: { id: result.event.id } }),
    ).resolves.toMatchObject({
      aggregateId: result.unit.id,
      aggregateType: "OrganizationUnit",
      attempts: 0,
      eventType: "tenant.organization_unit.created",
      lastError: null,
      payload: {
        enabled: true,
        metadata: { origin: "integration-test", tags: ["foundation", "outbox"] },
        nullableValue: null,
        priority: 1,
      },
      publishedAt: null,
      tenantId: tenantAId,
    });
    expect(result.event.occurredAt).toBeInstanceOf(Date);
    const [version] = await prisma.$queryRaw<Array<{ version: number }>>`
      SELECT uuid_extract_version(${result.event.id}::uuid) AS version
    `;
    expect(version?.version).toBe(7);
  });

  it("rolls back both writes when the callback fails before commit", async () => {
    const unitName = "Outbox forced rollback";

    await expect(
      withTenantTransaction(createTenantContext(tenantAId), prisma, async (data) => {
        const unit = await data.organizationUnits.create({ name: unitName, type: "team" });
        await data.outbox.append({
          aggregateId: unit.id,
          aggregateType: "OrganizationUnit",
          eventType: "tenant.organization_unit.created.rollback",
          payload: { unitName },
        });
        throw new Error("intentional rollback");
      }),
    ).rejects.toThrow("intentional rollback");

    await expect(
      prisma.organizationUnit.findFirst({ where: { name: unitName, tenantId: tenantAId } }),
    ).resolves.toBeNull();
    await expect(
      prisma.domainEventOutbox.findFirst({
        where: { eventType: "tenant.organization_unit.created.rollback", tenantId: tenantAId },
      }),
    ).resolves.toBeNull();
  });

  it("rolls back the domain write when the outbox insert fails", async () => {
    const unitName = "Outbox invalid event";

    await expect(
      withTenantTransaction(createTenantContext(tenantAId), prisma, async (data) => {
        await data.organizationUnits.create({ name: unitName, type: "team" });
        await data.outbox.append({
          aggregateId: "not-a-uuid",
          aggregateType: "OrganizationUnit",
          eventType: "tenant.organization_unit.created.invalid",
          payload: { unitName },
        });
      }),
    ).rejects.toThrow();

    await expect(
      prisma.organizationUnit.findFirst({ where: { name: unitName, tenantId: tenantAId } }),
    ).resolves.toBeNull();
    await expect(
      prisma.domainEventOutbox.findFirst({
        where: { eventType: "tenant.organization_unit.created.invalid", tenantId: tenantAId },
      }),
    ).resolves.toBeNull();
  });

  it("injects and isolates tenant ids for two contexts on the same client", async () => {
    const [eventA, eventB] = await Promise.all([
      tenantA.outbox.append({
        aggregateId: tenantAId,
        aggregateType: "Tenant",
        eventType: "tenant.context-a.tested",
        payload: { context: "A" },
      }),
      tenantB.outbox.append({
        aggregateId: tenantBId,
        aggregateType: "Tenant",
        eventType: "tenant.context-b.tested",
        payload: { context: "B" },
      }),
    ]);

    expect(eventA.tenantId).toBe(tenantAId);
    expect(eventB.tenantId).toBe(tenantBId);
  });

  it("does not append an event for an aggregate hidden by tenant scope", async () => {
    const aggregateFromTenantA = await tenantA.organizationUnits.findById(unitBId);
    expect(aggregateFromTenantA).toBeNull();

    if (aggregateFromTenantA !== null) {
      await tenantA.outbox.append({
        aggregateId: aggregateFromTenantA.id,
        aggregateType: "OrganizationUnit",
        eventType: "organization_unit.created.cross-tenant",
        payload: { name: aggregateFromTenantA.name },
      });
    }

    await expect(
      prisma.domainEventOutbox.count({
        where: {
          aggregateId: unitBId,
          eventType: "organization_unit.created.cross-tenant",
          tenantId: tenantAId,
        },
      }),
    ).resolves.toBe(0);
  });
});
