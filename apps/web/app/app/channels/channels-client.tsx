"use client";

import { useCallback, useEffect, useState } from "react";
import { useTenantAppBootstrap } from "../tenant-app-shell";
import { ChannelCreateModal } from "./channel-create-modal";
import { ChannelHealthModal } from "./channel-health-modal";
import { ChannelQrModal } from "./channel-qr-modal";
import { ChannelsList } from "./channels-list";
import { type ChannelItem, disconnectChannel, fetchChannels } from "./channels-view-model";

type OrganizationUnitOption = Readonly<{
  id: string;
  name: string;
}>;

type ChannelsClientProps = Readonly<{
  apiBaseUrl?: string | undefined;
}>;

export function ChannelsClient({ apiBaseUrl }: ChannelsClientProps) {
  const bootstrap = useTenantAppBootstrap();
  const base = apiBaseUrl ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

  const [channels, setChannels] = useState<readonly ChannelItem[]>([]);
  const [units, setUnits] = useState<readonly OrganizationUnitOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [qrChannel, setQrChannel] = useState<ChannelItem | null>(null);
  const [healthChannel, setHealthChannel] = useState<ChannelItem | null>(null);

  const hasMessagingModule = bootstrap.effectiveModules.includes("module.messaging.basic");
  const hasReadPermission = bootstrap.effectivePermissions.includes("channels.read");
  const hasManagePermission = bootstrap.effectivePermissions.includes("channels.manage");

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const loadChannels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchChannels(base);
      setChannels(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar canales");
    } finally {
      setLoading(false);
    }
  }, [base]);

  // Load channels & units
  useEffect(() => {
    async function loadUnits() {
      try {
        const res = await fetch(`${base}/app/organization-units`, { credentials: "include" });
        if (res.ok) {
          const data = (await res.json()) as
            | { items?: OrganizationUnitOption[] }
            | OrganizationUnitOption[];
          setUnits(Array.isArray(data) ? data : (data.items ?? []));
        }
      } catch {
        // fail-soft
      }
    }

    if (hasMessagingModule && hasReadPermission) {
      void loadChannels();
      void loadUnits();
    }
  }, [base, hasMessagingModule, hasReadPermission, loadChannels]);

  const handleDisconnect = async (channelId: string) => {
    setError(null);
    try {
      await disconnectChannel(base, channelId, "Desconexión manual desde interfaz de usuario");
      await loadChannels();
      showToast("Canal desconectado exitosamente.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al desconectar canal");
    }
  };

  const handleChannelCreated = (newChannel: ChannelItem) => {
    setChannels((prev) => [newChannel, ...prev]);
    showToast(`Canal "${newChannel.displayName}" registrado.`);
    // Automatically open QR pairing modal for the newly registered channel
    setQrChannel(newChannel);
  };

  const handleConnected = async (_channelId: string) => {
    await loadChannels();
    showToast("¡Canal conectado exitosamente con WhatsApp!");
  };

  if (!hasMessagingModule) {
    return (
      <div className="channels-gate-error" role="alert">
        <h2>Módulo de Mensajería no habilitado</h2>
        <p>
          Este workspace no tiene contratado o activado el módulo{" "}
          <code>module.messaging.basic</code>. Contacta al administrador de la plataforma para
          habilitar canales de WhatsApp.
        </p>
      </div>
    );
  }

  if (!hasReadPermission) {
    return (
      <div className="channels-gate-error" role="alert">
        <h2>Permiso insuficiente</h2>
        <p>
          Tu usuario no tiene el permiso <code>channels.read</code> necesario para consultar la
          lista de canales de mensajería.
        </p>
      </div>
    );
  }

  return (
    <div className="channels-view-wrapper">
      {toastMessage && (
        <div className="channels-toast-banner" role="status">
          <svg
            aria-hidden="true"
            fill="none"
            height="16"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="16"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {error && (
        <div className="channels-error-banner" role="alert">
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
          <button
            aria-label="Cerrar alerta"
            className="channels-error-close"
            onClick={() => setError(null)}
            type="button"
          >
            ✕
          </button>
        </div>
      )}

      <ChannelsList
        canManage={hasManagePermission}
        channels={channels}
        loading={loading}
        onDisconnectChannel={handleDisconnect}
        onNewChannel={() => setIsCreateOpen(true)}
        onOpenHealth={(ch) => setHealthChannel(ch)}
        onOpenQr={(ch) => setQrChannel(ch)}
        onRefresh={() => void loadChannels()}
      />

      <ChannelQrModal
        apiBaseUrl={base}
        channel={qrChannel}
        isOpen={qrChannel !== null}
        onClose={() => setQrChannel(null)}
        onConnected={handleConnected}
      />

      <ChannelHealthModal
        apiBaseUrl={base}
        channel={healthChannel}
        isOpen={healthChannel !== null}
        onClose={() => setHealthChannel(null)}
      />

      <ChannelCreateModal
        apiBaseUrl={base}
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={handleChannelCreated}
        units={units}
      />
    </div>
  );
}
