export type RuleTriggerType =
  | "ON_MESSAGE_RECEIVED"
  | "ON_CONVERSATION_CREATED"
  | "ON_STATUS_CHANGED"
  | "ON_CONVERSATION_UNASSIGNED"
  | "ON_OUT_OF_BUSINESS_HOURS";

export type RuleStatus = "draft" | "active" | "inactive";

export type RuleExecutionMode = "first_match_stop" | "evaluate_all";

export type RuleCondition = Readonly<{
  field: string;
  operator: string;
  value?: unknown;
}>;

export type RuleAction = Readonly<{
  actionType: string;
  parameters?: Record<string, unknown> | undefined;
}>;

export type RuleItem = Readonly<{
  actions: readonly RuleAction[];
  channelAccountId: string | null;
  conditions: readonly RuleCondition[];
  cooldownSeconds: number;
  createdAt: string;
  description: string | null;
  executionMode: string;
  id: string;
  name: string;
  organizationUnitId: string | null;
  priority: number;
  status: string;
  tenantId: string;
  triggerType: string;
  updatedAt: string;
}>;

export type RuleConditionForm = {
  field: string;
  operator: string;
  value: string;
};

export type RuleActionForm = {
  actionType: string;
  automationMode?: string | undefined;
  caption?: string | undefined;
  customAttributeKey?: string | undefined;
  customAttributeValue?: string | undefined;
  mediaUrl?: string | undefined;
  reason?: string | undefined;
  status?: string | undefined;
  tag?: string | undefined;
  textBody?: string | undefined;
  unitId?: string | undefined;
  userId?: string | undefined;
};

export type RuleFormData = {
  actions: RuleActionForm[];
  channelAccountId: string | null;
  conditions: RuleConditionForm[];
  cooldownSeconds: number;
  description: string;
  executionMode: string;
  id?: string | undefined;
  name: string;
  organizationUnitId: string | null;
  priority: number;
  status: string;
  triggerType: string;
};

export type RuleListFilter = Readonly<{
  channelAccountId?: string | undefined;
  organizationUnitId?: string | undefined;
  search?: string | undefined;
  status?: string | undefined;
  triggerType?: string | undefined;
}>;

export type CreateRulePayload = Readonly<{
  actions: readonly RuleAction[];
  channelAccountId?: string | null | undefined;
  conditions: readonly RuleCondition[];
  cooldownSeconds?: number | undefined;
  description?: string | null | undefined;
  executionMode?: string | undefined;
  name: string;
  organizationUnitId?: string | null | undefined;
  priority?: number | undefined;
  status?: string | undefined;
  triggerType: string;
}>;

export type UpdateRulePayload = Readonly<{
  actions?: readonly RuleAction[] | undefined;
  channelAccountId?: string | null | undefined;
  conditions?: readonly RuleCondition[] | undefined;
  cooldownSeconds?: number | undefined;
  description?: string | null | undefined;
  executionMode?: string | undefined;
  name?: string | undefined;
  organizationUnitId?: string | null | undefined;
  priority?: number | undefined;
  status?: string | undefined;
  triggerType?: string | undefined;
}>;

export type RulesLookupData = Readonly<{
  channels?: Readonly<Record<string, string>> | undefined;
  units?: Readonly<Record<string, string>> | undefined;
  users?: Readonly<Record<string, string>> | undefined;
}>;

export const TRIGGER_OPTIONS: readonly { label: string; value: RuleTriggerType }[] = Object.freeze([
  { label: "Mensaje entrante", value: "ON_MESSAGE_RECEIVED" },
  { label: "Conversación creada", value: "ON_CONVERSATION_CREATED" },
  { label: "Cambio de estado", value: "ON_STATUS_CHANGED" },
  { label: "Conversación no asignada", value: "ON_CONVERSATION_UNASSIGNED" },
  { label: "Fuera de horario de atención", value: "ON_OUT_OF_BUSINESS_HOURS" },
]);

export const OPERATOR_OPTIONS: readonly { group: string; label: string; value: string }[] =
  Object.freeze([
    { group: "Texto", label: "Igual a", value: "EQUALS" },
    { group: "Texto", label: "Diferente de", value: "NOT_EQUALS" },
    { group: "Texto", label: "Contiene", value: "CONTAINS" },
    { group: "Texto", label: "No contiene", value: "NOT_CONTAINS" },
    { group: "Texto", label: "Empieza con", value: "STARTS_WITH" },
    { group: "Texto", label: "Termina con", value: "ENDS_WITH" },
    { group: "Texto", label: "Coincide con RegEx", value: "MATCHES_REGEX" },
    { group: "Texto", label: "Está vacío", value: "IS_EMPTY" },
    { group: "Texto", label: "No está vacío", value: "IS_NOT_EMPTY" },
    { group: "Números", label: "Mayor que (>)", value: "GREATER_THAN" },
    { group: "Números", label: "Mayor o igual que (>=)", value: "GREATER_THAN_OR_EQUAL" },
    { group: "Números", label: "Menor que (<)", value: "LESS_THAN" },
    { group: "Números", label: "Menor o igual que (<=)", value: "LESS_THAN_OR_EQUAL" },
    { group: "Números", label: "Igual numérico", value: "NUMERIC_EQUALS" },
    { group: "Listas / Etiquetas", label: "En lista (separada por comas)", value: "IN" },
    { group: "Listas / Etiquetas", label: "No en lista", value: "NOT_IN" },
    { group: "Listas / Etiquetas", label: "Contiene cualquiera de", value: "CONTAINS_ANY" },
    { group: "Listas / Etiquetas", label: "Contiene todos de", value: "CONTAINS_ALL" },
    { group: "Listas / Etiquetas", label: "Lista vacía", value: "ARRAY_EMPTY" },
    { group: "Listas / Etiquetas", label: "Lista no vacía", value: "ARRAY_NOT_EMPTY" },
    { group: "Estados / Booleanos", label: "Es verdadero (True)", value: "IS_TRUE" },
    { group: "Estados / Booleanos", label: "Es falso (False)", value: "IS_FALSE" },
    { group: "Estados / Booleanos", label: "Es nulo (Null)", value: "IS_NULL" },
    { group: "Estados / Booleanos", label: "No es nulo (Not Null)", value: "IS_NOT_NULL" },
  ]);

export const ACTION_TYPE_OPTIONS: readonly { label: string; value: string }[] = Object.freeze([
  { label: "Enviar mensaje de respuesta", value: "SEND_MESSAGE" },
  { label: "Asignar a agente", value: "ASSIGN_USER" },
  { label: "Asignar a unidad organizacional", value: "ASSIGN_ORGANIZATION_UNIT" },
  { label: "Cambiar estado de conversación", value: "CHANGE_CONVERSATION_STATUS" },
  { label: "Agregar etiqueta a contacto", value: "ADD_CONTACT_TAG" },
  { label: "Remover etiqueta de contacto", value: "REMOVE_CONTACT_TAG" },
  { label: "Establecer atributo personalizado", value: "SET_CONTACT_CUSTOM_ATTRIBUTE" },
  { label: "Cambiar modo de automatización", value: "SET_AUTOMATION_MODE" },
]);

export const EXECUTION_MODE_OPTIONS: readonly {
  description: string;
  label: string;
  value: RuleExecutionMode;
}[] = Object.freeze([
  {
    description: "Detiene la evaluación tras coincidir y ejecutar esta regla",
    label: "Detener tras primera coincidencia (first_match_stop)",
    value: "first_match_stop",
  },
  {
    description: "Permite que reglas posteriores también se evalúen y ejecuten",
    label: "Evaluar todas las reglas (evaluate_all)",
    value: "evaluate_all",
  },
]);

export const SUGGESTED_CONDITION_FIELDS: readonly { field: string; label: string }[] =
  Object.freeze([
    { field: "message.textBody", label: "Texto del mensaje entrante" },
    { field: "contact.phoneNumber", label: "Teléfono del contacto" },
    { field: "contact.name", label: "Nombre del contacto" },
    { field: "contact.tags", label: "Etiquetas del contacto (Array)" },
    { field: "conversation.status", label: "Estado de la conversación (new/open/pending/closed)" },
    { field: "conversation.automationMode", label: "Modo de automatización (AUTO/HUMAN/ASSISTED)" },
    { field: "conversation.unreadCount", label: "Mensajes no leídos" },
    { field: "isWithinBusinessHours", label: "Dentro de horario de atención (Boolean)" },
    { field: "channel.provider", label: "Proveedor de canal (mock/baileys/meta)" },
  ]);

export const DEFAULT_FORM_DATA: RuleFormData = Object.freeze({
  actions: [{ actionType: "SEND_MESSAGE", textBody: "" }],
  channelAccountId: null,
  conditions: [{ field: "message.textBody", operator: "CONTAINS", value: "" }],
  cooldownSeconds: 0,
  description: "",
  executionMode: "first_match_stop",
  name: "",
  organizationUnitId: null,
  priority: 100,
  status: "active",
  triggerType: "ON_MESSAGE_RECEIVED",
});

// Human-readable helpers
export function triggerLabel(triggerType: string): string {
  const match = TRIGGER_OPTIONS.find((t) => t.value === triggerType);
  return match?.label ?? triggerType;
}

export function operatorLabel(operator: string): string {
  const match = OPERATOR_OPTIONS.find((o) => o.value.toUpperCase() === operator.toUpperCase());
  return match?.label ?? operator;
}

export function actionTypeLabel(actionType: string): string {
  const upper = actionType.toUpperCase();
  const match = ACTION_TYPE_OPTIONS.find((a) => a.value === upper);
  return match?.label ?? actionType;
}

export function executionModeLabel(mode: string): string {
  const match = EXECUTION_MODE_OPTIONS.find((m) => m.value === mode);
  return match?.label ?? mode;
}

export function statusBadgeDetails(status: string): {
  className: string;
  label: string;
} {
  switch (status.toLowerCase()) {
    case "active":
      return { className: "badge--success", label: "Activa" };
    case "inactive":
      return { className: "badge--neutral", label: "Pausada" };
    case "draft":
      return { className: "badge--warn", label: "Borrador" };
    default:
      return { className: "badge--outline", label: status };
  }
}

// Serialization and Form Conversion Helpers
export function ruleToFormData(rule: RuleItem): RuleFormData {
  const conditions: RuleConditionForm[] = rule.conditions.map((c) => {
    let valueStr = "";
    if (c.value !== undefined && c.value !== null) {
      if (Array.isArray(c.value)) {
        valueStr = c.value.join(", ");
      } else if (typeof c.value === "object") {
        valueStr = JSON.stringify(c.value);
      } else {
        valueStr = String(c.value);
      }
    }
    return {
      field: c.field,
      operator: c.operator,
      value: valueStr,
    };
  });

  const actions: RuleActionForm[] = rule.actions.map((a) => {
    const params = a.parameters ?? {};
    const upper = a.actionType.toUpperCase();
    const actionForm: RuleActionForm = {
      actionType: upper,
    };

    if (params.textBody !== undefined) actionForm.textBody = String(params.textBody);
    if (params.text !== undefined && !actionForm.textBody) {
      actionForm.textBody = String(params.text);
    }
    if (params.caption !== undefined) actionForm.caption = String(params.caption);
    if (params.mediaUrl !== undefined) actionForm.mediaUrl = String(params.mediaUrl);
    if (params.userId !== undefined && params.userId !== null) {
      actionForm.userId = String(params.userId);
    }
    if (params.unitId !== undefined && params.unitId !== null) {
      actionForm.unitId = String(params.unitId);
    }
    if (params.organizationUnitId !== undefined && params.organizationUnitId !== null) {
      actionForm.unitId = String(params.organizationUnitId);
    }
    if (params.status !== undefined) actionForm.status = String(params.status);
    if (params.reason !== undefined) actionForm.reason = String(params.reason);
    if (params.tag !== undefined) actionForm.tag = String(params.tag);
    if (params.key !== undefined) actionForm.customAttributeKey = String(params.key);
    if (params.value !== undefined) actionForm.customAttributeValue = String(params.value);
    if (params.mode !== undefined) actionForm.automationMode = String(params.mode);
    if (params.automationMode !== undefined && !actionForm.automationMode) {
      actionForm.automationMode = String(params.automationMode);
    }

    return actionForm;
  });

  return {
    actions: actions.length > 0 ? actions : [...DEFAULT_FORM_DATA.actions],
    channelAccountId: rule.channelAccountId,
    conditions: conditions.length > 0 ? conditions : [...DEFAULT_FORM_DATA.conditions],
    cooldownSeconds: rule.cooldownSeconds ?? 0,
    description: rule.description ?? "",
    executionMode: rule.executionMode ?? "first_match_stop",
    id: rule.id,
    name: rule.name,
    organizationUnitId: rule.organizationUnitId,
    priority: rule.priority ?? 100,
    status: rule.status ?? "active",
    triggerType: rule.triggerType ?? "ON_MESSAGE_RECEIVED",
  };
}

function parseConditionValue(operator: string, rawValue: string): unknown {
  const upperOp = operator.toUpperCase();
  const trimmed = rawValue.trim();

  if (["IS_EMPTY", "IS_NOT_EMPTY", "IS_NULL", "IS_NOT_NULL"].includes(upperOp)) {
    return undefined;
  }
  if (["IS_TRUE", "IS_FALSE"].includes(upperOp)) {
    return undefined;
  }
  if (
    [
      "GREATER_THAN",
      "GREATER_THAN_OR_EQUAL",
      "LESS_THAN",
      "LESS_THAN_OR_EQUAL",
      "NUMERIC_EQUALS",
    ].includes(upperOp)
  ) {
    const num = Number(trimmed);
    return Number.isNaN(num) ? trimmed : num;
  }
  if (["IN", "NOT_IN", "CONTAINS_ANY", "CONTAINS_ALL"].includes(upperOp)) {
    return trimmed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (trimmed.toLowerCase() === "true") return true;
  if (trimmed.toLowerCase() === "false") return false;

  return trimmed;
}

export function formDataToCreatePayload(formData: RuleFormData): CreateRulePayload {
  const conditions: RuleCondition[] = formData.conditions
    .filter((c) => c.field.trim().length > 0)
    .map((c) => {
      const parsedVal = parseConditionValue(c.operator, c.value);
      if (parsedVal === undefined) {
        return { field: c.field.trim(), operator: c.operator };
      }
      return { field: c.field.trim(), operator: c.operator, value: parsedVal };
    });

  const actions: RuleAction[] = formData.actions
    .filter((a) => a.actionType.trim().length > 0)
    .map((a) => {
      const upper = a.actionType.trim().toUpperCase();
      const params: Record<string, unknown> = {};

      switch (upper) {
        case "SEND_MESSAGE":
          if (a.textBody) params.textBody = a.textBody;
          if (a.caption) params.caption = a.caption;
          if (a.mediaUrl) params.mediaUrl = a.mediaUrl;
          break;
        case "ASSIGN_USER":
          params.userId = a.userId?.trim() ? a.userId.trim() : null;
          break;
        case "ASSIGN_ORGANIZATION_UNIT":
          params.unitId = a.unitId?.trim() ? a.unitId.trim() : null;
          break;
        case "CHANGE_CONVERSATION_STATUS":
          if (a.status) params.status = a.status;
          if (a.reason) params.reason = a.reason;
          break;
        case "ADD_CONTACT_TAG":
        case "REMOVE_CONTACT_TAG":
          if (a.tag) params.tag = a.tag.trim();
          break;
        case "SET_CONTACT_CUSTOM_ATTRIBUTE":
          if (a.customAttributeKey) params.key = a.customAttributeKey.trim();
          if (a.customAttributeValue !== undefined) params.value = a.customAttributeValue;
          break;
        case "SET_AUTOMATION_MODE":
          if (a.automationMode) params.mode = a.automationMode.toUpperCase();
          break;
        default:
          break;
      }

      return {
        actionType: upper,
        ...(Object.keys(params).length > 0 ? { parameters: params } : {}),
      };
    });

  const payload: {
    actions: readonly RuleAction[];
    channelAccountId?: string | null | undefined;
    conditions: readonly RuleCondition[];
    cooldownSeconds?: number | undefined;
    description?: string | null | undefined;
    executionMode?: string | undefined;
    name: string;
    organizationUnitId?: string | null | undefined;
    priority?: number | undefined;
    status?: string | undefined;
    triggerType: string;
  } = {
    actions,
    conditions,
    name: formData.name.trim(),
    triggerType: formData.triggerType,
  };

  if (formData.description.trim()) {
    payload.description = formData.description.trim();
  }
  if (formData.priority !== undefined) {
    payload.priority = Number(formData.priority) || 100;
  }
  if (formData.status) {
    payload.status = formData.status;
  }
  if (formData.executionMode) {
    payload.executionMode = formData.executionMode;
  }
  if (formData.cooldownSeconds !== undefined) {
    payload.cooldownSeconds = Number(formData.cooldownSeconds) || 0;
  }
  if (formData.channelAccountId) {
    payload.channelAccountId = formData.channelAccountId;
  }
  if (formData.organizationUnitId) {
    payload.organizationUnitId = formData.organizationUnitId;
  }

  return payload;
}

export function formDataToUpdatePayload(formData: RuleFormData): UpdateRulePayload {
  return formDataToCreatePayload(formData);
}

// Natural Sentence Preview Generator
export function generateRuleSentencePreview(
  formData: RuleFormData,
  lookup?: RulesLookupData,
): { actionsSentence: string; triggerSentence: string } {
  // Trigger part
  let triggerPart = "";
  switch (formData.triggerType) {
    case "ON_MESSAGE_RECEIVED":
      triggerPart = "un mensaje entra";
      break;
    case "ON_CONVERSATION_CREATED":
      triggerPart = "se crea una nueva conversación";
      break;
    case "ON_STATUS_CHANGED":
      triggerPart = "cambia el estado de una conversación";
      break;
    case "ON_CONVERSATION_UNASSIGNED":
      triggerPart = "una conversación queda sin asignar";
      break;
    case "ON_OUT_OF_BUSINESS_HOURS":
      triggerPart = "entra actividad fuera del horario de atención";
      break;
    default:
      triggerPart = `ocurre el evento ${formData.triggerType}`;
  }

  if (formData.channelAccountId && lookup?.channels?.[formData.channelAccountId]) {
    triggerPart += ` en el canal ${lookup.channels[formData.channelAccountId]}`;
  }

  if (formData.organizationUnitId && lookup?.units?.[formData.organizationUnitId]) {
    triggerPart += ` para la unidad ${lookup.units[formData.organizationUnitId]}`;
  }

  const conditionsParts: string[] = [];
  for (const c of formData.conditions) {
    if (!c.field.trim()) continue;
    const opLabel = operatorLabel(c.operator).toLowerCase();
    const valText = c.value ? ` "${c.value}"` : "";
    conditionsParts.push(`${c.field} ${opLabel}${valText}`);
  }

  let triggerSentence = `Cuando ${triggerPart}`;
  if (conditionsParts.length > 0) {
    triggerSentence += ` y ${conditionsParts.join(" y ")}`;
  }

  // Actions part
  const actionsParts: string[] = [];
  for (const a of formData.actions) {
    const upper = a.actionType.toUpperCase();
    switch (upper) {
      case "SEND_MESSAGE":
        actionsParts.push(`enviar mensaje "${a.textBody ? a.textBody.slice(0, 40) : "..."}"`);
        break;
      case "ASSIGN_USER": {
        const userName =
          a.userId && lookup?.users?.[a.userId] ? lookup.users[a.userId] : a.userId || "agente";
        actionsParts.push(`asignar al agente ${userName}`);
        break;
      }
      case "ASSIGN_ORGANIZATION_UNIT": {
        const unitName =
          a.unitId && lookup?.units?.[a.unitId] ? lookup.units[a.unitId] : a.unitId || "unidad";
        actionsParts.push(`asignar a la unidad ${unitName}`);
        break;
      }
      case "CHANGE_CONVERSATION_STATUS":
        actionsParts.push(`cambiar estado a "${a.status || "open"}"`);
        break;
      case "ADD_CONTACT_TAG":
        actionsParts.push(`agregar etiqueta "${a.tag || ""}"`);
        break;
      case "REMOVE_CONTACT_TAG":
        actionsParts.push(`remover etiqueta "${a.tag || ""}"`);
        break;
      case "SET_CONTACT_CUSTOM_ATTRIBUTE":
        actionsParts.push(
          `guardar atributo "${a.customAttributeKey || ""}" = "${a.customAttributeValue || ""}"`,
        );
        break;
      case "SET_AUTOMATION_MODE":
        actionsParts.push(`cambiar Automation Mode a ${a.automationMode || "AUTO"}`);
        break;
      default:
        actionsParts.push(`ejecutar acción ${a.actionType}`);
    }
  }

  const actionsSentence =
    actionsParts.length > 0 ? `Entonces ${actionsParts.join(" y ")}.` : "Entonces sin acciones.";

  return { actionsSentence, triggerSentence };
}

// REST Fetcher Methods
export async function fetchRules(
  apiBaseUrl: string,
  filter: RuleListFilter = {},
): Promise<readonly RuleItem[]> {
  const params = new URLSearchParams();
  if (filter.triggerType) params.set("triggerType", filter.triggerType);
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  if (filter.channelAccountId) params.set("channelAccountId", filter.channelAccountId);
  if (filter.organizationUnitId) params.set("organizationUnitId", filter.organizationUnitId);

  const url = `${apiBaseUrl}/api/v1/rules${params.toString() ? `?${params.toString()}` : ""}`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`Error al consultar reglas: ${response.status}`);
  }

  let items = (await response.json()) as readonly RuleItem[];
  if (filter.search && filter.search.trim().length > 0) {
    const searchLower = filter.search.trim().toLowerCase();
    items = items.filter(
      (r) =>
        r.name.toLowerCase().includes(searchLower) ||
        r.description?.toLowerCase().includes(searchLower),
    );
  }

  return items;
}

export async function fetchRuleDetail(apiBaseUrl: string, ruleId: string): Promise<RuleItem> {
  const url = `${apiBaseUrl}/api/v1/rules/${encodeURIComponent(ruleId)}`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`Error al consultar detalle de regla (${response.status})`);
  }

  return (await response.json()) as RuleItem;
}

export async function createRule(
  apiBaseUrl: string,
  payload: CreateRulePayload,
): Promise<RuleItem> {
  const url = `${apiBaseUrl}/api/v1/rules`;
  const response = await fetch(url, {
    body: JSON.stringify(payload),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const msg =
      errorBody && typeof errorBody === "object" && "message" in errorBody
        ? String(errorBody.message)
        : `Error al crear regla (${response.status})`;
    throw new Error(msg);
  }

  return (await response.json()) as RuleItem;
}

export async function updateRule(
  apiBaseUrl: string,
  ruleId: string,
  payload: UpdateRulePayload,
): Promise<RuleItem> {
  const url = `${apiBaseUrl}/api/v1/rules/${encodeURIComponent(ruleId)}`;
  const response = await fetch(url, {
    body: JSON.stringify(payload),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    method: "PUT",
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const msg =
      errorBody && typeof errorBody === "object" && "message" in errorBody
        ? String(errorBody.message)
        : `Error al actualizar regla (${response.status})`;
    throw new Error(msg);
  }

  return (await response.json()) as RuleItem;
}

export async function deleteRule(
  apiBaseUrl: string,
  ruleId: string,
): Promise<{ id: string; success: true }> {
  const url = `${apiBaseUrl}/api/v1/rules/${encodeURIComponent(ruleId)}`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(`Error al eliminar regla (${response.status})`);
  }

  return (await response.json()) as { id: string; success: true };
}

export async function toggleRuleStatus(
  apiBaseUrl: string,
  ruleId: string,
  currentStatus: string,
): Promise<RuleItem> {
  const newStatus = currentStatus === "active" ? "inactive" : "active";
  return updateRule(apiBaseUrl, ruleId, { status: newStatus });
}
