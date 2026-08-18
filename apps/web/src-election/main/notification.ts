import { Notification, BrowserWindow, ipcMain } from "electron";
import { Channel } from "wukongimjssdk";
import {
  IPC_NOTIFICATION_ACTION_CLICKED,
  IPC_NOTIFICATION_CLICKED,
  IPC_NOTIFICATION_CLOSE,
  IPC_NOTIFICATION_CLOSE_ALL,
  IPC_NOTIFICATION_SHOW,
} from "../shared/ipc-channels";

const isDevelopment = process.env.NODE_ENV !== "production";

/**
 * Debug logger gated behind the development flag so production main-process
 * stdout is not flooded with notification metadata (channel/fromUID/etc.).
 */
function debugLog(...args: unknown[]): void {
  if (isDevelopment) {
    console.log(...args);
  }
}

export interface ElectronNotificationOptions {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  silent?: boolean;
  fromUid?:string
  channel?: Channel
  urgency?: 'normal' | 'critical' | 'low';
  timeoutType?: 'default' | 'never';
  actions?: Array<{
    type: 'button';
    text: string;
  }>;
}

export interface MessageData {
  channel: {
    channelID: string;
    channelType: number;
  };
  fromUID: string;
  header: {
    reddot: boolean;
    noPersist: boolean;
  };
}

class ElectronNotificationManager {
  private static instance: ElectronNotificationManager;
  private activeNotifications: Map<string, Notification> = new Map();
  private mainWindow: BrowserWindow | null = null;
  private isTrustedSender: (event: Electron.IpcMainInvokeEvent) => boolean = () => false;

  private constructor() {
    this.setupIpcHandlers();
  }

  public static getInstance(): ElectronNotificationManager {
    if (!ElectronNotificationManager.instance) {
      ElectronNotificationManager.instance = new ElectronNotificationManager();
    }
    return ElectronNotificationManager.instance;
  }

  public setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  public setSenderGuard(guard: (event: Electron.IpcMainInvokeEvent) => boolean): void {
    this.isTrustedSender = guard;
  }

  private setupIpcHandlers(): void {
    // Handle notification requests from renderer process
    ipcMain.handle(IPC_NOTIFICATION_SHOW, async (event, options: ElectronNotificationOptions) => {
      if (!this.isTrustedSender(event)) return false;
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      return this.showNotification(options, ownerWindow || undefined);
    });

    // Handle notification close requests
    ipcMain.handle(IPC_NOTIFICATION_CLOSE, async (event, tag: string) => {
      if (!this.isTrustedSender(event)) return;
      this.closeNotification(tag);
    });

    // Handle close all notifications
    ipcMain.handle(IPC_NOTIFICATION_CLOSE_ALL, async (event) => {
      if (!this.isTrustedSender(event)) return;
      this.closeAllNotifications();
    });
  }

  public showNotification(options: ElectronNotificationOptions, ownerWindow = this.mainWindow || undefined): boolean {
    try {
      // Close existing notification with same tag
      if (options.tag) {
        this.closeNotification(options.tag);
      }

      const notification = new Notification({
        title: options.title,
        body: options.body,
        silent: options.silent || false,
        urgency: options.urgency || 'normal',
        timeoutType: options.timeoutType || 'default',
        actions: options.actions || [],
      });

      // Set up event handlers
      notification.on('click', () => {
        debugLog('Notification clicked');
        // Bring the window that created this notification to front.
        if (ownerWindow && !ownerWindow.isDestroyed()) {
          if (ownerWindow.isMinimized()) {
            ownerWindow.restore();
          }
          ownerWindow.show();
          ownerWindow.focus();

          // Send click event to renderer process with channel info
          ownerWindow.webContents.send(IPC_NOTIFICATION_CLICKED, {
            tag: options.tag,
            title: options.title,
            body: options.body,
            channel: options.channel,
          });
        }

        // Clean up
        if (options.tag) {
          this.activeNotifications.delete(options.tag);
        }
      });

      notification.on('close', () => {
        debugLog('Notification closed');
        if (options.tag) {
          this.activeNotifications.delete(options.tag);
        }
      });

      notification.on('action', (_event, index) => {
        debugLog('Notification action clicked:', index);
        if (ownerWindow && !ownerWindow.isDestroyed()) {
          ownerWindow.webContents.send(IPC_NOTIFICATION_ACTION_CLICKED, {
            tag: options.tag,
            actionIndex: index,
          });
        }
      });

      // Show the notification
      notification.show();

      // Store reference if tag is provided
      if (options.tag) {
        this.activeNotifications.set(options.tag, notification);
      }

      return true;
    } catch (error) {
      console.error('Failed to show native notification:', error);
      return false;
    }
  }

  public closeNotification(tag: string): void {
    const notification = this.activeNotifications.get(tag);
    if (notification) {
      notification.close();
      this.activeNotifications.delete(tag);
    }
  }

  public closeAllNotifications(): void {
    this.activeNotifications.forEach((notification) => {
      notification.close();
    });
    this.activeNotifications.clear();
  }


  /**
   * Handle call notification
   */
  public handleCallNotification = (fromUID: string, channelInfo: any, callType?: string): void => {
    debugLog('Handling call notification in main process:', { fromUID, channelInfo, callType });

    const notificationOptions: ElectronNotificationOptions = {
      title: channelInfo?.orgData?.displayName || channelInfo?.title || "通知",
      body: `${channelInfo?.title || fromUID}正在呼叫您`,
      tag: `call-${fromUID}`,
      urgency: 'critical', // High priority for calls
      timeoutType: 'never', // Don't auto-dismiss call notifications
      actions: [
        { type: 'button' as const, text: '接听' },
        { type: 'button' as const, text: '拒绝' }
      ],
    };

    this.showNotification(notificationOptions);
  };

  /**
   * Handle generic notification
   */
  public handleGenericNotification = (options: {
    title: string;
    body: string;
    tag?: string;
    icon?: string;
  }): void => {
    debugLog('Handling generic notification in main process:', options);

    const notificationOptions: ElectronNotificationOptions = {
      title: options.title,
      body: options.body,
      tag: options.tag,
      icon: options.icon,
      urgency: 'normal',
      timeoutType: 'default',
    };

    this.showNotification(notificationOptions);
  };
}

// Export singleton instance
export const electronNotificationManager = ElectronNotificationManager.getInstance();
export default ElectronNotificationManager;
