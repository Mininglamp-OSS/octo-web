import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CONVERSATION_UNREAD_COUNT,
  IPC_OIDC_AUTHORIZE_START,
  IPC_OIDC_AUTHORIZE_END,
  IPC_OIDC_HTTP_REQUEST,
  IPC_OIDC_OPEN_EXTERNAL,
  IPC_OIDC_CLEAR_AUTH_SESSION,
} from "../shared/ipc-channels";

// Keep the preload entry self-contained. Electron runs sandboxed preloads in
// a restricted loader where relative CommonJS imports can fail even when the
// imported file is present in app.asar. A failed preload means the whole IPC
// bridge is missing, which makes packaged OIDC login look like a login error.
function subscribeDisposable<T>(
  ipc: typeof ipcRenderer,
  channel: string,
  callback: (data: T) => void,
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data);
  ipc.on(channel, handler);
  return () => ipc.removeListener(channel, handler);
}

// Dev server origin is injected by the main process via `additionalArguments`
// (see main/index.ts getWindowConfig). We refuse to hard-code
// `http://localhost:3000` here because VITE_DEV_SERVER_URL can override the
// port on the main-process side — a mismatch would silently disable ALL IPC
// in dev mode. The value is main-process-controlled, so a compromised
// renderer cannot inject its own `--octo-dev-origin=` flag.
const DEV_ORIGIN_FLAG = "--octo-dev-origin=";
const SHELL_FILE_FLAG = "--octo-shell-file=";
const devOrigin: string | null = (() => {
  const arg = process.argv.find((a) => a.startsWith(DEV_ORIGIN_FLAG));
  if (!arg) return null;
  const raw = arg.slice(DEV_ORIGIN_FLAG.length);
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
})();

const trustedShellFileURL = (() => {
  const arg = process.argv.find((a) => a.startsWith(SHELL_FILE_FLAG));
  return arg ? arg.slice(SHELL_FILE_FLAG.length) : null;
})();

// Evaluate the shell identity once, while this preload is being evaluated.
// Same-document SPA history changes update window.location.pathname but do
// not load a new preload; re-checking the pathname for every bridge call
// would therefore disable IPC after navigating to routes such as /drive.
const trustedShellAtLoadResult = (() => {
  if (window.location.protocol === "file:" && trustedShellFileURL) {
    try {
      const current = new URL(window.location.href);
      const trusted = new URL(trustedShellFileURL);
      if (current.protocol === trusted.protocol &&
        current.hostname === trusted.hostname &&
        current.pathname.toLowerCase() === trusted.pathname.toLowerCase()) {
        return { trusted: true, reason: "packaged shell path matched" };
      }
      return {
        trusted: false,
        reason: `packaged shell path mismatch (current=${current.pathname}, expected=${trusted.pathname})`,
      };
    } catch {
      return { trusted: false, reason: "invalid packaged shell URL" };
    }
  }
  // In packaged builds `devOrigin` is null → dev-server access is denied,
  // which is exactly what we want (packaged app should only ever load
  // build/index.html via file://).
  if (devOrigin && window.location.origin === devOrigin) {
    return { trusted: true, reason: "development origin matched" };
  }
  return {
    trusted: false,
    reason: devOrigin
      ? `origin mismatch (current=${window.location.origin}, expected=${devOrigin})`
      : "no packaged shell file or development origin was provided",
  };
})();

const trustedShellAtLoad = trustedShellAtLoadResult.trusted;
if (!trustedShellAtLoad) {
  console.error(`[preload] Desktop bridge disabled: ${trustedShellAtLoadResult.reason}`);
}

const isTrustedShell = () => trustedShellAtLoad;

const ALLOWED_SEND_CHANNELS = [
  "check-update",
  "install-update",
  "update-app",
  IPC_CONVERSATION_UNREAD_COUNT,
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
  IPC_OIDC_AUTHORIZE_START,
  IPC_OIDC_AUTHORIZE_END,
  IPC_OIDC_HTTP_REQUEST,
  IPC_OIDC_OPEN_EXTERNAL,
  IPC_OIDC_CLEAR_AUTH_SESSION,
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

contextBridge.exposeInMainWorld("__POWERED_ELECTRON__", true);

contextBridge.exposeInMainWorld("ipc", {
  send: (channel: string, ...args: any[]) => {
    if (!isTrustedShell()) return;
    if (ALLOWED_SEND_CHANNELS.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    } else {
      console.warn(`[preload] Blocked send to unknown channel: ${channel}`);
    }
  },
  invoke: (channel: string, ...args: any[]): Promise<any> => {
    if (!isTrustedShell()) return Promise.reject(new Error("IPC unavailable outside app shell"));
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
    if (!isTrustedShell()) return;
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
    if (!isTrustedShell()) return;
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
    if (!isTrustedShell()) return;
    if (ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
      ipcRenderer.removeListener(channel, listener);
    } else {
      console.warn(`[preload] Blocked removal on unknown channel: ${channel}`);
    }
  },
});

// Expose native notification API
contextBridge.exposeInMainWorld("electronNotification", {
  show: (options: any) =>
    isTrustedShell()
      ? ipcRenderer.invoke("show-native-notification", options)
      : Promise.reject(new Error("IPC unavailable outside app shell")),
  close: (tag: string) =>
    isTrustedShell()
      ? ipcRenderer.invoke("close-native-notification", tag)
      : Promise.reject(new Error("IPC unavailable outside app shell")),
  closeAll: () =>
    isTrustedShell()
      ? ipcRenderer.invoke("close-all-native-notifications")
      : Promise.reject(new Error("IPC unavailable outside app shell")),
  onClicked: (callback: (data: any) => void) =>
    isTrustedShell()
      ? subscribeDisposable(ipcRenderer, "notification-clicked", callback)
      : () => {},
  onActionClicked: (callback: (data: any) => void) =>
    isTrustedShell()
      ? subscribeDisposable(ipcRenderer, "notification-action-clicked", callback)
      : () => {},
  // Test notification icon
  testNotificationIcon: () =>
    isTrustedShell()
      ? ipcRenderer.invoke("test-notification-icon")
      : Promise.reject(new Error("IPC unavailable outside app shell")),
  // Query real window focus state from main process
  isWindowFocused: () =>
    isTrustedShell()
      ? ipcRenderer.invoke("is-window-focused")
      : Promise.reject(new Error("IPC unavailable outside app shell")),
});
