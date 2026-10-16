import { WKApp } from "@octo/base";

let revocation: Promise<void> | undefined;

/**
 * Coordinates host revocation listeners that coexist in an embedded renderer.
 * Every listener observes the same cleanup before one of them reloads the page.
 */
export function revokeEmbeddedSession(
  additionalCleanup?: () => void | Promise<void>,
): Promise<void> {
  if (!revocation) {
    revocation = (async () => {
      const cleanup = additionalCleanup?.();
      const logout = WKApp.loginInfo.logout();
      await Promise.all([cleanup, logout]);
    })();
  }
  return revocation;
}

/** Test isolation for the renderer-lifetime singleton. */
export function resetEmbeddedSessionRevocationForTests(): void {
  revocation = undefined;
}
