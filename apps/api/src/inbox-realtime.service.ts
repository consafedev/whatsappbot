import {
  Inject,
  Injectable,
  type MessageEvent,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { PrismaClient } from "@whatsapp-platform/database/platform";
import { interval, map, merge, Observable, Subject } from "rxjs";

const HEARTBEAT_INTERVAL_MS = 20_000;
const OUTBOX_POLL_INTERVAL_MS = 250;
const OUTBOX_BATCH_SIZE = 100;

const OUTBOX_EVENT_TYPES = [
  "message.received",
  "message.queued",
  "message.echo_reconciled",
  "message.external_human_detected",
  "message.delivery_status_updated",
  "conversation.status_updated",
  "conversation.assigned",
] as const;

const EVENT_NAME_BY_OUTBOX_TYPE = {
  "conversation.assigned": "inbox.conversation_assigned",
  "conversation.status_updated": "inbox.conversation_status_updated",
  "message.delivery_status_updated": "inbox.delivery_status_updated",
  "message.echo_reconciled": "inbox.echo_reconciled",
  "message.external_human_detected": "inbox.external_human_detected",
  "message.queued": "inbox.message_sent",
  "message.received": "inbox.message_received",
} as const;

export type InboxRealtimeEventType =
  (typeof EVENT_NAME_BY_OUTBOX_TYPE)[(typeof OUTBOX_EVENT_TYPES)[number]];

export type InboxRealtimeEvent = Readonly<{
  eventId: string;
  type: InboxRealtimeEventType;
  occurredAt: string;
  aggregateType: string;
  aggregateId: string;
  data: Readonly<Record<string, string | null>>;
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

export type InboxRealtimeOutboxDatabase = Pick<PrismaClient, "domainEventOutbox">;

export const INBOX_REALTIME_BROADCASTER = Symbol("INBOX_REALTIME_BROADCASTER");
export const INBOX_REALTIME_OUTBOX_DATABASE = Symbol("INBOX_REALTIME_OUTBOX_DATABASE");

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function eventData(
  payload: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Readonly<Record<string, string | null>> | null {
  const source = record(payload);
  if (source === null) return null;

  const result: Record<string, string | null> = {};
  for (const key of required) {
    const value = text(source[key]);
    if (value === null) return null;
    result[key] = value;
  }
  for (const key of optional) {
    const value = source[key];
    if (value === null) {
      result[key] = null;
    } else if (text(value) !== null) {
      result[key] = text(value);
    }
  }
  return result;
}

function inboxEvent(recordValue: OutboxRecord): InboxRealtimeEvent | null {
  if (!(recordValue.eventType in EVENT_NAME_BY_OUTBOX_TYPE)) return null;

  const eventType = recordValue.eventType as (typeof OUTBOX_EVENT_TYPES)[number];
  let data: Readonly<Record<string, string | null>> | null;
  switch (eventType) {
    case "conversation.assigned":
      data = eventData(
        recordValue.payload,
        ["conversationId"],
        ["actorId", "assignedUserId", "assignedUnitId"],
      );
      break;
    case "conversation.status_updated":
      data = eventData(
        recordValue.payload,
        ["conversationId", "previousStatus", "newStatus"],
        ["actorId"],
      );
      break;
    case "message.delivery_status_updated":
      data = eventData(recordValue.payload, ["conversationId", "messageId", "deliveryStatus"]);
      break;
    case "message.echo_reconciled":
      data = eventData(
        recordValue.payload,
        ["messageId"],
        ["eventId", "outboundMessageId", "providerTimestamp"],
      );
      break;
    case "message.external_human_detected":
      data = eventData(recordValue.payload, ["conversationId", "messageId", "origin"], ["eventId"]);
      break;
    case "message.queued":
      data = eventData(
        recordValue.payload,
        ["conversationId", "messageId", "direction", "origin"],
        ["outboundMessageId"],
      );
      break;
    case "message.received":
      data = eventData(
        recordValue.payload,
        ["conversationId", "messageId", "direction", "origin"],
        ["eventId"],
      );
      break;
  }

  if (data === null) return null;
  return {
    aggregateId: recordValue.aggregateId,
    aggregateType: recordValue.aggregateType,
    data,
    eventId: recordValue.id,
    occurredAt: recordValue.occurredAt.toISOString(),
    type: EVENT_NAME_BY_OUTBOX_TYPE[eventType],
  };
}

function messageEvent(event: InboxRealtimeEvent): MessageEvent {
  return {
    data: JSON.stringify({
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      ...event.data,
    }),
    id: event.eventId,
    type: event.type,
  };
}

@Injectable()
export class InboxRealtimeBroadcaster {
  private readonly listeners = new Map<string, Set<Subject<MessageEvent>>>();

  publishTenantInboxEvent(tenantId: string, event: InboxRealtimeEvent): void {
    const listeners = this.listeners.get(tenantId);
    if (listeners === undefined) return;
    const message = messageEvent(event);
    for (const listener of listeners) listener.next(message);
  }

  subscribeTenantInboxEvents(
    tenantId: string,
    heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const listener = new Subject<MessageEvent>();
      const tenantListeners = this.listeners.get(tenantId) ?? new Set<Subject<MessageEvent>>();
      tenantListeners.add(listener);
      this.listeners.set(tenantId, tenantListeners);

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

  subscriberCount(tenantId: string): number {
    return this.listeners.get(tenantId)?.size ?? 0;
  }
}

@Injectable()
export class InboxRealtimeOutboxBridge implements OnModuleInit, OnModuleDestroy {
  private cursor: OutboxCursor | null = null;
  private polling = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;

  constructor(
    private readonly broadcaster: InboxRealtimeBroadcaster,
    @Inject(INBOX_REALTIME_OUTBOX_DATABASE)
    private readonly database: InboxRealtimeOutboxDatabase,
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
          eventType: { in: [...OUTBOX_EVENT_TYPES] },
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
        const event = inboxEvent(recordValue);
        if (event !== null) this.broadcaster.publishTenantInboxEvent(recordValue.tenantId, event);
      }
    } finally {
      this.polling = false;
    }
  }
}
