import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppointmentApiError,
  type CreateAppointmentInput,
  createAppointmentsApi,
  getAppointmentCapabilities,
} from "./appointments-view-model";

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("appointments API client", () => {
  it("unwraps and validates the standard envelope, preserving decimal strings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          items: [{ id: "svc-1", price: "125.50", name: "Consulta" }],
          total: 1,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createAppointmentsApi("https://api.example/").services.list({
      active: true,
      search: "consulta & valoración",
      limit: 20,
      offset: 40,
    });

    expect(result.items[0]?.price).toBe("125.50");
    expect(new URL(fetchMock.mock.calls[0]?.[0] as string).searchParams.get("search")).toBe(
      "consulta & valoración",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example/api/v1/appointments/services?active=true&search=consulta+%26+valoraci%C3%B3n&limit=20&offset=40",
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );
  });

  it.each([401, 403, 404, 409])("preserves server errors for HTTP %i", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ code: "APPOINTMENT_CONFLICT", message: "Reservation changed" }, status),
        ),
    );

    await expect(createAppointmentsApi("https://api.example").get("a/b")).rejects.toMatchObject({
      name: "AppointmentApiError",
      statusCode: status,
      code: "APPOINTMENT_CONFLICT",
      message: "Reservation changed",
    });
  });

  it("rejects a malformed success envelope and malformed page data", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, data: { items: [], total: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { items: "bad", total: 0 } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createAppointmentsApi("https://api.example");

    await expect(api.list()).rejects.toBeInstanceOf(AppointmentApiError);
    await expect(api.services.list()).rejects.toBeInstanceOf(AppointmentApiError);
  });

  it("passes AbortSignal to GET and encodes path identifiers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: { id: "a/b" } }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await createAppointmentsApi("https://api.example").get("a/b", { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example/api/v1/appointments/a%2Fb",
      expect.objectContaining({ credentials: "include", signal: controller.signal }),
    );
  });

  it("preserves an abort raised while parsing a successful response", async () => {
    const abortError = new DOMException("Request was aborted", "AbortError");
    const response = new Response("{}", { status: 200 });
    vi.spyOn(response, "json").mockRejectedValue(abortError);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(createAppointmentsApi("https://api.example").get("appointment-1")).rejects.toBe(
      abortError,
    );
  });

  it("preserves an abort raised while parsing a server error", async () => {
    const abortError = new DOMException("Request was aborted", "AbortError");
    const response = new Response("{}", { status: 403 });
    vi.spyOn(response, "json").mockRejectedValue(abortError);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(createAppointmentsApi("https://api.example").get("appointment-1")).rejects.toBe(
      abortError,
    );
  });

  it("sends only allowlisted booking, cancellation and rebooking commands", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ success: true, data: { id: "appt-1" } })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const api = createAppointmentsApi("https://api.example");

    await api.create({
      serviceId: "service",
      resourceId: "resource",
      contactId: "contact",
      startsAt: "2026-10-27T16:00:00.000Z",
      idempotencyKey: "same-key-on-retry",
      notes: "internal note",
      reminderPolicy: { conversationId: "conversation", offsetMinutes: [1440] },
      tenantId: "forged-tenant",
      actorUserId: "forged-actor",
      status: "CANCELLED",
    } as CreateAppointmentInput);
    await api.cancel("appt-1");
    await api.rebook("appt-1", {
      startsAt: "2026-10-28T16:00:00.000Z",
      resourceId: "resource-2",
      idempotencyKey: "new-command-key",
    });

    const calls = fetchMock.mock.calls;
    expect(calls[0]?.[0]).toBe("https://api.example/api/v1/appointments");
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({
      serviceId: "service",
      resourceId: "resource",
      contactId: "contact",
      startsAt: "2026-10-27T16:00:00.000Z",
      idempotencyKey: "same-key-on-retry",
      notes: "internal note",
      reminderPolicy: { conversationId: "conversation", offsetMinutes: [1440] },
    });
    expect(calls[1]?.[0]).toBe("https://api.example/api/v1/appointments/appt-1/cancel");
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual({});
    expect(JSON.parse(String(calls[2]?.[1]?.body))).toEqual({
      startsAt: "2026-10-28T16:00:00.000Z",
      resourceId: "resource-2",
      idempotencyKey: "new-command-key",
    });
    expect(calls.every((call) => call[1]?.credentials === "include")).toBe(true);
  });

  it("returns the availability continuation cursor instead of truncating pages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          timezone: "America/Mexico_City",
          slots: [
            {
              startsAt: "2026-10-27T16:00:00.000Z",
              endsAt: "2026-10-27T16:30:00.000Z",
              resourceId: "r1",
              capacity: 1,
            },
          ],
          nextFrom: "2026-10-28T00:00:00.000Z",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = await createAppointmentsApi("https://api.example").availability({
      serviceId: "s1",
      resourceId: "r1",
      from: "2026-10-27T06:00:00.000Z",
      to: "2026-11-03T06:00:00.000Z",
    });

    expect(page.nextFrom).toBe("2026-10-28T00:00:00.000Z");
    expect(new URL(fetchMock.mock.calls[0]?.[0] as string).searchParams.get("to")).toBe(
      "2026-11-03T06:00:00.000Z",
    );
  });

  it("rejects availability ranges over 168 hours before sending a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createAppointmentsApi("https://api.example").availability({
        serviceId: "s1",
        resourceId: "r1",
        from: "2024-11-03T04:00:00.000Z",
        to: "2024-11-10T05:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "AVAILABILITY_RANGE_INVALID", statusCode: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps reminder queue/task/outbound evidence separate", async () => {
    const reminder = {
      id: "reminder-1",
      appointmentId: "appt-1",
      conversationId: "conv-1",
      offsetMinutes: 60,
      dueAt: "2026-10-27T15:00:00.000Z",
      status: "QUEUED",
      reason: null,
      taskId: "task-1",
      taskStatus: "COMPLETED",
      outboundMessageId: "outbound-1",
      outboundStatus: "sent",
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [reminder] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createAppointmentsApi("https://api.example").reminders("appt-1")).resolves.toEqual(
      [reminder],
    );
  });

  it("gates optional capabilities from existing modules and permissions", () => {
    const base = {
      modules: ["module.appointments", "module.crm_lite", "module.messaging.basic"],
      permissions: [
        "appointments.read",
        "appointments.manage",
        "contacts.read",
        "conversations.read",
      ],
    };
    expect(getAppointmentCapabilities(base)).toEqual({
      canReadAppointments: true,
      canManageAppointments: true,
      canConfigureReminders: false,
      canLookupContacts: true,
      canLookupConversations: true,
      canLookupOrganizationUnits: false,
    });
    expect(
      getAppointmentCapabilities({
        ...base,
        modules: [...base.modules, "module.scheduling"],
      }).canConfigureReminders,
    ).toBe(true);
  });

  it("uses the real rule collection path and preserves the global-rule service filter", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          jsonResponse({ success: true, data: { items: [{ id: "rule-1" }], total: 1 } }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await createAppointmentsApi("https://api.example").rules.list({
      resourceId: "resource-1",
      serviceId: null,
      active: true,
      limit: 25,
      offset: 50,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example/api/v1/appointments/availability-rules?resourceId=resource-1&serviceId=null&active=true&limit=25&offset=50",
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );
  });
});
