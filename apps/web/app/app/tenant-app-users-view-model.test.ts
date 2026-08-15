import { describe, expect, it } from "vitest";
import { assignmentKey, groupPermissionCatalog } from "./tenant-app-users-view-model";

describe("tenant user management view model", () => {
  it("groups the canonical permission catalog by its real key prefix", () => {
    expect(
      groupPermissionCatalog([
        { description: "Manage users", key: "tenant.users.manage" },
        { description: "Read conversations", key: "conversations.read" },
        { description: "Manage channels", key: "channels.manage" },
      ]),
    ).toEqual([
      {
        id: "tenant",
        items: [{ description: "Manage users", key: "tenant.users.manage" }],
        label: "Workspace",
      },
      {
        id: "conversations",
        items: [{ description: "Read conversations", key: "conversations.read" }],
        label: "Conversaciones",
      },
      {
        id: "channels",
        items: [{ description: "Manage channels", key: "channels.manage" }],
        label: "Canales",
      },
    ]);
  });

  it("distinguishes tenant-wide and organization-unit assignments", () => {
    expect(assignmentKey("role-1", null)).not.toBe(assignmentKey("role-1", "unit-1"));
  });
});
