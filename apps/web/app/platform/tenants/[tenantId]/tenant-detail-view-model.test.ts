import { describe, expect, it } from "vitest";
import {
  deferredStateForStatus,
  detailStateForStatus,
  displayLimit,
  TENANT_DETAIL_TABS,
} from "./tenant-detail-view-model";

describe("tenant detail view model", () => {
  it("defines the exact eight read-only story tabs", () => {
    expect(TENANT_DETAIL_TABS).toEqual([
      "General",
      "Módulos",
      "Usuarios",
      "Canales",
      "Deployment",
      "Uso",
      "Auditoría",
      "Backup",
    ]);
  });

  it("distinguishes loaded, 401, 404 and error detail states", () => {
    expect(detailStateForStatus(200)).toBe("loaded");
    expect(detailStateForStatus(401)).toBe("unauthorized");
    expect(detailStateForStatus(404)).toBe("not-found");
    expect(detailStateForStatus(500)).toBe("error");
  });

  it("distinguishes empty and loaded deferred collections", () => {
    expect(deferredStateForStatus(200, 0)).toBe("empty");
    expect(deferredStateForStatus(200, 1)).toBe("loaded");
    expect(deferredStateForStatus(401, 0)).toBe("unauthorized");
    expect(deferredStateForStatus(404, 0)).toBe("not-found");
  });

  it("does not render a missing limit as zero", () => {
    expect(displayLimit(null)).toBe("No configurado");
    expect(displayLimit("0.0000")).toBe("0.0000");
  });
});
