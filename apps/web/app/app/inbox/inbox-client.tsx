"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTenantAppBootstrap } from "../tenant-app-shell";
import { InboxChatView } from "./inbox-chat-view";
import { InboxContactPanel } from "./inbox-contact-panel";
import { InboxThreadList } from "./inbox-thread-list";
import {
  applyRealtimeEvent,
  assignConversation,
  fetchConversationDetail,
  fetchConversationMessages,
  fetchConversations,
  INITIAL_INBOX_STATE,
  type InboxListFilter,
  type InboxRealtimeEvent,
  type InboxState,
  sendConversationMessage,
  updateConversationStatus,
} from "./inbox-view-model";

type InboxClientProps = Readonly<{
  apiBaseUrl?: string | undefined;
}>;

type UserOption = Readonly<{
  displayName: string;
  id: string;
}>;

type UnitOption = Readonly<{
  id: string;
  name: string;
}>;

export function InboxClient({ apiBaseUrl }: InboxClientProps) {
  const bootstrap = useTenantAppBootstrap();
  const base = apiBaseUrl ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

  const [state, setState] = useState<InboxState>(INITIAL_INBOX_STATE);
  const [mobilePane, setMobilePane] = useState<"list" | "chat" | "contact">("list");
  const [userOptions, setUserOptions] = useState<readonly UserOption[]>([]);
  const [unitOptions, setUnitOptions] = useState<readonly UnitOption[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  const hasMessagingModule = bootstrap.effectiveModules.includes("module.messaging.basic");
  const hasReadPermission = bootstrap.effectivePermissions.includes("conversations.read");
  const hasReplyPermission = bootstrap.effectivePermissions.includes("conversations.reply");
  const hasAssignPermission = bootstrap.effectivePermissions.includes("conversations.assign");

  // Load user and unit options for assignment
  useEffect(() => {
    async function loadOptions() {
      try {
        const userRes = await fetch(`${base}/app/users/options`, { credentials: "include" });
        if (userRes.ok) {
          const data = (await userRes.json()) as { users: UserOption[] };
          setUserOptions(data.users || []);
        }
      } catch {
        // fail-soft
      }

      try {
        const unitRes = await fetch(`${base}/app/organization-units`, { credentials: "include" });
        if (unitRes.ok) {
          const data = (await unitRes.json()) as { items: UnitOption[] };
          setUnitOptions(data.items || []);
        }
      } catch {
        // fail-soft
      }
    }
    void loadOptions();
  }, [base]);

  // Load conversations based on filter
  const loadConversations = useCallback(
    async (filter: InboxListFilter, append = false) => {
      setState((prev) => ({ ...prev, error: null, loadingConversations: true }));
      try {
        const result = await fetchConversations(base, filter);
        setState((prev) => ({
          ...prev,
          conversations: append ? [...prev.conversations, ...result.items] : result.items,
          filter,
          loadingConversations: false,
          nextCursor: result.nextCursor,
          totalActive: result.totalActive,
        }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : "Error al cargar conversaciones",
          loadingConversations: false,
        }));
      }
    },
    [base],
  );

  // Initial load
  useEffect(() => {
    if (hasMessagingModule && hasReadPermission) {
      void loadConversations(state.filter);
    }
  }, [hasMessagingModule, hasReadPermission, loadConversations, state.filter]);

  // Select conversation and load messages
  const handleSelectConversation = useCallback(
    async (conversationId: string) => {
      setState((prev) => ({
        ...prev,
        loadingMessages: true,
        messages: [],
        messagesNextCursor: null,
        messagesPrevCursor: null,
        selectedConversation: prev.conversations.find((c) => c.id === conversationId) ?? null,
        selectedConversationId: conversationId,
      }));
      setMobilePane("chat");

      try {
        const [detail, messagesRes] = await Promise.all([
          fetchConversationDetail(base, conversationId),
          fetchConversationMessages(base, conversationId, { limit: 30 }),
        ]);

        setState((prev) => ({
          ...prev,
          loadingMessages: false,
          messages: messagesRes.items,
          messagesNextCursor: messagesRes.nextCursor,
          messagesPrevCursor: messagesRes.prevCursor,
          selectedConversation: detail,
        }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : "Error al cargar conversación",
          loadingMessages: false,
        }));
      }
    },
    [base],
  );

  // Load older messages (pagination)
  const handleLoadPrevMessages = useCallback(async () => {
    const convId = state.selectedConversationId;
    const prevCursor = state.messagesPrevCursor;
    if (!convId || !prevCursor || state.loadingMessages) return;

    setState((prev) => ({ ...prev, loadingMessages: true }));
    try {
      const messagesRes = await fetchConversationMessages(base, convId, {
        cursor: prevCursor,
        direction: "before",
        limit: 30,
      });

      setState((prev) => ({
        ...prev,
        loadingMessages: false,
        messages: [...messagesRes.items, ...prev.messages],
        messagesPrevCursor: messagesRes.prevCursor,
      }));
    } catch {
      setState((prev) => ({ ...prev, loadingMessages: false }));
    }
  }, [base, state.loadingMessages, state.messagesPrevCursor, state.selectedConversationId]);

  // Load more conversations (pagination)
  const handleLoadMoreConversations = useCallback(() => {
    if (!state.nextCursor || state.loadingConversations) return;
    void loadConversations({ ...state.filter, cursor: state.nextCursor }, true);
  }, [loadConversations, state.filter, state.loadingConversations, state.nextCursor]);

  // Handle filter changes
  const handleFilterChange = useCallback(
    (newFilter: Partial<InboxListFilter>) => {
      const merged = { ...state.filter, ...newFilter };
      void loadConversations(merged, false);
    },
    [loadConversations, state.filter],
  );

  // Send message
  const handleSendMessage = useCallback(
    async (payload: {
      caption?: string | undefined;
      mediaUrl?: string | undefined;
      textBody?: string | undefined;
    }) => {
      const convId = state.selectedConversationId;
      if (!convId) return;

      setState((prev) => ({ ...prev, sendingMessage: true }));
      try {
        const sentMessage = await sendConversationMessage(base, convId, {
          ...payload,
          idempotencyKey: `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        });

        setState((prev) => {
          const exists = prev.messages.some((m) => m.id === sentMessage.id);
          return {
            ...prev,
            messages: exists ? prev.messages : [...prev.messages, sentMessage],
            sendingMessage: false,
          };
        });
      } catch (err) {
        setState((prev) => ({ ...prev, sendingMessage: false }));
        throw err;
      }
    },
    [base, state.selectedConversationId],
  );

  // Update status
  const handleUpdateStatus = useCallback(
    async (newStatus: "open" | "pending" | "closed", reason?: string | undefined) => {
      const convId = state.selectedConversationId;
      if (!convId) return;

      const updated = await updateConversationStatus(base, convId, newStatus, reason);
      setState((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) => (c.id === convId ? updated : c)),
        selectedConversation: updated,
      }));
    },
    [base, state.selectedConversationId],
  );

  // Assign conversation
  const handleAssignConversation = useCallback(
    async (assignment: {
      assignedUnitId?: string | null | undefined;
      assignedUserId?: string | null | undefined;
    }) => {
      const convId = state.selectedConversationId;
      if (!convId) return;

      const updated = await assignConversation(base, convId, assignment);
      setState((prev) => ({
        ...prev,
        conversations: prev.conversations.map((c) => (c.id === convId ? updated : c)),
        selectedConversation: updated,
      }));
    },
    [base, state.selectedConversationId],
  );

  // Realtime SSE EventSource Subscription
  useEffect(() => {
    if (!hasMessagingModule || !hasReadPermission) return;

    let eventSource: EventSource | null = null;
    let isCancelled = false;

    function connect() {
      if (isCancelled) return;
      try {
        eventSource = new EventSource(`${base}/api/v1/inbox/events`, {
          withCredentials: true,
        });

        const handleInboxEvent = (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data) as InboxRealtimeEvent;
            const eventWithData: InboxRealtimeEvent = {
              ...data,
              type: e.type || data.type,
            };
            setState((curr) => applyRealtimeEvent(curr, eventWithData));
          } catch {
            // ignore non-JSON or ping
          }
        };

        eventSource.onmessage = handleInboxEvent;

        // Custom event listeners
        const eventNames = [
          "inbox.message_received",
          "inbox.message_sent",
          "inbox.delivery_status_updated",
          "inbox.echo_reconciled",
          "inbox.external_human_detected",
          "inbox.conversation_status_updated",
          "inbox.conversation_assigned",
        ];

        for (const name of eventNames) {
          eventSource.addEventListener(name, (e) => {
            try {
              const data = JSON.parse(e.data) as InboxRealtimeEvent;
              const eventWithData: InboxRealtimeEvent = {
                ...data,
                type: name,
              };
              setState((curr) => applyRealtimeEvent(curr, eventWithData));
            } catch {
              // ignore
            }
          });
        }

        eventSource.onerror = () => {
          eventSource?.close();
          if (!isCancelled) {
            setTimeout(connect, 5000);
          }
        };
      } catch {
        if (!isCancelled) {
          setTimeout(connect, 5000);
        }
      }
    }

    connect();

    return () => {
      isCancelled = true;
      eventSource?.close();
    };
  }, [base, hasMessagingModule, hasReadPermission]);

  if (!hasMessagingModule) {
    return (
      <div className="inbox-error-gate" role="alert">
        <h2>Módulo de Mensajería no habilitado</h2>
        <p>
          Este tenant no tiene habilitado el módulo <code>module.messaging.basic</code>. Contacta al
          administrador para activar este módulo.
        </p>
      </div>
    );
  }

  if (!hasReadPermission) {
    return (
      <div className="inbox-error-gate" role="alert">
        <h2>Permiso insuficiente</h2>
        <p>
          Tu rol no incluye el permiso <code>conversations.read</code> necesario para acceder al
          Inbox.
        </p>
      </div>
    );
  }

  return (
    <div className={`inbox-container mobile-view-${mobilePane}`}>
      <div className="inbox-column-list">
        <InboxThreadList
          conversations={state.conversations}
          filter={state.filter}
          hasMore={Boolean(state.nextCursor)}
          loading={state.loadingConversations}
          onFilterChange={handleFilterChange}
          onLoadMore={handleLoadMoreConversations}
          onSelectConversation={(id) => void handleSelectConversation(id)}
          selectedConversationId={state.selectedConversationId}
          totalActive={state.totalActive}
        />
      </div>

      <div className="inbox-column-chat">
        <InboxChatView
          conversation={state.selectedConversation}
          hasPrevMessages={Boolean(state.messagesPrevCursor)}
          loadingMessages={state.loadingMessages}
          messages={state.messages}
          onBackToList={() => setMobilePane("list")}
          onLoadPrevMessages={() => void handleLoadPrevMessages()}
          onSendMessage={hasReplyPermission ? handleSendMessage : async () => {}}
          onToggleContactPanel={() =>
            setMobilePane((prev) => (prev === "contact" ? "chat" : "contact"))
          }
          onUpdateStatus={hasAssignPermission ? handleUpdateStatus : async () => {}}
          sendingMessage={state.sendingMessage}
        />
      </div>

      <div className="inbox-column-contact">
        <InboxContactPanel
          conversation={state.selectedConversation}
          onAssign={hasAssignPermission ? handleAssignConversation : async () => {}}
          onClose={() => setMobilePane("chat")}
          organizationUnits={unitOptions}
          users={userOptions}
        />
      </div>
    </div>
  );
}
