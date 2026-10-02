import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelScheduledTask,
  canManageScheduledTasks,
  canReadScheduledTasks,
  createScheduledTask,
  fetchScheduledTasks,
  formatDateTime,
  formatTaskStatus,
  formatTaskType,
  retryScheduledTask,
  ScheduledTasksApiError,
} from "./scheduled-tasks-view-model";

const task = {
  id: "task-1",
  tenantId: "tenant-1",
  name: "Enviar recordatorio",
  taskType: "TRIGGER_RULE",
  status: "PENDING" as const,
  payload: { ruleId: "rule-1" },
  cronExpression: null,
  scheduledFor: "2026-10-01T12:00:00.000Z",
  lastRunAt: null,
  nextRunAt: null,
  retryCount: 0,
  maxRetries: 3,
  errorMessage: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
};

function successResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data }),
  } as unknown as Response;
}

describe("scheduled-tasks-view-model", () => {
  const originalFetch = global.fetch;

  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("normalizes the list envelope and sends status and pagination with the tenant session", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(successResponse({ tasks: [task], total: 1, limit: 20, offset: 0 }));

    const result = await fetchScheduledTasks("http://localhost:3001/", {
      status: "PENDING",
      limit: 20,
      offset: 0,
    });

    expect(result).toEqual({ items: [task], total: 1, limit: 20, offset: 0 });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/scheduled-tasks?status=PENDING&limit=20&offset=0",
      expect.objectContaining({
        credentials: "include",
        headers: { Accept: "application/json" },
        method: "GET",
      }),
    );
  });

  it("forwards an abort signal to the list request", async () => {
    const controller = new AbortController();
    global.fetch = vi
      .fn()
      .mockResolvedValue(successResponse({ tasks: [], total: 0, limit: 20, offset: 0 }));

    await fetchScheduledTasks("http://localhost:3001", { signal: controller.signal });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/scheduled-tasks",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("creates a scheduled task using the JSON API contract", async () => {
    const input = {
      name: task.name,
      taskType: "TRIGGER_RULE",
      cronExpression: "0 * * * *",
      payload: task.payload,
      maxRetries: 3,
    };
    global.fetch = vi.fn().mockResolvedValue(successResponse(task));

    await expect(createScheduledTask("http://localhost:3001", input)).resolves.toEqual(task);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/scheduled-tasks",
      expect.objectContaining({
        credentials: "include",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  });

  it("cancels a task with DELETE and tenant credentials", async () => {
    global.fetch = vi.fn().mockResolvedValue(successResponse(task));

    await expect(cancelScheduledTask("http://localhost:3001", task.id)).resolves.toEqual(task);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/scheduled-tasks/task-1",
      expect.objectContaining({ credentials: "include", method: "DELETE" }),
    );
  });

  it("retries immediately without a body and can send an explicit runAt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse(task));
    global.fetch = fetchMock;

    await retryScheduledTask("http://localhost:3001", task.id);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:3001/api/v1/scheduled-tasks/task-1/retry",
      expect.objectContaining({ credentials: "include", method: "POST" }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("body");

    await retryScheduledTask("http://localhost:3001", task.id, "2026-10-02T12:00:00.000Z");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ runAt: "2026-10-02T12:00:00.000Z" }),
    });
  });

  it.each([
    ["PENDING", "Pendiente", "amber"],
    ["PROCESSING", "En ejecución", "blue"],
    ["COMPLETED", "Completada", "green"],
    ["FAILED", "Fallida", "red"],
    ["CANCELLED", "Cancelada", "gray"],
  ] as const)("formats status %s", (status, label, tone) => {
    expect(formatTaskStatus(status)).toEqual({ label, tone });
  });

  it("formats known task types and preserves unknown values", () => {
    expect(formatTaskType("TRIGGER_RULE")).toBe("Disparador de Regla");
    expect(formatTaskType("CUSTOM_ACTION")).toBe("Acción Personalizada");
    expect(formatTaskType("CUSTOM")).toBe("CUSTOM");
  });

  it("formats valid dates safely in Spanish and handles missing or invalid dates", () => {
    expect(formatDateTime("2026-10-01T12:00:00.000Z")).not.toBe("Fecha no disponible");
    expect(formatDateTime()).toBe("Fecha no disponible");
    expect(formatDateTime("invalid")).toBe("Fecha no disponible");
  });

  it("rejects a malformed list envelope instead of returning an empty list", async () => {
    global.fetch = vi.fn().mockResolvedValue(successResponse({ total: 0, limit: 20, offset: 0 }));

    await expect(fetchScheduledTasks("http://localhost:3001")).rejects.toBeInstanceOf(
      ScheduledTasksApiError,
    );
  });

  it.each([400, 403, 404, 409])("preserves HTTP %s in a typed API error", async (statusCode) => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: statusCode,
      json: async () => ({ message: "Request rejected", code: "REQUEST_REJECTED" }),
    } as unknown as Response);

    await expect(fetchScheduledTasks("http://localhost:3001")).rejects.toMatchObject({
      name: "ScheduledTasksApiError",
      statusCode,
      message: "Request rejected",
      code: "REQUEST_REJECTED",
    });
  });

  it("falls back to a safe status message for non-JSON HTTP errors", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => {
        throw new Error("invalid JSON");
      },
    } as unknown as Response);

    await expect(fetchScheduledTasks("http://localhost:3001")).rejects.toMatchObject({
      statusCode: 400,
      message: "Error en el servidor (400)",
    });
  });

  it("requires entitlement plus read permission and checks manage separately", () => {
    expect(canReadScheduledTasks(["module.scheduling"], ["scheduling.read"])).toBe(true);
    expect(canReadScheduledTasks([], ["scheduling.read"])).toBe(false);
    expect(canReadScheduledTasks(["module.scheduling"], [])).toBe(false);
    expect(canManageScheduledTasks(["scheduling.manage"])).toBe(true);
    expect(canManageScheduledTasks([])).toBe(false);
  });
});
