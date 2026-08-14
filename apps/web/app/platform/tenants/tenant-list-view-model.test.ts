import { describe, expect, it } from "vitest";
import {
  channelCountLabel,
  formatObservedActivity,
  moduleLabel,
  requestStateForResponse,
} from "./tenant-list-view-model";

describe("platform tenant list view model", () => {
  it("maps loaded, empty, unauthorized, and error states without fallback fixtures", () => {
    const item = {
      channelCount: null,
      deployment: null,
      displayName: "Tenant real",
      enabledModules: ["module.messaging.basic"],
      id: "019c0000-0000-7000-8000-000000000001",
      lastActivityAt: null,
      legalName: "Tenant Real SA",
      slug: "tenant-real",
      status: "active" as const,
      userCount: 2,
    };
    expect(requestStateForResponse(200, [item])).toBe("loaded");
    expect(requestStateForResponse(200, [])).toBe("empty");
    expect(requestStateForResponse(401)).toBe("unauthorized");
    expect(requestStateForResponse(503)).toBe("error");
  });

  it("renders unavailable channel/activity values as an em dash", () => {
    expect(channelCountLabel(null)).toBe("—");
    expect(formatObservedActivity(null)).toBe("—");
  });

  it("uses explicit module labels and preserves unknown canonical keys", () => {
    expect(moduleLabel("module.messaging.basic")).toBe("Messaging");
    expect(moduleLabel("module.future.safe_key")).toBe("module.future.safe_key");
  });
});
