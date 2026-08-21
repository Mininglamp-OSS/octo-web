import {
  app,
  BrowserWindow,
  screen,
  globalShortcut,
  ipcMain,
  nativeImage as NativeImage,
  systemPreferences,
  Menu,
  Tray,
  nativeImage,
  dialog,
  net,
  powerSaveBlocker,
  session,
  shell,
} from "electron";
import fs from "fs";
import tmp from 'tmp';
import Screenshots from "electron-screenshots";
import { join, dirname, basename, extname } from "path";
import { pathToFileURL } from "url";

import logo, { getNoMessageTrayIcon } from "./logo";
import {
  IPC_CONVERSATION_UNREAD_COUNT,
  IPC_KEEP_AWAKE_GET,
  IPC_KEEP_AWAKE_SET,
  IPC_DESKTOP_SETTINGS_GET,
  IPC_DESKTOP_SETTINGS_SET,
  IPC_DOWNLOAD_SETTINGS_GET,
  IPC_DOWNLOAD_SETTINGS_SET,
  IPC_DOWNLOAD_DIRECTORY_CHOOSE,
  IPC_DOWNLOAD_URL,
  IPC_DOWNLOAD_STATUS,
  IPC_OPEN_SYSTEM_SETTINGS,
  IPC_DEEP_LINK,
  IPC_OIDC_AUTHORIZE_START,
  IPC_OIDC_AUTHORIZE_END,
  IPC_OIDC_HTTP_REQUEST,
  IPC_OIDC_OPEN_EXTERNAL,
  IPC_OIDC_CLEAR_AUTH_SESSION,
  IPC_NOTIFICATION_TEST_ICON,
  IPC_MEDIA_ACCESS_STATUS,
  IPC_RESTART_APP,
  IPC_SCREENSHOTS_OK,
  IPC_SCREENSHOTS_START,
  IPC_SHOW_CONVERSATIONS,
  IPC_WINDOW_IS_FOCUSED,
  IPC_ASK_TRUST_FLEET_HOST,
} from "../shared/ipc-channels";
import OCTO_CONFIG, { OIDC_API_ORIGIN, OIDC_END_SESSION_ORIGINS } from "./config";
import {
  actualBreadcrumbFile,
  cleanupStaleStaging,
  decideLockLostAction,
  executeUserDataMigration,
  planUserDataMigration,
  recordMigrationNotice,
  shouldShowMigrationNotice,
  type MigrationPlan,
} from "./userDataMigration";
import checkUpdate from './update';
import { electronNotificationManager } from './notification';
import { getRandomSid } from "./utils/search";
import { isDriveRootFileNavigation } from "./fileRootGuard";
import { INDEX_HTML, reloadShell } from "./reloadShell";
import { attachLogoutWindowNavigationListeners, classifyOidcNavigation, extractEndSessionRedirect, isTrustedSenderUrl, OIDC_HTTP_MAX_RESPONSE_BYTES, parseHttpOrigin, parseOidcCallback, validateOidcHttpRequest, validateOpenExternalUrl, withTrustedSessionSid } from "./oidcRedirect";
import { createTrustedShellDocumentTracker } from "./trustedShell";
import { clearAuthSessionCookies } from "./clearAuthSession";
import { DOWNLOAD_SETTINGS_VERSION, normalizeDownloadSettings, sanitizeDownloadFilename, type DownloadSettings } from "./downloadSettings";

let forceQuit = false;
let mainWindow: any;
let isMainWindowFocusedWhenStartScreenshot = false;
let screenshots: any;
let tray: any;
let trayIcon: any;
type DesktopSettings = {
  zoomFactor: number;
  launchAtLogin: boolean;
  showOnTray: boolean;
  closeBehavior: "background" | "quit";
};
type DownloadStatus = { id: string; state: "started" | "progress" | "completed" | "failed" | "cancelled" | "expired"; filename: string; receivedBytes?: number; totalBytes?: number };
type PendingDownload = { id: string; sender: Electron.WebContents; filename: string };
const pendingDownloads = new Map<string, PendingDownload[]>();
const reservedDownloadPaths = new Set<string>();
let settings: DesktopSettings = {
  zoomFactor: 1,
  launchAtLogin: false,
  showOnTray: true,
  closeBehavior: "background",
};
let screenShotWindowId = 0;
let isFullScreen = false;

let isOsx = process.platform === "darwin";
let isWin = process.platform === "win32";
let isWindowFocusHandlerRegistered = false;
let keepAwakeBlockerId: number | null = null;
let keepAwakeEnabled = false;

const keepAwakeSettingsPath = () => join(app.getPath("userData"), "keep-awake.json");
const legacyKeepAwakeSettingsPath = () => join(app.getPath("userData"), "settings.json");
const desktopSettingsPath = () => join(app.getPath("userData"), "desktop-settings.json");
const defaultDownloadDirectory = () => join(app.getPath("userData"), "Downloads", "Shared Files");
let downloadSettings: DownloadSettings = { directory: defaultDownloadDirectory(), askBeforeSaving: false };
const downloadSettingsPath = () => join(app.getPath("userData"), "download-settings.json");
let userDataMigrationPending = false;

function readDownloadSettings(): DownloadSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(downloadSettingsPath(), "utf8"));
    const legacyDefault = join(app.getPath("downloads"), "Shared Files");
    const next = normalizeDownloadSettings(raw, defaultDownloadDirectory(), legacyDefault);
    if (raw?.version !== DOWNLOAD_SETTINGS_VERSION && !userDataMigrationPending) {
      try { writeDownloadSettings(next); } catch { /* preserve parsed settings if migration write is unavailable */ }
    }
    return next;
  } catch { return { directory: defaultDownloadDirectory(), askBeforeSaving: false }; }
}

function writeDownloadSettings(next: DownloadSettings): void {
  const path = downloadSettingsPath();
  const tempPath = `${path}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify({ version: DOWNLOAD_SETTINGS_VERSION, ...next }, null, 2));
  try { fs.renameSync(tempPath, path); } catch (error) { try { fs.unlinkSync(tempPath); } catch {} throw error; }
}

function readDesktopSettings(): DesktopSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(desktopSettingsPath(), "utf8"));
    return {
      zoomFactor: [0.8, 0.9, 1, 1.1, 1.25].includes(raw?.zoomFactor) ? raw.zoomFactor : 1,
      launchAtLogin: raw?.launchAtLogin === true,
      showOnTray: raw?.showOnTray !== false,
      closeBehavior: raw?.closeBehavior === "quit" ? "quit" : "background",
    };
  } catch {
    let launchAtLogin = settings.launchAtLogin;
    if (!fs.existsSync(desktopSettingsPath()) && process.platform !== "linux") {
      try { launchAtLogin = app.getLoginItemSettings().openAtLogin; } catch { /* use the default */ }
    }
    return { ...settings, launchAtLogin };
  }
}

function writeDesktopSettings(next: DesktopSettings): void {
  const path = desktopSettingsPath();
  const tempPath = `${path}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(next, null, 2));
  try {
    fs.renameSync(tempPath, path);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch { /* best effort cleanup */ }
    throw error;
  }
}

function applyDesktopSettings(): void {
  if (process.platform !== "linux" && app.getLoginItemSettings().openAtLogin !== settings.launchAtLogin) {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setZoomFactor(settings.zoomFactor);
  }
  updateTray();
}

function registerDesktopSettingsHandlers(): void {
  ipcMain.handle(IPC_DESKTOP_SETTINGS_GET, (event) => {
    if (!isTrustedShellIpcSender(event)) throw new Error("untrusted sender");
    return settings;
  });
  ipcMain.handle(IPC_DESKTOP_SETTINGS_SET, (event, patch: unknown) => {
    if (!isTrustedShellIpcSender(event)) throw new Error("untrusted sender");
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("invalid desktop settings");
    const values = patch as Record<string, unknown>;
    const candidate: DesktopSettings = {
      zoomFactor: values.zoomFactor === undefined ? settings.zoomFactor : values.zoomFactor as number,
      launchAtLogin: values.launchAtLogin === undefined ? settings.launchAtLogin : values.launchAtLogin as boolean,
      showOnTray: values.showOnTray === undefined ? settings.showOnTray : values.showOnTray as boolean,
      closeBehavior: values.closeBehavior === undefined ? settings.closeBehavior : values.closeBehavior as DesktopSettings["closeBehavior"],
    };
    if (![0.8, 0.9, 1, 1.1, 1.25].includes(candidate.zoomFactor)) throw new Error("invalid zoom factor");
    if (typeof candidate.launchAtLogin !== "boolean" || typeof candidate.showOnTray !== "boolean") throw new Error("invalid desktop setting");
    if (candidate.closeBehavior !== "background" && candidate.closeBehavior !== "quit") throw new Error("invalid close behavior");
    const previous = settings;
    try {
      settings = candidate;
      writeDesktopSettings(candidate);
      applyDesktopSettings();
    } catch (error) {
      settings = previous;
      try { writeDesktopSettings(previous); } catch { /* preserve original failure */ }
      try { applyDesktopSettings(); } catch { /* best effort rollback of native effects */ }
      throw error;
    }
    return settings;
  });
}

function registerDownloadSettingsHandlers(): void {
  ipcMain.handle(IPC_DOWNLOAD_SETTINGS_GET, (event) => {
    if (!isTrustedShellIpcSender(event)) throw new Error("untrusted sender");
    return downloadSettings;
  });
  ipcMain.handle(IPC_DOWNLOAD_SETTINGS_SET, (event, patch: unknown) => {
    if (!isTrustedShellIpcSender(event)) throw new Error("untrusted sender");
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("invalid download settings");
    if ("directory" in patch) throw new Error("download directory must be selected natively");
    const values = patch as Record<string, unknown>;
    const candidate: DownloadSettings = {
      directory: downloadSettings.directory,
      askBeforeSaving: values.askBeforeSaving === undefined ? downloadSettings.askBeforeSaving : values.askBeforeSaving as boolean,
    };
    if (typeof candidate.directory !== "string" || !candidate.directory || typeof candidate.askBeforeSaving !== "boolean") throw new Error("invalid download setting");
    const previous = downloadSettings;
    try {
      writeDownloadSettings(candidate);
      downloadSettings = candidate;
    } catch (error) {
      downloadSettings = previous;
      throw error;
    }
    return downloadSettings;
  });
  ipcMain.handle(IPC_DOWNLOAD_DIRECTORY_CHOOSE, async (event) => {
    if (!isTrustedShellIpcSender(event)) throw new Error("untrusted sender");
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return downloadSettings;
    const next = { ...downloadSettings, directory: result.filePaths[0] };
    writeDownloadSettings(next);
    downloadSettings = next;
    return downloadSettings;
  });
}

function registerDownloadHandler(): void {
  session.defaultSession.on("will-download", (event, item) => {
    const urls = [item.getURL(), ...(item.getURLChain?.() ?? [])];
    let request: PendingDownload | undefined;
    for (const url of urls) {
      const pending = pendingDownloads.get(url);
      if (!pending?.length) continue;
      request = pending.shift();
      if (pending.length === 0) pendingDownloads.delete(url);
      break;
    }
    if (!request) {
      item.setSaveDialogOptions({
        defaultPath: join(downloadSettings.directory, sanitizeDownloadFilename(item.getFilename(), "download")),
      });
      return;
    }
    const id = request?.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const sender = request?.sender;
    const requestedFilename = request?.filename || sanitizeDownloadFilename(item.getFilename(), "download");
    const sendStatus = (status: Omit<DownloadStatus, "id" | "filename">, filename = requestedFilename) => {
      if (!sender || sender.isDestroyed()) return;
      sender.send(IPC_DOWNLOAD_STATUS, { id, filename, ...status } satisfies DownloadStatus);
    };
    let savePath: string | undefined;
    let userCancelled = downloadSettings.askBeforeSaving;
    item.on("updated", () => sendStatus({ state: "progress", receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes() }));
    item.once("done", (_event, state) => {
      const nextState = state === "completed" ? "completed" : state === "cancelled" ? (userCancelled ? "cancelled" : "failed") : "failed";
      sendStatus({ state: nextState }, savePath ? basename(savePath) : undefined);
      if (savePath) reservedDownloadPaths.delete(savePath);
    });
    const path = downloadSettings.directory;
    if (!downloadSettings.askBeforeSaving) {
      try {
        fs.mkdirSync(path, { recursive: true });
        const original = join(path, requestedFilename);
        savePath = original;
        let index = 1;
        while (fs.existsSync(savePath) || reservedDownloadPaths.has(savePath)) {
          const name = basename(original, extname(original));
          savePath = join(path, `${name} (${index++})${extname(original)}`);
        }
        reservedDownloadPaths.add(savePath);
        item.setSavePath(savePath);
        sendStatus({ state: "started" }, basename(savePath));
      } catch {
        item.cancel();
      }
      return;
    }

    try {
      item.setSaveDialogOptions({ defaultPath: join(path, requestedFilename) });
    } catch {
      userCancelled = false;
      item.cancel();
    }
  });
}

function registerDownloadUrlHandler(): void {
  ipcMain.handle(IPC_DOWNLOAD_URL, (event, url: unknown, filename?: unknown, requestId?: unknown) => {
    if (!isTrustedShellIpcSender(event) || typeof url !== "string") throw new Error("invalid download URL");
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("invalid download URL");
    const requestedFilename = sanitizeDownloadFilename(filename, "download");
    const generatedId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const id = typeof requestId === "string" && requestId ? requestId : generatedId;
    const queue = pendingDownloads.get(parsed.href) || [];
    const request = { id, sender: event.sender, filename: requestedFilename };
    queue.push(request);
    pendingDownloads.set(parsed.href, queue);
    setTimeout(() => {
      const current = pendingDownloads.get(parsed.href);
      const index = current?.findIndex((entry) => entry.id === id) ?? -1;
      if (current && index >= 0) {
        const request = current[index];
        current.splice(index, 1);
        if (current.length === 0) pendingDownloads.delete(parsed.href);
        if (!request.sender.isDestroyed()) {
          request.sender.send(IPC_DOWNLOAD_STATUS, {
            id,
            state: "expired",
            filename: "",
          } satisfies DownloadStatus);
        }
      }
    }, 60_000);
    event.sender.downloadURL(parsed.href);
    return id;
  });
}

function registerSystemSettingsHandler(): void {
  ipcMain.handle(IPC_OPEN_SYSTEM_SETTINGS, async (event, target: unknown) => {
    if (!isTrustedShellIpcSender(event) || (target !== "microphone" && target !== "notifications")) return false;
    const url = process.platform === "darwin"
      ? target === "microphone" ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone" : "x-apple.systempreferences:com.apple.preference.notifications"
      : process.platform === "win32"
        ? target === "microphone" ? "ms-settings:privacy-microphone" : "ms-settings:notifications"
        : null;
    if (!url) return false;
    try { await shell.openExternal(url); return true; } catch { return false; }
  });
}

function readKeepAwakePreference(): boolean {
  for (const path of [keepAwakeSettingsPath(), legacyKeepAwakeSettingsPath()]) {
    try {
      const raw = JSON.parse(fs.readFileSync(path, "utf8"));
      if (typeof raw?.keepAwake === "boolean") return raw.keepAwake;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && !(error instanceof SyntaxError)) return false;
    }
  }
  return false;
}

function writeKeepAwakePreference(enabled: boolean) {
  const path = keepAwakeSettingsPath();
  let settings: Record<string, unknown> = {};
  try {
    const raw = JSON.parse(fs.readFileSync(path, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Invalid keep-awake settings file");
    }
    settings = raw;
  } catch (error) {
    // A truncated/corrupt preference must not prevent the user from saving a
    // new value; the next atomic write replaces it.
  }
  settings.keepAwake = enabled;
  const tempPath = `${path}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2));
  try {
    fs.renameSync(tempPath, path);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch { /* best effort cleanup */ }
    throw error;
  }
}

function applyKeepAwake(enabled: boolean): boolean {
  if (enabled && keepAwakeBlockerId === null) {
    keepAwakeBlockerId = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!enabled && keepAwakeBlockerId !== null) {
    if (powerSaveBlocker.isStarted(keepAwakeBlockerId)) {
      powerSaveBlocker.stop(keepAwakeBlockerId);
    }
    keepAwakeBlockerId = null;
  }
  keepAwakeEnabled = enabled;
  return keepAwakeEnabled;
}

function registerKeepAwakeHandlers() {
  ipcMain.handle(IPC_KEEP_AWAKE_GET, () => keepAwakeEnabled);
  ipcMain.handle(IPC_KEEP_AWAKE_SET, (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("keep-awake value must be boolean");
    writeKeepAwakePreference(enabled);
    const applied = applyKeepAwake(enabled);
    return applied;
  });
}

/* ---------- fleet preview trusted hosts ---------- */

const fleetTrustedHostsPath = () => join(app.getPath("userData"), "fleet-trusted-hosts.json");

function readFleetTrustedHosts(): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(fleetTrustedHostsPath(), "utf8"));
    if (!Array.isArray(raw)) throw new Error("Invalid fleet-trusted-hosts file");
    return raw.filter((h): h is string => typeof h === "string");
  } catch {
    return [];
  }
}

function writeFleetTrustedHosts(hosts: string[]): void {
  const path = fleetTrustedHostsPath();
  const tempPath = `${path}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(hosts, null, 2));
  try {
    fs.renameSync(tempPath, path);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch { /* best effort cleanup */ }
    throw error;
  }
}

function rememberFleetTrustedHost(host: string): void {
  const hosts = new Set(readFleetTrustedHosts());
  hosts.add(host);
  writeFleetTrustedHosts(Array.from(hosts));
}

// One prompt per host at a time: rapid clicks (or several unknown-host fleet
// links clicked in succession) would otherwise stack independent native
// modals, and concurrent rememberFleetTrustedHost writes race on the same
// temp/target path. Concurrent callers await the same in-flight result.
const inflightFleetTrustPrompts = new Map<string, Promise<boolean>>();

async function promptFleetTrustOnce(
  win: Electron.BrowserWindow,
  host: string,
  href: string,
): Promise<boolean> {
  const existing = inflightFleetTrustPrompts.get(host);
  if (existing) return existing;
  const prompt = (async (): Promise<boolean> => {
    const { response, checkboxChecked } = await dialog.showMessageBox(win, {
      type: "warning",
      title: "信任此域名以打开任务预览？",
      message: `是否允许在“${host}”下打开任务预览？`,
      detail: `链接：${href}`,
      buttons: ["允许", "拒绝"],
      defaultId: 1, // 默认拒绝
      cancelId: 1, // Esc / 关闭窗口也按"拒绝"处理，弹窗失败永远 fail-closed
      checkboxLabel: "不再询问此域名",
      checkboxChecked: false,
    });
    if (checkboxChecked && response === 0) {
      try {
        rememberFleetTrustedHost(host);
      } catch {
        // A storage failure must not convert the user's explicit 允许 into a
        // reject: degrade to "trusted for this click, not remembered".
      }
    }
    return response === 0;
  })();
  inflightFleetTrustPrompts.set(host, prompt);
  try {
    return await prompt;
  } finally {
    inflightFleetTrustPrompts.delete(host);
  }
}

function registerFleetTrustHostHandler() {
  ipcMain.handle(
    IPC_ASK_TRUST_FLEET_HOST,
    async (_event, rawUrl: unknown): Promise<{ trusted: boolean }> => {
      // Validate inputs instead of trusting the renderer blindly. The host
      // is derived from the validated URL here, never taken from the
      // renderer, so a caller cannot cache-trust one host while displaying
      // another.
      if (typeof rawUrl !== "string") return { trusted: false };
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(rawUrl);
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
          return { trusted: false };
        }
      } catch {
        return { trusted: false };
      }
      const host = parsedUrl.hostname;
      if (readFleetTrustedHosts().includes(host)) return { trusted: true };

      const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
      if (!win || win.isDestroyed()) return { trusted: false };
      return { trusted: await promptFleetTrustOnce(win, host, parsedUrl.href) };
    }
  );
}

type OidcFlow = {
  origin: string;
  authcode: string;
  providerId: string;
  // Canonical authorize URL the renderer built to start this flow. Stored
  // verbatim so the interceptor can compare navigations by literal string
  // (canonicalized through WHATWG URL) instead of rebuilding the URL from
  // (origin + provider id) — see isOidcAuthorizeNavigation and P1-1 in the
  // review notes. It is required so the interceptor never guesses a backend
  // authorize path from provider metadata.
  authorizeUrl: string;
  expiresAt: number;
};
const oidcExpectedFlows = new WeakMap<BrowserWindow, OidcFlow>();
const OIDC_FLOW_TTL_MS = 5 * 60 * 1000;

const isDevelopment = !app.isPackaged && process.env.NODE_ENV !== "production";

/* ---------- file:// drive-root navigation guard ---------- */

/**
 * Attach the file:// drive-root navigation guard to a BrowserWindow.
 * Intercepts renderer-initiated navigations (will-navigate) that land on a
 * drive root and redirects back to index.html without minting a new session
 * sid (omitting the query lets SessionScope fall back to sessionStorage).
 *
 * NOTE: This function is only called from production code paths (the
 * `!isDevelopment` branch), so no isDevelopment guard is needed here.
 */
function attachFileRootGuard(win: BrowserWindow, indexPath: string): void {
  win.webContents.on("will-navigate", (event, url) => {
    if (!isDriveRootFileNavigation(url)) return;
    event.preventDefault();
    // Omit query: a new random sid would clobber the established session
    // (SessionScope.ensureSessionSid gives URL sid priority over storage).
    win.loadFile(indexPath).catch((err) => {
      console.error("[file-root-guard] loadFile failed:", err);
    });
  });
}
// dev 模式下渲染层 dev server 地址。端口需与 vite dev server 一致，
// 默认 3000（对齐旧 dev-ele 脚本）；可用 VITE_DEV_SERVER_URL 覆盖，
// 避免与机器上其它占用 3000 的进程（如 e2e vite）冲突。
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:3000";
const APP_EXIT_DELAY_MS = 1000;
const TRAY_FLASH_INTERVAL_MS = 1000;

// The renderer origin considered "our app shell" from the main process side.
// Mirrors preload's `isTrustedShell` decision so both boundaries agree.
//   - packaged build (`app.isPackaged`): shell loads build/index.html via
//     `loadFile`, so file:// is the only trusted protocol.
//   - dev build: the exact origin main pushed into `--octo-dev-origin=` (see
//     `getWindowConfig().webPreferences.additionalArguments`); a mismatched
//     VITE_DEV_SERVER_URL correctly disables OIDC IPC in dev.
const TRUSTED_SHELL_DEV_ORIGIN = isDevelopment
  ? new URL(DEV_SERVER_URL).origin
  : undefined;
const TRUSTED_SHELL_FILE_URL = pathToFileURL(INDEX_HTML).href;
// A same-document history.pushState changes frame.url without creating a new
// document. Track trust at document navigation time instead of re-evaluating
// the current pathname for every IPC call, otherwise normal SPA routes such
// as /drive would disable the entire desktop bridge.
const trustedShellContents = new WeakSet<Electron.WebContents>();

function trackTrustedShellDocument(win: BrowserWindow) {
  const isTrustedDocument = (url: string) =>
    isTrustedSenderUrl(url, TRUSTED_SHELL_DEV_ORIGIN, TRUSTED_SHELL_FILE_URL);
  const tracker = createTrustedShellDocumentTracker(isTrustedDocument);
  const updateTrust = (
    _event: Electron.Event,
    url: string,
    _httpResponseCode: number,
    _httpStatusText: string,
    isMainFrame: boolean,
  ) => {
    tracker.update(url, isMainFrame);
    if (tracker.isTrusted()) {
      trustedShellContents.add(win.webContents);
    } else {
      trustedShellContents.delete(win.webContents);
    }
  };
  // Trust follows committed main-frame documents only. A will-navigate or
  // will-redirect can be cancelled (for example by an external-protocol
  // link), in which case revoking here would permanently disable IPC for the
  // still-visible shell because no did-frame-navigate event restores it.
  win.webContents.on("did-frame-navigate", updateTrust);
  win.webContents.once("destroyed", () => trustedShellContents.delete(win.webContents));
}

// Guards every OIDC IPC handler against callers that are not our own
// renderer top-frame. Runs BEFORE any argument parsing so a malformed or
// hostile payload from an untrusted origin never reaches the URL / origin
// checks below.
//
// Returns the owning BrowserWindow on success. Returns `undefined` when the
// caller should be rejected; the caller decides whether that becomes a
// structured `{ ok: false, code: ... }` or a thrown error, matching each
// channel's existing contract.
function resolveTrustedOidcSender(
  event: Electron.IpcMainInvokeEvent,
): BrowserWindow | undefined {
  // Reject subframes outright. `senderFrame` is undefined when the frame has
  // already been destroyed between invoke() and dispatch — treat it as
  // untrusted rather than falling back to `event.sender.getURL()` because
  // that would let a navigated-away renderer keep talking to us.
  const frame = event.senderFrame;
  if (!frame) return undefined;
  // `frame.top` is the frame itself for the main frame. A subframe (iframe
  // hosting an IdP page mid-flow, a future <webview>, etc.) must not reach
  // this handler even if its URL happens to be file://.
  if (frame.top !== frame) return undefined;
  if (!trustedShellContents.has(event.sender)) return undefined;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return undefined;
  return win;
}

function isTrustedShellIpcSender(
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
): boolean {
  const frame = "senderFrame" in event ? event.senderFrame : undefined;
  if (frame && frame.top !== frame) return false;
  if (!trustedShellContents.has(event.sender)) return false;
  const win = BrowserWindow.fromWebContents(event.sender);
  return Boolean(win && !win.isDestroyed());
}


// Stream-read a fetch Response and cap the byte total. Discriminated result
// so the caller can distinguish an overflow from a timeout — the two share
// the same "body read never finished" symptom otherwise. UTF-8 is assumed
// because every OIDC endpoint on the allowlist emits JSON.
//
// `signal` must be the same AbortController that fired the fetch: net.fetch
// resolves the headers as soon as they arrive, so without the signal wired
// into the body read there is no watchdog covering a slow-body IdP response
// and the ipcMain.handle promise can hang forever.
type CappedRead =
  | { kind: "ok"; text: string }
  | { kind: "overflow" }
  | { kind: "aborted" }
  | { kind: "error" };
async function readCappedResponseText(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<CappedRead> {
  if (signal.aborted) return { kind: "aborted" };
  const body = response.body;
  if (!body) {
    // No stream (e.g. 204). Fall back to text() but keep the cap; text() also
    // observes the AbortSignal that was on the fetch, so a slow no-stream
    // response still gets watchdogged.
    let text: string;
    try {
      text = await response.text();
    } catch {
      return signal.aborted ? { kind: "aborted" } : { kind: "error" };
    }
    if (signal.aborted) return { kind: "aborted" };
    return text.length > maxBytes ? { kind: "overflow" } : { kind: "ok", text };
  }
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let total = 0;
  let out = "";
  // Wire the top-level timeout into the reader: if the AbortController fires
  // mid-body, cancel the reader promptly so we do not sit forever inside
  // reader.read().
  const onAbort = () => { try { void reader.cancel(); } catch { /* noop */ } };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* noop */ }
        return { kind: "overflow" };
      }
      out += decoder.decode(value, { stream: true });
    }
    if (signal.aborted) return { kind: "aborted" };
    out += decoder.decode();
    return { kind: "ok", text: out };
  } catch {
    return signal.aborted ? { kind: "aborted" } : { kind: "error" };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

// Returns a discriminated result rather than throwing so the renderer can
// map `code` to a localized message. Throwing would leak a raw English
// `Error.message` across the IPC boundary (Electron rejects `invoke` with it
// verbatim), which the login page cannot i18n.
ipcMain.handle(IPC_OIDC_AUTHORIZE_START, (event, apiURL: unknown, authcode: unknown, providerId: unknown, authorizeUrl: unknown) => {
  // Sender check first: any renderer that is not our top-frame shell must
  // not be able to seed the expected callback flow — otherwise a compromised
  // renderer could register an attacker-controlled origin and then have
  // main-process `will-redirect` intercept a forged callback to it.
  const win = resolveTrustedOidcSender(event);
  if (!win) return { ok: false as const, code: "untrusted-sender" as const };
  const origin = parseHttpOrigin(apiURL);
  if (!origin || !OIDC_API_ORIGIN || origin !== OIDC_API_ORIGIN) {
    return { ok: false as const, code: "invalid-origin" as const };
  }
  if (typeof authcode !== "string" || authcode === "" || typeof providerId !== "string" || providerId === "") {
    return { ok: false as const, code: "invalid-flow" as const };
  }
  if (typeof authorizeUrl !== "string" || authorizeUrl === "") {
    return { ok: false as const, code: "invalid-flow" as const };
  }
  const authorizeOrigin = parseHttpOrigin(authorizeUrl);
  if (authorizeOrigin !== OIDC_API_ORIGIN) {
    return { ok: false as const, code: "invalid-flow" as const };
  }
  let normalizedAuthorizeUrl: string;
  try { normalizedAuthorizeUrl = new URL(authorizeUrl).toString(); } catch {
    return { ok: false as const, code: "invalid-flow" as const };
  }
  oidcExpectedFlows.set(win, {
    origin: OIDC_API_ORIGIN,
    authcode,
    providerId,
    authorizeUrl: normalizedAuthorizeUrl,
    expiresAt: Date.now() + OIDC_FLOW_TTL_MS,
  });
  return { ok: true as const };
});

ipcMain.handle(IPC_OIDC_AUTHORIZE_END, (event) => {
  const win = resolveTrustedOidcSender(event);
  if (win) oidcExpectedFlows.delete(win);
  return { ok: !!win };
});

ipcMain.handle(IPC_OIDC_CLEAR_AUTH_SESSION, async (event) => {
  const win = resolveTrustedOidcSender(event);
  if (!win) return { ok: false as const, code: "untrusted-sender" as const };
  return clearAuthSessionCookies({
    session: win.webContents.session,
    origins: OIDC_END_SESSION_ORIGINS,
    log: { warn: (message) => console.warn(`[oidc] ${message}`) },
  });
});

ipcMain.handle(IPC_OIDC_OPEN_EXTERNAL, async (event, url: unknown) => {
  const win = resolveTrustedOidcSender(event);
  if (!win) return { ok: false as const };
  // Validation lives in oidcRedirect.ts so the URL/scheme allowlist is
  // covered by pure-function tests alongside the redirect helpers. Load the
  // validated URL in a hidden window: shell.openExternal would leave the user
  // in a browser/Web page after desktop logout.
  const validated = validateOpenExternalUrl(url, OIDC_END_SESSION_ORIGINS);
  if (validated.ok === false) {
    // Log the categorized reason + the URL's origin/pathname ONLY. The
    // end-session URL legitimately carries id_token_hint / logout_hint (JWTs)
    // as query values, so slicing the raw URL into the log — as the previous
    // implementation did — would leak the header and leading payload of a
    // real ID token every time an operator hit this misconfiguration.
    let rejectedOrigin: string | undefined;
    let rejectedPathname: string | undefined;
    if (typeof url === "string") {
      try {
        const parsed = new URL(url);
        rejectedOrigin = parsed.origin;
        rejectedPathname = parsed.pathname;
      } catch { /* keep undefined; the invalid-url reason already covers this */ }
    }
    const hint = (() => {
      switch (validated.reason) {
        case "origin":
          return "IdP origin is missing from VITE_OIDC_TRUSTED_ORIGINS";
        case "redirect-origin":
          return "post_logout_redirect_uri origin is missing from VITE_OIDC_TRUSTED_ORIGINS (this is the web app origin, not the IdP)";
        case "redirect-duplicate":
          return "URL carries duplicate redirect parameters — reject rather than guess which value the IdP will follow";
        case "redirect-parse":
          return "redirect parameter is not a valid URL";
        case "scheme":
          return "end-session endpoint must be https (RFC 8252 §8.10)";
        case "path":
          return "path does not end in an OIDC end-session segment (logout/end_session/signout/…)";
        case "query-unknown":
          return "URL carries an unknown query parameter — extend OIDC_END_SESSION_QUERY_ALLOWLIST intentionally, or fix the caller";
        case "userinfo":
          return "URL carries embedded credentials";
        case "fragment":
          return "URL carries a fragment";
        case "invalid-url":
          return "URL is malformed";
        case "not-string":
          return "value is not a non-empty string";
        default:
          return "shape validation failed";
      }
    })();
    console.warn(
      "[oidc] IPC_OIDC_OPEN_EXTERNAL rejected. Falling back to local logout. " +
        `reason=${validated.reason}; hint=${hint}; ` +
        `origin=${rejectedOrigin ?? "(unparseable)"}; ` +
        `pathname=${rejectedPathname ?? "(unparseable)"}; ` +
        `type=${typeof url}`,
    );
    return { ok: false as const };
  }
  let logoutWindow: BrowserWindow | undefined;
  try {
    const endSession = new URL(validated.value);
    // Cover all six redirect keys the query allowlist accepts (returnTo etc.),
    // not just post_logout_redirect_uri/redirect_uri — otherwise a returnTo-
    // style IdP leaves redirectURL undefined and the first did-navigate
    // settles(true) at document commit, destroying the window before the
    // front-channel logout iframes can complete.
    const redirectURL = extractEndSessionRedirect(endSession);

    logoutWindow = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    logoutWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    const result = await new Promise<boolean>((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        resolve(ok);
      };
      // Navigation-safety listeners live in a testable helper (see
      // oidcRedirect.ts). The helper is what enforces the shared Electron 26
      // arg tuple (event, url, isInPlace, isMainFrame, pid, rid) on both
      // will-navigate and will-redirect — a regex over source cannot tell
      // isMainFrame apart from isInPlace when both are boolean, so this
      // extraction lets a mocked-webContents test drive the real tuple.
      // The helper also fast-fails on a blocked main-frame navigation
      // (settle(false)) so the UI does not wait for the 15s watchdog.
      attachLogoutWindowNavigationListeners({
        webContents: logoutWindow!.webContents,
        trustedOrigins: OIDC_END_SESSION_ORIGINS,
        redirectURL,
        onSettle: settle,
      });
      logoutWindow!.webContents.once("did-finish-load", () => {
        if (!redirectURL) settle(true);
      });
      // A timeout means the IdP logout was not confirmed. Report failure so
      // the renderer can complete local logout without claiming that the
      // provider session was cleared.
      timeout = setTimeout(() => settle(false), 15000);
      void logoutWindow!.loadURL(validated.value).catch(() => settle(false));
    });
    if (!logoutWindow.isDestroyed()) logoutWindow.destroy();
    return result ? { ok: true as const } : { ok: false as const };
  } catch {
    if (logoutWindow && !logoutWindow.isDestroyed()) logoutWindow.destroy();
    return { ok: false as const };
  }
});

// Packaged renderer pages use file://, which is not an allowed CORS origin on
// the OIDC API. Keep the request in the main process instead of weakening
// BrowserWindow.webSecurity for the whole application. Only the two fixed
// OIDC endpoints are accepted; arbitrary URLs must never become an IPC proxy.
ipcMain.handle(IPC_OIDC_HTTP_REQUEST, async (event, request: unknown) => {
  // Sender check first — see resolveTrustedOidcSender. `net.fetch` uses the
  // default session and therefore carries the shell's cookies; without this
  // gate, any non-shell renderer could borrow those credentials to hit the
  // two whitelisted OIDC endpoints.
  const win = resolveTrustedOidcSender(event);
  if (!win) throw new Error("Untrusted OIDC sender");
  const validated = validateOidcHttpRequest(request, OIDC_API_ORIGIN);
  if (validated.ok === false) throw new Error(validated.error);
  const { url, method, body: requestBody, token } = validated.value;
  // Single watchdog covering BOTH headers and body — net.fetch resolves as
  // soon as the response head is available, so if `clearTimeout` fired in a
  // fetch-only `finally`, a slow-body IdP would hang ipcMain.handle
  // indefinitely (P1-4). Keep the timer live until the body has been
  // consumed (or overflow / abort has ended the read).
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  let read: CappedRead;
  try {
    try {
      response = await net.fetch(url, {
        method,
        redirect: "error",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
          ...(token !== undefined && token !== "" ? { token } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify(requestBody ?? {}) } : {}),
      });
    } catch (err) {
      // AbortError surfaces as a plain fetch rejection; surface a stable
      // message the renderer can map (bind/logout callers already treat any
      // thrown error as a transport failure).
      if (controller.signal.aborted) throw new Error("OIDC request timed out");
      throw err;
    }
    // Cap the response body so a hostile or misconfigured endpoint cannot
    // inflate main-process memory. The OIDC endpoints on the allowlist all
    // return small JSON objects; anything above OIDC_HTTP_MAX_RESPONSE_BYTES
    // is a signal to abort rather than surface to the renderer.
    read = await readCappedResponseText(response, OIDC_HTTP_MAX_RESPONSE_BYTES, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
  if (read.kind === "aborted") throw new Error("OIDC request timed out");
  if (read.kind === "overflow") throw new Error("OIDC response too large");
  if (read.kind === "error") throw new Error("OIDC response could not be read");
  const responseText = read.text;
  let responseBody: unknown = undefined;
  if (responseText !== "") {
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = responseText;
    }
  }
  // Keep the HTTP boundary lossless across Electron IPC. The renderer needs
  // the status to preserve bind semantics (401/409/410/429), while callers
  // such as logout still need the original response body and status.
  return {
    __octoOidcHttpResponse: true as const,
    ok: response.ok,
    status: response.status,
    body: responseBody,
  };
});

// The `will-redirect` / `will-navigate` listeners registered here are
// intentionally long-lived — they live for the entire BrowserWindow lifetime
// so a user can retry SSO multiple times in the same window. Each retry
// re-arms the interceptor via the expected-flow WeakMap (renderer
// calls `oidc-authorize-start` before every authorize navigation).
//
// The origin is kept through the callback reload because the renderer still
// needs it for authstatus polling and bind API calls. The renderer explicitly
// ends the flow after that work is complete.
function registerOidcReturnRedirect(win: BrowserWindow, webUrl: string, sid: string) {
  const restoreShell = () => {
    if (!win.isDestroyed()) win.loadFile(webUrl, { query: { sid } });
  };

  const handleNavigation = (event: Electron.Event, url: string, isMainFrame: boolean) => {
    if (!isMainFrame) return;
    const flow = oidcExpectedFlows.get(win);
    // No armed flow ⇒ the interceptor has no business touching this
    // navigation. Previously we tore the window back to the shell whenever a
    // flow was armed-but-expired; that also intercepted every non-OIDC
    // navigation the packaged app tries to perform between flows (e.g. a
    // support page opened from settings). With no armed flow, bail out and
    // let Electron follow the navigation normally.
    if (!flow) return;
    const decision = classifyOidcNavigation({
      url,
      origin: flow.origin,
      providerId: flow.providerId,
      authorizeUrl: flow.authorizeUrl,
      authcode: flow.authcode,
      expiresAt: flow.expiresAt,
    });
    if (decision === "expired") {
      // Once a flow expires, the only safe recovery is to return to the local
      // shell. Leaving the current navigation alive can strand the sole
      // BrowserWindow on an IdP/API page with no address bar or back button.
      oidcExpectedFlows.delete(win);
      event.preventDefault();
      restoreShell();
      return;
    }
    if (decision === "authorize" || decision === "same-origin" || decision === "external") return;
    if (decision === "invalid-callback") {
      event.preventDefault();
      restoreShell();
      return;
    }

    event.preventDefault();
    oidcExpectedFlows.delete(win);
    // `decision === "callback"` is only returned after the parser and
    // correlation checks pass. Parse again here to retain the typed callback
    // payload used to construct the trusted shell query.
    const parsedCallback = parseOidcCallback(url, flow.origin);
    if (!parsedCallback) {
      restoreShell();
      return;
    }
    win.loadFile(webUrl, { query: withTrustedSessionSid(parsedCallback, sid) });
  };

  win.webContents.on("will-redirect", (_event, url, _isInPlace, isMainFrame) => {
    handleNavigation(_event, url, isMainFrame);
  });
  win.webContents.on("will-navigate", (event, url) => {
    handleNavigation(event, url, true);
  });
  win.webContents.on("did-fail-load", (_event, errorCode, _errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    const flow = oidcExpectedFlows.get(win);
    if (flow && flow.expiresAt > Date.now()) restoreShell();
  });

  // Continuous TTL watchdog. The previous implementation was one-shot: it
  // scheduled a single check `OIDC_FLOW_TTL_MS + 50` in the future, so if a
  // second flow was armed in the same window before that timer fired the
  // watchdog would either skip the new flow's expiry (fires early and finds
  // nothing to clean up) or take a full TTL to fire again. Poll on a fixed
  // cadence instead — the check itself is O(1) (single WeakMap lookup) so
  // the cost is negligible, and it also survives the wall clock jumping
  // backwards (e.g. NTP correction) without needing timer bookkeeping.
  const TTL_WATCHDOG_INTERVAL_MS = 30_000;
  const watchdog = setInterval(() => {
    if (win.isDestroyed()) {
      clearInterval(watchdog);
      return;
    }
    const flow = oidcExpectedFlows.get(win);
    if (flow && flow.expiresAt <= Date.now()) {
      oidcExpectedFlows.delete(win);
      restoreShell();
    }
  }, TTL_WATCHDOG_INTERVAL_MS);
  // Node timers keep the event loop alive; unref so a stale window with an
  // expired flow does not block app quit.
  if (typeof watchdog.unref === "function") watchdog.unref();
  win.on("closed", () => clearInterval(watchdog));
}

const registerWindowFocusHandler = () => {
  if (isWindowFocusHandlerRegistered) return;

  ipcMain.handle(IPC_WINDOW_IS_FOCUSED, (event) => {
    if (!isTrustedShellIpcSender(event)) return false;
    // Query the window that owns the renderer making the request. This also
    // keeps focus suppression correct for auxiliary windows.
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const win =
      (senderWindow && !senderWindow.isDestroyed?.() ? senderWindow : null) ||
      (mainWindow && !mainWindow.isDestroyed?.() ? mainWindow : null);
    if (!win) return false;
    return win.isFocused() && win.isVisible() && !win.isMinimized();
  });
  isWindowFocusHandlerRegistered = true;
};

let mainMenu: (Electron.MenuItemConstructorOptions | Electron.MenuItem)[] = [
  {
    label: "OCTO",
    submenu: [
      {
        label: `关于OCTO`,
      },
      { type: "separator" },
      {
        label: "退出",
        accelerator: "Command+Q",
        click() {
          forceQuit = true;
          mainWindow = null;
          setTimeout(() => {
            app.exit(0);
          }, APP_EXIT_DELAY_MS);
        },
      },
    ],
  },
  {
    label: "编辑",
    submenu: [
      {
        role: "undo",
        label: "撤销",
      },
      {
        role: "redo",
        label: "重做",
      },
      {
        type: "separator",
      },
      {
        role: "cut",
        label: "剪切",
      },
      {
        role: "copy",
        label: "复制",
      },
      {
        role: "paste",
        label: "粘贴",
      },
      {
        role: "pasteAndMatchStyle",
        label: "粘贴并匹配样式",
      },
      {
        role: "delete",
        label: "删除",
      },
      {
        role: "selectAll",
        label: "全选",
      },
    ],
  },
  {
    label: "显示",
    submenu: [
      {
        label: isFullScreen ? "全屏" : "退出全屏",
        accelerator: "Shift+Cmd+F",
        click() {
          isFullScreen = !isFullScreen;

          mainWindow.show();
          mainWindow.setFullScreen(isFullScreen);
        },
      },
      {
        label: "切换会话",
        accelerator: "Shift+Cmd+M",
        click() {
          mainWindow.show();
          mainWindow.webContents.send(IPC_SHOW_CONVERSATIONS);
        },
      },
      {
        type: "separator",
      },
      {
        type: "separator",
      },
      ...(isDevelopment
        ? [
            {
              role: "toggleDevTools" as const,
              label: "切换开发者工具",
            },
          ]
        : []),
      {
        role: "togglefullscreen",
        label: "切换全屏",
      },
    ],
  },
  {
    label: "窗口",
    role: "window",
    submenu: [
      {
        label: "新建窗口",
        accelerator: "Command+N",
        click() {
          createNewWindow();
        },
      },
      {
        label: "最小化",
        role: "minimize",
      },
      {
        label: "关闭窗口",
        role: "close",
      },
    ],
  },
  {
    label: "帮助",
    role: "help",
    submenu: [
      {
        type: "separator",
      },
      {
        label: "刷新",
        accelerator: "CmdOrCtrl+R",
        click: (_item, focusedWindow) => {
          // Reload through index.html only when the window is on a file://
          // shell document (drive-root guard, see reloadShell). Non-shell
          // documents (e.g. an IdP page mid-SSO) keep native reload.
          if (focusedWindow) reloadShell(focusedWindow, false);
        },
      },
      {
        label: "强制刷新",
        accelerator: "CmdOrCtrl+Shift+R",
        click: (_item, focusedWindow) => {
          if (focusedWindow) reloadShell(focusedWindow, true);
        },
      },
    ],
  },
];

let trayMenu: Electron.MenuItemConstructorOptions[] = [
  {
    label: "显示窗口",
    click() {
      let isVisible = mainWindow.isVisible();
      isVisible ? mainWindow.hide() : mainWindow.show();
    },
  },
  {
    type: "separator",
  },
  {
    label: "退出",
    accelerator: "Command+Q",
    click() {
      forceQuit = true;
      mainWindow = null;
      setTimeout(() => {
        app.exit(0);
      }, APP_EXIT_DELAY_MS);
    },
  },
];


/**
 * 设置主窗口任务栏闪烁、系统托盘图闪烁及Mac端消息未读消息
 * @param unread Mac端消息未读消息
 * @param isFlash 是否闪烁 true为闪烁，false为取消
 * @returns
 */
let flashTimer: any = null;
let currentUnreadCount = 0;

function createMacTrayIcon(iconPath: string) {
  const source = nativeImage.createFromPath(iconPath);
  const trayImage = nativeImage.createEmpty();

  for (const [scaleFactor, size] of [[1, 22], [2, 44], [3, 66]] as const) {
    trayImage.addRepresentation({
      scaleFactor,
      buffer: source.resize({ width: size, height: size }).toPNG(),
    });
  }

  return trayImage;
}

function updateTray(unread?: number, isFlash = false): any {
  // IPC arguments are untrusted renderer data. Normalize them here so a
  // transient undefined/string value cannot produce a malformed title.
  const unreadCount = unread === undefined
    ? currentUnreadCount
    : Number.isFinite(Number(unread))
      ? Math.max(0, Math.floor(Number(unread)))
      : 0;
  currentUnreadCount = unreadCount;

  // linux 系统不支持 tray
  if (process.platform === "linux") {
    return;
  }

  if (settings.showOnTray) {
    let contextmenu = Menu.buildFromTemplate(trayMenu);

    if (!trayIcon) {
      const trayIconPath = getNoMessageTrayIcon();
      trayIcon = isOsx
        ? createMacTrayIcon(trayIconPath)
        : trayIconPath;
    }

    setTimeout(() => {
      if (!settings.showOnTray) return;
      if (!tray) {
        // Init tray icon
        tray = new Tray(trayIcon);
        // macOS uses the status-item click for its menu; Windows shows this
        // menu on right-click automatically. Keep the explicit window restore
        // click only on Windows to avoid two actions on one macOS click.
        if (!isOsx) tray.setContextMenu(contextmenu);
        tray.setToolTip(OCTO_CONFIG.name);

        tray.on("click", () => {
          if (isOsx) {
            tray.popUpContextMenu(contextmenu);
          } else if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
          }
        });
      }

      if (isOsx) {
        // Re-apply the purple logo so an already-created Tray cannot retain
        // the previous template icon after the renderer is refreshed.
        tray.setImage(trayIcon);
        // Let macOS render the count as plain text to the right of the logo.
        tray.setTitle(unreadCount > 0 ? ` ${unreadCount}` : "");
      }

      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(isFlash);
      //设置系统托盘闪烁
      if(isFlash){
        clearInterval(flashTimer)
		    let flag = false
        // 优化: 减少闪烁频率从500ms到1000ms，减少50%的CPU使用
        flashTimer = setInterval(() => {
          flag = !flag
          if(flag){
            tray.setImage(NativeImage.createEmpty());
          }else{
            tray.setImage(trayIcon);
          }
      }, TRAY_FLASH_INTERVAL_MS);
      }else{
        if (!isOsx) {
          // Windows/Linux: directly use the path icon.
          tray.setImage(trayIcon);
        }
        clearInterval(flashTimer);
      }
    });
  } else {
    clearInterval(flashTimer);
    if (!tray) return;
    tray.destroy();
    tray = null;
  }
}

function createMenu() {
  const menu = Menu.buildFromTemplate(mainMenu);

  if (isOsx) {
    // macOS: Set application menu (appears in menu bar)
    Menu.setApplicationMenu(menu);
  } else {
    // Windows/Linux: Set window menu (appears in window title bar)
    Menu.setApplicationMenu(menu);
    // Also set it on the main window for Windows
    if (mainWindow) {
      mainWindow.setMenu(menu);
    }
  }
}

function regShortcut() {
  globalShortcut.register("CommandOrControl+shift+a", () => {
    isMainWindowFocusedWhenStartScreenshot = mainWindow.isFocused();
    console.log(
      "isMainWindowFocusedWhenStartScreenshot",
      mainWindow.isFocused()
    );
    screenshots.startCapture();
  });
  // 打开所有窗口控制台 (开发环境)
  if (isDevelopment) {
    globalShortcut.register("ctrl+shift+i", () => {
      let windows = BrowserWindow.getAllWindows();
      windows.forEach((win: any) => win.openDevTools());
    });
  }
}

// 创建新窗口的通用配置
const getWindowConfig = () => {
  return {
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    // frame: true, // * app边框(包括关闭,全屏,最小化按钮的导航栏) @false: 隐藏
    // titleBarStyle: "hidden",
    // transparent: true, // * app 背景透明
    hasShadow: true, // * app 边框阴影
    show: false, // 启动窗口时隐藏,直到渲染进程加载完成「ready-to-show 监听事件」 再显示窗口,防止加载时闪烁
    resizable: true, // 禁止手动修改窗口尺寸
    // Windows: 允许用户按 Alt 键显示/隐藏菜单栏
    autoHideMenuBar: isWin,
    webPreferences: {
      // 加载脚本
      preload: join(__dirname, "..", "preload", "index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      // Keep the renderer OS-sandboxed while it displays IdP content.
      sandbox: true,
      devTools: isDevelopment,
      // Pass the dev server origin to preload via `process.argv`. Preload
      // needs it to whitelist IPC calls in dev mode (see preload/index.ts
      // `isTrustedShell`). Hard-coding `http://localhost:3000` there would
      // break whenever VITE_DEV_SERVER_URL is overridden. The value is
      // main-process-controlled, so the renderer cannot spoof it.
      additionalArguments: [
        `--octo-shell-file=${TRUSTED_SHELL_FILE_URL}`,
        ...(isDevelopment ? [`--octo-dev-origin=${new URL(DEV_SERVER_URL).origin}`] : []),
      ],
    },
    // frame: !isWin,
  };
};

// 创建新窗口
const createNewWindow = () => {
  const newWindow = new BrowserWindow(getWindowConfig());
  trackTrustedShellDocument(newWindow);

  newWindow.center();
  newWindow.webContents.on("did-finish-load", () => {
    if (!newWindow.isDestroyed()) newWindow.webContents.setZoomFactor(settings.zoomFactor);
  });
  newWindow.once("ready-to-show", () => {
    newWindow.show(); // 显示窗口
    newWindow.focus();
  });

  newWindow.on("close", (e: any) => {
    // 新窗口关闭时直接销毁，不隐藏到托盘
    newWindow.destroy();
  });

  // 加载相同的页面
  if (isDevelopment) {
    newWindow.loadURL(`${DEV_SERVER_URL}?sid=${getRandomSid()}`);
  } else {
    process.env.DIST_ELECTRON = join(__dirname, "../");
    const WEB_URL = join(process.env.DIST_ELECTRON, "../build/index.html");
    const sid = getRandomSid();
    registerOidcReturnRedirect(newWindow, WEB_URL, sid);
    newWindow.loadFile(WEB_URL, { query: { sid } });
    attachFileRootGuard(newWindow, WEB_URL);
  }

  // 为新窗口设置菜单（Windows 需要）
  if (!isOsx) {
    const menu = Menu.buildFromTemplate(mainMenu);
    newWindow.setMenu(menu);
  }

  return newWindow;
};

const createMainWindow = async () => {
  mainWindow = new BrowserWindow(getWindowConfig());
  trackTrustedShellDocument(mainWindow);
  mainWindow.center();
  mainWindow.webContents.on("did-finish-load", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.setZoomFactor(settings.zoomFactor);
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.setTitle(OCTO_CONFIG.name);
    mainWindow.show(); // 显示窗口
    mainWindow.focus();
  });

  let quitAfterClose = false;
  mainWindow.on("close", (e: any) => {
    const canBackground = isOsx || (settings.showOnTray && Boolean(tray));
    if (quitAfterClose) return;
    if ((settings.closeBehavior === "quit" || !canBackground) && !forceQuit) {
      e.preventDefault();
      quitAfterClose = true;
      mainWindow.once("closed", () => {
        quitAfterClose = false;
        mainWindow = null;
        app.quit();
      });
      mainWindow.close();
    } else if (forceQuit) {
      mainWindow = null;
    } else {
      e.preventDefault();
      if (mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(false);
        mainWindow.once("leave-full-screen", () => mainWindow.hide());
      } else {
        mainWindow.hide();
      }
    }
  });
  if (isDevelopment) mainWindow.loadURL(DEV_SERVER_URL);
  if (!isDevelopment) {
    process.env.DIST_ELECTRON = join(__dirname, "../");
    const WEB_URL = join(process.env.DIST_ELECTRON, "../build/index.html");
    const sid = getRandomSid();
    registerOidcReturnRedirect(mainWindow, WEB_URL, sid);
    mainWindow.loadFile(WEB_URL, { query: { sid } });
    // Guard against file:// drive-root navigations (pushState "/" leak).
    attachFileRootGuard(mainWindow, WEB_URL);
  }

  ipcMain.on(IPC_SCREENSHOTS_START, (event, args) => {
    if (!isTrustedShellIpcSender(event)) return;
    console.log("main voip-message event", args);
    screenShotWindowId = event.sender.id;
    screenshots.startCapture();
  });

  ipcMain.handle(IPC_MEDIA_ACCESS_STATUS, async (event, mediaType: 'camera' | 'microphone')=>{
    if (!isTrustedShellIpcSender(event)) return 'denied';
    console.log(mediaType)
    //检测麦克风权限是否开启
    const getMediaAccessStatus = systemPreferences.getMediaAccessStatus(mediaType);
    if(getMediaAccessStatus !== 'granted'){
      //请求麦克风权限
      if (mediaType === 'camera' ||  mediaType === 'microphone') {
        await systemPreferences.askForMediaAccess(mediaType);
        return systemPreferences.getMediaAccessStatus(mediaType);
      }
    }
    return getMediaAccessStatus;
  })
  // 会话未读消息消息数量托盘提醒
  ipcMain.on(IPC_CONVERSATION_UNREAD_COUNT, (event, num) => {
    // The tray is global to the app, so only the main window may update it.
    // Auxiliary windows have independent renderer/session state and can start
    // with an empty conversation cache, which would otherwise clear the main
    // window's correct unread count.
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
      return;
    }

    // const isFlag = num > 0 && isWin ? true : false;
    updateTray(Number(num), false); // 不需要闪烁，闪烁很消耗性能
  });

  ipcMain.on(IPC_RESTART_APP,(event)=>{
    if (!isTrustedShellIpcSender(event)) return;
    restartApp()
  })

  // Test notification handler for debugging (development only)
  ipcMain.handle(IPC_NOTIFICATION_TEST_ICON, (event) => {
    if (!isTrustedShellIpcSender(event)) return false;
    if (!isDevelopment) return false;
    // Show a test notification
    electronNotificationManager.showNotification({
      title: "Icon Test",
      body: "Testing notification display",
      tag: "icon-test",
      urgency: 'normal',
      timeoutType: 'default',
    });

    return true;
  });

  createMenu();

  // Set up notification manager with main window
  electronNotificationManager.setMainWindow(mainWindow);
  electronNotificationManager.setSenderGuard(isTrustedShellIpcSender);

  // 检查更新
  checkUpdate(mainWindow)
};

// 重启应用
function restartApp() {
  app.relaunch();
  app.exit(0);
}

const ALLOWED_DEEP_LINK_SCHEMES = ["dmwork:"];

function isValidDeepLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_DEEP_LINK_SCHEMES.includes(parsed.protocol)) {
      return false;
    }
    const dangerousPatterns = /javascript:|data:|vbscript:|file:/i;
    if (dangerousPatterns.test(url)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function onDeepLink(url: string) {
  if (!isValidDeepLink(url)) {
    console.warn("Rejected invalid deep link:", url);
    return;
  }
  console.log("onOpenDeepLink", url);
  // Octo-Q Appendix D-1: macOS can deliver open-url before `ready` /
  // createMainWindow — dereferencing webContents would crash the process
  // instead of dropping the link. Guarded (the losing process is already
  // barred by the open-url handler's gotTheLock check).
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn("Deep link dropped: main window not ready:", url);
    return;
  }
  mainWindow.webContents.send(IPC_DEEP_LINK, url);
}

app.setName(OCTO_CONFIG.name);

// Shared console-based logger for migration plan/execute diagnostics
// (round-6 nit: plan-time diagnostics must go through the injected log, not
// bare console.*, so they can be captured by tests and routed).
const migrationLog = {
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string, err: unknown) => console.error(msg, err),
};

// One-time userData migration from the legacy DMWork profile (see
// userDataMigration.ts for the full design). Electron's single-instance lock
// is process-global, and the primary-instance lookup keys off the userData
// path — so pointing userData at the legacy dir BEFORE requestSingleInstanceLock()
// makes the lock contend with a legacy instance or a concurrent launch:
//   - a running legacy DMWork instance already holds that lock -> this launch
//     fails the lock and quits (with a dialog when we were about to migrate);
//   - a concurrent launch during the migration hits the same held lock and
//     quits — exactly one process is ever the migrator, no second window can
//     appear mid-copy.
// On success we relaunch so the next process takes the OCTO lock; on
// deferral/failure this session keeps the legacy path and retries next launch
// (bounded by breadcrumbs).
// This supersedes the temporary setPath('userData', <appData>/DMWork) fallback
// that #1258 carries until this PR lands.
const userDataPlan = planUserDataMigration(
  app.getPath("appData"),
  OCTO_CONFIG.name,
  migrationLog
);
if (userDataPlan.action !== "none") {
  app.setPath("userData", userDataPlan.oldDir);
}
userDataMigrationPending = userDataPlan.action !== "none";
keepAwakeEnabled = readKeepAwakePreference();
settings = readDesktopSettings();
downloadSettings = readDownloadSettings();

// Migration dialogs. Round-6 P2-2: dialog.showErrorBox called before `ready`
// degrades to stderr on Linux (documented in electron.d.ts), so every dialog
// is deferred behind app.whenReady(). Copy is bilingual via app.getLocale()
// (safe inside whenReady; a pre-ready main-process dialog cannot reach the
// renderer i18n bundle).
type MigrationDialogKind =
  | "lock"
  | "failed"
  | "skipped"
  | "plan-failed"
  | "retry-exhausted"
  | "occupied"
  | "destination-unreadable";

type MigrationDirs = { oldDir: string; newDir: string };
type MigrationDialogCopy = (dirs?: MigrationDirs) => { title: string; message: string };

const MIGRATION_DIALOGS: Record<MigrationDialogKind, { zh: MigrationDialogCopy; en: MigrationDialogCopy }> = {
  lock: {
    zh: () => ({
      title: "OCTO 无法启动（数据迁移中）",
      message:
        "另一个实例正在运行（可能是旧版 DMWork 尚未退出，或迁移正在进行）。请退出旧应用后重新启动。",
    }),
    en: () => ({
      title: "OCTO cannot start (data migration in progress)",
      message:
        "Another instance is running (the old DMWork app may not have quit, or a migration is in progress). Quit the old app and start again.",
    }),
  },
  failed: {
    zh: () => ({
      title: "OCTO 数据迁移未完成",
      message:
        "本次启动继续使用旧版数据（DMWork），下次启动会自动重试。若持续失败，请检查磁盘空间后重试。",
    }),
    en: () => ({
      title: "OCTO data migration incomplete",
      message:
        "This session continues on the legacy data (DMWork); the next launch will retry automatically. If it keeps failing, check your disk space.",
    }),
  },
  skipped: {
    zh: () => ({
      title: "OCTO 数据迁移已跳过",
      message:
        "目标目录（OCTO）出现了不属于迁移的数据，本次启动继续使用旧版数据（DMWork），两个数据目录均保留。",
    }),
    en: () => ({
      title: "OCTO data migration skipped",
      message:
        "The destination folder (OCTO) contains data the migration does not own. This session continues on the legacy data (DMWork); both folders are kept.",
    }),
  },
  "plan-failed": {
    zh: () => ({
      title: "OCTO 数据迁移暂缓",
      message: "数据迁移准备失败，本次继续使用旧版数据（DMWork），下次启动会自动重试。",
    }),
    en: () => ({
      title: "OCTO data migration deferred",
      message:
        "Migration preparation failed; this session continues on the legacy data (DMWork) and the next launch will retry.",
    }),
  },
  "retry-exhausted": {
    zh: (dirs) => ({
      title: "OCTO 数据迁移已暂停",
      message: `数据迁移多次失败，已暂停自动重试。本次继续使用旧版数据（DMWork）。如需重新尝试，请删除 ${actualBreadcrumbFile(dirs!.oldDir)} 后重启。`,
    }),
    en: (dirs) => ({
      title: "OCTO data migration paused",
      message: `The migration failed repeatedly and automatic retries are paused. This session continues on the legacy data (DMWork). To retry, delete ${actualBreadcrumbFile(dirs!.oldDir)} and restart.`,
    }),
  },
  occupied: {
    zh: (dirs) => ({
      title: "OCTO 数据迁移未执行",
      message: `目标目录（${dirs?.newDir}）已存在其他数据，为避免覆盖，迁移未执行。本次继续使用旧版数据（${dirs?.oldDir}），两个目录均保留。如需迁移，请先备份并移除其中一个目录。`,
    }),
    en: (dirs) => ({
      title: "OCTO data migration not performed",
      message: `The destination folder (${dirs?.newDir}) already contains other data, so the migration was not performed to avoid overwriting it. This session continues on the legacy data (${dirs?.oldDir}); both folders are kept. To migrate, back up and remove one of them first.`,
    }),
  },
  "destination-unreadable": {
    zh: (dirs) => ({
      title: "OCTO 数据迁移暂缓（目标不可访问）",
      message: `目标目录（${dirs?.newDir}）无法访问，无法确认迁移状态，本次继续使用旧版数据（${dirs?.oldDir}）。请检查目录权限后重启。`,
    }),
    en: (dirs) => ({
      title: "OCTO data migration deferred (destination unreadable)",
      message: `The destination folder (${dirs?.newDir}) cannot be inspected, so the migration state cannot be confirmed. This session continues on the legacy data (${dirs?.oldDir}). Check the folder permissions and restart.`,
    }),
  },
};

function migrationDialogCopy(kind: MigrationDialogKind, dirs?: MigrationDirs) {
  const zh = app.getLocale().toLowerCase().startsWith("zh");
  return MIGRATION_DIALOGS[kind][zh ? "zh" : "en"](dirs);
}

// Round-10 P2-5: the one-shot notice is recorded only AFTER the dialog has
// actually displayed (showErrorBox is synchronous) — recording before showing
// would hide the message forever if the process dies with the dialog up.
function showMigrationDialog(
  kind: MigrationDialogKind,
  dirs?: MigrationDirs,
  notice?: { appDataDir: string; key: string }
): void {
  app.whenReady().then(() => {
    const { title, message } = migrationDialogCopy(kind, dirs);
    dialog.showErrorBox(title, message);
    if (notice) {
      recordMigrationNotice(notice.appDataDir, notice.key);
    }
  });
}

// Runs under the single-instance lock taken on the legacy path: exactly one
// writer, and no other process can be using the legacy profile (its lock is
// ours). Extracted as a function so the success path can `return` after
// app.exit(0) (rounds 4-6 ask).
function runStartupMigration(userDataPlan: MigrationPlan): void {
  // Round-10 P2-1: a stale staging dir (credentials may have been copied into
  // it) must not linger when this session plans none/legacy — execute() only
  // cleans it on the migrate path. Lock-winner-scoped, so never concurrent.
  cleanupStaleStaging(userDataPlan.stagingDir, migrationLog);
  if (userDataPlan.action === "migrate") {
    try {
      const migrationResult = executeUserDataMigration(userDataPlan, { log: migrationLog });
      if (migrationResult === "done") {
        // Success: restart so the next process takes the <appData>/OCTO lock
        // and runs on the migrated profile. This process's lock is on the
        // legacy path (set before requestSingleInstanceLock above) and is
        // released on exit; the relaunched process plans "none" (marker
        // present) and locks OCTO normally.
        restartApp();
        return; // app.exit(0) terminates the process; nothing below may run
      }
      if (migrationResult === "failed") {
        // Make the failure visible (ENOSPC / rename refusal).
        showMigrationDialog("failed");
      } else if (migrationResult === "skipped") {
        // "skipped" means the destination holds data we do not own — staying
        // on the legacy path silently would let the next launch flip profiles
        // without the user knowing. Say it.
        showMigrationDialog("skipped");
      }
    } catch (err) {
      // Defensive backstop (round-2 P0-2): the migration must never take the
      // app down — fall back to the legacy profile and continue.
      console.error(
        "[userData] unexpected migration error; continuing on the legacy profile:",
        err
      );
    }
    return;
  }
  if (userDataPlan.action !== "legacy") {
    return; // "none": steady state, nothing to say
  }
  // Plan-time failure or retry budget exhausted — say so instead of silently
  // running on the legacy profile. Round-6 P1-2: destination-occupied names
  // both directories. Round-6 P2: retry-exhausted and occupied are one-shot
  // (notice bookkeeping lives in appData).
  const appDataDir = dirname(userDataPlan.oldDir);
  if (userDataPlan.reason === "too-many-failures") {
    if (shouldShowMigrationNotice(appDataDir, "retry-exhausted")) {
      showMigrationDialog(
        "retry-exhausted",
        { oldDir: userDataPlan.oldDir, newDir: userDataPlan.newDir },
        { appDataDir, key: "retry-exhausted" }
      );
    }
  } else if (userDataPlan.reason === "destination-occupied") {
    if (shouldShowMigrationNotice(appDataDir, "destination-occupied")) {
      showMigrationDialog(
        "occupied",
        { oldDir: userDataPlan.oldDir, newDir: userDataPlan.newDir },
        { appDataDir, key: "destination-occupied" }
      );
    }
  } else if (userDataPlan.reason === "destination-unreadable") {
    // Round-10 P2-6: distinct copy for an uninspectable destination; one-shot
    // like the other terminal reasons.
    if (shouldShowMigrationNotice(appDataDir, "destination-unreadable")) {
      showMigrationDialog(
        "destination-unreadable",
        { oldDir: userDataPlan.oldDir, newDir: userDataPlan.newDir },
        { appDataDir, key: "destination-unreadable" }
      );
    }
  } else {
    // "plan-failed" is intentionally NOT one-shot, unlike the two reasons
    // above: it is transient (a flaky volume / permission hiccup) and the
    // user should see it on every affected launch, whereas retry-exhausted
    // and destination-occupied are terminal states that only need one telling.
    showMigrationDialog("plan-failed");
  }
}

// isDevelopment && app.dock && app.dock.setIcon(logo);
app.on("open-url", (event, url) => {
  // Round-8 P1-1: the losing process may still receive app events between
  // `ready` and its async quit — onDeepLink dereferences mainWindow, which
  // never exists here.
  if (!gotTheLock) return;
  onDeepLink(url);
});

// 单例模式启动
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // Round-7 blocking (Jerry-Xin): DO NOT quit here and DO NOT defer to
  // whenReady().then — both allow the unconditional app.on("ready") handler
  // below to run createMainWindow() first (ready listeners run before the
  // whenReady microtask), opening a second Electron process/window against
  // the legacy profile and breaking the migration mutex. Instead, do nothing
  // here: the ready handler guards on gotTheLock, shows the lock dialog
  // (migration paths only, ready so Linux renders it) and quits before any
  // window or renderer initialization.
} else {
  runStartupMigration(userDataPlan);
  app.on("second-instance", (event, argv) => {
    if (mainWindow) {
      mainWindow.show();
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

app.on("ready", () => {
  // Round-7: the losing process must quit before ANY window/renderer
  // initialization — this guard runs before createMainWindow() below and is
  // the single place the lock-failure path terminates.
  if (!gotTheLock) {
    // decideLockLostAction: only "migrate" is a migration-related path; a
    // lock failure under "legacy"/"none" is the ordinary focus-the-running-
    // instance flow and stays silent.
    if (decideLockLostAction(userDataPlan) === "dialog-then-quit") {
      const { title, message } = migrationDialogCopy("lock");
      dialog.showErrorBox(title, message);
    }
    app.quit();
    return;
  }
  registerKeepAwakeHandlers();
  applyKeepAwake(keepAwakeEnabled);
  registerFleetTrustHostHandler();
  registerDesktopSettingsHandlers();
  registerDownloadSettingsHandlers();
  registerDownloadHandler();
  registerDownloadUrlHandler();
  registerSystemSettingsHandler();
  regShortcut();
  registerWindowFocusHandler();
  createMainWindow(); // 创建窗口
  applyDesktopSettings();

  if (isWin) {
    app.setAppUserModelId(OCTO_CONFIG.appId);
  }

  screenshots = new Screenshots({
    singleWindow: true,
  });

  const onScreenShotEnd = (result?: any) => {
    console.log(
      "onScreenShotEnd",
      isMainWindowFocusedWhenStartScreenshot,
      screenShotWindowId
    );
    if (isMainWindowFocusedWhenStartScreenshot) {
      if (result) {
        mainWindow.webContents.send(IPC_SCREENSHOTS_OK, result);
      }
      mainWindow.show();
      isMainWindowFocusedWhenStartScreenshot = false;
    } else if (screenShotWindowId) {
      let windows = BrowserWindow.getAllWindows();
      let tms = windows.filter(
        (win) => win.webContents.id === screenShotWindowId
      );
      if (tms.length > 0) {
        if (result) {
          tms[0].webContents.send(IPC_SCREENSHOTS_OK, result);
        }
        tms[0].show();
      }
      screenShotWindowId = 0;
    }
  };
  // 截图esc快捷键
  screenshots.on('windowCreated', ($win: any) => {
    $win.on('focus', () => {
      globalShortcut.register('esc', () => {
        if ($win?.isFocused()) {
          screenshots.endCapture();
        }
      });
    });

    $win.on('blur', () => {
      globalShortcut.unregister('esc');
    });
  });

  // 点击确定按钮回调事件
  screenshots.on("ok", (e: any, buffer: any, bounds: any) => {
    let filename = tmp.tmpNameSync() + '.png';
    let image = NativeImage.createFromBuffer(buffer);
    fs.writeFileSync(filename, image.toPNG());

    console.log("screenshots ok", e);
    onScreenShotEnd({ filePath: filename });
  });

  // 点击取消按钮回调事件
  screenshots.on("cancel", (e: any) => {
    // 执行了preventDefault
    // 点击取消不会关闭截图窗口
    // e.preventDefault()
    // console.log('capture', 'cancel2')
    console.log("screenshots cancel", e);
    onScreenShotEnd();
  });
  // 点击保存按钮回调事件
  screenshots.on("save", (e: any, { viewer }: any) => {
    console.log("screenshots save", e);
    onScreenShotEnd();
  });

  try {
    updateTray();
  } catch (e) {
    // do nothing
    console.log("==updateTray==", e);
  }
});

app.on("activate", () => {
  // Round-8 P1-1: same guard as open-url — macOS fires `activate` right after
  // `ready`; a losing process must never create a window against the legacy
  // profile (it would break the single-instance mutex mid-migration).
  if (!gotTheLock) return;

  if (!mainWindow) {
    return createMainWindow();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
});

app.on("before-quit", () => {
  forceQuit = true;

  if (flashTimer) {
    clearInterval(flashTimer);
    flashTimer = null;
  }

  if (tray) {
    tray.destroy();
    tray = null;
  }
  globalShortcut.unregisterAll();
});

// 除了 macOS 外，当所有窗口都被关闭的时候退出程序。 macOS窗口全部关闭时,dock中程序不会退出
app.on("window-all-closed", () => {
  process.platform !== "darwin" && app.quit();
});
