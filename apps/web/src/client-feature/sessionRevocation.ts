import { WKApp } from "@octo/base";

/** Maximum time (ms) to wait for IndexedDB cleanup before forcing a reload. */
const REVOCATION_TIMEOUT_MS = 5_000;

/**
 * A resolvable barrier used to include any cleanup promises registered during
 * the same synchronous turn as the singleton's creation.
 *
 * The singleton's async body:
 *  1. Synchronously: calls logout and records its promise.
 *  2. First await: `await gatePromise` — pauses here and returns control to
 *     the synchronous caller.
 *  3. Still-synchronous callers (Runtime listener after Shell listener) can
 *     still push additional cleanup promises via revokeEmbeddedSession().
 *  4. A queueMicrotask() resolves the gate, after which the body resumes and
 *     builds Promise.all from the now-complete set.
 */
let gate: (() => void) | undefined;
let gatePromise: Promise<void> | undefined;
let pendingTasks: Promise<void>[] = [];
let revocation: Promise<void> | undefined;

/**
 * Coordinates host revocation listeners that coexist in an embedded renderer.
 * Every listener observes the same cleanup before one of them reloads the page.
 *
 * **Listener-order safety**: The singleton body uses a one-microtask gate so
 * that synchronous callers in the same event-loop turn can all register their
 * cleanup promises before the gate resolves.  Specifically:
 *  - The Shell listener calls revokeEmbeddedSession() (no callback) → creates
 *    the singleton, calls logout synchronously, then awaits the gate.
 *  - The Runtime listener calls revokeEmbeddedSession(() => draftPromise) →
 *    the callback is invoked synchronously (so clearDrafts side-effects are
 *    visible immediately), the resulting promise is pushed into pendingTasks.
 *  - A queueMicrotask resolves the gate; the singleton resumes and awaits all
 *    tasks, including the draft promise.
 *
 * **Synchronous side-effects**: logout is called synchronously inside the
 * singleton (so callers can immediately observe uid change etc.).  Cleanup
 * callbacks are also called synchronously when revokeEmbeddedSession() is
 * invoked with them.
 *
 * A hard timeout ensures the page reloads even when cleanup hangs or rejects.
 */
export function revokeEmbeddedSession(
  additionalCleanup?: () => void | Promise<void>,
): Promise<void> {
  if (additionalCleanup) {
    // Call the cleanup synchronously so callers see its side-effects
    // immediately, then register the resulting promise for the coordinator.
    try {
      const result = additionalCleanup();
      if (result instanceof Promise) pendingTasks.push(result);
    } catch {
      // Swallow sync errors; the coordinator must still proceed.
    }
  }

  if (!revocation) {
    // Open a one-microtask gate so additional synchronous callers can push
    // their tasks before the coordinator builds its Promise.all.
    gatePromise = new Promise<void>((resolve) => { gate = resolve; });
    queueMicrotask(() => { gate?.(); });

    revocation = (async () => {
      // ── Synchronous prologue (before the first await) ──────────────────
      // Call logout synchronously: side-effects (uid mutation, etc.) are
      // immediately visible to the caller after revokeEmbeddedSession returns.
      const logoutResult = WKApp.loginInfo.logout();
      if (logoutResult instanceof Promise) pendingTasks.push(logoutResult);

      // ── First await: suspension point ──────────────────────────────────
      // Wait for the microtask gate so all synchronous callers in this turn
      // (e.g. the Runtime listener firing right after the Shell listener) have
      // had a chance to push their cleanup tasks into pendingTasks.
      await gatePromise;

      // ── After gate: snapshot and wait ──────────────────────────────────
      const tasks = pendingTasks.splice(0);
      const timeout = new Promise<void>((resolve) =>
        setTimeout(resolve, REVOCATION_TIMEOUT_MS),
      );
      await Promise.race([
        Promise.all(tasks).catch(() => {}),
        timeout,
      ]);
    })();
  }

  return revocation;
}

/** Test isolation for the renderer-lifetime singleton. */
export function resetEmbeddedSessionRevocationForTests(): void {
  revocation = undefined;
  gatePromise = undefined;
  gate = undefined;
  pendingTasks = [];
}
