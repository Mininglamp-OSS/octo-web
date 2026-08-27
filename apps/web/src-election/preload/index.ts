import { contextBridge, ipcRenderer } from "electron";
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
  IPC_SHOW_CONVERSATIONS,
  IPC_NOTIFICATION_ACTION_CLICKED,
  IPC_NOTIFICATION_CLICKED,
  IPC_NOTIFICATION_CLOSE,
  IPC_NOTIFICATION_CLOSE_ALL,
  IPC_NOTIFICATION_SHOW,
  IPC_NOTIFICATION_TEST_ICON,
  IPC_MEDIA_ACCESS_STATUS,
  IPC_OIDC_AUTHORIZE_START,
  IPC_OIDC_AUTHORIZE_END,
  IPC_OIDC_HTTP_REQUEST,
  IPC_OIDC_OPEN_EXTERNAL,
  IPC_OIDC_CLEAR_AUTH_SESSION,
  IPC_TRUSTED_DOMAINS_GET,
  IPC_TRUSTED_DOMAIN_REMOVE,
  IPC_ASK_TRUST_FLEET_HOST,
  IPC_OPEN_EXTERNAL_URL,
  IPC_RESTART_APP,
  IPC_SCREENSHOTS_OK,
  IPC_SCREENSHOTS_START,
  IPC_UPDATE_AVAILABLE,
  IPC_UPDATE_CHECK,
  IPC_UPDATE_DOWNLOADED,
  IPC_UPDATE_DOWNLOAD,
  IPC_UPDATE_DOWNLOAD_PROGRESS,
  IPC_UPDATE_ERROR,
  IPC_UPDATE_INSTALL,
  IPC_UPDATE_NOT_AVAILABLE,
  IPC_WINDOW_IS_FOCUSED,
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
  IPC_UPDATE_CHECK,
  IPC_UPDATE_INSTALL,
  IPC_UPDATE_DOWNLOAD,
  IPC_CONVERSATION_UNREAD_COUNT,
  IPC_SCREENSHOTS_START,
  IPC_RESTART_APP,
];

const ALLOWED_INVOKE_CHANNELS = [
  IPC_MEDIA_ACCESS_STATUS,
  IPC_NOTIFICATION_SHOW,
  IPC_NOTIFICATION_CLOSE,
  IPC_NOTIFICATION_CLOSE_ALL,
  IPC_NOTIFICATION_TEST_ICON,
  IPC_WINDOW_IS_FOCUSED,
  IPC_KEEP_AWAKE_GET,
  IPC_KEEP_AWAKE_SET,
  IPC_DESKTOP_SETTINGS_GET,
  IPC_DESKTOP_SETTINGS_SET,
  IPC_DOWNLOAD_SETTINGS_GET,
  IPC_DOWNLOAD_SETTINGS_SET,
  IPC_DOWNLOAD_DIRECTORY_CHOOSE,
  IPC_DOWNLOAD_URL,
  IPC_OPEN_SYSTEM_SETTINGS,
  IPC_OIDC_AUTHORIZE_START,
  IPC_OIDC_AUTHORIZE_END,
  IPC_OIDC_HTTP_REQUEST,
  IPC_OIDC_OPEN_EXTERNAL,
  IPC_OIDC_CLEAR_AUTH_SESSION,
  IPC_TRUSTED_DOMAINS_GET,
  IPC_TRUSTED_DOMAIN_REMOVE,
  IPC_ASK_TRUST_FLEET_HOST,
  IPC_OPEN_EXTERNAL_URL,
];

const ALLOWED_RECEIVE_CHANNELS = [
  IPC_DOWNLOAD_STATUS,
  IPC_NOTIFICATION_CLICKED,
  IPC_NOTIFICATION_ACTION_CLICKED,
  IPC_SCREENSHOTS_OK,
  IPC_DEEP_LINK,
  IPC_SHOW_CONVERSATIONS,
  IPC_UPDATE_ERROR,
  IPC_UPDATE_AVAILABLE,
  IPC_UPDATE_NOT_AVAILABLE,
  IPC_UPDATE_DOWNLOAD_PROGRESS,
  IPC_UPDATE_DOWNLOADED,
];

contextBridge.exposeInMainWorld("__POWERED_ELECTRON__", true);

const unavailable = () => Promise.reject(new Error("IPC unavailable outside app shell"));

const sendAllowed = (channel: string, ...args: any[]) => {
  if (!isTrustedShell()) return;
  if (ALLOWED_SEND_CHANNELS.includes(channel)) {
    ipcRenderer.send(channel, ...args);
  } else {
    console.warn(`[preload] Blocked send to unknown channel: ${channel}`);
  }
};

const invokeAllowed = (channel: string, ...args: any[]): Promise<any> => {
  if (!isTrustedShell()) return unavailable();
  if (ALLOWED_INVOKE_CHANNELS.includes(channel)) {
    return ipcRenderer.invoke(channel, ...args);
  }
  console.warn(`[preload] Blocked invoke to unknown channel: ${channel}`);
  return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
};

const onAllowed = (
  channel: string,
  listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void
) => {
  if (!isTrustedShell()) return;
  if (ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
    ipcRenderer.on(channel, listener);
  } else {
    console.warn(`[preload] Blocked listener on unknown channel: ${channel}`);
  }
};

const onceAllowed = (
  channel: string,
  listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void
) => {
  if (!isTrustedShell()) return;
  if (ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
    ipcRenderer.once(channel, listener);
  } else {
    console.warn(`[preload] Blocked listener on unknown channel: ${channel}`);
  }
};

const removeListenerAllowed = (
  channel: string,
  listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void
) => {
  if (!isTrustedShell()) return;
  if (ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
    ipcRenderer.removeListener(channel, listener);
  } else {
    console.warn(`[preload] Blocked removal on unknown channel: ${channel}`);
  }
};

const ipcBridge = {
  send: (channel: string, ...args: any[]) => {
    sendAllowed(channel, ...args);
  },
  invoke: (channel: string, ...args: any[]): Promise<any> => {
    return invokeAllowed(channel, ...args);
  },
  on: (
    channel: string,
    listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void
  ) => {
    onAllowed(channel, listener);
  },
  once: (
    channel: string,
    listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void
  ) => {
    onceAllowed(channel, listener);
  },
  removeListener: (
    channel: string,
    listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void
  ) => {
    removeListenerAllowed(channel, listener);
  },
};

const notificationBridge = {
  show: (options: any) => invokeAllowed(IPC_NOTIFICATION_SHOW, options),
  close: (tag: string) => invokeAllowed(IPC_NOTIFICATION_CLOSE, tag),
  closeAll: () => invokeAllowed(IPC_NOTIFICATION_CLOSE_ALL),
  onClicked: (callback: (data: any) => void) =>
    isTrustedShell()
      ? subscribeDisposable(ipcRenderer, IPC_NOTIFICATION_CLICKED, callback)
      : () => {},
  onActionClicked: (callback: (data: any) => void) =>
    isTrustedShell()
      ? subscribeDisposable(ipcRenderer, IPC_NOTIFICATION_ACTION_CLICKED, callback)
      : () => {},
  testNotificationIcon: () => invokeAllowed(IPC_NOTIFICATION_TEST_ICON),
};

const octoElectron = {
  ipc: ipcBridge,
  oidc: {
    authorizeStart: (apiURL, authcode, providerId, authorizeUrl) =>
      invokeAllowed(IPC_OIDC_AUTHORIZE_START, apiURL, authcode, providerId, authorizeUrl),
    authorizeEnd: () => invokeAllowed(IPC_OIDC_AUTHORIZE_END),
    httpRequest: (request) => invokeAllowed(IPC_OIDC_HTTP_REQUEST, request),
    openExternal: (url) => invokeAllowed(IPC_OIDC_OPEN_EXTERNAL, url),
    clearAuthSession: () => invokeAllowed(IPC_OIDC_CLEAR_AUTH_SESSION),
  },
  notification: notificationBridge,
  window: {
    isFocused: () => invokeAllowed(IPC_WINDOW_IS_FOCUSED),
  },
  links: {
    // Generic http(s)-only external opener for shell features whose web-era
    // code used window.open + about:blank (realname verification, global
    // search doc open). Distinct from oidc.openExternal (end-session flow).
    openExternal: (url) => invokeAllowed(IPC_OPEN_EXTERNAL_URL, url),
  },
  conversation: {
    setUnreadCount: (count) => sendAllowed(IPC_CONVERSATION_UNREAD_COUNT, count),
  },
  system: {
    startScreenshot: (args) => sendAllowed(IPC_SCREENSHOTS_START, args),
    getMediaAccessStatus: (mediaType) => invokeAllowed(IPC_MEDIA_ACCESS_STATUS, mediaType),
    restartApp: () => sendAllowed(IPC_RESTART_APP),
  },
};

contextBridge.exposeInMainWorld("ipc", ipcBridge);
contextBridge.exposeInMainWorld("octoElectron", octoElectron);

// Expose native notification API
contextBridge.exposeInMainWorld("electronNotification", {
  ...notificationBridge,
  // Test notification icon
  testNotificationIcon: notificationBridge.testNotificationIcon,
  // Query real window focus state from main process
  isWindowFocused: octoElectron.window.isFocused,
});
