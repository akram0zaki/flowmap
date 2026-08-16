/**
 * Watch an element's size, where `ResizeObserver` exists.
 *
 * jsdom has no `ResizeObserver`, and neither do some older managed-device
 * WebViews — which is the environment this ships into. A component that throws
 * because a measurement API is absent has turned a nicety into a crash, so the
 * absence is handled here once rather than remembered at four call sites.
 *
 * Callers measure once themselves before subscribing, so the fallback is simply
 * "measured at mount and not updated", which is a degraded layout rather than a
 * broken one.
 */
export function observeResize(node: Element | null, onResize: () => void): () => void {
  if (!node || typeof ResizeObserver === 'undefined') return () => undefined;

  const observer = new ResizeObserver(onResize);
  observer.observe(node);
  return () => observer.disconnect();
}
