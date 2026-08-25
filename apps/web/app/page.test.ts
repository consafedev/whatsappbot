import { describe, expect, it } from "vitest";
import { portalCards, resolvePortalAccess } from "./root-portal-view-model";

describe("root portal gateway", () => {
  it("exposes the three canonical navigation destinations", () => {
    expect(portalCards.map((card) => card.href)).toEqual([
      "/app/inbox",
      "/app",
      "/platform/tenants",
    ]);
    expect(portalCards.map((card) => card.title)).toEqual([
      "Consola de Operador",
      "Portal del Inquilino",
      "Plataforma Super Admin",
    ]);
    expect(portalCards[0]?.badge).toBe("Principal / Milestone A");
  });

  it("keeps post-login destinations on the local allowlist", () => {
    expect(resolvePortalAccess({ access: "platform", next: "https://evil.example" })).toEqual({
      audience: "platform",
      destination: "/platform/tenants",
    });
    expect(resolvePortalAccess({ access: "tenant", next: "/app" })).toEqual({
      audience: "tenant",
      destination: "/app",
    });
    expect(resolvePortalAccess({ access: "tenant", next: "//evil.example" })).toEqual({
      audience: "tenant",
      destination: "/app/inbox",
    });
  });
});
