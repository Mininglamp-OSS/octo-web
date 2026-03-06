/// <reference types="react-scripts" />

type IpcSendChannel =
  | 'install-update'
  | 'check-update'
  | 'update-app'
  | 'quit-and-install'
  | 'screenshots-start'
  | 'conversation-anager-unread-count';

type IpcOnChannel =
  | 'update-error'
  | 'update-available'
  | 'update-not-available'
  | 'download-progress'
  | 'update-downloaded';

interface IpcRenderer {
  send(channel: IpcSendChannel, ...args: any[]): void;
  on(channel: IpcOnChannel, callback: (event: any, data: any) => void): void;
  removeAllListeners(channel: string): void;
}

declare interface Window {
  ipc: IpcRenderer;
  __POWERED_ELECTRON__: boolean;
  __POWERED_BY_ZC__: boolean;
}
