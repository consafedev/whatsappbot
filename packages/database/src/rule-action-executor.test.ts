import { describe, expect, it } from "vitest";
import {
  interpolateTemplate,
  RULE_ACTION_TYPES,
  RuleActionChannelInactiveError,
  RuleActionContactNotFoundError,
  RuleActionConversationNotFoundError,
  RuleActionConversationNotWritableError,
  RuleActionExecutionError,
  RuleActionInvalidStateTransitionError,
  RuleActionOrganizationUnitNotFoundError,
  RuleActionUserNotFoundError,
} from "./rule-action-executor";
import type { RuleEvaluationContext } from "./rule-condition-evaluator";

describe("RuleActionExecutor — Unit Tests", () => {
  describe("RULE_ACTION_TYPES catalog", () => {
    it("exports all 8 canonical action types", () => {
      expect(RULE_ACTION_TYPES).toEqual([
        "SEND_MESSAGE",
        "ASSIGN_USER",
        "ASSIGN_ORGANIZATION_UNIT",
        "CHANGE_CONVERSATION_STATUS",
        "ADD_CONTACT_TAG",
        "REMOVE_CONTACT_TAG",
        "SET_CONTACT_CUSTOM_ATTRIBUTE",
        "SET_AUTOMATION_MODE",
      ]);
    });
  });

  describe("interpolateTemplate", () => {
    const sampleContext: RuleEvaluationContext = {
      channel: {
        channelAccountId: "019532bb-9543-7f2a-89a3-c59828d54231",
        providerType: "whatsapp_cloud",
      },
      contact: {
        customAttributes: {
          accountId: 98765,
          isVIP: true,
          planTier: "enterprise",
          preferences: { language: "es", notifications: true },
        },
        name: "Maria Garcia",
        phoneNumber: "+15551234567",
        tags: ["vip", "b2b"],
      },
      conversation: {
        assignedUnitId: "019532bb-9543-7f2a-89a3-c59828d54233",
        assignedUserId: "019532bb-9543-7f2a-89a3-c59828d54232",
        status: "open",
        unreadCount: 3,
      },
      message: {
        direction: "inbound",
        mediaType: "image",
        origin: "whatsapp",
        textBody: "Hola, necesito soporte con mi plan enterprise.",
      },
    };

    it("returns empty string when template is null, undefined or empty", () => {
      expect(interpolateTemplate(null, sampleContext)).toBe("");
      expect(interpolateTemplate(undefined, sampleContext)).toBe("");
      expect(interpolateTemplate("", sampleContext)).toBe("");
    });

    it("interpolates simple string fields", () => {
      const template = "Hola {{contact.name}}, bienvenido a nuestro soporte.";
      expect(interpolateTemplate(template, sampleContext)).toBe(
        "Hola Maria Garcia, bienvenido a nuestro soporte.",
      );
    });

    it("interpolates multiple placeholders in the same template", () => {
      const template =
        "Hola {{contact.name}} ({{contact.phoneNumber}}), su conversación está {{conversation.status}} en el canal {{channel.providerType}}.";
      expect(interpolateTemplate(template, sampleContext)).toBe(
        "Hola Maria Garcia (+15551234567), su conversación está open en el canal whatsapp_cloud.",
      );
    });

    it("interpolates nested customAttributes paths", () => {
      const template = "Plan detectado: {{contact.customAttributes.planTier}}.";
      expect(interpolateTemplate(template, sampleContext)).toBe("Plan detectado: enterprise.");
    });

    it("interpolates numeric and boolean values cleanly", () => {
      const template =
        "Mensajes sin leer: {{conversation.unreadCount}}, VIP: {{contact.customAttributes.isVIP}}, Cuenta: {{contact.customAttributes.accountId}}.";
      expect(interpolateTemplate(template, sampleContext)).toBe(
        "Mensajes sin leer: 3, VIP: true, Cuenta: 98765.",
      );
    });

    it("interpolates nested objects as JSON strings", () => {
      const template = "Preferencias: {{contact.customAttributes.preferences}}";
      expect(interpolateTemplate(template, sampleContext)).toBe(
        'Preferencias: {"language":"es","notifications":true}',
      );
    });

    it("replaces non-existent or null/undefined paths with empty strings without throwing", () => {
      const template =
        "Hola {{contact.name}}, su saldo es {{contact.nonExistent}} y su asesor es {{user.name}}.";
      expect(interpolateTemplate(template, sampleContext)).toBe(
        "Hola Maria Garcia, su saldo es  y su asesor es .",
      );
    });

    it("handles whitespace within placeholder braces gracefully", () => {
      const template = "Hola {{  contact.name   }}, plan: {{ contact.customAttributes.planTier }}";
      expect(interpolateTemplate(template, sampleContext)).toBe(
        "Hola Maria Garcia, plan: enterprise",
      );
    });

    it("leaves text without placeholders untouched", () => {
      const template = "Mensaje estático sin variables.";
      expect(interpolateTemplate(template, sampleContext)).toBe("Mensaje estático sin variables.");
    });
  });

  describe("Error Classes", () => {
    it("instantiates custom error classes with correct names and inheritance", () => {
      const execErr = new RuleActionExecutionError("generic error");
      expect(execErr).toBeInstanceOf(Error);
      expect(execErr.name).toBe("RuleActionExecutionError");

      const convErr = new RuleActionConversationNotFoundError();
      expect(convErr).toBeInstanceOf(RuleActionExecutionError);
      expect(convErr.name).toBe("RuleActionConversationNotFoundError");

      const notWritable = new RuleActionConversationNotWritableError();
      expect(notWritable).toBeInstanceOf(RuleActionExecutionError);
      expect(notWritable.name).toBe("RuleActionConversationNotWritableError");

      const channelErr = new RuleActionChannelInactiveError();
      expect(channelErr).toBeInstanceOf(RuleActionExecutionError);
      expect(channelErr.name).toBe("RuleActionChannelInactiveError");

      const contactErr = new RuleActionContactNotFoundError();
      expect(contactErr).toBeInstanceOf(RuleActionExecutionError);
      expect(contactErr.name).toBe("RuleActionContactNotFoundError");

      const userErr = new RuleActionUserNotFoundError();
      expect(userErr).toBeInstanceOf(RuleActionExecutionError);
      expect(userErr.name).toBe("RuleActionUserNotFoundError");

      const ouErr = new RuleActionOrganizationUnitNotFoundError();
      expect(ouErr).toBeInstanceOf(RuleActionExecutionError);
      expect(ouErr.name).toBe("RuleActionOrganizationUnitNotFoundError");

      const transitionErr = new RuleActionInvalidStateTransitionError("closed", "pending");
      expect(transitionErr).toBeInstanceOf(RuleActionExecutionError);
      expect(transitionErr.name).toBe("RuleActionInvalidStateTransitionError");
      expect(transitionErr.previousStatus).toBe("closed");
      expect(transitionErr.newStatus).toBe("pending");
    });
  });
});
