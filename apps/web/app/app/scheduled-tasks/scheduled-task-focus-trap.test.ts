import { describe, expect, it } from "vitest";
import { getFocusTrapTarget } from "./scheduled-task-focus-trap";

function element(name: string): HTMLElement {
  return { name } as unknown as HTMLElement;
}

describe("scheduled task modal focus trap", () => {
  const first = element("first");
  const middle = element("middle");
  const last = element("last");
  const focusable = [first, middle, last];

  it("wraps Shift+Tab from the first control to the last", () => {
    expect(getFocusTrapTarget(first, focusable, true)).toBe(last);
  });

  it("wraps Tab from the last control to the first", () => {
    expect(getFocusTrapTarget(last, focusable, false)).toBe(first);
  });

  it("moves focus inside when the active element is outside the dialog", () => {
    expect(getFocusTrapTarget(element("outside"), focusable, false)).toBe(first);
    expect(getFocusTrapTarget(element("outside"), focusable, true)).toBe(last);
  });

  it("lets native tab order continue for controls inside the dialog", () => {
    expect(getFocusTrapTarget(middle, focusable, false)).toBeNull();
  });

  it("uses the dialog fallback when no control can receive focus", () => {
    expect(getFocusTrapTarget(null, [], false)).toBeNull();
  });
});
