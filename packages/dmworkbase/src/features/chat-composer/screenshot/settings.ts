export interface ScreenshotSettings {
  /** Off by default: the chat window stays visible and therefore shows up in the screenshot. */
  hideChatWindow: boolean;
}

export const SCREENSHOT_SETTINGS_KEY = "octo.screenshot.v1";

export const SCREENSHOT_SETTINGS_DEFAULTS: ScreenshotSettings = { hideChatWindow: false };

const defaults = SCREENSHOT_SETTINGS_DEFAULTS;
const listeners = new Set<(settings: ScreenshotSettings) => void>();

// Scoped per user like voiceSettingsStore, so a shared workstation or an in-session account switch
// cannot inherit the previous user's choice.
let storageKey = SCREENSHOT_SETTINGS_KEY;

function read(): ScreenshotSettings {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) || "null") as Partial<ScreenshotSettings> | null;
    if (!value || typeof value !== "object") return { ...defaults };
    return { hideChatWindow: value.hideChatWindow === true };
  } catch {
    return { ...defaults };
  }
}

let current = read();

export const screenshotSettingsStore = {
  get(): ScreenshotSettings {
    return { ...current };
  },
  set(patch: Partial<ScreenshotSettings>): ScreenshotSettings {
    const previous = current;
    const next = {
      ...current,
      ...(typeof patch.hideChatWindow === "boolean" ? { hideChatWindow: patch.hideChatWindow } : {}),
    };
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      current = next;
    } catch {
      // Storage unavailable: keep showing the previous choice rather than a state that will not survive.
      current = previous;
    }
    listeners.forEach((listener) => listener({ ...current }));
    return { ...current };
  },
  /** Rebind to one account; an empty id falls back to the unscoped key, mirroring voiceSettingsStore. */
  setUserId(userId: string): ScreenshotSettings {
    storageKey = userId ? `${SCREENSHOT_SETTINGS_KEY}.${encodeURIComponent(userId)}` : SCREENSHOT_SETTINGS_KEY;
    current = read();
    listeners.forEach((listener) => listener({ ...current }));
    return { ...current };
  },
  subscribe(listener: (settings: ScreenshotSettings) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
