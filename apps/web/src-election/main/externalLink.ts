/**
 * Pure decisions for the shell window's external-link router
 * (setWindowOpenHandler) and the IPC_OPEN_EXTERNAL_URL bridge.
 *
 * Only http(s) URLs are ever handed to the system browser. Everything else
 * (file://, custom schemes like octo://, javascript:, blob:, data:, …) is
 * denied WITHOUT openExternal — an attacker-chosen protocol string must
 * never reach the OS handler registry.
 */
export function isExternalHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The setWindowOpenHandler decision. Extracted as a pure function so the
 * handler wiring is covered by tests: "open-external" → the URL is handed to
 * the system browser; "deny" → the popup is blocked (and the URL logged with
 * origin/pathname only). There is deliberately no "allow" branch: the
 * renderer features that used the web-era `window.open("about:blank")`
 * dance were migrated to the IPC_OPEN_EXTERNAL_URL bridge, and an about:blank
 * allow would be a bypass surface (the blank document commits before any
 * will-navigate listener can cancel it, and javascript:/hash navigations
 * never fire will-navigate).
 */
export function decideWindowOpen(url: string): "open-external" | "deny" {
  return isExternalHttpUrl(url) ? "open-external" : "deny";
}
