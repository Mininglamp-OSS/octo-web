/**
 * Pure decisions for the shell window's external-link router
 * (setWindowOpenHandler) and the IPC_OPEN_EXTERNAL_URL bridge.
 *
 * Only http(s) URLs are ever handed to the system browser. Everything else
 * (file://, custom schemes like octo://, javascript:, …) is denied WITHOUT
 * openExternal — an attacker-chosen protocol string must never reach the OS
 * handler registry.
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
 * `window.open("about:blank")` is a deliberate pattern in the renderer: the
 * web-era code grabs a window reference, nulls the opener (equivalent
 * noopener isolation) and then navigates the reference to the target URL
 * (see MeInfo/vm.tsx realname verification and global-search doc open). The
 * blank page itself carries no content, so allowing it through
 * setWindowOpenHandler keeps those flows truthful (a real blocked/succeeded
 * signal) while the follow-up navigation is re-routed by the child window's
 * did-navigate listener.
 */
export function isBlankPopupUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "about:" &&
      parsed.pathname === "blank" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}
