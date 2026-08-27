"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type ChannelHealthDiagnostic,
  type ChannelItem,
  fetchChannelHealth,
  formatLatency,
  formatRelativeTime,
  formatSocketStatus,
} from "./channels-view-model";

type ChannelHealthModalProps = Readonly<{
  apiBaseUrl?: string | undefined;
  channel: ChannelItem | null;
  isOpen: boolean;
  onClose: () => void;
}>;

export function ChannelHealthModal({
  apiBaseUrl,
  channel,
  isOpen,
  onClose,
}: ChannelHealthModalProps) {
  const base = apiBaseUrl ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

  const [diagnostic, setDiagnostic] = useState<ChannelHealthDiagnostic | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHealth = useCallback(
    async (channelId: string) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchChannelHealth(base, channelId);
        setDiagnostic(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al obtener diagnóstico de salud");
      } finally {
        setLoading(false);
      }
    },
    [base],
  );

  useEffect(() => {
    if (isOpen && channel) {
      void loadHealth(channel.id);
    } else {
      setDiagnostic(null);
      setError(null);
    }
  }, [isOpen, channel, loadHealth]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !channel) {
    return null;
  }

  return (
    <div
      aria-labelledby="health-modal-title"
      aria-modal="true"
      className="channel-modal-overlay"
      role="dialog"
    >
      <button
        aria-label="Cerrar modal"
        className="channel-modal-backdrop"
        onClick={onClose}
        type="button"
      />

      <div className="channel-modal-container channel-health-dialog">
        <div className="channel-modal-header">
          <div>
            <span className="channel-modal-kicker">Diagnóstico en Tiempo Real</span>
            <h2 className="channel-modal-title" id="health-modal-title">
              Salud de Canal: {channel.displayName}
            </h2>
          </div>
          <button
            aria-label="Cerrar ventana"
            className="channel-modal-close"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="channel-error-banner" role="alert">
            <svg
              aria-hidden="true"
              fill="none"
              height="16"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="16"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <div className="channel-health-body">
          {loading && !diagnostic ? (
            <div className="channel-health-loading">
              <div className="channel-spinner" />
              <span>Consultando telemetría del canal...</span>
            </div>
          ) : (
            <>
              <div className="channel-health-summary-banner">
                <div className="channel-health-status-badge">
                  {diagnostic?.isHealthy ? (
                    <span className="badge badge--success">
                      <span className="badge__dot" />
                      Saludable · Sesión Operativa
                    </span>
                  ) : diagnostic?.isDegraded ? (
                    <span className="badge badge--warn">
                      <span className="badge__dot" />
                      Degradado · Requiere Atención
                    </span>
                  ) : (
                    <span className="badge badge--danger">
                      <span className="badge__dot" />
                      Desconectado / Inactivo
                    </span>
                  )}
                </div>
                <p className="channel-health-summary-text">
                  {diagnostic?.isHealthy
                    ? "El socket con WhatsApp está activo y transmitiendo latidos normales. Los mensajes se envían y reciben de forma determinista."
                    : diagnostic?.isDegraded
                      ? "La sesión presenta latencia elevada o interrupciones temporales de red. El sistema intentará reconectar automáticamente con backoff."
                      : "La sesión local de WhatsApp no está conectada. Escanea el código QR para restablecer la sincronización de mensajes."}
                </p>
              </div>

              <div className="channel-health-grid">
                <div className="channel-health-stat-card">
                  <span className="channel-health-stat-label">Latencia de Red</span>
                  <strong className="channel-health-stat-value">
                    {formatLatency(diagnostic?.lastLatencyMs)}
                  </strong>
                  <span className="channel-health-stat-hint">Tiempo de respuesta del socket</span>
                </div>

                <div className="channel-health-stat-card">
                  <span className="channel-health-stat-label">Estado del Socket</span>
                  <strong className="channel-health-stat-value">
                    {formatSocketStatus(diagnostic?.socketStatus)}
                  </strong>
                  <span className="channel-health-stat-hint">Conexión WebSocket de Baileys</span>
                </div>

                <div className="channel-health-stat-card">
                  <span className="channel-health-stat-label">Reintentos de Conexión</span>
                  <strong className="channel-health-stat-value">
                    {diagnostic?.reconnectAttempts ?? 0}
                  </strong>
                  <span className="channel-health-stat-hint">Intentos acumulados tras fallo</span>
                </div>

                <div className="channel-health-stat-card">
                  <span className="channel-health-stat-label">Último Latido (Heartbeat)</span>
                  <strong className="channel-health-stat-value">
                    {formatRelativeTime(diagnostic?.lastHeartbeatAt)}
                  </strong>
                  <span className="channel-health-stat-hint">
                    {diagnostic?.lastHeartbeatAt
                      ? new Date(diagnostic.lastHeartbeatAt).toLocaleTimeString()
                      : "Sin latidos registrados"}
                  </span>
                </div>
              </div>

              <div className="channel-health-meta-details">
                <div className="channel-health-meta-row">
                  <span>Número Vinculado:</span>
                  <strong>{channel.phoneNumber || "No vinculado"}</strong>
                </div>
                <div className="channel-health-meta-row">
                  <span>Proveedor de Mensajería:</span>
                  <strong>{channel.providerType.toUpperCase()}</strong>
                </div>
                <div className="channel-health-meta-row">
                  <span>ID de Canal:</span>
                  <code className="channel-code-id">{channel.id}</code>
                </div>
              </div>

              <div className="channel-health-actions-footer">
                <button
                  className="channel-btn-secondary channel-btn-sm"
                  disabled={loading}
                  onClick={() => void loadHealth(channel.id)}
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
                  {loading ? "Comprobando..." : "Actualizar Diagnóstico"}
                </button>
                <button
                  className="channel-btn-primary channel-btn-sm"
                  onClick={onClose}
                  type="button"
                >
                  Cerrar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
