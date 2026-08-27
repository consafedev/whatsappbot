"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ChannelItem,
  type ChannelRealtimeEvent,
  calculateQrTtlRemaining,
  fetchChannelQr,
  initiateChannelPairing,
  type QrPairingState,
  type QrTtlRemaining,
  subscribeToChannelEvents,
} from "./channels-view-model";

type ChannelQrModalProps = Readonly<{
  apiBaseUrl?: string | undefined;
  channel: ChannelItem | null;
  isOpen: boolean;
  onClose: () => void;
  onConnected?: ((channelId: string) => void) | undefined;
}>;

// Simple deterministic hash for procedural QR module grid
function hashSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function renderProceduralQrModules(raw: string | null) {
  const seed = hashSeed(raw ?? "whatsapp-qr-pairing");
  const size = 15;
  const cells: boolean[] = [];

  for (let i = 0; i < size * size; i++) {
    const r = Math.floor(i / size);
    const c = i % size;
    // Keep 3 corner zones (finder patterns) clear for dedicated corner elements
    const isCornerZone = (r < 3 && c < 3) || (r < 3 && c > size - 4) || (r > size - 4 && c < 3);

    if (isCornerZone) {
      cells.push(false);
    } else {
      const bit = (seed * (i + 13) * 9301 + 49297) % 233280;
      cells.push(bit / 233280 > 0.45);
    }
  }

  return (
    <div className="channel-qr-grid" style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}>
      {cells.map((active, idx) => (
        <span
          className={active ? "channel-qr-cell is-on" : "channel-qr-cell is-off"}
          // biome-ignore lint/suspicious/noArrayIndexKey: static deterministic module array
          key={idx}
        />
      ))}
    </div>
  );
}

export function ChannelQrModal({
  apiBaseUrl,
  channel,
  isOpen,
  onClose,
  onConnected,
}: ChannelQrModalProps) {
  const base = apiBaseUrl ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

  const [qrState, setQrState] = useState<QrPairingState | null>(null);
  const [ttl, setTtl] = useState<QrTtlRemaining>({
    formattedCountdown: "00:30",
    isExpired: false,
    secondsRemaining: 30,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  const stopTimers = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const loadQr = useCallback(
    async (channelId: string) => {
      try {
        const state = await fetchChannelQr(base, channelId);
        if (!isMountedRef.current) return;

        setQrState(state);
        const currentTtl = calculateQrTtlRemaining(state.qrGeneratedAt);
        setTtl(currentTtl);

        const statusNorm = (state.status || "").toLowerCase();
        if (statusNorm === "connected") {
          setIsConnected(true);
          stopTimers();
          if (onConnected) {
            onConnected(channelId);
          }
        }
      } catch (err) {
        if (!isMountedRef.current) return;
        setError(err instanceof Error ? err.message : "Error al obtener código QR");
      }
    },
    [base, stopTimers, onConnected],
  );

  const startPairing = useCallback(
    async (channelId: string) => {
      setLoading(true);
      setError(null);
      setIsConnected(false);
      try {
        await initiateChannelPairing(base, channelId);
        await loadQr(channelId);

        // Start countdown timer every second
        stopTimers();
        countdownIntervalRef.current = setInterval(() => {
          setQrState((prev) => {
            if (!prev) return null;
            const updatedTtl = calculateQrTtlRemaining(prev.qrGeneratedAt);
            setTtl(updatedTtl);
            return prev;
          });
        }, 1000);

        // Start polling every 2 seconds
        pollingIntervalRef.current = setInterval(() => {
          void loadQr(channelId);
        }, 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al iniciar emparejamiento");
      } finally {
        setLoading(false);
      }
    },
    [base, loadQr, stopTimers],
  );

  useEffect(() => {
    isMountedRef.current = true;
    let unsubscribeSse: (() => void) | undefined;

    if (isOpen && channel) {
      void startPairing(channel.id);

      unsubscribeSse = subscribeToChannelEvents(base, (event: ChannelRealtimeEvent) => {
        if (!isMountedRef.current || event.channelAccountId !== channel.id) return;

        if (event.type === "channel.qr_generated" && event.qrRaw) {
          const generatedAt = event.qrGeneratedAt ?? new Date().toISOString();
          setQrState({
            isExpired: false,
            qrGeneratedAt: generatedAt,
            qrRaw: event.qrRaw,
            status: "QR_READY",
          });
          setTtl(calculateQrTtlRemaining(generatedAt));
        } else if (event.type === "channel.connected") {
          setIsConnected(true);
          stopTimers();
          if (onConnected) {
            onConnected(channel.id);
          }
        }
      });
    } else {
      stopTimers();
      setQrState(null);
      setIsConnected(false);
      setError(null);
    }

    return () => {
      isMountedRef.current = false;
      stopTimers();
      if (unsubscribeSse) {
        unsubscribeSse();
      }
    };
  }, [isOpen, channel, base, startPairing, stopTimers, onConnected]);

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

  const isExpired = ttl.isExpired;

  return (
    <div
      aria-labelledby="qr-modal-title"
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

      <div className="channel-modal-container channel-qr-dialog">
        <div className="channel-modal-header">
          <div>
            <span className="channel-modal-kicker">Vincular Dispositivo</span>
            <h2 className="channel-modal-title" id="qr-modal-title">
              {channel.displayName}
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

        <div className="channel-qr-body">
          {isConnected ? (
            <div className="channel-qr-success-card" data-testid="qr-success-card">
              <div className="channel-qr-success-icon">
                <svg
                  aria-hidden="true"
                  fill="none"
                  height="44"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                  viewBox="0 0 24 24"
                  width="44"
                >
                  <circle cx="12" cy="12" fill="#2b8a3e" r="10" stroke="#2b8a3e" />
                  <path d="M8 12l3 3 5-6" stroke="#ffffff" strokeWidth="2.5" />
                </svg>
              </div>
              <h3 className="channel-qr-success-title">¡WhatsApp Conectado con éxito!</h3>
              <p className="channel-qr-success-desc">
                La línea <strong>{channel.displayName}</strong> está vinculada activamente y lista
                para procesar mensajes entrantes y automatizaciones.
              </p>
              <div className="channel-qr-success-actions">
                <button className="channel-btn-primary" onClick={onClose} type="button">
                  Entendido / Finalizar
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="channel-qr-instructions">
                <h4 className="channel-qr-instructions-title">Instrucciones para escanear:</h4>
                <ol className="channel-qr-steps">
                  <li>
                    Abre <strong>WhatsApp</strong> en tu teléfono.
                  </li>
                  <li>
                    Toca <strong>Menú (⋮)</strong> o <strong>Configuración</strong> y selecciona{" "}
                    <strong>Dispositivos vinculados</strong>.
                  </li>
                  <li>
                    Toca <strong>Vincular un dispositivo</strong> y apunta tu cámara a este código
                    QR.
                  </li>
                </ol>
              </div>

              <div className="channel-qr-display-box">
                <div className="channel-qr-visual-card">
                  {loading && !qrState?.qrRaw ? (
                    <div className="channel-qr-loading-placeholder">
                      <div className="channel-spinner" />
                      <span>Generando código QR seguro...</span>
                    </div>
                  ) : isExpired ? (
                    <div className="channel-qr-expired-overlay" data-testid="qr-expired-state">
                      <svg
                        aria-hidden="true"
                        fill="none"
                        height="32"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        viewBox="0 0 24 24"
                        width="32"
                      >
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 8v4l3 2" />
                      </svg>
                      <strong>Código QR expirado</strong>
                      <p>El código QR expira cada 30 segundos por seguridad.</p>
                      <button
                        className="channel-btn-primary channel-btn-sm"
                        onClick={() => void startPairing(channel.id)}
                        type="button"
                      >
                        Generar nuevo código
                      </button>
                    </div>
                  ) : qrState?.qrRaw?.startsWith("data:image/") ? (
                    // biome-ignore lint/performance/noImgElement: Data URI QR Code generated locally
                    <img alt="WhatsApp QR Code" className="channel-qr-image" src={qrState.qrRaw} />
                  ) : (
                    <div className="channel-qr-visual-wrapper">
                      {renderProceduralQrModules(qrState?.qrRaw ?? null)}
                      <div className="channel-qr-corner tl" />
                      <div className="channel-qr-corner tr" />
                      <div className="channel-qr-corner bl" />
                      <div className="channel-qr-corner-inner tl" />
                      <div className="channel-qr-corner-inner tr" />
                      <div className="channel-qr-corner-inner bl" />
                    </div>
                  )}
                </div>

                {!isExpired && (
                  <div className="channel-qr-status-indicator">
                    <span className="channel-qr-pulse-dot" />
                    <span className="channel-qr-status-text">
                      {qrState?.status === "CONNECTING" || qrState?.status === "connecting"
                        ? "Conectando con WhatsApp..."
                        : "Esperando escaneo..."}
                    </span>
                  </div>
                )}

                {!isExpired && (
                  <div className="channel-qr-timer-bar-wrap">
                    <div className="channel-qr-timer-text">
                      El código caduca en <strong>{ttl.formattedCountdown}</strong>
                    </div>
                    <div className="channel-qr-progress-track">
                      <div
                        className="channel-qr-progress-fill"
                        style={{
                          width: `${Math.min(100, Math.max(0, (ttl.secondsRemaining / 30) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="channel-qr-actions-row">
                  <button
                    className="channel-btn-secondary channel-btn-sm"
                    disabled={loading}
                    onClick={() => void startPairing(channel.id)}
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
                      <path d="M20 4v6h-6M4 20v-6h6" />
                      <path d="M20 10A9 9 0 0 0 7 4M4 14a9 9 0 0 0 13 6" />
                    </svg>
                    Regenerar QR
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
