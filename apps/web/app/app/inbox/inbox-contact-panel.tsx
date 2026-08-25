"use client";

import { useState } from "react";
import {
  formatE164Phone,
  formatRelativeTime,
  type InboxConversation,
  initialsFromName,
} from "./inbox-view-model";

type InboxContactPanelProps = Readonly<{
  conversation: InboxConversation | null;
  onAssign: (assignment: {
    assignedUnitId?: string | null | undefined;
    assignedUserId?: string | null | undefined;
  }) => Promise<void>;
  onClose?: (() => void) | undefined;
  organizationUnits?: readonly { id: string; name: string }[] | undefined;
  users?: readonly { displayName: string; id: string }[] | undefined;
}>;

export function InboxContactPanel({
  conversation,
  onAssign,
  onClose,
  organizationUnits = [],
  users = [],
}: InboxContactPanelProps) {
  const [selectedUser, setSelectedUser] = useState<string>(conversation?.assignedUserId ?? "");
  const [selectedUnit, setSelectedUnit] = useState<string>(conversation?.assignedUnitId ?? "");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!conversation) return null;

  const contactName =
    conversation.contact.name || formatE164Phone(conversation.contact.phoneNumber);
  const initials = initialsFromName(conversation.contact.name, conversation.contact.phoneNumber);

  const handleApplyAssignment = async () => {
    setSaving(true);
    setSaveSuccess(false);
    setSaveError(null);
    try {
      await onAssign({
        assignedUnitId: selectedUnit || null,
        assignedUserId: selectedUser || null,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Error al actualizar asignación");
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside aria-label="Detalles del contacto" className="inbox-contact-panel">
      <header className="inbox-contact-head">
        <h3>Detalles de contacto</h3>
        {onClose ? (
          <button
            aria-label="Cerrar panel de detalles"
            className="inbox-contact-close-btn"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        ) : null}
      </header>

      <div className="inbox-contact-body">
        {/* Contact info card */}
        <section className="inbox-panel-card">
          <div className="inbox-contact-profile">
            <div className="inbox-contact-avatar" aria-hidden="true">
              {initials}
            </div>
            <strong className="inbox-contact-name">{contactName}</strong>
            <span className="inbox-contact-phone">
              {formatE164Phone(conversation.contact.phoneNumber)}
            </span>
          </div>
        </section>

        {/* Assignment card */}
        <section className="inbox-panel-card">
          <h4>Asignación</h4>

          <div className="inbox-form-field">
            <label htmlFor="inbox-assign-user">Operador asignado:</label>
            <select
              id="inbox-assign-user"
              onChange={(e) => setSelectedUser(e.target.value)}
              value={selectedUser}
            >
              <option value="">(Sin asignar)</option>
              {conversation.assignedUser &&
              !users.some((u) => u.id === conversation.assignedUser?.id) ? (
                <option value={conversation.assignedUser.id}>
                  {conversation.assignedUser.displayName}
                </option>
              ) : null}
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </div>

          <div className="inbox-form-field">
            <label htmlFor="inbox-assign-unit">Unidad organizacional:</label>
            <select
              id="inbox-assign-unit"
              onChange={(e) => setSelectedUnit(e.target.value)}
              value={selectedUnit}
            >
              <option value="">(Sin unidad)</option>
              {conversation.assignedUnit &&
              !organizationUnits.some((u) => u.id === conversation.assignedUnit?.id) ? (
                <option value={conversation.assignedUnit.id}>
                  {conversation.assignedUnit.name}
                </option>
              ) : null}
              {organizationUnits.map((ou) => (
                <option key={ou.id} value={ou.id}>
                  {ou.name}
                </option>
              ))}
            </select>
          </div>

          <button
            className="inbox-assign-save-btn"
            disabled={saving}
            onClick={() => void handleApplyAssignment()}
            type="button"
          >
            {saving ? "Guardando…" : "Actualizar asignación"}
          </button>

          {saveSuccess ? (
            <p className="inbox-assign-success" role="status">
              ✓ Asignación guardada con éxito
            </p>
          ) : null}

          {saveError ? (
            <p className="inbox-assign-error" role="alert">
              {saveError}
            </p>
          ) : null}
        </section>

        {/* Channel & Technical Info */}
        <section className="inbox-panel-card">
          <h4>Canal y contexto</h4>
          <dl className="inbox-context-dl">
            <dt>Canal:</dt>
            <dd>{conversation.channelAccount.name}</dd>
            <dt>Proveedor:</dt>
            <dd>{conversation.channelAccount.provider}</dd>
            <dt>Modo:</dt>
            <dd>{conversation.automationMode}</dd>
            <dt>Último mensaje:</dt>
            <dd>{formatRelativeTime(conversation.lastMessageAt)}</dd>
            <dt>Estado:</dt>
            <dd className="t-capitalize">{conversation.status}</dd>
          </dl>
        </section>
      </div>
    </aside>
  );
}
