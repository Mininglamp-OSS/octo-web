export interface ScreenshotSettings {
  /** Off by default: the chat window stays visible and therefore shows up in the screenshot. */
  hideChatWindow: boolean;
}

export const SCREENSHOT_SETTINGS_KEY = "octo.screenshot.v1";

export const SCREENSHOT_SETTINGS_DEFAULTS: ScreenshotSettings = { hideChatWindow: false };

const defaults = SCREENSHOT_SETTINGS_DEFAULTS;
const listeners = new Set<(settings: ScreenshotSettings) => void>();

function read(): ScreenshotSettings {
  try {
    const value = JSON.parse(window.localStorage.getItem(SCREENSHOT_SETTINGS_KEY) || "null") as Partial<ScreenshotSettings> | null;
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
      window.localStorage.setItem(SCREENSHOT_SETTINGS_KEY, JSON.stringify(next));
      current = next;
    } catch {
      // Storage unavailable: keep showing the previous choice rather than a state that will not survive.
      current = previous;
    }
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
