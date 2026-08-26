import { Message, Channel, ChannelTypeGroup } from "wukongimjssdk";
import WKApp from "../App";
import WKSDK from "wukongimjssdk";
import { t } from "../i18n";
import { getImChannelInfo } from "../im-runtime/channelRuntime";
import { ChannelTypeCommunityTopic } from "../Service/Const";
import { isEffectivelyMuted, parseThreadChannelId } from "../Service/Thread";
import {
  getElectronNotificationBridge,
  getElectronWindowBridge,
  isElectronPowered,
} from "../electron/desktopBridge";

type NotificationHandle = Notification & {
  dispose?: () => void;
};

const NOTIFICATION_TIMEOUT_MS = 5000;

/**
 * Maximum number of unique message tags tracked simultaneously.
 * Once exceeded, the oldest idle entries are evicted to bound memory growth.
 */
const MAX_TRACKED_TAGS = 200;

/**
 * Upper bound on generic notifications whose click listeners are tracked for
 * cleanup. Prevents unbounded listener accumulation when callers do not close
 * the returned handle.
 */
const MAX_TRACKED_GENERIC = 50;

/**
 * Build a unique notification tag for a message.
 * Uses messageID > clientMsgNo > channel+seq as fallback identifiers. When no
 * stable identifier is available (missing IDs and a non-positive seq), append a
 * unique suffix so unrelated messages never collide onto the same tag.
 */
function getMessageTag(message: Message): string {
  const stableId = message.messageID || message.clientMsgNo;
  if (stableId) {
    return `message-${stableId}`;
  }
  const { channelType, channelID } = message.channel;
  if (message.messageSeq > 0) {
    return `message-${channelType}-${channelID}-${message.messageSeq}`;
  }
  // No stable identifier: fall back to a unique key so distinct messages do
  // not replace each other's notifications.
  return `message-${channelType}-${channelID}-anon-${uniqueAnonId()}`;
}

let anonTagCounter = 0;
function uniqueAnonId(): string {
  anonTagCounter = (anonTagCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now()}-${anonTagCounter}`;
}

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
  private messageNotifications = new Map<string, NotificationHandle>();
  private messageNotificationTimeoutIds = new Map<string, number>();
  private messageNotificationGenerations = new Map<string, number>();
  private messageNotificationInFlightCounts = new Map<string, number>();

  // Share an in-flight query across concurrent callers without caching a
  // completed result, because focus can change between two messages.
  private focusQueryInFlight?: Promise<boolean>;

  // Tracks generic notifications so their click listeners can be released even
  // when callers forget to close the returned handle.
  private genericNotifications = new Set<NotificationHandle>();

  private constructor() {}

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
    // Electron native notifications do not depend on the renderer's Web
    // Notification API or its permission state.
    if (this.isElectronNativeNotificationAvailable()) {
      return true;
    }
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
    return isElectronPowered() && !!getElectronNotificationBridge();
  }

  /**
   * Query real window focus state.
   * In Electron, document.hasFocus() can return true even when the window is
   * minimized or hidden. This method queries the main process for the actual
   * window state (focused + visible + not minimized).
   * Falls back to document.hasFocus() in non-Electron environments.
   *
   * Concurrent callers share a single in-flight IPC request, but completed
   * results are not cached: a blur or focus change must be observed by the next
   * decision immediately.
   */
  public async isWindowFocused(): Promise<boolean> {
    const electronWindow = getElectronWindowBridge();
    if (this.isElectronNativeNotificationAvailable() && electronWindow) {
      if (this.focusQueryInFlight) {
        return this.focusQueryInFlight;
      }
      this.focusQueryInFlight = (async () => {
        try {
          const value = await electronWindow.isFocused();
          return value;
        } catch {
          // IPC failure — fall back to document.hasFocus()
          return document.visibilityState === "visible" && document.hasFocus();
        } finally {
          this.focusQueryInFlight = undefined;
        }
      })();
      return this.focusQueryInFlight;
    }
    return document.visibilityState === "visible" && document.hasFocus();
  }

  /**
   * Create a notification using the appropriate API
   * Prefers Electron native notifications when available, falls back to Web API
   */
  private async createNotification(
    options: NotificationOptions
  ): Promise<NotificationHandle | null> {
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
          urgency: "normal" as const,
          timeoutType: "default" as const,
        };

        const electronNotification = getElectronNotificationBridge();
        const success = await electronNotification!.show(electronOptions);
        if (success) {
          // Set up click handler for Electron notifications.
          // The listener is bound to a generation so it can be invalidated
          // without waiting for close()/dispose() — see Finding #3.
          let cleanupClickListener: (() => void) | undefined;
          let listenerInvalidated = false;
          if (options.onClick) {
            cleanupClickListener =
              electronNotification!.onClicked((data: any) => {
                if (listenerInvalidated) return;
                if (data.tag === options.tag) {
                  options.onClick!();
                }
              }) || undefined;
          }

          const invalidateAndCleanup = () => {
            if (listenerInvalidated) return;
            listenerInvalidated = true;
            cleanupClickListener?.();
            cleanupClickListener = undefined;
          };

          // Return a mock notification object for compatibility
          return {
            close: () => {
              invalidateAndCleanup();
              if (options.tag) {
                electronNotification!.close(options.tag);
              }
            },
            dispose: () => {
              invalidateAndCleanup();
            },
            onclick: null,
            onshow: null,
            onclose: null,
            onerror: null,
          } as NotificationHandle;
        }
      } catch (error) {
        console.warn(
          "Failed to create Electron native notification, falling back to Web API:",
          error
        );
      }
    }
    // Fallback to Web Notification API only when it is actually available.
    if (!window.Notification || window.Notification.permission === "denied") {
      return null;
    }

    let notification: Notification;
    try {
      notification = new window.Notification(options.title, {
        body: options.body,
        icon: options.icon || this.getNotificationIcon(),
        lang: "zh-CN",
        tag: options.tag,
      });
    } catch (error) {
      console.warn("Failed to create Web Notification:", error);
      return null;
    }

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

    return notification as NotificationHandle;
  }

  private cleanupMessageNotificationGeneration(tag: string): void {
    if (
      (this.messageNotificationInFlightCounts.get(tag) ?? 0) === 0 &&
      !this.messageNotifications.has(tag) &&
      !this.messageNotificationTimeoutIds.has(tag)
    ) {
      this.messageNotificationGenerations.delete(tag);
    }
  }

  /**
   * Evict the oldest idle tag entries when Maps exceed MAX_TRACKED_TAGS.
   * Only removes entries that have no active notification and no in-flight request.
   */
  private evictIdleTagsIfNeeded(): void {
    if (this.messageNotificationGenerations.size <= MAX_TRACKED_TAGS) {
      return;
    }
    for (const tag of this.messageNotificationGenerations.keys()) {
      if (this.messageNotificationGenerations.size <= MAX_TRACKED_TAGS) break;
      // Only evict truly idle entries
      if (
        !this.messageNotifications.has(tag) &&
        !this.messageNotificationTimeoutIds.has(tag) &&
        (this.messageNotificationInFlightCounts.get(tag) ?? 0) === 0
      ) {
        this.messageNotificationGenerations.delete(tag);
        this.messageNotificationInFlightCounts.delete(tag);
      }
    }
  }

  private closeMessageNotification(tag: string): number {
    // Invalidate any in-flight createNotification() for this tag as well as
    // the currently displayed notification.
    const generation = (this.messageNotificationGenerations.get(tag) ?? 0) + 1;
    this.messageNotificationGenerations.set(tag, generation);
    const timeoutId = this.messageNotificationTimeoutIds.get(tag);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    this.messageNotificationTimeoutIds.delete(tag);
    // Dispose the old notification's listener before closing to prevent the
    // old listener from firing on events intended for a newer notification
    // sharing the same tag (Finding #3).
    const existing = this.messageNotifications.get(tag);
    if (existing) {
      existing.dispose?.();
      existing.close();
    }
    this.messageNotifications.delete(tag);
    this.cleanupMessageNotificationGeneration(tag);
    return generation;
  }

  /**
   * Send a message notification
   */
  public async sendMessageNotification(
    message: Message,
    description?: string
  ): Promise<void> {
    const channelInfo = getImChannelInfo(WKSDK.shared(), message.channel);

    const isThread = message.channel.channelType === ChannelTypeCommunityTopic;
    const parentGroupNo = isThread
      ? (channelInfo?.orgData?.parentGroupNo as string | undefined) ||
        parseThreadChannelId(message.channel.channelID)?.groupNo
      : undefined;
    const parentChannelInfo = parentGroupNo
      ? getImChannelInfo(
          WKSDK.shared(),
          new Channel(parentGroupNo, ChannelTypeGroup)
        )
      : undefined;
    if (isEffectivelyMuted({ isThread, channelInfo, parentChannelInfo })) {
      return;
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

    // Notifications for different messages must not replace each other.
    const tag = getMessageTag(message);

    // A duplicate message can be processed while the previous native
    // notification is still being created. Close the current one first and
    // use a generation to prevent a stale async result from replacing it.
    this.messageNotificationInFlightCounts.set(
      tag,
      (this.messageNotificationInFlightCounts.get(tag) ?? 0) + 1
    );
    const generation = this.closeMessageNotification(tag);

    try {
      // Create new notification using web API
      const notification = await this.createNotification({
        title:
          channelInfo?.orgData?.displayName ?? t("base.notification.title"),
        body: description,
        channel: message.channel,
        fromUid: message.fromUID,
        tag,
        icon: this.getNotificationIcon(message.channel),
        onClick: () => {
          this.closeMessageNotification(tag);
          window.focus();
          WKApp.endpoints.showConversation(message.channel);
        },
        onShow: () => {},
        onClose: () => {},
      });

      if (this.messageNotificationGenerations.get(tag) !== generation) {
        // Native close(tag) would also close a newer notification using the
        // same tag. Only remove the stale listener in that case.
        if (notification?.dispose) {
          notification.dispose();
        }
        // A stale Electron notification must not call close(tag), because that
        // tag may now belong to a newer native notification. Web Notification
        // instances are object-scoped, so closing the stale instance is safe.
        if (!notification?.dispose) {
          notification?.close();
        }
        return;
      }

      if (notification) {
        this.messageNotifications.set(tag, notification);
        this.messageNotificationTimeoutIds.set(
          tag,
          window.setTimeout(() => {
            this.closeMessageNotification(tag);
          }, NOTIFICATION_TIMEOUT_MS)
        );
      }
    } finally {
      const inFlightCount =
        (this.messageNotificationInFlightCounts.get(tag) ?? 1) - 1;
      if (inFlightCount > 0) {
        this.messageNotificationInFlightCounts.set(tag, inFlightCount);
      } else {
        this.messageNotificationInFlightCounts.delete(tag);
      }
      this.cleanupMessageNotificationGeneration(tag);
      this.evictIdleTagsIfNeeded();
    }
  }

  /**
   * Send a call notification
   */
  public async sendCallNotification(
    fromUID: string,
    channelInfo: any,
    callType?: string
  ): Promise<Notification | null> {
    if (!this.isNotificationSupported()) {
      return null;
    }

    const channel = new Channel(fromUID, 1); // ChannelTypePerson = 1
    const generation = ++this.callNotificationGeneration;

    // Call notifications share a single native tag. Dispose the old renderer
    // listener before replacing the notification so repeated calls do not
    // accumulate click handlers.
    if (this.callNotification) {
      this.callNotification.dispose?.();
      this.callNotification.close();
      this.callNotification = undefined;
    }

    const notification = await this.createNotification({
      title: channelInfo?.orgData?.displayName ?? t("base.notification.title"),
      body: t("base.notification.calling", {
        values: { name: channelInfo?.title ?? t("base.notification.user") },
      }),
      channel: channel,
      fromUid: fromUID,
      tag: "call",
      onClick: () => {
        if (this.callNotificationGeneration !== generation) return;
        this.callNotification?.close();
        window.focus();
        WKApp.endpoints.showConversation(channel);
      },
      onClose: () => {},
    });

    // A newer call started while this notification was being created. Dispose
    // only this result; closing by tag could close the newer notification.
    if (this.callNotificationGeneration !== generation) {
      notification?.dispose?.();
      if (!notification?.dispose) {
        notification?.close();
      }
      return null;
    }

    this.callNotification = notification;
    return notification;
  }

  /**
   * Send a generic notification.
   *
   * The returned handle should be closed by the caller when done. To guard
   * against callers that never close it, the click listener is also tracked and
   * released here: the oldest tracked handle is disposed once the tracking set
   * exceeds MAX_TRACKED_GENERIC, and an auto-dispose timeout releases the
   * listener even if the handle is dropped.
   */
  public async sendGenericNotification(
    options: NotificationOptions
  ): Promise<Notification | null> {
    const notification = await this.createNotification({
      ...options,
      icon: options.icon || this.getNotificationIcon(),
    });

    if (!notification) {
      return null;
    }

    // Only native (Electron) handles carry a click listener that must be
    // released explicitly; Web Notifications are garbage-collected with their
    // instance and do not accumulate global listeners.
    if (notification.dispose) {
      this.trackGenericNotification(notification);
    }

    return notification;
  }

  private trackGenericNotification(notification: NotificationHandle): void {
    this.genericNotifications.add(notification);

    // Evict the oldest tracked handle if we exceed the cap.
    if (this.genericNotifications.size > MAX_TRACKED_GENERIC) {
      const oldest = this.genericNotifications.values().next().value as
        | NotificationHandle
        | undefined;
      if (oldest) {
        this.genericNotifications.delete(oldest);
        oldest.dispose?.();
      }
    }

    // Safety net: release the listener after a bounded lifetime even if the
    // caller never closes the handle. This does not close the OS notification,
    // only detaches the renderer-side click listener.
    const timeoutId = window.setTimeout(() => {
      if (this.genericNotifications.delete(notification)) {
        notification.dispose?.();
      }
    }, NOTIFICATION_TIMEOUT_MS);

    // Wrap close/dispose so tracking and the timer are cleaned up eagerly when
    // the caller does the right thing.
    const originalClose = notification.close.bind(notification);
    const originalDispose = notification.dispose?.bind(notification);
    const untrack = () => {
      clearTimeout(timeoutId);
      this.genericNotifications.delete(notification);
    };
    notification.close = () => {
      untrack();
      originalClose();
    };
    if (originalDispose) {
      notification.dispose = () => {
        untrack();
        originalDispose();
      };
    }
  }

  /**
   * Close all notifications and release all tracked state.
   */
  public closeAllNotifications(): void {
    for (const tag of new Set([
      ...this.messageNotifications.keys(),
      ...this.messageNotificationGenerations.keys(),
    ])) {
      this.closeMessageNotification(tag);
    }
    // Ensure all maps are fully cleared to prevent unbounded growth
    this.messageNotifications.clear();
    this.messageNotificationTimeoutIds.clear();
    this.messageNotificationGenerations.clear();
    this.messageNotificationInFlightCounts.clear();

    // Release any tracked generic notification listeners.
    for (const notification of this.genericNotifications) {
      notification.dispose?.();
    }
    this.genericNotifications.clear();

    // Invalidate an in-flight call notification before closing the current
    // instance, otherwise its async result could become active again.
    this.callNotificationGeneration += 1;
    if (this.callNotification) {
      this.callNotification.close();
      this.callNotification = undefined;
    }
  }

  // Call notification instance
  private callNotification?: NotificationHandle | null;
  private callNotificationGeneration = 0;
}

// Export singleton instance
export const notificationUtil = NotificationUtil.getInstance();
