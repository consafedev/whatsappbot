import {
  Inject,
  Injectable,
  type MessageEvent,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { PrismaClient } from "@whatsapp-platform/database/platform";
import { interval, map, merge, Observable, Subject } from "rxjs";

export type ChannelRealtimeHttpResponse = {
  write(chunk: string): boolean | undefined;
  on(event: string, listener: () => void): void;
};

const HEARTBEAT_INTERVAL_MS = 15_000;
const OUTBOX_POLL_INTERVAL_MS = 250;
const OUTBOX_BATCH_SIZE = 100;

export const CHANNEL_OUTBOX_EVENT_TYPES = [
  "channel.pairing_requested",
  "channel.qr_generated",
  "channel.connected",
  "channel.disconnected",
  "channel.reconnecting",
] as const;

export type ChannelOutboxEventType = (typeof CHANNEL_OUTBOX_EVENT_TYPES)[number];

export const CHANNEL_REALTIME_EVENT_TYPES = [
  "channel.qr_generated",
  "channel.connected",
  "channel.disconnected",
  "channel.reconnecting",
  "channel.health_updated",
] as const;

export type ChannelRealtimeEventType = (typeof CHANNEL_REALTIME_EVENT_TYPES)[number];

export type ChannelRealtimeEvent = Readonly<{
  eventId: string;
  type: ChannelRealtimeEventType;
  occurredAt: string;
  aggregateType: string;
  aggregateId: string;
  data: Readonly<Record<string, unknown>>;
}>;

type OutboxRecord = Readonly<{
  id: string;
  tenantId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  occurredAt: Date;
}>;

type OutboxCursor = Readonly<{
  occurredAt: Date;
  id: string;
}>;

export type ChannelRealtimeOutboxDatabase = Pick<PrismaClient, "domainEventOutbox">;

export const CHANNEL_REALTIME_SERVICE = Symbol("CHANNEL_REALTIME_SERVICE");
export const CHANNEL_REALTIME_BROADCASTER = Symbol("CHANNEL_REALTIME_BROADCASTER");
export const CHANNEL_REALTIME_OUTBOX_DATABASE = Symbol("CHANNEL_REALTIME_OUTBOX_DATABASE");

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function parseChannelOutboxEvent(recordValue: OutboxRecord): ChannelRealtimeEvent | null {
  const payload = record(recordValue.payload) ?? {};
  const eventType = recordValue.eventType;

  let eventData: Record<string, unknown> | null = null;
  let realtimeType: ChannelRealtimeEventType | null = null;

  switch (eventType) {
    case "channel.qr_generated": {
      realtimeType = "channel.qr_generated";
      eventData = {
        channelAccountId: stringOrNull(payload.channelAccountId) ?? recordValue.aggregateId,
        qrGeneratedAt: stringOrNull(payload.timestamp) ?? recordValue.occurredAt.toISOString(),
        qrRaw: stringOrNull(payload.qrRaw),
        ttlSeconds: 30,
      };
      break;
    }
    case "channel.connected": {
      realtimeType = "channel.connected";
      eventData = {
        channelAccountId: stringOrNull(payload.channelAccountId) ?? recordValue.aggregateId,
        connectedAt: stringOrNull(payload.timestamp) ?? recordValue.occurredAt.toISOString(),
        phoneNumber: stringOrNull(payload.phoneNumber),
      };
      break;
    }
    case "channel.disconnected": {
      realtimeType = "channel.disconnected";
      eventData = {
        channelAccountId: stringOrNull(payload.channelAccountId) ?? recordValue.aggregateId,
        disconnectReason: stringOrNull(payload.reason) ?? "manual_disconnect",
        disconnectedAt: stringOrNull(payload.timestamp) ?? recordValue.occurredAt.toISOString(),
        statusCode: typeof payload.statusCode === "number" ? payload.statusCode : null,
      };
      break;
    }
    case "channel.reconnecting": {
      realtimeType = "channel.reconnecting";
      eventData = {
        attemptCount: typeof payload.attemptCount === "number" ? payload.attemptCount : 1,
        channelAccountId: stringOrNull(payload.channelAccountId) ?? recordValue.aggregateId,
        reason: stringOrNull(payload.reason) ?? "connection_lost",
        reconnectingAt: stringOrNull(payload.timestamp) ?? recordValue.occurredAt.toISOString(),
        statusCode: typeof payload.statusCode === "number" ? payload.statusCode : null,
      };
      break;
    }
    case "channel.pairing_requested": {
      realtimeType = "channel.health_updated";
      eventData = {
        channelAccountId: stringOrNull(payload.channelAccountId) ?? recordValue.aggregateId,
        isDegraded: false,
        isHealthy: false,
        socketStatus: "connecting",
        status: "CONNECTING",
      };
      break;
    }
    default:
      return null;
  }

  if (realtimeType === null || eventData === null) return null;

  return {
    aggregateId: recordValue.aggregateId,
    aggregateType: recordValue.aggregateType,
    data: eventData,
    eventId: recordValue.id,
    occurredAt: recordValue.occurredAt.toISOString(),
    type: realtimeType,
  };
}

export function formatChannelMessageEvent(event: ChannelRealtimeEvent): MessageEvent {
  return {
    data: JSON.stringify({
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      type: event.type,
      ...event.data,
    }),
    id: event.eventId,
    type: event.type,
  };
}

@Injectable()
export class ChannelRealtimeService {
  private readonly listeners = new Map<string, Set<Subject<MessageEvent>>>();
  private readonly directClients = new Map<
    string,
    Set<{ res: ChannelRealtimeHttpResponse; pingTimer: ReturnType<typeof setInterval> }>
  >();

  broadcastToTenant(tenantId: string, event: ChannelRealtimeEvent): void {
    this.publishTenantChannelEvent(tenantId, event);
  }

  publishTenantChannelEvent(tenantId: string, event: ChannelRealtimeEvent): void {
    // 1. Publish to RxJS listeners
    const listeners = this.listeners.get(tenantId);
    if (listeners !== undefined) {
      const message = formatChannelMessageEvent(event);
      for (const listener of listeners) {
        listener.next(message);
      }
    }

    // 2. Publish to direct HTTP response clients
    const clients = this.directClients.get(tenantId);
    if (clients !== undefined && clients.size > 0) {
      const payload = JSON.stringify({
        aggregateId: event.aggregateId,
        aggregateType: event.aggregateType,
        eventId: event.eventId,
        occurredAt: event.occurredAt,
        type: event.type,
        ...event.data,
      });
      const sseData = `id: ${event.eventId}\nevent: ${event.type}\ndata: ${payload}\n\n`;
      for (const client of clients) {
        try {
          client.res.write(sseData);
        } catch {
          // ignore closed socket error
        }
      }
    }
  }

  subscribeTenantChannelEvents(
    tenantId: string,
    heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const listener = new Subject<MessageEvent>();
      const tenantListeners = this.listeners.get(tenantId) ?? new Set<Subject<MessageEvent>>();
      tenantListeners.add(listener);
      this.listeners.set(tenantId, tenantListeners);

      // Initial connected event followed by pings
      const initialMessage: MessageEvent = {
        data: JSON.stringify({ status: "connected", tenantId }),
        type: "connected",
      };
      subscriber.next(initialMessage);

      const subscription = merge(
        listener,
        interval(heartbeatIntervalMs).pipe(map((): MessageEvent => ({ data: "{}", type: "ping" }))),
      ).subscribe(subscriber);

      return () => {
        subscription.unsubscribe();
        listener.complete();
        tenantListeners.delete(listener);
        if (tenantListeners.size === 0) this.listeners.delete(tenantId);
      };
    });
  }

  addClient(tenantId: string, res: ChannelRealtimeHttpResponse): () => void {
    const clients =
      this.directClients.get(tenantId) ??
      new Set<{ res: ChannelRealtimeHttpResponse; pingTimer: ReturnType<typeof setInterval> }>();
    this.directClients.set(tenantId, clients);

    // Initial connected event
    res.write(`event: connected\ndata: ${JSON.stringify({ status: "connected", tenantId })}\n\n`);

    // Ping interval
    const pingTimer = setInterval(() => {
      try {
        res.write(`event: ping\ndata: {}\n\n`);
      } catch {
        // socket closed
      }
    }, HEARTBEAT_INTERVAL_MS);

    const clientRecord = { pingTimer, res };
    clients.add(clientRecord);

    const cleanup = () => {
      clearInterval(pingTimer);
      clients.delete(clientRecord);
      if (clients.size === 0) {
        this.directClients.delete(tenantId);
      }
    };

    res.on("close", cleanup);
    res.on("finish", cleanup);

    return cleanup;
  }

  subscriberCount(tenantId: string): number {
    const rxCount = this.listeners.get(tenantId)?.size ?? 0;
    const directCount = this.directClients.get(tenantId)?.size ?? 0;
    return rxCount + directCount;
  }
}

export const ChannelRealtimeBroadcaster = ChannelRealtimeService;

@Injectable()
export class ChannelRealtimeOutboxBridge implements OnModuleInit, OnModuleDestroy {
  private cursor: OutboxCursor | null = null;
  private polling = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;

  constructor(
    private readonly service: ChannelRealtimeService,
    @Inject(CHANNEL_REALTIME_OUTBOX_DATABASE)
    private readonly database: ChannelRealtimeOutboxDatabase,
  ) {}

  async onModuleInit(): Promise<void> {
    const latest = await this.database.domainEventOutbox.findFirst({
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: { id: true, occurredAt: true },
    });
    this.cursor = latest === null ? null : latest;
    this.timer = setInterval(() => {
      void this.poll();
    }, OUTBOX_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.polling) return;
    this.polling = true;
    try {
      const cursor = this.cursor;
      const records = await this.database.domainEventOutbox.findMany({
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        select: {
          aggregateId: true,
          aggregateType: true,
          eventType: true,
          id: true,
          occurredAt: true,
          payload: true,
          tenantId: true,
        },
        take: OUTBOX_BATCH_SIZE,
        where: {
          eventType: { in: [...CHANNEL_OUTBOX_EVENT_TYPES] },
          ...(cursor === null
            ? {}
            : {
                OR: [
                  { occurredAt: { gt: cursor.occurredAt } },
                  { occurredAt: cursor.occurredAt, id: { gt: cursor.id } },
                ],
              }),
        },
      });

      for (const recordValue of records as OutboxRecord[]) {
        this.cursor = { id: recordValue.id, occurredAt: recordValue.occurredAt };
        const event = parseChannelOutboxEvent(recordValue);
        if (event !== null) {
          this.service.broadcastToTenant(recordValue.tenantId, event);
        }
      }
    } finally {
      this.polling = false;
    }
  }
}
