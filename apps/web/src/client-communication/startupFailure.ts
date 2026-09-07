export function reportStartupFailure(error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(String(error));

  try {
    window.octoBuddyCommunication?.reportFatalError({
      message: normalized.message,
      stack: normalized.stack,
    });
  } catch (reportError) {
    console.error(
      "[client-communication] failed to report startup error",
      reportError,
    );
  }

  const root = document.getElementById("root");
  if (root) {
    root.textContent = `Communication module failed to start: ${normalized.message}`;
  }
}
