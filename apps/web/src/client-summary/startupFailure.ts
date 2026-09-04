export function reportSummaryStartupFailure(error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  try {
    window.octoBuddySummary?.reportFatalError({
      message: normalized.message,
      stack: normalized.stack,
    });
  } catch (reportError) {
    console.error(
      "[client-summary] failed to report startup error",
      reportError
    );
  }
  const root = document.getElementById("root");
  if (root)
    root.textContent = `Summary module failed to start: ${normalized.message}`;
}
