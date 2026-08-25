"use client";

import { useEffect, useRef, useState } from "react";
import {
  deliveryStatusDetails,
  formatE164Phone,
  formatMessageTime,
  type InboxConversation,
  type InboxMessage,
  initialsFromName,
  originLabel,
} from "./inbox-view-model";

type InboxChatViewProps = Readonly<{
  conversation: InboxConversation | null;
  hasPrevMessages: boolean;
  loadingMessages: boolean;
  messages: readonly InboxMessage[];
  onBackToList?: (() => void) | undefined;
  onLoadPrevMessages: () => void;
  onSendMessage: (payload: {
    caption?: string | undefined;
    mediaUrl?: string | undefined;
    textBody?: string | undefined;
  }) => Promise<void>;
  onToggleContactPanel?: (() => void) | undefined;
  onUpdateStatus: (
    status: "open" | "pending" | "closed",
    reason?: string | undefined,
  ) => Promise<void>;
  sendingMessage: boolean;
}>;

function isImageUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/i.test(url);
}

export function InboxChatView({
  conversation,
  hasPrevMessages,
  loadingMessages,
  messages,
  onBackToList,
  onLoadPrevMessages,
  onSendMessage,
  onToggleContactPanel,
  onUpdateStatus,
  sendingMessage,
}: InboxChatViewProps) {
  const [inputText, setInputText] = useState("");
  const [showMediaModal, setShowMediaModal] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaCaption, setMediaCaption] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [targetStatus, setTargetStatus] = useState<"open" | "pending" | "closed">("closed");
  const [sendError, setSendError] = useState<string | null>(null);

  const threadEndRef = useRef<HTMLDivElement>(null);
  const threadContainerRef = useRef<HTMLDivElement>(null);
  const messageCount = messages.length;

  useEffect(() => {
    if (threadEndRef.current && messageCount >= 0) {
      threadEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messageCount]);

  if (!conversation) {
    return (
      <section aria-label="Vista de conversación" className="inbox-chat-empty">
        <div className="inbox-chat-empty-content">
          <span aria-hidden="true" className="inbox-chat-empty-icon">
            💬
          </span>
          <h3>Selecciona una conversación</h3>
          <p>
            Elige un hilo del panel lateral para ver el historial de mensajes, responder en tiempo
            real y gestionar la asignación.
          </p>
        </div>
      </section>
    );
  }

  const contactName =
    conversation.contact.name || formatE164Phone(conversation.contact.phoneNumber);
  const initials = initialsFromName(conversation.contact.name, conversation.contact.phoneNumber);

  const handleSendText = async () => {
    const text = inputText.trim();
    if (!text || sendingMessage) return;
    setSendError(null);
    try {
      await onSendMessage({ textBody: text });
      setInputText("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Error al enviar mensaje");
    }
  };

  const handleSendMedia = async () => {
    const url = mediaUrl.trim();
    if (!url || sendingMessage) return;
    setSendError(null);
    try {
      await onSendMessage({
        caption: mediaCaption.trim() || undefined,
        mediaUrl: url,
      });
      setMediaUrl("");
      setMediaCaption("");
      setShowMediaModal(false);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Error al adjuntar archivo");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendText();
    }
  };

  const handleStatusChange = (newStatus: "open" | "pending" | "closed") => {
    if (newStatus === "closed") {
      setTargetStatus("closed");
      setShowStatusModal(true);
    } else {
      void onUpdateStatus(newStatus);
    }
  };

  const handleConfirmStatus = async () => {
    setShowStatusModal(false);
    await onUpdateStatus(targetStatus, statusReason.trim() || undefined);
    setStatusReason("");
  };

  return (
    <section aria-label="Conversación activa" className="inbox-chat-view">
      {/* Header */}
      <header className="inbox-chat-header">
        {onBackToList ? (
          <button
            aria-label="Volver a la lista"
            className="inbox-back-btn"
            onClick={onBackToList}
            type="button"
          >
            ←
          </button>
        ) : null}

        <div className="inbox-header-avatar" aria-hidden="true">
          {initials}
        </div>

        <div className="inbox-header-info">
          <div className="inbox-header-name-row">
            <strong className="inbox-header-name">{contactName}</strong>
            <span className="inbox-header-phone">
              {formatE164Phone(conversation.contact.phoneNumber)}
            </span>
          </div>
          <div className="inbox-header-meta">
            <span>
              Canal: <b>{conversation.channelAccount.name}</b>
            </span>
            <span>·</span>
            <span className={`inbox-mode-tag mode-${conversation.automationMode.toLowerCase()}`}>
              {conversation.automationMode}
            </span>
          </div>
        </div>

        <div className="inbox-header-actions">
          <label className="inbox-status-selector-label" htmlFor="conversation-status-select">
            Estado:
          </label>
          <select
            className="inbox-status-select"
            id="conversation-status-select"
            onChange={(e) => handleStatusChange(e.target.value as "open" | "pending" | "closed")}
            value={conversation.status}
          >
            <option value="open">Abierta</option>
            <option value="pending">Pendiente</option>
            <option value="closed">Cerrada</option>
          </select>

          {onToggleContactPanel ? (
            <button
              aria-label="Ver detalles de contacto"
              className="inbox-info-toggle-btn"
              onClick={onToggleContactPanel}
              title="Detalles de contacto"
              type="button"
            >
              ℹ️
            </button>
          ) : null}
        </div>
      </header>

      {/* Message Timeline */}
      <div className="inbox-timeline-wrap" ref={threadContainerRef}>
        <div className="inbox-timeline-intro">
          <span>
            Conversación iniciada con {contactName} en canal {conversation.channelAccount.name}
          </span>
        </div>

        {hasPrevMessages ? (
          <div className="inbox-load-prev-wrap">
            <button
              className="inbox-load-prev-btn"
              disabled={loadingMessages}
              onClick={onLoadPrevMessages}
              type="button"
            >
              {loadingMessages ? "Cargando mensajes anteriores…" : "↑ Cargar mensajes anteriores"}
            </button>
          </div>
        ) : null}

        {messages.length === 0 && !loadingMessages ? (
          <div className="inbox-timeline-empty">
            <p>No hay mensajes en este hilo aún.</p>
          </div>
        ) : (
          <div className="inbox-messages-list" role="log">
            {messages.map((msg) => {
              const isOutbound = msg.direction === "outbound";
              const label = originLabel(
                msg.origin,
                isOutbound
                  ? msg.actorType === "tenant_user"
                    ? conversation.assignedUser?.displayName || "Operador"
                    : null
                  : conversation.contact.name,
              );
              const delivery = deliveryStatusDetails(msg.deliveryStatus);

              return (
                <article
                  className={`inbox-bubble-wrap ${isOutbound ? "is-outbound" : "is-inbound"}`}
                  key={msg.id}
                >
                  <div className={`inbox-bubble ${isOutbound ? "bubble-out" : "bubble-in"}`}>
                    <header className="inbox-bubble-header">
                      <span className="inbox-bubble-author">{label}</span>
                    </header>

                    {msg.structuredPayload?.mediaUrl ? (
                      <div className="inbox-bubble-media">
                        {isImageUrl(msg.structuredPayload.mediaUrl) ? (
                          // biome-ignore lint/performance/noImgElement: media from verified HTTPS URL
                          <img
                            alt={msg.structuredPayload.caption || "Imagen adjunta"}
                            className="inbox-media-image"
                            referrerPolicy="no-referrer"
                            src={msg.structuredPayload.mediaUrl}
                          />
                        ) : (
                          <a
                            className="inbox-media-link"
                            href={msg.structuredPayload.mediaUrl}
                            referrerPolicy="no-referrer"
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            📎 {msg.structuredPayload.fileName || "Archivo adjunto"}
                          </a>
                        )}
                        {msg.structuredPayload.caption ? (
                          <p className="inbox-media-caption">{msg.structuredPayload.caption}</p>
                        ) : null}
                      </div>
                    ) : null}

                    {msg.textBody ? <p className="inbox-bubble-text">{msg.textBody}</p> : null}

                    <footer className="inbox-bubble-footer">
                      <time className="inbox-bubble-time" dateTime={msg.createdAt}>
                        {formatMessageTime(msg.createdAt)}
                      </time>
                      {isOutbound ? (
                        <span
                          aria-label={delivery.label}
                          className={`inbox-delivery-tick ${delivery.className}`}
                          role="img"
                          title={delivery.label}
                        >
                          {delivery.icon}
                        </span>
                      ) : null}
                    </footer>
                  </div>
                </article>
              );
            })}
            <div ref={threadEndRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <footer className="inbox-composer">
        {sendError ? (
          <div className="inbox-composer-error" role="alert">
            <span>{sendError}</span>
            <button onClick={() => setSendError(null)} type="button">
              ✕
            </button>
          </div>
        ) : null}

        <div className="inbox-composer-row">
          <button
            aria-label="Adjuntar archivo o imagen"
            className="inbox-attach-btn"
            onClick={() => setShowMediaModal(true)}
            title="Adjuntar multimedia"
            type="button"
          >
            📎
          </button>

          <textarea
            aria-label="Escribe tu mensaje"
            className="inbox-composer-textarea"
            disabled={sendingMessage}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe un mensaje… (Enter para enviar, Shift+Enter para nueva línea)"
            rows={1}
            value={inputText}
          />

          <button
            aria-label="Enviar mensaje"
            className="inbox-send-btn"
            disabled={!inputText.trim() || sendingMessage}
            onClick={() => void handleSendText()}
            type="button"
          >
            {sendingMessage ? "…" : "➤"}
          </button>
        </div>
      </footer>

      {/* Modal Adjuntar Media */}
      {showMediaModal ? (
        <div className="inbox-modal-backdrop" role="dialog">
          <div className="inbox-modal-content">
            <h3>Adjuntar enlace multimedia (HTTPS)</h3>
            <p className="inbox-modal-help">
              Ingresa la URL pública HTTPS de la imagen o archivo que deseas enviar.
            </p>
            <div className="inbox-modal-field">
              <label htmlFor="inbox-media-url">URL del archivo:</label>
              <input
                id="inbox-media-url"
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder="https://..."
                type="url"
                value={mediaUrl}
              />
            </div>
            <div className="inbox-modal-field">
              <label htmlFor="inbox-media-caption">Descripción / Caption (opcional):</label>
              <input
                id="inbox-media-caption"
                onChange={(e) => setMediaCaption(e.target.value)}
                placeholder="Comentario sobre el archivo…"
                type="text"
                value={mediaCaption}
              />
            </div>
            <div className="inbox-modal-actions">
              <button className="btn-cancel" onClick={() => setShowMediaModal(false)} type="button">
                Cancelar
              </button>
              <button
                className="btn-confirm"
                disabled={!mediaUrl.trim() || sendingMessage}
                onClick={() => void handleSendMedia()}
                type="button"
              >
                Enviar multimedia
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal Cerrar Conversación */}
      {showStatusModal ? (
        <div className="inbox-modal-backdrop" role="dialog">
          <div className="inbox-modal-content">
            <h3>Cerrar conversación</h3>
            <p className="inbox-modal-help">
              Ingresa un motivo o resumen opcional para registrar en la auditoría del cierre.
            </p>
            <div className="inbox-modal-field">
              <label htmlFor="inbox-close-reason">Motivo de cierre:</label>
              <input
                id="inbox-close-reason"
                onChange={(e) => setStatusReason(e.target.value)}
                placeholder="Ej. Solicitud atendida satisfactoriamente"
                type="text"
                value={statusReason}
              />
            </div>
            <div className="inbox-modal-actions">
              <button
                className="btn-cancel"
                onClick={() => setShowStatusModal(false)}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="btn-confirm"
                onClick={() => void handleConfirmStatus()}
                type="button"
              >
                Confirmar cierre
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
