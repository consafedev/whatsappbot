"use client";

import { useState } from "react";
import {
  type RuleItem,
  type RuleListFilter,
  statusBadgeDetails,
  TRIGGER_OPTIONS,
  triggerLabel,
} from "./rules-view-model";

type RulesListProps = Readonly<{
  canManage: boolean;
  filter: RuleListFilter;
  loading: boolean;
  onDeleteRule: (ruleId: string) => Promise<void>;
  onEditRule: (rule: RuleItem) => void;
  onFilterChange: (filter: Partial<RuleListFilter>) => void;
  onNewRule: () => void;
  onToggleStatus: (ruleId: string, currentStatus: string) => Promise<void>;
  rules: readonly RuleItem[];
}>;

export function RulesList({
  canManage,
  filter,
  loading,
  onDeleteRule,
  onEditRule,
  onFilterChange,
  onNewRule,
  onToggleStatus,
  rules,
}: RulesListProps) {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);

  const activeStatus = filter.status ?? "all";
  const activeTrigger = filter.triggerType ?? "all";

  const handleToggle = async (rule: RuleItem) => {
    if (!canManage || actionInProgressId) return;
    setActionInProgressId(rule.id);
    try {
      await onToggleStatus(rule.id, rule.status);
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleDelete = async (ruleId: string) => {
    if (!canManage || actionInProgressId) return;
    setActionInProgressId(ruleId);
    try {
      await onDeleteRule(ruleId);
      setDeleteConfirmId(null);
    } finally {
      setActionInProgressId(null);
    }
  };

  const activeCount = rules.filter((r) => r.status === "active").length;
  const pausedCount = rules.filter((r) => r.status === "inactive").length;
  const draftCount = rules.filter((r) => r.status === "draft").length;

  return (
    <div className="rules-list-container">
      {/* Header Bar */}
      <div className="rules-page-header">
        <div>
          <h1 className="rules-page-title">Reglas y automatizaciones</h1>
          <p className="rules-page-sub">
            Reglas deterministas que responden a eventos de mensajería, estados y horarios. Cada
            regla se evalúa en orden estricto de prioridad.
          </p>
        </div>
        <div className="rules-header-actions">
          {canManage ? (
            <button
              className="btn btn--primary"
              data-testid="btn-new-rule"
              onClick={onNewRule}
              type="button"
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="16"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="16"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Nueva regla
            </button>
          ) : null}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="rules-filterbar">
        <div className="rules-status-chips">
          <button
            aria-pressed={activeStatus === "all"}
            className={`rules-chip${activeStatus === "all" ? " is-active" : ""}`}
            onClick={() => onFilterChange({ status: "all" })}
            type="button"
          >
            Todas ({rules.length})
          </button>
          <button
            aria-pressed={activeStatus === "active"}
            className={`rules-chip${activeStatus === "active" ? " is-active" : ""}`}
            onClick={() => onFilterChange({ status: "active" })}
            type="button"
          >
            Activas ({activeCount})
          </button>
          <button
            aria-pressed={activeStatus === "inactive"}
            className={`rules-chip${activeStatus === "inactive" ? " is-active" : ""}`}
            onClick={() => onFilterChange({ status: "inactive" })}
            type="button"
          >
            Pausadas ({pausedCount})
          </button>
          {draftCount > 0 ? (
            <button
              aria-pressed={activeStatus === "draft"}
              className={`rules-chip${activeStatus === "draft" ? " is-active" : ""}`}
              onClick={() => onFilterChange({ status: "draft" })}
              type="button"
            >
              Borradores ({draftCount})
            </button>
          ) : null}
        </div>

        <div className="rules-filter-controls">
          <select
            aria-label="Filtrar por disparador"
            className="rules-select-trigger"
            onChange={(e) =>
              onFilterChange({ triggerType: e.target.value === "all" ? undefined : e.target.value })
            }
            value={activeTrigger}
          >
            <option value="all">Todos los disparadores</option>
            {TRIGGER_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          <div className="rules-search-wrapper">
            <input
              aria-label="Buscar regla"
              className="rules-search-input"
              onChange={(e) => onFilterChange({ search: e.target.value })}
              placeholder="Buscar por nombre o descripción…"
              type="search"
              value={filter.search ?? ""}
            />
          </div>
        </div>
      </div>

      {/* Rules Table / List */}
      {loading ? (
        <div className="rules-loading-state" role="status">
          <p>Cargando catálogo de reglas…</p>
        </div>
      ) : rules.length === 0 ? (
        <div className="rules-empty-state">
          <div className="rules-empty-icon" aria-hidden="true">
            ⚡
          </div>
          <h2>No se encontraron reglas</h2>
          <p>
            {filter.search || filter.status !== "all" || filter.triggerType
              ? "No hay reglas que coincidan con los filtros aplicados."
              : "Aún no has configurado ninguna regla de automatización."}
          </p>
          {canManage && (
            <button className="btn btn--primary btn--sm" onClick={onNewRule} type="button">
              Crear primera regla
            </button>
          )}
        </div>
      ) : (
        <div className="rules-table-wrapper">
          <table className="rules-table">
            <thead>
              <tr>
                <th style={{ width: "32%" }}>Regla</th>
                <th style={{ width: "20%" }}>Disparador</th>
                <th style={{ width: "12%" }}>Prioridad</th>
                <th style={{ width: "16%" }}>Lógica</th>
                <th style={{ width: "10%" }}>Estado</th>
                <th className="rules-col-actions" style={{ width: "10%" }}>
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => {
                const badge = statusBadgeDetails(rule.status);
                const isDeleting = deleteConfirmId === rule.id;
                const isWorking = actionInProgressId === rule.id;

                return (
                  <tr
                    className={`rules-row${rule.status !== "active" ? " is-inactive" : ""}`}
                    key={rule.id}
                  >
                    <td>
                      <div className="rules-cell-name">
                        <strong>{rule.name}</strong>
                        {rule.description ? (
                          <small className="rules-cell-desc">{rule.description}</small>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="rules-cell-trigger">
                        <span className="rules-trigger-badge">
                          {triggerLabel(rule.triggerType)}
                        </span>
                        {rule.cooldownSeconds > 0 ? (
                          <small className="rules-cooldown-tag">
                            Cooldown: {rule.cooldownSeconds}s
                          </small>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span
                        className="rules-priority-pill"
                        title="Orden de evaluación ascendente (1 primero)"
                      >
                        P{rule.priority}
                      </span>
                    </td>
                    <td>
                      <div className="rules-cell-logic">
                        <span className="rules-logic-count">
                          {rule.conditions.length} cond. · {rule.actions.length} acc.
                        </span>
                        <small className="rules-mode-tag">
                          {rule.executionMode === "evaluate_all"
                            ? "evalúa todas"
                            : "detener en match"}
                        </small>
                      </div>
                    </td>
                    <td>
                      <div className="rules-status-cell">
                        <span className={`badge ${badge.className}`}>
                          <span className="badge__dot" />
                          {badge.label}
                        </span>
                        {canManage ? (
                          <label className="rules-switch-toggle" title="Activar / Pausar regla">
                            <input
                              aria-label={`Alternar estado de regla ${rule.name}`}
                              checked={rule.status === "active"}
                              disabled={isWorking}
                              onChange={() => void handleToggle(rule)}
                              type="checkbox"
                            />
                            <span className="rules-switch-slider" />
                          </label>
                        ) : null}
                      </div>
                    </td>
                    <td className="rules-col-actions">
                      {isDeleting ? (
                        <div className="rules-delete-confirm">
                          <span>¿Eliminar?</span>
                          <button
                            className="btn btn--danger btn--sm"
                            disabled={isWorking}
                            onClick={() => void handleDelete(rule.id)}
                            type="button"
                          >
                            Sí
                          </button>
                          <button
                            className="btn btn--secondary btn--sm"
                            disabled={isWorking}
                            onClick={() => setDeleteConfirmId(null)}
                            type="button"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <div className="rules-action-buttons">
                          <button
                            aria-label={`Editar regla ${rule.name}`}
                            className="btn btn--secondary btn--sm"
                            onClick={() => onEditRule(rule)}
                            type="button"
                          >
                            Editar
                          </button>
                          {canManage ? (
                            <button
                              aria-label={`Eliminar regla ${rule.name}`}
                              className="btn btn--ghost btn--sm rules-btn-delete"
                              disabled={isWorking}
                              onClick={() => setDeleteConfirmId(rule.id)}
                              type="button"
                            >
                              Eliminar
                            </button>
                          ) : null}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Info Callout */}
      <div className="rules-info-callout">
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
          Las reglas se evalúan en orden numérico de prioridad ascendente (1 se evalúa primero). En
          el modo habitual <code>first_match_stop</code>, la primera regla cuyas condiciones
          coincidan ejecutará sus acciones y detendrá la evaluación de reglas posteriores.
        </span>
      </div>
    </div>
  );
}
