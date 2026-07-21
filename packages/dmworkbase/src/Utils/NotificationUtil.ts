import { Message, Channel, ChannelTypeGroup } from "wukongimjssdk";
import WKApp from "../App";
import WKSDK from "wukongimjssdk";
import { t } from "../i18n";
import { getImChannelInfo } from "../im-runtime/channelRuntime";

// Extend window interface for Electron APIs
declare global {
  interface Window {
    __POWERED_ELECTRON__?: boolean;
    electronNotification?: {
      show: (options: any) => Promise<boolean>;
      close: (tag: string) => Promise<void>;
      closeAll: () => Promise<void>;
      onClicked: (callback: (data: any) => void) => void;
      onActionClicked: (callback: (data: any) => void) => void;
    };
  }
}

const NOTIFICATION_TIMEOUT_MS = 5000;

export interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  channel?: Channel;
  fromUid?: string;
  onClick?: () => void;
  onShow?: () => void;
  onClose?: () => void;
  timeout?: number; // Auto-close timeout in milliseconds
}

export class NotificationUtil {
  private static instance: NotificationUtil;
  private messageNotification?: Notification | null;
  private messageNotificationTimeoutId?: number;

  private constructor() {
  }

  public static getInstance(): NotificationUtil {
    if (!NotificationUtil.instance) {
      NotificationUtil.instance = new NotificationUtil();
    }
    return NotificationUtil.instance;
  }

  /**
   * Check if notifications are supported and permitted
   */
  public isNotificationSupported(): boolean {
    return !!(window.Notification && Notification.permission !== "denied");
  }

  /**
   * Request notification permission
   */
  public async requestPermission(): Promise<NotificationPermission> {
    if (!window.Notification) {
      return "denied";
    }
    
    if (Notification.permission === "default") {
      return await Notification.requestPermission();
    }
    
    return Notification.permission;
  }

  /**
   * Get the notification icon for the channel
   */
  private getNotificationIcon(channel?: Channel): string {
    if (channel) {
      return WKApp.shared.avatarChannel(channel);
    }
    return "";
  }

  /**
   * Check if Electron native notifications are available
   */
  private isElectronNativeNotificationAvailable(): boolean {
    return !!(window.__POWERED_ELECTRON__ && window.electronNotification);
  }

  /**
   * Create a notification using the appropriate API
   * Prefers Electron native notifications when available, falls back to Web API
   */
  private async createNotification(options: NotificationOptions): Promise<Notification | null> {
    if (!this.isNotificationSupported()) {
      return null;
    }

    // Try to use Electron native notifications first
    if (this.isElectronNativeNotificationAvailable()) {
      try {
        const electronOptions = {
          title: options.title,
          body: options.body,
          icon: options.icon || this.getNotificationIcon(),
          tag: options.tag,
          channel: options.channel,
          fromUid: options.fromUid,
          silent: false,
          urgency: 'normal' as const,
          timeoutType: 'default' as const,
        };

        const success = await window.electronNotification!.show(electronOptions);
        if (success) {
          // Set up click handler for Electron notifications
          
          if (options.onClick) {
            window.electronNotification!.onClicked((data: any) => {
              if (data.tag === options.tag) {
                options.onClick!();
              }
            });
          }

          // Return a mock notification object for compatibility
          return {
            close: () => {
              if (options.tag) {
                window.electronNotification!.close(options.tag);
              }
            },
            onclick: null,
            onshow: null,
            onclose: null,
            onerror: null,
          } as any;
        }
      } catch (error) {
        console.warn('Failed to create Electron native notification, falling back to Web API:', error);
      }
    }
    // Fallback to Web Notification API
    const notification = new window.Notification(options.title, {
      body: options.body,
      icon: options.icon || this.getNotificationIcon(),
      lang: "zh-CN",
      tag: options.tag,
    });

    // Set up event handlers
    if (options.onClick) {
      notification.onclick = options.onClick;
    }

    if (options.onShow) {
      notification.onshow = options.onShow;
    }

    if (options.onClose) {
      notification.onclose = options.onClose;
    }

    // Set up auto-close timeout if specified
    if (options.timeout && options.timeout > 0) {
      setTimeout(() => {
        notification.close();
      }, options.timeout);
    }

    return notification;
  }

  /**
   * Close any existing message notification
   */
  private closeExistingMessageNotification(): void {
    if (this.messageNotification) {
      if (this.messageNotificationTimeoutId) {
        clearTimeout(this.messageNotificationTimeoutId);
        this.messageNotificationTimeoutId = undefined;
      }
      this.messageNotification.close();
      this.messageNotification = undefined;
    }
  }

  /**
   * Send a message notification
   */
  public async sendMessageNotification(message: Message, description?: string): Promise<void> {
    let channelInfo = getImChannelInfo(WKSDK.shared(), message.channel);

    // Check if channel is muted
    if (channelInfo && channelInfo.mute) {
      return;
    }

    // 子区消息：额外检查父群聊 mute（只读 orgData.parentGroupNo，不依赖 Service 层解析）
    const parentGroupNo = channelInfo?.orgData?.parentGroupNo as string | undefined
    if (parentGroupNo) {
      const parentChannel = new Channel(parentGroupNo, ChannelTypeGroup)
      const parentChannelInfo = getImChannelInfo(WKSDK.shared(), parentChannel)
      if (parentChannelInfo?.mute) {
        return
      }
    }

    // Check if message should show red dot
    if (!message.header.reddot) {
      return;
    }

    // Check if description is provided
    if (description == undefined || description === "") {
      return;
    }

    // Check if message should persist
    if (message.header.noPersist) {
      return;
    }
    // Try to use Electron native notifications first if available and registered
    // if (this.isElectronNativeNotificationAvailable() && this.electronHandlerRegistered) {
    //   try {
    //     await window.electronNotification!.showMessageNotification(message, description);
    //     return; // Successfully handled by Electron native notifications
    //   } catch (error) {
    //     console.warn('Failed to show Electron native notification, falling back to web API:', error);
    //   }
    // }

    // Close any existing notification
    this.closeExistingMessageNotification();

    // Create new notification using web API
    this.messageNotification = await this.createNotification({
      title: channelInfo?.orgData?.displayName ?? t("base.notification.title"),
      body: description,
      channel: message.channel,
      fromUid: message.fromUID,
      tag: "message",
      icon: this.getNotificationIcon(message.channel),
      onClick: () => {
        this.messageNotification?.close();
        window.focus();
        WKApp.endpoints.showConversation(message.channel);
      },
      onShow: () => {
      },
      onClose: () => {
      },
      timeout: NOTIFICATION_TIMEOUT_MS,
    });

    // Store timeout ID for cleanup
    if (this.messageNotification) {
      this.messageNotificationTimeoutId = window.setTimeout(() => {
        this.messageNotification?.close();
      }, NOTIFICATION_TIMEOUT_MS);
    }
  }

  /**
   * Send a call notification
   */
  public async sendCallNotification(fromUID: string, channelInfo: any, callType?: string): Promise<Notification | null> {
    if (!this.isNotificationSupported()) {
      return null;
    }

    const channel = new Channel(fromUID, 1); // ChannelTypePerson = 1

    this.callNotification = await this.createNotification({
      title: channelInfo?.orgData?.displayName ?? t("base.notification.title"),
      body: t("base.notification.calling", { values: { name: channelInfo?.title ?? t("base.notification.user") } }),
      channel: channel,
      fromUid: fromUID,
      tag: "call",
      onClick: () => {
        this.callNotification?.close();
        window.focus();
        WKApp.endpoints.showConversation(channel);
      },
      onClose: () => {
      },
    });

    return this.callNotification;
  }

  /**
   * Send a generic notification
   */
  public async sendGenericNotification(options: NotificationOptions): Promise<Notification | null> {
    return await this.createNotification({
      ...options,
      icon: options.icon || this.getNotificationIcon(),
    });
  }

  /**
   * Close all notifications
   */
  public closeAllNotifications(): void {
    this.closeExistingMessageNotification();
    if (this.callNotification) {
      this.callNotification.close();
      this.callNotification = undefined;
    }
  }

  // Call notification instance
  private callNotification?: Notification | null;
}

// Export singleton instance
export const notificationUtil = NotificationUtil.getInstance();
