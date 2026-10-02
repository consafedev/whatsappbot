import type { ScheduledTask } from "@whatsapp-platform/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recoverStaleScheduledTasks = vi.hoisted(() => vi.fn());

vi.mock("@whatsapp-platform/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@whatsapp-platform/database")>()),
  recoverStaleScheduledTasks,
}));

import { createScheduledTasksReconciler } from "./scheduled-tasks-reconciler";

const now = new Date("2026-10-01T12:00:00.000Z");
const task = {
  id: "00000000-0000-4000-8000-000000000010",
  tenantId: "00000000-0000-4000-8000-000000000001",
  scheduledFor: new Date(now.getTime() - 1_000),
} as ScheduledTask;

describe("scheduled tasks reconciler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    recoverStaleScheduledTasks.mockResolvedValue({ failedCount: 0, recoveredCount: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("recovers stale tasks and enqueues active-tenant tasks already due", async () => {
    const findMany = vi.fn().mockResolvedValue([task]);
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const reconciler = createScheduledTasksReconciler({
      database: { scheduledTask: { findMany } } as never,
      enqueue,
      now: () => new Date(),
    });

    await reconciler.runOnce();

    expect(recoverStaleScheduledTasks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        limit: expect.any(Number),
        staleBefore: new Date(now.getTime() - 300_000),
      }),
    );
    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
      take: expect.any(Number),
      where: {
        scheduledFor: { lte: now },
        status: "PENDING",
        tenant: { status: "active" },
      },
    });
    expect(enqueue).toHaveBeenCalledWith(task);
  });

  it("runs on a 60 second interval and stops cleanly", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const reconciler = createScheduledTasksReconciler({
      database: { scheduledTask: { findMany } } as never,
      enqueue: vi.fn().mockResolvedValue(undefined),
      now: () => new Date(),
    });

    await reconciler.start();
    expect(findMany).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(findMany).toHaveBeenCalledTimes(2);
    await reconciler.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
