// Pure reconciliation logic for the NavRail active menu, extracted from MainVM so it can be
// unit-tested without importing the full @octo/base module graph (which pulls heavy component
// deps into the test environment). MainVM.reconcileActiveMenu delegates here.
//
// Rule (#536 reviewer follow-up): when a config-gated menu (e.g. docs_on) is toggled OFF, its
// NavRail entry leaves `menusList` but the host would keep rendering its route via
// `historyRoutePaths` — including background tabs the user isn't currently on (they stay mounted,
// just `display:none`, see MainContentLeft). So on every reconcile pass we drop ALL routes whose
// menu is no longer live, not just the active one; if the active menu itself vanished we also
// fall back to the first available menu. One-directional: turning a menu ON never moves the user
// off their current view. Dropping a route only unmounts what that route renders directly into
// `historyRoutePaths` (e.g. the docs list) — see MainVM.reconcileActiveMenu for the additional
// step needed to release content a route pushed into the shared right-hand pane.

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
  /** True when the active menu or the history list changed (caller should re-render). */
  changed: boolean;
  /** The reconciled active menu (first available when the old one vanished). */
  currentMenu: M | undefined;
  /** New history list with any gated-off routes removed (fallback route ensured if needed). */
  historyRoutePaths: string[];
  /** Route paths dropped this pass because their menu is no longer live — the caller should
   * release any resources those routes may still hold outside `historyRoutePaths` itself (e.g.
   * a view pushed into a shared side pane), regardless of whether the route was active. */
  prunedRoutePaths: string[];
  /**
   * True only when the *active* menu itself vanished this pass (not merely a hidden/background
   * tab). `routeRight` is a single stack shared across whatever menu is currently active (chat
   * pushes its own content there too, see EndpointCommon.tsx) — only the active menu's departure
   * mirrors what a manual menu switch already clears via `onMenuClick`'s `routeRight.popToRoot()`.
   * A background tab disappearing must NOT trigger that clear: it was never occupying the
   * currently-active menu's right pane (leaving a menu via `onMenuClick` already clears
   * `routeRight`, so a background route can't still own it) and clearing it anyway would destroy
   * whatever the *actually* active menu (e.g. an open chat conversation) has pushed there.
   */
  activeMenuVanished: boolean;
}

/**
 * Reconcile menu state against the live menu list. Drops every history route whose menu has
 * disappeared (background/hidden tabs included), and — if the active menu itself vanished —
 * falls back to the first available menu. Returns `changed: false` only when nothing needed
 * pruning.
 */
export function reconcileMenuState<M extends MenuLike>(
  input: ReconcileInput<M>
): ReconcileResult<M> {
  const { menusList, currentMenu, historyRoutePaths } = input;
  const liveRoutePaths = new Set(menusList.map((m) => m.routePath));
  const liveIds = new Set(menusList.map((m) => m.id));

  const prunedRoutePaths = historyRoutePaths.filter((p) => !liveRoutePaths.has(p));
  const nextHistory = historyRoutePaths.filter((p) => liveRoutePaths.has(p));

  const activeGone = !!currentMenu && !liveIds.has(currentMenu.id);
  if (!activeGone) {
    // Active menu (if any) is still present; a hidden background tab may still have been
    // pruned above, which alone warrants a re-render (its mounted subtree should unmount).
    return {
      changed: prunedRoutePaths.length > 0,
      currentMenu,
      historyRoutePaths: nextHistory,
      prunedRoutePaths,
      activeMenuVanished: false,
    };
  }

  // Active menu vanished: fall back to the first available menu (route already dropped above).
  const next = menusList.length > 0 ? menusList[0] : undefined;
  if (next && nextHistory.indexOf(next.routePath) === -1) {
    nextHistory.push(next.routePath);
  }
  return {
    changed: true,
    currentMenu: next,
    historyRoutePaths: nextHistory,
    prunedRoutePaths,
    activeMenuVanished: true,
  };
}

// ── Appearance-side reactivation (#536 reviewer follow-up) ──────────────────────────────────
//
// The mirror of the disappearance case above. A config-gated menu (docs_on) also affects the
// *appearance* side: because the menu factory returns `undefined` until appconfig resolves
// docsOn=true, a hard load / refresh / bookmark / share-link to that menu's route (e.g. `/docs`)
// finds no matching menu at MainVM.didMount and falls back to chat. When docs_on later resolves,
// refreshing the NavRail makes the entry appear, but nothing re-selects the route the URL asked
// for — so the user is stranded on chat until they click the entry manually (a regression the
// gating introduced; pre-gate the menu was always registered and didMount matched it).
//
// Fix: MainVM records the boot route it could not satisfy (`pendingRoutePath`) and, on each
// appconfig change, asks this helper whether that route's menu has since appeared. Deliberately
// scoped so it only ever activates the *exact* route the user deep-linked to — never a surprise
// jump — and MainVM drops the pending path the moment the user navigates anywhere themselves.

export interface PendingActivationInput<M extends MenuLike> {
  /** The boot route MainVM.didMount could not match to a live menu (else undefined). */
  pendingRoutePath: string | undefined;
  /** The live menu list (reflects the post-appconfig gated set). */
  menusList: M[];
  /** The currently active menu, if any. */
  currentMenu: M | undefined;
  /** Route paths currently kept mounted by the host (display-toggled tabs). */
  historyRoutePaths: string[];
}

export interface PendingActivationResult<M extends MenuLike> {
  /** True when the pending route's menu appeared and is now selected (caller should re-render). */
  activated: boolean;
  /** The reconciled active menu (the newly-appeared menu when activated, else unchanged). */
  currentMenu: M | undefined;
  /** History list with the newly-activated route ensured (unchanged when not activated). */
  historyRoutePaths: string[];
  /**
   * The still-pending route. Cleared (→ undefined) once the target menu has appeared — whether we
   * activated it or found it already active — so we do not keep re-checking. Stays set only while
   * the target menu is still absent (appconfig may not have enabled it yet).
   */
  pendingRoutePath: string | undefined;
}

/**
 * Resolve a pending deep-link activation against the live menu list. If the pending route's menu
 * is now present and is not already the active view, select it and add its route to history so
 * the host renders it. One-shot: the pending path is consumed as soon as the menu exists.
 */
export function resolvePendingRouteActivation<M extends MenuLike>(
  input: PendingActivationInput<M>
): PendingActivationResult<M> {
  const { pendingRoutePath, menusList, currentMenu, historyRoutePaths } = input;

  if (!pendingRoutePath) {
    return { activated: false, currentMenu, historyRoutePaths, pendingRoutePath };
  }

  const target = menusList.find((m) => m.routePath === pendingRoutePath);
  if (!target) {
    // Target menu still not live (e.g. docs_on not yet true) — keep waiting.
    return { activated: false, currentMenu, historyRoutePaths, pendingRoutePath };
  }

  // Target menu exists now → the pending deep-link is resolved either way; stop tracking it.
  if (currentMenu && currentMenu.id === target.id) {
    // Already the active view (nothing to do, just consume the pending path).
    return { activated: false, currentMenu, historyRoutePaths, pendingRoutePath: undefined };
  }

  const nextHistory =
    historyRoutePaths.indexOf(target.routePath) === -1
      ? [...historyRoutePaths, target.routePath]
      : historyRoutePaths;
  return {
    activated: true,
    currentMenu: target,
    historyRoutePaths: nextHistory,
    pendingRoutePath: undefined,
  };
}
