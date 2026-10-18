/** Keep expiry/revocation live even if local persistence never responds. */
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
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      report(new Error("Session cleanup timed out"));
      resolve();
    }, SESSION_CLEANUP_TIMEOUT_MS);
    Promise.resolve(pending).catch(report).finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
