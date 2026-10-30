import { loadDatabaseConfig } from "@whatsapp-platform/config";
import type { PermissionKey } from "@whatsapp-platform/rbac";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPlatformDatabaseClient,
  Prisma,
  type PrismaClient,
  syncPermissionCatalog,
} from "./platform";
import {
  approveQuote,
  cancelQuote,
  type QuoteApprovalDatabase,
  rejectQuote,
  requestQuoteApproval,
} from "./quote-approval-manager";
import { calculateQuote } from "./quote-calculation";
import { quoteTenantPolicyLock } from "./quote-command-locks";
import {
  createQuoteDraft,
  QuoteAuthorizationError,
  QuoteCommandConflictError,
  type QuoteDraftInput,
  QuoteRevisionConflictError,
  QuoteValidationError,
  updateQuoteDraft,
} from "./quote-manager";
import { updateQuotePolicy } from "./quote-policy-manager";
import { createTenantContext } from "./tenant-context";
import { createTenantDataAccess } from "./tenant-data-access";

const prefix = "e15-s05-quote-approval";
const commandMetadata = (actorUserId: string, requestId: string) => ({ actorUserId, requestId });
let prisma: PrismaClient;
let tenantId = "";
let unitId = "";
let contactId = "";
let authorId = "";
let approverId = "";
let context: ReturnType<typeof createTenantContext>;

async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    where: { slug: { startsWith: prefix } },
  });
  const ids = tenants.map(({ id }) => id);
  await prisma.quote.updateMany({
    where: { tenantId: { in: ids } },
    data: { currentApprovalId: null },
  });
  await prisma.quoteApproval.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.quoteCommercialContributor.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.quoteCommandReceipt.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.quoteItem.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.quote.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.quotePolicy.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.userRole.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: ids } } } });
  await prisma.role.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.contact.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

async function createActor(marker: string, permissions: readonly PermissionKey[]): Promise<string> {
  const user = await prisma.user.create({
    data: {
      tenantId,
      displayName: `Approval ${marker}`,
      email: `${prefix}-${marker}@example.invalid`,
      passwordHash: "integration-only-not-a-real-password-hash",
      locale: "es-MX",
      timezone: "UTC",
    },
  });
  const access = createTenantDataAccess(context, prisma);
  const role = await access.roles.createCustom({
    key: `${prefix}-${marker}`,
    name: `Approval ${marker}`,
  });
  for (const permission of permissions) await access.rolePermissions.grant(role.id, permission);
  await access.userRoles.assign({ roleId: role.id, userId: user.id });
  return user.id;
}

function draft(key: string, validUntil?: string, selectedContactId = contactId): QuoteDraftInput {
  return {
    idempotencyKey: key,
    organizationUnitId: unitId,
    contactId: selectedContactId,
    currency: "USD",
    ...(validUntil === undefined ? {} : { validUntil }),
    lines: [
      {
        productId: null,
        description: "Manual quote line",
        unit: "piece",
        quantity: "2",
        unitPrice: "10.00",
        currency: "USD",
        taxRate: "0",
      },
    ],
  };
}

function canonicalCalculation() {
  return calculateQuote({
    currency: "USD",
    currencyPrecision: 2,
    shippingTotal: "0",
    lines: [
      {
        quantity: "2",
        unitPrice: "10",
        discountType: "fixed",
        discountValue: "0",
        taxRate: "0",
        currency: "USD",
      },
    ],
  });
}

async function poisonCalculation(quoteId: string, revision: number): Promise<void> {
  await Promise.all([
    prisma.quote.update({
      where: { tenantId_id: { tenantId, id: quoteId } },
      data: {
        calculatedRevision: revision,
        calculationInputHash: "f".repeat(64),
        subtotal: "999",
        discountTotal: "999",
        taxTotal: "999",
        total: "999",
      },
    }),
    prisma.quoteItem.updateMany({
      where: { tenantId, quoteId },
      data: {
        grossTotal: "999",
        discountTotal: "999",
        netTotal: "999",
        taxTotal: "999",
        lineTotal: "999",
      },
    }),
  ]);
}

async function expectCanonicalCalculation(quoteId: string, revision: number): Promise<void> {
  const expected = canonicalCalculation();
  const quote = await prisma.quote.findUnique({
    where: { tenantId_id: { tenantId, id: quoteId } },
  });
  const [line] = await prisma.quoteItem.findMany({
    where: { tenantId, quoteId },
    orderBy: { position: "asc" },
  });
  expect(quote).toMatchObject({
    calculatedRevision: revision,
    calculationInputHash: expected.calculationInputHash,
  });
  expect([
    quote?.subtotal?.toFixed(2),
    quote?.discountTotal?.toFixed(2),
    quote?.taxTotal?.toFixed(2),
    quote?.total?.toFixed(2),
    line?.grossTotal?.toFixed(2),
    line?.discountTotal?.toFixed(2),
    line?.netTotal?.toFixed(2),
    line?.taxTotal?.toFixed(2),
    line?.lineTotal?.toFixed(2),
  ]).toEqual(["20.00", "0.00", "0.00", "20.00", "20.00", "0.00", "20.00", "0.00", "20.00"]);
}

async function createDraft(key: string, validUntil?: string, selectedContactId = contactId) {
  return createQuoteDraft(
    context,
    prisma,
    draft(key, validUntil, selectedContactId),
    commandMetadata(authorId, `${key}-create`),
  );
}

async function request(quoteId: string, revision: number, key: string) {
  return requestQuoteApproval(
    context,
    prisma,
    quoteId,
    revision,
    { idempotencyKey: key },
    commandMetadata(authorId, `${key}-request`),
  );
}

async function waitForPolicyLockWait(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [waiting] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND state = 'active'
        AND query LIKE '%pg_advisory_xact_lock%'
    `;
    if ((waiting?.count ?? 0n) > 0n) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Approval request did not wait on its PostgreSQL policy advisory lock");
}

function failNextApprovalOutboxWriteDatabase(): QuoteApprovalDatabase {
  const database = {
    $transaction: <T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>) =>
      prisma.$transaction((transaction) =>
        callback(
          new Proxy(transaction, {
            get(target, property) {
              if (property === "domainEventOutbox") {
                return new Proxy(target.domainEventOutbox, {
                  get(delegate, method) {
                    if (method === "create")
                      return async () => {
                        throw new Error("injected approval Outbox failure");
                      };
                    const value = Reflect.get(delegate, method, delegate) as unknown;
                    return typeof value === "function" ? value.bind(delegate) : value;
                  },
                });
              }
              const value = Reflect.get(target, property, target) as unknown;
              return typeof value === "function" ? value.bind(target) : value;
            },
          }) as Prisma.TransactionClient,
        ),
      ),
  };
  return database as unknown as QuoteApprovalDatabase;
}

describe.sequential("E15-S05 quote approval workflow", () => {
  beforeAll(async () => {
    prisma = createPlatformDatabaseClient(loadDatabaseConfig());
    await prisma.$connect();
    await cleanup();
    await syncPermissionCatalog(prisma);
    const tenant = await prisma.tenant.create({
      data: {
        defaultCurrency: "USD",
        defaultLocale: "en-US",
        defaultTimezone: "UTC",
        displayName: "Approval tenant",
        legalName: "Approval tenant",
        slug: `${prefix}-tenant`,
        status: "active",
      },
    });
    tenantId = tenant.id;
    context = createTenantContext(tenantId);
    const [unit, contact] = await Promise.all([
      prisma.organizationUnit.create({ data: { tenantId, name: "Sales", type: "branch" } }),
      prisma.contact.create({ data: { tenantId, name: "Customer", phoneNumber: "+15550001234" } }),
    ]);
    unitId = unit.id;
    contactId = contact.id;
    authorId = await createActor("author", ["quotes.create", "quotes.approve"]);
    approverId = await createActor("approver", ["quotes.approve", "tenant.settings.manage"]);
    await Promise.all(
      ["module.quotes", "module.crm_lite"].map((entitlementKey) =>
        prisma.tenantEntitlement.create({
          data: { tenantId, entitlementKey, enabled: true, source: "contract" },
        }),
      ),
    );
  });

  afterAll(async () => {
    if (prisma !== undefined) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it("keeps request and decision history, binds resulting revisions, and enforces contributor separation", async () => {
    const created = await createDraft("lifecycle-source");
    await expect(request(created.current.id, 2, "lifecycle-stale-request")).rejects.toBeInstanceOf(
      QuoteRevisionConflictError,
    );
    const first = await request(created.current.id, 1, "lifecycle-request-one");
    expect(first).toMatchObject({
      recordedOutcome: { status: "pending_approval", revision: 2 },
      current: {
        status: "pending",
        quoteStatus: "pending_approval",
        revision: 2,
        resultingRevision: 2,
        policyRevision: 0,
      },
    });
    expect(
      await prisma.domainEventOutbox.findFirst({
        where: { tenantId, aggregateId: created.current.id, eventType: "quote.approval.requested" },
      }),
    ).not.toBeNull();
    expect(first.current.policyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await prisma.quote.findUnique({
        where: { tenantId_id: { tenantId, id: created.current.id } },
      }),
    ).toMatchObject({
      revision: 2,
      calculatedRevision: 2,
      approvalPolicyRevision: 0,
      approvalPolicyHash: first.current.policyHash,
    });
    await expect(
      approveQuote(
        context,
        prisma,
        created.current.id,
        2,
        { idempotencyKey: "lifecycle-self", reasonCode: "reviewed" },
        commandMetadata(authorId, "lifecycle-self"),
      ),
    ).rejects.toBeInstanceOf(QuoteAuthorizationError);
    await expect(
      request(created.current.id, 2, "lifecycle-duplicate-current-pending"),
    ).rejects.toBeInstanceOf(QuoteCommandConflictError);
    expect(
      await prisma.quoteApproval.count({ where: { tenantId, quoteId: created.current.id } }),
    ).toBe(1);
    expect(
      await prisma.quoteCommandReceipt.count({
        where: { tenantId, idempotencyKey: "lifecycle-duplicate-current-pending" },
      }),
    ).toBe(0);
    await expect(
      approveQuote(
        context,
        prisma,
        created.current.id,
        1,
        { idempotencyKey: "lifecycle-stale-approve", reasonCode: "reviewed" },
        commandMetadata(approverId, "lifecycle-stale-approve"),
      ),
    ).rejects.toBeInstanceOf(QuoteRevisionConflictError);

    const approved = await approveQuote(
      context,
      prisma,
      created.current.id,
      2,
      {
        idempotencyKey: "lifecycle-approve",
        reasonCode: "reviewed",
        note: "Checked commercial terms",
      },
      commandMetadata(approverId, "lifecycle-approve"),
    );
    expect(approved).toMatchObject({
      recordedOutcome: { status: "approved", revision: 3 },
      current: {
        status: "approved",
        quoteStatus: "approved",
        revision: 3,
        resultingRevision: 3,
        decisionActorType: "tenant_user",
        decisionActorUserId: approverId,
        decisionReasonCode: "reviewed",
      },
    });
    const rows = await prisma.quoteApproval.findMany({
      where: { tenantId, quoteId: created.current.id },
      orderBy: { requestedAt: "asc" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceRevision: 1,
      resultingRevision: 3,
      status: "approved",
      allowSelfApprovalSnapshot: false,
    });

    const reauthorized = await request(created.current.id, 3, "lifecycle-request-after-approval");
    expect(reauthorized).toMatchObject({
      recordedOutcome: { status: "pending_approval", revision: 4 },
      current: { status: "pending", revision: 4 },
    });
    expect(
      await prisma.quoteApproval.count({ where: { tenantId, quoteId: created.current.id } }),
    ).toBe(2);
    const rejected = await rejectQuote(
      context,
      prisma,
      created.current.id,
      4,
      { idempotencyKey: "lifecycle-reject", reasonCode: "needs_changes" },
      commandMetadata(approverId, "lifecycle-reject"),
    );
    expect(rejected.current).toMatchObject({
      status: "rejected",
      revision: 5,
      resultingRevision: 5,
    });
    const fromRejected = await request(created.current.id, 5, "lifecycle-request-after-reject");
    expect(fromRejected.current).toMatchObject({
      status: "pending",
      revision: 6,
      resultingRevision: 6,
    });
    expect(
      await prisma.quote.findUnique({
        where: { tenantId_id: { tenantId, id: created.current.id } },
      }),
    ).toMatchObject({ revision: 6, calculatedRevision: 6 });
  });

  it("denies approval to a material editor who is not the quote creator", async () => {
    const editorId = await createActor("editor", ["quotes.create", "quotes.approve"]);
    const created = await createDraft("editor-sod-source");
    const edited = await updateQuoteDraft(
      context,
      prisma,
      created.current.id,
      1,
      { idempotencyKey: "editor-sod-edit", metadata: { notes: "Material edit by a second user" } },
      commandMetadata(editorId, "editor-sod-edit"),
    );
    expect(
      await prisma.quoteCommercialContributor.findUnique({
        where: {
          tenantId_quoteId_userId: { tenantId, quoteId: created.current.id, userId: editorId },
        },
      }),
    ).not.toBeNull();
    const pending = await request(
      created.current.id,
      edited.current.revision,
      "editor-sod-request",
    );
    await expect(
      approveQuote(
        context,
        prisma,
        created.current.id,
        pending.current.revision,
        { idempotencyKey: "editor-sod-approve", reasonCode: "reviewed" },
        commandMetadata(editorId, "editor-sod-approve"),
      ),
    ).rejects.toBeInstanceOf(QuoteAuthorizationError);
  });

  it("recalculates canonical totals and hashes on request, approve, reject, and calculated cancellation", async () => {
    const created = await createDraft("canonical-authority-source");
    await poisonCalculation(created.current.id, 1);
    const requested = await request(created.current.id, 1, "canonical-authority-request");
    expect(requested.current).toMatchObject({ revision: 2, quoteStatus: "pending_approval" });
    await expectCanonicalCalculation(created.current.id, 2);

    await poisonCalculation(created.current.id, 2);
    const approved = await approveQuote(
      context,
      prisma,
      created.current.id,
      2,
      { idempotencyKey: "canonical-authority-approve", reasonCode: "reviewed" },
      commandMetadata(approverId, "canonical-authority-approve"),
    );
    expect(approved.current).toMatchObject({ revision: 3, quoteStatus: "approved" });
    await expectCanonicalCalculation(created.current.id, 3);

    const reauthorized = await request(created.current.id, 3, "canonical-authority-rerequest");
    expect(reauthorized.current).toMatchObject({ revision: 4, quoteStatus: "pending_approval" });
    await poisonCalculation(created.current.id, 4);
    const rejected = await rejectQuote(
      context,
      prisma,
      created.current.id,
      4,
      { idempotencyKey: "canonical-authority-reject", reasonCode: "needs_changes" },
      commandMetadata(approverId, "canonical-authority-reject"),
    );
    expect(rejected.current).toMatchObject({ revision: 5, quoteStatus: "rejected" });
    await expectCanonicalCalculation(created.current.id, 5);

    await poisonCalculation(created.current.id, 5);
    const cancelled = await cancelQuote(
      context,
      prisma,
      created.current.id,
      5,
      { idempotencyKey: "canonical-authority-cancel" },
      commandMetadata(authorId, "canonical-authority-cancel"),
    );
    expect(cancelled.current).toMatchObject({ revision: 6, status: "cancelled" });
    await expectCanonicalCalculation(created.current.id, 6);
  });

  it("keeps sent, accepted, and expired quote states terminal for every S05 mutation", async () => {
    for (const terminalStatus of ["sent", "accepted", "expired"] as const) {
      const terminalContact = await prisma.contact.create({
        data: {
          tenantId,
          name: `Terminal ${terminalStatus}`,
          phoneNumber: `+15550001${terminalStatus === "sent" ? "01" : terminalStatus === "accepted" ? "02" : "03"}`,
        },
      });
      const created = await createDraft(
        `terminal-${terminalStatus}-source`,
        undefined,
        terminalContact.id,
      );
      await prisma.quote.update({
        where: { tenantId_id: { tenantId, id: created.current.id } },
        data: { status: terminalStatus },
      });
      await expect(
        request(created.current.id, 1, `terminal-${terminalStatus}-request`),
      ).rejects.toBeInstanceOf(QuoteValidationError);
      await expect(
        updateQuoteDraft(
          context,
          prisma,
          created.current.id,
          1,
          {
            idempotencyKey: `terminal-${terminalStatus}-edit`,
            metadata: { notes: "must remain terminal" },
          },
          commandMetadata(authorId, `terminal-${terminalStatus}-edit`),
        ),
      ).rejects.toBeInstanceOf(QuoteValidationError);
      await expect(
        approveQuote(
          context,
          prisma,
          created.current.id,
          1,
          { idempotencyKey: `terminal-${terminalStatus}-approve`, reasonCode: "reviewed" },
          commandMetadata(approverId, `terminal-${terminalStatus}-approve`),
        ),
      ).rejects.toBeInstanceOf(QuoteCommandConflictError);
      await expect(
        rejectQuote(
          context,
          prisma,
          created.current.id,
          1,
          { idempotencyKey: `terminal-${terminalStatus}-reject`, reasonCode: "needs_changes" },
          commandMetadata(approverId, `terminal-${terminalStatus}-reject`),
        ),
      ).rejects.toBeInstanceOf(QuoteCommandConflictError);
      await expect(
        cancelQuote(
          context,
          prisma,
          created.current.id,
          1,
          { idempotencyKey: `terminal-${terminalStatus}-cancel` },
          commandMetadata(authorId, `terminal-${terminalStatus}-cancel`),
        ),
      ).rejects.toBeInstanceOf(QuoteValidationError);
      expect(
        await prisma.quote.findUnique({
          where: { tenantId_id: { tenantId, id: created.current.id } },
        }),
      ).toMatchObject({ status: terminalStatus, revision: 1 });
    }
  });

  it("enforces policy-binding, decision-actor, and current-approval foreign-key checks in PostgreSQL", async () => {
    const first = await createDraft("sql-guard-first");
    const second = await createDraft("sql-guard-second");
    await expect(
      prisma.quote.update({
        where: { tenantId_id: { tenantId, id: first.current.id } },
        data: { approvalPolicyRevision: 0 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw(Prisma.sql`
        INSERT INTO "quote_approvals" (
          "tenant_id", "quote_id", "source_revision", "resulting_revision",
          "policy_revision", "policy_hash", "allow_self_approval_snapshot",
          "request_actor_user_id", "status", "request_reason_codes",
          "decision_actor_type", "decision_reason_code", "decided_at"
        ) VALUES (
          ${tenantId}::uuid, ${first.current.id}::uuid, 1, 1, 0,
          ${"0".repeat(64)}, false, ${authorId}::uuid, 'approved', '[]'::jsonb,
          'tenant_user', 'reviewed', CURRENT_TIMESTAMP
        )
      `),
    ).rejects.toThrow();
    const validPending = await prisma.quoteApproval.create({
      data: {
        tenantId,
        quoteId: first.current.id,
        sourceRevision: 1,
        resultingRevision: 1,
        policyRevision: 0,
        policyHash: "0".repeat(64),
        allowSelfApprovalSnapshot: false,
        requestActorUserId: authorId,
        status: "pending",
        requestReasonCodes: [],
      },
    });
    await expect(
      prisma.quote.update({
        where: { tenantId_id: { tenantId, id: second.current.id } },
        data: { currentApprovalId: validPending.id },
      }),
    ).rejects.toThrow();
  });

  it("rolls back approval, quote revision, receipt, audit, and Outbox together", async () => {
    const created = await createDraft("rollback-source");
    const before = {
      audits: await prisma.auditLog.count({ where: { tenantId, entityId: created.current.id } }),
      outbox: await prisma.domainEventOutbox.count({
        where: { tenantId, aggregateId: created.current.id },
      }),
      receipts: await prisma.quoteCommandReceipt.count({
        where: { tenantId, resourceId: created.current.id },
      }),
      approvals: await prisma.quoteApproval.count({
        where: { tenantId, quoteId: created.current.id },
      }),
    };
    await expect(
      requestQuoteApproval(
        context,
        failNextApprovalOutboxWriteDatabase(),
        created.current.id,
        1,
        { idempotencyKey: "rollback-approval-request" },
        commandMetadata(authorId, "rollback-approval-request"),
      ),
    ).rejects.toThrow("injected approval Outbox failure");
    expect(
      await prisma.quote.findUnique({
        where: { tenantId_id: { tenantId, id: created.current.id } },
      }),
    ).toMatchObject({
      status: "draft",
      revision: 1,
      calculatedRevision: 1,
      currentApprovalId: null,
    });
    expect(await prisma.auditLog.count({ where: { tenantId, entityId: created.current.id } })).toBe(
      before.audits,
    );
    expect(
      await prisma.domainEventOutbox.count({
        where: { tenantId, aggregateId: created.current.id },
      }),
    ).toBe(before.outbox);
    expect(
      await prisma.quoteCommandReceipt.count({
        where: { tenantId, resourceId: created.current.id },
      }),
    ).toBe(before.receipts);
    expect(
      await prisma.quoteApproval.count({ where: { tenantId, quoteId: created.current.id } }),
    ).toBe(before.approvals);
  });

  it("allows a changed edit to clear current approval while retaining immutable history", async () => {
    const created = await createDraft("edit-source");
    const requested = await request(created.current.id, 1, "edit-request");
    const edited = await updateQuoteDraft(
      context,
      prisma,
      created.current.id,
      2,
      { idempotencyKey: "edit-after-request", metadata: { notes: "Changed after review request" } },
      commandMetadata(authorId, "edit-after-request"),
    );
    expect(edited.current).toMatchObject({ status: "draft", revision: 3, calculatedRevision: 3 });
    const row = await prisma.quote.findUnique({
      where: { tenantId_id: { tenantId, id: created.current.id } },
    });
    expect(row).toMatchObject({
      approvalPolicyRevision: null,
      approvalPolicyHash: null,
      currentApprovalId: null,
    });
    expect(
      await prisma.quoteApproval.findUnique({
        where: { tenantId_id: { tenantId, id: requested.current.id } },
      }),
    ).toMatchObject({ status: "pending", resultingRevision: 2 });
    const next = await request(created.current.id, 3, "edit-re-request");
    expect(next.current.id).not.toBe(requested.current.id);
    expect(
      await prisma.quoteApproval.count({ where: { tenantId, quoteId: created.current.id } }),
    ).toBe(2);
  });

  it("rejects a changed policy binding and requires a fresh request revision", async () => {
    const created = await createDraft("policy-stale-source");
    const oldRequest = await request(created.current.id, 1, "policy-stale-request");
    await updateQuotePolicy(
      context,
      prisma,
      {
        idempotencyKey: "policy-stale-update",
        expectedRevision: 0,
        autonomyLevel: 1,
        allowSelfApproval: true,
      },
      commandMetadata(approverId, "policy-stale-update"),
    );
    await updateQuotePolicy(
      context,
      prisma,
      {
        idempotencyKey: "policy-stale-revert-to-original-content",
        expectedRevision: 1,
        autonomyLevel: 0,
        allowSelfApproval: false,
      },
      commandMetadata(approverId, "policy-stale-revert-to-original-content"),
    );
    await expect(
      approveQuote(
        context,
        prisma,
        created.current.id,
        2,
        { idempotencyKey: "policy-stale-approve", reasonCode: "reviewed" },
        commandMetadata(approverId, "policy-stale-approve"),
      ),
    ).rejects.toBeInstanceOf(QuoteCommandConflictError);
    await updateQuotePolicy(
      context,
      prisma,
      {
        idempotencyKey: "policy-stale-opt-in",
        expectedRevision: 2,
        autonomyLevel: 0,
        allowSelfApproval: true,
      },
      commandMetadata(approverId, "policy-stale-opt-in"),
    );
    await expect(
      approveQuote(
        context,
        prisma,
        created.current.id,
        2,
        { idempotencyKey: "policy-stale-approve-after-revert", reasonCode: "reviewed" },
        commandMetadata(approverId, "policy-stale-approve-after-revert"),
      ),
    ).rejects.toBeInstanceOf(QuoteCommandConflictError);
    const next = await request(created.current.id, 2, "policy-stale-rerequest");
    expect(next.current).toMatchObject({
      revision: 3,
      policyRevision: 3,
      status: "pending",
      allowSelfApprovalSnapshot: true,
    });
    expect(next.current.id).not.toBe(oldRequest.current.id);
    expect(
      await prisma.quote.findUnique({
        where: { tenantId_id: { tenantId, id: created.current.id } },
      }),
    ).toMatchObject({ revision: 3, calculatedRevision: 3, approvalPolicyRevision: 3 });
    const optedIn = await approveQuote(
      context,
      prisma,
      created.current.id,
      3,
      { idempotencyKey: "policy-stale-self-approval-opt-in", reasonCode: "reviewed" },
      commandMetadata(authorId, "policy-stale-self-approval-opt-in"),
    );
    expect(optedIn.current).toMatchObject({
      status: "approved",
      decisionActorUserId: authorId,
      allowSelfApprovalSnapshot: true,
    });
    await updateQuotePolicy(
      context,
      prisma,
      {
        idempotencyKey: "policy-stale-reset",
        expectedRevision: 3,
        autonomyLevel: 0,
        maxAutoSendAmount: null,
        maxAutoSendCurrency: null,
        maxDiscountPercent: null,
        minMarginPercent: null,
        requireStock: false,
        newCustomerRequiresApproval: true,
        exceptionalProductRequiresApproval: true,
        allowSelfApproval: false,
      },
      commandMetadata(approverId, "policy-stale-reset"),
    );
  });

  it("records an eligible automatic approval as system_policy with no user identity", async () => {
    await updateQuotePolicy(
      context,
      prisma,
      {
        idempotencyKey: "auto-policy",
        expectedRevision: 4,
        autonomyLevel: 2,
        maxAutoSendAmount: "1000",
        maxAutoSendCurrency: "USD",
        maxDiscountPercent: "100",
        newCustomerRequiresApproval: true,
        exceptionalProductRequiresApproval: false,
      },
      commandMetadata(approverId, "auto-policy"),
    );
    const created = await createDraft("auto-new-customer-source");
    const manual = await request(created.current.id, 1, "auto-new-customer-request");
    expect(manual.current).toMatchObject({
      status: "pending",
      requestReasonCodes: ["new_customer_requires_approval"],
    });
    await approveQuote(
      context,
      prisma,
      created.current.id,
      2,
      { idempotencyKey: "auto-new-customer-manual-approve", reasonCode: "reviewed" },
      commandMetadata(approverId, "auto-new-customer-manual-approve"),
    );
    await prisma.quote.update({
      where: { tenantId_id: { tenantId, id: created.current.id } },
      data: { status: "sent" },
    });
    const returning = await createDraft("auto-returning-customer-source");
    const result = await request(returning.current.id, 1, "auto-request");
    expect(result).toMatchObject({
      recordedOutcome: { status: "approved", revision: 2 },
      current: {
        status: "approved",
        quoteStatus: "approved",
        decisionActorType: "system_policy",
        decisionActorUserId: null,
        allowSelfApprovalSnapshot: false,
      },
    });
    const row = await prisma.quoteApproval.findUnique({
      where: { tenantId_id: { tenantId, id: result.current.id } },
    });
    expect(row).toMatchObject({
      status: "approved",
      decisionActorType: "system_policy",
      decisionActorUserId: null,
      decisionReasonCode: "policy_eligible",
    });
    await updateQuotePolicy(
      context,
      prisma,
      {
        idempotencyKey: "auto-policy-reset",
        expectedRevision: 5,
        autonomyLevel: 0,
        maxAutoSendAmount: null,
        maxAutoSendCurrency: null,
        maxDiscountPercent: null,
        minMarginPercent: null,
        requireStock: false,
        newCustomerRequiresApproval: true,
        exceptionalProductRequiresApproval: true,
        allowSelfApproval: false,
      },
      commandMetadata(approverId, "auto-policy-reset"),
    );
  });

  it("cancels an incomplete draft without CRM eligibility or fabricated calculated totals", async () => {
    const created = await createDraft("cancel-unready-source");
    const item = created.current.lines[0];
    if (item === undefined) throw new Error("Draft fixture must contain one quote item");
    await prisma.quoteItem.update({
      where: { tenantId_id: { tenantId, id: item.id } },
      data: {
        taxRate: null,
        grossTotal: null,
        discountTotal: null,
        netTotal: null,
        taxTotal: null,
        lineTotal: null,
      },
    });
    await prisma.quote.update({
      where: { tenantId_id: { tenantId, id: created.current.id } },
      data: {
        calculatedRevision: null,
        calculationInputHash: null,
        subtotal: null,
        discountTotal: null,
        taxTotal: null,
        total: null,
      },
    });
    await prisma.tenantEntitlement.update({
      where: { tenantId_entitlementKey: { tenantId, entitlementKey: "module.crm_lite" } },
      data: { enabled: false },
    });
    await prisma.contact.update({
      where: { tenantId_id: { tenantId, id: contactId } },
      data: { status: "INACTIVE" },
    });
    try {
      const result = await cancelQuote(
        context,
        prisma,
        created.current.id,
        1,
        { idempotencyKey: "cancel-unready" },
        commandMetadata(authorId, "cancel-unready"),
      );
      expect(result).toMatchObject({
        recordedOutcome: { status: "cancelled", revision: 2, result: "cancelled" },
        current: { status: "cancelled", revision: 2 },
      });
      expect(
        await prisma.quote.findUnique({
          where: { tenantId_id: { tenantId, id: created.current.id } },
        }),
      ).toMatchObject({
        calculatedRevision: null,
        calculationInputHash: null,
        subtotal: null,
        discountTotal: null,
        taxTotal: null,
        total: null,
      });
      expect(
        await prisma.quoteItem.findUnique({ where: { tenantId_id: { tenantId, id: item.id } } }),
      ).toMatchObject({
        taxRate: null,
        grossTotal: null,
        discountTotal: null,
        netTotal: null,
        taxTotal: null,
        lineTotal: null,
      });
      const auditCount = await prisma.auditLog.count({
        where: { tenantId, entityId: created.current.id },
      });
      const outboxCount = await prisma.domainEventOutbox.count({
        where: { tenantId, aggregateId: created.current.id },
      });
      const repeated = await cancelQuote(
        context,
        prisma,
        created.current.id,
        2,
        { idempotencyKey: "cancel-already" },
        commandMetadata(authorId, "cancel-already"),
      );
      expect(repeated).toMatchObject({
        recordedOutcome: { status: "cancelled", revision: 2, result: "already_cancelled" },
        current: { status: "cancelled", revision: 2 },
      });
      expect(
        await prisma.auditLog.count({ where: { tenantId, entityId: created.current.id } }),
      ).toBe(auditCount);
      expect(
        await prisma.domainEventOutbox.count({
          where: { tenantId, aggregateId: created.current.id },
        }),
      ).toBe(outboxCount);
      const replay = await cancelQuote(
        context,
        prisma,
        created.current.id,
        1,
        { idempotencyKey: "cancel-unready" },
        commandMetadata(authorId, "cancel-unready-replay"),
      );
      expect(replay.replayed).toBe(true);
      expect(replay.recordedOutcome).toMatchObject({
        status: "cancelled",
        revision: 2,
        result: "cancelled",
      });
    } finally {
      await prisma.contact.update({
        where: { tenantId_id: { tenantId, id: contactId } },
        data: { status: "ACTIVE" },
      });
      await prisma.tenantEntitlement.update({
        where: { tenantId_entitlementKey: { tenantId, entitlementKey: "module.crm_lite" } },
        data: { enabled: true },
      });
    }
  });

  it("rechecks approval after a real lock wait and still permits reject and cancel after expiry", async () => {
    const deadline = new Date(Date.now() + 5000).toISOString();
    const created = await createDraft("deadline-source", deadline);
    const pending = await request(created.current.id, 1, "deadline-request");
    let releaseLock!: () => void;
    let signalLock!: () => void;
    const lockReady = new Promise<void>((resolve) => {
      signalLock = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const blocker = prisma.$transaction(async (transaction) => {
      await quoteTenantPolicyLock(transaction, tenantId);
      signalLock();
      await release;
    });
    await lockReady;
    const waiting = approveQuote(
      context,
      prisma,
      created.current.id,
      2,
      { idempotencyKey: "deadline-waiting-approve", reasonCode: "reviewed" },
      commandMetadata(approverId, "deadline-waiting-approve"),
    );
    const expiredApproval = expect(waiting).rejects.toBeInstanceOf(QuoteValidationError);
    try {
      await waitForPolicyLockWait();
      while (Date.now() <= new Date(deadline).getTime())
        await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      releaseLock();
    }
    await blocker;
    await expiredApproval;
    expect(
      await prisma.quote.findUnique({
        where: { tenantId_id: { tenantId, id: created.current.id } },
      }),
    ).toMatchObject({
      status: "pending_approval",
      revision: 2,
      currentApprovalId: pending.current.id,
    });
    const rejected = await rejectQuote(
      context,
      prisma,
      created.current.id,
      2,
      { idempotencyKey: "deadline-reject-after-expiry", reasonCode: "needs_changes" },
      commandMetadata(approverId, "deadline-reject-after-expiry"),
    );
    expect(rejected.current).toMatchObject({ status: "rejected", revision: 3 });
    await expect(
      request(created.current.id, 3, "deadline-rerequest-after-expiry"),
    ).rejects.toBeInstanceOf(QuoteValidationError);
    const cancelled = await cancelQuote(
      context,
      prisma,
      created.current.id,
      3,
      { idempotencyKey: "deadline-cancel-after-expiry" },
      commandMetadata(authorId, "deadline-cancel-after-expiry"),
    );
    expect(cancelled.current).toMatchObject({ status: "cancelled", revision: 4 });
  });

  it("serializes competing approvals so only one decision and event are committed", async () => {
    const created = await createDraft("parallel-source");
    const pending = await request(created.current.id, 1, "parallel-request");
    const outboxBefore = await prisma.domainEventOutbox.count({
      where: { tenantId, aggregateId: created.current.id },
    });
    const results = await Promise.allSettled([
      approveQuote(
        context,
        prisma,
        created.current.id,
        2,
        { idempotencyKey: "parallel-approve-a", reasonCode: "reviewed" },
        commandMetadata(approverId, "parallel-a"),
      ),
      rejectQuote(
        context,
        prisma,
        created.current.id,
        2,
        { idempotencyKey: "parallel-reject-b", reasonCode: "needs_changes" },
        commandMetadata(approverId, "parallel-b"),
      ),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const current = await prisma.quote.findUnique({
      where: { tenantId_id: { tenantId, id: created.current.id } },
    });
    expect(current).toMatchObject({ revision: 3 });
    expect(
      await prisma.quoteApproval.findMany({ where: { tenantId, quoteId: created.current.id } }),
    ).toHaveLength(1);
    expect(
      await prisma.domainEventOutbox.count({
        where: { tenantId, aggregateId: created.current.id },
      }),
    ).toBe(outboxBefore + 1);
    expect(pending.current.status).toBe("pending");
  });
});
