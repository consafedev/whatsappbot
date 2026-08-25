"use client";

import {
  formatE164Phone,
  formatRelativeTime,
  type InboxConversation,
  type InboxListFilter,
  initialsFromName,
} from "./inbox-view-model";

type InboxThreadListProps = Readonly<{
  conversations: readonly InboxConversation[];
  filter: InboxListFilter;
  hasMore: boolean;
  loading: boolean;
  onFilterChange: (filter: Partial<InboxListFilter>) => void;
  onLoadMore: () => void;
  onSelectConversation: (id: string) => void;
  selectedConversationId: string | null;
  totalActive: number;
}>;

export function InboxThreadList({
  conversations,
  filter,
  hasMore,
  loading,
  onFilterChange,
  onLoadMore,
  onSelectConversation,
  selectedConversationId,
  totalActive,
}: InboxThreadListProps) {
  const currentStatus = filter.status ?? "all";

  return (
    <aside aria-label="Lista de conversaciones" className="inbox-thread-list">
      <div className="inbox-thread-list-head">
        <div className="inbox-thread-list-title-row">
          <h2 className="inbox-thread-list-title">
            Conversaciones
            {totalActive > 0 ? (
              <span className="inbox-count-badge" title="Total activas">
                {totalActive}
              </span>
            ) : null}
          </h2>
        </div>

        <div className="inbox-search-wrap">
          <span aria-hidden="true" className="inbox-search-icon">
            🔍
          </span>
          <input
            aria-label="Buscar por nombre o teléfono"
            className="inbox-search-input"
            onChange={(e) => onFilterChange({ cursor: undefined, search: e.target.value || undefined })}
            placeholder="Buscar nombre o teléfono…"
            type="search"
            value={filter.search ?? ""}
          />
        </div>

        <div className="inbox-status-filters" role="tablist">
          <button
            aria-selected={currentStatus === "active"}
            className={`inbox-filter-chip${currentStatus === "active" ? " is-active" : ""}`}
            onClick={() => onFilterChange({ cursor: undefined, status: "active" })}
            role="tab"
            type="button"
          >
            Activas
          </button>
          <button
            aria-selected={currentStatus === "open"}
            className={`inbox-filter-chip${currentStatus === "open" ? " is-active" : ""}`}
            onClick={() => onFilterChange({ cursor: undefined, status: "open" })}
            role="tab"
            type="button"
          >
            Abiertas
          </button>
          <button
            aria-selected={currentStatus === "pending"}
            className={`inbox-filter-chip${currentStatus === "pending" ? " is-active" : ""}`}
            onClick={() => onFilterChange({ cursor: undefined, status: "pending" })}
            role="tab"
            type="button"
          >
            Pendientes
          </button>
          <button
            aria-selected={currentStatus === "closed"}
            className={`inbox-filter-chip${currentStatus === "closed" ? " is-active" : ""}`}
            onClick={() => onFilterChange({ cursor: undefined, status: "closed" })}
            role="tab"
            type="button"
          >
            Cerradas
          </button>
          <button
            aria-selected={currentStatus === "all"}
            className={`inbox-filter-chip${currentStatus === "all" ? " is-active" : ""}`}
            onClick={() => onFilterChange({ cursor: undefined, status: undefined })}
            role="tab"
            type="button"
          >
            Todas
          </button>
        </div>
      </div>

      <div className="inbox-thread-scroll">
        {loading && conversations.length === 0 ? (
          <div className="inbox-loading-skeleton">
            <div className="inbox-skeleton-item" />
            <div className="inbox-skeleton-item" />
            <div className="inbox-skeleton-item" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="inbox-empty-threads">
            <span aria-hidden="true" className="inbox-empty-icon">
              💬
            </span>
            <p>No hay conversaciones con este filtro.</p>
          </div>
        ) : (
          <ul className="inbox-thread-items">
            {conversations.map((conv) => {
              const isSelected = conv.id === selectedConversationId;
              const contactName =
                conv.contact.name || formatE164Phone(conv.contact.phoneNumber);
              const initials = initialsFromName(
                conv.contact.name,
                conv.contact.phoneNumber,
              );

              return (
                <li key={conv.id}>
                  <button
                    aria-current={isSelected ? "true" : undefined}
                    className={`inbox-thread-item${isSelected ? " is-active" : ""}${conv.unread ? " is-unread" : ""}`}
                    onClick={() => onSelectConversation(conv.id)}
                    type="button"
                  >
                    <div className="inbox-thread-avatar" aria-hidden="true">
                      {initials}
                    </div>
                    <div className="inbox-thread-content">
                      <div className="inbox-thread-header">
                        <span className="inbox-thread-name">{contactName}</span>
                        <time
                          className="inbox-thread-time"
                          dateTime={conv.lastMessageAt ?? conv.createdAt}
                        >
                          {formatRelativeTime(conv.lastMessageAt ?? conv.createdAt)}
                        </time>
                      </div>
                      <div className="inbox-thread-body">
                        <span className="inbox-thread-preview">
                          {conv.subject || conv.channelAccount.name}
                        </span>
                        {conv.unread ? (
                          <span className="inbox-unread-badge" title="Mensaje no leído" />
                        ) : null}
                      </div>
                      <div className="inbox-thread-tags">
                        <span className={`inbox-mode-tag mode-${conv.automationMode.toLowerCase()}`}>
                          {conv.automationMode}
                        </span>
                        <span className="inbox-status-tag">{conv.status}</span>
                        {conv.assignedUser ? (
                          <span className="inbox-assignee-tag">
                            👤 {conv.assignedUser.displayName}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {hasMore ? (
          <div className="inbox-load-more-wrap">
            <button
              className="inbox-load-more-btn"
              disabled={loading}
              onClick={onLoadMore}
              type="button"
            >
              {loading ? "Cargando…" : "Cargar más conversaciones"}
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
