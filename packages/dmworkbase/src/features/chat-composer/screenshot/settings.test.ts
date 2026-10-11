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
  it("does not leak one account's choice into another after switching users", async () => {
    const { screenshotSettingsStore } = await load();
    screenshotSettingsStore.setUserId("user-a");
    screenshotSettingsStore.set({ hideChatWindow: true });
    expect(screenshotSettingsStore.get()).toEqual({ hideChatWindow: true });

    screenshotSettingsStore.setUserId("user-b");
    expect(screenshotSettingsStore.get()).toEqual({ hideChatWindow: false });

    screenshotSettingsStore.setUserId("user-a");
    expect(screenshotSettingsStore.get()).toEqual({ hideChatWindow: true });
  });
  it("notifies subscribers when the account is rebound", async () => {
    const { screenshotSettingsStore } = await load();
    screenshotSettingsStore.setUserId("user-a");
    screenshotSettingsStore.set({ hideChatWindow: true });
    screenshotSettingsStore.setUserId("user-b");
    const seen: boolean[] = [];
    screenshotSettingsStore.subscribe(settings => seen.push(settings.hideChatWindow));
    screenshotSettingsStore.setUserId("user-a");
    expect(seen).toEqual([true]);
  });
  it("falls back to the unscoped key for an empty user id", async () => {
    const { screenshotSettingsStore, SCREENSHOT_SETTINGS_KEY } = await load();
    screenshotSettingsStore.setUserId("user-a");
    screenshotSettingsStore.set({ hideChatWindow: true });
    screenshotSettingsStore.setUserId("");
    expect(screenshotSettingsStore.get()).toEqual({ hideChatWindow: false });
    screenshotSettingsStore.set({ hideChatWindow: true });
    expect(JSON.parse(window.localStorage.getItem(SCREENSHOT_SETTINGS_KEY)!)).toEqual({ hideChatWindow: true });
  });
  it("encodes user ids so unusual characters stay in their own bucket", async () => {
    const { screenshotSettingsStore, SCREENSHOT_SETTINGS_KEY } = await load();
    const userId = "a/b c:d";
    screenshotSettingsStore.setUserId(userId);
    screenshotSettingsStore.set({ hideChatWindow: true });
    expect(JSON.parse(window.localStorage.getItem(`${SCREENSHOT_SETTINGS_KEY}.${encodeURIComponent(userId)}`)!))
      .toEqual({ hideChatWindow: true });
    expect(window.localStorage.getItem(SCREENSHOT_SETTINGS_KEY)).toBeNull();
  });
});
