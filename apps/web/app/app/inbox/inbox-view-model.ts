export type ConversationStatus = "new" | "open" | "pending" | "closed";
export type AutomationMode = "AUTO" | "ASSISTED" | "HUMAN" | "MONITOR";
export type MessageDirection = "inbound" | "outbound";
export type MessageDeliveryStatus = "queued" | "sent" | "delivered" | "read" | "failed";
export type MessageOrigin =
  | "customer"
  | "human_app"
  | "human_external_device"
  | "automation"
  | "system";
export type MessageActorType = "customer" | "tenant_user" | "external_human_unknown" | "system";

export type InboxContactSummary = Readonly<{
  id: string;
  name: string | null;
  phoneNumber: string;
}>;

export type InboxChannelAccountSummary = Readonly<{
  id: string;
  name: string;
  phoneNumber: string;
  provider: string;
}>;

export type InboxUserSummary = Readonly<{
  displayName: string;
  id: string;
}>;

export type InboxUnitSummary = Readonly<{
  id: string;
  name: string;
}>;

export type InboxConversation = Readonly<{
  assignedUnit: InboxUnitSummary | null;
  assignedUnitId: string | null;
  assignedUser: InboxUserSummary | null;
  assignedUserId: string | null;
  automationMode: string;
  channelAccount: InboxChannelAccountSummary;
  channelAccountId: string;
  closedAt: string | null;
  contact: InboxContactSummary;
  contactId: string;
  createdAt: string;
  humanTakeoverUntil: string | null;
  id: string;
  lastHumanMessageAt: string | null;
  lastInboundAt: string | null;
  lastMessageAt: string | null;
  lastOutboundAt: string | null;
  priority: number;
  status: string;
  subject: string | null;
  unread: boolean;
  updatedAt: string;
}>;

export type InboxStructuredPayload = Readonly<{
  caption?: string | undefined;
  fileName?: string | undefined;
  mediaUrl?: string | undefined;
  mimeType?: string | undefined;
  [key: string]: unknown;
}>;

export type InboxMessage = Readonly<{
  actorId: string | null;
  actorType: string;
  conversationId: string;
  createdAt: string;
  deliveryStatus: string;
  direction: string;
  id: string;
  origin: string;
  providerTimestamp: string | null;
  structuredPayload: InboxStructuredPayload | null;
  textBody: string | null;
}>;

export type InboxListFilter = Readonly<{
  assignedUnitId?: string | undefined;
  assignedUserId?: string | undefined;
  channelAccountId?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
  search?: string | undefined;
  status?: string | undefined;
}>;

export type InboxConversationsResponse = Readonly<{
  items: readonly InboxConversation[];
  nextCursor: string | null;
  totalActive: number;
}>;

export type InboxMessagesResponse = Readonly<{
  items: readonly InboxMessage[];
  nextCursor: string | null;
  prevCursor: string | null;
}>;

export type SendMessagePayload = Readonly<{
  caption?: string | undefined;
  idempotencyKey?: string | undefined;
  mediaUrl?: string | undefined;
  textBody?: string | undefined;
}>;

export type InboxRealtimeEvent = Readonly<{
  aggregateId: string;
  aggregateType: string;
  eventId: string;
  occurredAt: string;
  type: string;
  [key: string]: unknown;
}>;

export type InboxState = Readonly<{
  conversations: readonly InboxConversation[];
  error: string | null;
  filter: InboxListFilter;
  loadingConversations: boolean;
  loadingMessages: boolean;
  messages: readonly InboxMessage[];
  messagesNextCursor: string | null;
  messagesPrevCursor: string | null;
  nextCursor: string | null;
  selectedConversation: InboxConversation | null;
  selectedConversationId: string | null;
  sendingMessage: boolean;
  totalActive: number;
}>;

export const INITIAL_INBOX_STATE: InboxState = Object.freeze({
  conversations: [],
  error: null,
  filter: { status: "active" },
  loadingConversations: false,
  loadingMessages: false,
  messages: [],
  messagesNextCursor: null,
  messagesPrevCursor: null,
  nextCursor: null,
  selectedConversation: null,
  selectedConversationId: null,
  sendingMessage: false,
  totalActive: 0,
});

export async function fetchConversations(
  apiBaseUrl: string,
  filter: InboxListFilter = {},
): Promise<InboxConversationsResponse> {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.assignedUserId) params.set("assignedUserId", filter.assignedUserId);
  if (filter.assignedUnitId) params.set("assignedUnitId", filter.assignedUnitId);
  if (filter.channelAccountId) params.set("channelAccountId", filter.channelAccountId);
  if (filter.search) params.set("search", filter.search);
  if (filter.cursor) params.set("cursor", filter.cursor);
  if (filter.limit !== undefined) params.set("limit", String(filter.limit));

  const url = `${apiBaseUrl}/api/v1/inbox/conversations${params.toString() ? `?${params.toString()}` : ""}`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch conversations: ${response.status}`);
  }

  return (await response.json()) as InboxConversationsResponse;
}

export async function fetchConversationDetail(
  apiBaseUrl: string,
  conversationId: string,
): Promise<InboxConversation> {
  const url = `${apiBaseUrl}/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch conversation detail: ${response.status}`);
  }

  return (await response.json()) as InboxConversation;
}

export async function fetchConversationMessages(
  apiBaseUrl: string,
  conversationId: string,
  options: {
    cursor?: string | undefined;
    direction?: "before" | "after" | undefined;
    limit?: number | undefined;
  } = {},
): Promise<InboxMessagesResponse> {
  const params = new URLSearchParams();
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.direction) params.set("direction", options.direction);
  if (options.limit !== undefined) params.set("limit", String(options.limit));

  const url = `${apiBaseUrl}/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages${params.toString() ? `?${params.toString()}` : ""}`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch messages: ${response.status}`);
  }

  return (await response.json()) as InboxMessagesResponse;
}

export async function sendConversationMessage(
  apiBaseUrl: string,
  conversationId: string,
  payload: SendMessagePayload,
): Promise<InboxMessage> {
  const body: Record<string, unknown> = {};
  if (payload.textBody) body.textBody = payload.textBody;
  if (payload.mediaUrl) body.mediaUrl = payload.mediaUrl;
  if (payload.caption) body.caption = payload.caption;
  if (payload.idempotencyKey) body.idempotencyKey = payload.idempotencyKey;

  const url = `${apiBaseUrl}/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages`;
  const response = await fetch(url, {
    body: JSON.stringify(body),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Failed to send message (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { message: InboxMessage };
  return data.message;
}

export async function updateConversationStatus(
  apiBaseUrl: string,
  conversationId: string,
  status: "open" | "pending" | "closed",
  reason?: string | undefined,
): Promise<InboxConversation> {
  const body: Record<string, unknown> = { status };
  if (reason) body.reason = reason;

  const url = `${apiBaseUrl}/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}/status`;
  const response = await fetch(url, {
    body: JSON.stringify(body),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    method: "PATCH",
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Failed to update status (${response.status}): ${errorText}`);
  }

  return (await response.json()) as InboxConversation;
}

export async function assignConversation(
  apiBaseUrl: string,
  conversationId: string,
  assignment: {
    assignedUnitId?: string | null | undefined;
    assignedUserId?: string | null | undefined;
  },
): Promise<InboxConversation> {
  const body: Record<string, unknown> = {};
  if ("assignedUserId" in assignment) body.assignedUserId = assignment.assignedUserId;
  if ("assignedUnitId" in assignment) body.assignedUnitId = assignment.assignedUnitId;

  const url = `${apiBaseUrl}/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}/assignment`;
  const response = await fetch(url, {
    body: JSON.stringify(body),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    method: "PATCH",
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Failed to assign conversation (${response.status}): ${errorText}`);
  }

  return (await response.json()) as InboxConversation;
}

export function applyRealtimeEvent(state: InboxState, event: InboxRealtimeEvent): InboxState {
  const eventType = event.type;
  const conversationId = (event.conversationId as string) || (event.aggregateId as string);

  switch (eventType) {
    case "inbox.message_received":
    case "inbox.message_sent":
    case "inbox.external_human_detected": {
      const messageId = (event.messageId as string) || event.eventId;
      const direction =
        (event.direction as string) ||
        (eventType === "inbox.message_received" ? "inbound" : "outbound");
      const origin =
        (event.origin as string) ||
        (eventType === "inbox.message_received" ? "customer" : "human_app");

      let updatedMessages = state.messages;
      if (state.selectedConversationId === conversationId) {
        const exists = state.messages.some((m) => m.id === messageId);
        if (!exists) {
          const newMessage: InboxMessage = {
            actorId: null,
            actorType: direction === "inbound" ? "customer" : "tenant_user",
            conversationId,
            createdAt: event.occurredAt || new Date().toISOString(),
            deliveryStatus: direction === "outbound" ? "queued" : "delivered",
            direction,
            id: messageId,
            origin,
            providerTimestamp: null,
            structuredPayload: null,
            textBody: null,
          };
          updatedMessages = [...state.messages, newMessage];
        }
      }

      const convIndex = state.conversations.findIndex((c) => c.id === conversationId);
      const updatedConversations = [...state.conversations];
      if (convIndex >= 0) {
        const currentConv = state.conversations[convIndex];
        if (currentConv) {
          const updatedConv: InboxConversation = {
            ...currentConv,
            lastMessageAt: event.occurredAt || new Date().toISOString(),
            unread:
              state.selectedConversationId === conversationId
                ? false
                : direction === "inbound"
                  ? true
                  : currentConv.unread,
            updatedAt: event.occurredAt || new Date().toISOString(),
          };
          updatedConversations.splice(convIndex, 1);
          updatedConversations.unshift(updatedConv);
        }
      }

      let updatedSelected = state.selectedConversation;
      if (state.selectedConversation?.id === conversationId) {
        updatedSelected = {
          ...state.selectedConversation,
          lastMessageAt: event.occurredAt || new Date().toISOString(),
          updatedAt: event.occurredAt || new Date().toISOString(),
        };
      }

      return {
        ...state,
        conversations: updatedConversations,
        messages: updatedMessages,
        selectedConversation: updatedSelected,
      };
    }

    case "inbox.delivery_status_updated": {
      const messageId = event.messageId as string;
      const deliveryStatus = event.deliveryStatus as string;
      if (!messageId || !deliveryStatus) return state;

      const updatedMessages = state.messages.map((m) =>
        m.id === messageId ? { ...m, deliveryStatus } : m,
      );

      return {
        ...state,
        messages: updatedMessages,
      };
    }

    case "inbox.echo_reconciled": {
      const messageId = event.messageId as string;
      const providerTimestamp = (event.providerTimestamp as string) || null;
      if (!messageId) return state;

      const updatedMessages = state.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              deliveryStatus: m.deliveryStatus === "queued" ? "sent" : m.deliveryStatus,
              providerTimestamp: providerTimestamp ?? m.providerTimestamp,
            }
          : m,
      );

      return {
        ...state,
        messages: updatedMessages,
      };
    }

    case "inbox.conversation_status_updated": {
      const newStatus = event.newStatus as string;
      if (!newStatus) return state;

      const updatedConversations = state.conversations.map((c) =>
        c.id === conversationId ? { ...c, status: newStatus, updatedAt: event.occurredAt } : c,
      );

      const updatedSelected =
        state.selectedConversation?.id === conversationId
          ? { ...state.selectedConversation, status: newStatus, updatedAt: event.occurredAt }
          : state.selectedConversation;

      return {
        ...state,
        conversations: updatedConversations,
        selectedConversation: updatedSelected,
      };
    }

    case "inbox.conversation_assigned": {
      const assignedUserId = (event.assignedUserId as string) ?? null;
      const assignedUnitId = (event.assignedUnitId as string) ?? null;

      const updatedConversations = state.conversations.map((c) => {
        if (c.id !== conversationId) return c;
        return {
          ...c,
          assignedUnit: assignedUnitId ? c.assignedUnit : null,
          assignedUnitId,
          assignedUser: assignedUserId ? c.assignedUser : null,
          assignedUserId,
          updatedAt: event.occurredAt,
        };
      });

      const updatedSelected =
        state.selectedConversation?.id === conversationId
          ? {
              ...state.selectedConversation,
              assignedUnit: assignedUnitId ? state.selectedConversation.assignedUnit : null,
              assignedUnitId,
              assignedUser: assignedUserId ? state.selectedConversation.assignedUser : null,
              assignedUserId,
              updatedAt: event.occurredAt,
            }
          : state.selectedConversation;

      return {
        ...state,
        conversations: updatedConversations,
        selectedConversation: updatedSelected,
      };
    }

    default:
      return state;
  }
}

export function initialsFromName(name: string | null | undefined, fallbackPhone?: string): string {
  if (name && name.trim().length > 0) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    if (parts.length === 1 && parts[0]) {
      return parts[0].slice(0, 2).toUpperCase();
    }
  }
  if (fallbackPhone && fallbackPhone.trim().length > 0) {
    const digits = fallbackPhone.replace(/\D/g, "");
    return digits.slice(-2) || "W";
  }
  return "WA";
}

export function formatE164Phone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const cleaned = phone.trim();
  if (cleaned.startsWith("+52") && cleaned.length >= 12) {
    const nat = cleaned.slice(3);
    if (nat.length === 10) {
      return `+52 ${nat.slice(0, 3)} ${nat.slice(3, 6)} ${nat.slice(6)}`;
    }
  }
  return cleaned;
}

export function formatRelativeTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "—";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return "—";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return "ahora";
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHours < 24) {
    return date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  if (diffDays === 1) return "ayer";
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

export function formatMessageTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function deliveryStatusDetails(status: string | null | undefined): {
  className: string;
  icon: string;
  label: string;
} {
  switch (status) {
    case "queued":
      return { className: "status-queued", icon: "🕒", label: "En cola" };
    case "sent":
      return { className: "status-sent", icon: "✓", label: "Enviado" };
    case "delivered":
      return { className: "status-delivered", icon: "✓✓", label: "Entregado" };
    case "read":
      return { className: "status-read", icon: "✓✓", label: "Leído" };
    case "failed":
      return { className: "status-failed", icon: "⚠", label: "Error de envío" };
    default:
      return { className: "status-unknown", icon: "•", label: status || "Desconocido" };
  }
}

export function originLabel(origin: string, actorName?: string | null): string {
  switch (origin) {
    case "customer":
      return actorName ? `Cliente · ${actorName}` : "Cliente";
    case "human_app":
      return actorName ? `Humano · App · ${actorName}` : "Humano · App";
    case "human_external_device":
      return "Humano · WhatsApp";
    case "automation":
      return "BOT · Rule";
    case "system":
      return "Sistema";
    default:
      return origin;
  }
}
