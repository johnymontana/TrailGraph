import type { PlanPane } from './PlanShell';

/**
 * A request from within a pane to switch the plan shell to another pane (ADR-076 P3.5) — e.g. the
 * no-trips hero's "Ask the ranger" handoff. TripBuilder isn't a PlanShell context consumer, so it asks
 * via a window event (the established cross-tree idiom); PlanShell listens and calls setPane. On desktop
 * every pane is visible, so switching is a harmless focus hint.
 */
const EVENT = 'trailgraph:plan-pane';

export function requestPlanPane(pane: PlanPane): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { pane } }));
}

export function onPlanPaneRequest(handler: (pane: PlanPane) => void): () => void {
  const listener = (e: Event) => {
    const pane = (e as CustomEvent<{ pane?: PlanPane }>).detail?.pane;
    if (pane) handler(pane);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
