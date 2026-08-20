/** @vitest-environment jsdom */
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { appState, keepAwake } = vi.hoisted(() => ({
  appState: {
    shared: { notificationIsClose: false, isLogined: () => false },
    loginInfo: { realnameVerified: false },
    config: { appVersion: "test" },
    apiClient: { config: { apiURL: "https://example.test" } },
  },
  keepAwake: {
    getEnabled: vi.fn(async () => false),
    setEnabled: vi.fn(async (enabled: boolean) => enabled),
  },
}));

vi.mock("../../../App", () => ({ default: appState, ThemeMode: {} }));
vi.mock("../../MeInfo", () => ({ MeInfo: () => <div data-testid="me-info" /> }));
vi.mock("../../../Runtime/adapters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../Runtime/adapters")>()),
  createKeepAwakeAdapter: () => keepAwake,
}));

import { i18n } from "../../../i18n";
import { SettingsPage } from "../settingsPages";

const environment = {
  target: "desktop" as const,
  shell: "electron" as const,
  os: "macos" as const,
  capabilities: new Set(["keepAwake"] as const),
};

let container: HTMLDivElement;

const flush = async () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  i18n.setLocale("zh-CN", { notify: false, persist: false });
  keepAwake.getEnabled.mockClear();
  keepAwake.setEnabled.mockClear();
  Object.defineProperty(window, "ipc", {
    configurable: true,
    value: { invoke: vi.fn(async (channel: string) => channel === "download-settings-get"
      ? { directory: "/Users/nancy/Library/Application Support/Octo/Downloads/Shared Files", askBeforeSaving: false }
      : undefined) },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => ReactDOM.unmountComponentAtNode(container));
  container.remove();
  delete (window as Window & { ipc?: unknown }).ipc;
});

describe("SettingsPage desktop behavior", () => {
  it("loads and saves the keep-awake setting", async () => {
    act(() => ReactDOM.render(<SettingsPage item={{ id: "desktop-behavior", labelKey: "base.navRail.settingsCenter.item.desktopBehavior" }} environment={environment} />, container));
    await flush();

    const toggle = container.querySelector("[aria-label=\"保持电脑唤醒\"]") as HTMLInputElement;
    expect(keepAwake.getEnabled).toHaveBeenCalledTimes(1);
    expect(toggle.checked).toBe(false);

    act(() => toggle.click());
    await flush();

    expect(keepAwake.setEnabled).toHaveBeenCalledWith(true);
    expect(toggle.checked).toBe(true);
  });

  it("uses the resolved macOS download path from the native adapter", async () => {
    act(() => ReactDOM.render(<SettingsPage item={{ id: "downloads", labelKey: "base.navRail.settingsCenter.item.downloads" }} environment={environment} />, container));
    await flush();

    expect(container.textContent).toContain("/Users/nancy/Library/Application Support/Octo/Downloads/Shared Files");
    expect(container.textContent).toContain("新收到的文件保存到这里。改动只影响之后的下载，已有文件留在原处。");
  });

  it("shows Desktop voice shortcuts as read-only current client shortcuts", () => {
    act(() => ReactDOM.render(<SettingsPage item={{ id: "shortcuts", labelKey: "base.navRail.settingsCenter.item.shortcuts" }} environment={environment} />, container));

    expect(container.textContent).toContain("右 Option");
    expect(container.textContent).toContain("点按");
    expect(container.textContent).toContain("Esc");
    expect(container.textContent).not.toContain("暂不支持");
    expect(container.querySelector("button, select, input")).toBeNull();
  });
});
