"use client";

import { useCallback, useEffect, useState } from "react";
import { useTenantAppBootstrap } from "../tenant-app-shell";
import { RuleFormModal } from "./rule-form-modal";
import { RulesList } from "./rules-list";
import {
  createRule,
  deleteRule,
  fetchRules,
  formDataToCreatePayload,
  formDataToUpdatePayload,
  type RuleFormData,
  type RuleItem,
  type RuleListFilter,
  toggleRuleStatus,
  updateRule,
} from "./rules-view-model";

type ChannelOption = Readonly<{
  id: string;
  name: string;
  phoneNumber?: string;
}>;

type UnitOption = Readonly<{
  id: string;
  name: string;
}>;

type UserOption = Readonly<{
  displayName: string;
  id: string;
}>;

type RulesClientProps = Readonly<{
  apiBaseUrl?: string | undefined;
}>;

export function RulesClient({ apiBaseUrl }: RulesClientProps) {
  const bootstrap = useTenantAppBootstrap();
  const base = apiBaseUrl ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

  const [rules, setRules] = useState<readonly RuleItem[]>([]);
  const [filter, setFilter] = useState<RuleListFilter>({ status: "all" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RuleItem | null>(null);

  const [channelOptions, setChannelOptions] = useState<readonly ChannelOption[]>([]);
  const [unitOptions, setUnitOptions] = useState<readonly UnitOption[]>([]);
  const [userOptions, setUserOptions] = useState<readonly UserOption[]>([]);

  const hasAutomationModule = bootstrap.effectiveModules.includes("module.automation.basic");
  const hasReadPermission = bootstrap.effectivePermissions.includes("rules.read");
  const hasManagePermission = bootstrap.effectivePermissions.includes("rules.manage");

  // Load select options (channels, units, users)
  useEffect(() => {
    async function loadOptions() {
      try {
        const channelsRes = await fetch(`${base}/api/v1/channels`, { credentials: "include" });
        if (channelsRes.ok) {
          const data = (await channelsRes.json()) as { items?: ChannelOption[] } | ChannelOption[];
          const list = Array.isArray(data) ? data : (data.items ?? []);
          setChannelOptions(list);
        }
      } catch {
        // fail-soft
      }

      try {
        const unitsRes = await fetch(`${base}/app/organization-units`, { credentials: "include" });
        if (unitsRes.ok) {
          const data = (await unitsRes.json()) as { items?: UnitOption[] } | UnitOption[];
          const list = Array.isArray(data) ? data : (data.items ?? []);
          setUnitOptions(list);
        }
      } catch {
        // fail-soft
      }

      try {
        const usersRes = await fetch(`${base}/app/users/options`, { credentials: "include" });
        if (usersRes.ok) {
          const data = (await usersRes.json()) as { users?: UserOption[] };
          setUserOptions(data.users ?? []);
        }
      } catch {
        // fail-soft
      }
    }

    if (hasAutomationModule && hasReadPermission) {
      void loadOptions();
    }
  }, [base, hasAutomationModule, hasReadPermission]);

  // Load rules catalog
  const loadRules = useCallback(
    async (currentFilter: RuleListFilter) => {
      setLoading(true);
      setError(null);
      try {
        const items = await fetchRules(base, currentFilter);
        setRules(items);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al cargar reglas");
      } finally {
        setLoading(false);
      }
    },
    [base],
  );

  useEffect(() => {
    if (hasAutomationModule && hasReadPermission) {
      void loadRules(filter);
    }
  }, [hasAutomationModule, hasReadPermission, loadRules, filter]);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleFilterChange = (newFilter: Partial<RuleListFilter>) => {
    setFilter((prev) => ({ ...prev, ...newFilter }));
  };

  const handleNewRule = () => {
    setEditingRule(null);
    setIsModalOpen(true);
  };

  const handleEditRule = (rule: RuleItem) => {
    setEditingRule(rule);
    setIsModalOpen(true);
  };

  const handleToggleStatus = async (ruleId: string, currentStatus: string) => {
    try {
      const updated = await toggleRuleStatus(base, ruleId, currentStatus);
      setRules((prev) => prev.map((r) => (r.id === ruleId ? updated : r)));
      showToast(`Regla "${updated.name}" ${updated.status === "active" ? "activada" : "pausada"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cambiar estado de la regla");
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      await deleteRule(base, ruleId);
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
      showToast("Regla eliminada exitosamente.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar la regla");
    }
  };

  const handleSaveRule = async (formData: RuleFormData) => {
    setSaving(true);
    setError(null);
    try {
      if (formData.id) {
        const payload = formDataToUpdatePayload(formData);
        const updated = await updateRule(base, formData.id, payload);
        setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        showToast(`Regla "${updated.name}" actualizada.`);
      } else {
        const payload = formDataToCreatePayload(formData);
        const created = await createRule(base, payload);
        setRules((prev) => [created, ...prev]);
        showToast(`Regla "${created.name}" creada exitosamente.`);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!hasAutomationModule) {
    return (
      <div className="rules-gate-error" role="alert">
        <h2>Módulo de Automatizaciones no habilitado</h2>
        <p>
          Este tenant no tiene habilitado el módulo <code>module.automation.basic</code>. Contacta
          al administrador de la plataforma para habilitarlo.
        </p>
      </div>
    );
  }

  if (!hasReadPermission) {
    return (
      <div className="rules-gate-error" role="alert">
        <h2>Permiso insuficiente</h2>
        <p>
          Tu usuario no tiene el permiso <code>rules.read</code> necesario para consultar las reglas
          de automatización.
        </p>
      </div>
    );
  }

  return (
    <div className="rules-view-wrapper">
      {toastMessage && (
        <div className="rules-toast-banner" role="status">
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
        <div className="rules-error-banner" role="alert">
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
            className="rules-error-close"
            onClick={() => setError(null)}
            type="button"
          >
            ✕
          </button>
        </div>
      )}

      <RulesList
        canManage={hasManagePermission}
        filter={filter}
        loading={loading}
        onDeleteRule={handleDeleteRule}
        onEditRule={handleEditRule}
        onFilterChange={handleFilterChange}
        onNewRule={handleNewRule}
        onToggleStatus={handleToggleStatus}
        rules={rules}
      />

      <RuleFormModal
        channels={channelOptions}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveRule}
        rule={editingRule}
        saving={saving}
        units={unitOptions}
        users={userOptions}
      />
    </div>
  );
}
