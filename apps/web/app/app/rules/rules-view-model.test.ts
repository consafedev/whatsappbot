import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actionTypeLabel,
  createRule,
  DEFAULT_FORM_DATA,
  deleteRule,
  executionModeLabel,
  fetchRuleDetail,
  fetchRules,
  formDataToCreatePayload,
  formDataToUpdatePayload,
  generateRuleSentencePreview,
  operatorLabel,
  type RuleFormData,
  type RuleItem,
  ruleToFormData,
  statusBadgeDetails,
  toggleRuleStatus,
  triggerLabel,
  updateRule,
} from "./rules-view-model";

describe("rules view model", () => {
  const mockRule: RuleItem = {
    actions: [
      {
        actionType: "SEND_MESSAGE",
        parameters: { textBody: "Hola! En breve te atenderemos." },
      },
      {
        actionType: "ASSIGN_USER",
        parameters: { userId: "user-123" },
      },
      {
        actionType: "SET_AUTOMATION_MODE",
        parameters: { mode: "ASSISTED" },
      },
    ],
    channelAccountId: "chan-1",
    conditions: [
      {
        field: "message.textBody",
        operator: "CONTAINS",
        value: "precio",
      },
      {
        field: "isWithinBusinessHours",
        operator: "IS_TRUE",
      },
      {
        field: "contact.tags",
        operator: "IN",
        value: ["vip", "lead"],
      },
    ],
    cooldownSeconds: 60,
    createdAt: "2026-08-25T12:00:00.000Z",
    description: "Responder con catálogo y asignar agente en horario hábil",
    executionMode: "first_match_stop",
    id: "rule-1",
    name: "Respuesta de precios y asignación",
    organizationUnitId: "unit-1",
    priority: 10,
    status: "active",
    tenantId: "tenant-1",
    triggerType: "ON_MESSAGE_RECEIVED",
    updatedAt: "2026-08-25T12:00:00.000Z",
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("API Service Functions", () => {
    it("fetchRules builds correct query parameters and filters in-memory search", async () => {
      const mockRules: RuleItem[] = [
        mockRule,
        {
          ...mockRule,
          description: "Segunda regla de bienvenida",
          id: "rule-2",
          name: "Bienvenida inicial",
        },
      ];

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockRules,
        ok: true,
        status: 200,
      });

      const result = await fetchRules("http://api.local", {
        channelAccountId: "chan-1",
        organizationUnitId: "unit-1",
        search: "bienvenida",
        status: "active",
        triggerType: "ON_MESSAGE_RECEIVED",
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://api.local/api/v1/rules?triggerType=ON_MESSAGE_RECEIVED&status=active&channelAccountId=chan-1&organizationUnitId=unit-1",
        expect.objectContaining({ credentials: "include", method: "GET" }),
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("rule-2");
    });

    it("fetchRules ignores 'all' status in query params", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => [mockRule],
        ok: true,
        status: 200,
      });

      await fetchRules("http://api.local", { status: "all" });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://api.local/api/v1/rules",
        expect.objectContaining({ credentials: "include", method: "GET" }),
      );
    });

    it("fetchRules throws on HTTP failure", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(fetchRules("http://api.local")).rejects.toThrow(
        "Error al consultar reglas: 500",
      );
    });

    it("fetchRuleDetail retrieves single rule item", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockRule,
        ok: true,
        status: 200,
      });

      const result = await fetchRuleDetail("http://api.local", "rule-1");

      expect(result).toEqual(mockRule);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://api.local/api/v1/rules/rule-1",
        expect.objectContaining({ credentials: "include", method: "GET" }),
      );
    });

    it("fetchRuleDetail throws on not found or forbidden", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(fetchRuleDetail("http://api.local", "rule-999")).rejects.toThrow(
        "Error al consultar detalle de regla (404)",
      );
    });

    it("createRule posts structured payload and returns created rule", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => mockRule,
        ok: true,
        status: 201,
      });

      const payload = {
        actions: mockRule.actions,
        conditions: mockRule.conditions,
        name: "Nueva regla",
        triggerType: "ON_MESSAGE_RECEIVED",
      };

      const result = await createRule("http://api.local", payload);

      expect(result).toEqual(mockRule);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://api.local/api/v1/rules",
        expect.objectContaining({
          body: JSON.stringify(payload),
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          method: "POST",
        }),
      );
    });

    it("createRule extracts backend validation error message on 400", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => ({ message: "Rule actions cannot be empty" }),
        ok: false,
        status: 400,
      });

      await expect(
        createRule("http://api.local", {
          actions: [],
          conditions: [],
          name: "Test",
          triggerType: "ON_MESSAGE_RECEIVED",
        }),
      ).rejects.toThrow("Rule actions cannot be empty");
    });

    it("updateRule sends PUT request with updated payload", async () => {
      const updatedRule = { ...mockRule, name: "Nombre actualizado" };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => updatedRule,
        ok: true,
        status: 200,
      });

      const result = await updateRule("http://api.local", "rule-1", {
        name: "Nombre actualizado",
      });

      expect(result).toEqual(updatedRule);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://api.local/api/v1/rules/rule-1",
        expect.objectContaining({
          body: JSON.stringify({ name: "Nombre actualizado" }),
          credentials: "include",
          method: "PUT",
        }),
      );
    });

    it("deleteRule sends DELETE request", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => ({ id: "rule-1", success: true }),
        ok: true,
        status: 200,
      });

      const result = await deleteRule("http://api.local", "rule-1");

      expect(result).toEqual({ id: "rule-1", success: true });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://api.local/api/v1/rules/rule-1",
        expect.objectContaining({ credentials: "include", method: "DELETE" }),
      );
    });

    it("toggleRuleStatus switches active to inactive and vice-versa", async () => {
      const inactiveRule = { ...mockRule, status: "inactive" };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => inactiveRule,
        ok: true,
        status: 200,
      });

      const result1 = await toggleRuleStatus("http://api.local", "rule-1", "active");
      expect(result1.status).toBe("inactive");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://api.local/api/v1/rules/rule-1",
        expect.objectContaining({
          body: JSON.stringify({ status: "inactive" }),
          method: "PUT",
        }),
      );

      const activeRule = { ...mockRule, status: "active" };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => activeRule,
        ok: true,
        status: 200,
      });

      const result2 = await toggleRuleStatus("http://api.local", "rule-1", "inactive");
      expect(result2.status).toBe("active");
    });
  });

  describe("Serialization & Form Conversion", () => {
    it("ruleToFormData converts complex rule to editable form data", () => {
      const formData = ruleToFormData(mockRule);

      expect(formData.id).toBe("rule-1");
      expect(formData.name).toBe("Respuesta de precios y asignación");
      expect(formData.description).toBe("Responder con catálogo y asignar agente en horario hábil");
      expect(formData.triggerType).toBe("ON_MESSAGE_RECEIVED");
      expect(formData.priority).toBe(10);
      expect(formData.cooldownSeconds).toBe(60);
      expect(formData.channelAccountId).toBe("chan-1");
      expect(formData.organizationUnitId).toBe("unit-1");

      expect(formData.conditions).toHaveLength(3);
      expect(formData.conditions[0]).toEqual({
        field: "message.textBody",
        operator: "CONTAINS",
        value: "precio",
      });
      expect(formData.conditions[1]).toEqual({
        field: "isWithinBusinessHours",
        operator: "IS_TRUE",
        value: "",
      });
      expect(formData.conditions[2]).toEqual({
        field: "contact.tags",
        operator: "IN",
        value: "vip, lead",
      });

      expect(formData.actions).toHaveLength(3);
      expect(formData.actions[0]).toEqual({
        actionType: "SEND_MESSAGE",
        textBody: "Hola! En breve te atenderemos.",
      });
      expect(formData.actions[1]).toEqual({
        actionType: "ASSIGN_USER",
        userId: "user-123",
      });
      expect(formData.actions[2]).toEqual({
        actionType: "SET_AUTOMATION_MODE",
        automationMode: "ASSISTED",
      });
    });

    it("ruleToFormData provides fallback defaults when conditions or actions are empty", () => {
      const emptyRule: RuleItem = {
        ...mockRule,
        actions: [],
        conditions: [],
        description: null,
      };

      const formData = ruleToFormData(emptyRule);
      expect(formData.description).toBe("");
      expect(formData.conditions).toEqual(DEFAULT_FORM_DATA.conditions);
      expect(formData.actions).toEqual(DEFAULT_FORM_DATA.actions);
    });

    it("formDataToCreatePayload parses condition operators and values correctly", () => {
      const formData: RuleFormData = {
        actions: [
          { actionType: "SEND_MESSAGE", textBody: "Hola!" },
          { actionType: "ASSIGN_ORGANIZATION_UNIT", unitId: "unit-5" },
          { actionType: "CHANGE_CONVERSATION_STATUS", reason: "Auto-cierre", status: "closed" },
          { actionType: "ADD_CONTACT_TAG", tag: "interesado" },
          {
            actionType: "SET_CONTACT_CUSTOM_ATTRIBUTE",
            customAttributeKey: "plan",
            customAttributeValue: "pro",
          },
        ],
        channelAccountId: "chan-1",
        conditions: [
          { field: "message.textBody", operator: "CONTAINS", value: "hola" },
          { field: "contact.tags", operator: "IN", value: "tag1, tag2, tag3" },
          { field: "conversation.unreadCount", operator: "GREATER_THAN", value: "5" },
          { field: "isWithinBusinessHours", operator: "IS_TRUE", value: "" },
          { field: "contact.phoneNumber", operator: "IS_NOT_EMPTY", value: "" },
        ],
        cooldownSeconds: 30,
        description: "Regla completa",
        executionMode: "first_match_stop",
        name: "Regla prueba",
        organizationUnitId: null,
        priority: 50,
        status: "active",
        triggerType: "ON_MESSAGE_RECEIVED",
      };

      const payload = formDataToCreatePayload(formData);

      expect(payload.name).toBe("Regla prueba");
      expect(payload.description).toBe("Regla completa");
      expect(payload.priority).toBe(50);
      expect(payload.cooldownSeconds).toBe(30);
      expect(payload.channelAccountId).toBe("chan-1");
      expect(payload.organizationUnitId).toBeUndefined();

      expect(payload.conditions).toEqual([
        { field: "message.textBody", operator: "CONTAINS", value: "hola" },
        { field: "contact.tags", operator: "IN", value: ["tag1", "tag2", "tag3"] },
        { field: "conversation.unreadCount", operator: "GREATER_THAN", value: 5 },
        { field: "isWithinBusinessHours", operator: "IS_TRUE" },
        { field: "contact.phoneNumber", operator: "IS_NOT_EMPTY" },
      ]);

      expect(payload.actions).toEqual([
        { actionType: "SEND_MESSAGE", parameters: { textBody: "Hola!" } },
        { actionType: "ASSIGN_ORGANIZATION_UNIT", parameters: { unitId: "unit-5" } },
        {
          actionType: "CHANGE_CONVERSATION_STATUS",
          parameters: { status: "closed", reason: "Auto-cierre" },
        },
        { actionType: "ADD_CONTACT_TAG", parameters: { tag: "interesado" } },
        {
          actionType: "SET_CONTACT_CUSTOM_ATTRIBUTE",
          parameters: { key: "plan", value: "pro" },
        },
      ]);
    });

    it("formDataToUpdatePayload returns create payload equivalent", () => {
      const formData = ruleToFormData(mockRule);
      const updatePayload = formDataToUpdatePayload(formData);
      expect(updatePayload.name).toBe(mockRule.name);
    });
  });

  describe("Natural Sentence Generator", () => {
    it("generateRuleSentencePreview builds readable Spanish summary with lookups", () => {
      const formData = ruleToFormData(mockRule);
      const lookups = {
        channels: { "chan-1": "WhatsApp Ventas" },
        units: { "unit-1": "Ventas León" },
        users: { "user-123": "Carlos Agente" },
      };

      const preview = generateRuleSentencePreview(formData, lookups);

      expect(preview.triggerSentence).toContain(
        "Cuando un mensaje entra en el canal WhatsApp Ventas para la unidad Ventas León",
      );
      expect(preview.triggerSentence).toContain('message.textBody contiene "precio"');
      expect(preview.actionsSentence).toContain(
        'Entonces enviar mensaje "Hola! En breve te atenderemos."',
      );
      expect(preview.actionsSentence).toContain("asignar al agente Carlos Agente");
      expect(preview.actionsSentence).toContain("cambiar Automation Mode a ASSISTED.");
    });

    it("generateRuleSentencePreview handles fallback when lookups are missing", () => {
      const formData: RuleFormData = {
        ...DEFAULT_FORM_DATA,
        actions: [{ actionType: "ASSIGN_USER", userId: "user-unknown" }],
        conditions: [],
        name: "Sin lookups",
        triggerType: "ON_OUT_OF_BUSINESS_HOURS",
      };

      const preview = generateRuleSentencePreview(formData);

      expect(preview.triggerSentence).toBe("Cuando entra actividad fuera del horario de atención");
      expect(preview.actionsSentence).toBe("Entonces asignar al agente user-unknown.");
    });
  });

  describe("Helpers and Label Formatters", () => {
    it("triggerLabel translates all canonical trigger types", () => {
      expect(triggerLabel("ON_MESSAGE_RECEIVED")).toBe("Mensaje entrante");
      expect(triggerLabel("ON_CONVERSATION_CREATED")).toBe("Conversación creada");
      expect(triggerLabel("ON_STATUS_CHANGED")).toBe("Cambio de estado");
      expect(triggerLabel("ON_CONVERSATION_UNASSIGNED")).toBe("Conversación no asignada");
      expect(triggerLabel("ON_OUT_OF_BUSINESS_HOURS")).toBe("Fuera de horario de atención");
      expect(triggerLabel("CUSTOM_TRIGGER")).toBe("CUSTOM_TRIGGER");
    });

    it("operatorLabel translates operators", () => {
      expect(operatorLabel("EQUALS")).toBe("Igual a");
      expect(operatorLabel("MATCHES_REGEX")).toBe("Coincide con RegEx");
      expect(operatorLabel("IS_EMPTY")).toBe("Está vacío");
    });

    it("actionTypeLabel translates actions", () => {
      expect(actionTypeLabel("SEND_MESSAGE")).toBe("Enviar mensaje de respuesta");
      expect(actionTypeLabel("ASSIGN_USER")).toBe("Asignar a agente");
      expect(actionTypeLabel("SET_AUTOMATION_MODE")).toBe("Cambiar modo de automatización");
    });

    it("executionModeLabel translates execution modes", () => {
      expect(executionModeLabel("first_match_stop")).toContain("Detener tras primera coincidencia");
      expect(executionModeLabel("evaluate_all")).toContain("Evaluar todas las reglas");
    });

    it("statusBadgeDetails provides correct css class and Spanish text", () => {
      expect(statusBadgeDetails("active")).toEqual({
        className: "badge--success",
        label: "Activa",
      });
      expect(statusBadgeDetails("inactive")).toEqual({
        className: "badge--neutral",
        label: "Pausada",
      });
      expect(statusBadgeDetails("draft")).toEqual({ className: "badge--warn", label: "Borrador" });
      expect(statusBadgeDetails("archived")).toEqual({
        className: "badge--outline",
        label: "archived",
      });
    });
  });
});
