import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveContact,
  ContactApiError,
  createContact,
  fetchContactDetail,
  fetchContacts,
  formatTagsOutput,
  parseTagsInput,
  updateContact,
} from "./contacts-view-model";

describe("contacts-view-model", () => {
  describe("parseTagsInput", () => {
    it("returns empty array for empty or null string", () => {
      expect(parseTagsInput("")).toEqual([]);
      expect(parseTagsInput(null)).toEqual([]);
      expect(parseTagsInput(undefined)).toEqual([]);
    });

    it("parses comma-separated tags, trims and converts to lowercase", () => {
      const input = "  VIP, Cliente-Frecuente,  promo2026  ";
      expect(parseTagsInput(input)).toEqual(["vip", "cliente-frecuente", "promo2026"]);
    });

    it("eliminates duplicates and empty tokens", () => {
      const input = "vip, VIP, vip, , , nuevo";
      expect(parseTagsInput(input)).toEqual(["vip", "nuevo"]);
    });

    it("handles newline separated values", () => {
      const input = "lead\ncliente\nlead";
      expect(parseTagsInput(input)).toEqual(["lead", "cliente"]);
    });
  });

  describe("formatTagsOutput", () => {
    it("returns empty string for null, undefined or empty array", () => {
      expect(formatTagsOutput([])).toBe("");
      expect(formatTagsOutput(null)).toBe("");
      expect(formatTagsOutput(undefined)).toBe("");
    });

    it("joins tags with comma and space", () => {
      expect(formatTagsOutput(["vip", "cliente"])).toBe("vip, cliente");
    });
  });

  describe("REST client functions", () => {
    const originalFetch = globalThis.fetch;
    const base = "http://localhost:3001";

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("fetchContacts calls GET /api/v1/contacts with correct query params", async () => {
      const mockResponse = {
        items: [
          {
            id: "cnt-1",
            name: "Juan Pérez",
            phoneNumber: "+5215551234567",
            status: "ACTIVE",
            tags: ["vip"],
            createdAt: "2026-09-08T00:00:00Z",
            updatedAt: "2026-09-08T00:00:00Z",
          },
        ],
        total: 1,
        limit: 25,
        page: 1,
      };

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const res = await fetchContacts(base, { search: "Juan", tag: "vip", page: 1, limit: 25 });
      expect(res.items).toHaveLength(1);
      expect(res.total).toBe(1);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/api/v1/contacts?search=Juan&tag=vip&limit=25&page=1",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("fetchContactDetail calls GET /api/v1/contacts/:id", async () => {
      const mockContact = {
        id: "cnt-1",
        name: "Juan Pérez",
        phoneNumber: "+5215551234567",
        status: "ACTIVE",
        tags: ["vip"],
        createdAt: "2026-09-08T00:00:00Z",
        updatedAt: "2026-09-08T00:00:00Z",
      };

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockContact,
      });

      const contact = await fetchContactDetail(base, "cnt-1");
      expect(contact.id).toBe("cnt-1");
      expect(contact.name).toBe("Juan Pérez");
    });

    it("createContact calls POST /api/v1/contacts with body", async () => {
      const mockContact = {
        id: "cnt-2",
        name: "María López",
        phoneNumber: "+5215559876543",
        status: "ACTIVE",
        tags: ["nuevo"],
        createdAt: "2026-09-08T00:00:00Z",
        updatedAt: "2026-09-08T00:00:00Z",
      };

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockContact,
      });

      const payload = {
        name: "María López",
        phoneNumber: "+5215559876543",
        tags: ["nuevo"],
      };

      const res = await createContact(base, payload);
      expect(res.id).toBe("cnt-2");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/api/v1/contacts",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(payload),
        }),
      );
    });

    it("updateContact calls PATCH /api/v1/contacts/:id with body", async () => {
      const mockUpdated = {
        id: "cnt-1",
        name: "Juan Pérez Modificado",
        phoneNumber: "+5215551234567",
        status: "ACTIVE",
        tags: ["vip", "actualizado"],
        createdAt: "2026-09-08T00:00:00Z",
        updatedAt: "2026-09-08T00:00:00Z",
      };

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockUpdated,
      });

      const res = await updateContact(base, "cnt-1", { name: "Juan Pérez Modificado" });
      expect(res.name).toBe("Juan Pérez Modificado");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/api/v1/contacts/cnt-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ name: "Juan Pérez Modificado" }),
        }),
      );
    });

    it("archiveContact calls DELETE /api/v1/contacts/:id", async () => {
      const mockArchived = {
        id: "cnt-1",
        name: "Juan Pérez",
        phoneNumber: "+5215551234567",
        status: "ARCHIVED",
        tags: ["vip"],
        createdAt: "2026-09-08T00:00:00Z",
        updatedAt: "2026-09-08T00:00:00Z",
      };

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockArchived,
      });

      const res = await archiveContact(base, "cnt-1");
      expect(res.status).toBe("ARCHIVED");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/api/v1/contacts/cnt-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("throws ContactApiError on non-ok HTTP response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          code: "CONTACT_PHONE_CONFLICT",
          message: "A contact already uses this phone number",
        }),
      });

      await expect(
        createContact(base, { name: "Test", phoneNumber: "+5215551234567" }),
      ).rejects.toThrow(ContactApiError);
    });
  });
});
