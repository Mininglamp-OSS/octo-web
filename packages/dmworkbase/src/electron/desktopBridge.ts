export interface LegacyElectronIpcBridge {
  send(channel: string, ...args: unknown[]): void;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
  once(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

export interface DesktopOidcBridge {
  authorizeStart(apiURL: string, authcode: string, providerId: string, authorizeUrl: string): Promise<unknown>;
  authorizeEnd(): Promise<unknown>;
  httpRequest(request: unknown): Promise<unknown>;
  openExternal(url: string): Promise<unknown>;
  clearAuthSession(): Promise<unknown>;
}

export interface DesktopNotificationBridge {
  show(options: unknown): Promise<boolean>;
  close(tag: string): Promise<void>;
  closeAll(): Promise<void>;
  onClicked(callback: (data: unknown) => void): (() => void) | void;
  onActionClicked(callback: (data: unknown) => void): (() => void) | void;
  testNotificationIcon(): Promise<unknown>;
}

export interface DesktopWindowBridge {
  isFocused(): Promise<boolean>;
}

export interface DesktopConversationBridge {
  setUnreadCount(count: number): void;
}

export interface DesktopSystemBridge {
  startScreenshot(args?: unknown): void;
  getMediaAccessStatus(mediaType: "camera" | "microphone"): Promise<unknown>;
  restartApp(): void;
}

export interface OctoElectronBridge {
  ipc: LegacyElectronIpcBridge;
  oidc: DesktopOidcBridge;
  notification: DesktopNotificationBridge;
  window: DesktopWindowBridge;
  conversation: DesktopConversationBridge;
  system: DesktopSystemBridge;
}

declare global {
  interface Window {
    __POWERED_ELECTRON__?: boolean;
    ipc?: LegacyElectronIpcBridge;
    octoElectron?: OctoElectronBridge;
    electronNotification?: DesktopNotificationBridge & {
      isWindowFocused?: () => Promise<boolean>;
    };
  }
}

const IPC_CONVERSATION_UNREAD_COUNT = "conversation-manager-unread-count";
const IPC_UPDATE_DOWNLOAD = "update-app";
const IPC_UPDATE_INSTALL = "install-update";
const IPC_SCREENSHOTS_START = "screenshots-start";
const IPC_MEDIA_ACCESS_STATUS = "get-media-access-status";
const IPC_RESTART_APP = "restart-app";
const IPC_OIDC_CLEAR_AUTH_SESSION = "octo:oidc:clear-auth-session";
const IPC_OPEN_SYSTEM_SETTINGS = "open-system-settings";

export function getOctoElectronBridge(): OctoElectronBridge | undefined {
  return typeof window === "undefined" ? undefined : window.octoElectron;
}

export function getElectronIpcBridge(): LegacyElectronIpcBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.octoElectron?.ipc ?? window.ipc;
}

export function getElectronNotificationBridge(): DesktopNotificationBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.octoElectron?.notification ?? window.electronNotification;
}

export function getElectronWindowBridge(): DesktopWindowBridge | undefined {
  if (typeof window === "undefined") return undefined;
  if (window.octoElectron?.window) return window.octoElectron.window;
  if (window.electronNotification?.isWindowFocused) {
    return { isFocused: window.electronNotification.isWindowFocused };
  }
  return undefined;
}

export function getElectronSystemBridge(): DesktopSystemBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.octoElectron?.system;
}

export function isElectronPowered(): boolean {
  return Boolean(typeof window !== "undefined" && window.__POWERED_ELECTRON__);
}

export function isElectronShellBridgeAvailable(): boolean {
  return Boolean(
    isElectronPowered() &&
      (window.octoElectron || window.ipc),
  );
}

export function sendElectronConversationUnreadCount(count: number): void {
  const bridge = getOctoElectronBridge();
  if (bridge) {
    bridge.conversation.setUnreadCount(count);
    return;
  }
  getElectronIpcBridge()?.send(IPC_CONVERSATION_UNREAD_COUNT, count);
}

export function sendElectronUpdateApp(): void {
  getElectronIpcBridge()?.send(IPC_UPDATE_DOWNLOAD);
}

export function sendElectronInstallUpdate(): void {
  getElectronIpcBridge()?.send(IPC_UPDATE_INSTALL);
}

export function startElectronScreenshot(args?: unknown): void {
  const bridge = getElectronSystemBridge();
  if (bridge) {
    bridge.startScreenshot(args);
    return;
  }
  getElectronIpcBridge()?.send(IPC_SCREENSHOTS_START, args);
}

export function getElectronMediaAccessStatus(
  mediaType: "camera" | "microphone",
): Promise<unknown> | undefined {
  const bridge = getElectronSystemBridge();
  if (bridge) {
    return bridge.getMediaAccessStatus(mediaType);
  }
  return getElectronIpcBridge()?.invoke(IPC_MEDIA_ACCESS_STATUS, mediaType);
}

export function restartElectronApp(): void {
  const bridge = getElectronSystemBridge();
  if (bridge) {
    bridge.restartApp();
    return;
  }
  getElectronIpcBridge()?.send(IPC_RESTART_APP);
}

export function clearElectronAuthSession(): Promise<unknown> | undefined {
  const oidc = getOctoElectronBridge()?.oidc;
  if (oidc) {
    return oidc.clearAuthSession();
  }
  return getElectronIpcBridge()?.invoke(IPC_OIDC_CLEAR_AUTH_SESSION);
}

export function openElectronSystemSettings(target: "microphone" | "notifications"): Promise<boolean> {
  return getElectronIpcBridge()?.invoke(IPC_OPEN_SYSTEM_SETTINGS, target).then((result) => result === true) ?? Promise.resolve(false);
}
