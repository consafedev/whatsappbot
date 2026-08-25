import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyRealtimeEvent,
  assignConversation,
  deliveryStatusDetails,
  fetchConversationDetail,
  fetchConversationMessages,
  fetchConversations,
  formatE164Phone,
  formatMessageTime,
  formatRelativeTime,
  INITIAL_INBOX_STATE,
  type InboxConversation,
  type InboxMessage,
  type InboxState,
  initialsFromName,
  originLabel,
  sendConversationMessage,
  updateConversationStatus,
} from "./inbox-view-model";

describe("inbox view model", () => {
  const mockConversation: InboxConversation = {
    assignedUnit: { id: "unit-1", name: "Ventas León" },
    assignedUnitId: "unit-1",
    assignedUser: { displayName: "Ana López", id: "user-1" },
    assignedUserId: "user-1",
    automationMode: "HUMAN",
    channelAccount: {
      id: "chan-1",
      name: "WhatsApp Ventas",
      phoneNumber: "+524772201188",
      provider: "mock",
    },
    channelAccountId: "chan-1",
    closedAt: null,
    contact: { id: "contact-1", name: "María Salcedo", phoneNumber: "+524772201188" },
    contactId: "contact-1",
    createdAt: "2026-08-24T10:00:00.000Z",
    humanTakeoverUntil: null,
    id: "conv-1",
    lastHumanMessageAt: "2026-08-24T10:05:00.000Z",
    lastInboundAt: "2026-08-24T10:00:00.000Z",
    lastMessageAt: "2026-08-24T10:05:00.000Z",
    lastOutboundAt: "2026-08-24T10:05:00.000Z",
    priority: 1,
    status: "open",
    subject: null,
    unread: false,
    updatedAt: "2026-08-24T10:05:00.000Z",
  };

  const mockMessage: InboxMessage = {
    actorId: "user-1",
    actorType: "tenant_user",
    conversationId: "conv-1",
    createdAt: "2026-08-24T10:05:00.000Z",
    deliveryStatus: "queued",
    direction: "outbound",
    id: "msg-1",
    origin: "human_app",
    providerTimestamp: null,
    structuredPayload: null,
    textBody: "Hola María, te confirmamos tu cita.",
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("API Service Functions", () => {
    it("fetchConversations builds correct URL and query parameters", async () => {
      const mockResponse = {
        items: [mockConversation],
        nextCursor: "cursor-123",
        totalActive: 1,
      };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockResponse,
        ok: true,
        status: 200,
      });

      const result = await fetchConversations("http://api.local", {
        assignedUserId: "user-1",
        channelAccountId: "chan-1",
        search: "María",
        status: "open",
      });

      expect(result).toEqual(mockResponse);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://api.local/api/v1/inbox/conversations?status=open&assignedUserId=user-1&channelAccountId=chan-1&search=Mar%C3%ADa",
        expect.objectContaining({ credentials: "include", method: "GET" }),
      );
    });

    it("fetchConversations throws on error response", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(fetchConversations("http://api.local", { status: "active" })).rejects.toThrow(
        "Failed to fetch conversations: 500",
      );
    });

    it("fetchConversationDetail fetches conversation by id", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockConversation,
        ok: true,
        status: 200,
      });

      const result = await fetchConversationDetail("http://api.local", "conv-1");
      expect(result).toEqual(mockConversation);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://api.local/api/v1/inbox/conversations/conv-1",
        expect.objectContaining({ credentials: "include", method: "GET" }),
      );
    });

    it("fetchConversationMessages fetches timeline with cursor options", async () => {
      const mockResponse = {
        items: [mockMessage],
        nextCursor: null,
        prevCursor: "cursor-prev",
      };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockResponse,
        ok: true,
        status: 200,
      });

      const result = await fetchConversationMessages("http://api.local", "conv-1", {
        cursor: "cursor-abc",
        direction: "before",
        limit: 20,
      });

      expect(result).toEqual(mockResponse);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://api.local/api/v1/inbox/conversations/conv-1/messages?cursor=cursor-abc&direction=before&limit=20",
        expect.objectContaining({ credentials: "include", method: "GET" }),
      );
    });

    it("sendConversationMessage posts text and media payload", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => ({ message: mockMessage }),
        ok: true,
        status: 201,
      });

      const result = await sendConversationMessage("http://api.local", "conv-1", {
        caption: "Detalle de orden",
        idempotencyKey: "idemp-1",
        mediaUrl: "https://files.example.com/doc.pdf",
        textBody: "Adjunto el archivo",
      });

      expect(result).toEqual(mockMessage);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://api.local/api/v1/inbox/conversations/conv-1/messages",
        expect.objectContaining({
          body: JSON.stringify({
            textBody: "Adjunto el archivo",
            mediaUrl: "https://files.example.com/doc.pdf",
            caption: "Detalle de orden",
            idempotencyKey: "idemp-1",
          }),
          credentials: "include",
          method: "POST",
        }),
      );
    });

    it("updateConversationStatus patches status with reason", async () => {
      const updatedConv = {
        ...mockConversation,
        status: "closed",
        closedAt: "2026-08-24T12:00:00Z",
      };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => updatedConv,
        ok: true,
        status: 200,
      });

      const result = await updateConversationStatus(
        "http://api.local",
        "conv-1",
        "closed",
        "Atención finalizada",
      );

      expect(result).toEqual(updatedConv);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://api.local/api/v1/inbox/conversations/conv-1/status",
        expect.objectContaining({
          body: JSON.stringify({ status: "closed", reason: "Atención finalizada" }),
          credentials: "include",
          method: "PATCH",
        }),
      );
    });

    it("assignConversation patches user and unit assignments", async () => {
      const updatedConv = { ...mockConversation, assignedUserId: "user-2", assignedUnitId: null };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => updatedConv,
        ok: true,
        status: 200,
      });

      const result = await assignConversation("http://api.local", "conv-1", {
        assignedUnitId: null,
        assignedUserId: "user-2",
      });

      expect(result).toEqual(updatedConv);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://api.local/api/v1/inbox/conversations/conv-1/assignment",
        expect.objectContaining({
          body: JSON.stringify({ assignedUserId: "user-2", assignedUnitId: null }),
          credentials: "include",
          method: "PATCH",
        }),
      );
    });
  });

  describe("Realtime SSE Event Reducer (applyRealtimeEvent)", () => {
    it("handles inbox.message_received for active conversation", () => {
      const state: InboxState = {
        ...INITIAL_INBOX_STATE,
        conversations: [mockConversation],
        messages: [mockMessage],
        selectedConversation: mockConversation,
        selectedConversationId: "conv-1",
      };

      const event = {
        aggregateId: "conv-1",
        aggregateType: "conversation",
        conversationId: "conv-1",
        direction: "inbound",
        eventId: "event-1",
        messageId: "msg-2",
        occurredAt: "2026-08-24T10:10:00.000Z",
        origin: "customer",
        type: "inbox.message_received",
      };

      const nextState = applyRealtimeEvent(state, event);

      expect(nextState.messages).toHaveLength(2);
      expect(nextState.messages[1]?.id).toBe("msg-2");
      expect(nextState.messages[1]?.direction).toBe("inbound");
      expect(nextState.conversations[0]?.lastMessageAt).toBe("2026-08-24T10:10:00.000Z");
      expect(nextState.conversations[0]?.unread).toBe(false); // already selected
    });

    it("marks conversation unread when message received on non-selected conversation", () => {
      const otherConv = { ...mockConversation, id: "conv-2", unread: false };
      const state: InboxState = {
        ...INITIAL_INBOX_STATE,
        conversations: [mockConversation, otherConv],
        messages: [mockMessage],
        selectedConversation: mockConversation,
        selectedConversationId: "conv-1",
      };

      const event = {
        aggregateId: "conv-2",
        aggregateType: "conversation",
        conversationId: "conv-2",
        direction: "inbound",
        eventId: "event-2",
        messageId: "msg-99",
        occurredAt: "2026-08-24T10:15:00.000Z",
        origin: "customer",
        type: "inbox.message_received",
      };

      const nextState = applyRealtimeEvent(state, event);

      // conv-2 moved to top and marked unread
      expect(nextState.conversations[0]?.id).toBe("conv-2");
      expect(nextState.conversations[0]?.unread).toBe(true);
      // messages in selected conversation not touched
      expect(nextState.messages).toHaveLength(1);
    });

    it("prevents duplicate messages in timeline", () => {
      const state: InboxState = {
        ...INITIAL_INBOX_STATE,
        conversations: [mockConversation],
        messages: [mockMessage],
        selectedConversationId: "conv-1",
      };

      const event = {
        aggregateId: "conv-1",
        aggregateType: "conversation",
        conversationId: "conv-1",
        direction: "outbound",
        eventId: "event-duplicate",
        messageId: "msg-1", // already in state.messages
        occurredAt: "2026-08-24T10:05:00.000Z",
        origin: "human_app",
        type: "inbox.message_sent",
      };

      const nextState = applyRealtimeEvent(state, event);
      expect(nextState.messages).toHaveLength(1);
    });

    it("updates message deliveryStatus on inbox.delivery_status_updated", () => {
      const state: InboxState = {
        ...INITIAL_INBOX_STATE,
        messages: [{ ...mockMessage, deliveryStatus: "queued" }],
      };

      const event = {
        aggregateId: "conv-1",
        aggregateType: "conversation",
        conversationId: "conv-1",
        deliveryStatus: "delivered",
        eventId: "event-deliv",
        messageId: "msg-1",
        occurredAt: "2026-08-24T10:06:00.000Z",
        type: "inbox.delivery_status_updated",
      };

      const nextState = applyRealtimeEvent(state, event);
      expect(nextState.messages[0]?.deliveryStatus).toBe("delivered");
    });

    it("updates message deliveryStatus and providerTimestamp on inbox.echo_reconciled", () => {
      const state: InboxState = {
        ...INITIAL_INBOX_STATE,
        messages: [{ ...mockMessage, deliveryStatus: "queued" }],
      };

      const event = {
        aggregateId: "conv-1",
        aggregateType: "conversation",
        eventId: "event-echo",
        messageId: "msg-1",
        occurredAt: "2026-08-24T10:05:30.000Z",
        providerTimestamp: "2026-08-24T10:05:25.000Z",
        type: "inbox.echo_reconciled",
      };

      const nextState = applyRealtimeEvent(state, event);
      expect(nextState.messages[0]?.deliveryStatus).toBe("sent");
      expect(nextState.messages[0]?.providerTimestamp).toBe("2026-08-24T10:05:25.000Z");
    });

    it("updates conversation status on inbox.conversation_status_updated", () => {
      const state: InboxState = {
        ...INITIAL_INBOX_STATE,
        conversations: [mockConversation],
        selectedConversation: mockConversation,
        selectedConversationId: "conv-1",
      };

      const event = {
        aggregateId: "conv-1",
        aggregateType: "conversation",
        conversationId: "conv-1",
        eventId: "event-stat",
        newStatus: "pending",
        occurredAt: "2026-08-24T10:20:00.000Z",
        previousStatus: "open",
        type: "inbox.conversation_status_updated",
      };

      const nextState = applyRealtimeEvent(state, event);
      expect(nextState.conversations[0]?.status).toBe("pending");
      expect(nextState.selectedConversation?.status).toBe("pending");
    });

    it("updates conversation assignment on inbox.conversation_assigned", () => {
      const state: InboxState = {
        ...INITIAL_INBOX_STATE,
        conversations: [mockConversation],
        selectedConversation: mockConversation,
        selectedConversationId: "conv-1",
      };

      const event = {
        aggregateId: "conv-1",
        aggregateType: "conversation",
        assignedUnitId: "unit-99",
        assignedUserId: null,
        conversationId: "conv-1",
        eventId: "event-assign",
        occurredAt: "2026-08-24T10:25:00.000Z",
        type: "inbox.conversation_assigned",
      };

      const nextState = applyRealtimeEvent(state, event);
      expect(nextState.conversations[0]?.assignedUserId).toBeNull();
      expect(nextState.conversations[0]?.assignedUnitId).toBe("unit-99");
      expect(nextState.selectedConversation?.assignedUserId).toBeNull();
      expect(nextState.selectedConversation?.assignedUnitId).toBe("unit-99");
    });
  });

  describe("Formatting & Helper Functions", () => {
    it("initialsFromName extracts initials cleanly", () => {
      expect(initialsFromName("María Salcedo")).toBe("MS");
      expect(initialsFromName("Carlos")).toBe("CA");
      expect(initialsFromName("", "+524772201188")).toBe("88");
      expect(initialsFromName(null)).toBe("WA");
    });

    it("formatE164Phone formats Mexican phone numbers", () => {
      expect(formatE164Phone("+524772201188")).toBe("+52 477 220 1188");
      expect(formatE164Phone("+14155552671")).toBe("+14155552671");
      expect(formatE164Phone(null)).toBe("—");
    });

    it("formatRelativeTime returns readable human relative times", () => {
      const now = new Date();
      expect(formatRelativeTime(now.toISOString())).toBe("ahora");

      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
      expect(formatRelativeTime(tenMinutesAgo.toISOString())).toBe("10m");

      expect(formatRelativeTime(null)).toBe("—");
      expect(formatRelativeTime("invalid-date")).toBe("—");
    });

    it("formatMessageTime formats hour and minute", () => {
      const date = new Date("2026-08-24T15:30:00.000Z");
      expect(formatMessageTime(date.toISOString())).toMatch(/\d{2}:\d{2}/);
      expect(formatMessageTime(null)).toBe("");
    });

    it("deliveryStatusDetails maps each delivery status correctly", () => {
      expect(deliveryStatusDetails("queued")).toEqual({
        className: "status-queued",
        icon: "🕒",
        label: "En cola",
      });
      expect(deliveryStatusDetails("sent")).toEqual({
        className: "status-sent",
        icon: "✓",
        label: "Enviado",
      });
      expect(deliveryStatusDetails("delivered")).toEqual({
        className: "status-delivered",
        icon: "✓✓",
        label: "Entregado",
      });
      expect(deliveryStatusDetails("read")).toEqual({
        className: "status-read",
        icon: "✓✓",
        label: "Leído",
      });
      expect(deliveryStatusDetails("failed")).toEqual({
        className: "status-failed",
        icon: "⚠",
        label: "Error de envío",
      });
      expect(deliveryStatusDetails("unknown")).toEqual({
        className: "status-unknown",
        icon: "•",
        label: "unknown",
      });
    });

    it("originLabel produces readable origin strings", () => {
      expect(originLabel("customer", "María")).toBe("Cliente · María");
      expect(originLabel("human_app", "Ana")).toBe("Humano · App · Ana");
      expect(originLabel("human_external_device")).toBe("Humano · WhatsApp");
      expect(originLabel("automation")).toBe("BOT · Rule");
      expect(originLabel("system")).toBe("Sistema");
    });
  });
});
