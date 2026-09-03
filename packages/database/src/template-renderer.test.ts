import { describe, expect, it } from "vitest";
import { extractTemplateVariables, renderTemplate } from "./template-renderer";

describe("template-renderer", () => {
  describe("renderTemplate", () => {
    it("substitutes multiple exact variable tags", () => {
      const template = "Hola {{nombre}}, tu pedido {{pedido}} está listo para entrega.";
      const variables = { nombre: "Carlos", pedido: "PED-9821" };

      const result = renderTemplate(template, variables);
      expect(result).toBe("Hola Carlos, tu pedido PED-9821 está listo para entrega.");
    });

    it("handles whitespace inside tags cleanly", () => {
      const template = "Estimado/a {{  nombre  }}, tu código es {{   codigo_mfa }}.";
      const variables = { nombre: "María", codigo_mfa: "123456" };

      const result = renderTemplate(template, variables);
      expect(result).toBe("Estimado/a María, tu código es 123456.");
    });

    it("handles numeric values correctly", () => {
      const template = "Tienes {{puntos}} puntos acumulados. Total: " + "$" + "{{monto}}.";
      const variables = { puntos: 150, monto: 49.99 };

      const result = renderTemplate(template, variables);
      expect(result).toBe("Tienes 150 puntos acumulados. Total: $49.99.");
    });

    it("replaces missing or null variables with empty string", () => {
      const template = "Hola {{nombre}}, tu saldo es {{saldo}} y vence el {{fecha}}.";
      const variables = { nombre: "Juan", saldo: null };

      const result = renderTemplate(template, variables);
      expect(result).toBe("Hola Juan, tu saldo es  y vence el .");
    });

    it("returns unchanged text when there are no template tags", () => {
      const template = "Bienvenido a nuestro canal oficial de soporte.";
      const result = renderTemplate(template, { foo: "bar" });
      expect(result).toBe("Bienvenido a nuestro canal oficial de soporte.");
    });

    it("returns empty string on empty template input", () => {
      expect(renderTemplate("", { nombre: "Juan" })).toBe("");
    });
  });

  describe("extractTemplateVariables", () => {
    it("extracts unique variable names from template text", () => {
      const template =
        "Hola {{nombre}}, gracias por tu compra {{pedido}}. Recuerda tu orden {{pedido}}.";
      const vars = extractTemplateVariables(template);
      expect(vars).toEqual(["nombre", "pedido"]);
    });

    it("returns empty array when text has no tags", () => {
      expect(extractTemplateVariables("Texto plano sin variables")).toEqual([]);
      expect(extractTemplateVariables("")).toEqual([]);
    });
  });
});
