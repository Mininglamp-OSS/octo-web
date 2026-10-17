import { WKApp } from "@octo/base";

let revocation: Promise<void> | undefined;

/** Maximum time (ms) to wait for IndexedDB cleanup before forcing a reload. */
const REVOCATION_TIMEOUT_MS = 5_000;

/**
 * Coordinates host revocation listeners that coexist in an embedded renderer.
 * Every listener observes the same cleanup before one of them reloads the page.
 *
 * A hard timeout ensures the page reloads even when the IndexedDB cleanup call
 * hangs or rejects — leaving a non-responsive page is never acceptable.
 */
export function revokeEmbeddedSession(
  additionalCleanup?: () => void | Promise<void>,
): Promise<void> {
  if (!revocation) {
    revocation = (async () => {
      const cleanup = additionalCleanup?.();
      const logout = WKApp.loginInfo.logout();
      const timeout = new Promise<void>((resolve) =>
        setTimeout(resolve, REVOCATION_TIMEOUT_MS),
      );
      // Race: resolve as soon as both cleanup tasks finish OR the timeout fires.
      // This guarantees the caller's .then(() => reload()) is always reached.
      await Promise.race([
        Promise.all([cleanup, logout]).catch(() => {}),
        timeout,
      ]);
    })();
  }
  return revocation;
}

/** Test isolation for the renderer-lifetime singleton. */
export function resetEmbeddedSessionRevocationForTests(): void {
  revocation = undefined;
}
