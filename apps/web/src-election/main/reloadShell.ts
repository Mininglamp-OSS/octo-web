import type { BrowserWindow } from "electron";
import { join } from "path";

/**
 * Path of the packaged renderer entry (build/index.html), resolved from the
 * compiled main-process output (out-election/main). Single source of truth so
 * a future outDir change fails in exactly one place.
 */
export const INDEX_HTML = join(__dirname, "../../build/index.html");

/**
 * Reload `win`, but only through the shell's index.html when the window is
 * actually showing a file:// document.
 *
 * In a packaged build the main window can legitimately sit on an external IdP
 * page mid-SSO (#1331 OIDC flow): the renderer navigates the main window
 * itself to the authorize URL, so "packaged" no longer implies "showing our
 * own file:// shell". Branching on the focused window's own URL instead of
 * `app.isPackaged` keeps native reload semantics for non-shell documents
 * (the SSO flow survives a slow-loading-login-page refresh) while retaining
 * the drive-root guard behaviour for the shell.
 */
export function reloadShell(win: BrowserWindow, ignoreCache: boolean): void {
  if (!win.webContents.getURL().startsWith("file://")) {
    // Non-shell document (e.g. an IdP page mid-SSO): preserve native reload.
    if (ignoreCache) {
      win.webContents.reloadIgnoringCache();
    } else {
      win.reload();
    }
    return;
  }
  const done = ignoreCache
    ? win.webContents.session.clearCache().then(() => win.loadFile(INDEX_HTML))
    : win.loadFile(INDEX_HTML);
  done.catch((err) => {
    console.error("[reload-shell] loadFile failed:", err);
  });
}
