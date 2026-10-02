export function getFocusTrapTarget(
  activeElement: HTMLElement | null,
  focusableElements: readonly HTMLElement[],
  shiftKey: boolean,
): HTMLElement | null {
  if (focusableElements.length === 0) return null;
  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];
  if (!first || !last) return null;

  const activeIndex = activeElement === null ? -1 : focusableElements.indexOf(activeElement);
  if (activeIndex === -1) return shiftKey ? last : first;
  if (shiftKey && activeIndex === 0) return last;
  if (!shiftKey && activeIndex === focusableElements.length - 1) return first;
  return null;
}
