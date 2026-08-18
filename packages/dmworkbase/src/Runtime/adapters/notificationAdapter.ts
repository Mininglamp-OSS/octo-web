import { NotificationUtil } from "../../Utils/NotificationUtil";
import type { RuntimeEnvironment } from "../runtimeEnvironment";

export type NotificationPermissionState = NotificationPermission | "unsupported";

export interface NotificationAdapter {
  isSupported(): boolean;
  getPermission(): NotificationPermissionState;
  requestPermission(): Promise<NotificationPermissionState>;
}

class WebNotificationAdapter implements NotificationAdapter {
  isSupported(): boolean {
    return typeof Notification !== "undefined";
  }

  getPermission(): NotificationPermissionState {
    return this.isSupported() ? Notification.permission : "unsupported";
  }

  async requestPermission(): Promise<NotificationPermissionState> {
    if (!this.isSupported()) return "unsupported";
    return NotificationUtil.getInstance().requestPermission();
  }
}

class NativeNotificationAdapter extends WebNotificationAdapter {
  isSupported(): boolean {
    return NotificationUtil.getInstance().isNotificationSupported();
  }

  getPermission(): NotificationPermissionState {
    return this.isSupported() ? "granted" : "unsupported";
  }

  async requestPermission(): Promise<NotificationPermissionState> {
    return this.isSupported() ? "granted" : "unsupported";
  }
}

export function createNotificationAdapter(environment: RuntimeEnvironment): NotificationAdapter {
  return environment.capabilities.has("nativeNotifications")
    ? new NativeNotificationAdapter()
    : new WebNotificationAdapter();
}
