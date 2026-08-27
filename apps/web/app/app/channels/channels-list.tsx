"use client";

import { useState } from "react";
import {
  type ChannelItem,
  formatChannelStatus,
  formatLatency,
  formatRelativeTime,
  formatSocketStatus,
} from "./channels-view-model";

type ChannelsListProps = Readonly<{
  canManage: boolean;
  channels: readonly ChannelItem[];
  loading: boolean;
  onDisconnectChannel: (channelId: string) => Promise<void>;
  onNewChannel: () => void;
  onOpenHealth: (channel: ChannelItem) => void;
  onOpenQr: (channel: ChannelItem) => void;
  onRefresh: () => void;
}>;

export function ChannelsList({
  canManage,
  channels,
  loading,
  onDisconnectChannel,
  onNewChannel,
  onOpenHealth,
  onOpenQr,
  onRefresh,
}: ChannelsListProps) {
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [confirmingChannel, setConfirmingChannel] = useState<ChannelItem | null>(null);

  const handleConfirmDisconnect = async () => {
    if (!confirmingChannel) return;
    setDisconnectingId(confirmingChannel.id);
    try {
      await onDisconnectChannel(confirmingChannel.id);
      setConfirmingChannel(null);
    } finally {
      setDisconnectingId(null);
    }
  };

  return (
    <div className="channels-container">
      <div className="channels-header">
        <div>
          <h1 className="channels-title">Canales de WhatsApp</h1>
          <p className="channels-subtitle">
            Cuentas WhatsApp conectadas vía Baileys. El estado depende de la sesión local del canal;
            la plataforma nunca almacena contraseñas ni compromete tus credenciales.
          </p>
        </div>
        <div className="channels-header-actions">
          <button
            className="channel-btn-secondary"
            disabled={loading}
            onClick={onRefresh}
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="14"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="14"
            >
              <path d="M20 4v6h-6M4 20v-6h6" />
              <path d="M20 10A9 9 0 0 0 7 4M4 14a9 9 0 0 0 13 6" />
            </svg>
            Actualizar
          </button>
          {canManage && (
            <button className="channel-btn-primary" onClick={onNewChannel} type="button">
              <svg
                aria-hidden="true"
                fill="none"
                height="14"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="14"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              + Conectar Canal
            </button>
          )}
        </div>
      </div>

      {loading && channels.length === 0 ? (
        <div className="channels-skeleton-list">
          <div className="channel-skel-card">
            <div className="channel-skel-block icon" />
            <div className="channel-skel-content">
              <div className="channel-skel-block line-title" />
              <div className="channel-skel-block line-sub" />
              <div className="channel-skel-block line-meta" />
            </div>
            <div className="channel-skel-block badge" />
          </div>
          <div className="channel-skel-card">
            <div className="channel-skel-block icon" />
            <div className="channel-skel-content">
              <div className="channel-skel-block line-title" />
              <div className="channel-skel-block line-sub" />
              <div className="channel-skel-block line-meta" />
            </div>
            <div className="channel-skel-block badge" />
          </div>
        </div>
      ) : channels.length === 0 ? (
        <div className="channels-empty-card">
          <div className="channels-empty-icon">
            <svg
              aria-hidden="true"
              fill="none"
              height="36"
              stroke="currentColor"
              strokeWidth="1.6"
              viewBox="0 0 24 24"
              width="36"
            >
              <path d="M5 7c5-3 9-3 14 0M5 11c5-2 9-2 14 0M5 15c5-1 9-1 14 0" />
            </svg>
          </div>
          <h3 className="channels-empty-title">Todavía no conectas una cuenta de WhatsApp</h3>
          <p className="channels-empty-text">
            Conecta tu primera línea de WhatsApp escaneando un código QR para empezar a recibir
            mensajes, activar reglas deterministas y automatizar la atención.
          </p>
          {canManage && (
            <button className="channel-btn-primary" onClick={onNewChannel} type="button">
              Conectar primera cuenta
            </button>
          )}
        </div>
      ) : (
        <div className="channels-list-grid">
          {channels.map((channel) => {
            const statusInfo = formatChannelStatus(channel.status);
            const isConnected = channel.status === "connected" || channel.status === "CONNECTED";
            const settings = channel.settings ?? {};
            const metadata = (settings.metadata as Record<string, unknown> | undefined) ?? {};
            const isDegraded = metadata.isDegraded === true || settings.isDegraded === true;
            const latencyMs =
              typeof metadata.lastLatencyMs === "number"
                ? metadata.lastLatencyMs
                : typeof settings.lastLatencyMs === "number"
                  ? settings.lastLatencyMs
                  : null;
            const socketStatus =
              (metadata.socketStatus as string | undefined) ??
              (settings.socketStatus as string | undefined);
            const lastHeartbeat =
              (metadata.lastHeartbeatAt as string | undefined) ??
              (settings.lastHeartbeatAt as string | undefined) ??
              channel.updatedAt;

            return (
              <div className={`channel-card ${isDegraded ? "is-degraded" : ""}`} key={channel.id}>
                <div className="channel-card-icon-wrap">
                  <svg
                    aria-hidden="true"
                    fill="none"
                    height="22"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    viewBox="0 0 24 24"
                    width="22"
                  >
                    <path d="M5 7c5-3 9-3 14 0M5 11c5-2 9-2 14 0M5 15c5-1 9-1 14 0" />
                  </svg>
                </div>

                <div className="channel-card-main-info">
                  <div className="channel-card-title-row">
                    <h2 className="channel-card-title">{channel.displayName || channel.name}</h2>
                    <span
                      className={`channel-badge channel-badge--${isDegraded ? "warn" : statusInfo.variant}`}
                    >
                      <span
                        className="channel-badge-dot"
                        style={{ backgroundColor: isDegraded ? "#f59f00" : statusInfo.dotColor }}
                      />
                      {isDegraded ? "Requiere reconexión" : statusInfo.label}
                    </span>
                  </div>

                  <p className="channel-card-phone">
                    {channel.phoneNumber ? (
                      <span className="channel-mono-phone">{channel.phoneNumber}</span>
                    ) : (
                      <span className="channel-muted-phone">(Sin número vinculado)</span>
                    )}
                    <span className="channel-bullet">·</span>
                    <span>
                      Proveedor: <strong>{channel.providerType.toUpperCase()}</strong>
                    </span>
                  </p>

                  <div className="channel-card-meta-row">
                    <span>
                      Socket: <strong>{formatSocketStatus(socketStatus)}</strong>
                    </span>
                    <span className="channel-bullet">·</span>
                    <span>
                      Latencia: <strong>{formatLatency(latencyMs)}</strong>
                    </span>
                    <span className="channel-bullet">·</span>
                    <span>
                      Última actividad: <strong>{formatRelativeTime(lastHeartbeat)}</strong>
                    </span>
                  </div>
                </div>

                <div className="channel-card-actions">
                  <button
                    className="channel-btn-secondary channel-btn-sm"
                    onClick={() => onOpenHealth(channel)}
                    type="button"
                  >
                    Diagnóstico de Salud
                  </button>

                  {canManage && !isConnected && (
                    <button
                      className="channel-btn-primary channel-btn-sm"
                      onClick={() => onOpenQr(channel)}
                      type="button"
                    >
                      <svg
                        aria-hidden="true"
                        fill="none"
                        height="13"
                        stroke="currentColor"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                        width="13"
                      >
                        <rect height="6" rx="1" width="6" x="3" y="3" />
                        <rect height="6" rx="1" width="6" x="15" y="3" />
                        <rect height="6" rx="1" width="6" x="3" y="15" />
                        <path d="M15 15h2v2h-2zM19 19h2v2h-2zM15 19h2v2h-2zM19 15h2v2h-2z" />
                      </svg>
                      Vincular / Escanear QR
                    </button>
                  )}

                  {canManage && isConnected && (
                    <button
                      className="channel-btn-ghost-danger channel-btn-sm"
                      disabled={disconnectingId === channel.id}
                      onClick={() => setConfirmingChannel(channel)}
                      type="button"
                    >
                      {disconnectingId === channel.id ? "Desconectando..." : "Desconectar"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation Dialog for Disconnect */}
      {confirmingChannel && (
        <div
          aria-labelledby="confirm-disconnect-title"
          aria-modal="true"
          className="channel-modal-overlay"
          role="dialog"
        >
          <button
            aria-label="Cerrar modal"
            className="channel-modal-backdrop"
            onClick={() => setConfirmingChannel(null)}
            type="button"
          />
          <div className="channel-modal-container channel-confirm-dialog">
            <div className="channel-modal-header">
              <h3 className="channel-modal-title" id="confirm-disconnect-title">
                ¿Desconectar {confirmingChannel.displayName}?
              </h3>
              <button
                aria-label="Cerrar ventana"
                className="channel-modal-close"
                onClick={() => setConfirmingChannel(null)}
                type="button"
              >
                ✕
              </button>
            </div>
            <div className="channel-modal-body-pad">
              <p className="channel-confirm-text">
                Al desconectar esta línea, se cerrará la sesión activa de WhatsApp en el servidor y
                se detendrán temporalmente los envíos y recepciones automáticas en este canal hasta
                que vuelvas a escanear el código QR.
              </p>
              <div className="channel-modal-footer">
                <button
                  className="channel-btn-secondary"
                  onClick={() => setConfirmingChannel(null)}
                  type="button"
                >
                  Cancelar
                </button>
                <button
                  className="channel-btn-danger"
                  disabled={disconnectingId !== null}
                  onClick={() => void handleConfirmDisconnect()}
                  type="button"
                >
                  {disconnectingId !== null ? "Desconectando..." : "Sí, Desconectar Canal"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
