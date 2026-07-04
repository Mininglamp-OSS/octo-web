// Pure reconciliation logic for the NavRail active menu, extracted from MainVM so it can be
// unit-tested without importing the full @octo/base module graph (which pulls heavy component
// deps into the test environment). MainVM.reconcileActiveMenu delegates here.
//
// Rule (#536 reviewer follow-up): when a config-gated menu (e.g. docs_on) is toggled OFF while
// it is the active view, its NavRail entry leaves `menusList` but the host would keep rendering
// its route via `historyRoutePaths`. So when the active menu is no longer in the list, drop its
// route (unmounting the view / tearing down e.g. the docs collab WS) and fall back to the first
// available menu. One-directional: turning a menu ON never moves the user off their view.

/** Minimal structural shape of a NavRail menu the reconciliation needs. */
export interface MenuLike {
  id: string;
  routePath: string;
}

export interface ReconcileInput<M extends MenuLike> {
  /** The live menu list (already reflects the post-toggle gated set). */
  menusList: M[];
  /** The currently active menu, if any. */
  currentMenu: M | undefined;
  /** Route paths currently kept mounted by the host (display-toggled tabs). */
  historyRoutePaths: string[];
}

export interface ReconcileResult<M extends MenuLike> {
  /** True when the active menu was replaced (caller should re-render). */
  changed: boolean;
  /** The reconciled active menu (first available when the old one vanished). */
  currentMenu: M | undefined;
  /** New history list with the vanished route removed and the fallback route ensured. */
  historyRoutePaths: string[];
}

/**
 * Reconcile the active menu against the live menu list. If the active menu is still present (or
 * there is none), returns `changed: false` and the inputs unchanged. If it has disappeared, drops
 * its route from history and falls back to the first available menu.
 */
export function reconcileMenuState<M extends MenuLike>(
  input: ReconcileInput<M>
): ReconcileResult<M> {
  const { menusList, currentMenu, historyRoutePaths } = input;

  // No active menu, or it is still present → nothing to reconcile.
  if (!currentMenu || menusList.some((m) => m.id === currentMenu.id)) {
    return { changed: false, currentMenu, historyRoutePaths };
  }

  // Active menu vanished: drop its route so the view unmounts, then fall back to the first menu.
  const nextHistory = historyRoutePaths.filter((p) => p !== currentMenu.routePath);
  const next = menusList.length > 0 ? menusList[0] : undefined;
  if (next && nextHistory.indexOf(next.routePath) === -1) {
    nextHistory.push(next.routePath);
  }
  return { changed: true, currentMenu: next, historyRoutePaths: nextHistory };
}
