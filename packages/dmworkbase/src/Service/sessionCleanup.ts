/** A timeout is safe only after persistent data has a durable read barrier. */
export type SessionCleanupTask = Promise<void> & { requireCompletion?: boolean };

/** Deletion failed without a durable fence: callers must not reload the app. */
export class SessionCleanupError extends Error {
  readonly name = "SessionCleanupError";
  constructor(readonly cause: unknown) {
    super("Mandatory session cleanup failed");
  }
}

/** Keep expiry/revocation live when local persistence can safely finish later. */
export const SESSION_CLEANUP_TIMEOUT_MS = 5_000;

export function runSessionCleanup(
  cleanup: () => void | Promise<void>,
  logPrefix: string,
): void | Promise<void> {
  const report = (error: unknown) => console.error(`${logPrefix} logout cleanup failed`, error);
  let pending: void | Promise<void>;
  try {
    // Credential revocation must happen before returning to the caller.
    pending = cleanup();
  } catch (error) {
    report(error);
    return;
  }
  if (!pending) return;
  return new Promise<void>((resolve, reject) => {
    const requireCompletion = (pending as SessionCleanupTask).requireCompletion;
    const timer = requireCompletion ? undefined : setTimeout(() => {
      report(new Error("Session cleanup timed out"));
      resolve();
    }, SESSION_CLEANUP_TIMEOUT_MS);
    Promise.resolve(pending).then(() => {
      clearTimeout(timer);
      resolve();
    }, error => {
      clearTimeout(timer);
      report(error);
      // If both the barrier and deletion failed, reloading would expose old data.
      if (requireCompletion) reject(new SessionCleanupError(error));
      else resolve();
    });
  });
}
