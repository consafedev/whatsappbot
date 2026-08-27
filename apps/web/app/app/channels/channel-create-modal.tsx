"use client";

import { useEffect, useState } from "react";
import { type ChannelItem, createChannel } from "./channels-view-model";

type OrganizationUnitOption = Readonly<{
  id: string;
  name: string;
}>;

type ChannelCreateModalProps = Readonly<{
  apiBaseUrl?: string | undefined;
  isOpen: boolean;
  onClose: () => void;
  onCreated: (channel: ChannelItem) => void;
  units?: readonly OrganizationUnitOption[] | undefined;
}>;

export function ChannelCreateModal({
  apiBaseUrl,
  isOpen,
  onClose,
  onCreated,
  units = [],
}: ChannelCreateModalProps) {
  const base = apiBaseUrl ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

  const [displayName, setDisplayName] = useState("");
  const [organizationUnitId, setOrganizationUnitId] = useState<string>("");
  const [providerType, setProviderType] = useState<string>("baileys");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDisplayName("");
      setOrganizationUnitId("");
      setProviderType("baileys");
      setError(null);
    }
  }, [isOpen]);

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

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError("Por favor ingresa un nombre para el canal.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const channel = await createChannel(base, {
        displayName: displayName.trim(),
        organizationUnitId: organizationUnitId || null,
        providerType,
      });
      onCreated(channel);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrar canal");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      aria-labelledby="create-channel-title"
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

      <div className="channel-modal-container channel-create-dialog">
        <div className="channel-modal-header">
          <div>
            <span className="channel-modal-kicker">Nueva Línea WhatsApp</span>
            <h2 className="channel-modal-title" id="create-channel-title">
              Conectar Cuenta de WhatsApp
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

        <form className="channel-create-form" onSubmit={handleSubmit}>
          <div className="channel-field">
            <label className="channel-field-label" htmlFor="channel-name-input">
              Nombre Interno <span className="channel-req">*</span>
            </label>
            <input
              className="channel-input"
              id="channel-name-input"
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Ej. WhatsApp Ventas, WhatsApp Atención"
              required
              type="text"
              value={displayName}
            />
            <span className="channel-field-help">
              Etiqueta descriptiva para identificar la línea en tu workspace.
            </span>
          </div>

          {units.length > 0 && (
            <div className="channel-field">
              <label className="channel-field-label" htmlFor="channel-ou-select">
                Unidad Organizacional (Opcional)
              </label>
              <select
                className="channel-select"
                id="channel-ou-select"
                onChange={(e) => setOrganizationUnitId(e.target.value)}
                value={organizationUnitId}
              >
                <option value="">(Sin asignar a unidad específica)</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
              <span className="channel-field-help">
                Asocia la línea a una sucursal o departamento para filtrado de permisos y reglas.
              </span>
            </div>
          )}

          <div className="channel-field">
            <label className="channel-field-label" htmlFor="channel-provider-select">
              Proveedor de Conexión <span className="channel-req">*</span>
            </label>
            <select
              className="channel-select"
              id="channel-provider-select"
              onChange={(e) => setProviderType(e.target.value)}
              value={providerType}
            >
              <option value="baileys">Baileys (Dispositivo Vinculado QR)</option>
              <option disabled value="wppconnect">
                WPPConnect (Próximamente)
              </option>
              <option disabled value="meta">
                Meta Cloud API Oficial (Próximamente)
              </option>
            </select>
            <span className="channel-field-help">
              <strong>Baileys</strong> permite conectar tu línea física escaneando un código QR sin
              compartir credenciales.
            </span>
          </div>

          <div className="channel-notice-info">
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
              <path d="M12 8h.01M11 12h1v4h1" />
            </svg>
            <span>
              Al crear la cuenta, se abrirá inmediatamente el asistente de escaneo de código QR para
              vincular tu dispositivo.
            </span>
          </div>

          <div className="channel-modal-footer">
            <button className="channel-btn-secondary" onClick={onClose} type="button">
              Cancelar
            </button>
            <button className="channel-btn-primary" disabled={saving} type="submit">
              {saving ? "Registrando..." : "Crear y Vincular QR"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
