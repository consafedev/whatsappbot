"use client";

import { useEffect, useId, useState } from "react";
import {
  ACTION_TYPE_OPTIONS,
  DEFAULT_FORM_DATA,
  EXECUTION_MODE_OPTIONS,
  generateRuleSentencePreview,
  OPERATOR_OPTIONS,
  type RuleActionForm,
  type RuleConditionForm,
  type RuleFormData,
  type RuleItem,
  ruleToFormData,
  SUGGESTED_CONDITION_FIELDS,
  TRIGGER_OPTIONS,
  triggerLabel,
} from "./rules-view-model";

type RuleFormModalProps = Readonly<{
  channels: readonly { id: string; name: string; phoneNumber?: string }[];
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: RuleFormData) => Promise<void>;
  rule?: RuleItem | null;
  saving: boolean;
  units: readonly { id: string; name: string }[];
  users: readonly { displayName: string; id: string }[];
}>;

type InternalCondition = RuleConditionForm & { keyId: string };
type InternalAction = RuleActionForm & { keyId: string };

type InternalFormData = Omit<RuleFormData, "actions" | "conditions"> & {
  actions: InternalAction[];
  conditions: InternalCondition[];
};

const VARIABLE_SUGGESTIONS = [
  { label: "Nombre contacto", tag: "{{contact.name}}" },
  { label: "Teléfono", tag: "{{contact.phoneNumber}}" },
  { label: "Texto entrante", tag: "{{message.textBody}}" },
  { label: "Estado conversación", tag: "{{conversation.status}}" },
];

let keySeq = 0;
function nextKey(prefix: string): string {
  keySeq += 1;
  return `${prefix}-${Date.now()}-${keySeq}`;
}

function toInternalFormData(data: RuleFormData): InternalFormData {
  return {
    ...data,
    actions: data.actions.map((a) => ({ ...a, keyId: nextKey("act") })),
    conditions: data.conditions.map((c) => ({ ...c, keyId: nextKey("cnd") })),
  };
}

export function RuleFormModal({
  channels,
  isOpen,
  onClose,
  onSave,
  rule,
  saving,
  units,
  users,
}: RuleFormModalProps) {
  const [formData, setFormData] = useState<InternalFormData>(() =>
    toInternalFormData(DEFAULT_FORM_DATA),
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (rule) {
      setFormData(toInternalFormData(ruleToFormData(rule)));
    } else {
      setFormData(
        toInternalFormData({
          ...DEFAULT_FORM_DATA,
          actions: [{ actionType: "SEND_MESSAGE", textBody: "" }],
          conditions: [{ field: "message.textBody", operator: "CONTAINS", value: "" }],
        }),
      );
    }
    setErrorMessage(null);
  }, [rule]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !saving) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;

  const channelsLookup = Object.fromEntries(channels.map((c) => [c.id, c.name]));
  const unitsLookup = Object.fromEntries(units.map((u) => [u.id, u.name]));
  const usersLookup = Object.fromEntries(users.map((u) => [u.id, u.displayName]));

  const sentencePreview = generateRuleSentencePreview(formData, {
    channels: channelsLookup,
    units: unitsLookup,
    users: usersLookup,
  });

  // Condition Handlers
  const handleAddCondition = () => {
    setFormData((prev) => ({
      ...prev,
      conditions: [
        ...prev.conditions,
        {
          field: "message.textBody",
          keyId: nextKey("cnd"),
          operator: "CONTAINS",
          value: "",
        },
      ],
    }));
  };

  const handleRemoveCondition = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      conditions: prev.conditions.filter((_, i) => i !== index),
    }));
  };

  const handleConditionChange = (
    index: number,
    field: "field" | "operator" | "value",
    value: string,
  ) => {
    setFormData((prev) => {
      const updated = [...prev.conditions];
      const current = updated[index];
      if (current) {
        updated[index] = { ...current, [field]: value };
      }
      return { ...prev, conditions: updated };
    });
  };

  // Action Handlers
  const handleAddAction = () => {
    setFormData((prev) => ({
      ...prev,
      actions: [
        ...prev.actions,
        { actionType: "SEND_MESSAGE", keyId: nextKey("act"), textBody: "" },
      ],
    }));
  };

  const handleRemoveAction = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      actions: prev.actions.filter((_, i) => i !== index),
    }));
  };

  const handleActionTypeChange = (index: number, actionType: string) => {
    setFormData((prev) => {
      const updated = [...prev.actions];
      const current = updated[index];
      const keyId = current ? current.keyId : nextKey("act");
      updated[index] = { actionType, keyId };
      return { ...prev, actions: updated };
    });
  };

  const handleActionParamChange = (index: number, field: string, value: string) => {
    setFormData((prev) => {
      const updated = [...prev.actions];
      const current = updated[index];
      if (current) {
        updated[index] = { ...current, [field]: value };
      }
      return { ...prev, actions: updated };
    });
  };

  const handleInsertVariable = (actionIndex: number, tag: string) => {
    setFormData((prev) => {
      const updated = [...prev.actions];
      const current = updated[actionIndex];
      if (current) {
        const text = current.textBody ?? "";
        updated[actionIndex] = { ...current, textBody: `${text}${tag}` };
      }
      return { ...prev, actions: updated };
    });
  };

  // Submit
  const handleSubmit = async (targetStatus: "active" | "draft") => {
    if (!formData.name.trim()) {
      setErrorMessage("El nombre de la regla es obligatorio.");
      return;
    }
    if (formData.actions.length === 0) {
      setErrorMessage("Debes configurar al menos una acción.");
      return;
    }

    setErrorMessage(null);
    try {
      const outgoingData: RuleFormData = {
        actions: formData.actions.map(({ keyId, ...a }) => a),
        channelAccountId: formData.channelAccountId,
        conditions: formData.conditions.map(({ keyId, ...c }) => c),
        cooldownSeconds: formData.cooldownSeconds,
        description: formData.description,
        executionMode: formData.executionMode,
        id: formData.id,
        name: formData.name,
        organizationUnitId: formData.organizationUnitId,
        priority: formData.priority,
        status: targetStatus,
        triggerType: formData.triggerType,
      };
      await onSave(outgoingData);
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Error al guardar regla");
    }
  };

  return (
    <div aria-labelledby={titleId} aria-modal="true" className="rules-modal-overlay" role="dialog">
      <button
        aria-label="Cerrar modal de regla"
        className="rules-modal-backdrop"
        onClick={!saving ? onClose : undefined}
        tabIndex={-1}
        type="button"
      />
      <div className="rules-modal-drawer">
        {/* Header */}
        <div className="rules-modal-header">
          <div>
            <span className="rules-modal-kicker">Automatización determinista</span>
            <h2 className="rules-modal-title" id={titleId}>
              {rule ? `Editar: ${rule.name}` : "Crear nueva regla"}
            </h2>
          </div>
          <div className="rules-modal-header-actions">
            <button
              className="btn btn--ghost btn--sm"
              disabled={saving}
              onClick={onClose}
              type="button"
            >
              Cancelar
            </button>
            <button
              className="btn btn--secondary btn--sm"
              disabled={saving}
              onClick={() => void handleSubmit("draft")}
              type="button"
            >
              Guardar borrador
            </button>
            <button
              className="btn btn--primary btn--sm"
              disabled={saving}
              onClick={() => void handleSubmit("active")}
              type="button"
            >
              {saving ? "Guardando…" : "Activar regla"}
            </button>
          </div>
        </div>

        {errorMessage && (
          <div className="rules-modal-error-banner" role="alert">
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
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Content Body: 2 Columns */}
        <div className="rules-modal-body">
          {/* Main Builder Form (Left) */}
          <div className="rules-builder-main">
            {/* General Info Card */}
            <div className="rules-card">
              <h3 className="rules-section-title">Datos generales</h3>
              <div className="rules-form-grid-2">
                <label className="rules-field">
                  <span className="rules-field-label">
                    Nombre de la regla<span className="rules-req">*</span>
                  </span>
                  <input
                    className="rules-input"
                    maxLength={160}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Ej. Asignar nueva conversación a Ventas"
                    required
                    type="text"
                    value={formData.name}
                  />
                </label>
                <label className="rules-field">
                  <span className="rules-field-label">Disparador (Evento inicial)</span>
                  <select
                    className="rules-select"
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, triggerType: e.target.value }))
                    }
                    value={formData.triggerType}
                  >
                    {TRIGGER_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label} ({t.value})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ marginTop: "12px" }}>
                <label className="rules-field">
                  <span className="rules-field-label">Descripción corta (opcional)</span>
                  <input
                    className="rules-input"
                    maxLength={500}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, description: e.target.value }))
                    }
                    placeholder="Explica brevemente qué hace esta regla para el equipo..."
                    type="text"
                    value={formData.description}
                  />
                </label>
              </div>

              <div className="rules-form-grid-4" style={{ marginTop: "14px" }}>
                <label className="rules-field">
                  <span className="rules-field-label">
                    Prioridad (1-10000)
                    <small className="rules-field-sub">1 = máxima prioridad</small>
                  </span>
                  <input
                    className="rules-input"
                    max={10000}
                    min={1}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        priority: Number.parseInt(e.target.value, 10) || 100,
                      }))
                    }
                    type="number"
                    value={formData.priority}
                  />
                </label>

                <label className="rules-field">
                  <span className="rules-field-label">Modo de ejecución</span>
                  <select
                    className="rules-select"
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, executionMode: e.target.value }))
                    }
                    value={formData.executionMode}
                  >
                    {EXECUTION_MODE_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="rules-field">
                  <span className="rules-field-label">
                    Cooldown (segundos)
                    <small className="rules-field-sub">0 = sin espera</small>
                  </span>
                  <input
                    className="rules-input"
                    max={86400}
                    min={0}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        cooldownSeconds: Number.parseInt(e.target.value, 10) || 0,
                      }))
                    }
                    type="number"
                    value={formData.cooldownSeconds}
                  />
                </label>

                <label className="rules-field">
                  <span className="rules-field-label">Canal específico</span>
                  <select
                    className="rules-select"
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        channelAccountId: e.target.value ? e.target.value : null,
                      }))
                    }
                    value={formData.channelAccountId ?? ""}
                  >
                    <option value="">Todos los canales</option>
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.phoneNumber ? `(${c.phoneNumber})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ marginTop: "12px" }}>
                <label className="rules-field">
                  <span className="rules-field-label">
                    Unidad organizacional objetivo (opcional)
                  </span>
                  <select
                    className="rules-select"
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        organizationUnitId: e.target.value ? e.target.value : null,
                      }))
                    }
                    value={formData.organizationUnitId ?? ""}
                  >
                    <option value="">Cualquier unidad / Global</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {/* Conditions Builder */}
            <div className="rules-card" style={{ marginTop: "18px" }}>
              <div className="rules-card-header-flex">
                <div>
                  <h3 className="rules-section-title">Condiciones de filtro (cuándo coincide)</h3>
                  <p className="rules-section-subtitle">
                    La regla se disparará únicamente si se cumplen todas las condiciones indicadas
                    (AND). Si no defines condiciones, aplicará a todos los eventos del disparador.
                  </p>
                </div>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={handleAddCondition}
                  type="button"
                >
                  + Agregar condición
                </button>
              </div>

              {formData.conditions.length === 0 ? (
                <div className="rules-empty-conditions">
                  <span>
                    Sin condiciones específicas: esta regla coincidirá con cualquier evento del tipo{" "}
                    {triggerLabel(formData.triggerType)}.
                  </span>
                </div>
              ) : (
                <div className="rules-conditions-list">
                  {formData.conditions.map((cond, idx) => {
                    const isUnaryOp = [
                      "IS_EMPTY",
                      "IS_NOT_EMPTY",
                      "IS_TRUE",
                      "IS_FALSE",
                      "IS_NULL",
                      "IS_NOT_NULL",
                      "ARRAY_EMPTY",
                      "ARRAY_NOT_EMPTY",
                    ].includes(cond.operator.toUpperCase());

                    return (
                      <div className="rules-condition-row" key={cond.keyId}>
                        <label className="rules-condition-col-field">
                          <span className="rules-micro-label">Campo a evaluar</span>
                          <input
                            className="rules-input"
                            list={`fields-datalist-${cond.keyId}`}
                            onChange={(e) => handleConditionChange(idx, "field", e.target.value)}
                            placeholder="campo (ej. message.textBody)"
                            type="text"
                            value={cond.field}
                          />
                          <datalist id={`fields-datalist-${cond.keyId}`}>
                            {SUGGESTED_CONDITION_FIELDS.map((s) => (
                              <option key={s.field} value={s.field}>
                                {s.label}
                              </option>
                            ))}
                          </datalist>
                        </label>

                        <label className="rules-condition-col-op">
                          <span className="rules-micro-label">Operador</span>
                          <select
                            className="rules-select"
                            onChange={(e) => handleConditionChange(idx, "operator", e.target.value)}
                            value={cond.operator}
                          >
                            {OPERATOR_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label} ({o.value})
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="rules-condition-col-val">
                          <span className="rules-micro-label">Valor esperado</span>
                          <input
                            className="rules-input"
                            disabled={isUnaryOp}
                            onChange={(e) => handleConditionChange(idx, "value", e.target.value)}
                            placeholder={isUnaryOp ? "(no requiere valor)" : "valor de comparación"}
                            type="text"
                            value={isUnaryOp ? "" : cond.value}
                          />
                        </label>

                        <button
                          aria-label="Eliminar condición"
                          className="btn btn--ghost btn--icon btn--sm rules-btn-remove"
                          onClick={() => handleRemoveCondition(idx)}
                          title="Eliminar condición"
                          type="button"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Actions Builder */}
            <div className="rules-card" style={{ marginTop: "18px" }}>
              <div className="rules-card-header-flex">
                <div>
                  <h3 className="rules-section-title">Acciones de respuesta (qué hacer)</h3>
                  <p className="rules-section-subtitle">
                    Mutaciones transaccionales que se ejecutarán automáticamente cuando la regla
                    coincida.
                  </p>
                </div>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={handleAddAction}
                  type="button"
                >
                  + Agregar acción
                </button>
              </div>

              <div className="rules-actions-list">
                {formData.actions.map((action, aIdx) => {
                  const upper = action.actionType.toUpperCase();

                  return (
                    <div className="rules-action-card" key={action.keyId}>
                      <div className="rules-action-card-header">
                        <label className="rules-action-type-select-wrapper">
                          <span className="rules-micro-label">Tipo de acción</span>
                          <select
                            className="rules-select"
                            onChange={(e) => handleActionTypeChange(aIdx, e.target.value)}
                            value={upper}
                          >
                            {ACTION_TYPE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          aria-label="Eliminar acción"
                          className="btn btn--ghost btn--icon btn--sm rules-btn-remove"
                          disabled={formData.actions.length <= 1}
                          onClick={() => handleRemoveAction(aIdx)}
                          title="Eliminar acción"
                          type="button"
                        >
                          ✕
                        </button>
                      </div>

                      {/* Dynamic Parameters per Action Type */}
                      <div className="rules-action-params-body">
                        {upper === "SEND_MESSAGE" && (
                          <div>
                            <label className="rules-field">
                              <span className="rules-field-label">
                                Mensaje de respuesta automática (Plantilla de texto)
                              </span>
                              <textarea
                                className="rules-textarea"
                                onChange={(e) =>
                                  handleActionParamChange(aIdx, "textBody", e.target.value)
                                }
                                placeholder="Escribe el mensaje de respuesta... Puedes usar variables como {{contact.name}}"
                                rows={3}
                                value={action.textBody ?? ""}
                              />
                            </label>
                            <div className="rules-variable-chips">
                              <span className="rules-variable-help">Variables disponibles:</span>
                              {VARIABLE_SUGGESTIONS.map((v) => (
                                <button
                                  className="rules-variable-token"
                                  key={v.tag}
                                  onClick={() => handleInsertVariable(aIdx, v.tag)}
                                  title={`Insertar ${v.tag}`}
                                  type="button"
                                >
                                  + {v.label}
                                </button>
                              ))}
                            </div>
                            <div className="rules-form-grid-2" style={{ marginTop: "8px" }}>
                              <label className="rules-field">
                                <span className="rules-field-sub">URL de archivo (HTTPS)</span>
                                <input
                                  className="rules-input"
                                  onChange={(e) =>
                                    handleActionParamChange(aIdx, "mediaUrl", e.target.value)
                                  }
                                  placeholder="https://..."
                                  type="url"
                                  value={action.mediaUrl ?? ""}
                                />
                              </label>
                              <label className="rules-field">
                                <span className="rules-field-sub">Pie de foto / Caption</span>
                                <input
                                  className="rules-input"
                                  onChange={(e) =>
                                    handleActionParamChange(aIdx, "caption", e.target.value)
                                  }
                                  placeholder="Pie de foto..."
                                  type="text"
                                  value={action.caption ?? ""}
                                />
                              </label>
                            </div>
                          </div>
                        )}

                        {upper === "ASSIGN_USER" && (
                          <label className="rules-field">
                            <span className="rules-field-label">Seleccionar agente</span>
                            <select
                              className="rules-select"
                              onChange={(e) =>
                                handleActionParamChange(aIdx, "userId", e.target.value)
                              }
                              value={action.userId ?? ""}
                            >
                              <option value="">Sin asignar (desasignar agente)</option>
                              {users.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.displayName}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}

                        {upper === "ASSIGN_ORGANIZATION_UNIT" && (
                          <label className="rules-field">
                            <span className="rules-field-label">
                              Seleccionar unidad organizacional
                            </span>
                            <select
                              className="rules-select"
                              onChange={(e) =>
                                handleActionParamChange(aIdx, "unitId", e.target.value)
                              }
                              value={action.unitId ?? ""}
                            >
                              <option value="">Sin unidad (desasignar unidad)</option>
                              {units.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}

                        {upper === "CHANGE_CONVERSATION_STATUS" && (
                          <div className="rules-form-grid-2">
                            <label className="rules-field">
                              <span className="rules-field-label">Nuevo estado</span>
                              <select
                                className="rules-select"
                                onChange={(e) =>
                                  handleActionParamChange(aIdx, "status", e.target.value)
                                }
                                value={action.status ?? "open"}
                              >
                                <option value="open">Abierta (open)</option>
                                <option value="pending">Pendiente (pending)</option>
                                <option value="closed">Cerrada (closed)</option>
                              </select>
                            </label>
                            <label className="rules-field">
                              <span className="rules-field-label">Motivo de cambio (opcional)</span>
                              <input
                                className="rules-input"
                                onChange={(e) =>
                                  handleActionParamChange(aIdx, "reason", e.target.value)
                                }
                                placeholder="Ej. Auto-cierre por regla"
                                type="text"
                                value={action.reason ?? ""}
                              />
                            </label>
                          </div>
                        )}

                        {(upper === "ADD_CONTACT_TAG" || upper === "REMOVE_CONTACT_TAG") && (
                          <label className="rules-field">
                            <span className="rules-field-label">Nombre de la etiqueta</span>
                            <input
                              className="rules-input"
                              onChange={(e) => handleActionParamChange(aIdx, "tag", e.target.value)}
                              placeholder="Ej. cliente_vip, soporte, cotizacion_pendiente"
                              type="text"
                              value={action.tag ?? ""}
                            />
                          </label>
                        )}

                        {upper === "SET_CONTACT_CUSTOM_ATTRIBUTE" && (
                          <div className="rules-form-grid-2">
                            <label className="rules-field">
                              <span className="rules-field-label">Clave del atributo</span>
                              <input
                                className="rules-input"
                                onChange={(e) =>
                                  handleActionParamChange(
                                    aIdx,
                                    "customAttributeKey",
                                    e.target.value,
                                  )
                                }
                                placeholder="Ej. planTier, preferedLanguage"
                                type="text"
                                value={action.customAttributeKey ?? ""}
                              />
                            </label>
                            <label className="rules-field">
                              <span className="rules-field-label">Valor</span>
                              <input
                                className="rules-input"
                                onChange={(e) =>
                                  handleActionParamChange(
                                    aIdx,
                                    "customAttributeValue",
                                    e.target.value,
                                  )
                                }
                                placeholder="Ej. premium, es-MX"
                                type="text"
                                value={action.customAttributeValue ?? ""}
                              />
                            </label>
                          </div>
                        )}

                        {upper === "SET_AUTOMATION_MODE" && (
                          <label className="rules-field">
                            <span className="rules-field-label">
                              Modo de automatización objetivo
                            </span>
                            <select
                              className="rules-select"
                              onChange={(e) =>
                                handleActionParamChange(aIdx, "automationMode", e.target.value)
                              }
                              value={action.automationMode ?? "AUTO"}
                            >
                              <option value="AUTO">AUTO (Automatización total)</option>
                              <option value="ASSISTED">ASSISTED (Asistido / Sugerencias)</option>
                              <option value="HUMAN">HUMAN (Takeover humano activo)</option>
                              <option value="MONITOR">MONITOR (Solo lectura / Observación)</option>
                            </select>
                          </label>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Side Panel Summary & Sentence Preview (Right) */}
          <aside className="rules-builder-aside">
            <div className="rules-card">
              <h4 className="rules-aside-title">Oración en lenguaje natural</h4>
              <div className="rules-preview-sentence-box">
                <p className="rules-preview-trigger">
                  <span className="rules-sentence-token accent">CUÁNDO</span>
                  {sentencePreview.triggerSentence}
                </p>
                <p className="rules-preview-action">
                  <span className="rules-sentence-token success">ENTONCES</span>
                  {sentencePreview.actionsSentence}
                </p>
              </div>
            </div>

            <div className="rules-card" style={{ marginTop: "14px" }}>
              <h4 className="rules-aside-title">Resumen de ejecución</h4>
              <div className="rules-summary-row">
                <span>Disparador:</span>
                <strong>{triggerLabel(formData.triggerType)}</strong>
              </div>
              <div className="rules-summary-row">
                <span>Prioridad:</span>
                <strong>P{formData.priority}</strong>
              </div>
              <div className="rules-summary-row">
                <span>Modo:</span>
                <strong>{formData.executionMode}</strong>
              </div>
              <div className="rules-summary-row">
                <span>Condiciones:</span>
                <strong>{formData.conditions.filter((c) => c.field.trim()).length} activas</strong>
              </div>
              <div className="rules-summary-row">
                <span>Acciones:</span>
                <strong>{formData.actions.length} mutaciones</strong>
              </div>
              <div className="rules-summary-row">
                <span>Cooldown:</span>
                <strong>
                  {formData.cooldownSeconds > 0 ? `${formData.cooldownSeconds}s` : "Inmediato"}
                </strong>
              </div>
            </div>

            <div className="rules-card" style={{ marginTop: "14px" }}>
              <h4 className="rules-aside-title">Semántica determinista</h4>
              <p className="rules-aside-help">
                El motor ejecuta mutaciones bajo transacciones atómicas de PostgreSQL con bloqueo
                consultivo para prevenir carreras y garantizar aislamiento de inquilino.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
