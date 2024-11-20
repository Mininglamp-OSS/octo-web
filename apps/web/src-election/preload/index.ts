import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("__POWERED_ELECTRON__", true);

contextBridge.exposeInMainWorld("ipc", {
  send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
  invoke: (channel: string, ...args: any[]): Promise<any> =>
    ipcRenderer.invoke(channel, ...args),
  on: (
    channel: string,
    listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void
  ) => {
    ipcRenderer.on(channel, listener);
  },
  once: (
    channel: string,
    listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void
  ) => {
    ipcRenderer.once(channel, listener);
  },
});
