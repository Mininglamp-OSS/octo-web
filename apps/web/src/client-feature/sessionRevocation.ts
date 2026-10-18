import { WKApp } from "@octo/base";
import { runSessionCleanup } from "@octo/base/src/Service/sessionCleanup";

let pendingTasks: Promise<void>[] = [];
let revocation: Promise<void> | undefined;
let reload: Promise<void> | undefined;

/** Include cleanup from every listener in the same command dispatch turn. */
export function revokeEmbeddedSession(
  additionalCleanup?: () => void | Promise<void>,
): Promise<void> {
  const register = (cleanup: () => void | Promise<void>) => {
    const task = runSessionCleanup(cleanup, "[sessionRevocation]");
    if (task) pendingTasks.push(task);
  };
  if (additionalCleanup) register(additionalCleanup);
  if (!revocation) {
    register(() => WKApp.loginInfo.logout());
    // Logout and native cleanup start synchronously; snapshot after all listeners run.
    revocation = Promise.resolve().then(async () => {
      await Promise.all(pendingTasks.splice(0));
    });
  }
  return revocation;
}

/** The runtime can revoke without a mounted shell; both share a single reload. */
export function revokeAndReloadEmbeddedSession(
  additionalCleanup?: () => void | Promise<void>,
): Promise<void> {
  const cleanup = revokeEmbeddedSession(additionalCleanup);
  reload ??= cleanup.then(() => window.location.reload());
  return reload;
}

/** Test isolation for the renderer-lifetime singleton. */
export function resetEmbeddedSessionRevocationForTests(): void {
  revocation = undefined;
  reload = undefined;
  pendingTasks = [];
}
