import { contextBridge, ipcRenderer } from "electron";
import { subscribeDisposable } from "./notificationListeners";
import { IPC_CONVERSATION_UNREAD_COUNT } from "../shared/ipc-channels";

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
    if (ALLOWED_SEND_CHANNELS.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    } else {
      console.warn(`[preload] Blocked send to unknown channel: ${channel}`);
    }
  },
  invoke: (channel: string, ...args: any[]): Promise<any> => {
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
    ipcRenderer.invoke("show-native-notification", options),
  close: (tag: string) => ipcRenderer.invoke("close-native-notification", tag),
  closeAll: () => ipcRenderer.invoke("close-all-native-notifications"),
  onClicked: (callback: (data: any) => void) =>
    subscribeDisposable(ipcRenderer, "notification-clicked", callback),
  onActionClicked: (callback: (data: any) => void) =>
    subscribeDisposable(ipcRenderer, "notification-action-clicked", callback),
  // Test notification icon
  testNotificationIcon: () => ipcRenderer.invoke("test-notification-icon"),
  // Query real window focus state from main process
  isWindowFocused: () => ipcRenderer.invoke("is-window-focused"),
});
