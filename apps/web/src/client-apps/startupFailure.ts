export function reportAppsStartupFailure(error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  try {
    window.octoBuddyApps?.reportFatalError({
      message: normalized.message,
      stack: normalized.stack,
    });
  } catch (reportError) {
    console.error("[client-apps] failed to report startup error", reportError);
  }
  const root = document.getElementById("root");
  if (root)
    root.textContent = `Apps module failed to start: ${normalized.message}`;
}
