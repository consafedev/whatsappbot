"use client";

import { useState } from "react";

type TenantStatusControlProps = Readonly<{
  apiBaseUrl: string;
  onRefresh(): Promise<void>;
  status: string;
  tenantId: string;
}>;

function messageForStatus(status: number): string {
  if (status === 401) return "Tu sesión de Platform Admin no es válida.";
  if (status === 404) return "El tenant ya no existe.";
  if (status === 409) return "El tenant cambió de estado; se recargó el detalle.";
  return "No fue posible actualizar el estado del tenant.";
}

export function TenantStatusControls({
  apiBaseUrl,
  onRefresh,
  status,
  tenantId,
}: TenantStatusControlProps) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  if (status !== "active" && status !== "suspended") return null;

  const nextAction = status === "active" ? "suspend" : "reactivate";
  const label = status === "active" ? "Suspender tenant" : "Reactivar tenant";
  const confirmMessage =
    status === "active"
      ? "Los usuarios dejarán de poder operar y nuevas operaciones Tenant quedarán bloqueadas. Los datos y la configuración no se eliminarán, y Platform Admin conservará acceso administrativo. ¿Suspender tenant?"
      : "El tenant volverá a aceptar actividad normal. Esta acción no reprovisiona datos ni restaura backups. ¿Reactivar tenant?";

  async function submit(): Promise<void> {
    if (!window.confirm(confirmMessage)) return;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(
        `${apiBaseUrl}/platform/tenants/${encodeURIComponent(tenantId)}/${nextAction}`,
        { credentials: "include", headers: { accept: "application/json" }, method: "POST" },
      );
      if (!response.ok) {
        setFeedback(messageForStatus(response.status));
        if (response.status === 409) await onRefresh();
        return;
      }
      await onRefresh();
      setFeedback(nextAction === "suspend" ? "Tenant suspendido." : "Tenant reactivado.");
    } catch {
      setFeedback("No fue posible actualizar el estado del tenant.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tenant-status-controls">
      <div>
        <h2>{status === "active" ? "Operación del tenant" : "Tenant suspendido"}</h2>
        <p>
          {status === "active"
            ? "Puedes suspender temporalmente el acceso Tenant sin eliminar datos ni configuración."
            : "El acceso Tenant está bloqueado; Platform Admin conserva las operaciones administrativas."}
        </p>
      </div>
      <div>
        <button
          className={status === "active" ? "button-danger" : "button-secondary"}
          disabled={busy}
          onClick={() => void submit()}
          type="button"
        >
          {busy ? "Actualizando…" : label}
        </button>
        {feedback === null ? null : <p className="tenant-status-feedback">{feedback}</p>}
      </div>
    </div>
  );
}
