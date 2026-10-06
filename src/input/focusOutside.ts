const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Moves keyboard focus to the next (or previous) focusable control on the page that is not inside `root`.
 * The grid handles Tab itself to move between cells, so without an explicit way out a keyboard user would be trapped in it.
 * Returns false when there is nothing to move to.
 */
export function focusOutside(root: HTMLElement, backward: boolean): boolean {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (root.contains(el) || el.closest('[aria-hidden="true"]') !== null) return false;
    if (el.tabIndex < 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && el.getClientRects().length > 0;
  });
  // Document order relative to the grid: "following" elements come after it, "preceding" ones before.
  const after = candidates.filter((el) => (root.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
  const before = candidates.filter((el) => (root.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) !== 0 && !el.contains(root));
  const target = backward ? before[before.length - 1] : after[0];
  if (target === undefined) return false;
  target.focus();
  return true;
}
