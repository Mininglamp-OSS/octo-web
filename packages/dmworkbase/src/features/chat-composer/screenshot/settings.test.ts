import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "octo.screenshot.v1";

async function load() {
  vi.resetModules();
  return await import("./settings");
}

beforeEach(() => { window.localStorage.clear(); });

describe("screenshotSettingsStore", () => {
  it("keeps the chat window visible by default", async () => {
    const { screenshotSettingsStore } = await load();
    expect(screenshotSettingsStore.get()).toEqual({ hideChatWindow: false });
  });
  it("persists the choice and notifies subscribers until they unsubscribe", async () => {
    const { screenshotSettingsStore, SCREENSHOT_SETTINGS_KEY } = await load();
    const seen: boolean[] = [];
    const stop = screenshotSettingsStore.subscribe(settings => seen.push(settings.hideChatWindow));
    screenshotSettingsStore.set({ hideChatWindow: true });
    expect(JSON.parse(window.localStorage.getItem(SCREENSHOT_SETTINGS_KEY)!)).toEqual({ hideChatWindow: true });
    expect(seen).toEqual([true]);
    stop();
    screenshotSettingsStore.set({ hideChatWindow: false });
    expect(seen).toEqual([true]);
  });
  it("reads back the previous choice in a fresh module instance", async () => {
    const first = await load();
    first.screenshotSettingsStore.set({ hideChatWindow: true });
    const second = await load();
    expect(second.screenshotSettingsStore.get()).toEqual({ hideChatWindow: true });
  });
  it("falls back to the default for corrupt or non-boolean storage", async () => {
    window.localStorage.setItem(KEY, "{not json");
    expect((await load()).screenshotSettingsStore.get()).toEqual({ hideChatWindow: false });
    window.localStorage.setItem(KEY, JSON.stringify({ hideChatWindow: "yes" }));
    expect((await load()).screenshotSettingsStore.get()).toEqual({ hideChatWindow: false });
  });
});
