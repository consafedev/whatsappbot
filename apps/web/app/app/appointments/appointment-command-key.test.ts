import { describe, expect, it } from "vitest";
import {
  beginCommandIntent,
  type CommandKeyEntry,
  stableCommandKey,
} from "./appointment-command-key";

describe("appointment command retry identity", () => {
  it("reuses a key for an unchanged retry and rotates it when the payload changes", () => {
    const entries = new Map<string, CommandKeyEntry>();
    let next = 0;
    const createKey = () => `key-${++next}`;

    const first = stableCommandKey(
      entries,
      "create",
      { startsAt: "2030-01-01T10:00:00.000Z" },
      createKey,
    );
    const retry = stableCommandKey(
      entries,
      "create",
      { startsAt: "2030-01-01T10:00:00.000Z" },
      createKey,
    );
    const changed = stableCommandKey(
      entries,
      "create",
      { startsAt: "2030-01-01T11:00:00.000Z" },
      createKey,
    );

    expect(retry).toBe(first);
    expect(changed).not.toBe(first);
  });

  it("starts a fresh key for a new intent with an identical payload", () => {
    const entries = new Map<string, CommandKeyEntry>();
    let next = 0;
    const createKey = () => `key-${++next}`;
    const payload = { appointmentId: "appointment", startsAt: "2030-01-01T10:00:00.000Z" };

    const first = stableCommandKey(entries, "rebook:appointment", payload, createKey);
    beginCommandIntent(entries, "rebook:appointment");
    const secondIntent = stableCommandKey(entries, "rebook:appointment", payload, createKey);

    expect(secondIntent).not.toBe(first);
  });
});
