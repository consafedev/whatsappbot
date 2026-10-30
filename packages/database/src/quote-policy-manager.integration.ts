import { loadDatabaseConfig } from "@whatsapp-platform/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPlatformDatabaseClient,
  type Prisma,
  type PrismaClient,
  syncPermissionCatalog,
} from "./platform";
import { quoteTenantPolicyLock } from "./quote-command-locks";
import {
  createQuoteDraft,
  QuoteAuthorizationError,
  type QuoteDraftInput,
  QuoteRevisionConflictError,
  QuoteValidationError,
} from "./quote-manager";
import {
  DEFAULT_QUOTE_POLICY,
  type QuoteMutationMetadata,
  type QuotePolicyInput,
} from "./quote-policy";
import {
  getQuotePolicy,
  type QuotePolicyDatabase,
  updateQuotePolicy,
} from "./quote-policy-manager";
import { createTenantContext } from "./tenant-context";

const prefix = "e15-s04-policy-db";
describe.sequential("E15-S04 quote policy manager", () => {
  let prisma: PrismaClient;
  let tenantId = "";
  let actorId = "";
  let actorRoleId = "";
  let deniedActorId = "";
  let unitId = "";
  let contactId = "";
  const allowedPermissionIds: string[] = [];

  const context = () => createTenantContext(tenantId);
  const metadata = (requestId: string, actorUserId = actorId): QuoteMutationMetadata => ({
    actorUserId,
    requestId,
  });

  function policyInput(
    idempotencyKey: string,
    overrides: Partial<QuotePolicyInput> = {},
  ): QuotePolicyInput {
    return {
      idempotencyKey,
      expectedRevision: 0,
      autonomyLevel: 0,
      ...overrides,
    };
  }

  async function createActor(marker: string, permissions: readonly string[]) {
    const user = await prisma.user.create({
      data: {
        tenantId,
        displayName: `Policy ${marker}`,
        email: `${prefix}-${marker}@example.invalid`,
        passwordHash: "integration-only-not-a-real-password-hash",
        locale: "es-MX",
        timezone: "UTC",
      },
    });
    const role = await prisma.role.create({
      data: { tenantId, key: `${prefix}-${marker}`, name: `Policy ${marker}` },
    });
    for (const key of permissions) {
      const permission = await prisma.permission.findUnique({ where: { key } });
      if (!permission) throw new Error(`Missing canonical permission: ${key}`);
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
      if (marker === "admin") allowedPermissionIds.push(permission.id);
    }
    await prisma.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id } });
    return { userId: user.id, roleId: role.id };
  }

  async function cleanup(): Promise<void> {
    const tenants = await prisma.tenant.findMany({
      select: { id: true },
      where: { slug: { startsWith: prefix } },
    });
    const ids = tenants.map(({ id }) => id);
    if (ids.length === 0) return;
    await prisma.quotePolicy.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.quoteCommandReceipt.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.quoteItem.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.quoteCommercialContributor.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.quote.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.domainEventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.userSession.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.userRole.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.rolePermission.deleteMany({ where: { role: { tenantId: { in: ids } } } });
    await prisma.role.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.contact.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.organizationUnit.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenantEntitlement.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  }

  async function waitForAdvisoryLockWait(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [waiting] = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND state = 'active'
          AND query LIKE '%pg_advisory_xact_lock%'
      `;
      if ((waiting?.count ?? 0n) > 0n) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(
      "Policy or Quote command was not observed waiting on a PostgreSQL advisory lock",
    );
  }

  function gatedOutboxDatabase(): Readonly<{
    database: QuotePolicyDatabase;
    entered: Promise<void>;
    release(): void;
  }> {
    let signalEntered!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => (signalEntered = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
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
                        return async (args: Parameters<typeof delegate.create>[0]) => {
                          signalEntered();
                          await released;
                          return delegate.create(args);
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
    } as QuotePolicyDatabase;
    return { database, entered, release };
  }

  function failOutboxOnceDatabase(): QuotePolicyDatabase {
    let fail = true;
    return {
      $transaction: <T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>) =>
        prisma.$transaction((transaction) =>
          callback(
            new Proxy(transaction, {
              get(target, property) {
                if (property === "domainEventOutbox") {
                  return new Proxy(target.domainEventOutbox, {
                    get(delegate, method) {
                      if (method === "create")
                        return async (args: Parameters<typeof delegate.create>[0]) => {
                          if (fail) {
                            fail = false;
                            throw new Error("injected Outbox failure");
                          }
                          return delegate.create(args);
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
    } as QuotePolicyDatabase;
  }

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
        displayName: "Quote Policy",
        legalName: "Quote Policy",
        slug: prefix,
        status: "active",
      },
    });
    tenantId = tenant.id;
    const [admin, denied] = await Promise.all([
      createActor("admin", [
        "quotes.read",
        "quotes.create",
        "quotes.approve",
        "tenant.settings.manage",
      ]),
      createActor("denied", ["quotes.read", "quotes.create"]),
    ]);
    actorId = admin.userId;
    actorRoleId = admin.roleId;
    deniedActorId = denied.userId;
    const [unit, contact] = await Promise.all([
      prisma.organizationUnit.create({ data: { tenantId, name: "Policy Unit", type: "branch" } }),
      prisma.contact.create({
        data: { tenantId, name: "Policy Contact", phoneNumber: "+15550000000" },
      }),
    ]);
    unitId = unit.id;
    contactId = contact.id;
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

  it("defaultsToManualWithoutWriteOnReadAtRevisionZero", async () => {
    const before = {
      policies: await prisma.quotePolicy.count({ where: { tenantId } }),
      receipts: await prisma.quoteCommandReceipt.count({ where: { tenantId } }),
      audits: await prisma.auditLog.count({ where: { tenantId } }),
      outbox: await prisma.domainEventOutbox.count({ where: { tenantId } }),
    };
    const first = await getQuotePolicy(context(), prisma);
    const second = await getQuotePolicy(context(), prisma);
    expect(first).toEqual(DEFAULT_QUOTE_POLICY);
    expect(second).toEqual(first);
    expect({
      policies: await prisma.quotePolicy.count({ where: { tenantId } }),
      receipts: await prisma.quoteCommandReceipt.count({ where: { tenantId } }),
      audits: await prisma.auditLog.count({ where: { tenantId } }),
      outbox: await prisma.domainEventOutbox.count({ where: { tenantId } }),
    }).toEqual(before);
  });

  it("records a receipt-only semantic no-op against the absent default", async () => {
    const before = {
      receipts: await prisma.quoteCommandReceipt.count({ where: { tenantId } }),
      audits: await prisma.auditLog.count({ where: { tenantId } }),
      outbox: await prisma.domainEventOutbox.count({ where: { tenantId } }),
    };
    const noOp = await updateQuotePolicy(
      context(),
      prisma,
      policyInput("default-policy-noop"),
      metadata("default-policy-noop"),
    );
    expect(noOp).toMatchObject({
      replayed: false,
      recordedOutcome: {
        tenantId,
        policy: { revision: 0, contentHash: DEFAULT_QUOTE_POLICY.contentHash },
      },
      current: { revision: 0 },
    });
    expect(await prisma.quotePolicy.count({ where: { tenantId } })).toBe(0);
    expect({
      receipts: await prisma.quoteCommandReceipt.count({ where: { tenantId } }),
      audits: await prisma.auditLog.count({ where: { tenantId } }),
      outbox: await prisma.domainEventOutbox.count({ where: { tenantId } }),
    }).toEqual({ ...before, receipts: before.receipts + 1 });
    const receipt = await prisma.quoteCommandReceipt.findUniqueOrThrow({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: "default-policy-noop" } },
    });
    expect(receipt).toMatchObject({ resourceId: tenantId, quoteId: null, actorUserId: actorId });
    expect(Buffer.byteLength(JSON.stringify(receipt.recordedOutcome), "utf8")).toBeLessThan(
      16 * 1024,
    );
  });

  it("updateCreatesPolicyUnderSharedMutexAndRecordsOnlyTypedIdentityAndRevision", async () => {
    const updated = await updateQuotePolicy(
      context(),
      prisma,
      policyInput("policy-create", {
        autonomyLevel: 2,
        expectedRevision: 0,
        maxAutoSendAmount: "99999999999999999999.9999",
        maxAutoSendCurrency: "USD",
        maxDiscountPercent: "20.0000",
      }),
      metadata("policy-create"),
    );
    expect(updated).toMatchObject({
      replayed: false,
      recordedOutcome: { tenantId, policy: { autonomyLevel: 2, revision: 1 } },
      current: {
        maxAutoSendAmount: "99999999999999999999.9999",
        maxAutoSendCurrency: "USD",
        revision: 1,
      },
    });
    const [receipt, stored] = await Promise.all([
      prisma.quoteCommandReceipt.findUniqueOrThrow({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: "policy-create" } },
      }),
      prisma.quotePolicy.findUniqueOrThrow({ where: { tenantId } }),
    ]);
    expect(receipt).toMatchObject({
      resourceId: tenantId,
      quoteId: null,
      commandType: "policy_update",
    });
    expect(stored).toMatchObject({
      autonomyLevel: 2,
      revision: 1,
      contentHash: updated.current.contentHash,
    });
    expect(
      await prisma.auditLog.count({ where: { tenantId, action: "quote.policy_updated" } }),
    ).toBe(1);
    expect(
      await prisma.domainEventOutbox.count({
        where: { tenantId, eventType: "quote.policy_updated" },
      }),
    ).toBe(1);
  });

  it("requiresBoundedAmountAndCurrencyForAutonomyTwoOrThree", async () => {
    for (const autonomyLevel of [2, 3] as const) {
      await expect(
        updateQuotePolicy(
          context(),
          prisma,
          policyInput(`missing-bounds-${autonomyLevel}`, { autonomyLevel }),
          metadata(`missing-bounds-${autonomyLevel}`),
        ),
      ).rejects.toBeInstanceOf(QuoteValidationError);
    }
    await expect(
      updateQuotePolicy(
        context(),
        prisma,
        policyInput("partial-bounds", {
          autonomyLevel: 2,
          maxAutoSendAmount: "10",
          maxAutoSendCurrency: null,
        }),
        metadata("partial-bounds"),
      ),
    ).rejects.toBeInstanceOf(QuoteValidationError);
  });

  it("noOpPolicyWriteRetainsRevisionAndHashAndChangeThenRevertAdvancesMonotonically", async () => {
    const base = {
      autonomyLevel: 2 as const,
      expectedRevision: 1,
      maxAutoSendAmount: "99999999999999999999.9999",
      maxAutoSendCurrency: "USD",
      maxDiscountPercent: "20",
    };
    const beforeNoOp = {
      audit: await prisma.auditLog.count({ where: { tenantId, action: "quote.policy_updated" } }),
      outbox: await prisma.domainEventOutbox.count({
        where: { tenantId, eventType: "quote.policy_updated" },
      }),
    };
    const noOp = await updateQuotePolicy(
      context(),
      prisma,
      policyInput("policy-noop", base),
      metadata("policy-noop"),
    );
    expect(noOp.current.revision).toBe(1);
    expect(noOp.current.contentHash).toBe((await getQuotePolicy(context(), prisma)).contentHash);
    expect({
      audit: await prisma.auditLog.count({ where: { tenantId, action: "quote.policy_updated" } }),
      outbox: await prisma.domainEventOutbox.count({
        where: { tenantId, eventType: "quote.policy_updated" },
      }),
    }).toEqual(beforeNoOp);
    const counts = {
      audit: await prisma.auditLog.count({ where: { tenantId, action: "quote.policy_updated" } }),
      outbox: await prisma.domainEventOutbox.count({
        where: { tenantId, eventType: "quote.policy_updated" },
      }),
    };
    const changed = await updateQuotePolicy(
      context(),
      prisma,
      policyInput("policy-change", { ...base, expectedRevision: 1, allowSelfApproval: true }),
      metadata("policy-change"),
    );
    const reverted = await updateQuotePolicy(
      context(),
      prisma,
      policyInput("policy-revert", { ...base, expectedRevision: 2 }),
      metadata("policy-revert"),
    );
    expect(changed.current.revision).toBe(2);
    expect(reverted.current.revision).toBe(3);
    expect(reverted.current.contentHash).not.toBe(noOp.current.contentHash);
    expect(
      await prisma.auditLog.count({ where: { tenantId, action: "quote.policy_updated" } }),
    ).toBe(counts.audit + 2);
    expect(
      await prisma.domainEventOutbox.count({
        where: { tenantId, eventType: "quote.policy_updated" },
      }),
    ).toBe(counts.outbox + 2);
  });

  it("replaysSameKeyAfterLaterChangesWithRecordedAndCurrentPolicySeparate", async () => {
    const replaySource = policyInput("policy-replay", {
      autonomyLevel: 1,
      expectedRevision: 3,
      requireStock: true,
    });
    const first = await updateQuotePolicy(
      context(),
      prisma,
      replaySource,
      metadata("policy-replay"),
    );
    const next = await updateQuotePolicy(
      context(),
      prisma,
      policyInput("policy-next", { autonomyLevel: 0, expectedRevision: 4 }),
      metadata("policy-next"),
    );
    const replay = await updateQuotePolicy(
      context(),
      prisma,
      replaySource,
      metadata("policy-replay-again"),
    );
    expect(first.current.revision).toBe(4);
    expect(next.current.revision).toBe(5);
    expect(replay).toMatchObject({
      replayed: true,
      recordedOutcome: { policy: { revision: 4, requireStock: true } },
      current: { revision: 5, requireStock: false },
    });
  });

  it("rejectsFreshKeyWithStaleExpectedRevisionAndCrossTenantOrUnauthorizedWrites", async () => {
    await expect(
      updateQuotePolicy(
        context(),
        prisma,
        policyInput("stale-policy", { autonomyLevel: 0, expectedRevision: 1 }),
        metadata("stale-policy"),
      ),
    ).rejects.toBeInstanceOf(QuoteRevisionConflictError);
    await expect(
      updateQuotePolicy(
        context(),
        prisma,
        policyInput("denied-policy", { autonomyLevel: 1, expectedRevision: 5 }),
        metadata("denied-policy", deniedActorId),
      ),
    ).rejects.toBeInstanceOf(QuoteAuthorizationError);
  });

  it("rollsBackPolicyReceiptAuditAndOutboxOnOutboxFailureThenRetries", async () => {
    const input = policyInput("policy-outbox-retry", { autonomyLevel: 1, expectedRevision: 5 });
    const counts = {
      policies: await prisma.quotePolicy.count({ where: { tenantId } }),
      receipts: await prisma.quoteCommandReceipt.count({ where: { tenantId } }),
      audit: await prisma.auditLog.count({ where: { tenantId, action: "quote.policy_updated" } }),
      outbox: await prisma.domainEventOutbox.count({
        where: { tenantId, eventType: "quote.policy_updated" },
      }),
    };
    await expect(
      updateQuotePolicy(
        context(),
        failOutboxOnceDatabase(),
        input,
        metadata("policy-outbox-retry"),
      ),
    ).rejects.toThrow("injected Outbox failure");
    expect({
      policies: await prisma.quotePolicy.count({ where: { tenantId } }),
      receipts: await prisma.quoteCommandReceipt.count({ where: { tenantId } }),
      audit: await prisma.auditLog.count({ where: { tenantId, action: "quote.policy_updated" } }),
      outbox: await prisma.domainEventOutbox.count({
        where: { tenantId, eventType: "quote.policy_updated" },
      }),
    }).toEqual(counts);
    const retry = await updateQuotePolicy(
      context(),
      prisma,
      input,
      metadata("policy-outbox-retry"),
    );
    expect(retry.current.revision).toBe(6);
  });

  it("sameKeyConcurrentWritesReplaySingleRecordedResult", async () => {
    const gate = gatedOutboxDatabase();
    const input = policyInput("policy-same-key-concurrent", {
      autonomyLevel: 1,
      expectedRevision: 6,
      allowSelfApproval: true,
    });
    const firstPromise = updateQuotePolicy(
      context(),
      gate.database,
      input,
      metadata("same-key-first"),
    );
    await gate.entered;
    const secondPromise = updateQuotePolicy(context(), prisma, input, metadata("same-key-second"));
    await waitForAdvisoryLockWait();
    gate.release();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(first.current.revision).toBe(7);
    expect(second.recordedOutcome.policy.revision).toBe(7);
    expect(
      await prisma.quoteCommandReceipt.count({
        where: { tenantId, idempotencyKey: input.idempotencyKey },
      }),
    ).toBe(1);
  });

  it("policyWriteSerializesWithQuoteCommands", async () => {
    const gate = gatedOutboxDatabase();
    const policyPromise = updateQuotePolicy(
      context(),
      gate.database,
      policyInput("policy-before-quote", {
        autonomyLevel: 1,
        expectedRevision: 7,
        allowSelfApproval: true,
        requireStock: true,
      }),
      metadata("policy-before-quote"),
    );
    await gate.entered;
    const quoteInput: QuoteDraftInput = {
      idempotencyKey: "quote-waits-for-policy",
      organizationUnitId: unitId,
      contactId,
      currency: "USD",
      lines: [
        {
          productId: null,
          description: "Policy locking line",
          unit: "piece",
          quantity: "1",
          unitPrice: "10",
          currency: "USD",
          taxRate: "0",
        },
      ],
    };
    const quotePromise = createQuoteDraft(context(), prisma, quoteInput, {
      actorUserId: actorId,
      requestId: "quote-policy-lock-wait",
    });
    await waitForAdvisoryLockWait();
    gate.release();
    const [policy, quote] = await Promise.all([policyPromise, quotePromise]);
    expect(policy.current.revision).toBe(8);
    expect(quote.current.status).toBe("draft");
  });

  it("revalidatesCurrentPermissionAfterLockWaitForMutationAndReplay", async () => {
    const replayInput = policyInput("policy-auth-after-wait", {
      autonomyLevel: 1,
      expectedRevision: 8,
      allowSelfApproval: false,
    });
    await updateQuotePolicy(context(), prisma, replayInput, metadata("policy-auth-seed"));
    const holdLock = async () => {
      let signal!: () => void;
      let release!: () => void;
      const locked = new Promise<void>((resolve) => (signal = resolve));
      const released = new Promise<void>((resolve) => (release = resolve));
      const holder = prisma.$transaction(async (transaction) => {
        await quoteTenantPolicyLock(transaction, tenantId);
        signal();
        await released;
      });
      await locked;
      return { release, holder };
    };
    const revoke = async () =>
      prisma.rolePermission.deleteMany({
        where: { roleId: actorRoleId, permissionId: { in: allowedPermissionIds } },
      });
    const restore = async () =>
      prisma.rolePermission.createMany({
        data: allowedPermissionIds.map((permissionId) => ({ roleId: actorRoleId, permissionId })),
        skipDuplicates: true,
      });
    for (const replay of [false, true]) {
      const blocker = await holdLock();
      const pending = updateQuotePolicy(
        context(),
        prisma,
        replay
          ? replayInput
          : policyInput("policy-auth-mutation-wait", {
              autonomyLevel: 0,
              expectedRevision: 9,
            }),
        metadata(replay ? "policy-auth-replay-wait" : "policy-auth-mutation-wait"),
      );
      await waitForAdvisoryLockWait();
      await revoke();
      blocker.release();
      await blocker.holder;
      await expect(pending).rejects.toBeInstanceOf(QuoteAuthorizationError);
      await restore();
    }
    expect((await getQuotePolicy(context(), prisma)).revision).toBe(9);
  });

  it("normalizesDecimalIntentBeforeHashingAndRejectsHostileDTOFields", async () => {
    const first = await updateQuotePolicy(
      context(),
      prisma,
      policyInput("policy-decimal-normalized", {
        autonomyLevel: 1,
        expectedRevision: 9,
        maxDiscountPercent: "010.0000",
      }),
      metadata("policy-decimal-normalized"),
    );
    expect(first.current.maxDiscountPercent).toBe("10");
    await expect(
      updateQuotePolicy(
        context(),
        prisma,
        {
          ...policyInput("hostile-policy", { autonomyLevel: 1, expectedRevision: 10 }),
          actorUserId: actorId,
        } as QuotePolicyInput,
        metadata("hostile-policy"),
      ),
    ).rejects.toBeInstanceOf(QuoteValidationError);
    await expect(
      updateQuotePolicy(
        context(),
        prisma,
        policyInput("policy-overflow", {
          autonomyLevel: 1,
          expectedRevision: 10,
          maxAutoSendAmount: "100000000000000000000.0000",
          maxAutoSendCurrency: "USD",
        }),
        metadata("policy-overflow"),
      ),
    ).rejects.toBeInstanceOf(QuoteValidationError);
  });
});
