import {
  assertTenantModuleEntitled,
  assertTenantOperational,
  createTenantContext,
  type OutboundMessageManager,
  type OutboundMessageRecord,
} from "@whatsapp-platform/database";
import type { PrismaClient } from "@whatsapp-platform/database/platform";
import type { MessagingProvider } from "@whatsapp-platform/messaging";
import {
  calculateOutboundBackoff,
  classifyOutboundError,
  type OutboundDispatchChannel,
  type OutboundDispatchMessage,
  OutboundMessageDispatcher,
} from "@whatsapp-platform/messaging";

export const OUTBOUND_ATTEMPT_TIMEOUT_MS = 15_000;
export const OUTBOUND_WORKER_CONCURRENCY = 5;
export const OUTBOUND_WORKER_LEASE_MS = 30_000;
export const OUTBOUND_WORKER_POLL_MS = 500;

type DatabaseChannelReader = Pick<PrismaClient, "channelAccount" | "tenant" | "tenantEntitlement">;

export type OutboundWorkerOptions = Readonly<{
  attemptTimeoutMs?: number;
  concurrency?: number;
  leaseDurationMs?: number;
  pollIntervalMs?: number;
  providerFactory?: (channel: OutboundDispatchChannel) => MessagingProvider;
}>;

type RuntimeWorkerOptions = Required<Omit<OutboundWorkerOptions, "providerFactory">> &
  Pick<OutboundWorkerOptions, "providerFactory">;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Worker is stopping"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Worker is stopping"));
      },
      { once: true },
    );
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Outbound provider attempt timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

class ChannelRateLimiter {
  private readonly sentAt = new Map<string, number[]>();

  async waitForSlot(channelId: string, signal: AbortSignal): Promise<void> {
    for (;;) {
      const now = Date.now();
      const recent = (this.sentAt.get(channelId) ?? []).filter(
        (timestamp) => timestamp > now - 1_000,
      );
      if (recent.length < OUTBOUND_WORKER_CONCURRENCY) {
        recent.push(now);
        this.sentAt.set(channelId, recent);
        return;
      }
      const waitMs = Math.max(1, (recent[0] ?? now) + 1_000 - now);
      await sleep(waitMs, signal);
    }
  }
}

function dispatchMessage(message: OutboundMessageRecord): OutboundDispatchMessage {
  return {
    channelAccountId: message.channelAccountId,
    content: message.content,
    id: message.id,
    maxRetries: message.maxRetries,
    messageType: message.messageType,
    recipientPhone: message.recipientPhone,
    retryCount: message.retryCount,
    tenantId: message.tenantId,
  };
}

export class OutboundWorker {
  private readonly abortController = new AbortController();
  private readonly dispatcher: OutboundMessageDispatcher;
  private readonly limiter = new ChannelRateLimiter();
  private readonly manager: OutboundMessageManager;
  private readonly options: RuntimeWorkerOptions;
  private readonly inFlight = new Set<Promise<void>>();
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    manager: OutboundMessageManager,
    database: DatabaseChannelReader,
    options: OutboundWorkerOptions = {},
  ) {
    this.manager = manager;
    this.options = {
      attemptTimeoutMs: options.attemptTimeoutMs ?? OUTBOUND_ATTEMPT_TIMEOUT_MS,
      concurrency: options.concurrency ?? OUTBOUND_WORKER_CONCURRENCY,
      leaseDurationMs: options.leaseDurationMs ?? OUTBOUND_WORKER_LEASE_MS,
      pollIntervalMs: options.pollIntervalMs ?? OUTBOUND_WORKER_POLL_MS,
      ...(options.providerFactory === undefined
        ? {}
        : { providerFactory: options.providerFactory }),
    };
    if (this.options.concurrency < 1 || !Number.isInteger(this.options.concurrency)) {
      throw new RangeError("Worker concurrency must be a positive integer");
    }
    this.dispatcher = new OutboundMessageDispatcher({
      assertMessagingEntitled: async (tenantId) =>
        assertTenantModuleEntitled(
          createTenantContext(tenantId),
          "module.messaging.basic",
          database,
        ),
      assertTenantOperational: async (tenantId) =>
        assertTenantOperational(createTenantContext(tenantId), database),
      findChannel: async (tenantId, channelAccountId) =>
        database.channelAccount.findUnique({
          select: { active: true, providerType: true, status: true },
          where: { id: channelAccountId, tenantId },
        }),
      ...(options.providerFactory === undefined
        ? {}
        : { providerFactory: options.providerFactory }),
    });
  }

  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const messages = await this.manager.claimNextPendingMessages(
        this.options.concurrency,
        this.options.leaseDurationMs,
      );
      const tasks = messages.map((message) => this.process(message));
      await Promise.all(tasks);
      return messages.length;
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.pollTimer !== undefined) return;
    void this.runOnce().catch((error: unknown) => this.logError("poll_failed", error));
    this.pollTimer = setInterval(() => {
      void this.runOnce().catch((error: unknown) => this.logError("poll_failed", error));
    }, this.options.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.pollTimer !== undefined) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.abortController.abort();
    await Promise.allSettled([...this.inFlight]);
  }

  private async process(message: OutboundMessageRecord): Promise<void> {
    const task = this.processMessage(message);
    this.inFlight.add(task);
    try {
      await task;
    } finally {
      this.inFlight.delete(task);
    }
  }

  private async processMessage(message: OutboundMessageRecord): Promise<void> {
    try {
      await this.limiter.waitForSlot(message.channelAccountId, this.abortController.signal);
      const outcome = await withTimeout(
        this.dispatcher.dispatch(dispatchMessage(message)),
        this.options.attemptTimeoutMs,
      );
      const context = createTenantContext(message.tenantId);
      if (outcome.kind === "sent") {
        await this.manager.markAsSent(context, message.id, outcome.providerMessageId);
        return;
      }
      await this.manager.markAsFailedOrRetry(
        context,
        message.id,
        outcome.error,
        outcome.failureKind === "transient",
        outcome.nextRetryAt,
      );
    } catch (error) {
      this.logError("message_failed", error, message.id);
      try {
        const transient = classifyOutboundError(error) === "transient";
        await this.manager.markAsFailedOrRetry(
          createTenantContext(message.tenantId),
          message.id,
          error,
          transient,
          transient ? new Date(Date.now() + calculateOutboundBackoff(message.retryCount)) : null,
        );
      } catch (markError) {
        this.logError("state_update_failed", markError, message.id);
      }
    }
  }

  private logError(event: string, error: unknown, messageId?: string): void {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown worker error",
        ...(messageId === undefined ? {} : { messageId }),
        service: "worker-whatsapp",
        type: event,
      }),
    );
  }
}
