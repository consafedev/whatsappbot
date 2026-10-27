import { describe, expect, it } from "vitest";
import { loadContactConversations, resolveAssociationPatch } from "./appointment-form-model";

describe("resolveAssociationPatch", () => {
  it("preserves an association when its field is hidden by permissions", () => {
    expect(resolveAssociationPatch("unit-1", false, "")).toBe("unit-1");
  });

  it("allows an editable field to clear or replace an association", () => {
    expect(resolveAssociationPatch("unit-1", true, "")).toBeNull();
    expect(resolveAssociationPatch("unit-1", true, "unit-2")).toBe("unit-2");
  });
});

describe("loadContactConversations", () => {
  it("uses the API page bound, follows cursors, and filters every page to the selected contact", async () => {
    const requests: Array<{ limit: 50; cursor?: string }> = [];
    const fetchPage = async (query: { limit: 50; cursor?: string }) => {
      requests.push(query);
      return query.cursor
        ? {
            items: [
              { id: "selected-2", contactId: "contact-1" },
              { id: "foreign-2", contactId: "contact-2" },
            ],
          }
        : {
            items: [
              { id: "selected-1", contactId: "contact-1" },
              { id: "foreign-1", contactId: "contact-2" },
            ],
            nextCursor: "page-2",
          };
    };

    const result = await loadContactConversations(fetchPage, "contact-1");

    expect(requests).toEqual([{ limit: 50 }, { limit: 50, cursor: "page-2" }]);
    expect(result.map(({ id }) => id)).toEqual(["selected-1", "selected-2"]);
  });
});
