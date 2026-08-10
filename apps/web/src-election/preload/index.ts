import { contextBridge, ipcRenderer } from "electron";

// Keep the preload entry fully self-contained. Sandboxed preload inside
// app.asar cannot reliably resolve relative CommonJS imports, and any throw
// here happens *before* contextBridge.exposeInMainWorld runs — which cascades
// to `window.__POWERED_ELECTRON__` being undefined, WKApp.shared.isPC staying
// false, and the OIDC login flow building `file:///v1/...` URLs (white
// screen). Do NOT re-add imports from ../shared/*; duplicate the constants
// here and keep them in sync with apps/web/src-election/shared/ipc-channels.ts.
const IPC_CONVERSATION_UNREAD_COUNT = "conversation-manager-unread-count";
const IPC_OIDC_AUTHORIZE_START = "oidc-authorize-start";
const IPC_OIDC_AUTHORIZE_START_INVOKE = "oidc-authorize-start-invoke";
const IPC_DEEP_LINK_READY = "deep-link-ready";

function subscribeDisposable<T = any>(
  renderer: Pick<typeof ipcRenderer, "on" | "removeListener">,
  channel: string,
  callback: (data: T) => void,
): () => void {
  const handler = (_event: unknown, data: T) => callback(data);
  renderer.on(channel, handler);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    renderer.removeListener(channel, handler);
  };
}

const ALLOWED_SEND_CHANNELS = [
  "check-update",
  "install-update",
  "update-app",
  IPC_CONVERSATION_UNREAD_COUNT,
  IPC_OIDC_AUTHORIZE_START,
  IPC_OIDC_AUTHORIZE_START_INVOKE,
  IPC_DEEP_LINK_READY,
  "screenshots-start",
  "restart-app",
];

const ALLOWED_INVOKE_CHANNELS = [
  "get-media-access-status",
  "show-native-notification",
  "close-native-notification",
  "close-all-native-notifications",
  "test-notification-icon",
  "is-window-focused",
];

const ALLOWED_RECEIVE_CHANNELS = [
  "notification-clicked",
  "notification-action-clicked",
  "screenshots-ok",
  "deep-link",
  "show-conversations",
  "update-error",
  "update-available",
  "update-not-available",
  "download-progress",
  "update-downloaded",
];

// The OIDC login flow drives the main BrowserWindow through a third-party IdP
// origin before redirecting back to the packaged shell. The preload script
// re-attaches on every navigation in that webContents, so the IdP document
// (and anything it further redirects through) also gets `window.ipc` — and
// with it access to privileged channels like `restart-app`, `update-app`,
// `screenshots-start`, and `oidc-authorize-start` (self-referential: an IdP
// page could reset the expected origin used by the main-process redirect
// interceptor). Gate every renderer→main IPC call on the current document's
// origin so only the packaged shell (file://) and the dev server can reach it.
//
// In a PACKAGED build, no legitimate document is served from a dev-server
// origin — any http://localhost:3000 document there is either an accidentally
// running local server or an attacker-controlled page. Gate the dev-origin
// allowlist on a main-process-provided runtime argument so production trusts
// only the packaged file:// shell, including sandboxed preloads.
const DEFAULT_DEV_ORIGIN = "http://localhost:3000";
function getArgValue(prefix: string): string | undefined {
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

const IS_DEV_RUNTIME = getArgValue("--octo-dev=") === "true";

function configuredDevOrigins(): Set<string> {
  const origins = new Set<string>();
  // Dev origins are meaningless — and dangerous — in packaged builds.
  if (!IS_DEV_RUNTIME) return origins;
  origins.add(DEFAULT_DEV_ORIGIN);
  const configured = process.env.VITE_DEV_SERVER_URL;
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "http:" || url.protocol === "https:") {
        origins.add(url.origin);
      }
    } catch {
      // Ignore malformed environment input and retain the safe default.
    }
  }
  return origins;
}

const TRUSTED_DEV_ORIGINS = configuredDevOrigins();

function normalizeFilePath(value: string): string {
  try {
    return decodeURIComponent(value)
      .replace(/\\/g, "/")
      .replace(/^\/(?:[A-Za-z]:)/, (drive) => drive.slice(1))
      .replace(/\/+$/, "");
  } catch {
    return value.replace(/\\/g, "/").replace(/\/+$/, "");
  }
}

function isPackagedShellFile(): boolean {
  try {
    const pathname = normalizeFilePath(window.location.pathname);
    const shellPath = getArgValue("--octo-shell-path=");
    return typeof shellPath === "string" && pathname === normalizeFilePath(shellPath);
  } catch {
    return false;
  }
}

function isTrustedShellOrigin(): boolean {
  try {
    const { protocol, origin } = window.location;
    if (protocol === "file:") return isPackagedShellFile();
    return TRUSTED_DEV_ORIGINS.has(origin);
  } catch {
    return false;
  }
}

// Expose the runtime flag only to the packaged shell (file://) and configured
// dev server. During OIDC the main window transiently navigates to the remote
// IdP/API origin; preload re-attaches to that navigation, and if we expose
// `__POWERED_ELECTRON__` there too, any octo-web bundle served from that
// origin false-positives on its Electron detection (see
// apps/web/src/index.tsx isDesktopRuntime) and reads
// `import.meta.env.VITE_API_URL` — which the web build does not inline — and
// then throws in resolveApiURL. Gate this the same way as `ipc` below.
if (isTrustedShellOrigin()) {
  contextBridge.exposeInMainWorld("__POWERED_ELECTRON__", true);
}

contextBridge.exposeInMainWorld("ipc", {
  send: (channel: string, ...args: any[]) => {
    if (!isTrustedShellOrigin()) {
      console.warn(`[preload] Blocked send from untrusted origin: ${channel}`);
      return;
    }
    if (ALLOWED_SEND_CHANNELS.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    } else {
      console.warn(`[preload] Blocked send to unknown channel: ${channel}`);
    }
  },
  invoke: (channel: string, ...args: any[]): Promise<any> => {
    if (!isTrustedShellOrigin()) {
      console.warn(`[preload] Blocked invoke from untrusted origin: ${channel}`);
      return Promise.reject(new Error(`IPC channel not allowed from this origin: ${channel}`));
    }
    if (ALLOWED_INVOKE_CHANNELS.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    console.warn(`[preload] Blocked invoke to unknown channel: ${channel}`);
    return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
  },
  on: (
    channel: string,
    listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void
  ) => {
    if (!isTrustedShellOrigin()) {
      console.warn(`[preload] Blocked listener from untrusted origin: ${channel}`);
      return;
    }
    if (ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
      ipcRenderer.on(channel, listener);
    } else {
      console.warn(`[preload] Blocked listener on unknown channel: ${channel}`);
    }
  },
  once: (
    channel: string,
    listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void
  ) => {
    if (!isTrustedShellOrigin()) {
      console.warn(`[preload] Blocked once-listener from untrusted origin: ${channel}`);
      return;
    }
    if (ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
      ipcRenderer.once(channel, listener);
    } else {
      console.warn(`[preload] Blocked listener on unknown channel: ${channel}`);
    }
  },
  removeListener: (
    channel: string,
    listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void
  ) => {
    if (!isTrustedShellOrigin()) return;
    if (ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
      ipcRenderer.removeListener(channel, listener);
    } else {
      console.warn(`[preload] Blocked removal on unknown channel: ${channel}`);
    }
  },
});

// Expose native notification API. These endpoints all funnel through
// `invoke("...")`, which is already origin-gated in the `ipc` wrapper above;
// duplicate the check here so a third-party origin cannot bypass the wrapper
// by calling this alias directly.
function invokeIfTrusted<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  if (!isTrustedShellOrigin()) {
    return Promise.reject(new Error(`electronNotification not allowed from this origin: ${channel}`));
  }
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

function subscribeIfTrusted(channel: string, callback: (data: any) => void): () => void {
  if (!isTrustedShellOrigin()) return () => undefined;
  return subscribeDisposable(ipcRenderer, channel, callback);
}

contextBridge.exposeInMainWorld("electronNotification", {
  show: (options: any) => invokeIfTrusted("show-native-notification", options),
  close: (tag: string) => invokeIfTrusted("close-native-notification", tag),
  closeAll: () => invokeIfTrusted("close-all-native-notifications"),
  onClicked: (callback: (data: any) => void) =>
    subscribeIfTrusted("notification-clicked", callback),
  onActionClicked: (callback: (data: any) => void) =>
    subscribeIfTrusted("notification-action-clicked", callback),
  testNotificationIcon: () => invokeIfTrusted("test-notification-icon"),
  isWindowFocused: () => invokeIfTrusted("is-window-focused"),
});
