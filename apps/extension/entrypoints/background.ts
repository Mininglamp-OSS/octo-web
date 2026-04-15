import {
  EXTENSION_MESSAGE_TYPE,
  EXTENSION_STORAGE_KEYS,
  parseNotificationId,
  type ExtensionAuthResponse,
  type ExtensionRuntimeMessage,
} from "../utils/extensionRuntime";
import {
  clearPendingConversation,
  getExtensionAuthState,
  getExtensionPreferences,
  setExtensionPreferences,
  setPendingConversation,
} from "../utils/extensionStorage";

const BADGE_BG_COLOR = "#d24747";
const OFFSCREEN_DOCUMENT_PATH = "/offscreen.html";
const MENU_NOTIFICATIONS_ON = "notifications-on";
const MENU_NOTIFICATIONS_OFF = "notifications-off";
const MENU_SYSTEM_NOTIFY_ON = "system-notify-on";
const MENU_SYSTEM_NOTIFY_OFF = "system-notify-off";
const chromeApi = (globalThis as { chrome?: any }).chrome;
const SIDEPANEL_ACTIVE_TTL_MS = 5000;
let lastSidepanelActiveAt = 0;

function markSidepanelActive(): void {
  lastSidepanelActiveAt = Date.now();
}

function clearSidepanelActive(): void {
  lastSidepanelActiveAt = 0;
}

function isSidepanelActive(): boolean {
  return Date.now() - lastSidepanelActiveAt < SIDEPANEL_ACTIVE_TTL_MS;
}

async function getStoredAuthResponse(): Promise<ExtensionAuthResponse> {
  const auth = await getExtensionAuthState();
  return { auth: auth?.loggedIn ? auth : null };
}

async function syncAuthStateToOffscreen(): Promise<void> {
  const { auth } = await getStoredAuthResponse();

  if (auth?.loggedIn) {
    try {
      await browser.runtime.sendMessage({
        type: EXTENSION_MESSAGE_TYPE.authChanged,
        auth,
      } satisfies ExtensionRuntimeMessage);
    } catch (error) {
      console.debug("[Extension] Failed to sync auth state to offscreen:", error);
    }
    return;
  }

  try {
    await browser.runtime.sendMessage({
      type: EXTENSION_MESSAGE_TYPE.authCleared,
    } satisfies ExtensionRuntimeMessage);
  } catch (error) {
    console.debug("[Extension] Failed to clear offscreen auth state:", error);
  }
}

async function ensureOffscreenDocument(): Promise<void> {
  if (!chromeApi?.offscreen?.createDocument) {
    return;
  }

  try {
    await chromeApi.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [
        chromeApi.offscreen.Reason.WORKERS,
        chromeApi.offscreen.Reason.AUDIO_PLAYBACK,
      ],
      justification:
        "Keep unread badge and message notifications in sync, and play extension sounds when the side panel is closed.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Only a single offscreen")) {
      console.warn("[Extension] Failed to create offscreen document:", error);
    }
  }
}

let cachedDefaultIcon: ImageData | null = null;
let breathingFrames: ImageData[] = [];
let breathingTimer: ReturnType<typeof setInterval> | null = null;
let breathingFrameIndex = 0;

const BREATHING_FRAME_COUNT = 30;
const BREATHING_INTERVAL_MS = 80;
const DOT_OPACITY_MIN = 0.3;
const DOT_OPACITY_MAX = 1.0;
const DOT_RADIUS_RATIO = 0.24;

async function getDefaultIconImageData(): Promise<ImageData> {
  if (cachedDefaultIcon) {
    return cachedDefaultIcon;
  }

  const response = await fetch(browser.runtime.getURL("/icons/128.png"));
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const size = 128;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, size, size);
  cachedDefaultIcon = ctx.getImageData(0, 0, size, size);
  bitmap.close();
  return cachedDefaultIcon;
}

function renderDotFrame(base: ImageData, opacity: number): ImageData {
  const size = base.width;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(base, 0, 0);

  const dotRadius = size * DOT_RADIUS_RATIO;
  const cx = size - dotRadius - size * 0.04;
  const cy = size - dotRadius - size * 0.04;

  // 白色描边
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, dotRadius + size * 0.025, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  // 红点
  ctx.globalAlpha = opacity;
  ctx.beginPath();
  ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
  ctx.fillStyle = BADGE_BG_COLOR;
  ctx.fill();

  return ctx.getImageData(0, 0, size, size);
}

async function buildBreathingFrames(): Promise<void> {
  if (breathingFrames.length > 0) {
    return;
  }

  const base = await getDefaultIconImageData();
  breathingFrames = Array.from({ length: BREATHING_FRAME_COUNT }, (_, i) => {
    // sine wave: 0 → 1 → 0 over one cycle
    const t = Math.sin((i / BREATHING_FRAME_COUNT) * Math.PI * 2) * 0.5 + 0.5;
    const opacity = DOT_OPACITY_MIN + (DOT_OPACITY_MAX - DOT_OPACITY_MIN) * t;
    return renderDotFrame(base, opacity);
  });
}

function stopBreathing(): void {
  if (breathingTimer !== null) {
    clearInterval(breathingTimer);
    breathingTimer = null;
  }
  breathingFrameIndex = 0;
}

function startBreathing(): void {
  if (breathingTimer !== null) {
    return;
  }

  breathingTimer = setInterval(() => {
    const frame = breathingFrames[breathingFrameIndex];
    if (frame) {
      void browser.action.setIcon({ imageData: { 128: frame } });
    }
    breathingFrameIndex = (breathingFrameIndex + 1) % BREATHING_FRAME_COUNT;
  }, BREATHING_INTERVAL_MS);
}

async function updateBadge(hasUnread: boolean): Promise<void> {
  await browser.action.setBadgeText({ text: "" });

  if (hasUnread) {
    await buildBreathingFrames();
    startBreathing();
  } else {
    stopBreathing();
    const base = await getDefaultIconImageData();
    await browser.action.setIcon({ imageData: { 128: base } });
  }
}

async function clearAllNotifications(): Promise<void> {
  const items = await browser.notifications.getAll();
  Object.keys(items).forEach((notificationId) => {
    void browser.notifications.clear(notificationId);
  });
}

async function openOptionsPage(): Promise<void> {
  if (browser.runtime.openOptionsPage) {
    await browser.runtime.openOptionsPage();
  }
}

async function focusChromeWindow(): Promise<number | undefined> {
  const currentWindow = await browser.windows.getLastFocused();
  if (!currentWindow.id) {
    return undefined;
  }

  await browser.windows.update(currentWindow.id, { focused: true });
  return currentWindow.id;
}

async function applyPreferencesToUi(): Promise<void> {
  const preferences = await getExtensionPreferences();

  if (!preferences.notificationsEnabled) {
    await updateBadge(false);
    await clearAllNotifications();
    return;
  }

  if (!preferences.notificationsVisible) {
    await clearAllNotifications();
  }
}

async function buildContextMenus(): Promise<void> {
  if (!chromeApi?.contextMenus?.create) {
    return;
  }

  const preferences = await getExtensionPreferences();

  chromeApi.contextMenus.removeAll(() => {
    // 插件通知 → 子菜单 radio
    chromeApi.contextMenus.create({
      id: "parent-notifications",
      title: "未读角标提醒",
      contexts: ["action"],
    });
    chromeApi.contextMenus.create({
      id: MENU_NOTIFICATIONS_ON,
      parentId: "parent-notifications",
      title: "开启",
      type: "radio",
      checked: preferences.notificationsEnabled,
      contexts: ["action"],
    });
    chromeApi.contextMenus.create({
      id: MENU_NOTIFICATIONS_OFF,
      parentId: "parent-notifications",
      title: "关闭",
      type: "radio",
      checked: !preferences.notificationsEnabled,
      contexts: ["action"],
    });

    // 系统通知 → 子菜单 radio
    chromeApi.contextMenus.create({
      id: "parent-system-notify",
      title: "桌面弹窗通知",
      contexts: ["action"],
      enabled: preferences.notificationsEnabled,
    });
    chromeApi.contextMenus.create({
      id: MENU_SYSTEM_NOTIFY_ON,
      parentId: "parent-system-notify",
      title: "开启",
      type: "radio",
      checked: preferences.notificationsVisible,
      contexts: ["action"],
    });
    chromeApi.contextMenus.create({
      id: MENU_SYSTEM_NOTIFY_OFF,
      parentId: "parent-system-notify",
      title: "关闭",
      type: "radio",
      checked: !preferences.notificationsVisible,
      contexts: ["action"],
    });
  });
}

async function handleContextMenuClick(menuItemId: string): Promise<void> {
  const preferences = await getExtensionPreferences();

  if (menuItemId === MENU_NOTIFICATIONS_ON || menuItemId === MENU_NOTIFICATIONS_OFF) {
    const enabled = menuItemId === MENU_NOTIFICATIONS_ON;
    const next = { ...preferences, notificationsEnabled: enabled };
    if (!enabled) {
      next.notificationsVisible = false;
    }
    await setExtensionPreferences(next);
    await buildContextMenus();
    return;
  }

  if (menuItemId === MENU_SYSTEM_NOTIFY_ON || menuItemId === MENU_SYSTEM_NOTIFY_OFF) {
    await setExtensionPreferences({
      ...preferences,
      notificationsVisible: menuItemId === MENU_SYSTEM_NOTIFY_ON,
    });
    await buildContextMenus();
  }
}

async function openSidePanel(windowId?: number): Promise<void> {
  if (!chromeApi?.sidePanel?.open) {
    return;
  }

  const targetWindowId = windowId ?? (await focusChromeWindow());
  if (!targetWindowId) {
    return;
  }

  await chromeApi.sidePanel.open({ windowId: targetWindowId });
}

async function dispatchConversationOpen(notificationId: string): Promise<void> {
  const target = parseNotificationId(notificationId);
  if (!target) {
    return;
  }

  await setPendingConversation(target);
  await focusChromeWindow();

  if (isSidepanelActive()) {
    await openSidePanel();
  }

  try {
    await browser.runtime.sendMessage({
      type: EXTENSION_MESSAGE_TYPE.openConversation,
      target,
    } satisfies ExtensionRuntimeMessage);
  } catch (error) {
    console.debug("[Extension] Sidepanel is not ready yet, pending target kept.", error);
  }
}

async function handleRuntimeMessage(
  message: ExtensionRuntimeMessage,
): Promise<ExtensionAuthResponse | void> {
  if (message.type === EXTENSION_MESSAGE_TYPE.offscreenReady) {
    return getStoredAuthResponse();
  }

  if (message.type === EXTENSION_MESSAGE_TYPE.authChanged) {
    void ensureOffscreenDocument().then(() => {
      void syncAuthStateToOffscreen();
    });
    return;
  }

  if (message.type === EXTENSION_MESSAGE_TYPE.authCleared) {
    void clearPendingConversation();
    void updateBadge(false);
    void clearAllNotifications();
    void syncAuthStateToOffscreen();
    return;
  }

  if (message.type === EXTENSION_MESSAGE_TYPE.offscreenSyncResult) {
    if (isSidepanelActive()) {
      return;
    }

    void getExtensionPreferences().then((preferences) => {
      const shouldShowBadge = preferences.notificationsEnabled && message.hasAuth;
      void updateBadge(shouldShowBadge && message.hasUnread);
    });
    return;
  }

  if (message.type === EXTENSION_MESSAGE_TYPE.sidepanelBadgeSync) {
    markSidepanelActive();
    void getExtensionPreferences().then((preferences) => {
      void updateBadge(preferences.notificationsEnabled && message.hasUnread);
    });
    return;
  }

  if (message.type === EXTENSION_MESSAGE_TYPE.sidepanelState) {
    if (message.active) {
      markSidepanelActive();
    } else {
      clearSidepanelActive();
    }
    return;
  }

  if (message.type === EXTENSION_MESSAGE_TYPE.offscreenNewMessage) {
    void getExtensionPreferences().then((preferences) => {
      if (!preferences.notificationsEnabled || !preferences.notificationsVisible) {
        return;
      }

      void browser.notifications.create(message.notificationId, {
        type: "basic",
        title: message.title,
        message: message.body,
        iconUrl: browser.runtime.getURL("/icons/128.png"),
      });
    });
  }
}

export default defineBackground(async () => {
  console.log("Hello background!", { id: browser.runtime.id });

  browser.runtime.onMessage.addListener((message: ExtensionRuntimeMessage) => {
    return handleRuntimeMessage(message);
  });

  browser.notifications.onClicked.addListener((notificationId) => {
    void browser.notifications.clear(notificationId);
    void dispatchConversationOpen(notificationId);
  });

  chromeApi?.contextMenus?.onClicked?.addListener((info: { menuItemId?: string }) => {
    if (info.menuItemId) {
      void handleContextMenuClick(info.menuItemId);
    }
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[EXTENSION_STORAGE_KEYS.preferences]) {
      return;
    }

    void applyPreferencesToUi();
    void buildContextMenus();
  });

  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));

  await buildContextMenus();
  await ensureOffscreenDocument();
  await updateBadge(false);
  await applyPreferencesToUi();
});
